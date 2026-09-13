//! Obscura SP1 host runner.
//!
//! Default (no args): execute-only — runs the guest over sample batches and
//! checks the committed settlements match the host-side reference (fast, no
//! proof). With `--prove`: generate a real SP1 core proof for a one-market
//! batch, verify it locally, and serialize it to `host/proofs/`.
//!
//!   cargo run --release -p host              # execute-only
//!   cargo run --release -p host -- --prove   # prove + verify + save

use aggregation::{public_values, settle_batch, MarketNotes, Note, Outcome};
use sp1_sdk::blocking::{ProveRequest, Prover, ProverClient};
use sp1_sdk::{include_elf, Elf, HashableKey, ProvingKey, SP1Stdin};

const GUEST_ELF: Elf = include_elf!("guest");
const PROOF_PATH: &str = "host/proofs/batch_proof.bin";

// Binary-market outcome convention (matches the on-chain Side enum): 0 = No, 1 = Yes.
const NO: Outcome = 0;
const YES: Outcome = 1;

fn note(outcome: Outcome, amount: u64, seed: u64) -> Note {
    let mut secret = [0u8; 32];
    secret[24..].copy_from_slice(&seed.to_be_bytes());
    let mut nullifier_secret = [0u8; 32];
    nullifier_secret[24..].copy_from_slice(&seed.wrapping_add(1).to_be_bytes());
    Note { outcome, amount, secret, nullifier_secret }
}

fn one_market() -> Vec<MarketNotes> {
    vec![MarketNotes {
        market_id: 0,
        num_outcomes: 2,
        escrowed_collateral: 300,
        notes: vec![note(YES, 100, 1), note(YES, 50, 2), note(NO, 150, 3)],
    }]
}

fn several_markets() -> Vec<MarketNotes> {
    vec![
        MarketNotes {
            market_id: 0,
            num_outcomes: 2,
            escrowed_collateral: 100,
            notes: vec![note(YES, 100, 1)],
        },
        MarketNotes {
            market_id: 1,
            num_outcomes: 2,
            escrowed_collateral: 500,
            notes: vec![note(NO, 200, 2), note(YES, 300, 3)],
        },
        MarketNotes { market_id: 2, num_outcomes: 2, escrowed_collateral: 0, notes: vec![] },
    ]
}

fn stdin_for(batch: &[MarketNotes]) -> SP1Stdin {
    let mut stdin = SP1Stdin::new();
    stdin.write(&batch.to_vec());
    stdin
}

fn hexs(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// Parse a 0x-prefixed hex string into a big-endian 32-byte field element.
fn hex32(s: &str) -> [u8; 32] {
    let s = s.trim().trim_start_matches("0x");
    let raw: Vec<u8> =
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("bad hex")).collect();
    let mut out = [0u8; 32];
    let start = 32 - raw.len();
    out[start..].copy_from_slice(&raw);
    out
}

/// Build a REAL one-market settlement batch from env vars, so a live on-chain
/// market can be settled with a genuine proof (secrets stay out of the repo).
/// Required: OBSCURA_MARKET_ID, OBSCURA_OUTCOME, OBSCURA_AMOUNT, OBSCURA_ESCROW,
/// OBSCURA_SECRET_HEX, OBSCURA_NS_HEX. Optional: OBSCURA_NUM_OUTCOMES (default 2).
/// Returns None if the required vars are absent (falls back to the sample batch).
fn batch_from_env() -> Option<Vec<MarketNotes>> {
    let market_id: u64 = std::env::var("OBSCURA_MARKET_ID").ok()?.parse().ok()?;
    let outcome: Outcome = std::env::var("OBSCURA_OUTCOME").ok()?.parse().ok()?;
    let amount: u64 = std::env::var("OBSCURA_AMOUNT").ok()?.parse().ok()?;
    let escrow: u64 = std::env::var("OBSCURA_ESCROW").ok()?.parse().ok()?;
    let secret = std::env::var("OBSCURA_SECRET_HEX").ok()?;
    let ns = std::env::var("OBSCURA_NS_HEX").ok()?;
    let num_outcomes: u8 =
        std::env::var("OBSCURA_NUM_OUTCOMES").ok().and_then(|v| v.parse().ok()).unwrap_or(2);
    Some(vec![MarketNotes {
        market_id,
        num_outcomes,
        escrowed_collateral: escrow,
        notes: vec![Note { outcome, amount, secret: hex32(&secret), nullifier_secret: hex32(&ns) }],
    }])
}

