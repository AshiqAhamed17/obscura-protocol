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
//! Solidity verifier and the settlement contract's claim call:
//!   1. merkle_root    — on-chain commitments root
//!   2. market_id      — market being claimed
//!   3. winning_outcome — resolved outcome index (binary: 0 = No, 1 = Yes;
//!                        categorical: the winning bucket 0..num_outcomes)
//!   4. amount         — stake of the claimed note (drives the payout)
//!   5. nullifier      — revealed to the on-chain nullifier registry
//!   6. recipient      — payout address, bound into the proof so a claim
//!                       cannot be front-run (an attacker copying the proof
//!                       from the mempool cannot redirect the funds)

use obscura::{MERKLE_DEPTH, MerkleProof, Note};

fn main(
    // --- public inputs ---
    merkle_root: pub Field,
    market_id: pub Field,
    winning_outcome: pub Field,
    amount: pub Field,
    nullifier: pub Field,
    recipient: pub Field,
    // --- private witness ---
    outcome: Field,
    secret: Field,
    nullifier_secret: Field,
    path_indices: [Field; MERKLE_DEPTH],
    path_siblings: [Field; MERKLE_DEPTH],
) {
    // Reconstruct the note from public (market_id, amount) + private fields.
    // Because `amount` and `market_id` feed the commitment, a prover cannot
    // claim a different amount than deposited: any change breaks membership.
    let note = Note { market_id, outcome, secret, amount, nullifier_secret };

    // (1) membership: the note's commitment is a leaf of the on-chain tree
    let commitment = note.commitment();
    let proof = MerkleProof { indices: path_indices, siblings: path_siblings };
    proof.assert_member(commitment, merkle_root);

    // (2) the note backed the winning outcome. `winning_outcome` is a trusted
    // public input (the market's resolved outcome, set on-chain), so this also
    // implicitly rejects any out-of-range outcome — a note that didn't back the
    // exact winning bucket simply cannot claim. No separate range check needed.
    assert(outcome == winning_outcome, "note did not back the winning outcome");

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
    let winning_outcome = 1;
    let outcome = 1; // backed the winning outcome
    let amount = 1000;
    let secret = 123;
    let nullifier_secret = 456;
    let recipient = 0xdeadbeef;

    let note = Note { market_id, outcome, amount, secret, nullifier_secret };

    let indices = [0; MERKLE_DEPTH];
    let mut siblings = [0; MERKLE_DEPTH];
    for i in 0..MERKLE_DEPTH {
        siblings[i] = (i as Field) + 1;
    }
    let proof = MerkleProof { indices, siblings };
    let merkle_root = proof.compute_root(note.commitment());
    let nullifier = note.nullifier();

    (
        merkle_root, market_id, winning_outcome, amount, nullifier, recipient, outcome,
        secret, nullifier_secret, indices, siblings,
    )
}

#[test]
fn valid_claim_passes() {
    let (root, market_id, winning_outcome, amount, nullifier, recipient, outcome, secret, ns, idx, sib) =
        valid_witness();
    main(root, market_id, winning_outcome, amount, nullifier, recipient, outcome, secret, ns, idx, sib);
}

#[test(should_fail_with = "merkle membership proof failed")]
fn wrong_root_fails() {
    let (root, market_id, winning_outcome, amount, nullifier, recipient, outcome, secret, ns, idx, sib) =
        valid_witness();
    main(root + 1, market_id, winning_outcome, amount, nullifier, recipient, outcome, secret, ns, idx, sib);
}

#[test(should_fail_with = "merkle membership proof failed")]
fn tampered_amount_fails() {
    // Claiming a larger amount changes the commitment, so it is no longer in
    // the tree — the membership proof fails.
    let (root, market_id, winning_outcome, _amount, nullifier, recipient, outcome, secret, ns, idx, sib) =
        valid_witness();
    main(root, market_id, winning_outcome, 5000, nullifier, recipient, outcome, secret, ns, idx, sib);
}

#[test(should_fail_with = "note did not back the winning outcome")]
fn losing_outcome_fails() {
    // A note genuinely on a losing outcome: rebuild a consistent witness with
    // outcome = 0 while the market's winning outcome is 1.
    let market_id = 5;
    let outcome = 0; // losing outcome
    let amount = 1000;
    let secret = 123;
    let nullifier_secret = 456;
    let recipient = 0xdeadbeef;
    let note = Note { market_id, outcome, amount, secret, nullifier_secret };

    let indices = [0; MERKLE_DEPTH];
    let mut siblings = [0; MERKLE_DEPTH];
    for i in 0..MERKLE_DEPTH {
        siblings[i] = (i as Field) + 1;
    }
    let proof = MerkleProof { indices, siblings };
    let root = proof.compute_root(note.commitment());
    let nullifier = note.nullifier();

    main(root, market_id, 1, amount, nullifier, recipient, outcome, secret, nullifier_secret, indices, siblings);
}

#[test]
fn categorical_winning_outcome_passes() {
    // A 5-outcome market where the note backed outcome 3 and 3 won.
    let market_id = 7;
    let outcome = 3;
    let amount = 1000;
    let secret = 123;
    let nullifier_secret = 456;
    let recipient = 0xdeadbeef;
    let note = Note { market_id, outcome, amount, secret, nullifier_secret };

    let indices = [0; MERKLE_DEPTH];
    let mut siblings = [0; MERKLE_DEPTH];
    for i in 0..MERKLE_DEPTH {
        siblings[i] = (i as Field) + 1;
    }
    let proof = MerkleProof { indices, siblings };
    let root = proof.compute_root(note.commitment());
    let nullifier = note.nullifier();

    main(root, market_id, 3, amount, nullifier, recipient, outcome, secret, nullifier_secret, indices, siblings);
}

#[test(should_fail_with = "nullifier does not match note")]
fn wrong_nullifier_fails() {
    let (root, market_id, winning_outcome, amount, nullifier, recipient, outcome, secret, ns, idx, sib) =
        valid_witness();
    main(root, market_id, winning_outcome, amount, nullifier + 1, recipient, outcome, secret, ns, idx, sib);
}

#[test(should_fail_with = "recipient must be nonzero")]
fn zero_recipient_fails() {
    let (root, market_id, winning_outcome, amount, nullifier, _recipient, outcome, secret, ns, idx, sib) =
        valid_witness();
    main(root, market_id, winning_outcome, amount, nullifier, 0, outcome, secret, ns, idx, sib);
}
