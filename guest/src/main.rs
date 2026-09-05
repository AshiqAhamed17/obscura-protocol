//! Obscura SP1 guest program.
//!
//! Reads a variable-size batch of resolved markets (a `Vec<MarketNotes>`, not
//! fixed at compile time), and for each market: sums stakes per side, checks
//! solvency, and reconstructs the commitments-tree Merkle root from the notes.
//! Each `MarketSettlement` (totals + root) is committed as the proof's public
//! values, so a valid proof attests the totals were derived from exactly the
//! notes under each market's on-chain root.
//!
//! Cost note: the Merkle/commitment hashing is Poseidon over BN254 (required
//! for byte-compatibility with the Noir claim circuit and the on-chain root).
//! SP1 has no precompile for arkworks BN254 field arithmetic (its precompiles
//! cover keccak/sha2/sha3, curve25519, k256/p256, secp256k1, substrate-bn,
//! BLS12-381, RSA — not ark-bn254), so each Poseidon hash is ~1M cycles and a
//! single-market batch is ~22M cycles. Provable, but a custom BN254-field
//! precompile is the path to real acceleration (future work).
#![no_main]
sp1_zkvm::entrypoint!(main);

use aggregation::{public_values, settle_batch, MarketNotes, MarketSettlement};

pub fn main() {
    let markets = sp1_zkvm::io::read::<Vec<MarketNotes>>();

    // A batch that is insolvent or overflows cannot be proven — panicking here
    // means no proof is produced, which is the correct outcome.
    let settlements: Vec<MarketSettlement> =
        settle_batch(&markets).expect("batch settlement failed");

    // Commit the settlements ABI-encoded so the on-chain contract can
    // abi.decode the proof's public values directly.
    sp1_zkvm::io::commit_slice(&public_values::encode(&settlements));
}
