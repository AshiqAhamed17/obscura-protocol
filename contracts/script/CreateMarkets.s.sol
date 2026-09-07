// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PredictionMarket} from "../src/PredictionMarket.sol";

/// @notice Seeds a diverse board of price-threshold markets on an already
///         deployed PredictionMarket, one per live Chainlink Sepolia feed —
///         crypto, a commodity (gold), and forex. Each feed was verified live
///         and non-stale on-chain before being listed here; the dead JPY/USD
///         feed and the intermittently-stale GBP/DAI feeds were deliberately
///         excluded. Prices are 8-decimal, so a threshold of $3000 is 3000e8.
///
/// Usage:
///   PREDICTION_MARKET=0x... forge script script/CreateMarkets.s.sol:CreateMarkets \
///     --rpc-url "$SEPOLIA_RPC_URL" --broadcast --private-key "$PRIVATE_KEY"
contract CreateMarkets is Script {
    // Verified-live Chainlink price feeds on Ethereum Sepolia.
    address constant ETH_USD = 0x694AA1769357215DE4FAC081bf1f309aDC325306;
    address constant BTC_USD = 0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43;
    address constant LINK_USD = 0xc59E3633BAAC79493d908e63626716e204A45EdF;
    address constant XAU_USD = 0xC5981F461d74c46eB4b0CF3f4Ec79f025573B0Ea; // gold
    address constant EUR_USD = 0x1a81afB8146aeFfCFc5E50e8479e826E7D55b910; // forex

    function run() external {
        PredictionMarket market = PredictionMarket(vm.envAddress("PREDICTION_MARKET"));
        uint256 resolveAfter = block.timestamp + 7 days;

        vm.startBroadcast();

        // Crypto — fast feeds, 1h staleness tolerance.
        uint256 m0 = market.createMarket(ETH_USD, 3_000e8, resolveAfter, 1 hours); // "ETH > $3,000?"
        uint256 m1 = market.createMarket(BTC_USD, 100_000e8, resolveAfter, 1 hours); // "BTC > $100,000?"
        uint256 m2 = market.createMarket(LINK_USD, 15e8, resolveAfter, 1 hours); // "LINK > $15?"
        // Commodity — gold updates a bit slower, 6h tolerance.
        uint256 m3 = market.createMarket(XAU_USD, 4_500e8, resolveAfter, 6 hours); // "Gold > $4,500/oz?"
        // Forex — EUR/USD updates ~daily on Sepolia, 2d tolerance so it stays resolvable.
        uint256 m4 = market.createMarket(EUR_USD, 115e6, resolveAfter, 2 days); // "EUR/USD > 1.15?"  (1.15 * 1e8)

        vm.stopBroadcast();

        console2.log("Seeded markets (ids):");
        console2.log("  ETH/USD  > $3,000    ->", m0);
        console2.log("  BTC/USD  > $100,000  ->", m1);
        console2.log("  LINK/USD > $15       ->", m2);
        console2.log("  XAU/USD  > $4,500    ->", m3);
        console2.log("  EUR/USD  > 1.15      ->", m4);
    }
}