fn execute_all(client: &impl Prover) {
    for (label, batch) in [("one market", one_market()), ("several markets", several_markets())] {
        println!("executing: {label}");
        let (pv, report) =
            client.execute(GUEST_ELF, stdin_for(&batch)).run().expect("execution failed");
        let got = public_values::decode(pv.as_slice());
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
    let committed = public_values::decode(proof.public_values.as_slice());
    assert_eq!(committed, expected, "committed public values mismatch");
    println!("committed public values: {committed:?}");

    std::fs::create_dir_all("host/proofs").expect("create proofs dir");
    proof.save(PROOF_PATH).expect("save proof failed");
    println!("proof + public values saved to {PROOF_PATH}");
}

/// Writes the ABI-encoded public values for the `several_markets` batch to a
/// fixture so the Foundry tests can `abi.decode` real Rust-produced bytes
/// (cross-tool ABI compatibility check + input for the settleWithProof test).
fn dump_values() {
    let batch = several_markets();
    let settlements = settle_batch(&batch).expect("reference settlement failed");
    let encoded = public_values::encode(&settlements);
    std::fs::create_dir_all("contracts/test/fixtures").expect("create fixtures dir");
    std::fs::write("contracts/test/fixtures/sample_public_values.bin", &encoded)
        .expect("write fixture");
    println!("wrote {} bytes of ABI-encoded public values", encoded.len());
    println!("settlements: {settlements:?}");
}

/// Generates an EVM-verifiable Groth16 proof of the batch and writes the
/// artifacts needed to settle on-chain: the proof bytes and ABI-encoded public
/// values (feed straight into `PredictionMarket.settleWithProof`), plus the
/// program verifying-key hash for the contract's `programVKey`.
///
/// Groth16 proving is heavy — run it on the Succinct Prover Network:
///   SP1_PROVER=network NETWORK_PRIVATE_KEY=0x... cargo run --release -p host -- --evm
fn prove_evm(client: &impl Prover) {
    // Prefer a real on-chain market batch from env; fall back to the sample.
    let (batch, real) = match batch_from_env() {
        Some(b) => (b, true),
        None => (one_market(), false),
    };
    println!("batch source: {}", if real { "REAL (env)" } else { "sample one_market()" });
    let expected = settle_batch(&batch).expect("reference settlement failed");
    println!("expected settlements: {expected:?}");

    let pk = client.setup(GUEST_ELF).expect("setup failed");
    println!("programVKey: {}", pk.verifying_key().bytes32());

    println!("generating Groth16 (EVM) proof... (this is the heavy step)");
    let proof = client.prove(&pk, stdin_for(&batch)).groth16().run().expect("groth16 proving failed");

    client.verify(&proof, pk.verifying_key(), None).expect("verification failed");
    println!("proof verified locally.");

    std::fs::create_dir_all("host/proofs").expect("create proofs dir");
    std::fs::write("host/proofs/batch_proof_evm.bin", proof.bytes()).expect("write proof");
    std::fs::write("host/proofs/batch_public_values.bin", proof.public_values.as_slice())
        .expect("write public values");

    // Print both as 0x-hex so they can be fed straight to settleWithProof.
    println!("\n================ COPY THESE TO settleWithProof ================");
    println!("PUBLIC_VALUES_HEX=0x{}", hexs(proof.public_values.as_slice()));
    println!("PROOF_HEX=0x{}", hexs(&proof.bytes()));
    println!("==============================================================");
}

/// Prints the batch-settlement program's verifying-key hash (`programVKey`).
/// This only derives the key from the guest ELF — it does NOT prove, so it's
/// cheap and fits any machine. Use the value for the contract's `programVKey`
/// constructor arg (see contracts/DEPLOY.md).
fn print_vkey(client: &impl Prover) {
    let pk = client.setup(GUEST_ELF).expect("setup failed");
    println!("programVKey: {}", pk.verifying_key().bytes32());
}

fn main() {
    sp1_sdk::utils::setup_logger();
    let args: Vec<String> = std::env::args().collect();

    if args.iter().any(|a| a == "--dump-values") {
        dump_values();
        return;
    }

    let client = ProverClient::from_env();
    if args.iter().any(|a| a == "--vkey") {
        print_vkey(&client);
    } else if args.iter().any(|a| a == "--evm") {
        prove_evm(&client);
    } else if args.iter().any(|a| a == "--prove") {
        prove_one(&client);
    } else {
        execute_all(&client);
    }
}
