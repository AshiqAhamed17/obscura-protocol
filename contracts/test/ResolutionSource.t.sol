// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockV3Aggregator} from "@chainlink/contracts/src/v0.8/tests/MockV3Aggregator.sol";
import {PredictionMarket} from "../src/PredictionMarket.sol";
import {MockHonkVerifier} from "./mocks/MockHonkVerifier.sol";
import {MockSP1Verifier} from "./mocks/MockSP1Verifier.sol";

/// Tests for the resolution-source abstraction (Task 1.1): Chainlink-feed,
/// Graph-query, and CRE-workflow markets sharing one contract.
contract ResolutionSourceTest is Test {
    uint8 constant DECIMALS = 8;
    int256 constant INITIAL_PRICE = 3_000e8;
    uint256 constant MAX_STALENESS = 1 hours;

    PredictionMarket market;
    MockV3Aggregator feed;

    address resolver = makeAddr("resolver"); // stand-in for the CRE/DON forwarder
    address stranger = makeAddr("stranger");

    bytes32 constant SOURCE_REF = keccak256("subgraph:QmObscuraDeploymentId");

    event MarketSourceSet(
        uint256 indexed marketId, PredictionMarket.ResolutionSource source, address resolver, bytes32 sourceRef
    );
    event MarketResolved(uint256 indexed marketId, uint8 winningOutcome, int256 resolvedPrice);

    function setUp() public {
        market = new PredictionMarket(
            address(new MockHonkVerifier()), address(new MockSP1Verifier()), bytes32(uint256(0x5f1))
        );
        feed = new MockV3Aggregator(DECIMALS, INITIAL_PRICE);
    }

    // --- default (Chainlink feed) markets record the right source ---

    function test_createMarket_defaultsToChainlinkFeed() public {
        uint256 id = market.createMarket(address(feed), 3_000e8, block.timestamp + 1 days, MAX_STALENESS);
        (PredictionMarket.ResolutionSource source, address r, bytes32 ref) = market.resolutionConfig(id);
        assertEq(uint8(source), uint8(PredictionMarket.ResolutionSource.ChainlinkFeed));
        assertEq(r, address(0));
        assertEq(ref, bytes32(0));
    }

    // --- non-feed markets: creation ---

    function test_createMarketWithSource_graphQuery() public {
        vm.expectEmit(true, false, false, true);
        emit MarketSourceSet(0, PredictionMarket.ResolutionSource.GraphQuery, resolver, SOURCE_REF);
        uint256 id = market.createMarketWithSource(
            PredictionMarket.ResolutionSource.GraphQuery, resolver, 10_000_000e8, block.timestamp + 1 days, SOURCE_REF, 2
        );
        (PredictionMarket.ResolutionSource source, address r, bytes32 ref) = market.resolutionConfig(id);
        assertEq(uint8(source), uint8(PredictionMarket.ResolutionSource.GraphQuery));
        assertEq(r, resolver);
        assertEq(ref, SOURCE_REF);
    }

    function test_createMarketWithSource_rejectsChainlinkSource() public {
        vm.expectRevert(PredictionMarket.WrongResolutionMethod.selector);
        market.createMarketWithSource(
            PredictionMarket.ResolutionSource.ChainlinkFeed, resolver, 0, block.timestamp + 1 days, SOURCE_REF, 2
        );
    }

    function test_createMarketWithSource_rejectsZeroResolver() public {
        vm.expectRevert(PredictionMarket.ZeroResolver.selector);
        market.createMarketWithSource(
            PredictionMarket.ResolutionSource.CreWorkflow, address(0), 0, block.timestamp + 1 days, SOURCE_REF, 2
        );
    }

    // --- non-feed markets: resolution via the registered resolver ---

    function test_reportResolution_byResolver_succeeds() public {
        uint256 id = market.createMarketWithSource(
            PredictionMarket.ResolutionSource.CreWorkflow, resolver, 0, block.timestamp + 1 days, SOURCE_REF, 2
        );
        vm.warp(block.timestamp + 1 days + 1);

        vm.expectEmit(true, false, false, true);
        emit MarketResolved(id, 1, 0);
        vm.prank(resolver);
        market.reportResolution(id, 1);

        (,,,, PredictionMarket.Status status, uint8 winningOutcome,,,,) = market.markets(id);
        assertEq(uint8(status), uint8(PredictionMarket.Status.Resolved));
        assertEq(winningOutcome, 1);
    }

    function test_reportResolution_byStranger_reverts() public {
        uint256 id = market.createMarketWithSource(
            PredictionMarket.ResolutionSource.GraphQuery, resolver, 0, block.timestamp + 1 days, SOURCE_REF, 2
        );
        vm.warp(block.timestamp + 1 days + 1);
        vm.expectRevert(PredictionMarket.NotResolver.selector);
        vm.prank(stranger);
        market.reportResolution(id, 1);
    }

    function test_reportResolution_beforeResolveAfter_reverts() public {
        uint256 id = market.createMarketWithSource(
            PredictionMarket.ResolutionSource.GraphQuery, resolver, 0, block.timestamp + 1 days, SOURCE_REF, 2
        );
        vm.expectRevert(PredictionMarket.MarketNotResolvable.selector);
        vm.prank(resolver);
        market.reportResolution(id, 1);
    }

    // --- cross-method guards ---

    function test_resolveMarket_onNonFeedMarket_reverts() public {
        uint256 id = market.createMarketWithSource(
            PredictionMarket.ResolutionSource.GraphQuery, resolver, 0, block.timestamp + 1 days, SOURCE_REF, 2
        );
        vm.warp(block.timestamp + 1 days + 1);
        vm.expectRevert(PredictionMarket.WrongResolutionMethod.selector);
        market.resolveMarket(id);
    }

    function test_reportResolution_onFeedMarket_reverts() public {
        uint256 id = market.createMarket(address(feed), 3_000e8, block.timestamp + 1 days, MAX_STALENESS);
        vm.warp(block.timestamp + 1 days + 1);
        vm.expectRevert(PredictionMarket.WrongResolutionMethod.selector);
        vm.prank(resolver);
        market.reportResolution(id, 1);
    }
}
