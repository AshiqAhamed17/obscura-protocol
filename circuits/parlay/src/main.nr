//! Parlay claim circuit — proves the right to a combined payout from a shielded
//! multi-leg position, without revealing which deposit it is or the individual
//! picks beyond "every leg was correct".
//!
//! A parlay wins only if EVERY leg resolved to its committed outcome. The holder
//! proves in zero knowledge that they own a parlay note which (1) is a member of
//! the dedicated parlay pool's commitments tree, (2) picked, on every leg, the
//! outcome that market actually resolved to, and (3) yields the revealed
//! nullifier. The contract consumes the public `nullifier` (marks it spent) and
//! `amount` (to compute the product-of-ratios payout), and pays `recipient`.
//!
//! Public input ordering is load-bearing — it must match the generated Solidity
//! verifier and the ParlayPool's claim call:
//!   1.   parlay_root       — on-chain parlay-pool commitments root
//!   2..4 market_ids[3]      — the leg markets (named on-chain so the pool can
//!                            look up each leg's resolved outcome + ratio)
//!   5..7 winning_outcomes[3]— each leg market's resolved outcome (trusted
//!                            on-chain state)
//!   8.   amount            — the parlay stake (drives the payout)
//!   9.   nullifier         — revealed to the on-chain nullifier registry
//!   10.  recipient         — payout address, bound so a claim cannot be front-run

use obscura::{MERKLE_DEPTH, MerkleProof, PARLAY_LEGS, ParlayNote};

fn main(
    // --- public inputs ---
    parlay_root: pub Field,
    market_ids: pub [Field; PARLAY_LEGS],
    winning_outcomes: pub [Field; PARLAY_LEGS],
    amount: pub Field,
    nullifier: pub Field,
    recipient: pub Field,
    // --- private witness ---
    outcomes: [Field; PARLAY_LEGS],
    secret: Field,
    nullifier_secret: Field,
    path_indices: [Field; MERKLE_DEPTH],
    path_siblings: [Field; MERKLE_DEPTH],
) {
    // Reconstruct the parlay note from public (market_ids, amount) + private
    // (outcomes, secret, nullifier_secret). Because market_ids and amount feed
    // the commitment, a prover cannot claim a different stake or swap in
    // different leg markets than were deposited: any change breaks membership.
    let note = ParlayNote { market_ids, outcomes, amount, secret, nullifier_secret };

    // (1) membership: the parlay note's commitment is a leaf of the pool tree
    let commitment = note.commitment();
    let proof = MerkleProof { indices: path_indices, siblings: path_siblings };
    proof.assert_member(commitment, parlay_root);

    // (2) EVERY leg was correct: the committed pick equals that leg market's
    // resolved winning outcome. `winning_outcomes` are trusted public inputs
    // (each leg market's resolved outcome, set on-chain), so a single wrong leg
    // makes the whole parlay unclaimable — the defining parlay property.
    for i in 0..PARLAY_LEGS {
        assert(outcomes[i] == winning_outcomes[i], "a parlay leg did not back the winning outcome");
    }

    // (3) the revealed nullifier is exactly this parlay note's nullifier
    assert(note.nullifier() == nullifier, "nullifier does not match parlay note");

    // (4) bind the recipient into the proof (front-run resistance) and reject
    // the zero address.
    assert(recipient != 0, "recipient must be nonzero");
}

// --- tests -----------------------------------------------------------------

