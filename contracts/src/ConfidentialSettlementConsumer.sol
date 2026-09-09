// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PredictionMarket} from "./PredictionMarket.sol";

/// @notice ERC-165, as the Chainlink KeystoneForwarder probes it before delivery.
interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

/// @notice The minimal contract a CRE consumer must satisfy to receive
///         DON-signed reports from the KeystoneForwarder.
interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/// @title ConfidentialSettlementConsumer
/// @notice On-chain landing pad for Obscura's **confidential** settlement path.
///         The Chainlink CRE Confidential Workflow sums each market's private
///         positions *inside a TEE* and crosses back only the aggregate totals;
///         the DON signs them and the KeystoneForwarder delivers them here via
///         `onReport`. This contract records those confidential aggregates and
///         **reconciles them against the SP1-verified totals** the escrow proved
///         on-chain — the on-chain evidence that Obscura's two settlement legs
///         agree:
///
///           • confidentiality  — the CRE TEE (operators never see positions)
///           • verifiability    — the SP1 proof (`PredictionMarket.settleWithProof`)
///
///         It never moves funds and has no owner. Fund release stays gated by the
///         SP1 proof in `PredictionMarket`; this consumer is the confidential
///         attestation + reconciliation layer beside it.
contract ConfidentialSettlementConsumer is IReceiver {
    /// KeystoneForwarder authorized to deliver DON reports. Immutable per chain.
    address public immutable forwarder;
    /// The market whose SP1-verified totals we reconcile the confidential
    /// aggregates against.
    PredictionMarket public immutable market;

    struct ConfidentialSettlement {
        bool received; // a confidential report has arrived
        bool solvent; // the enclave's solvency verdict
        bool reconciled; // compared against the on-chain SP1 totals
        bool matchesOnChain; // …and they agreed
        uint256[] outcomeTotals; // per-outcome aggregates from the enclave
    }

    mapping(uint256 marketId => ConfidentialSettlement) internal _settlements;

    event ConfidentialSettlementReported(uint256 indexed marketId, bool solvent, uint256[] outcomeTotals);
    event ConfidentialSettlementReconciled(uint256 indexed marketId, bool matchesOnChain);

    error UnauthorizedForwarder(address caller);
    error NoConfidentialReport();

    constructor(address forwarder_, address market_) {
        forwarder = forwarder_;
        market = PredictionMarket(market_);
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    /// @notice Receives a DON-signed confidential settlement report from the
    ///         KeystoneForwarder. `report` is ABI-encoded exactly as the CRE
    ///         workflow emits it: `(uint64 marketId, uint256[] outcomeTotals,
    ///         bool solvent)` — only aggregates, never a single position.
    function onReport(bytes calldata, bytes calldata report) external override {
        if (msg.sender != forwarder) revert UnauthorizedForwarder(msg.sender);

        (uint64 marketId, uint256[] memory outcomeTotals, bool solvent) =
            abi.decode(report, (uint64, uint256[], bool));

        ConfidentialSettlement storage s = _settlements[marketId];
        s.received = true;
        s.solvent = solvent;
        s.outcomeTotals = outcomeTotals;

        emit ConfidentialSettlementReported(marketId, solvent, outcomeTotals);

        // If the SP1 proof already settled this market on-chain, reconcile now;
        // otherwise `reconcile()` can be called once it does.
        _tryReconcile(marketId);
    }

    /// @notice Reconciles a market's confidential aggregates against its
    ///         SP1-verified on-chain totals. Callable by anyone once both the
    ///         confidential report has arrived and the market is SP1-settled.
    ///         Emits whether the two independent settlement legs agree.
    function reconcile(uint256 marketId) public {
        ConfidentialSettlement storage s = _settlements[marketId];
        if (!s.received) revert NoConfidentialReport();
        _tryReconcile(marketId);
    }

    function _tryReconcile(uint256 marketId) internal {
        ConfidentialSettlement storage s = _settlements[marketId];

        // getOutcomeTotals is empty until `settleWithProof` (SP1) has run.
        uint256[] memory onchain = market.getOutcomeTotals(marketId);
        if (onchain.length == 0) return; // not SP1-settled yet; reconcile later

        bool matches = onchain.length == s.outcomeTotals.length;
        if (matches) {
            for (uint256 i = 0; i < onchain.length; i++) {
                if (onchain[i] != s.outcomeTotals[i]) {
                    matches = false;
                    break;
                }
            }
        }

        s.reconciled = true;
        s.matchesOnChain = matches;
        emit ConfidentialSettlementReconciled(marketId, matches);
    }

    /// @notice Full confidential-settlement record for a market.
    function getConfidentialSettlement(uint256 marketId)
        external
        view
        returns (bool received, bool solvent, bool reconciled, bool matchesOnChain, uint256[] memory outcomeTotals)
    {
        ConfidentialSettlement storage s = _settlements[marketId];
        return (s.received, s.solvent, s.reconciled, s.matchesOnChain, s.outcomeTotals);
    }
}
