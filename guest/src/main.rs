//! Obscura SP1 guest program.
//!
//! Reads a variable-size batch of resolved markets (a `Vec<MarketNotes>`, not
//! fixed at compile time), settles every market — summing stakes per side and
//! checking each market is solvent — and commits the per-market results as the
//! proof's public values. Task 2.3 adds the reconstructed Merkle root to each
//! result so the totals are tied to each market's on-chain commitments root.
#![no_main]
sp1_zkvm::entrypoint!(main);

use aggregation::{settle_batch, MarketNotes, MarketSettlement};

pub fn main() {
    let markets = sp1_zkvm::io::read::<Vec<MarketNotes>>();

    // A batch that is insolvent or overflows cannot be proven — panicking here
    // means no proof is produced, which is the correct outcome.
    let settlements: Vec<MarketSettlement> =
        settle_batch(&markets).expect("batch settlement failed");

    sp1_zkvm::io::commit(&settlements);
}
