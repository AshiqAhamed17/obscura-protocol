// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockV3Aggregator} from "@chainlink/contracts/src/v0.8/tests/MockV3Aggregator.sol";
import {PredictionMarket} from "../src/PredictionMarket.sol";
import {ForesightRegistry} from "../src/ForesightRegistry.sol";
import {ForesightVerifier} from "../src/verifiers/ForesightVerifier.sol";
import {MockHonkVerifier} from "./mocks/MockHonkVerifier.sol";
import {MockSP1Verifier} from "./mocks/MockSP1Verifier.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @notice End-to-end Proof of Foresight against the REAL foresight UltraHonk
///         verifier using a real proof (circuits/generate-foresight.sh). Proves
///         a holder can anonymously attest "I backed the winning outcome" on a
///         settled market, that each credential registers once, and that the
///         market must be settled first.
///
/// Fixture witness (circuits/foresight/Prover.toml): market_id=0, outcome=1,
/// amount=1e18 — same note as the claim fixture, so the commitment + root match.
contract ForesightRegistryTest is Test {
    uint8 constant DECIMALS = 8;
    int256 constant THRESHOLD = 3_000e8; // price == threshold -> Yes (outcome 1)
    uint256 constant MAX_STALENESS = 1 hours;

    bytes32 constant ROOT = 0x17caadfb8dac906410d1b4adf67325ce166d73eb47ae5c3dce3e97eb86ac1d95;
    bytes32 constant COMMITMENT = 0x061a4960a702e1605e3442b65b6fe17b3ea6b2ca30d7b6135fe1b00b01535252;
    bytes32 constant FORESIGHT_NULLIFIER = 0x2658f22110374e71e91a51545d5e65dfd08259c56a7adf61b7114d798fe9cbe4;

    PredictionMarket market;
    ForesightRegistry registry;
    MockV3Aggregator feed;
    MockUSDC usdc;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    bytes proof;

    event ForesightProven(uint256 indexed marketId, bytes32 indexed foresightNullifier);

    function setUp() public {
        usdc = new MockUSDC();
        market = new PredictionMarket(
            address(new MockHonkVerifier()), address(new MockSP1Verifier()), bytes32(uint256(0x5f1)), address(usdc)
        );
        registry = new ForesightRegistry(address(market), address(new ForesightVerifier()));
        feed = new MockV3Aggregator(DECIMALS, THRESHOLD);

        proof = vm.readFileBinary("test/fixtures/foresight_proof.bin");
    }

    /// Fund + approve + deposit in USDC.
    function _deposit(address from, uint256 id, bytes32 c, uint256 amt) internal {
        usdc.mint(from, amt);
        vm.prank(from);
        usdc.approve(address(market), amt);
        vm.prank(from);
        market.deposit(id, c, amt);
    }

    /// Market 0: the winning note + one loser (pool = 2e18), resolved Yes and
    /// settled with the fixture's root and a 1e18/1e18 split.
    function _settledMarket() internal returns (uint256 id) {
        id = market.createMarket(address(feed), THRESHOLD, block.timestamp + 1 days, MAX_STALENESS);
        assertEq(id, 0, "fixture assumes market id 0");

        _deposit(alice, id, COMMITMENT, 1 ether);
        _deposit(bob, id, bytes32(uint256(12345)), 1 ether);

        vm.warp(block.timestamp + 1 days);
        feed.updateAnswer(THRESHOLD);
        market.resolveMarket(id); // Yes wins -> winningOutcome = 1

        uint64[] memory totals = new uint64[](2);
        totals[0] = 1 ether; // No
        totals[1] = 1 ether; // Yes
        PredictionMarket.SettlementValues[] memory vals = new PredictionMarket.SettlementValues[](1);
        vals[0] = PredictionMarket.SettlementValues({marketId: uint64(id), outcomeTotals: totals, merkleRoot: ROOT});
        market.settleWithProof(abi.encode(vals), hex"01");
    }

    function test_proveForesight_valid_registersCredential() public {
        uint256 id = _settledMarket();

        vm.expectEmit(true, true, false, false);
        emit ForesightProven(id, FORESIGHT_NULLIFIER);
        registry.proveForesight(id, FORESIGHT_NULLIFIER, proof);

        assertTrue(registry.foresightProven(FORESIGHT_NULLIFIER));
        assertEq(registry.foresightCount(id), 1);
    }

    function test_proveForesight_doubleRegisterReverts() public {
        uint256 id = _settledMarket();
        registry.proveForesight(id, FORESIGHT_NULLIFIER, proof);

        vm.expectRevert(ForesightRegistry.AlreadyProven.selector);
        registry.proveForesight(id, FORESIGHT_NULLIFIER, proof);
    }

    function test_proveForesight_revertsIfMarketNotSettled() public {
        // Resolved but not settled: no root yet, so no foresight can be proven.
        uint256 id = market.createMarket(address(feed), THRESHOLD, block.timestamp + 1 days, MAX_STALENESS);
        _deposit(alice, id, COMMITMENT, 1 ether);
        vm.warp(block.timestamp + 1 days);
        feed.updateAnswer(THRESHOLD);
        market.resolveMarket(id);

        vm.expectRevert(ForesightRegistry.MarketNotSettled.selector);
        registry.proveForesight(id, FORESIGHT_NULLIFIER, proof);
    }

    function test_proveForesight_forgedProofReverts() public {
        uint256 id = _settledMarket();

        bytes memory forged = proof;
        forged[100] = bytes1(uint8(forged[100]) ^ 0xff); // flip a byte

        vm.expectRevert();
        registry.proveForesight(id, FORESIGHT_NULLIFIER, forged);
    }

    function test_proveForesight_wrongNullifierReverts() public {
        // A nullifier that isn't the one bound in the proof: public inputs no
        // longer match, so verification fails.
        uint256 id = _settledMarket();

        vm.expectRevert();
        registry.proveForesight(id, bytes32(uint256(FORESIGHT_NULLIFIER) + 1), proof);
    }
}
