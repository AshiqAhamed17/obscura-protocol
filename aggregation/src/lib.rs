//! Batch settlement + Merkle-root reconstruction for Obscura Protocol.
//!
//! This crate is plain Rust with no SP1 dependency, unit-tested on its own,
//! then compiled unmodified into the `guest` crate's SP1 program (Milestone
//! 2). Keeping the algorithm here — rather than writing it directly inside
//! the SP1 guest — means it can be tested fast, without a prover, and the
//! guest stays a thin wrapper around it.
//!
//! The Poseidon hashing here is verified byte-compatible with the Noir
//! circuits' `poseidon::poseidon::bn254::hash_*` (see the compatibility tests
//! against fixtures produced by the Noir `fixture_gen` circuit). That
//! compatibility is what lets the SP1 guest recompute commitments and the
//! Merkle root and have them match the Noir claim circuit and the on-chain
//! root.

pub use ark_bn254::Fr;
use ark_ff::{BigInteger, PrimeField};
use light_poseidon::{Poseidon, PoseidonHasher};
use serde::{Deserialize, Serialize};

pub mod public_values;

/// Depth of the commitments Merkle tree. Must match `MERKLE_DEPTH` in the Noir
/// `obscura` library and the on-chain tree.
pub const MERKLE_DEPTH: usize = 20;

/// A field element serialized as 32 big-endian bytes. Used for note secrets and
/// committed roots so every type crossing the SP1 io boundary is plain serde.
pub type FieldBytes = [u8; 32];

fn to_fr(bytes: &FieldBytes) -> Fr {
    Fr::from_be_bytes_mod_order(bytes)
}

fn fr_to_bytes(f: Fr) -> FieldBytes {
    let v = f.into_bigint().to_bytes_be(); // <= 32 bytes, big-endian
    let mut out = [0u8; 32];
    out[32 - v.len()..].copy_from_slice(&v);
    out
}

/// A note's chosen outcome, encoded as an index into a market's outcome set.
/// Binary markets use the convention 0 = No, 1 = Yes; categorical markets use
/// 0..num_outcomes (e.g. one index per driver / per project). Kept as a `u8`
/// because it feeds a field element inside the commitment.
pub type Outcome = u8;

/// A trader's note. Carries every field needed to recompute its on-chain
/// commitment; `market_id` is supplied by the enclosing [`MarketNotes`].
/// Secrets are field elements stored as 32 big-endian bytes so the type is
/// plain serde (readable across the SP1 io boundary).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Note {
    pub outcome: Outcome,
    pub amount: u64,
    pub secret: FieldBytes,
    pub nullifier_secret: FieldBytes,
}

impl Note {
    /// Poseidon commitment binding all note fields — identical to
    /// `Note::commitment` in the Noir `obscura` library. The outcome index is
    /// hashed as a field element (matching the circuit's `outcome` input).
    pub fn commitment(&self, market_id: u64) -> Fr {
        hash5([
            Fr::from(market_id),
            Fr::from(self.outcome as u64),
            Fr::from(self.amount),
            to_fr(&self.secret),
            to_fr(&self.nullifier_secret),
        ])
    }

    /// Nullifier — identical to `Note::nullifier` in the Noir library.
    pub fn nullifier(&self, market_id: u64) -> Fr {
        hash2(to_fr(&self.nullifier_secret), Fr::from(market_id))
    }
}

/// One resolved market's full set of committed notes, ready to settle.
/// `num_outcomes` is the number of buckets the pool is split across (2 for a
/// binary Yes/No market, N for a categorical market).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketNotes {
    pub market_id: u64,
    pub num_outcomes: u8,
    pub escrowed_collateral: u64,
    pub notes: Vec<Note>,
}

impl MarketNotes {
    /// Reconstructs this market's commitments-tree root from its notes. This is
    /// the value the operator posts on-chain at settle (M1) and that the SP1
    /// guest proves (M2).
    pub fn merkle_root(&self) -> Fr {
        let leaves: Vec<Fr> = self.notes.iter().map(|n| n.commitment(self.market_id)).collect();
        merkle_root(&leaves)
    }

    /// The reconstructed root as 32 big-endian bytes (for committing/comparing
    /// against an on-chain `bytes32` root).
    pub fn merkle_root_bytes(&self) -> FieldBytes {
        fr_to_bytes(self.merkle_root())
    }
}

