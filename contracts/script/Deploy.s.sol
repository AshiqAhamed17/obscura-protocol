// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PredictionMarket} from "../src/PredictionMarket.sol";
import {HonkVerifier} from "../src/verifiers/HonkVerifier.sol";
import {ForesightVerifier} from "../src/verifiers/ForesightVerifier.sol";
import {ForesightRegistry} from "../src/ForesightRegistry.sol";
import {ConfidentialSettlementConsumer} from "../src/ConfidentialSettlementConsumer.sol";

/// @notice Deploys the full Obscura stack: the Noir claim + foresight verifiers,
///         the USDC-denominated PredictionMarket (wired to SP1's on-chain
///         verifier gateway and the N-outcome batch-settlement vkey), the
///         ForesightRegistry, and the ConfidentialSettlementConsumer that
///         receives the Chainlink CRE confidential settlement report.
///
/// Usage (Sepolia):
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url sepolia --broadcast --verify -vvvv
contract Deploy is Script {
    /// Canonical SP1 Verifier Gateway — deployed deterministically at the same
    /// address on every chain. Verify against the deployments directory at
    /// https://github.com/succinctlabs/sp1-contracts before mainnet use.
    address constant DEFAULT_SP1_GATEWAY = 0x397A5f7f3dBd538f23DE225B51f532c34448dA9B;

    /// Canonical USDC on Ethereum Sepolia (Circle-issued, 6 decimals). Override
    /// with `COLLATERAL_TOKEN` per target chain — e.g. Arc testnet USDC
    /// `0x3600000000000000000000000000000000000000`, or a chain's mainnet USDC.
    address constant DEFAULT_COLLATERAL = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    /// Chainlink KeystoneForwarder on Ethereum Sepolia — the on-chain entry point
    /// that validates CRE-signed reports and forwards them to consumers. Override
    /// with `KEYSTONE_FORWARDER` per chain.
    address constant DEFAULT_KEYSTONE_FORWARDER = 0xF8344CFd5c43616a4366C34E3EEE75af79a74482;

    function run()
        external
        returns (
            PredictionMarket market,
            HonkVerifier verifier,
            ForesightRegistry foresightRegistry,
            ConfidentialSettlementConsumer consumer
        )
    {
        address sp1Gateway = vm.envOr("SP1_VERIFIER_GATEWAY", DEFAULT_SP1_GATEWAY);
        bytes32 programVKey = vm.envOr("PROGRAM_VKEY", bytes32(0));
        address collateral = vm.envOr("COLLATERAL_TOKEN", DEFAULT_COLLATERAL);
        address forwarder = vm.envOr("KEYSTONE_FORWARDER", DEFAULT_KEYSTONE_FORWARDER);

        if (programVKey == bytes32(0)) {
            console2.log("WARNING: PROGRAM_VKEY is 0x0 - settleWithProof will reject every proof.");
            console2.log("Deposits/resolution still work; set PROGRAM_VKEY before settling. Get it from:");
            console2.log("  cargo run --release -p host -- --evm   (prints 'programVKey: 0x...')");
        }

        vm.startBroadcast();
        verifier = new HonkVerifier();
        ForesightVerifier foresightVerifier = new ForesightVerifier();
        market = new PredictionMarket(address(verifier), sp1Gateway, programVKey, collateral);
        foresightRegistry = new ForesightRegistry(address(market), address(foresightVerifier));
        consumer = new ConfidentialSettlementConsumer(forwarder, address(market));
        vm.stopBroadcast();

        console2.log("HonkVerifier       :", address(verifier));
        console2.log("ForesightVerifier  :", address(foresightVerifier));
        console2.log("PredictionMarket   :", address(market));
        console2.log("ForesightRegistry  :", address(foresightRegistry));
        console2.log("ConfidentialConsumer:", address(consumer));
        console2.log("SP1 gateway        :", sp1Gateway);
        console2.log("collateral (USDC)  :", collateral);
        console2.log("KeystoneForwarder  :", forwarder);
        console2.log("programVKey        :");
        console2.logBytes32(programVKey);
    }
}
