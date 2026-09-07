#!/usr/bin/env bash
# Regenerate the on-chain Solidity verifier AND the proof fixture for the
# foresight circuit (Proof of Foresight). Outputs are GENERATED files:
#   ../contracts/src/verifiers/ForesightVerifier.sol
#   ../contracts/test/fixtures/foresight_proof.bin
#   ../contracts/test/fixtures/foresight_public_inputs.bin
# Re-run whenever circuits/foresight changes. Requires nargo 1.0.0-beta.25 and
# bb 5.1.0. Uses UltraHonk with the keccak oracle hash (on-chain flavor).
set -euo pipefail
cd "$(dirname "$0")"

OUT="../contracts/src/verifiers/ForesightVerifier.sol"

echo "==> compiling foresight circuit"
nargo compile --package foresight

echo "==> writing verification key (ultra_honk / keccak)"
bb write_vk --scheme ultra_honk --oracle_hash keccak -b ./target/foresight.json -o ./target

echo "==> writing Solidity verifier -> $OUT"
mkdir -p ../contracts/src/verifiers
bb write_solidity_verifier --scheme ultra_honk -k ./target/vk -o "$OUT"

echo "==> executing foresight witness"
nargo execute --package foresight >/dev/null

echo "==> proving (ultra_honk / keccak)"
bb prove --scheme ultra_honk --oracle_hash keccak \
  -b ./target/foresight.json -w ./target/foresight.gz -o ./target >/dev/null

echo "==> verifying off-chain"
bb verify --scheme ultra_honk --oracle_hash keccak \
  -k ./target/vk -p ./target/proof -i ./target/public_inputs

echo "==> copying fixtures into contracts/test/fixtures/"
mkdir -p ../contracts/test/fixtures
cp ./target/proof ../contracts/test/fixtures/foresight_proof.bin
cp ./target/public_inputs ../contracts/test/fixtures/foresight_public_inputs.bin

echo "==> done. Public inputs (4 x 32 bytes), in order:"
echo "    [merkle_root, market_id, winning_outcome, foresight_nullifier]"
