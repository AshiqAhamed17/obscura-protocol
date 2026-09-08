// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockV3Aggregator} from "@chainlink/contracts/src/v0.8/tests/MockV3Aggregator.sol";
import {PredictionMarket} from "../src/PredictionMarket.sol";
import {HonkVerifier} from "../src/verifiers/HonkVerifier.sol";
import {MockSP1Verifier} from "./mocks/MockSP1Verifier.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @notice End-to-end test against the REAL UltraHonk verifier using a real
///         proof generated offline (see circuits/generate-fixture.sh). Proves
///         the whole private flow works: deposit → resolve → settle → claim a
///         zk proof → payout, with double-spend and proof-binding negative
///         cases.
///
/// Fixture witness (circuits/claim/Prover.toml):
///   market_id=0, side=Yes, amount=1e18, recipient=0xCAFEBABE,
///   path_indices=[0..], path_siblings=[1..20].
contract PredictionMarketE2ETest is Test {
    uint8 constant DECIMALS = 8;
    int256 constant THRESHOLD = 3_000e8;
    int256 constant PRICE_YES = 3_000e8; // >= threshold -> Yes wins
    uint256 constant MAX_STALENESS = 1 hours;

    // Values from the fixture (must match circuits/claim/Prover.toml and the
    // generated public inputs).
    bytes32 constant ROOT = 0x17caadfb8dac906410d1b4adf67325ce166d73eb47ae5c3dce3e97eb86ac1d95;
    bytes32 constant COMMITMENT = 0x061a4960a702e1605e3442b65b6fe17b3ea6b2ca30d7b6135fe1b00b01535252;
    bytes32 constant NULLIFIER = 0x0d7b4a7191654350afa3eec27d6216350a8a7733f27035403ab7cea34a015e35;
    uint256 constant AMOUNT = 1 ether; // 1e18, matches the proof's amount field
    address constant RECIPIENT = address(0xCAFEBABE);

    PredictionMarket market;
    MockV3Aggregator feed;
    HonkVerifier verifier;
    MockUSDC usdc;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    bytes proof;

    function setUp() public {
        verifier = new HonkVerifier();
        MockSP1Verifier sp1Verifier = new MockSP1Verifier();
        usdc = new MockUSDC();
        market = new PredictionMarket(address(verifier), address(sp1Verifier), bytes32(uint256(0x5f1)), address(usdc));
        feed = new MockV3Aggregator(DECIMALS, PRICE_YES);

        proof = vm.readFileBinary("test/fixtures/claim_proof.bin");
    }

    /// Fund + approve + deposit in USDC (replaces the old payable deposit).
    function _deposit(address from, uint256 id, bytes32 c, uint256 amt) internal {
        usdc.mint(from, amt);
        vm.prank(from);
        usdc.approve(address(market), amt);
        vm.prank(from);
        market.deposit(id, c, amt);
    }

    /// Sets up market 0: the winning note plus one losing deposit (pool = 2e18),
    /// resolved Yes and settled with a 1e18 / 1e18 split.
    function _settledMarket() internal returns (uint256 id) {
        id = market.createMarket(address(feed), THRESHOLD, block.timestamp + 1 days, MAX_STALENESS);
        assertEq(id, 0, "fixture assumes market id 0");

        _deposit(alice, id, COMMITMENT, 1 ether); // the winning note
        _deposit(bob, id, bytes32(uint256(12345)), 1 ether); // a loser

        vm.warp(block.timestamp + 1 days);
        feed.updateAnswer(PRICE_YES);
        market.resolveMarket(id);

        // Settle via the (mock-verified) SP1 proof path: encode the proven
        // totals + root as the proof's public values.
        uint64[] memory totals = new uint64[](2);
        totals[0] = 1 ether; // No
        totals[1] = 1 ether; // Yes
        PredictionMarket.SettlementValues[] memory vals = new PredictionMarket.SettlementValues[](1);
        vals[0] = PredictionMarket.SettlementValues({marketId: uint64(id), outcomeTotals: totals, merkleRoot: ROOT});
        market.settleWithProof(abi.encode(vals), hex"01");
    }

    function test_e2e_validClaim_paysOut() public {
        uint256 id = _settledMarket();

        market.claim(id, AMOUNT, NULLIFIER, RECIPIENT, proof);

        // pool = 2e18, winning total = 1e18, claimed amount = 1e18
        // payout = 1e18 * 2e18 / 1e18 = 2e18
        assertEq(usdc.balanceOf(RECIPIENT), 2 ether);
        assertTrue(market.nullifierSpent(NULLIFIER));
    }

    function test_e2e_doubleClaimReverts() public {
        uint256 id = _settledMarket();

        market.claim(id, AMOUNT, NULLIFIER, RECIPIENT, proof);

        vm.expectRevert(PredictionMarket.NullifierAlreadySpent.selector);
        market.claim(id, AMOUNT, NULLIFIER, RECIPIENT, proof);
    }

    function test_e2e_forgedProofReverts() public {
        uint256 id = _settledMarket();

        bytes memory forged = proof;
        forged[100] = bytes1(uint8(forged[100]) ^ 0xff); // flip a byte

        vm.expectRevert();
        market.claim(id, AMOUNT, NULLIFIER, RECIPIENT, forged);
    }

    function test_e2e_wrongRecipientReverts() public {
        // The recipient is bound into the proof (front-run defense): claiming to
        // any address other than the fixture's recipient makes the public inputs
        // mismatch, so verification fails.
        uint256 id = _settledMarket();

        vm.expectRevert();
        market.claim(id, AMOUNT, NULLIFIER, address(0xBEEF), proof);
    }

    function test_e2e_wrongAmountReverts() public {
        // amount is a bound public input too: claiming a different amount than
        // was proven fails verification.
        uint256 id = _settledMarket();

        vm.expectRevert();
        market.claim(id, 5 ether, NULLIFIER, RECIPIENT, proof);
    }
}
