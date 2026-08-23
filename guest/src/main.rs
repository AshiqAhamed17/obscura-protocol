//! Placeholder for the Milestone 2 SP1 guest program.
//!
//! This currently builds as an ordinary binary so the workspace compiles
//! without the SP1 toolchain installed. See `README.md` in this directory
//! for what changes when this becomes a real `sp1-zkvm` guest program.

use aggregation::{settle_batch, MarketNotes, Note, Side};

fn main() {
    // Placeholder input, standing in for `sp1_zkvm::io::read()` once this is
    // a real guest program — a variable-size batch of markets, not fixed at
    // compile time.
    let markets = vec![MarketNotes {
        market_id: 0,
        escrowed_collateral: 150,
        notes: vec![Note { side: Side::Yes, amount: 100 }, Note { side: Side::No, amount: 50 }],
    }];

    let settlements = settle_batch(&markets).expect("batch settlement failed");
    println!("{settlements:?}");
}
