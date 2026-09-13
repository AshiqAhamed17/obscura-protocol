// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AutoResolver} from "../src/AutoResolver.sol";

/// @notice Deploys the AutoResolver keeper wired to the canonical
///         PredictionMarket. After deploying, register it as a Chainlink
///         Automation custom-logic upkeep at automation.chain.link and fund it
///         with (testnet) LINK; the DON then calls resolveMarket automatically.
///
/// Usage (Sepolia):
///   forge script script/DeployAutoResolver.s.sol:DeployAutoResolver \
///     --rpc-url "$SEPOLIA_RPC_URL" --broadcast --verify --private-key "$PRIVATE_KEY"
contract DeployAutoResolver is Script {
    address constant DEFAULT_MARKET = 0x60388bb719F3ccb5a40236076e1AF4B64ed22375;

    function run() external returns (AutoResolver resolver) {
        address market = vm.envOr("PREDICTION_MARKET", DEFAULT_MARKET);
        vm.startBroadcast();
        resolver = new AutoResolver(market);
        vm.stopBroadcast();
        console2.log("AutoResolver:", address(resolver));
        console2.log("market      :", market);
    }
}
