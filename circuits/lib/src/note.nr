//! Note format and commitment for shielded prediction-market positions.
//!
//! A trader's position is a private *note*. Only its Poseidon commitment is
//! published on-chain (into the Merkle tree, see `merkle`); the field values
//! stay private to the holder. This mirrors the note/commitment pattern from
//! the author's ZK-AfterLife circuits, applied to a market position.

/// A trader's private position in a prediction market.
///
/// - `market_id`        — which market this position belongs to
/// - `outcome`          — the chosen outcome index. Binary markets use
///                        0 = No, 1 = Yes; categorical markets use
///                        0..num_outcomes (e.g. one index per driver).
/// - `amount`           — stake, in wei
/// - `secret`           — blinding factor; makes two otherwise-identical
///                        positions produce different commitments
/// - `nullifier_secret` — used at claim time to derive a nullifier
///                        that prevents double-claims without linking back
///                        to this commitment
pub struct Note {
    pub market_id: Field,
    pub outcome: Field,
    pub amount: Field,
    pub secret: Field,
    pub nullifier_secret: Field,
}

impl Note {
    /// Poseidon commitment binding all five fields. This is the value that
    /// goes on-chain as a leaf of the commitments Merkle tree.
    pub fn commitment(self) -> Field {
        poseidon::poseidon::bn254::hash_5([
            self.market_id,
            self.outcome,
            self.amount,
            self.secret,
            self.nullifier_secret,
        ])
    }

    /// Nullifier revealed at claim time to prevent double-claims.
    ///
    /// Derived from `nullifier_secret` and `market_id` only — NOT from the
    /// blinding `secret`, `outcome`, or `amount`. This is what makes a claim
    /// unlinkable to its deposit: an observer sees the note's commitment
    /// (a `hash_5` over all five fields) when it is deposited and its
    /// nullifier (this `hash_2`) when it is claimed, but cannot connect the
    /// two without knowing `nullifier_secret`. Only the holder can compute
    /// both. Binding `market_id` keeps nullifiers distinct across markets.
    pub fn nullifier(self) -> Field {
        poseidon::poseidon::bn254::hash_2([self.nullifier_secret, self.market_id])
    }
}

#[test]
fn commitment_is_deterministic() {
    let note = Note { market_id: 1, outcome: 1, amount: 100, secret: 42, nullifier_secret: 7 };
    assert(note.commitment() == note.commitment());
}

// The commitment must bind every field: changing any one of them must change
// the commitment, or a holder could later claim with a different position.

#[test]
fn commitment_binds_market_id() {
    let a = Note { market_id: 1, outcome: 1, amount: 100, secret: 42, nullifier_secret: 7 };
    let b = Note { market_id: 2, outcome: 1, amount: 100, secret: 42, nullifier_secret: 7 };
    assert(a.commitment() != b.commitment());
}

#[test]
fn commitment_binds_side() {
    let a = Note { market_id: 1, outcome: 0, amount: 100, secret: 42, nullifier_secret: 7 };
    let b = Note { market_id: 1, outcome: 1, amount: 100, secret: 42, nullifier_secret: 7 };
    assert(a.commitment() != b.commitment());
}

#[test]
fn commitment_binds_amount() {
    let a = Note { market_id: 1, outcome: 1, amount: 100, secret: 42, nullifier_secret: 7 };
    let b = Note { market_id: 1, outcome: 1, amount: 101, secret: 42, nullifier_secret: 7 };
    assert(a.commitment() != b.commitment());
}

#[test]
fn commitment_binds_secret() {
    let a = Note { market_id: 1, outcome: 1, amount: 100, secret: 42, nullifier_secret: 7 };
    let b = Note { market_id: 1, outcome: 1, amount: 100, secret: 43, nullifier_secret: 7 };
    assert(a.commitment() != b.commitment());
}

#[test]
fn commitment_binds_nullifier_secret() {
    let a = Note { market_id: 1, outcome: 1, amount: 100, secret: 42, nullifier_secret: 7 };
    let b = Note { market_id: 1, outcome: 1, amount: 100, secret: 42, nullifier_secret: 8 };
    assert(a.commitment() != b.commitment());
}

#[test]
fn commitment_binds_categorical_outcomes() {
    // Categorical markets use outcome indices beyond 0/1 (e.g. one per driver);
    // each distinct outcome must produce a distinct commitment.
    let a = Note { market_id: 1, outcome: 2, amount: 100, secret: 42, nullifier_secret: 7 };
    let b = Note { market_id: 1, outcome: 3, amount: 100, secret: 42, nullifier_secret: 7 };
    assert(a.commitment() != b.commitment());
}

// --- nullifier -------------------------------------------------------------

#[test]
fn nullifier_is_deterministic() {
    let note = Note { market_id: 1, outcome: 1, amount: 100, secret: 42, nullifier_secret: 7 };
    assert(note.nullifier() == note.nullifier());
}

#[test]
fn nullifier_binds_nullifier_secret() {
    // Two deposits differing only in nullifier_secret must yield different
    // nullifiers — this is what prevents one note's claim from spending
    // another's slot in the on-chain nullifier registry.
    let a = Note { market_id: 1, outcome: 1, amount: 100, secret: 42, nullifier_secret: 7 };
    let b = Note { market_id: 1, outcome: 1, amount: 100, secret: 42, nullifier_secret: 8 };
    assert(a.nullifier() != b.nullifier());
}

#[test]
fn nullifier_binds_market_id() {
    let a = Note { market_id: 1, outcome: 1, amount: 100, secret: 42, nullifier_secret: 7 };
    let b = Note { market_id: 2, outcome: 1, amount: 100, secret: 42, nullifier_secret: 7 };
    assert(a.nullifier() != b.nullifier());
}

#[test]
fn nullifier_ignores_side_amount_and_secret() {
    // The nullifier must depend ONLY on (nullifier_secret, market_id): a note
    // has exactly one nullifier regardless of its side, amount, or blinding
    // secret, so a holder cannot mint extra nullifiers for the same slot.
    let a = Note { market_id: 1, outcome: 0, amount: 100, secret: 42, nullifier_secret: 7 };
    let b = Note { market_id: 1, outcome: 1, amount: 999, secret: 43, nullifier_secret: 7 };
    assert(a.nullifier() == b.nullifier());
}

#[test]
fn nullifier_differs_from_commitment() {
    let note = Note { market_id: 1, outcome: 1, amount: 100, secret: 42, nullifier_secret: 7 };
    assert(note.nullifier() != note.commitment());
}
