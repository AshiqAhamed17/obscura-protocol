// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IHonkVerifier} from "../../src/PredictionMarket.sol";

/// @notice Test double for the UltraHonk verifier. Returns a configurable
///         result so contract-logic paths (payout, nullifier registry, access
///         control) can be tested without generating real proofs. End-to-end
///         tests against the real HonkVerifier with real proof fixtures live in
///         task 1.9.
contract MockHonkVerifier is IHonkVerifier {
    bool public result = true;

    function setResult(bool r) external {
        result = r;
    }

    function verify(bytes calldata, bytes32[] calldata) external view returns (bool) {
        return result;
    }
}
