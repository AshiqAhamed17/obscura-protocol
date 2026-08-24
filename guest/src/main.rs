//! Placeholder for the Milestone 2 SP1 guest program.
//!
//! This currently builds as an ordinary binary so the workspace compiles
//! without the SP1 toolchain installed. It already exercises the two things
//! the real guest will prove — batch settlement and Merkle-root
//! reconstruction — over a placeholder input. See `README.md` in this
//! directory for what changes when this becomes a real `sp1-zkvm` guest.

use aggregation::{settle_batch, Fr, MarketNotes, Note, Side};

fn main() {
    // Placeholder input, standing in for `sp1_zkvm::io::read()` once this is
    // a real guest program — a variable-size batch of markets, not fixed at
    // compile time.
    let markets = vec![MarketNotes {
        market_id: 0,
        escrowed_collateral: 150,
        notes: vec![
            Note { side: Side::Yes, amount: 100, secret: Fr::from(1u64), nullifier_secret: Fr::from(2u64) },
            Note { side: Side::No, amount: 50, secret: Fr::from(3u64), nullifier_secret: Fr::from(4u64) },
        ],
    }];

    let settlements = settle_batch(&markets).expect("batch settlement failed");
    let root = markets[0].merkle_root();
    println!("{settlements:?}");
    println!("root = {root}");
}
