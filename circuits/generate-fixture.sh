#!/usr/bin/env bash
# Regenerate the end-to-end claim proof fixture used by the Foundry tests
# (contracts/test/PredictionMarketE2E.t.sol). Requires nargo 1.0.0-beta.25 and
# bb 5.1.0.
#
# The witness lives in claim/Prover.toml. Its derived values (merkle_root,
# nullifier) are produced by the fixture_gen helper below — if you change the
# witness, re-run this whole script so Prover.toml, the proof, and the test
# constants stay in sync.
set -euo pipefail
cd "$(dirname "$0")"

echo "==> computing derived values (commitment, nullifier, root)"
echo "    (copy these into claim/Prover.toml if you changed the witness)"
nargo execute --package fixture_gen | tail -1

echo "==> executing claim witness"
nargo execute --package claim >/dev/null

echo "==> proving (ultra_honk / keccak)"
bb prove --scheme ultra_honk --oracle_hash keccak \
  -b ./target/claim.json -w ./target/claim.gz -o ./target >/dev/null

echo "==> verifying off-chain"
bb verify --scheme ultra_honk --oracle_hash keccak \
  -k ./target/vk -p ./target/proof -i ./target/public_inputs

echo "==> copying fixtures into contracts/test/fixtures/"
mkdir -p ../contracts/test/fixtures
cp ./target/proof ../contracts/test/fixtures/claim_proof.bin
cp ./target/public_inputs ../contracts/test/fixtures/claim_public_inputs.bin

echo "==> done. Public inputs (6 x 32 bytes), in order:"
echo "    [root, market_id, winning_side, amount, nullifier, recipient]"
