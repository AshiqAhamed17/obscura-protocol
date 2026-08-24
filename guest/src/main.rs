//! Obscura SP1 guest program.
//!
//! Milestone 2 will make this settle a variable-size batch of markets and
//! reconstruct each market's Merkle root, committing the proven results as
//! public values. For now (task 2.1) it is a trivial program that proves the
//! SP1 harness — build → execute → read committed output — works end to end.
#![no_main]
sp1_zkvm::entrypoint!(main);

pub fn main() {
    let n = sp1_zkvm::io::read::<u32>();
    sp1_zkvm::io::commit(&(n * 2));
}
