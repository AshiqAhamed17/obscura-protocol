// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ParlayVerifier} from "../src/verifiers/ParlayVerifier.sol";
import {ParlayPool} from "../src/ParlayPool.sol";

/// @notice Deploys the ParlayVerifier (with its libraries auto-linked) + the
///         ParlayPool wired to the canonical PredictionMarket + USDC on the
///         target chain. The deployer is the settler (prod: SP1/DON forwarder).
///
/// Usage (Sepolia):
///   forge script script/DeployParlay.s.sol:DeployParlay \
///     --rpc-url sepolia --broadcast --verify -vvvv
contract DeployParlay is Script {
    address constant DEFAULT_MARKET = 0x60388bb719F3ccb5a40236076e1AF4B64ed22375;
    address constant DEFAULT_COLLATERAL = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238; // Sepolia USDC

    function run() external returns (ParlayVerifier verifier, ParlayPool pool) {
        address market = vm.envOr("PREDICTION_MARKET", DEFAULT_MARKET);
        address collateral = vm.envOr("COLLATERAL_TOKEN", DEFAULT_COLLATERAL);

        vm.startBroadcast();
        address settler = msg.sender;
        verifier = new ParlayVerifier();
        pool = new ParlayPool(address(verifier), collateral, market, settler);
        vm.stopBroadcast();

        console2.log("ParlayVerifier :", address(verifier));
        console2.log("ParlayPool     :", address(pool));
        console2.log("market         :", market);
        console2.log("collateral     :", collateral);
        console2.log("settler        :", settler);
    }
}
