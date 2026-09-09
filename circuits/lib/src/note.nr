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

    /// Foresight nullifier — revealed when a holder proves, after settlement,
    /// that this note backed the winning outcome ("I was right"), to earn an
    /// anonymous forecasting credential.
    ///
    /// Domain-separated from the spend `nullifier` by offsetting `market_id`
    /// with `FORESIGHT_DOMAIN`, so:
    ///  - proving foresight is independent of claiming a payout (a holder can
    ///    do either, both, or neither — they consume different registries), and
    ///  - a foresight credential cannot be linked to the note's payout claim,
    ///    keeping forecasting reputation unlinkable to withdrawal amounts.
    /// Still deterministic per note (one credential per winning note) so it
    /// cannot be double-counted.
    pub fn foresight_nullifier(self) -> Field {
        poseidon::poseidon::bn254::hash_2([self.nullifier_secret, self.market_id + FORESIGHT_DOMAIN])
    }
}

/// Domain-separation constant for the foresight nullifier. A large value so
/// `market_id + FORESIGHT_DOMAIN` never overlaps a real (small) market id used
/// by the spend nullifier's `hash_2(nullifier_secret, market_id)`.
pub global FORESIGHT_DOMAIN: Field = 0x666f7265736967687400000000000000000000000000000000000000;

/// Number of legs in a parlay note. A fixed size keeps the commitment, the
/// circuit, and the on-chain verifier's public-input count constant.
pub global PARLAY_LEGS: u32 = 3;

/// Domain-separation constant for parlay nullifiers, so a parlay's spend
/// nullifier never collides with a single-market spend/foresight nullifier.
pub global PARLAY_DOMAIN: Field = 0x7061726c617900000000000000000000000000000000000000000000;

/// A shielded **parlay**: a single private position that wins only if EVERY leg
/// resolves to its committed outcome. Each leg is a `(market_id, outcome)` pick;
/// the whole parlay shares one stake, one blinding secret, and one nullifier —
/// so a claim reveals only the combined payout and one nullifier, never the
/// individual legs or which deposit it was.
///
/// - `market_ids`       — the market of each leg (public at claim: the parlay's
///                        legs are named on-chain so the contract can look up
///                        each leg's resolved outcome and pool ratio)
/// - `outcomes`         — the picked outcome per leg (PRIVATE: the picks stay
///                        hidden until claim, and even then only "all correct"
///                        is revealed, not the individual choices — they must
///                        equal the public winning outcomes to claim)
/// - `amount`           — the single parlay stake (USDC base units)
/// - `secret`           — blinding factor
/// - `nullifier_secret` — derives the parlay nullifier
pub struct ParlayNote {
    pub market_ids: [Field; PARLAY_LEGS],
    pub outcomes: [Field; PARLAY_LEGS],
    pub amount: Field,
    pub secret: Field,
    pub nullifier_secret: Field,
}

impl ParlayNote {
    /// Poseidon commitment binding all legs + stake + secrets, computed by
    /// nesting `hash_5` (available arity) so every field is bound. This is the
    /// leaf published into the dedicated parlay pool's commitments tree.
    pub fn commitment(self) -> Field {
        let legs = poseidon::poseidon::bn254::hash_5([
            self.market_ids[0],
            self.outcomes[0],
            self.market_ids[1],
            self.outcomes[1],
            self.market_ids[2],
        ]);
        poseidon::poseidon::bn254::hash_5([
            self.outcomes[2],
            self.amount,
            self.secret,
            self.nullifier_secret,
            legs,
        ])
    }

    /// Parlay spend nullifier — revealed once at claim, domain-separated from the
    /// single-market spend and foresight nullifiers. Depends only on
    /// `nullifier_secret` (+ domain), so a parlay note has exactly one nullifier
    /// regardless of its legs, stake, or blinding secret.
    pub fn nullifier(self) -> Field {
        poseidon::poseidon::bn254::hash_2([self.nullifier_secret, PARLAY_DOMAIN])
    }
}

#[test]
fn parlay_commitment_is_deterministic() {
    let p = ParlayNote {
        market_ids: [1, 2, 3],
        outcomes: [1, 0, 1],
        amount: 100,
        secret: 42,
        nullifier_secret: 7,
    };
    assert(p.commitment() == p.commitment());
}

