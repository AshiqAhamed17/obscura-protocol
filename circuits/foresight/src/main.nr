//! Proof of Foresight — prove, after a market settles, that you held a note
//! backing the winning outcome ("I called it, before it resolved"), without
//! revealing which deposit it was or how much you staked.
//!
//! This is the accountability layer that makes Obscura more than a private
//! market: a trader builds an anonymous, verifiable forecasting track record.
//! It reuses the shielded-note membership machinery of the claim circuit but
//! pays out nothing — it only reveals a domain-separated *foresight nullifier*,
//! recorded once in an on-chain registry so each correct call counts a single
//! time and cannot be linked to the trader's payout claim.
//!
//! Public input ordering is load-bearing — it must match the generated
//! Solidity verifier and `ForesightRegistry.proveForesight`:
//!   1. merkle_root         — the settled market's commitments root
//!   2. market_id           — the market being attested
//!   3. winning_outcome     — the market's resolved winning outcome index
//!   4. foresight_nullifier — revealed to the on-chain foresight registry

use obscura::{MERKLE_DEPTH, MerkleProof, Note};

fn main(
    // --- public inputs ---
    merkle_root: pub Field,
    market_id: pub Field,
    winning_outcome: pub Field,
    foresight_nullifier: pub Field,
    // --- private witness ---
    outcome: Field,
    amount: Field,
    secret: Field,
    nullifier_secret: Field,
    path_indices: [Field; MERKLE_DEPTH],
    path_siblings: [Field; MERKLE_DEPTH],
) {
    // Reconstruct the note. `amount` stays private — foresight reveals that you
    // were right, never how much you bet.
    let note = Note { market_id, outcome, amount, secret, nullifier_secret };

    // (1) membership: the note's commitment is a leaf of the settled tree.
    let proof = MerkleProof { indices: path_indices, siblings: path_siblings };
    proof.assert_member(note.commitment(), merkle_root);

    // (2) the note backed the winning outcome (trusted public input, set
    //     on-chain from the market's resolution).
    assert(outcome == winning_outcome, "note did not back the winning outcome");

    // (3) the revealed foresight nullifier is exactly this note's — deterministic
    //     per note, so the credential cannot be double-counted.
    assert(note.foresight_nullifier() == foresight_nullifier, "foresight nullifier mismatch");
}

// --- tests -----------------------------------------------------------------

fn witness(
    market_id: Field,
    winning_outcome: Field,
    outcome: Field,
) -> (Field, Field, Field, Field, Field, Field, Field, Field, [Field; MERKLE_DEPTH], [Field; MERKLE_DEPTH]) {
    let amount = 1000;
    let secret = 123;
    let nullifier_secret = 456;
    let note = Note { market_id, outcome, amount, secret, nullifier_secret };

    let indices = [0; MERKLE_DEPTH];
    let mut siblings = [0; MERKLE_DEPTH];
    for i in 0..MERKLE_DEPTH {
        siblings[i] = (i as Field) + 1;
    }
    let proof = MerkleProof { indices, siblings };
    let root = proof.compute_root(note.commitment());
    (
        root, note.foresight_nullifier(), winning_outcome, outcome, amount, secret,
        nullifier_secret, market_id, indices, siblings,
    )
}

#[test]
fn valid_foresight_passes() {
    let (root, fnull, winning, outcome, amount, secret, ns, market_id, idx, sib) = witness(5, 1, 1);
    main(root, market_id, winning, fnull, outcome, amount, secret, ns, idx, sib);
}

#[test]
fn categorical_foresight_passes() {
    // A 5-outcome market where the note backed outcome 3 and 3 won.
    let (root, fnull, winning, outcome, amount, secret, ns, market_id, idx, sib) = witness(9, 3, 3);
    main(root, market_id, winning, fnull, outcome, amount, secret, ns, idx, sib);
}

#[test(should_fail_with = "note did not back the winning outcome")]
fn losing_outcome_fails() {
    // Note backed outcome 0 but outcome 1 won.
    let (root, fnull, _winning, outcome, amount, secret, ns, market_id, idx, sib) = witness(5, 0, 0);
    main(root, market_id, 1, fnull, outcome, amount, secret, ns, idx, sib);
}

#[test(should_fail_with = "merkle membership proof failed")]
fn wrong_root_fails() {
    let (root, fnull, winning, outcome, amount, secret, ns, market_id, idx, sib) = witness(5, 1, 1);
    main(root + 1, market_id, winning, fnull, outcome, amount, secret, ns, idx, sib);
}

#[test(should_fail_with = "foresight nullifier mismatch")]
fn wrong_foresight_nullifier_fails() {
    let (root, fnull, winning, outcome, amount, secret, ns, market_id, idx, sib) = witness(5, 1, 1);
    main(root, market_id, winning, fnull + 1, outcome, amount, secret, ns, idx, sib);
}