/// The proven, public result of settling one market. `outcome_totals[i]` is the
/// total staked on outcome `i` (length == the market's `num_outcomes`); the sum
/// equals the escrowed collateral.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MarketSettlement {
    pub market_id: u64,
    pub outcome_totals: Vec<u64>,
    /// Commitments-tree root reconstructed from this market's notes (32
    /// big-endian bytes). The on-chain contract checks this against the
    /// market's stored root, so a valid proof attests that these totals were
    /// derived from exactly the notes committed to that root.
    pub merkle_root: FieldBytes,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SettlementError {
    /// The notes' amounts don't sum to the market's escrowed collateral —
    /// the operator either fabricated or dropped a note.
    Insolvent { market_id: u64 },
    /// Summing amounts overflowed u64 — reject rather than wrap.
    Overflow { market_id: u64 },
    /// A note's outcome index is >= the market's `num_outcomes`.
    OutcomeOutOfRange { market_id: u64 },
    /// A market declared zero outcomes (a binary market has 2).
    NoOutcomes { market_id: u64 },
}

/// Settles an entire batch of markets — a variable-size list, not known at
/// compile time — in one pass. This is the function compiled into the SP1
/// guest for Milestone 2: proving it ran correctly over the batch is what
/// makes the resulting totals trustworthy without revealing any individual
/// note.
pub fn settle_batch(markets: &[MarketNotes]) -> Result<Vec<MarketSettlement>, SettlementError> {
    markets.iter().map(settle_market).collect()
}

fn settle_market(market: &MarketNotes) -> Result<MarketSettlement, SettlementError> {
    if market.num_outcomes == 0 {
        return Err(SettlementError::NoOutcomes { market_id: market.market_id });
    }
    let mut outcome_totals = vec![0u64; market.num_outcomes as usize];

    for note in &market.notes {
        let bucket = outcome_totals
            .get_mut(note.outcome as usize)
            .ok_or(SettlementError::OutcomeOutOfRange { market_id: market.market_id })?;
        *bucket = bucket
            .checked_add(note.amount)
            .ok_or(SettlementError::Overflow { market_id: market.market_id })?;
    }

    let mut total: u64 = 0;
    for t in &outcome_totals {
        total =
            total.checked_add(*t).ok_or(SettlementError::Overflow { market_id: market.market_id })?;
    }

    if total != market.escrowed_collateral {
        return Err(SettlementError::Insolvent { market_id: market.market_id });
    }

    // Reconstruct the commitments-tree root from this market's notes and tie it
    // to the totals: a valid proof means these totals came from exactly the
    // notes under this root.
    Ok(MarketSettlement {
        market_id: market.market_id,
        outcome_totals,
        merkle_root: market.merkle_root_bytes(),
    })
}

// --- Poseidon + Merkle ------------------------------------------------------

/// Poseidon hash of two field elements (matches Noir `bn254::hash_2`).
pub fn hash2(a: Fr, b: Fr) -> Fr {
    let mut h = Poseidon::<Fr>::new_circom(2).expect("poseidon t=3 params");
    h.hash(&[a, b]).expect("poseidon hash_2")
}

/// Poseidon hash of five field elements (matches Noir `bn254::hash_5`).
pub fn hash5(inputs: [Fr; 5]) -> Fr {
    let mut h = Poseidon::<Fr>::new_circom(5).expect("poseidon t=6 params");
    h.hash(&inputs).expect("poseidon hash_5")
}

/// Precomputed roots of all-zero subtrees, one per level: `zeros[0]` is the
/// empty-leaf value (0) and `zeros[i] = hash2(zeros[i-1], zeros[i-1])`. Used to
/// pad a partially-filled fixed-depth tree without materialising 2^depth leaves.
fn zero_hashes() -> [Fr; MERKLE_DEPTH + 1] {
    let mut z = [Fr::from(0u64); MERKLE_DEPTH + 1];
    for i in 1..=MERKLE_DEPTH {
        z[i] = hash2(z[i - 1], z[i - 1]);
    }
    z
}

/// Computes the root of a fixed-depth (`MERKLE_DEPTH`) Poseidon Merkle tree
/// whose leftmost leaves are `leaves` and whose remaining leaves are zero. Only
/// the populated nodes are hashed (O(leaves * depth)), so it is practical even
/// for a depth-20 tree.
pub fn merkle_root(leaves: &[Fr]) -> Fr {
    let zeros = zero_hashes();
    if leaves.is_empty() {
        return zeros[MERKLE_DEPTH];
    }

    let mut level: Vec<Fr> = leaves.to_vec();
    for depth in 0..MERKLE_DEPTH {
        let mut next = Vec::with_capacity(level.len().div_ceil(2));
        let mut i = 0;
        while i < level.len() {
            let left = level[i];
            let right = if i + 1 < level.len() { level[i + 1] } else { zeros[depth] };
            next.push(hash2(left, right));
            i += 2;
        }
        level = next;
    }
    level[0]
}

