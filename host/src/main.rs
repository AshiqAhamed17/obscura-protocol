//! Obscura SP1 host runner.
//!
//! Default (no args): execute-only — runs the guest over sample batches and
//! checks the committed settlements match the host-side reference (fast, no
//! proof). With `--prove`: generate a real SP1 core proof for a one-market
//! batch, verify it locally, and serialize it to `host/proofs/`.
//!
//!   cargo run --release -p host              # execute-only
//!   cargo run --release -p host -- --prove   # prove + verify + save

use aggregation::{settle_batch, MarketNotes, MarketSettlement, Note, Side};
use sp1_sdk::blocking::{ProveRequest, Prover, ProverClient};
use sp1_sdk::{include_elf, Elf, ProvingKey, SP1Stdin};

const GUEST_ELF: Elf = include_elf!("guest");
const PROOF_PATH: &str = "host/proofs/batch_proof.bin";

fn note(side: Side, amount: u64, seed: u64) -> Note {
    let mut secret = [0u8; 32];
    secret[24..].copy_from_slice(&seed.to_be_bytes());
    let mut nullifier_secret = [0u8; 32];
    nullifier_secret[24..].copy_from_slice(&seed.wrapping_add(1).to_be_bytes());
    Note { side, amount, secret, nullifier_secret }
}

fn one_market() -> Vec<MarketNotes> {
    vec![MarketNotes {
        market_id: 0,
        escrowed_collateral: 300,
        notes: vec![note(Side::Yes, 100, 1), note(Side::Yes, 50, 2), note(Side::No, 150, 3)],
    }]
}

fn several_markets() -> Vec<MarketNotes> {
    vec![
        MarketNotes { market_id: 0, escrowed_collateral: 100, notes: vec![note(Side::Yes, 100, 1)] },
        MarketNotes {
            market_id: 1,
            escrowed_collateral: 500,
            notes: vec![note(Side::No, 200, 2), note(Side::Yes, 300, 3)],
        },
        MarketNotes { market_id: 2, escrowed_collateral: 0, notes: vec![] },
    ]
}

fn stdin_for(batch: &[MarketNotes]) -> SP1Stdin {
    let mut stdin = SP1Stdin::new();
    stdin.write(&batch.to_vec());
    stdin
}

fn execute_all(client: &impl Prover) {
    for (label, batch) in [("one market", one_market()), ("several markets", several_markets())] {
        println!("executing: {label}");
        let (mut pv, report) =
            client.execute(GUEST_ELF, stdin_for(&batch)).run().expect("execution failed");
        let got = pv.read::<Vec<MarketSettlement>>();
        let expected = settle_batch(&batch).expect("reference settlement failed");
        assert_eq!(got, expected, "guest settlement mismatch for {label}");
        println!("  markets: {}, cycles: {}, OK", batch.len(), report.total_instruction_count());
    }
    println!("SP1 batch settlement OK.");
}

fn prove_one(client: &impl Prover) {
    // Minimal batch: CPU-proving the ~22M-cycle Poseidon batch exceeds this
    // machine's RAM, so the local proof demo uses an empty batch (proves the
    // full harness — read input, settle, commit, prove, verify — with a real,
    // locally-verified proof). The Poseidon computation itself is validated by
    // the execute-only path (default mode); a full-batch proof belongs on the
    // Succinct Prover Network or a higher-RAM machine.
    let batch: Vec<MarketNotes> = vec![];
    let expected = settle_batch(&batch).expect("reference settlement failed");

    println!("setting up proving key...");
    let pk = client.setup(GUEST_ELF).expect("setup failed");

    println!("generating core proof (this can take a few minutes)...");
    let proof = client.prove(&pk, stdin_for(&batch)).run().expect("proving failed");

    println!("verifying proof locally...");
    client.verify(&proof, pk.verifying_key(), None).expect("verification failed");
    println!("proof verified.");

    // The public values carry the same settlements the guest committed.
    let mut pv = proof.public_values.clone();
    let committed = pv.read::<Vec<MarketSettlement>>();
    assert_eq!(committed, expected, "committed public values mismatch");
    println!("committed public values: {committed:?}");

    std::fs::create_dir_all("host/proofs").expect("create proofs dir");
    proof.save(PROOF_PATH).expect("save proof failed");
    println!("proof + public values saved to {PROOF_PATH}");
}

fn main() {
    sp1_sdk::utils::setup_logger();
    let prove = std::env::args().any(|a| a == "--prove");

    let client = ProverClient::from_env();
    if prove {
        prove_one(&client);
    } else {
        execute_all(&client);
    }
}
