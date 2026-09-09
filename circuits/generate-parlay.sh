#!/usr/bin/env bash
# Regenerate the end-to-end parlay proof fixture used by the Foundry test
# (contracts/test/ParlayPoolE2E.t.sol). Requires nargo 1.0.0-beta.25 and bb 5.1.0.
#
# The witness lives in parlay/Prover.toml. Its derived values (parlay_root,
# nullifier) come from the parlay_fixture helper — if you change the witness,
# re-run this whole script so Prover.toml, the proof, and the test constants
# stay in sync.
set -euo pipefail
cd "$(dirname "$0")"

echo "==> computing derived values (commitment, nullifier, root)"
echo "    (copy these into parlay/Prover.toml if you changed the witness)"
nargo execute --package parlay_fixture | tail -1

echo "==> executing parlay witness"
nargo execute --package parlay >/dev/null

echo "==> proving (ultra_honk / keccak)"
bb prove --scheme ultra_honk --oracle_hash keccak \
  -b ./target/parlay.json -w ./target/parlay.gz -o ./target >/dev/null

echo "==> verifying off-chain"
bb verify --scheme ultra_honk --oracle_hash keccak \
  -k ./target/vk -p ./target/proof -i ./target/public_inputs

echo "==> copying fixtures into contracts/test/fixtures/"
mkdir -p ../contracts/test/fixtures
cp ./target/proof ../contracts/test/fixtures/parlay_proof.bin
cp ./target/public_inputs ../contracts/test/fixtures/parlay_public_inputs.bin

echo "==> done. Public inputs (10 x 32 bytes), in order:"
echo "    [parlay_root, market_ids[3], winning_outcomes[3], amount, nullifier, recipient]"