#[cfg(test)]
mod tests {
    use super::*;
    use ark_ff::{BigInteger, PrimeField};

    fn note(outcome: Outcome, amount: u64) -> Note {
        Note { outcome, amount, secret: [0u8; 32], nullifier_secret: [0u8; 32] }
    }

    // Binary-market outcome convention (matches on-chain Side enum): 0 = No, 1 = Yes.
    const NO: Outcome = 0;
    const YES: Outcome = 1;

    /// A u64 as a 32-byte big-endian field element (for test secrets).
    fn be32(n: u64) -> [u8; 32] {
        let mut b = [0u8; 32];
        b[24..].copy_from_slice(&n.to_be_bytes());
        b
    }

    fn to_hex(f: Fr) -> String {
        let mut s = String::from("0x");
        for b in f.into_bigint().to_bytes_be() {
            s.push_str(&format!("{b:02x}"));
        }
        s
    }

    // --- settlement ---

    #[test]
    fn settles_a_single_solvent_market() {
        let markets = vec![MarketNotes {
            market_id: 0,
            num_outcomes: 2,
            escrowed_collateral: 300,
            notes: vec![note(YES, 100), note(YES, 50), note(NO, 150)],
        }];

        let result = settle_batch(&markets).unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].market_id, 0);
        assert_eq!(result[0].outcome_totals, vec![150, 150]); // [No, Yes]
        assert_eq!(result[0].merkle_root, markets[0].merkle_root_bytes());
    }

    #[test]
    fn settles_a_categorical_market_with_three_outcomes() {
        // e.g. "which of 3 drivers wins" — pool split across 3 buckets.
        let markets = vec![MarketNotes {
            market_id: 9,
            num_outcomes: 3,
            escrowed_collateral: 600,
            notes: vec![note(0, 100), note(2, 300), note(1, 50), note(2, 150)],
        }];

        let result = settle_batch(&markets).unwrap();
        assert_eq!(result[0].outcome_totals, vec![100, 50, 450]);
    }

    #[test]
    fn rejects_outcome_index_at_or_above_num_outcomes() {
        let markets = vec![MarketNotes {
            market_id: 4,
            num_outcomes: 2,
            escrowed_collateral: 100,
            notes: vec![note(2, 100)], // outcome 2 invalid in a 2-outcome market
        }];
        assert_eq!(
            settle_batch(&markets).unwrap_err(),
            SettlementError::OutcomeOutOfRange { market_id: 4 }
        );
    }

    #[test]
    fn settles_a_variable_size_batch_of_markets() {
        let markets = vec![
            MarketNotes {
                market_id: 0,
                num_outcomes: 2,
                escrowed_collateral: 100,
                notes: vec![note(YES, 100)],
            },
            MarketNotes {
                market_id: 1,
                num_outcomes: 2,
                escrowed_collateral: 500,
                notes: vec![note(NO, 200), note(YES, 300)],
            },
            MarketNotes { market_id: 2, num_outcomes: 2, escrowed_collateral: 0, notes: vec![] },
        ];

        let result = settle_batch(&markets).unwrap();

        assert_eq!(result.len(), 3);
        for (i, r) in result.iter().enumerate() {
            assert_eq!(r.market_id, markets[i].market_id);
            assert_eq!(r.merkle_root, markets[i].merkle_root_bytes());
        }
        assert_eq!(result[0].outcome_totals, vec![0, 100]); // [No, Yes]
        assert_eq!(result[1].outcome_totals, vec![200, 300]);
        assert_eq!(result[2].outcome_totals, vec![0, 0]);
    }

    #[test]
    fn rejects_an_empty_batch_gracefully() {
        assert_eq!(settle_batch(&[]).unwrap(), vec![]);
    }

    #[test]
    fn detects_insolvency_when_notes_dont_match_collateral() {
        let markets = vec![MarketNotes {
            market_id: 7,
            num_outcomes: 2,
            escrowed_collateral: 1_000,
            notes: vec![note(YES, 100), note(NO, 100)],
        }];

        let err = settle_batch(&markets).unwrap_err();
        assert_eq!(err, SettlementError::Insolvent { market_id: 7 });
    }

    #[test]
    fn detects_insolvency_in_any_market_of_a_larger_batch() {
        let markets = vec![
            MarketNotes {
                market_id: 0,
                num_outcomes: 2,
                escrowed_collateral: 100,
                notes: vec![note(YES, 100)],
            },
            MarketNotes {
                market_id: 1,
                num_outcomes: 2,
                escrowed_collateral: 999, // doesn't match notes below
                notes: vec![note(NO, 200)],
            },
        ];

        let err = settle_batch(&markets).unwrap_err();
        assert_eq!(err, SettlementError::Insolvent { market_id: 1 });
    }

    #[test]
    fn rejects_amount_overflow_instead_of_wrapping() {
        let markets = vec![MarketNotes {
            market_id: 0,
            num_outcomes: 2,
            escrowed_collateral: u64::MAX,
            notes: vec![note(YES, u64::MAX), note(YES, 1)],
        }];

        let err = settle_batch(&markets).unwrap_err();
        assert_eq!(err, SettlementError::Overflow { market_id: 0 });
    }

    // --- Poseidon compatibility with Noir (fixed vectors from fixture_gen) ---

    #[test]
    fn hash2_matches_noir() {
        // Noir bn254::hash_2([222222, 0])
        assert_eq!(
            to_hex(hash2(Fr::from(222222u64), Fr::from(0u64))),
            "0x0d7b4a7191654350afa3eec27d6216350a8a7733f27035403ab7cea34a015e35"
        );
    }

    #[test]
    fn hash5_matches_noir() {
        // Noir bn254::hash_5([0, 1, 1e18, 111111, 222222])
        assert_eq!(
            to_hex(hash5([
                Fr::from(0u64),
                Fr::from(1u64),
                Fr::from(1_000_000_000_000_000_000u64),
                Fr::from(111111u64),
                Fr::from(222222u64),
            ])),
            "0x061a4960a702e1605e3442b65b6fe17b3ea6b2ca30d7b6135fe1b00b01535252"
        );
    }

    #[test]
    fn note_commitment_matches_noir_fixture() {
        // Same witness as circuits/claim/Prover.toml -> the fixture commitment.
        let n = Note {
            outcome: YES,
            amount: 1_000_000_000_000_000_000,
            secret: be32(111111),
            nullifier_secret: be32(222222),
        };
        assert_eq!(
            to_hex(n.commitment(0)),
            "0x061a4960a702e1605e3442b65b6fe17b3ea6b2ca30d7b6135fe1b00b01535252"
        );
        assert_eq!(
            to_hex(n.nullifier(0)),
            "0x0d7b4a7191654350afa3eec27d6216350a8a7733f27035403ab7cea34a015e35"
        );
    }

    // --- Merkle root reconstruction ---

    #[test]
    fn merkle_root_of_single_leaf_uses_zero_padding() {
        // With one real leaf, every sibling up the tree is the zero-subtree of
        // that level, so the root equals folding the leaf against zeros[depth].
        let leaf = Fr::from(42u64);
        let zeros = zero_hashes();
        let mut expected = leaf;
        for depth in 0..MERKLE_DEPTH {
            expected = hash2(expected, zeros[depth]);
        }
        assert_eq!(merkle_root(&[leaf]), expected);
    }

    #[test]
    fn merkle_root_is_deterministic_and_order_sensitive() {
        let a = [Fr::from(1u64), Fr::from(2u64), Fr::from(3u64)];
        let b = [Fr::from(2u64), Fr::from(1u64), Fr::from(3u64)];
        assert_eq!(merkle_root(&a), merkle_root(&a));
        assert_ne!(merkle_root(&a), merkle_root(&b));
    }

    #[test]
    fn empty_tree_root_is_the_all_zero_subtree() {
        let zeros = zero_hashes();
        assert_eq!(merkle_root(&[]), zeros[MERKLE_DEPTH]);
    }

    #[test]
    fn market_notes_reconstructs_root_from_its_notes() {
        let m = MarketNotes {
            market_id: 3,
            num_outcomes: 2,
            escrowed_collateral: 300,
            notes: vec![note(YES, 100), note(NO, 200)],
        };
        let leaves: Vec<Fr> = m.notes.iter().map(|n| n.commitment(3)).collect();
        assert_eq!(m.merkle_root(), merkle_root(&leaves));
    }
}
