#!/usr/bin/env bash
# Regenerate the on-chain Solidity verifier for the claim circuit.
#
# The output (contracts/src/verifiers/HonkVerifier.sol) is a GENERATED file —
# re-run this whenever circuits/claim changes. Requires nargo 1.0.0-beta.25
# and bb 5.1.0 (see README.md for install/pins).
#
# Uses UltraHonk with the keccak oracle hash, which is the flavor meant for
# on-chain (Ethereum) verification.
set -euo pipefail

cd "$(dirname "$0")"

OUT="../contracts/src/verifiers/HonkVerifier.sol"

echo "==> compiling claim circuit"
nargo compile --package claim

echo "==> writing verification key (ultra_honk / keccak)"
bb write_vk --scheme ultra_honk --oracle_hash keccak -b ./target/claim.json -o ./target

echo "==> writing Solidity verifier -> $OUT"
mkdir -p ../contracts/src/verifiers
bb write_solidity_verifier --scheme ultra_honk -k ./target/vk -o "$OUT"

echo "==> done. Verifier contract: HonkVerifier (IVerifier.verify(bytes,bytes32[]))"
echo "    Public inputs passed by caller: 6"
echo "    (merkle_root, market_id, winning_side, amount, nullifier, recipient)"
echo "    The 8-field pairing-point object is carried inside the proof, not"
echo "    the publicInputs array (so the contract constant reads 14 = 6 + 8)."
