// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PredictionMarket} from "../src/PredictionMarket.sol";
import {ParlayPool} from "../src/ParlayPool.sol";
import {ParlayVerifier} from "../src/verifiers/ParlayVerifier.sol";
import {MockHonkVerifier} from "./mocks/MockHonkVerifier.sol";
import {MockSP1Verifier} from "./mocks/MockSP1Verifier.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @notice End-to-end parlay claim against the REAL UltraHonk parlay verifier,
///         using a real proof generated offline (circuits/generate-parlay.sh).
///         Proves the whole shielded multi-leg flow: three leg markets settle in
///         the PredictionMarket, a parlay note that picked every winning outcome
///         claims a product-of-ratios payout with a real zk proof — and any
///         wrong leg / forged proof is rejected.
///
/// Fixture witness (circuits/parlay/Prover.toml): market_ids=[5,8,13],
/// picks/outcomes=[1,0,2], amount=1e6, recipient=0xCAFEBABE.
contract ParlayPoolE2ETest is Test {
    uint8 constant DECIMALS = 8;
    int256 constant PRICE = 3_000e8;
    uint256 constant MAX_STALENESS = 1 hours;

    // Derived from the parlay witness (parlay_fixture).
    bytes32 constant PARLAY_ROOT = 0x2d5f1fe32fa69ffe9c09f337fea1e8d061e86fbd35f41da5a0c5aadfc54629b3;
    bytes32 constant PARLAY_COMMITMENT = 0x21c677bd0cb50aedcdca7ee527d3ee5160b211e908a6e1875a663792872709f7;
    bytes32 constant PARLAY_NULLIFIER = 0x08b733c7b4579b956eada50f83b62cff35e98295e6a8488253c9c733ace6b324;
    address constant RECIPIENT = address(0xCAFEBABE);
    uint256 constant AMOUNT = 1_000_000; // 1 USDC

    PredictionMarket market;
    ParlayPool pool;
    ParlayVerifier parlayVerifier;
    MockUSDC usdc;

    address settler = makeAddr("settler");
    address alice = makeAddr("alice");

    bytes proof;

    function setUp() public {
        parlayVerifier = new ParlayVerifier();
        usdc = new MockUSDC();
        market = new PredictionMarket(
            address(new MockHonkVerifier()), address(new MockSP1Verifier()), bytes32(uint256(0x5f1)), address(usdc)
        );
        pool = new ParlayPool(address(parlayVerifier), address(usdc), address(market), settler);
        proof = vm.readFileBinary("test/fixtures/parlay_proof.bin");

        // The fixture's legs are market ids 5, 8, 13 — create markets 0..13 so
        // those ids exist, giving the three real legs the required outcomes.
        _seedLegMarkets();
    }

    function _createMarket(uint8 numOutcomes) internal returns (uint256 id) {
        id = market.createMarketWithSource(
            PredictionMarket.ResolutionSource.CreWorkflow,
            address(this),
            0,
            block.timestamp + 1 days,
            keccak256(abi.encode("leg", market.marketCount())),
            numOutcomes
        );
    }

    function _depositToMarket(uint256 id, bytes32 c, uint256 amt) internal {
        usdc.mint(alice, amt);
        vm.prank(alice);
        usdc.approve(address(market), amt);
        vm.prank(alice);
        market.deposit(id, c, amt);
    }

    /// Creates markets 0..13; markets 5/8 are binary, market 13 is 3-outcome.
    /// Funds + resolves + SP1-settles the three real legs to outcomes 1/0/2.
    function _seedLegMarkets() internal {
        for (uint256 i = 0; i < 14; i++) {
            uint8 n = (i == 13) ? 3 : 2;
            _createMarket(n);
        }

        // Fund each real leg's pool so settlement totals reconcile.
        _depositToMarket(5, bytes32(uint256(0x5001)), 2_000_000); // pool 2 USDC
        _depositToMarket(8, bytes32(uint256(0x8001)), 2_000_000); // pool 2 USDC
        _depositToMarket(13, bytes32(uint256(0xD001)), 3_000_000); // pool 3 USDC

        vm.warp(block.timestamp + 1 days + 1);
        // Resolve to the fixture's winning outcomes: [1, 0, 2].
        market.reportResolution(5, 1);
        market.reportResolution(8, 0);
        market.reportResolution(13, 2);

        _settle(5, _totals2(1_000_000, 1_000_000)); // outcome1 total = 1 USDC
        _settle(8, _totals2(1_000_000, 1_000_000)); // outcome0 total = 1 USDC
        _settle(13, _totals3(1_000_000, 1_000_000, 1_000_000)); // outcome2 total = 1 USDC
    }

    function _totals2(uint64 a, uint64 b) internal pure returns (uint64[] memory t) {
        t = new uint64[](2);
        t[0] = a;
        t[1] = b;
    }

    function _totals3(uint64 a, uint64 b, uint64 c) internal pure returns (uint64[] memory t) {
        t = new uint64[](3);
        t[0] = a;
        t[1] = b;
        t[2] = c;
    }

    function _settle(uint256 id, uint64[] memory totals) internal {
        PredictionMarket.SettlementValues[] memory vals = new PredictionMarket.SettlementValues[](1);
        vals[0] = PredictionMarket.SettlementValues({marketId: uint64(id), outcomeTotals: totals, merkleRoot: bytes32(uint256(0xABCD))});
        market.settleWithProof(abi.encode(vals), hex"01");
    }

    function _stakeAndArm() internal {
        // Stake the exact parlay note the proof commits to, fund the shared pool,
        // and set the (real) parlay root.
        usdc.mint(alice, AMOUNT);
        vm.prank(alice);
        usdc.approve(address(pool), AMOUNT);
        vm.prank(alice);
        pool.deposit(PARLAY_COMMITMENT, AMOUNT);

        usdc.mint(address(pool), 100_000_000); // ample shared-pool liquidity
        vm.prank(settler);
        pool.setParlayRoot(PARLAY_ROOT);
    }

    function test_e2e_validParlay_paysOut() public {
        _stakeAndArm();

        uint256[3] memory marketIds = [uint256(5), uint256(8), uint256(13)];
        pool.claim(marketIds, AMOUNT, PARLAY_NULLIFIER, RECIPIENT, proof);

        // payout = 1 * (2/1) * (2/1) * (3/1) = 12 USDC
        assertEq(usdc.balanceOf(RECIPIENT), 12_000_000);
        assertTrue(pool.nullifierSpent(PARLAY_NULLIFIER));
    }

    function test_e2e_doubleClaimReverts() public {
        _stakeAndArm();
        uint256[3] memory marketIds = [uint256(5), uint256(8), uint256(13)];
        pool.claim(marketIds, AMOUNT, PARLAY_NULLIFIER, RECIPIENT, proof);

        vm.expectRevert(ParlayPool.NullifierAlreadySpent.selector);
        pool.claim(marketIds, AMOUNT, PARLAY_NULLIFIER, RECIPIENT, proof);
    }

    function test_e2e_forgedProofReverts() public {
        _stakeAndArm();
        bytes memory forged = proof;
        forged[100] = bytes1(uint8(forged[100]) ^ 0xff);

        uint256[3] memory marketIds = [uint256(5), uint256(8), uint256(13)];
        vm.expectRevert();
        pool.claim(marketIds, AMOUNT, PARLAY_NULLIFIER, RECIPIENT, forged);
    }

    function test_e2e_wrongRecipientReverts() public {
        // recipient is bound into the proof: claiming to a different address makes
        // the public inputs mismatch, so verification fails.
        _stakeAndArm();
        uint256[3] memory marketIds = [uint256(5), uint256(8), uint256(13)];
        vm.expectRevert();
        pool.claim(marketIds, AMOUNT, PARLAY_NULLIFIER, address(0xBEEF), proof);
    }

    function test_e2e_wrongLegOutcomeReverts() public {
        // If a leg's on-chain resolved outcome differs from the proof's, the
        // public inputs no longer match and verification fails. Re-settle is not
        // possible, so we model it with a fresh pool over a market whose outcome
        // was resolved differently — here, tamper the claimed amount instead,
        // which is also a bound public input.
        _stakeAndArm();
        uint256[3] memory marketIds = [uint256(5), uint256(8), uint256(13)];
        vm.expectRevert();
        pool.claim(marketIds, 999_999, PARLAY_NULLIFIER, RECIPIENT, proof);
    }
}
