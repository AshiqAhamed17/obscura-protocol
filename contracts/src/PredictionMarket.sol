// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/// @title PredictionMarket (Milestone 0)
/// @notice Price-threshold prediction markets resolved by a Chainlink Price
///         Feed, with plaintext (non-private) positions and pari-mutuel
///         payouts. Privacy (Noir shielded notes) and the SP1 batch-solvency
///         proof are added in later milestones on top of this base.
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
        uint256 totalYes;
        uint256 totalNo;
    }

    struct Position {
        uint256 yesAmount;
        uint256 noAmount;
        bool claimed;
    }

    uint256 public marketCount;
    mapping(uint256 marketId => Market) public markets;
    mapping(uint256 marketId => mapping(address trader => Position)) public positions;

    event MarketCreated(uint256 indexed marketId, address priceFeed, int256 threshold, uint256 resolveAfter);
    event PositionTaken(uint256 indexed marketId, address indexed trader, Side side, uint256 amount);
    event MarketResolved(uint256 indexed marketId, Side winningSide, int256 resolvedPrice);
    event Claimed(uint256 indexed marketId, address indexed trader, uint256 payout);

    error MarketNotOpen();
    error MarketNotResolvable();
    error MarketNotResolved();
    error AlreadyClaimed();
    error NoWinningPosition();
    error StalePrice();
    error InvalidPrice();
    error ZeroAmount();
    error TransferFailed();

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

    function takePosition(uint256 marketId, Side side) external payable {
        if (msg.value == 0) revert ZeroAmount();

        Market storage m = markets[marketId];
        if (m.status != Status.Open) revert MarketNotOpen();

        Position storage p = positions[marketId][msg.sender];
        if (side == Side.Yes) {
            p.yesAmount += msg.value;
            m.totalYes += msg.value;
        } else {
            p.noAmount += msg.value;
            m.totalNo += msg.value;
        }

        emit PositionTaken(marketId, msg.sender, side, msg.value);
    }

    /// @notice Resolves the market against the Chainlink feed. Reverts if the feed's
    ///         last update is older than `maxPriceStaleness` — some testnet feeds are
    ///         known to stop updating, so this is a correctness requirement, not just
    ///         defensive programming.
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

    /// @notice Pari-mutuel claim: winners split the full pool proportional to stake.
    function claim(uint256 marketId) external {
        Market storage m = markets[marketId];
        if (m.status != Status.Resolved) revert MarketNotResolved();

        Position storage p = positions[marketId][msg.sender];
        if (p.claimed) revert AlreadyClaimed();

        uint256 winningAmount = m.winningSide == Side.Yes ? p.yesAmount : p.noAmount;
        if (winningAmount == 0) revert NoWinningPosition();

        uint256 totalWinning = m.winningSide == Side.Yes ? m.totalYes : m.totalNo;
        uint256 totalPool = m.totalYes + m.totalNo;

        // Effects before interaction: mark claimed before sending funds.
        p.claimed = true;
        uint256 payout = (winningAmount * totalPool) / totalWinning;

        emit Claimed(marketId, msg.sender, payout);

        (bool success,) = msg.sender.call{value: payout}("");
        if (!success) revert TransferFailed();
    }
}
