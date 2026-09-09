// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PredictionMarket} from "../src/PredictionMarket.sol";
import {ParlayPool} from "../src/ParlayPool.sol";
import {MockHonkVerifier} from "./mocks/MockHonkVerifier.sol";
import {MockSP1Verifier} from "./mocks/MockSP1Verifier.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @notice Tests the shielded parlay pool: staking, the ZK claim gate, the
///         product-of-ratios payout, and the solvency cap. The parlay proof
///         itself (all legs won) is enforced by the Noir circuit + the
///         real-proof E2E; here the verifier is mocked, so these tests focus on
///         the on-chain accounting and guards.
contract ParlayPoolTest is Test {
    PredictionMarket market;
    ParlayPool pool;
    MockHonkVerifier parlayVerifier;
    MockSP1Verifier sp1Verifier;
    MockUSDC usdc;

    address settler = makeAddr("settler"); // prod: SP1/DON forwarder
    address alice = makeAddr("alice");
    address carol = makeAddr("carol");

    bytes32 constant PARLAY_ROOT = bytes32(uint256(0x1001));
    bytes32 constant PARLAY_COMMITMENT = bytes32(uint256(0xC0));
    bytes32 constant PARLAY_NULLIFIER = bytes32(uint256(0x111));

    event ParlayClaimed(bytes32 indexed nullifier, address indexed recipient, uint256 payout);

    function setUp() public {
        parlayVerifier = new MockHonkVerifier();
        sp1Verifier = new MockSP1Verifier();
        usdc = new MockUSDC();
        market = new PredictionMarket(address(new MockHonkVerifier()), address(sp1Verifier), bytes32(uint256(0x5f1)), address(usdc));
        pool = new ParlayPool(address(parlayVerifier), address(usdc), address(market), settler);
    }

    // ── helpers ──

    function _depositToMarket(uint256 id, bytes32 c, uint256 amt) internal {
        usdc.mint(alice, amt);
        vm.prank(alice);
        usdc.approve(address(market), amt);
        vm.prank(alice);
        market.deposit(id, c, amt);
    }

    /// Creates a CRE-sourced binary leg market (test contract is resolver),
    /// deposits its pool, resolves it to `winningOutcome`, and SP1-settles it
    /// with totals [total0, total1]. Returns the market id.
    function _settleLeg(uint256 salt, uint8 winningOutcome, uint256 total0, uint256 total1)
        internal
        returns (uint256 id)
    {
        id = market.createMarketWithSource(
            PredictionMarket.ResolutionSource.CreWorkflow,
            address(this),
            0,
            block.timestamp + 1 days,
            keccak256(abi.encode("leg", salt)),
            2
        );
        _depositToMarket(id, bytes32(uint256(0xAA00) + salt), total0 + total1);
        vm.warp(block.timestamp + 1 days + 1);
        market.reportResolution(id, winningOutcome);

        uint64[] memory totals = new uint64[](2);
        totals[0] = uint64(total0);
        totals[1] = uint64(total1);
        PredictionMarket.SettlementValues[] memory vals = new PredictionMarket.SettlementValues[](1);
        vals[0] = PredictionMarket.SettlementValues({marketId: uint64(id), outcomeTotals: totals, merkleRoot: bytes32(uint256(0xABCD))});
        market.settleWithProof(abi.encode(vals), hex"01");
    }

    function _fundPool(uint256 amount) internal {
        // Represents other stakers' USDC held in the shared parlay pool.
        usdc.mint(address(pool), amount);
    }

    function _stakeParlay(bytes32 commitment, uint256 amount) internal {
        usdc.mint(alice, amount);
        vm.prank(alice);
        usdc.approve(address(pool), amount);
        vm.prank(alice);
        pool.deposit(commitment, amount);
    }

    // ── deposit ──

    function test_deposit_escrowsAndAppends() public {
        _stakeParlay(PARLAY_COMMITMENT, 5e6);
        assertEq(pool.totalStaked(), 5e6);
        assertEq(pool.depositCount(), 1);
        assertEq(usdc.balanceOf(address(pool)), 5e6);
        assertEq(pool.getCommitments()[0], PARLAY_COMMITMENT);
    }

    function test_deposit_revertsOnDuplicateCommitment() public {
        _stakeParlay(PARLAY_COMMITMENT, 1e6);
        usdc.mint(alice, 1e6);
        vm.prank(alice);
        usdc.approve(address(pool), 1e6);
        vm.prank(alice);
        vm.expectRevert(ParlayPool.CommitmentAlreadyUsed.selector);
        pool.deposit(PARLAY_COMMITMENT, 1e6);
    }

    // ── setParlayRoot ──

    function test_setParlayRoot_onlySettler() public {
        vm.expectRevert(ParlayPool.NotSettler.selector);
        pool.setParlayRoot(PARLAY_ROOT);

        vm.prank(settler);
        pool.setParlayRoot(PARLAY_ROOT);
        assertEq(pool.parlayRoot(), PARLAY_ROOT);
    }

    // ── claim: product-of-ratios payout ──

    function _threeWinningLegs() internal returns (uint256[3] memory ids) {
        // Each leg: winningOutcome=1, ratio = totalPool / winningTotal = 2.
        ids[0] = _settleLeg(0, 1, 2e6, 2e6); // pool 4, win 2 -> x2
        ids[1] = _settleLeg(1, 1, 3e6, 3e6); // pool 6, win 3 -> x2
        ids[2] = _settleLeg(2, 1, 5e6, 5e6); // pool 10, win 5 -> x2
    }

    function test_claim_paysProductOfRatios() public {
        uint256[3] memory ids = _threeWinningLegs();
        _fundPool(100e6); // ample shared-pool liquidity
        _stakeParlay(PARLAY_COMMITMENT, 1e6);
        vm.prank(settler);
        pool.setParlayRoot(PARLAY_ROOT);

        // payout = 1e6 * 4/2 * 6/3 * 10/5 = 1e6 * 8 = 8e6
        uint256[3] memory marketIds = [ids[0], ids[1], ids[2]];
        vm.expectEmit(true, true, false, true);
        emit ParlayClaimed(PARLAY_NULLIFIER, carol, 8e6);
        pool.claim(marketIds, 1e6, PARLAY_NULLIFIER, carol, hex"01");

        assertEq(usdc.balanceOf(carol), 8e6);
        assertTrue(pool.nullifierSpent(PARLAY_NULLIFIER));
    }

    function test_claim_solvencyCap_limitsToPoolBalance() public {
        uint256[3] memory ids = _threeWinningLegs();
        // Pool holds only the 1 USDC stake — payout of 8e6 is capped to balance.
        _stakeParlay(PARLAY_COMMITMENT, 1e6);
        vm.prank(settler);
        pool.setParlayRoot(PARLAY_ROOT);

        uint256[3] memory marketIds = [ids[0], ids[1], ids[2]];
        pool.claim(marketIds, 1e6, PARLAY_NULLIFIER, carol, hex"01");
        assertEq(usdc.balanceOf(carol), 1e6); // capped at pool balance
    }

    function test_claim_revertsIfRootNotSet() public {
        uint256[3] memory ids = _threeWinningLegs();
        uint256[3] memory marketIds = [ids[0], ids[1], ids[2]];
        vm.expectRevert(ParlayPool.RootNotSet.selector);
        pool.claim(marketIds, 1e6, PARLAY_NULLIFIER, carol, hex"01");
    }

    function test_claim_revertsIfLegNotSettled() public {
        uint256[3] memory ids = _threeWinningLegs();
        // A fresh, unsettled leg replaces one of them.
        uint256 unsettled = market.createMarketWithSource(
            PredictionMarket.ResolutionSource.CreWorkflow, address(this), 0, block.timestamp + 1 days, keccak256("x"), 2
        );
        _stakeParlay(PARLAY_COMMITMENT, 1e6);
        vm.prank(settler);
        pool.setParlayRoot(PARLAY_ROOT);

        uint256[3] memory marketIds = [ids[0], ids[1], unsettled];
        vm.expectRevert(ParlayPool.LegNotSettled.selector);
        pool.claim(marketIds, 1e6, PARLAY_NULLIFIER, carol, hex"01");
    }

    function test_claim_revertsOnInvalidProof() public {
        uint256[3] memory ids = _threeWinningLegs();
        _fundPool(100e6);
        _stakeParlay(PARLAY_COMMITMENT, 1e6);
        vm.prank(settler);
        pool.setParlayRoot(PARLAY_ROOT);

        parlayVerifier.setResult(false); // circuit would reject a losing/forged parlay
        uint256[3] memory marketIds = [ids[0], ids[1], ids[2]];
        vm.expectRevert(ParlayPool.InvalidProof.selector);
        pool.claim(marketIds, 1e6, PARLAY_NULLIFIER, carol, hex"01");
    }

    function test_claim_revertsOnDoubleSpend() public {
        uint256[3] memory ids = _threeWinningLegs();
        _fundPool(100e6);
        _stakeParlay(PARLAY_COMMITMENT, 1e6);
        vm.prank(settler);
        pool.setParlayRoot(PARLAY_ROOT);

        uint256[3] memory marketIds = [ids[0], ids[1], ids[2]];
        pool.claim(marketIds, 1e6, PARLAY_NULLIFIER, carol, hex"01");

        vm.expectRevert(ParlayPool.NullifierAlreadySpent.selector);
        pool.claim(marketIds, 1e6, PARLAY_NULLIFIER, carol, hex"01");
    }
}
