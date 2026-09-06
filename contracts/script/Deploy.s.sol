// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PredictionMarket} from "../src/PredictionMarket.sol";
import {HonkVerifier} from "../src/verifiers/HonkVerifier.sol";

/// @notice Deploys the Noir claim verifier and the PredictionMarket, wired to
///         SP1's on-chain verifier gateway and the batch-settlement program's
///         verifying key.
///
/// Usage (Sepolia):
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url sepolia --broadcast --verify -vvvv
contract Deploy is Script {
    /// Canonical SP1 Verifier Gateway — deployed deterministically at the same
    /// address on every chain. Verify against the deployments directory at
    /// https://github.com/succinctlabs/sp1-contracts before mainnet use.
    address constant DEFAULT_SP1_GATEWAY = 0x397A5f7f3dBd538f23DE225B51f532c34448dA9B;

    function run() external returns (PredictionMarket market, HonkVerifier verifier) {
        address sp1Gateway = vm.envOr("SP1_VERIFIER_GATEWAY", DEFAULT_SP1_GATEWAY);
        bytes32 programVKey = vm.envOr("PROGRAM_VKEY", bytes32(0));

        if (programVKey == bytes32(0)) {
            console2.log("WARNING: PROGRAM_VKEY is 0x0 - settleWithProof will reject every proof.");
            console2.log("Deposits/resolution still work; set PROGRAM_VKEY before settling. Get it from:");
            console2.log("  cargo run --release -p host -- --evm   (prints 'programVKey: 0x...')");
        }

        vm.startBroadcast();
        verifier = new HonkVerifier();
        market = new PredictionMarket(address(verifier), sp1Gateway, programVKey);
        vm.stopBroadcast();

        console2.log("HonkVerifier     :", address(verifier));
        console2.log("PredictionMarket :", address(market));
        console2.log("SP1 gateway      :", sp1Gateway);
        console2.log("programVKey      :");
        console2.logBytes32(programVKey);
    }
}