/// Builds a self-consistent winning parlay: all three legs pick the outcome that
/// their market resolved to, a Merkle path to a root from the commitment, and
/// matching public inputs.
fn winning_witness() -> (Field, [Field; PARLAY_LEGS], [Field; PARLAY_LEGS], Field, Field, Field, [Field; PARLAY_LEGS], Field, Field, [Field; MERKLE_DEPTH], [Field; MERKLE_DEPTH]) {
    let market_ids = [5, 8, 13];
    let outcomes = [1, 0, 2]; // the picks
    let winning_outcomes = [1, 0, 2]; // every leg resolved to the pick -> win
    let amount = 1000;
    let secret = 123;
    let nullifier_secret = 456;
    let recipient = 0xdeadbeef;

    let note = ParlayNote { market_ids, outcomes, amount, secret, nullifier_secret };

    let indices = [0; MERKLE_DEPTH];
    let mut siblings = [0; MERKLE_DEPTH];
    for i in 0..MERKLE_DEPTH {
        siblings[i] = (i as Field) + 1;
    }
    let proof = MerkleProof { indices, siblings };
    let parlay_root = proof.compute_root(note.commitment());
    let nullifier = note.nullifier();

    (
        parlay_root, market_ids, winning_outcomes, amount, nullifier, recipient, outcomes, secret,
        nullifier_secret, indices, siblings,
    )
}

#[test]
fn winning_parlay_passes() {
    let (root, mids, wins, amount, nullifier, recipient, outcomes, secret, ns, idx, sib) =
        winning_witness();
    main(root, mids, wins, amount, nullifier, recipient, outcomes, secret, ns, idx, sib);
}

#[test(should_fail_with = "a parlay leg did not back the winning outcome")]
fn one_losing_leg_fails() {
    // The note's picks are the winning set, but leg 1's market actually resolved
    // to a different outcome (0 -> 1): a single wrong leg breaks the whole parlay.
    let (root, mids, mut wins, amount, nullifier, recipient, outcomes, secret, ns, idx, sib) =
        winning_witness();
    wins[1] = 1; // leg 1 resolved to 1, but the note picked 0
    main(root, mids, wins, amount, nullifier, recipient, outcomes, secret, ns, idx, sib);
}

#[test(should_fail_with = "a parlay leg did not back the winning outcome")]
fn last_leg_wrong_fails() {
    let (root, mids, mut wins, amount, nullifier, recipient, outcomes, secret, ns, idx, sib) =
        winning_witness();
    wins[2] = 0; // leg 2 resolved to 0, but the note picked 2
    main(root, mids, wins, amount, nullifier, recipient, outcomes, secret, ns, idx, sib);
}

#[test(should_fail_with = "merkle membership proof failed")]
fn wrong_root_fails() {
    let (root, mids, wins, amount, nullifier, recipient, outcomes, secret, ns, idx, sib) =
        winning_witness();
    main(root + 1, mids, wins, amount, nullifier, recipient, outcomes, secret, ns, idx, sib);
}

#[test(should_fail_with = "merkle membership proof failed")]
fn tampered_amount_fails() {
    // Claiming a larger stake changes the commitment -> no longer in the tree.
    let (root, mids, wins, _amount, nullifier, recipient, outcomes, secret, ns, idx, sib) =
        winning_witness();
    main(root, mids, wins, 5000, nullifier, recipient, outcomes, secret, ns, idx, sib);
}

#[test(should_fail_with = "merkle membership proof failed")]
fn swapped_leg_market_fails() {
    // Swapping a leg's market id (public) without a matching commitment breaks
    // membership — a claimant cannot retarget the parlay's legs after the fact.
    let (root, mut mids, wins, amount, nullifier, recipient, outcomes, secret, ns, idx, sib) =
        winning_witness();
    mids[0] = 99;
    main(root, mids, wins, amount, nullifier, recipient, outcomes, secret, ns, idx, sib);
}

#[test(should_fail_with = "nullifier does not match parlay note")]
fn wrong_nullifier_fails() {
    let (root, mids, wins, amount, nullifier, recipient, outcomes, secret, ns, idx, sib) =
        winning_witness();
    main(root, mids, wins, amount, nullifier + 1, recipient, outcomes, secret, ns, idx, sib);
}

#[test(should_fail_with = "recipient must be nonzero")]
fn zero_recipient_fails() {
    let (root, mids, wins, amount, nullifier, _recipient, outcomes, secret, ns, idx, sib) =
        winning_witness();
    main(root, mids, wins, amount, nullifier, 0, outcomes, secret, ns, idx, sib);
}
