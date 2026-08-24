// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockV3Aggregator} from "@chainlink/contracts/src/v0.8/tests/MockV3Aggregator.sol";
import {PredictionMarket} from "../src/PredictionMarket.sol";
import {MockHonkVerifier} from "./mocks/MockHonkVerifier.sol";
import {MockSP1Verifier} from "./mocks/MockSP1Verifier.sol";

/// @notice End-to-end trustless batch settlement, driven by the REAL public
///         values produced by the Rust/SP1 guest's ABI encoder
///         (`aggregation::public_values::encode`, dumped via
///         `cargo run -p host -- --dump-values`). Decoding those exact bytes
///         on-chain proves the guest's output format and the contract's decoder
///         agree — the cross-tool ABI compatibility the trustless path depends
///         on. The SP1 proof itself is mock-verified here; the real proof is
///         generated on the Succinct Prover Network (see host/README.md).
contract PredictionMarketBatchE2ETest is Test {
    uint8 constant DECIMALS = 8;
    int256 constant THRESHOLD = 3_000e8;
    uint256 constant MAX_STALENESS = 1 hours;

    PredictionMarket market;
    MockV3Aggregator feed;
    MockSP1Verifier sp1Verifier;

    address depositor = makeAddr("depositor");

    function setUp() public {
        MockHonkVerifier claimVerifier = new MockHonkVerifier();
        sp1Verifier = new MockSP1Verifier();
        market = new PredictionMarket(address(claimVerifier), address(sp1Verifier), bytes32(uint256(0x5f1)));
        feed = new MockV3Aggregator(DECIMALS, THRESHOLD);
        vm.deal(depositor, 100 ether);
    }

    function test_batchSettle_fromRustEncodedPublicValues() public {
        // The exact bytes the guest commits for the `several_markets` batch.
        bytes memory publicValues = vm.readFileBinary("test/fixtures/sample_public_values.bin");
        PredictionMarket.SettlementValues[] memory expected =
            abi.decode(publicValues, (PredictionMarket.SettlementValues[]));
        assertEq(expected.length, 3, "fixture has 3 markets");

        // Create each market and fund it to match the proven pool, so the
        // on-chain totalYes+totalNo == totalPool invariant holds.
        for (uint256 i = 0; i < expected.length; i++) {
            uint256 id = market.createMarket(address(feed), THRESHOLD, block.timestamp + 1 days, MAX_STALENESS);
            assertEq(id, expected[i].marketId, "market id ordering");
            uint256 pool = uint256(expected[i].totalYes) + expected[i].totalNo;
            if (pool > 0) {
                vm.prank(depositor);
                market.deposit{value: pool}(id, bytes32(uint256(i + 1)));
            }
        }

        // Resolve every market, then settle the whole batch with one proof.
        vm.warp(block.timestamp + 1 days);
        feed.updateAnswer(THRESHOLD);
        for (uint256 i = 0; i < expected.length; i++) {
            market.resolveMarket(i);
        }

        market.settleWithProof(publicValues, hex"01");

        // Every market now holds exactly the proven totals + root.
        for (uint256 i = 0; i < expected.length; i++) {
            (,,,, PredictionMarket.Status status,,,, bytes32 root, uint256 ty, uint256 tn) = market.markets(i);
            assertEq(uint8(status), uint8(PredictionMarket.Status.Settled), "settled");
            assertEq(ty, expected[i].totalYes, "totalYes");
            assertEq(tn, expected[i].totalNo, "totalNo");
            assertEq(root, expected[i].merkleRoot, "merkleRoot");
        }
    }

    function test_batchSettle_revertsWhenPoolDoesNotMatchProvenTotals() public {
        bytes memory publicValues = vm.readFileBinary("test/fixtures/sample_public_values.bin");
        PredictionMarket.SettlementValues[] memory expected =
            abi.decode(publicValues, (PredictionMarket.SettlementValues[]));

        // Fund market 0 with the WRONG pool (proven totals won't reconcile).
        for (uint256 i = 0; i < expected.length; i++) {
            market.createMarket(address(feed), THRESHOLD, block.timestamp + 1 days, MAX_STALENESS);
            uint256 pool = uint256(expected[i].totalYes) + expected[i].totalNo;
            if (i == 0) pool += 1; // tamper
            if (pool > 0) {
                vm.prank(depositor);
                market.deposit{value: pool}(i, bytes32(uint256(i + 1)));
            }
        }

        vm.warp(block.timestamp + 1 days);
        feed.updateAnswer(THRESHOLD);
        for (uint256 i = 0; i < expected.length; i++) {
            market.resolveMarket(i);
        }

        vm.expectRevert(PredictionMarket.TotalsMismatch.selector);
        market.settleWithProof(publicValues, hex"01");
    }
}