#[test]
fn parlay_commitment_binds_every_leg() {
    let base =
        ParlayNote { market_ids: [1, 2, 3], outcomes: [1, 0, 1], amount: 100, secret: 42, nullifier_secret: 7 };
    // changing any leg market or outcome changes the commitment
    let m = ParlayNote { market_ids: [1, 2, 9], outcomes: [1, 0, 1], amount: 100, secret: 42, nullifier_secret: 7 };
    let o = ParlayNote { market_ids: [1, 2, 3], outcomes: [1, 0, 0], amount: 100, secret: 42, nullifier_secret: 7 };
    assert(base.commitment() != m.commitment());
    assert(base.commitment() != o.commitment());
}

#[test]
fn parlay_commitment_binds_amount_and_secrets() {
    let base =
        ParlayNote { market_ids: [1, 2, 3], outcomes: [1, 0, 1], amount: 100, secret: 42, nullifier_secret: 7 };
    let a = ParlayNote { market_ids: [1, 2, 3], outcomes: [1, 0, 1], amount: 101, secret: 42, nullifier_secret: 7 };
    let s = ParlayNote { market_ids: [1, 2, 3], outcomes: [1, 0, 1], amount: 100, secret: 43, nullifier_secret: 7 };
    let n = ParlayNote { market_ids: [1, 2, 3], outcomes: [1, 0, 1], amount: 100, secret: 42, nullifier_secret: 8 };
    assert(base.commitment() != a.commitment());
    assert(base.commitment() != s.commitment());
    assert(base.commitment() != n.commitment());
}

#[test]
fn parlay_nullifier_is_domain_separated() {
    let p = ParlayNote {
        market_ids: [1, 2, 3],
        outcomes: [1, 0, 1],
        amount: 100,
        secret: 42,
        nullifier_secret: 7,
    };
    // A single-market note with the same nullifier_secret must yield a different
    // nullifier — parlay nullifiers live in their own domain.
    let single = Note { market_id: 1, outcome: 1, amount: 100, secret: 42, nullifier_secret: 7 };
    assert(p.nullifier() != single.nullifier());
    assert(p.nullifier() != single.foresight_nullifier());
}

#[test]
fn parlay_nullifier_ignores_legs_amount_secret() {
    let a = ParlayNote { market_ids: [1, 2, 3], outcomes: [1, 0, 1], amount: 100, secret: 42, nullifier_secret: 7 };
    let b = ParlayNote { market_ids: [4, 5, 6], outcomes: [0, 1, 0], amount: 999, secret: 43, nullifier_secret: 7 };
    assert(a.nullifier() == b.nullifier());
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

// --- foresight nullifier ---------------------------------------------------

#[test]
fn foresight_nullifier_is_deterministic() {
    let note = Note { market_id: 1, outcome: 1, amount: 100, secret: 42, nullifier_secret: 7 };
    assert(note.foresight_nullifier() == note.foresight_nullifier());
}

#[test]
fn foresight_nullifier_differs_from_spend_nullifier() {
    // Domain separation: the foresight credential must not equal the spend
    // nullifier, so proving foresight and claiming a payout are independent and
    // unlinkable.
    let note = Note { market_id: 1, outcome: 1, amount: 100, secret: 42, nullifier_secret: 7 };
    assert(note.foresight_nullifier() != note.nullifier());
}

#[test]
fn foresight_nullifier_binds_market_and_secret() {
    let a = Note { market_id: 1, outcome: 1, amount: 100, secret: 42, nullifier_secret: 7 };
    let b = Note { market_id: 2, outcome: 1, amount: 100, secret: 42, nullifier_secret: 7 };
    let c = Note { market_id: 1, outcome: 1, amount: 100, secret: 42, nullifier_secret: 8 };
    assert(a.foresight_nullifier() != b.foresight_nullifier()); // different market
    assert(a.foresight_nullifier() != c.foresight_nullifier()); // different secret
}

#[test]
fn foresight_nullifier_ignores_outcome_amount_secret() {
    // Like the spend nullifier, it depends only on (nullifier_secret, market_id)
    // so a note has exactly one foresight credential.
    let a = Note { market_id: 1, outcome: 0, amount: 100, secret: 42, nullifier_secret: 7 };
    let b = Note { market_id: 1, outcome: 1, amount: 999, secret: 43, nullifier_secret: 7 };
    assert(a.foresight_nullifier() == b.foresight_nullifier());
}
