# guest

Placeholder for the Milestone 2 SP1 guest program. It currently builds as a
plain binary so `cargo build`/`cargo test` work across the workspace without
the SP1 toolchain installed.

## Turning this into a real SP1 guest (Milestone 2)

1. Install the toolchain: `curl -L https://sp1.succinct.xyz | bash && sp1up`,
   then `cargo prove new` conventions apply here (this crate already matches
   the expected guest-crate layout).
2. Add `sp1-zkvm` as a dependency and call `sp1_zkvm::entrypoint!(main)`.
3. Replace the placeholder input in `main.rs` with `sp1_zkvm::io::read::<Vec<MarketNotes>>()`,
   and commit the resulting `Vec<MarketSettlement>` via `sp1_zkvm::io::commit(&settlements)`.
4. Add per-note Merkle-path verification (against each market's on-chain
   commitment root) before calling `settle_batch`, using SP1's **precompiled**
   keccak/sha256 hashing rather than a hand-rolled hash — 5-10x cheaper in
   cycles (see `plan.md` at the repo root for why this matters).
5. Build a small host program (outside this crate) that loads real market/note
   data, invokes the SP1 prover, and verifies the resulting proof locally
   before wiring it up to the on-chain verifier in Milestone 2's settlement
   contract update.
