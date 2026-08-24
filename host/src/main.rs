//! Obscura SP1 host runner.
//!
//! Task 2.1: execute-only smoke test proving the SP1 build → execute → read
//! pipeline works. Later tasks feed a real market batch and generate/verify a
//! proof.

use sp1_sdk::blocking::{Prover, ProverClient};
use sp1_sdk::{include_elf, Elf, SP1Stdin};

const GUEST_ELF: Elf = include_elf!("guest");

fn main() {
    sp1_sdk::utils::setup_logger();

    let client = ProverClient::from_env();

    let mut stdin = SP1Stdin::new();
    let n: u32 = 5;
    stdin.write(&n);

    let (mut public_values, report) =
        client.execute(GUEST_ELF, stdin).run().expect("execution failed");

    let doubled = public_values.read::<u32>();
    println!("guest committed: {n} * 2 = {doubled}");
    assert_eq!(doubled, n * 2, "guest output mismatch");

    println!("cycles: {}", report.total_instruction_count());
    println!("SP1 harness OK.");
}
