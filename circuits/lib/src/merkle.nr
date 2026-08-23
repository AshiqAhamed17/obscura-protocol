//! Merkle membership proofs over the note-commitments tree.
//!
//! Note commitments are inserted as leaves of a fixed-depth Poseidon Merkle
//! tree whose root lives on-chain. To claim, a holder proves their note's
//! commitment is a leaf of that tree *without revealing which leaf* — a
//! standard authentication-path proof (leaf + sibling hashes + direction
//! bits recompute the root), the scalable alternative to rebuilding the whole
//! tree in-circuit.

/// Depth of the on-chain commitments tree (2^20 ≈ 1,048,576 positions). The
/// claim circuit and the on-chain tree must agree on this value.
pub global MERKLE_DEPTH: u32 = 20;

/// An authentication path for a leaf: the sibling hash at each level, and a
/// direction bit per level (0 = this node is the left child, so the sibling
/// is on the right; 1 = this node is the right child).
pub struct MerkleProof<let N: u32> {
    pub indices: [Field; N],
    pub siblings: [Field; N],
}

impl<let N: u32> MerkleProof<N> {
    /// Recomputes the tree root implied by `leaf` and this path.
    pub fn compute_root(self, leaf: Field) -> Field {
        let mut current = leaf;
        for i in 0..N {
            let bit = self.indices[i];
            assert((bit == 0) | (bit == 1), "path index must be a bit");

            let sibling = self.siblings[i];
            // bit == 0: current is the left child  -> hash(current, sibling)
            // bit == 1: current is the right child -> hash(sibling, current)
            let left = if bit == 0 { current } else { sibling };
            let right = if bit == 0 { sibling } else { current };
            current = poseidon::poseidon::bn254::hash_2([left, right]);
        }
        current
    }

    /// Asserts `leaf` is a member of the tree with the given `root`.
    pub fn assert_member(self, leaf: Field, root: Field) {
        let computed = self.compute_root(leaf);
        assert(computed == root, "merkle membership proof failed");
    }
}

// --- tests -----------------------------------------------------------------
//
// Tested with small, hand-verifiable depths (the function is generic over
// depth), so the expected roots are computed independently of the loop under
// test — exercising the left/right ordering logic, not just Poseidon itself.

#[test]
fn single_level_left_child() {
    let leaf = 111;
    let sibling = 222;
    let proof = MerkleProof { indices: [0], siblings: [sibling] };

    // leaf is the left child -> root = hash(leaf, sibling)
    let expected = poseidon::poseidon::bn254::hash_2([leaf, sibling]);
    assert(proof.compute_root(leaf) == expected);
}

#[test]
fn single_level_right_child() {
    let leaf = 111;
    let sibling = 222;
    let proof = MerkleProof { indices: [1], siblings: [sibling] };

    // leaf is the right child -> root = hash(sibling, leaf)
    let expected = poseidon::poseidon::bn254::hash_2([sibling, leaf]);
    assert(proof.compute_root(leaf) == expected);
}

#[test]
fn two_levels_mixed_directions() {
    let leaf = 7;
    let s0 = 8; // level-0 sibling, leaf is left  (bit 0)
    let s1 = 9; // level-1 sibling, node is right (bit 1)
    let proof = MerkleProof { indices: [0, 1], siblings: [s0, s1] };

    // level 0: node0 = hash(leaf, s0)
    // level 1: bit 1 -> root = hash(s1, node0)
    let node0 = poseidon::poseidon::bn254::hash_2([leaf, s0]);
    let expected = poseidon::poseidon::bn254::hash_2([s1, node0]);
    assert(proof.compute_root(leaf) == expected);
}

#[test]
fn assert_member_passes_for_valid_path() {
    let leaf = 42;
    let proof = MerkleProof { indices: [0, 1, 0], siblings: [1, 2, 3] };
    let root = proof.compute_root(leaf);
    proof.assert_member(leaf, root);
}

#[test(should_fail_with = "merkle membership proof failed")]
fn assert_member_fails_for_wrong_root() {
    let leaf = 42;
    let proof = MerkleProof { indices: [0, 1, 0], siblings: [1, 2, 3] };
    let root = proof.compute_root(leaf);
    proof.assert_member(leaf, root + 1);
}

#[test(should_fail_with = "merkle membership proof failed")]
fn assert_member_fails_for_wrong_leaf() {
    let leaf = 42;
    let proof = MerkleProof { indices: [0, 1, 0], siblings: [1, 2, 3] };
    let root = proof.compute_root(leaf);
    proof.assert_member(leaf + 1, root);
}

#[test(should_fail_with = "path index must be a bit")]
fn rejects_non_boolean_index() {
    let proof = MerkleProof { indices: [2], siblings: [5] };
    let _ = proof.compute_root(1);
}

#[test]
fn works_at_production_depth() {
    // A full MERKLE_DEPTH path round-trips through assert_member.
    let leaf = 12345;
    let indices = [0; MERKLE_DEPTH];
    let mut siblings = [0; MERKLE_DEPTH];
    for i in 0..MERKLE_DEPTH {
        siblings[i] = (i as Field) + 1;
    }
    let proof = MerkleProof { indices, siblings };
    let root = proof.compute_root(leaf);
    proof.assert_member(leaf, root);
}
