// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockV3Aggregator} from "@chainlink/contracts/src/v0.8/tests/MockV3Aggregator.sol";
import {PredictionMarket} from "../src/PredictionMarket.sol";
import {MockHonkVerifier} from "./mocks/MockHonkVerifier.sol";

contract PredictionMarketTest is Test {
    uint8 constant DECIMALS = 8;
    int256 constant INITIAL_PRICE = 3_000e8; // $3000
    uint256 constant MAX_STALENESS = 1 hours;

    uint256 constant FIELD_MODULUS =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    PredictionMarket market;
    MockV3Aggregator feed;
    MockHonkVerifier verifier;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address stranger = makeAddr("stranger");

    event Deposit(uint256 indexed marketId, bytes32 indexed commitment, uint256 leafIndex, uint256 amount);
    event MarketSettled(uint256 indexed marketId, bytes32 merkleRoot, uint256 totalYes, uint256 totalNo);
    event Claimed(uint256 indexed marketId, bytes32 indexed nullifier, address indexed recipient, uint256 payout);

    function setUp() public {
        verifier = new MockHonkVerifier();
        // The deployer (this test contract) becomes the operator.
        market = new PredictionMarket(address(verifier));
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

        (,,,,,, uint256 totalPool, uint256 depositCount,,,) = market.markets(id);
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

        (,,,,,, uint256 totalPool, uint256 depositCount,,,) = market.markets(id);
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

        (,,,, PredictionMarket.Status status, PredictionMarket.Side winningSide,,,,,) = market.markets(id);
        assertEq(uint8(status), uint8(PredictionMarket.Status.Resolved));
        assertEq(uint8(winningSide), uint8(PredictionMarket.Side.Yes));
    }

    function test_resolveMarket_noWinsWhenPriceBelowThreshold() public {
        uint256 id = _createMarket(4_000e8, block.timestamp + 1 days);
        _resolve(id);

        (,,,,, PredictionMarket.Side winningSide,,,,,) = market.markets(id);
        assertEq(uint8(winningSide), uint8(PredictionMarket.Side.No));
    }

    function test_resolveMarket_revertsIfAlreadyResolved() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        _resolve(id);
        vm.expectRevert(PredictionMarket.MarketNotOpen.selector);
        market.resolveMarket(id);
    }

    // --- settle ---

    function test_settle_setsRootTotalsAndState() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        vm.prank(alice);
        market.deposit{value: 3 ether}(id, _c(111));
        vm.prank(bob);
        market.deposit{value: 1 ether}(id, _c(222));
        _resolve(id);

        vm.expectEmit(true, false, false, true);
        emit MarketSettled(id, _c(999), 2 ether, 2 ether);
        market.settle(id, _c(999), 2 ether, 2 ether);

        (,,,, PredictionMarket.Status status,,,, bytes32 root, uint256 ty, uint256 tn) = market.markets(id);
        assertEq(uint8(status), uint8(PredictionMarket.Status.Settled));
        assertEq(root, _c(999));
        assertEq(ty, 2 ether);
        assertEq(tn, 2 ether);
    }

    function test_settle_revertsForNonOperator() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        vm.prank(alice);
        market.deposit{value: 4 ether}(id, _c(111));
        _resolve(id);

        vm.prank(stranger);
        vm.expectRevert(PredictionMarket.NotOperator.selector);
        market.settle(id, _c(999), 4 ether, 0);
    }

    function test_settle_revertsBeforeResolution() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        vm.prank(alice);
        market.deposit{value: 4 ether}(id, _c(111));

        vm.expectRevert(PredictionMarket.MarketNotResolved.selector);
        market.settle(id, _c(999), 4 ether, 0);
    }

    function test_settle_revertsOnTotalsMismatch() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        vm.prank(alice);
        market.deposit{value: 4 ether}(id, _c(111));
        _resolve(id);

        vm.expectRevert(PredictionMarket.TotalsMismatch.selector);
        market.settle(id, _c(999), 2 ether, 1 ether); // 3 != 4
    }

    // --- claim ---

    /// Deposits 4 ETH, resolves Yes, settles with a 2/2 Yes/No split.
    function _settledYesMarket() internal returns (uint256 id) {
        id = _createMarket(3_000e8, block.timestamp + 1 days);
        vm.prank(alice);
        market.deposit{value: 2 ether}(id, _c(111));
        vm.prank(bob);
        market.deposit{value: 2 ether}(id, _c(222));
        _resolve(id); // price == threshold -> Yes wins
        market.settle(id, _c(999), 2 ether, 2 ether);
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

    function test_claim_revertsOnDoubleSpend() public {
        uint256 id = _settledYesMarket();

        market.claim(id, 1 ether, _c(555), carol, hex"01");

        vm.expectRevert(PredictionMarket.NullifierAlreadySpent.selector);
        market.claim(id, 1 ether, _c(555), carol, hex"01");
    }

    function test_claim_revertsWhenNoWinningStake() public {
        // Market resolves Yes but the operator reports zero Yes stake.
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        vm.prank(alice);
        market.deposit{value: 4 ether}(id, _c(111));
        _resolve(id); // Yes wins
        market.settle(id, _c(999), 0, 4 ether); // totalYes = 0

        vm.expectRevert(PredictionMarket.NoWinningStake.selector);
        market.claim(id, 1 ether, _c(555), carol, hex"01");
    }

    function _resolve(uint256 id) internal {
        vm.warp(block.timestamp + 1 days);
        feed.updateAnswer(INITIAL_PRICE);
        market.resolveMarket(id);
    }
}
