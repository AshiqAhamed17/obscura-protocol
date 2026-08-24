# Obscura circuits (Noir)

Zero-knowledge circuits for Obscura's shielded prediction-market positions.
A trader's position is a private *note*; these circuits let a user prove
facts about their note (it exists, it's unspent, it's on the winning side)
without revealing which note is theirs.

## Layout

```
circuits/
  Nargo.toml        workspace
  lib/              `obscura` library crate — reusable ZK primitives:
    src/note.nr       note format, commitment (1.2), nullifier (1.4)
    src/merkle.nr     Merkle membership proof (1.3)
  claim/            `claim` binary circuit (1.5) — proves the right to a
    src/main.nr       payout: membership + winning side + nullifier
```

The primitives live in a **library** crate so the deposit/claim binaries
share one audited implementation of the commitment, Merkle, and nullifier
logic rather than duplicating it.

## Toolchain (pinned)

These versions are known-good for this project:

| Tool | Version |
|---|---|
| `nargo` / `noirc` | `1.0.0-beta.25` |
| `bb` (Barretenberg) | `5.1.0` |
| `poseidon` lib | `v0.3.0` (git dep, see `lib/Nargo.toml`) |

Install / pin the Noir toolchain:

```bash
# install noirup, then the pinned version
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
noirup --version 1.0.0-beta.25

# install the Barretenberg backend (proving/verifying)
curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/bbup/install | bash
bbup --version 5.1.0
```

## Working with the circuits

```bash
cd circuits

nargo check      # type-check the workspace
nargo test       # run all in-circuit unit tests (#[test] functions)
nargo compile    # compile circuits to ACIR (writes to target/, gitignored)
```

`nargo test` is the primary correctness gate for this directory — every
primitive ships with determinism and negative (`should_fail_with`) tests,
following the pattern from the author's ZK-AfterLife circuits.

## Regenerating the on-chain verifier

`contracts/src/verifiers/HonkVerifier.sol` is generated from the `claim`
circuit. Regenerate it after any change to `claim`:

```bash
./generate-verifier.sh
```

It compiles the circuit, writes an UltraHonk verification key with the
**keccak** oracle hash (the flavor for on-chain verification), and emits the
`HonkVerifier` contract. The generated verifier's `verify(bytes proof,
bytes32[] publicInputs)` expects a **length-5** `publicInputs` array —
`[merkle_root, market_id, winning_side, amount, nullifier]`. The 8-field
pairing-point object is carried inside `proof`, not the public-inputs array
(so the contract's constant reads 13 = 5 + 8).
