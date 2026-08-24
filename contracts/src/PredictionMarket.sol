// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/// @notice Minimal interface to the generated UltraHonk verifier
///         (`contracts/src/verifiers/HonkVerifier.sol`).
interface IHonkVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}

/// @notice SP1 on-chain verifier interface (SP1VerifierGateway). Reverts if the
///         proof is invalid.
interface ISP1Verifier {
    function verifyProof(bytes32 programVKey, bytes calldata publicValues, bytes calldata proofBytes)
        external
        view;
}

/// @title PredictionMarket (Milestone 1 — private positions & verified claims)
/// @notice Price-threshold prediction markets resolved by a Chainlink Price
///         Feed. Positions are private: a deposit escrows collateral and
///         records only a Poseidon note *commitment* (the Yes/No side is
///         hidden). After resolution, anyone can settle a batch of markets by
///         submitting an SP1 proof (`settleWithProof`) that attests the
///         per-side totals and commitments-tree root were correctly computed
///         from each market's notes — no trusted operator. Winners then claim
///         with a zk-SNARK proof, unlinkably to their deposit, and the payout
///         recipient is bound into the proof so a claim cannot be front-run.
///
/// @dev Trust model:
///      - Settlement totals and the commitments root are established by the SP1
///        batch-settlement proof, not by any privileged party. The full leaf
///        set is also stored on-chain as an immutable anchor, and settlement
///        still enforces totalYes + totalNo == totalPool as defense in depth.
///      - The consistency between a note's committed `amount` and the escrowed
///        `msg.value` cannot be checked on-chain (the amount is inside the
///        commitment); it is enforced by the SP1 solvency proof (sum of note
///        amounts == totalPool).
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

    /// One market's proven settlement, ABI-decoded from an SP1 proof's public
    /// values. Layout must match `aggregation::public_values::SettlementValues`.
    struct SettlementValues {
        uint64 marketId;
        uint64 totalYes;
        uint64 totalNo;
        bytes32 merkleRoot;
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
    ISP1Verifier public immutable sp1Verifier;
    /// Verifying-key hash of the batch-settlement SP1 program.
    bytes32 public immutable programVKey;

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

    /// @param verifier_ Address of the deployed UltraHonk claim verifier.
    /// @param sp1Verifier_ Address of the SP1 verifier (gateway).
    /// @param programVKey_ Verifying-key hash of the batch-settlement SP1 program.
    constructor(address verifier_, address sp1Verifier_, bytes32 programVKey_) {
        verifier = IHonkVerifier(verifier_);
        sp1Verifier = ISP1Verifier(sp1Verifier_);
        programVKey = programVKey_;
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

    /// @notice Trustlessly settles a batch of resolved markets from an SP1
    ///         proof. The proof attests that, for every market in
    ///         `publicValues`, the per-side totals and commitments-tree root
    ///         were correctly computed from that market's committed notes — so
    ///         no operator is trusted for the numbers. Permissionless: anyone
    ///         holding a valid proof can settle.
    /// @param publicValues ABI-encoded `SettlementValues[]` (the proof's public
    ///        values, produced by the SP1 guest).
    /// @param proofBytes   SP1 proof bytes.
    function settleWithProof(bytes calldata publicValues, bytes calldata proofBytes) external {
        // Reverts if the proof does not attest to `publicValues` under the
        // batch-settlement program's verifying key.
        sp1Verifier.verifyProof(programVKey, publicValues, proofBytes);

        SettlementValues[] memory settlements = abi.decode(publicValues, (SettlementValues[]));

        for (uint256 i = 0; i < settlements.length; i++) {
            SettlementValues memory s = settlements[i];
            Market storage m = markets[s.marketId];
            if (m.status != Status.Resolved) revert MarketNotResolved();

            uint256 totalYes = uint256(s.totalYes);
            uint256 totalNo = uint256(s.totalNo);
            // Defense in depth: the proof already ties totals to the notes, but
            // they must still reconcile with the escrowed collateral on-chain.
            if (totalYes + totalNo != m.totalPool) revert TotalsMismatch();

            m.merkleRoot = s.merkleRoot;
            m.totalYes = totalYes;
            m.totalNo = totalNo;
            m.status = Status.Settled;

            emit MarketSettled(s.marketId, s.merkleRoot, totalYes, totalNo);
        }
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
