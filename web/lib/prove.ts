import { toHex } from "viem";
import { foresightNullifier, nullifier, type Note } from "./note";
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
  winningOutcome: number;
  leaves: bigint[];
  leafIndex: number;
  recipient: `0x${string}`;
}): Promise<ClaimProof> {
  const { note, winningOutcome, leaves, leafIndex, recipient } = params;

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
    winning_outcome: winningOutcome.toString(),
    amount: note.amount.toString(),
    nullifier: BigInt(nul).toString(),
    recipient: recipientField.toString(),
    outcome: note.side.toString(),
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

export interface ForesightProof {
  proof: `0x${string}`;
  foresightNullifier: `0x${string}`;
  computedRoot: `0x${string}`;
}

/// In-browser Proof of Foresight — proves the held note backed the winning
/// outcome of a *settled* market, revealing only the domain-separated foresight
/// nullifier. Public-input order matches `ForesightRegistry.proveForesight`:
/// [merkle_root, market_id, winning_outcome, foresight_nullifier].
export async function generateForesightProof(params: {
  note: Note;
  winningOutcome: number;
  leaves: bigint[];
  leafIndex: number;
}): Promise<ForesightProof> {
  const { note, winningOutcome, leaves, leafIndex } = params;

  const path = merklePath(leaves, leafIndex);
  const fNul = foresightNullifier(note);

  const circuit = await fetch("/circuits/foresight.json").then((r) => r.json());
  const { Noir } = await import("@noir-lang/noir_js");
  const { UltraHonkBackend } = await import("@aztec/bb.js");

  const inputs = {
    merkle_root: path.root.toString(),
    market_id: note.marketId.toString(),
    winning_outcome: winningOutcome.toString(),
    foresight_nullifier: BigInt(fNul).toString(),
    outcome: note.side.toString(),
    amount: note.amount.toString(),
    secret: note.secret.toString(),
    nullifier_secret: note.nullifierSecret.toString(),
    path_indices: path.indices.map((x) => x.toString()),
    path_siblings: path.siblings.map((x) => x.toString()),
  } as Record<string, string | string[]>;

  const noir = new Noir(circuit);
  const { witness } = await noir.execute(inputs);

  const backend = new UltraHonkBackend(circuit.bytecode);
  const { proof } = await backend.generateProof(witness, { keccak: true });

  return {
    proof: toHex(proof),
    foresightNullifier: fNul,
    computedRoot: ("0x" + path.root.toString(16).padStart(64, "0")) as `0x${string}`,
  };
}
