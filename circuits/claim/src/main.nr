//! Claim circuit — proves the right to a payout from a shielded position
//! without revealing which deposit it is.
//!
//! Given a resolved market, a holder proves in zero knowledge that they own a
//! note which (1) is a member of the on-chain commitments tree, (2) is on the
//! winning side, and (3) yields the revealed nullifier. The contract consumes
//! the public `nullifier` (marks it spent, blocking double-claims) and the
//! public `amount` (to compute the pari-mutuel payout).
//!
//! Public input ordering is load-bearing — it must match the generated
//! Solidity verifier and the settlement contract's claim call (task 1.6/1.8):
//!   1. merkle_root   — on-chain commitments root
//!   2. market_id     — market being claimed
//!   3. winning_side  — resolved outcome (0 = No, 1 = Yes)
//!   4. amount        — stake of the claimed note (drives the payout)
//!   5. nullifier     — revealed to the on-chain nullifier registry
//!   6. recipient     — payout address, bound into the proof so a claim
//!                      cannot be front-run (an attacker copying the proof
//!                      from the mempool cannot redirect the funds)

use obscura::{MERKLE_DEPTH, MerkleProof, Note};

fn main(
    // --- public inputs ---
    merkle_root: pub Field,
    market_id: pub Field,
    winning_side: pub Field,
    amount: pub Field,
    nullifier: pub Field,
    recipient: pub Field,
    // --- private witness ---
    side: Field,
    secret: Field,
    nullifier_secret: Field,
    path_indices: [Field; MERKLE_DEPTH],
    path_siblings: [Field; MERKLE_DEPTH],
) {
    // Reconstruct the note from public (market_id, amount) + private fields.
    // Because `amount` and `market_id` feed the commitment, a prover cannot
    // claim a different amount than deposited: any change breaks membership.
    let note = Note { market_id, side, amount, secret, nullifier_secret };

    // (0) well-formed note (side is boolean)
    note.assert_valid();

    // (1) membership: the note's commitment is a leaf of the on-chain tree
    let commitment = note.commitment();
    let proof = MerkleProof { indices: path_indices, siblings: path_siblings };
    proof.assert_member(commitment, merkle_root);

    // (2) the note is on the winning side
    assert(side == winning_side, "note is not on the winning side");

    // (3) the revealed nullifier is exactly this note's nullifier
    assert(note.nullifier() == nullifier, "nullifier does not match note");

    // (4) bind the recipient into the proof. The value is not otherwise used
    // by the circuit; this constraint forces it into the constraint system so
    // the proof commits to it, making the claim non-malleable (front-run
    // resistant). Also rejects the zero address.
    assert(recipient != 0, "recipient must be nonzero");
}

// --- tests -----------------------------------------------------------------

/// Builds a self-consistent valid claim: a winning note, a Merkle path to a
/// root computed from its commitment, and the matching public inputs. Tests
/// then perturb one input at a time.
fn valid_witness() -> (Field, Field, Field, Field, Field, Field, Field, Field, Field, [Field; MERKLE_DEPTH], [Field; MERKLE_DEPTH]) {
    let market_id = 5;
    let winning_side = 1;
    let side = 1; // on the winning side
    let amount = 1000;
    let secret = 123;
    let nullifier_secret = 456;
    let recipient = 0xdeadbeef;

    let note = Note { market_id, side, amount, secret, nullifier_secret };

    let indices = [0; MERKLE_DEPTH];
    let mut siblings = [0; MERKLE_DEPTH];
    for i in 0..MERKLE_DEPTH {
        siblings[i] = (i as Field) + 1;
    }
    let proof = MerkleProof { indices, siblings };
    let merkle_root = proof.compute_root(note.commitment());
    let nullifier = note.nullifier();

    (
        merkle_root, market_id, winning_side, amount, nullifier, recipient, side,
        secret, nullifier_secret, indices, siblings,
    )
}

#[test]
fn valid_claim_passes() {
    let (root, market_id, winning_side, amount, nullifier, recipient, side, secret, ns, idx, sib) =
        valid_witness();
    main(root, market_id, winning_side, amount, nullifier, recipient, side, secret, ns, idx, sib);
}

#[test(should_fail_with = "merkle membership proof failed")]
fn wrong_root_fails() {
    let (root, market_id, winning_side, amount, nullifier, recipient, side, secret, ns, idx, sib) =
        valid_witness();
    main(root + 1, market_id, winning_side, amount, nullifier, recipient, side, secret, ns, idx, sib);
}

#[test(should_fail_with = "merkle membership proof failed")]
fn tampered_amount_fails() {
    // Claiming a larger amount changes the commitment, so it is no longer in
    // the tree — the membership proof fails.
    let (root, market_id, winning_side, _amount, nullifier, recipient, side, secret, ns, idx, sib) =
        valid_witness();
    main(root, market_id, winning_side, 5000, nullifier, recipient, side, secret, ns, idx, sib);
}

#[test(should_fail_with = "note is not on the winning side")]
fn losing_side_fails() {
    // A note genuinely on the losing side: rebuild a consistent witness with
    // side = 0 while the market's winning side is 1.
    let market_id = 5;
    let side = 0; // losing side
    let amount = 1000;
    let secret = 123;
    let nullifier_secret = 456;
    let recipient = 0xdeadbeef;
    let note = Note { market_id, side, amount, secret, nullifier_secret };

    let indices = [0; MERKLE_DEPTH];
    let mut siblings = [0; MERKLE_DEPTH];
    for i in 0..MERKLE_DEPTH {
        siblings[i] = (i as Field) + 1;
    }
    let proof = MerkleProof { indices, siblings };
    let root = proof.compute_root(note.commitment());
    let nullifier = note.nullifier();

    main(root, market_id, 1, amount, nullifier, recipient, side, secret, nullifier_secret, indices, siblings);
}

#[test(should_fail_with = "nullifier does not match note")]
fn wrong_nullifier_fails() {
    let (root, market_id, winning_side, amount, nullifier, recipient, side, secret, ns, idx, sib) =
        valid_witness();
    main(root, market_id, winning_side, amount, nullifier + 1, recipient, side, secret, ns, idx, sib);
}

#[test(should_fail_with = "note side must be 0 or 1")]
fn non_boolean_side_fails() {
    let market_id = 5;
    let side = 2; // malformed
    let amount = 1000;
    let secret = 123;
    let nullifier_secret = 456;
    let recipient = 0xdeadbeef;
    let note = Note { market_id, side, amount, secret, nullifier_secret };

    let indices = [0; MERKLE_DEPTH];
    let mut siblings = [0; MERKLE_DEPTH];
    for i in 0..MERKLE_DEPTH {
        siblings[i] = (i as Field) + 1;
    }
    let proof = MerkleProof { indices, siblings };
    let root = proof.compute_root(note.commitment());
    let nullifier = note.nullifier();

    main(root, market_id, 2, amount, nullifier, recipient, side, secret, nullifier_secret, indices, siblings);
}

#[test(should_fail_with = "recipient must be nonzero")]
fn zero_recipient_fails() {
    let (root, market_id, winning_side, amount, nullifier, _recipient, side, secret, ns, idx, sib) =
        valid_witness();
    main(root, market_id, winning_side, amount, nullifier, 0, side, secret, ns, idx, sib);
}
