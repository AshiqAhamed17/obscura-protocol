// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PredictionMarket} from "./PredictionMarket.sol";

/// @notice ERC-165, probed by the Chainlink KeystoneForwarder before delivery.
interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

/// @notice Minimal CRE consumer interface for receiving DON-signed reports.
interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/// @title CreResolutionConsumer
/// @notice The on-chain resolver for Obscura's **Graph-query / CRE** resolution
///         source — completing the resolution-source trio (ChainlinkFeed ·
///         GraphQuery · CreWorkflow).
///
///         A market created with `SourceType.GraphQuery` (or `CreWorkflow`)
///         cannot be resolved by reading a price feed on-chain, so it names a
///         `resolver` at creation. This contract is that resolver: a CRE workflow
///         queries the Obscura subgraph off-chain, derives the winning outcome
///         from a public metric (e.g. "protocol has ≥ N markets", "TVL > $X"),
///         and the DON delivers the signed result here. `onReport` then calls
///         `PredictionMarket.reportResolution`, landing a **Graph-sourced,
///         DON-signed** outcome on-chain.
///
/// @dev Trust model: the market is resolved by the DON + the pinned off-chain
///      source, never a global admin. This contract has no owner and moves no
///      funds. State honestly: Graph-resolved markets are trust-minimised
///      (they trust the DON + the pinned subgraph deployment), not trustless.
contract CreResolutionConsumer is IReceiver {
    /// KeystoneForwarder authorized to deliver DON reports. Immutable per chain.
    address public immutable forwarder;
    /// The market this resolver resolves.
    PredictionMarket public immutable market;

    /// Provenance handle for the Graph source (e.g. the pinned subgraph
    /// deployment id this resolver is bound to). Informational; emitted for audit.
    bytes32 public immutable sourceRef;

    event ResolutionReported(uint256 indexed marketId, uint8 winningOutcome);

    error UnauthorizedForwarder(address caller);

    constructor(address forwarder_, address market_, bytes32 sourceRef_) {
        forwarder = forwarder_;
        market = PredictionMarket(market_);
        sourceRef = sourceRef_;
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    /// @notice Receives a DON-signed resolution report and applies it on-chain.
    ///         `report` is ABI-encoded exactly as the CRE resolution workflow
    ///         emits it: `(uint64 marketId, uint8 winningOutcome)`.
    /// @dev Reverts (bubbling `PredictionMarket`'s errors) if the market is not a
    ///      resolver-sourced market, is not this contract's to resolve, is past
    ///      its window incorrectly, or the outcome is out of range — the market
    ///      enforces those; this contract only forwards.
    function onReport(bytes calldata, bytes calldata report) external override {
        if (msg.sender != forwarder) revert UnauthorizedForwarder(msg.sender);

        (uint64 marketId, uint8 winningOutcome) = abi.decode(report, (uint64, uint8));

        market.reportResolution(marketId, winningOutcome);

        emit ResolutionReported(marketId, winningOutcome);
    }
}
