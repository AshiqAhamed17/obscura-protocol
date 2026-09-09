// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PredictionMarket} from "../src/PredictionMarket.sol";
import {CreResolutionConsumer, IReceiver, IERC165} from "../src/CreResolutionConsumer.sol";
import {MockHonkVerifier} from "./mocks/MockHonkVerifier.sol";
import {MockSP1Verifier} from "./mocks/MockSP1Verifier.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @notice Tests the CRE Graph-query resolver: a DON-signed report delivered by
///         the KeystoneForwarder resolves a GraphQuery-sourced market on-chain.
contract CreResolutionConsumerTest is Test {
    bytes32 constant SOURCE_REF = keccak256("subgraph:QmRVbZNT9mDmJxez7VnhARRgF52nfdTy8KjoiJQmGmYcf3");

    PredictionMarket market;
    CreResolutionConsumer consumer;
    MockUSDC usdc;

    address forwarder = makeAddr("keystoneForwarder");
    address stranger = makeAddr("stranger");

    event ResolutionReported(uint256 indexed marketId, uint8 winningOutcome);
    event MarketResolved(uint256 indexed marketId, uint8 winningOutcome, int256 resolvedPrice);

    function setUp() public {
        usdc = new MockUSDC();
        market = new PredictionMarket(
            address(new MockHonkVerifier()), address(new MockSP1Verifier()), bytes32(uint256(0x5f1)), address(usdc)
        );
        consumer = new CreResolutionConsumer(forwarder, address(market), SOURCE_REF);
    }

    /// Creates a GraphQuery-sourced binary market whose resolver is the consumer.
    function _graphMarket() internal returns (uint256 id) {
        id = market.createMarketWithSource(
            PredictionMarket.ResolutionSource.GraphQuery,
            address(consumer),
            0,
            block.timestamp + 1 days,
            SOURCE_REF,
            2
        );
    }

    function _report(uint64 marketId, uint8 outcome) internal pure returns (bytes memory) {
        return abi.encode(marketId, outcome);
    }

    function test_supportsInterface() public view {
        assertTrue(consumer.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(consumer.supportsInterface(type(IERC165).interfaceId));
    }

    function test_onReport_resolvesGraphMarket() public {
        uint256 id = _graphMarket();
        vm.warp(block.timestamp + 1 days + 1);

        // The DON report resolves the market to outcome 1 (Yes).
        vm.expectEmit(true, false, false, true);
        emit MarketResolved(id, 1, 0);
        vm.expectEmit(true, false, false, true);
        emit ResolutionReported(id, 1);
        vm.prank(forwarder);
        consumer.onReport("", _report(uint64(id), 1));

        (,,,, PredictionMarket.Status status, uint8 winningOutcome,,,,) = market.markets(id);
        assertEq(uint8(status), uint8(PredictionMarket.Status.Resolved));
        assertEq(winningOutcome, 1);
    }

    function test_onReport_revertsIfNotForwarder() public {
        uint256 id = _graphMarket();
        vm.warp(block.timestamp + 1 days + 1);

        vm.expectRevert(abi.encodeWithSelector(CreResolutionConsumer.UnauthorizedForwarder.selector, stranger));
        vm.prank(stranger);
        consumer.onReport("", _report(uint64(id), 1));
    }

    function test_onReport_revertsBeforeResolveWindow() public {
        uint256 id = _graphMarket(); // resolveAfter = now + 1 day, not yet reached

        // The market enforces the window; the consumer forwards the revert.
        vm.expectRevert(PredictionMarket.MarketNotResolvable.selector);
        vm.prank(forwarder);
        consumer.onReport("", _report(uint64(id), 1));
    }

    function test_onReport_revertsOnOutcomeOutOfRange() public {
        uint256 id = _graphMarket(); // binary market: valid outcomes are 0,1
        vm.warp(block.timestamp + 1 days + 1);

        vm.expectRevert(PredictionMarket.OutcomeOutOfRange.selector);
        vm.prank(forwarder);
        consumer.onReport("", _report(uint64(id), 2));
    }

    function test_onReport_wrongResolverIsRejectedByMarket() public {
        // A market whose resolver is someone else: the market rejects a report
        // routed through this consumer (defense in depth — the consumer is not
        // the registered resolver).
        uint256 id = market.createMarketWithSource(
            PredictionMarket.ResolutionSource.GraphQuery, stranger, 0, block.timestamp + 1 days, SOURCE_REF, 2
        );
        vm.warp(block.timestamp + 1 days + 1);

        vm.expectRevert(PredictionMarket.NotResolver.selector);
        vm.prank(forwarder);
        consumer.onReport("", _report(uint64(id), 1));
    }
}
