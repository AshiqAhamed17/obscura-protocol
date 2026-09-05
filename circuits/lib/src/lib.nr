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

pub mod note;
pub mod merkle;

pub use merkle::{MerkleProof, MERKLE_DEPTH};
pub use note::Note;

/// Composition check: a note's commitment (1.2) is what gets proven as a
/// Merkle member (1.3). This is exactly the deposit → claim linkage the claim
/// circuit (1.5) will rely on.
#[test]
fn note_commitment_is_provable_as_merkle_member() {
    let note = Note { market_id: 3, side: 1, amount: 500, secret: 99, nullifier_secret: 11 };
    let leaf = note.commitment();
    let proof = MerkleProof { indices: [0, 1], siblings: [123, 456] };
    let root = proof.compute_root(leaf);
    proof.assert_member(leaf, root);
}
