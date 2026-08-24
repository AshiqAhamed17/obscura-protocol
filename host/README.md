# host — Obscura SP1 prover/runner

The "script" side of the SP1 setup: it builds the guest ELF (`../guest`) via
`build.rs`, feeds it a market batch, and executes or proves the batch
settlement + Merkle-root reconstruction.

## Prerequisites

- **SP1 toolchain** — install with `curl -L https://sp1up.succinct.xyz | bash`
  then `sp1up` (provides `cargo prove` and the `succinct` rustup toolchain).
- **protoc** — `brew install protobuf` (sp1-sdk builds protobuf types).
- **PATH** — the rustup shims must precede any Homebrew Rust so `+succinct`
  resolves. If a build reports `could not find specification for target
  riscv...`, prepend the shims:

  ```bash
  export PATH="$HOME/.cargo/bin:$HOME/.sp1/bin:$PATH"
  ```

## Running

```bash
# execute-only (fast, no proof): runs the guest over sample batches and checks
# the committed settlements + Merkle roots match the host-side reference
cargo run --release -p host

# generate a real SP1 core proof, verify it locally, and save it
cargo run --release -p host -- --prove
```

The guest ELF is rebuilt automatically by `build.rs` when the guest changes.

## Proving & memory

`--prove` generates a real SP1 core proof and verifies it locally
(`host/proofs/batch_proof.bin`).

Cost note: the batch computation is Poseidon-over-BN254 (required for
byte-compatibility with the Noir claim circuit and the on-chain root), which
SP1 has no precompile for — a single non-empty market runs ~22M cycles because
the depth-20 tree is ~20 Poseidon hashes at ~1M cycles each. CPU-proving that
exceeds a 16GB machine's RAM (OOM). So:

- **Correctness of the full Poseidon computation** is validated by the
  execute-only path (default mode), which runs the exact guest code and checks
  every settlement + root against the native reference.
- **The proving harness** (setup → prove → verify → serialize) is validated by
  `--prove` over a minimal (empty) batch, which fits in RAM and produces a
  real, locally-verified proof.
- A **full-batch proof** belongs on the Succinct Prover Network
  (`SP1_PROVER=network`) or a higher-RAM machine. A custom BN254-field
  precompile would be the path to making it CPU-provable locally (future work).

## Real proof on-chain (Succinct Prover Network) — ready to run

The whole trustless-settlement path is wired and tested against a mock SP1
verifier; swapping in a real proof is these steps (no code changes):

1. Get a Succinct Prover Network key (https://docs.succinct.xyz), then generate
   an EVM (Groth16) proof of the batch on the network:

   ```bash
   SP1_PROVER=network NETWORK_PRIVATE_KEY=0x... \
     cargo run --release -p host -- --evm
   ```

   This prints the program `programVKey` and writes:
   - `host/proofs/batch_proof_evm.bin`     — the on-chain proof bytes
   - `host/proofs/batch_public_values.bin` — ABI-encoded `SettlementValues[]`

2. Deploy `PredictionMarket` with SP1's canonical `SP1VerifierGateway` address
   for the target chain and the `programVKey` from step 1.

3. Settle on-chain by calling
   `settleWithProof(batch_public_values, batch_proof_evm)` — the gateway
   verifies the proof and the contract settles every market in the batch from
   the proven totals + roots. This is the M3 demo moment.

Contract-level end-to-end (deposit → resolve → settleWithProof over a real
Rust-encoded batch → per-market proven totals) is covered today by
`contracts/test/PredictionMarketBatchE2E.t.sol` using the mock verifier.

> Plain `cargo test` at the repo root does NOT build this crate (it is excluded
> from `default-members`), so the fast aggregation tests never require the SP1
> toolchain. Build/run the prover explicitly with `-p host`.
