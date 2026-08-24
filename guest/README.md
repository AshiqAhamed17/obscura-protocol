# guest — Obscura SP1 zkVM program

The zkVM program whose execution is proven. It is built for the RISC-V
`succinct` target via `cargo prove` (invoked automatically by `../host`'s
`build.rs`), so it is intentionally its own workspace and NOT a member of the
repo's root workspace — that keeps `cargo test`/`cargo build` at the root
building only host-target crates.

- **2.1 (done):** trivial program (read `u32`, commit `2n`) proving the SP1
  build → execute → read pipeline works.
- **2.2:** read a variable-size `Vec<MarketNotes>`, call
  `aggregation::settle_batch`, commit the `Vec<MarketSettlement>`.
- **2.3:** reconstruct each market's Poseidon Merkle root
  (`aggregation::merkle_root`) and commit it, tying notes to the on-chain root.

## Build directly

```bash
export PATH="$HOME/.cargo/bin:$HOME/.sp1/bin:$PATH"
cargo prove build
```

See `../host/README.md` for prerequisites (SP1 toolchain, protoc, PATH).
