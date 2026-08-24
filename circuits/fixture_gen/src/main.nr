//! Helper to compute the derived values (commitment, nullifier, Merkle root)
//! for a claim witness, so a test fixture's `claim/Prover.toml` can be filled
//! in. Not part of the protocol — a dev tool. Run via `nargo execute` and read
//! the returned tuple. See ../generate-fixture.sh.

use obscura::{MERKLE_DEPTH, MerkleProof, Note};

fn main(
    market_id: Field,
    side: Field,
    amount: Field,
    secret: Field,
    nullifier_secret: Field,
    path_indices: [Field; MERKLE_DEPTH],
    path_siblings: [Field; MERKLE_DEPTH],
) -> pub (Field, Field, Field) {
    let note = Note { market_id, side, amount, secret, nullifier_secret };
    let commitment = note.commitment();
    let nullifier = note.nullifier();
    let proof = MerkleProof { indices: path_indices, siblings: path_siblings };
    let root = proof.compute_root(commitment);
    (commitment, nullifier, root)
}
