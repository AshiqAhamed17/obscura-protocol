import { toHex } from "viem";
import { nullifier, type Note } from "./note";
import { merklePath } from "./merkle";

/// In-browser Noir claim-proof generation.
///
/// IMPORTANT (needs real-browser testing): the proving libraries must match
/// the toolchain that produced the on-chain verifier — nargo 1.0.0-beta.25 and
/// bb 5.1.0. If @noir-lang/noir_js / @aztec/bb.js versions drift, the proof
/// will be valid locally but fail on-chain. bb.js is browser-only (WASM +
/// threads), so this runs exclusively client-side via dynamic import.

export interface ClaimProof {
  proof: `0x${string}`;
  amount: bigint;
  nullifier: `0x${string}`;
  recipient: `0x${string}`;
  computedRoot: `0x${string}`;
}

export async function generateClaimProof(params: {
  note: Note;
  winningSide: number;
  leaves: bigint[];
  leafIndex: number;
  recipient: `0x${string}`;
}): Promise<ClaimProof> {
  const { note, winningSide, leaves, leafIndex, recipient } = params;

  const path = merklePath(leaves, leafIndex);
  const nul = nullifier(note);
  const recipientField = BigInt(recipient); // address as a field element

  // Load the compiled circuit + proving libs lazily (client-only, heavy WASM).
  const circuit = await fetch("/circuits/claim.json").then((r) => r.json());
  const { Noir } = await import("@noir-lang/noir_js");
  const { UltraHonkBackend } = await import("@aztec/bb.js");

  // Public + private inputs, keyed by the claim circuit's parameter names.
  const inputs = {
    merkle_root: path.root.toString(),
    market_id: note.marketId.toString(),
    winning_side: winningSide.toString(),
    amount: note.amount.toString(),
    nullifier: BigInt(nul).toString(),
    recipient: recipientField.toString(),
    side: note.side.toString(),
    secret: note.secret.toString(),
    nullifier_secret: note.nullifierSecret.toString(),
    path_indices: path.indices.map((x) => x.toString()),
    path_siblings: path.siblings.map((x) => x.toString()),
  } as Record<string, string | string[]>;

  const noir = new Noir(circuit);
  const { witness } = await noir.execute(inputs);

  const backend = new UltraHonkBackend(circuit.bytecode);
  // keccak: EVM-flavored proof, matching `bb ... --oracle_hash keccak`.
  const { proof } = await backend.generateProof(witness, { keccak: true });

  return {
    proof: toHex(proof),
    amount: note.amount,
    nullifier: nul,
    recipient,
    computedRoot: ("0x" + path.root.toString(16).padStart(64, "0")) as `0x${string}`,
  };
}
