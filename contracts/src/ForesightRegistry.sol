// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PredictionMarket} from "./PredictionMarket.sol";

/// @notice Minimal interface to the generated foresight UltraHonk verifier
///         (`contracts/src/verifiers/ForesightVerifier.sol`).
interface IForesightHonkVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}

/// @title ForesightRegistry — anonymous, verifiable forecasting track records.
/// @notice "Proof of Foresight": after a market settles, anyone holding a note
///         that backed the winning outcome can prove — in zero knowledge —
///         "I called this correctly", without revealing which deposit it was,
///         how much they staked, or their identity. Each correct call registers
///         a domain-separated *foresight nullifier* exactly once, building an
///         anonymous credential set that the reputation layer (and the
///         "pros-only" markets) build on.
///
/// @dev This is a standalone accountability layer over `PredictionMarket`: it
///      reads a market's settled commitments root + winning outcome and checks
///      a foresight proof against them. It never moves funds and has no owner.
///      The foresight nullifier is derived from the note's `nullifier_secret`
///      with a distinct domain from the spend nullifier, so a foresight
///      credential is unlinkable to the note's payout claim.
contract ForesightRegistry {
    PredictionMarket public immutable market;
    IForesightHonkVerifier public immutable verifier;

    /// A foresight credential is registered once, keyed by its nullifier.
    mapping(bytes32 foresightNullifier => bool proven) public foresightProven;
    /// Count of registered foresight credentials per market (public analytics;
    /// never reveals who).
    mapping(uint256 marketId => uint256 count) public foresightCount;

    event ForesightProven(uint256 indexed marketId, bytes32 indexed foresightNullifier);

    error MarketNotSettled();
    error AlreadyProven();
    error InvalidProof();

    constructor(address market_, address verifier_) {
        market = PredictionMarket(market_);
        verifier = IForesightHonkVerifier(verifier_);
    }

    /// @notice Proves the caller held a note that backed the winning outcome of
    ///         a settled market, and registers the foresight credential.
    /// @param marketId           The settled market being attested.
    /// @param foresightNullifier The note's foresight nullifier (revealed here,
    ///                           recorded once — cannot be double-counted).
    /// @param proof              UltraHonk proof for the foresight circuit.
    function proveForesight(uint256 marketId, bytes32 foresightNullifier, bytes calldata proof) external {
        (,,,, PredictionMarket.Status status, uint8 winningOutcome,,,, bytes32 merkleRoot) = market.markets(marketId);
        if (status != PredictionMarket.Status.Settled) revert MarketNotSettled();
        if (foresightProven[foresightNullifier]) revert AlreadyProven();

        // Public inputs are built from trusted on-chain state (root, marketId,
        // winningOutcome) plus the caller-supplied nullifier, in the exact order
        // the foresight circuit declares them.
        bytes32[] memory publicInputs = new bytes32[](4);
        publicInputs[0] = merkleRoot;
        publicInputs[1] = bytes32(marketId);
        publicInputs[2] = bytes32(uint256(winningOutcome));
        publicInputs[3] = foresightNullifier;

        if (!verifier.verify(proof, publicInputs)) revert InvalidProof();

        foresightProven[foresightNullifier] = true;
        foresightCount[marketId] += 1;

        emit ForesightProven(marketId, foresightNullifier);
    }
}
