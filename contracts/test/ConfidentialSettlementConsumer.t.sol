// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockV3Aggregator} from "@chainlink/contracts/src/v0.8/tests/MockV3Aggregator.sol";
import {PredictionMarket} from "../src/PredictionMarket.sol";
import {ConfidentialSettlementConsumer, IReceiver, IERC165} from "../src/ConfidentialSettlementConsumer.sol";
import {MockHonkVerifier} from "./mocks/MockHonkVerifier.sol";
import {MockSP1Verifier} from "./mocks/MockSP1Verifier.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @notice Tests the confidential-settlement consumer: DON-report intake,
///         forwarder access control, and reconciliation of the confidential
///         (CRE TEE) aggregates against the SP1-verified on-chain totals.
contract ConfidentialSettlementConsumerTest is Test {
    uint8 constant DECIMALS = 8;
    int256 constant INITIAL_PRICE = 3_000e8;
    uint256 constant MAX_STALENESS = 1 hours;

    PredictionMarket market;
    ConfidentialSettlementConsumer consumer;
    MockV3Aggregator feed;
    MockHonkVerifier verifier;
    MockSP1Verifier sp1Verifier;
    MockUSDC usdc;

    address forwarder = makeAddr("keystoneForwarder");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    event ConfidentialSettlementReported(uint256 indexed marketId, bool solvent, uint256[] outcomeTotals);
    event ConfidentialSettlementReconciled(uint256 indexed marketId, bool matchesOnChain);

    function setUp() public {
        verifier = new MockHonkVerifier();
        sp1Verifier = new MockSP1Verifier();
        usdc = new MockUSDC();
        market = new PredictionMarket(address(verifier), address(sp1Verifier), bytes32(uint256(0x5f1)), address(usdc));
        consumer = new ConfidentialSettlementConsumer(forwarder, address(market));
        feed = new MockV3Aggregator(DECIMALS, INITIAL_PRICE);
    }

    // ── helpers ──

    function _deposit(address from, uint256 id, bytes32 c, uint256 amt) internal {
        usdc.mint(from, amt);
        vm.prank(from);
        usdc.approve(address(market), amt);
        vm.prank(from);
        market.deposit(id, c, amt);
    }

    /// Creates a binary market, deposits 1+1, resolves Yes, and SP1-settles it
    /// with a 1/1 split (totals [No=1, Yes=1]).
    function _sp1SettledMarket() internal returns (uint256 id) {
        id = market.createMarket(address(feed), 3_000e8, block.timestamp + 1 days, MAX_STALENESS);
        _deposit(alice, id, bytes32(uint256(111)), 1 ether);
        _deposit(bob, id, bytes32(uint256(222)), 1 ether);
        vm.warp(block.timestamp + 1 days);
        feed.updateAnswer(INITIAL_PRICE);
        market.resolveMarket(id);

        uint64[] memory totals = new uint64[](2);
        totals[0] = 1 ether; // No
        totals[1] = 1 ether; // Yes
        PredictionMarket.SettlementValues[] memory vals = new PredictionMarket.SettlementValues[](1);
        vals[0] = PredictionMarket.SettlementValues({marketId: uint64(id), outcomeTotals: totals, merkleRoot: bytes32(uint256(0xABCD))});
        market.settleWithProof(abi.encode(vals), hex"01");
    }

    function _report(uint64 marketId, uint256[] memory totals, bool solvent) internal pure returns (bytes memory) {
        return abi.encode(marketId, totals, solvent);
    }

    function _totals(uint256 no, uint256 yes) internal pure returns (uint256[] memory t) {
        t = new uint256[](2);
        t[0] = no;
        t[1] = yes;
    }

    // ── access control ──

    function test_onReport_revertsIfNotForwarder() public {
        bytes memory report = _report(0, _totals(1 ether, 1 ether), true);
        vm.expectRevert(abi.encodeWithSelector(ConfidentialSettlementConsumer.UnauthorizedForwarder.selector, address(this)));
        consumer.onReport("", report);
    }

    function test_supportsInterface() public view {
        assertTrue(consumer.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(consumer.supportsInterface(type(IERC165).interfaceId));
        assertFalse(consumer.supportsInterface(0xffffffff));
    }

    // ── report intake ──

    function test_onReport_storesConfidentialAggregates() public {
        uint256[] memory totals = _totals(1 ether, 1 ether);
        bytes memory report = _report(0, totals, true);

        vm.expectEmit(true, false, false, true);
        emit ConfidentialSettlementReported(0, true, totals);
        vm.prank(forwarder);
        consumer.onReport("", report);

        (bool received, bool solvent,,, uint256[] memory stored) = consumer.getConfidentialSettlement(0);
        assertTrue(received);
        assertTrue(solvent);
        assertEq(stored[0], 1 ether);
        assertEq(stored[1], 1 ether);
    }

    // ── reconciliation: confidential vs SP1-verified ──

    function test_reconcile_agreesWhenTotalsMatchOnChain() public {
        uint256 id = _sp1SettledMarket(); // on-chain totals [1e18, 1e18]

        // Confidential report carries the SAME aggregates -> the two legs agree.
        vm.expectEmit(true, false, false, true);
        emit ConfidentialSettlementReconciled(id, true);
        vm.prank(forwarder);
        consumer.onReport("", _report(uint64(id), _totals(1 ether, 1 ether), true));

        (,, bool reconciled, bool matchesOnChain,) = consumer.getConfidentialSettlement(id);
        assertTrue(reconciled);
        assertTrue(matchesOnChain);
    }

    function test_reconcile_flagsMismatchWhenTotalsDiffer() public {
        uint256 id = _sp1SettledMarket(); // on-chain totals [1e18, 1e18]

        // Confidential report disagrees with the SP1-verified totals.
        vm.expectEmit(true, false, false, true);
        emit ConfidentialSettlementReconciled(id, false);
        vm.prank(forwarder);
        consumer.onReport("", _report(uint64(id), _totals(2 ether, 1 ether), true));

        (,, bool reconciled, bool matchesOnChain,) = consumer.getConfidentialSettlement(id);
        assertTrue(reconciled);
        assertFalse(matchesOnChain);
    }

    function test_reconcile_defersUntilMarketIsSP1Settled() public {
        // Market created + resolved but NOT SP1-settled yet.
        uint256 id = market.createMarket(address(feed), 3_000e8, block.timestamp + 1 days, MAX_STALENESS);

        // Confidential report arrives first: stored, but not yet reconciled.
        vm.prank(forwarder);
        consumer.onReport("", _report(uint64(id), _totals(1 ether, 1 ether), true));
        (,, bool reconciledBefore,,) = consumer.getConfidentialSettlement(id);
        assertFalse(reconciledBefore);

        // Now SP1-settle with matching totals, then reconcile.
        _deposit(alice, id, bytes32(uint256(111)), 1 ether);
        _deposit(bob, id, bytes32(uint256(222)), 1 ether);
        vm.warp(block.timestamp + 1 days);
        feed.updateAnswer(INITIAL_PRICE);
        market.resolveMarket(id);
        uint64[] memory totals = new uint64[](2);
        totals[0] = 1 ether;
        totals[1] = 1 ether;
        PredictionMarket.SettlementValues[] memory vals = new PredictionMarket.SettlementValues[](1);
        vals[0] = PredictionMarket.SettlementValues({marketId: uint64(id), outcomeTotals: totals, merkleRoot: bytes32(uint256(0xABCD))});
        market.settleWithProof(abi.encode(vals), hex"01");

        vm.expectEmit(true, false, false, true);
        emit ConfidentialSettlementReconciled(id, true);
        consumer.reconcile(id);

        (,, bool reconciledAfter, bool matchesOnChain,) = consumer.getConfidentialSettlement(id);
        assertTrue(reconciledAfter);
        assertTrue(matchesOnChain);
    }

    function test_reconcile_revertsWithoutConfidentialReport() public {
        vm.expectRevert(ConfidentialSettlementConsumer.NoConfidentialReport.selector);
        consumer.reconcile(0);
    }
}
