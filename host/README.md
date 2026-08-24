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
# execute-only (fast, no proof) — smoke-tests the guest
cargo run --release -p host

# (later tasks) generate + verify a real proof
# cargo run --release -p host -- --prove
```

The guest ELF is rebuilt automatically by `build.rs` when the guest changes.

> Plain `cargo test` at the repo root does NOT build this crate (it is excluded
> from `default-members`), so the fast aggregation tests never require the SP1
> toolchain. Build/run the prover explicitly with `-p host`.
