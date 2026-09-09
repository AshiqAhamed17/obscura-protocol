//! Helper to compute the derived values (commitment, nullifier, Merkle root) for
//! a parlay witness, so the E2E fixture's `parlay/Prover.toml` can be filled in.
//! Not part of the protocol — a dev tool. Run via `nargo execute` and read the
//! returned tuple. See ../generate-parlay.sh.

use obscura::{MERKLE_DEPTH, MerkleProof, PARLAY_LEGS, ParlayNote};

fn main(
    market_ids: [Field; PARLAY_LEGS],
    outcomes: [Field; PARLAY_LEGS],
    amount: Field,
    secret: Field,
    nullifier_secret: Field,
    path_indices: [Field; MERKLE_DEPTH],
    path_siblings: [Field; MERKLE_DEPTH],
) -> pub (Field, Field, Field) {
    let note = ParlayNote { market_ids, outcomes, amount, secret, nullifier_secret };
    let commitment = note.commitment();
    let nullifier = note.nullifier();
    let proof = MerkleProof { indices: path_indices, siblings: path_siblings };
    let root = proof.compute_root(commitment);
    (commitment, nullifier, root)
}
