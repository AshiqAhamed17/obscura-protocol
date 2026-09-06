// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PredictionMarket} from "../src/PredictionMarket.sol";

/// @notice Opens a market on a deployed PredictionMarket against a live
///         Chainlink price feed (defaults to ETH/USD on Sepolia). The threshold
///         is in the feed's native 8-decimal units — $3,000 = 3000e8.
///
/// Usage:
///   MARKET_ADDRESS=0x... forge script script/CreateMarket.s.sol:CreateMarket \
///     --rpc-url sepolia --broadcast -vvvv
contract CreateMarket is Script {
    /// Chainlink ETH/USD, Ethereum Sepolia.
    address constant SEPOLIA_ETH_USD = 0x694AA1769357215DE4FAC081bf1f309aDC325306;

    function run() external returns (uint256 marketId) {
        address marketAddr = vm.envAddress("MARKET_ADDRESS");
        address feed = vm.envOr("ETH_USD_FEED", SEPOLIA_ETH_USD);
        int256 threshold = vm.envOr("THRESHOLD", int256(3000e8)); // $3,000
        uint256 resolveAfter = vm.envOr("RESOLVE_AFTER", block.timestamp + 1 days);
        // Reject a Chainlink answer older than this at resolution time. ETH/USD
        // on Sepolia updates well within a few hours; 3h leaves generous margin.
        uint256 maxStaleness = vm.envOr("MAX_STALENESS", uint256(3 hours));

        vm.startBroadcast();
        marketId = PredictionMarket(marketAddr).createMarket(feed, threshold, resolveAfter, maxStaleness);
        vm.stopBroadcast();

        console2.log("Market id     :", marketId);
        console2.log("Feed          :", feed);
        console2.log("Threshold(1e8):");
        console2.logInt(threshold);
        console2.log("Resolve after :", resolveAfter);
        console2.log("Max staleness :", maxStaleness);
    }
}
