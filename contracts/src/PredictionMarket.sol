// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/// @title PredictionMarket (Milestone 1 — private positions)
/// @notice Price-threshold prediction markets resolved by a Chainlink Price
///         Feed. Positions are *private*: a deposit escrows collateral and
///         records only a Poseidon note *commitment* as a leaf of the market's
///         commitments tree — the side (Yes/No) is hidden. Winners later claim
///         with a zero-knowledge proof (wired in task 1.8), unlinkably to their
///         deposit.
///
/// @dev Milestone-1 trust assumptions, made explicit and removed in Milestone 2:
///      - The Merkle *root* of the commitments tree is NOT computed on-chain.
///        The Noir circuit's Poseidon is not byte-compatible with any standard
///        Solidity Poseidon, and recomputing the root here would duplicate work
///        the Milestone-2 SP1 proof already does. Instead the full leaf set is
///        stored on-chain as an immutable anchor (the operator cannot invent or
///        omit leaves), and the root is reconstructed off-chain — trusted from
///        the operator in M1, cryptographically proven by SP1 in M2.
///      - The consistency between a note's committed `amount` and the escrowed
///        `msg.value` cannot be checked on-chain (the amount is inside the
///        commitment). It is enforced off-chain by the operator in M1 and by
///        the SP1 solvency proof (sum of note amounts == totalPool) in M2.
contract PredictionMarket {
    enum Side {
        Yes,
        No
    }

    enum Status {
        Open,
        Resolved
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
    }

    /// BN254 scalar field modulus. Commitments are Poseidon outputs over this
    /// field, so any valid commitment is strictly less than this value.
    uint256 internal constant FIELD_MODULUS =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    uint256 public marketCount;
    mapping(uint256 marketId => Market) public markets;

    /// Leaves of each market's commitments tree, in insertion order. Public so
    /// anyone can reconstruct the tree/root off-chain and verify the operator's
    /// (M1) or SP1's (M2) reported root against it.
    mapping(uint256 marketId => bytes32[] commitments) internal _commitments;

    /// Guards against inserting the same commitment twice into a market.
    mapping(uint256 marketId => mapping(bytes32 commitment => bool seen)) public commitmentSeen;

    event MarketCreated(uint256 indexed marketId, address priceFeed, int256 threshold, uint256 resolveAfter);
    event Deposit(uint256 indexed marketId, bytes32 indexed commitment, uint256 leafIndex, uint256 amount);
    event MarketResolved(uint256 indexed marketId, Side winningSide, int256 resolvedPrice);

    error MarketNotOpen();
    error MarketNotResolvable();
    error StalePrice();
    error InvalidPrice();
    error ZeroAmount();
    error CommitmentOutOfField();
    error CommitmentAlreadyUsed();

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

    /// @notice All commitments (leaves) of a market, in insertion order.
    function getCommitments(uint256 marketId) external view returns (bytes32[] memory) {
        return _commitments[marketId];
    }

    /// @notice A single commitment leaf by index.
    function commitmentAt(uint256 marketId, uint256 leafIndex) external view returns (bytes32) {
        return _commitments[marketId][leafIndex];
    }
}
