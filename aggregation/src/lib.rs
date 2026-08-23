//! Batch settlement logic for Obscura Protocol.
//!
//! This crate is plain Rust with no SP1 dependency, unit-tested on its own,
//! then compiled unmodified into the `guest` crate's SP1 program (Milestone
//! 2). Keeping the algorithm here — rather than writing it directly inside
//! the SP1 guest — means it can be tested fast, without a prover, and the
//! guest stays a thin wrapper around it.
//!
//! Per-note Merkle-membership verification (against each market's on-chain
//! commitment root) is added here once the Noir note format lands in
//! Milestone 1; for now this crate settles a batch of already-known notes.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Yes,
    No,
}

#[derive(Debug, Clone, Copy)]
pub struct Note {
    pub side: Side,
    pub amount: u64,
}

/// One resolved market's full set of committed notes, ready to settle.
#[derive(Debug, Clone)]
pub struct MarketNotes {
    pub market_id: u64,
    pub escrowed_collateral: u64,
    pub notes: Vec<Note>,
}

/// The proven, public result of settling one market.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MarketSettlement {
    pub market_id: u64,
    pub total_yes: u64,
    pub total_no: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SettlementError {
    /// The notes' amounts don't sum to the market's escrowed collateral —
    /// the operator either fabricated or dropped a note.
    Insolvent { market_id: u64 },
    /// Summing amounts overflowed u64 — reject rather than wrap.
    Overflow { market_id: u64 },
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
    let mut total_yes: u64 = 0;
    let mut total_no: u64 = 0;

    for note in &market.notes {
        let bucket = match note.side {
            Side::Yes => &mut total_yes,
            Side::No => &mut total_no,
        };
        *bucket = bucket
            .checked_add(note.amount)
            .ok_or(SettlementError::Overflow { market_id: market.market_id })?;
    }

    let total = total_yes
        .checked_add(total_no)
        .ok_or(SettlementError::Overflow { market_id: market.market_id })?;

    if total != market.escrowed_collateral {
        return Err(SettlementError::Insolvent { market_id: market.market_id });
    }

    Ok(MarketSettlement { market_id: market.market_id, total_yes, total_no })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(side: Side, amount: u64) -> Note {
        Note { side, amount }
    }

    #[test]
    fn settles_a_single_solvent_market() {
        let markets = vec![MarketNotes {
            market_id: 0,
            escrowed_collateral: 300,
            notes: vec![note(Side::Yes, 100), note(Side::Yes, 50), note(Side::No, 150)],
        }];

        let result = settle_batch(&markets).unwrap();

        assert_eq!(
            result,
            vec![MarketSettlement { market_id: 0, total_yes: 150, total_no: 150 }]
        );
    }

    #[test]
    fn settles_a_variable_size_batch_of_markets() {
        let markets = vec![
            MarketNotes {
                market_id: 0,
                escrowed_collateral: 100,
                notes: vec![note(Side::Yes, 100)],
            },
            MarketNotes {
                market_id: 1,
                escrowed_collateral: 500,
                notes: vec![note(Side::No, 200), note(Side::Yes, 300)],
            },
            MarketNotes { market_id: 2, escrowed_collateral: 0, notes: vec![] },
        ];

        let result = settle_batch(&markets).unwrap();

        assert_eq!(result.len(), 3);
        assert_eq!(result[0], MarketSettlement { market_id: 0, total_yes: 100, total_no: 0 });
        assert_eq!(result[1], MarketSettlement { market_id: 1, total_yes: 300, total_no: 200 });
        assert_eq!(result[2], MarketSettlement { market_id: 2, total_yes: 0, total_no: 0 });
    }

    #[test]
    fn rejects_an_empty_batch_gracefully() {
        assert_eq!(settle_batch(&[]).unwrap(), vec![]);
    }

    #[test]
    fn detects_insolvency_when_notes_dont_match_collateral() {
        let markets = vec![MarketNotes {
            market_id: 7,
            escrowed_collateral: 1_000,
            notes: vec![note(Side::Yes, 100), note(Side::No, 100)],
        }];

        let err = settle_batch(&markets).unwrap_err();
        assert_eq!(err, SettlementError::Insolvent { market_id: 7 });
    }

    #[test]
    fn detects_insolvency_in_any_market_of_a_larger_batch() {
        let markets = vec![
            MarketNotes {
                market_id: 0,
                escrowed_collateral: 100,
                notes: vec![note(Side::Yes, 100)],
            },
            MarketNotes {
                market_id: 1,
                escrowed_collateral: 999, // doesn't match notes below
                notes: vec![note(Side::No, 200)],
            },
        ];

        let err = settle_batch(&markets).unwrap_err();
        assert_eq!(err, SettlementError::Insolvent { market_id: 1 });
    }

    #[test]
    fn rejects_amount_overflow_instead_of_wrapping() {
        let markets = vec![MarketNotes {
            market_id: 0,
            escrowed_collateral: u64::MAX,
            notes: vec![note(Side::Yes, u64::MAX), note(Side::Yes, 1)],
        }];

        let err = settle_batch(&markets).unwrap_err();
        assert_eq!(err, SettlementError::Overflow { market_id: 0 });
    }
}
