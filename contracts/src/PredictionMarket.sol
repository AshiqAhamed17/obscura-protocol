// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/// @notice Minimal interface to the generated UltraHonk verifier
///         (`contracts/src/verifiers/HonkVerifier.sol`).
interface IHonkVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}

/// @title PredictionMarket (Milestone 1 — private positions & verified claims)
/// @notice Price-threshold prediction markets resolved by a Chainlink Price
///         Feed. Positions are private: a deposit escrows collateral and
///         records only a Poseidon note *commitment* (the Yes/No side is
///         hidden). After resolution the operator settles the market with the
///         per-side totals and the commitments-tree root; winners then claim
///         with a zk-SNARK proof, unlinkably to their deposit, and the payout
///         recipient is bound into the proof so a claim cannot be front-run.
///
/// @dev Milestone-1 trust assumptions, made explicit and removed in Milestone 2:
///      - The commitments-tree Merkle root and the per-side totals are supplied
///        by the operator at `settle` time (M1: trusted). The Noir circuit's
///        Poseidon is not byte-compatible with any standard Solidity Poseidon,
///        so recomputing the root on-chain is impractical and would duplicate
///        the Milestone-2 SP1 proof. The full leaf set is stored on-chain as an
///        immutable anchor, and `settle` enforces totalYes + totalNo ==
///        totalPool. In M2 the SP1 proof replaces this trust by proving the
///        root and totals against the committed leaves.
///      - The consistency between a note's committed `amount` and the escrowed
///        `msg.value` cannot be checked on-chain (the amount is inside the
///        commitment). It is enforced off-chain by the operator in M1 and by
///        the SP1 solvency proof (sum of note amounts == totalPool) in M2.
contract PredictionMarket {
    // Ordering is load-bearing: it must match the claim circuit's `side`
    // convention (0 = No, 1 = Yes) so `uint8(winningSide)` equals the
    // circuit's `winning_side` public input.
    enum Side {
        No,
        Yes
    }

    enum Status {
        Open,
        Resolved,
        Settled
    }

    struct Market {
        AggregatorV3Interface priceFeed;
        int256 threshold;
        uint256 resolveAfter;
        uint256 maxPriceStaleness;
        Status status;
        Side winningSide;
        uint256 totalPool; // total escrowed collateral across all deposits
        uint256 depositCount; // number of commitments = next leaf index
        bytes32 merkleRoot; // commitments-tree root, set at settle
        uint256 totalYes; // winning/losing per-side totals, set at settle
        uint256 totalNo;
    }

    /// BN254 scalar field modulus. Commitments are Poseidon outputs over this
    /// field, so any valid commitment is strictly less than this value.
    uint256 internal constant FIELD_MODULUS =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    IHonkVerifier public immutable verifier;
    address public immutable operator;

    uint256 public marketCount;
    mapping(uint256 marketId => Market) public markets;

    /// Leaves of each market's commitments tree, in insertion order. Public so
    /// anyone can reconstruct the tree/root off-chain and check the operator's
    /// (M1) or SP1's (M2) reported root against it.
    mapping(uint256 marketId => bytes32[] commitments) internal _commitments;

    /// Guards against inserting the same commitment twice into a market.
    mapping(uint256 marketId => mapping(bytes32 commitment => bool seen)) public commitmentSeen;

    /// Spent nullifiers. A note's nullifier binds its market_id, so a single
    /// global registry cannot collide across markets.
    mapping(bytes32 nullifier => bool spent) public nullifierSpent;

    event MarketCreated(uint256 indexed marketId, address priceFeed, int256 threshold, uint256 resolveAfter);
    event Deposit(uint256 indexed marketId, bytes32 indexed commitment, uint256 leafIndex, uint256 amount);
    event MarketResolved(uint256 indexed marketId, Side winningSide, int256 resolvedPrice);
    event MarketSettled(uint256 indexed marketId, bytes32 merkleRoot, uint256 totalYes, uint256 totalNo);
    event Claimed(uint256 indexed marketId, bytes32 indexed nullifier, address indexed recipient, uint256 payout);

    error NotOperator();
    error MarketNotOpen();
    error MarketNotResolvable();
    error MarketNotResolved();
    error MarketNotSettled();
    error StalePrice();
    error InvalidPrice();
    error ZeroAmount();
    error CommitmentOutOfField();
    error CommitmentAlreadyUsed();
    error TotalsMismatch();
    error NullifierAlreadySpent();
    error InvalidProof();
    error NoWinningStake();
    error TransferFailed();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    /// @param verifier_ Address of the deployed UltraHonk claim verifier.
    constructor(address verifier_) {
        verifier = IHonkVerifier(verifier_);
        operator = msg.sender;
    }

    /// @param priceFeed Chainlink AggregatorV3Interface address for the underlying asset.
    /// @param threshold Price threshold in the feed's native decimals. Market resolves
    ///                   Yes if the feed price is >= threshold at resolution time.
    /// @param resolveAfter Timestamp after which `resolveMarket` may be called.
    /// @param maxPriceStaleness Maximum allowed age (seconds) of the feed's last update
    ///                          at resolution time.
    function createMarket(address priceFeed, int256 threshold, uint256 resolveAfter, uint256 maxPriceStaleness)
        external
        returns (uint256 marketId)
    {
        marketId = marketCount++;
        Market storage m = markets[marketId];
        m.priceFeed = AggregatorV3Interface(priceFeed);
        m.threshold = threshold;
        m.resolveAfter = resolveAfter;
        m.maxPriceStaleness = maxPriceStaleness;

        emit MarketCreated(marketId, priceFeed, threshold, resolveAfter);
    }

    /// @notice Takes a private position: escrows `msg.value` and appends the
    ///         note `commitment` as the next leaf of the market's commitments
    ///         tree. The side and the deposit's link to any future claim stay
    ///         hidden.
    function deposit(uint256 marketId, bytes32 commitment) external payable returns (uint256 leafIndex) {
        if (msg.value == 0) revert ZeroAmount();
        if (uint256(commitment) >= FIELD_MODULUS) revert CommitmentOutOfField();

        Market storage m = markets[marketId];
        if (m.status != Status.Open) revert MarketNotOpen();
        if (commitmentSeen[marketId][commitment]) revert CommitmentAlreadyUsed();

        commitmentSeen[marketId][commitment] = true;
        leafIndex = m.depositCount;
        _commitments[marketId].push(commitment);
        m.depositCount = leafIndex + 1;
        m.totalPool += msg.value;

        emit Deposit(marketId, commitment, leafIndex, msg.value);
    }

    /// @notice Resolves the market against the Chainlink feed. Reverts if the
    ///         feed's last update is older than `maxPriceStaleness` — some
    ///         testnet feeds are known to stop updating, so this is a
    ///         correctness requirement, not just defensive programming.
    function resolveMarket(uint256 marketId) external {
        Market storage m = markets[marketId];
        if (m.status != Status.Open) revert MarketNotOpen();
        if (block.timestamp < m.resolveAfter) revert MarketNotResolvable();

        (, int256 price,, uint256 updatedAt,) = m.priceFeed.latestRoundData();
        if (price <= 0) revert InvalidPrice();
        if (block.timestamp - updatedAt > m.maxPriceStaleness) revert StalePrice();

        Side winningSide = price >= m.threshold ? Side.Yes : Side.No;
        m.status = Status.Resolved;
        m.winningSide = winningSide;

        emit MarketResolved(marketId, winningSide, price);
    }

    /// @notice Operator posts the commitments-tree root and per-side totals,
    ///         unlocking claims. `totalYes + totalNo` must equal the escrowed
    ///         `totalPool`. In Milestone 2 an SP1 proof replaces this trusted
    ///         step by proving the root and totals against the committed leaves.
    function settle(uint256 marketId, bytes32 merkleRoot, uint256 totalYes, uint256 totalNo)
        external
        onlyOperator
    {
        Market storage m = markets[marketId];
        if (m.status != Status.Resolved) revert MarketNotResolved();
        if (totalYes + totalNo != m.totalPool) revert TotalsMismatch();

        m.merkleRoot = merkleRoot;
        m.totalYes = totalYes;
        m.totalNo = totalNo;
        m.status = Status.Settled;

        emit MarketSettled(marketId, merkleRoot, totalYes, totalNo);
    }

    /// @notice Claims a pari-mutuel payout for a winning note, in zero
    ///         knowledge. The proof establishes that the caller owns an unspent
    ///         note that is a member of `merkleRoot`, is on the winning side,
    ///         and yields `nullifier` — without revealing which deposit it is.
    ///         `recipient` is bound into the proof, so the claim cannot be
    ///         front-run.
    /// @param amount    Stake of the claimed note (a public input to the proof).
    /// @param nullifier Note nullifier, revealed and marked spent here.
    /// @param recipient Payout address (bound into the proof).
    /// @param proof     UltraHonk proof bytes.
    function claim(uint256 marketId, uint256 amount, bytes32 nullifier, address recipient, bytes calldata proof)
        external
    {
        Market storage m = markets[marketId];
        if (m.status != Status.Settled) revert MarketNotSettled();
        if (nullifierSpent[nullifier]) revert NullifierAlreadySpent();

        // Public inputs are built from trusted on-chain state (root, marketId,
        // winningSide) plus the caller-supplied (amount, nullifier, recipient),
        // in the exact order the claim circuit declares them. Building them here
        // — rather than trusting a caller-supplied array — binds the proof to
        // this market's resolved state.
        bytes32[] memory publicInputs = new bytes32[](6);
        publicInputs[0] = m.merkleRoot;
        publicInputs[1] = bytes32(marketId);
        publicInputs[2] = bytes32(uint256(uint8(m.winningSide)));
        publicInputs[3] = bytes32(amount);
        publicInputs[4] = nullifier;
        publicInputs[5] = bytes32(uint256(uint160(recipient)));

        if (!verifier.verify(proof, publicInputs)) revert InvalidProof();

        // Effects before interaction: mark the nullifier spent before paying.
        nullifierSpent[nullifier] = true;

        uint256 totalWinning = m.winningSide == Side.Yes ? m.totalYes : m.totalNo;
        if (totalWinning == 0) revert NoWinningStake();

        uint256 payout = (amount * m.totalPool) / totalWinning;

        emit Claimed(marketId, nullifier, recipient, payout);

        (bool ok,) = payable(recipient).call{value: payout}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice All commitments (leaves) of a market, in insertion order.
    function getCommitments(uint256 marketId) external view returns (bytes32[] memory) {
        return _commitments[marketId];
    }

    /// @notice A single commitment leaf by index.
    function commitmentAt(uint256 marketId, uint256 leafIndex) external view returns (bytes32) {
        return _commitments[marketId][leafIndex];
    }
}
