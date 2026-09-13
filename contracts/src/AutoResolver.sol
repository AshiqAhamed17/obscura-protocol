// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PredictionMarket} from "./PredictionMarket.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/// @title AutoResolver — Chainlink Automation keeper for market resolution.
/// @notice Implements the Chainlink Automation custom-logic interface
///         (`checkUpkeep` / `performUpkeep`). Register this contract as an
///         upkeep at automation.chain.link and fund it with LINK; the
///         Automation DON then calls `resolveMarket` automatically the moment a
///         Chainlink-feed market passes its deadline — no manual poke and no
///         user-facing "resolve" button.
/// @dev `PredictionMarket.resolveMarket` is permissionless, so this keeper needs
///      no special privileges — it simply automates a call anyone could make.
///      Only `ChainlinkFeed` markets are auto-resolved here; Graph/CRE markets
///      are delivered by their registered DON/CRE resolver via `reportResolution`.
contract AutoResolver {
    PredictionMarket public immutable market;

    constructor(address market_) {
        market = PredictionMarket(market_);
    }

    /// @notice Off-chain view the Automation DON simulates each block. Returns
    ///         the first open, feed-resolved market that is past its deadline,
    ///         encoding its id as `performData`.
    /// @dev Marked `view`; Chainlink's interface declares it non-view, and a
    ///      more-restrictive override is permitted. Not inherited to keep the
    ///      contract dependency-free — Automation matches by function selector.
    function checkUpkeep(bytes calldata)
        external
        view
        returns (bool upkeepNeeded, bytes memory performData)
    {
        uint256 count = market.marketCount();
        for (uint256 i = 0; i < count; i++) {
            if (_isResolvable(i)) {
                return (true, abi.encode(i));
            }
        }
        return (false, bytes(""));
    }

    /// @notice On-chain action the DON calls when `checkUpkeep` returns true.
    ///         Re-validates before acting — `checkUpkeep` runs off-chain and can
    ///         be stale, so a race can never force an invalid resolution.
    function performUpkeep(bytes calldata performData) external {
        uint256 marketId = abi.decode(performData, (uint256));
        require(_isResolvable(marketId), "AutoResolver: not resolvable");
        market.resolveMarket(marketId);
    }

    /// @notice Scheduler-agnostic entry point: resolves every currently-due
    ///         feed market in one permissionless call. This is what a CRE cron
    ///         workflow (the successor to classic Automation, sunset in 2026)
    ///         invokes on a schedule — no performData, no off-chain checkData.
    /// @return resolved The number of markets resolved this call.
    function resolveDue() external returns (uint256 resolved) {
        return _resolveDue();
    }

    /// @notice CRE / Chainlink KeystoneForwarder entry point (IReceiver shape).
    ///         A CRE cron workflow delivers a signed report here on its schedule;
    ///         the report content is irrelevant because the action it triggers
    ///         (`_resolveDue`) is permissionless and self-validating, so no
    ///         forwarder access-control is needed for correctness.
    function onReport(bytes calldata, bytes calldata) external {
        _resolveDue();
    }

    function _resolveDue() internal returns (uint256 resolved) {
        uint256 count = market.marketCount();
        for (uint256 i = 0; i < count; i++) {
            if (_isResolvable(i)) {
                market.resolveMarket(i);
                unchecked {
                    resolved++;
                }
            }
        }
    }

    /// A market is auto-resolvable iff it is Open, past its deadline, and
    /// Chainlink-feed resolved — and the feed itself is live and non-stale, so
    /// this mirrors `resolveMarket`'s own guards and the DON never fires a call
    /// that would revert (which would waste LINK / pause the upkeep).
    function _isResolvable(uint256 marketId) internal view returns (bool) {
        (
            AggregatorV3Interface priceFeed,
            ,
            uint256 resolveAfter,
            uint256 maxPriceStaleness,
            PredictionMarket.Status status,
            ,
            ,
            ,
            ,
        ) = market.markets(marketId);
        (PredictionMarket.ResolutionSource source,,) = market.resolutionConfig(marketId);

        if (status != PredictionMarket.Status.Open) return false;
        if (block.timestamp < resolveAfter) return false;
        if (source != PredictionMarket.ResolutionSource.ChainlinkFeed) return false;

        // Same freshness guard as resolveMarket: a positive, non-stale answer.
        (, int256 price,, uint256 updatedAt,) = priceFeed.latestRoundData();
        if (price <= 0) return false;
        if (block.timestamp - updatedAt > maxPriceStaleness) return false;
        return true;
    }
}
