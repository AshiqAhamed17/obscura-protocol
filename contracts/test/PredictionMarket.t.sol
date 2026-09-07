// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockV3Aggregator} from "@chainlink/contracts/src/v0.8/tests/MockV3Aggregator.sol";
import {PredictionMarket} from "../src/PredictionMarket.sol";
import {MockHonkVerifier} from "./mocks/MockHonkVerifier.sol";
import {MockSP1Verifier} from "./mocks/MockSP1Verifier.sol";

contract PredictionMarketTest is Test {
    uint8 constant DECIMALS = 8;
    int256 constant INITIAL_PRICE = 3_000e8; // $3000
    uint256 constant MAX_STALENESS = 1 hours;

    uint256 constant FIELD_MODULUS =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    PredictionMarket market;
    MockV3Aggregator feed;
    MockHonkVerifier verifier;
    MockSP1Verifier sp1Verifier;
    bytes32 constant PROGRAM_VKEY = bytes32(uint256(0x5f1));

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    event Deposit(uint256 indexed marketId, bytes32 indexed commitment, uint256 leafIndex, uint256 amount);
    event MarketSettled(uint256 indexed marketId, bytes32 merkleRoot, uint256[] outcomeTotals);
    event Claimed(uint256 indexed marketId, bytes32 indexed nullifier, address indexed recipient, uint256 payout);

    function setUp() public {
        verifier = new MockHonkVerifier();
        sp1Verifier = new MockSP1Verifier();
        // The deployer (this test contract) becomes the operator.
        market = new PredictionMarket(address(verifier), address(sp1Verifier), PROGRAM_VKEY);
        feed = new MockV3Aggregator(DECIMALS, INITIAL_PRICE);

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    function _createMarket(int256 threshold, uint256 resolveAfter) internal returns (uint256) {
        return market.createMarket(address(feed), threshold, resolveAfter, MAX_STALENESS);
    }

    function _c(uint256 v) internal pure returns (bytes32) {
        return bytes32(v);
    }

    // --- createMarket ---

    function test_createMarket_incrementsId() public {
        uint256 id0 = _createMarket(3_000e8, block.timestamp + 1 days);
        uint256 id1 = _createMarket(4_000e8, block.timestamp + 1 days);
        assertEq(id0, 0);
        assertEq(id1, 1);
        assertEq(market.marketCount(), 2);
    }

    // --- deposit / commitments tree ---

    function test_deposit_storesCommitmentAndEscrows() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);

        vm.prank(alice);
        uint256 leafIndex = market.deposit{value: 1 ether}(id, _c(111));

        assertEq(leafIndex, 0);
        assertEq(market.commitmentAt(id, 0), _c(111));
        assertEq(address(market).balance, 1 ether);

        (,,,,,,, uint256 totalPool, uint256 depositCount,) = market.markets(id);
        assertEq(totalPool, 1 ether);
        assertEq(depositCount, 1);
    }

    function test_deposit_emitsEventWithLeafIndex() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);

        vm.expectEmit(true, true, false, true);
        emit Deposit(id, _c(222), 0, 2 ether);

        vm.prank(alice);
        market.deposit{value: 2 ether}(id, _c(222));
    }

    function test_deposit_multiple_appendsLeavesInOrderAndSumsPool() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);

        vm.prank(alice);
        market.deposit{value: 1 ether}(id, _c(111));
        vm.prank(bob);
        market.deposit{value: 3 ether}(id, _c(222));

        bytes32[] memory leaves = market.getCommitments(id);
        assertEq(leaves.length, 2);
        assertEq(leaves[0], _c(111));
        assertEq(leaves[1], _c(222));

        (,,,,,,, uint256 totalPool, uint256 depositCount,) = market.markets(id);
        assertEq(totalPool, 4 ether);
        assertEq(depositCount, 2);
    }

    function test_deposit_revertsOnZeroValue() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        vm.prank(alice);
        vm.expectRevert(PredictionMarket.ZeroAmount.selector);
        market.deposit{value: 0}(id, _c(111));
    }

    function test_deposit_revertsOnOutOfFieldCommitment() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        vm.prank(alice);
        vm.expectRevert(PredictionMarket.CommitmentOutOfField.selector);
        market.deposit{value: 1 ether}(id, bytes32(FIELD_MODULUS));
    }

    function test_deposit_revertsOnDuplicateCommitment() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        vm.prank(alice);
        market.deposit{value: 1 ether}(id, _c(111));

        vm.prank(bob);
        vm.expectRevert(PredictionMarket.CommitmentAlreadyUsed.selector);
        market.deposit{value: 1 ether}(id, _c(111));
    }

    function test_deposit_revertsAfterResolution() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        _resolve(id);

        vm.prank(alice);
        vm.expectRevert(PredictionMarket.MarketNotOpen.selector);
        market.deposit{value: 1 ether}(id, _c(111));
    }

    // --- resolveMarket ---

    function test_resolveMarket_revertsBeforeResolveAfter() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        vm.expectRevert(PredictionMarket.MarketNotResolvable.selector);
        market.resolveMarket(id);
    }

    function test_resolveMarket_revertsOnStalePrice() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        // warp past resolveAfter + staleness window without refreshing the feed
        vm.warp(block.timestamp + 1 days + MAX_STALENESS + 1);
        vm.expectRevert(PredictionMarket.StalePrice.selector);
        market.resolveMarket(id);
    }

    function test_resolveMarket_yesWinsWhenPriceAtOrAboveThreshold() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        _resolve(id);

        (,,,, PredictionMarket.Status status, uint8 winningOutcome,,,,) = market.markets(id);
        assertEq(uint8(status), uint8(PredictionMarket.Status.Resolved));
        assertEq(winningOutcome, 1); // Yes
    }

    function test_resolveMarket_noWinsWhenPriceBelowThreshold() public {
        uint256 id = _createMarket(4_000e8, block.timestamp + 1 days);
        _resolve(id);

        (,,,,, uint8 winningOutcome,,,,) = market.markets(id);
        assertEq(winningOutcome, 0); // No
    }

    function test_resolveMarket_revertsIfAlreadyResolved() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        _resolve(id);
        vm.expectRevert(PredictionMarket.MarketNotOpen.selector);
        market.resolveMarket(id);
    }

    // --- settleWithProof (trustless, SP1-verified) ---

    function _resolvedMarketWithPool(uint256 poolEach) internal returns (uint256 id) {
        id = _createMarket(3_000e8, block.timestamp + 1 days);
        vm.prank(alice);
        market.deposit{value: poolEach}(id, _c(111));
        vm.prank(bob);
        market.deposit{value: poolEach}(id, _c(222));
        _resolve(id);
    }

    /// Binary settlement: outcome 0 = No (`tn`), outcome 1 = Yes (`ty`).
    function _encodeSettlement(uint64 id, uint64 ty, uint64 tn, bytes32 root)
        internal
        pure
        returns (bytes memory)
    {
        uint64[] memory totals = new uint64[](2);
        totals[0] = tn; // No
        totals[1] = ty; // Yes
        PredictionMarket.SettlementValues[] memory vals = new PredictionMarket.SettlementValues[](1);
        vals[0] = PredictionMarket.SettlementValues({marketId: id, outcomeTotals: totals, merkleRoot: root});
        return abi.encode(vals);
    }

    function test_settleWithProof_settlesFromDecodedValues() public {
        uint256 id = _resolvedMarketWithPool(1 ether); // pool = 2 ether
        bytes memory pv = _encodeSettlement(uint64(id), 1 ether, 1 ether, _c(0xABCD));

        uint256[] memory expectedTotals = new uint256[](2);
        expectedTotals[0] = 1 ether; // No
        expectedTotals[1] = 1 ether; // Yes
        vm.expectEmit(true, false, false, true);
        emit MarketSettled(id, _c(0xABCD), expectedTotals);
        market.settleWithProof(pv, hex"01");

        (,,,, PredictionMarket.Status status,,,,, bytes32 root) = market.markets(id);
        assertEq(uint8(status), uint8(PredictionMarket.Status.Settled));
        assertEq(root, _c(0xABCD));
        uint256[] memory totals = market.getOutcomeTotals(id);
        assertEq(totals[1], 1 ether); // Yes
        assertEq(totals[0], 1 ether); // No
    }

    function test_settleWithProof_revertsOnInvalidProof() public {
        uint256 id = _resolvedMarketWithPool(1 ether);
        bytes memory pv = _encodeSettlement(uint64(id), 1 ether, 1 ether, _c(0xABCD));

        sp1Verifier.setShouldReject(true);
        vm.expectRevert(bytes("SP1: invalid proof"));
        market.settleWithProof(pv, hex"01");
    }

    function test_settleWithProof_revertsOnTotalsMismatch() public {
        uint256 id = _resolvedMarketWithPool(1 ether); // pool = 2 ether
        // totals sum to 3 ether, not the escrowed 2 ether
        bytes memory pv = _encodeSettlement(uint64(id), 2 ether, 1 ether, _c(0xABCD));

        vm.expectRevert(PredictionMarket.TotalsMismatch.selector);
        market.settleWithProof(pv, hex"01");
    }

    function test_settleWithProof_revertsIfMarketNotResolved() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        vm.prank(alice);
        market.deposit{value: 2 ether}(id, _c(111));
        // not resolved
        bytes memory pv = _encodeSettlement(uint64(id), 2 ether, 0, _c(0xABCD));

        vm.expectRevert(PredictionMarket.MarketNotResolved.selector);
        market.settleWithProof(pv, hex"01");
    }

    // --- claim ---

    /// Deposits 4 ETH, resolves Yes, settles (via SP1 proof) with a 2/2 split.
    function _settledYesMarket() internal returns (uint256 id) {
        id = _createMarket(3_000e8, block.timestamp + 1 days);
        vm.prank(alice);
        market.deposit{value: 2 ether}(id, _c(111));
        vm.prank(bob);
        market.deposit{value: 2 ether}(id, _c(222));
        _resolve(id); // price == threshold -> Yes wins
        // Trustless settlement: mock SP1 verifier accepts, contract decodes the
        // proven totals + root from the (Solidity-encoded here) public values.
        market.settleWithProof(_encodeSettlement(uint64(id), 2 ether, 2 ether, _c(999)), hex"01");
    }

    function test_claim_paysProportionalPariMutuel() public {
        uint256 id = _settledYesMarket();

        // pool = 4, winning (Yes) total = 2, claimed note amount = 1
        // payout = 1 * 4 / 2 = 2 ether
        vm.expectEmit(true, true, true, true);
        emit Claimed(id, _c(555), carol, 2 ether);
        market.claim(id, 1 ether, _c(555), carol, hex"01");

        assertEq(carol.balance, 2 ether);
        assertTrue(market.nullifierSpent(_c(555)));
    }

    function test_claim_revertsIfNotSettled() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        vm.prank(alice);
        market.deposit{value: 4 ether}(id, _c(111));
        _resolve(id); // resolved but not settled

        vm.expectRevert(PredictionMarket.MarketNotSettled.selector);
        market.claim(id, 1 ether, _c(555), carol, hex"01");
    }

    function test_claim_revertsOnInvalidProof() public {
        uint256 id = _settledYesMarket();
        verifier.setResult(false);

        vm.expectRevert(PredictionMarket.InvalidProof.selector);
        market.claim(id, 1 ether, _c(555), carol, hex"01");
    }

    // --- categorical (multi-outcome) markets ---

    /// A 3-outcome market ("which of 3 drivers wins") settles from proven
    /// per-outcome totals and pays the winning bucket pari-mutuel.
    function test_categorical_threeOutcome_settlesAndPaysWinningBucket() public {
        // This test contract is the registered resolver for the CRE-sourced market.
        uint256 id = market.createMarketWithSource(
            PredictionMarket.ResolutionSource.CreWorkflow,
            address(this),
            0,
            block.timestamp + 1 days,
            keccak256("2026-spanish-gp"),
            3
        );

        // Bets on outcomes 0/1/2 for 1/2/3 ETH — pool = 6 ETH.
        vm.startPrank(alice);
        market.deposit{value: 1 ether}(id, _c(11)); // backed outcome 0
        market.deposit{value: 2 ether}(id, _c(22)); // backed outcome 1
        market.deposit{value: 3 ether}(id, _c(33)); // backed outcome 2
        vm.stopPrank();

        vm.warp(block.timestamp + 1 days + 1);
        market.reportResolution(id, 2); // outcome 2 wins

        uint64[] memory totals = new uint64[](3);
        totals[0] = 1 ether;
        totals[1] = 2 ether;
        totals[2] = 3 ether;
        PredictionMarket.SettlementValues[] memory vals = new PredictionMarket.SettlementValues[](1);
        vals[0] =
            PredictionMarket.SettlementValues({marketId: uint64(id), outcomeTotals: totals, merkleRoot: _c(0xABC)});
        market.settleWithProof(abi.encode(vals), hex"01");

        assertEq(market.getOutcomeTotals(id)[2], 3 ether);

        // Winner on outcome 2 with a 3-ETH note: payout = 3 * 6 / 3 = 6 ETH (the
        // whole pool, since they were the only staker on the winning outcome).
        market.claim(id, 3 ether, _c(77), carol, hex"01");
        assertEq(carol.balance, 6 ether);
    }

    function test_categorical_createRejectsFewerThanTwoOutcomes() public {
        vm.expectRevert(PredictionMarket.BadOutcomeCount.selector);
        market.createMarketWithSource(
            PredictionMarket.ResolutionSource.CreWorkflow,
            address(this),
            0,
            block.timestamp + 1 days,
            keccak256("bad"),
            1
        );
    }

    function test_claim_revertsOnDoubleSpend() public {
        uint256 id = _settledYesMarket();

        market.claim(id, 1 ether, _c(555), carol, hex"01");

        vm.expectRevert(PredictionMarket.NullifierAlreadySpent.selector);
        market.claim(id, 1 ether, _c(555), carol, hex"01");
    }

    function test_claim_revertsWhenNoWinningStake() public {
        // Market resolves Yes but the proven totals have zero Yes stake.
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        vm.prank(alice);
        market.deposit{value: 4 ether}(id, _c(111));
        _resolve(id); // Yes wins
        market.settleWithProof(_encodeSettlement(uint64(id), 0, 4 ether, _c(999)), hex"01");

        vm.expectRevert(PredictionMarket.NoWinningStake.selector);
        market.claim(id, 1 ether, _c(555), carol, hex"01");
    }

    function _resolve(uint256 id) internal {
        vm.warp(block.timestamp + 1 days);
        feed.updateAnswer(INITIAL_PRICE);
        market.resolveMarket(id);
    }
}
