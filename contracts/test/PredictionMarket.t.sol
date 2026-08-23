// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockV3Aggregator} from "@chainlink/contracts/src/v0.8/tests/MockV3Aggregator.sol";
import {PredictionMarket} from "../src/PredictionMarket.sol";

contract PredictionMarketTest is Test {
    uint8 constant DECIMALS = 8;
    int256 constant INITIAL_PRICE = 3_000e8; // $3000
    uint256 constant MAX_STALENESS = 1 hours;

    PredictionMarket market;
    MockV3Aggregator feed;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    function setUp() public {
        market = new PredictionMarket();
        feed = new MockV3Aggregator(DECIMALS, INITIAL_PRICE);

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
    }

    function _createMarket(int256 threshold, uint256 resolveAfter) internal returns (uint256) {
        return market.createMarket(address(feed), threshold, resolveAfter, MAX_STALENESS);
    }

    function test_createMarket_incrementsId() public {
        uint256 id0 = _createMarket(3_000e8, block.timestamp + 1 days);
        uint256 id1 = _createMarket(4_000e8, block.timestamp + 1 days);
        assertEq(id0, 0);
        assertEq(id1, 1);
        assertEq(market.marketCount(), 2);
    }

    function test_takePosition_tracksAmountsPerSide() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);

        vm.prank(alice);
        market.takePosition{value: 1 ether}(id, PredictionMarket.Side.Yes);

        vm.prank(bob);
        market.takePosition{value: 2 ether}(id, PredictionMarket.Side.No);

        (,,,,, PredictionMarket.Side winningSide, uint256 totalYes, uint256 totalNo) = market.markets(id);
        winningSide; // silence unused warning for tuple field before resolution
        assertEq(totalYes, 1 ether);
        assertEq(totalNo, 2 ether);
    }

    function test_takePosition_revertsOnZeroValue() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        vm.prank(alice);
        vm.expectRevert(PredictionMarket.ZeroAmount.selector);
        market.takePosition{value: 0}(id, PredictionMarket.Side.Yes);
    }

    function test_takePosition_revertsAfterResolution() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        _resolve(id);

        vm.prank(alice);
        vm.expectRevert(PredictionMarket.MarketNotOpen.selector);
        market.takePosition{value: 1 ether}(id, PredictionMarket.Side.Yes);
    }

    function test_resolveMarket_revertsBeforeResolveAfter() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        vm.expectRevert(PredictionMarket.MarketNotResolvable.selector);
        market.resolveMarket(id);
    }

    function test_resolveMarket_revertsOnStalePrice() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        vm.warp(block.timestamp + 1 days + MAX_STALENESS + 1);
        // feed's updatedAt is still "now" at deploy time, so warp far enough
        // past resolveAfter + staleness window without refreshing the feed.
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

    function test_claim_paysProportionalPariMutuelPayout() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);

        vm.prank(alice);
        market.takePosition{value: 1 ether}(id, PredictionMarket.Side.Yes);
        vm.prank(bob);
        market.takePosition{value: 1 ether}(id, PredictionMarket.Side.Yes);
        vm.prank(carol);
        market.takePosition{value: 2 ether}(id, PredictionMarket.Side.No);

        _resolve(id); // price stays >= 3000e8 -> Yes wins

        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        market.claim(id);
        // total pool = 4 ether, total winning (Yes) = 2 ether, alice staked 1 ether
        // payout = 1 * 4 / 2 = 2 ether
        assertEq(alice.balance - aliceBefore, 2 ether);
    }

    function test_claim_revertsForLosingPosition() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);

        vm.prank(carol);
        market.takePosition{value: 1 ether}(id, PredictionMarket.Side.No);
        vm.prank(alice);
        market.takePosition{value: 1 ether}(id, PredictionMarket.Side.Yes);

        _resolve(id); // Yes wins

        vm.prank(carol);
        vm.expectRevert(PredictionMarket.NoWinningPosition.selector);
        market.claim(id);
    }

    function test_claim_revertsOnDoubleClaim() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        vm.prank(alice);
        market.takePosition{value: 1 ether}(id, PredictionMarket.Side.Yes);
        _resolve(id);

        vm.prank(alice);
        market.claim(id);

        vm.prank(alice);
        vm.expectRevert(PredictionMarket.AlreadyClaimed.selector);
        market.claim(id);
    }

    function test_claim_revertsBeforeResolution() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        vm.prank(alice);
        market.takePosition{value: 1 ether}(id, PredictionMarket.Side.Yes);

        vm.prank(alice);
        vm.expectRevert(PredictionMarket.MarketNotResolved.selector);
        market.claim(id);
    }

    /// @dev Fuzzes stake sizes across two winning bettors and asserts the pool is
    ///      never over- or under-paid: sum of payouts <= total pool.
    function testFuzz_claim_neverExceedsPool(uint96 aliceStake, uint96 bobStake, uint96 carolStake) public {
        aliceStake = uint96(bound(aliceStake, 1, 50 ether));
        bobStake = uint96(bound(bobStake, 1, 50 ether));
        carolStake = uint96(bound(carolStake, 1, 50 ether));

        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);

        vm.prank(alice);
        market.takePosition{value: aliceStake}(id, PredictionMarket.Side.Yes);
        vm.prank(bob);
        market.takePosition{value: bobStake}(id, PredictionMarket.Side.Yes);
        vm.prank(carol);
        market.takePosition{value: carolStake}(id, PredictionMarket.Side.No);

        _resolve(id); // Yes wins

        uint256 totalPool = uint256(aliceStake) + bobStake + carolStake;

        uint256 aliceBefore = alice.balance;
        uint256 bobBefore = bob.balance;

        vm.prank(alice);
        market.claim(id);
        vm.prank(bob);
        market.claim(id);

        uint256 alicePayout = alice.balance - aliceBefore;
        uint256 bobPayout = bob.balance - bobBefore;

        assertLe(alicePayout + bobPayout, totalPool);
    }

    function _resolve(uint256 id) internal {
        vm.warp(block.timestamp + 1 days);
        feed.updateAnswer(INITIAL_PRICE);
        market.resolveMarket(id);
    }
}
