// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockV3Aggregator} from "@chainlink/contracts/src/v0.8/tests/MockV3Aggregator.sol";
import {PredictionMarket} from "../src/PredictionMarket.sol";
import {AutoResolver} from "../src/AutoResolver.sol";
import {MockHonkVerifier} from "./mocks/MockHonkVerifier.sol";
import {MockSP1Verifier} from "./mocks/MockSP1Verifier.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract AutoResolverTest is Test {
    uint8 constant DECIMALS = 8;
    int256 constant INITIAL_PRICE = 3_000e8;
    uint256 constant MAX_STALENESS = 1 hours;
    bytes32 constant PROGRAM_VKEY = bytes32(uint256(0x5f1));

    PredictionMarket market;
    AutoResolver resolver;
    MockV3Aggregator feed;
    MockHonkVerifier verifier;
    MockSP1Verifier sp1Verifier;
    MockUSDC usdc;

    address settler = makeAddr("settler");

    function setUp() public {
        verifier = new MockHonkVerifier();
        sp1Verifier = new MockSP1Verifier();
        usdc = new MockUSDC();
        market = new PredictionMarket(address(verifier), address(sp1Verifier), PROGRAM_VKEY, address(usdc));
        feed = new MockV3Aggregator(DECIMALS, INITIAL_PRICE);
        resolver = new AutoResolver(address(market));
    }

    function _feedMarket(uint256 resolveAfter) internal returns (uint256) {
        return market.createMarket(address(feed), 3_000e8, resolveAfter, MAX_STALENESS);
    }

    function _status(uint256 id) internal view returns (PredictionMarket.Status s) {
        (,,,, s,,,,,) = market.markets(id);
    }

    // --- checkUpkeep ---

    function test_checkUpkeep_falseBeforeDeadline() public {
        _feedMarket(block.timestamp + 1 days);
        (bool needed,) = resolver.checkUpkeep("");
        assertFalse(needed);
    }

    function test_checkUpkeep_trueWhenDue() public {
        uint256 id = _feedMarket(block.timestamp + 1 hours);
        vm.warp(block.timestamp + 2 hours); // past the deadline
        feed.updateAnswer(INITIAL_PRICE); // Chainlink feed stays live/fresh
        (bool needed, bytes memory data) = resolver.checkUpkeep("");
        assertTrue(needed);
        assertEq(abi.decode(data, (uint256)), id);
    }

    function test_checkUpkeep_falseWhenFeedStale() public {
        _feedMarket(block.timestamp + 1 hours);
        vm.warp(block.timestamp + 2 hours); // past deadline, but feed is now stale
        (bool needed,) = resolver.checkUpkeep("");
        assertFalse(needed); // won't fire a call that resolveMarket would revert
    }

    function test_checkUpkeep_skipsNonFeedMarkets() public {
        // A CRE/event market is past its deadline but is NOT auto-resolvable here.
        market.createMarketWithSource(
            PredictionMarket.ResolutionSource.CreWorkflow, address(this), 0, block.timestamp + 1 hours, bytes32("x"), 3
        );
        vm.warp(block.timestamp + 2 hours);
        (bool needed,) = resolver.checkUpkeep("");
        assertFalse(needed);
    }

    function test_checkUpkeep_falseAfterResolved() public {
        _feedMarket(block.timestamp + 1 hours);
        vm.warp(block.timestamp + 2 hours);
        feed.updateAnswer(INITIAL_PRICE);
        resolver.performUpkeep(abi.encode(uint256(0)));
        (bool needed,) = resolver.checkUpkeep("");
        assertFalse(needed); // nothing left to do
    }

    // --- performUpkeep ---

    function test_performUpkeep_resolvesDueMarket() public {
        uint256 id = _feedMarket(block.timestamp + 1 hours);
        vm.warp(block.timestamp + 2 hours);
        feed.updateAnswer(INITIAL_PRICE);

        assertEq(uint256(_status(id)), uint256(PredictionMarket.Status.Open));
        resolver.performUpkeep(abi.encode(id));
        assertEq(uint256(_status(id)), uint256(PredictionMarket.Status.Resolved));
    }

    function test_performUpkeep_revertsIfNotDue() public {
        uint256 id = _feedMarket(block.timestamp + 1 days); // not past deadline
        vm.expectRevert(bytes("AutoResolver: not resolvable"));
        resolver.performUpkeep(abi.encode(id));
    }

    // --- resolveDue (CRE cron entry point) ---

    function test_resolveDue_resolvesAllDueMarkets() public {
        uint256 a = _feedMarket(block.timestamp + 1 hours);
        uint256 b = _feedMarket(block.timestamp + 1 hours);
        _feedMarket(block.timestamp + 10 days); // not due yet
        vm.warp(block.timestamp + 2 hours);
        feed.updateAnswer(INITIAL_PRICE);

        uint256 resolved = resolver.resolveDue();
        assertEq(resolved, 2);
        assertEq(uint256(_status(a)), uint256(PredictionMarket.Status.Resolved));
        assertEq(uint256(_status(b)), uint256(PredictionMarket.Status.Resolved));
        assertEq(uint256(_status(2)), uint256(PredictionMarket.Status.Open)); // far-future market untouched
    }

    function test_resolveDue_noopWhenNothingDue() public {
        _feedMarket(block.timestamp + 1 days);
        assertEq(resolver.resolveDue(), 0);
    }

    function test_onReport_resolvesDue() public {
        uint256 id = _feedMarket(block.timestamp + 1 hours);
        vm.warp(block.timestamp + 2 hours);
        feed.updateAnswer(INITIAL_PRICE);
        // A CRE cron workflow delivers a report; content is irrelevant.
        resolver.onReport(hex"", hex"");
        assertEq(uint256(_status(id)), uint256(PredictionMarket.Status.Resolved));
    }

    function test_performUpkeep_revertsIfAlreadyResolved() public {
        uint256 id = _feedMarket(block.timestamp + 1 hours);
        vm.warp(block.timestamp + 2 hours);
        feed.updateAnswer(INITIAL_PRICE);
        resolver.performUpkeep(abi.encode(id));
        // second call must revert — market is no longer Open
        vm.expectRevert(bytes("AutoResolver: not resolvable"));
        resolver.performUpkeep(abi.encode(id));
    }
}
