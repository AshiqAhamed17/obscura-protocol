// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockV3Aggregator} from "@chainlink/contracts/src/v0.8/tests/MockV3Aggregator.sol";
import {PredictionMarket} from "../src/PredictionMarket.sol";

contract PredictionMarketTest is Test {
    uint8 constant DECIMALS = 8;
    int256 constant INITIAL_PRICE = 3_000e8; // $3000
    uint256 constant MAX_STALENESS = 1 hours;

    uint256 constant FIELD_MODULUS =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    PredictionMarket market;
    MockV3Aggregator feed;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    event Deposit(uint256 indexed marketId, bytes32 indexed commitment, uint256 leafIndex, uint256 amount);

    function setUp() public {
        market = new PredictionMarket();
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

        (,,,,,, uint256 totalPool, uint256 depositCount) = market.markets(id);
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

        (,,,,,, uint256 totalPool, uint256 depositCount) = market.markets(id);
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

        (,,,, PredictionMarket.Status status, PredictionMarket.Side winningSide,,) = market.markets(id);
        assertEq(uint8(status), uint8(PredictionMarket.Status.Resolved));
        assertEq(uint8(winningSide), uint8(PredictionMarket.Side.Yes));
    }

    function test_resolveMarket_noWinsWhenPriceBelowThreshold() public {
        uint256 id = _createMarket(4_000e8, block.timestamp + 1 days);
        _resolve(id);

        (,,,,, PredictionMarket.Side winningSide,,) = market.markets(id);
        assertEq(uint8(winningSide), uint8(PredictionMarket.Side.No));
    }

    function test_resolveMarket_revertsIfAlreadyResolved() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        _resolve(id);
        vm.expectRevert(PredictionMarket.MarketNotOpen.selector);
        market.resolveMarket(id);
    }

    function _resolve(uint256 id) internal {
        vm.warp(block.timestamp + 1 days);
        feed.updateAnswer(INITIAL_PRICE);
        market.resolveMarket(id);
    }
}
