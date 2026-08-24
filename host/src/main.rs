//! Obscura SP1 host runner.
//!
//! Feeds a variable-size market batch to the guest and executes it, checking
//! the guest's committed settlements match the host-side reference computation.
//! Task 2.4 adds `--prove` to generate and locally verify a real proof.

use aggregation::{settle_batch, MarketNotes, MarketSettlement, Note, Side};
use sp1_sdk::blocking::{Prover, ProverClient};
use sp1_sdk::{include_elf, Elf, SP1Stdin};

const GUEST_ELF: Elf = include_elf!("guest");

fn note(side: Side, amount: u64, seed: u64) -> Note {
    let mut secret = [0u8; 32];
    secret[24..].copy_from_slice(&seed.to_be_bytes());
    let mut nullifier_secret = [0u8; 32];
    nullifier_secret[24..].copy_from_slice(&seed.wrapping_add(1).to_be_bytes());
    Note { side, amount, secret, nullifier_secret }
}

/// A single-market batch.
fn one_market() -> Vec<MarketNotes> {
    vec![MarketNotes {
        market_id: 0,
        escrowed_collateral: 300,
        notes: vec![note(Side::Yes, 100, 1), note(Side::Yes, 50, 2), note(Side::No, 150, 3)],
    }]
}

/// A variable-size batch of several markets.
fn several_markets() -> Vec<MarketNotes> {
    vec![
        MarketNotes {
            market_id: 0,
            escrowed_collateral: 100,
            notes: vec![note(Side::Yes, 100, 1)],
        },
        MarketNotes {
            market_id: 1,
            escrowed_collateral: 500,
            notes: vec![note(Side::No, 200, 2), note(Side::Yes, 300, 3)],
        },
        MarketNotes { market_id: 2, escrowed_collateral: 0, notes: vec![] },
    ]
}

fn execute_batch(client: &impl Prover, batch: &[MarketNotes]) -> Vec<MarketSettlement> {
    let mut stdin = SP1Stdin::new();
    stdin.write(&batch.to_vec());

    let (mut public_values, report) =
        client.execute(GUEST_ELF, stdin).run().expect("execution failed");

    println!("  markets: {}, cycles: {}", batch.len(), report.total_instruction_count());
    public_values.read::<Vec<MarketSettlement>>()
}

fn main() {
    sp1_sdk::utils::setup_logger();
    let client = ProverClient::from_env();

    for (label, batch) in [("one market", one_market()), ("several markets", several_markets())] {
        println!("executing: {label}");
        let got = execute_batch(&client, &batch);
        let expected = settle_batch(&batch).expect("reference settlement failed");
        assert_eq!(got, expected, "guest settlement mismatch for {label}");
        println!("  OK: {got:?}");
    }

    println!("SP1 batch settlement OK.");
}
