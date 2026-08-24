// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISP1Verifier} from "../../src/PredictionMarket.sol";

/// @notice Test double for the SP1 verifier. `verifyProof` reverts iff
///         configured to, so the settleWithProof logic (decode + settle) can be
///         tested without generating a real SP1 proof. The real-proof path runs
///         against SP1's deployed verifier via the Succinct Prover Network.
contract MockSP1Verifier is ISP1Verifier {
    bool public shouldReject;

    function setShouldReject(bool r) external {
        shouldReject = r;
    }

    function verifyProof(bytes32, bytes calldata, bytes calldata) external view {
        require(!shouldReject, "SP1: invalid proof");
    }
}
