//! Obscura Protocol — Noir circuit primitives.
//!
//! Reusable building blocks for the shielded prediction-market position
//! system. Populated across Phase 1:
//!   - note commitment       (task 1.2)
//!   - Merkle membership      (task 1.3)
//!   - nullifier derivation   (task 1.4)
//!   - claim circuit          (task 1.5, in a separate `claim` binary crate)
//!
//! The Poseidon hashing follows the same pattern used in the author's prior
//! ZK-AfterLife project (`poseidon::poseidon::bn254::hash_*`).

// Primitives are added in the tasks noted above.
