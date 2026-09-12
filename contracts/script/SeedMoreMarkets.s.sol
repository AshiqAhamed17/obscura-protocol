// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PredictionMarket} from "../src/PredictionMarket.sol";

/// @notice Extends the live board so every category tab is backed by a real
///         market: a commodity (gold), a forex pair (EUR/USD), and one
///         categorical / sports-style market resolved via the CRE/DON path.
///         Crypto markets (ETH/BTC/LINK) already exist from the first seed.
///
/// Usage:
///   PREDICTION_MARKET=0x... forge script script/SeedMoreMarkets.s.sol:SeedMoreMarkets \
///     --rpc-url "$SEPOLIA_RPC_URL" --broadcast --private-key "$PRIVATE_KEY"
contract SeedMoreMarkets is Script {
    // Verified-live Chainlink price feeds on Ethereum Sepolia.
    address constant XAU_USD = 0xC5981F461d74c46eB4b0CF3f4Ec79f025573B0Ea; // gold, ~6h updates
    address constant EUR_USD = 0x1a81afB8146aeFfCFc5E50e8479e826E7D55b910; // forex, ~daily updates

    function run() external {
        PredictionMarket market = PredictionMarket(vm.envAddress("PREDICTION_MARKET"));
        uint256 resolveAfter = block.timestamp + 5 days;

        // The DON/CRE forwarder that reports off-chain outcomes. For the demo the
        // operator stands in for it (same as the existing Graph-resolved market).
        address resolver = msg.sender;

        vm.startBroadcast();

        // Commodity — gold updates slower, 6h staleness tolerance.
        uint256 mGold = market.createMarket(XAU_USD, 4_500e8, resolveAfter, 6 hours); // "Gold > $4,500/oz?"

        // Forex — EUR/USD updates ~daily on Sepolia, 2d tolerance so it stays resolvable.
        uint256 mEur = market.createMarket(EUR_USD, 115e6, resolveAfter, 2 days); // "EUR/USD > 1.15?" (1.15 * 1e8)

        // Categorical / sports — a 3-outcome market resolved by the CRE/DON path.
        // sourceRef is a human-readable handle the frontend maps to a title +
        // outcome labels (there is no on-chain title field by design).
        uint256 mSport = market.createMarketWithSource(
            PredictionMarket.ResolutionSource.CreWorkflow,
            resolver,
            0, // no numeric threshold for a categorical market
            resolveAfter,
            bytes32("obscura-sports-ucl-2026"),
            3 // 3 outcomes
        );

        vm.stopBroadcast();

        console2.log("Seeded additional markets (ids):");
        console2.log("  XAU/USD  > $4,500        ->", mGold);
        console2.log("  EUR/USD  > 1.15          ->", mEur);
        console2.log("  Sports (categorical, 3)  ->", mSport);
    }
}
