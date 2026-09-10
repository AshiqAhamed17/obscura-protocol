import { poseidon2, poseidon5 } from "poseidon-lite";
import { FIELD_MODULUS, Side } from "./contract";

/// A trader's private position. Kept client-side (localStorage) — the holder
/// needs all fields to claim later. Only `commitment()` ever goes on-chain.
export interface Note {
  marketId: bigint;
  side: Side;
  amount: bigint; // USDC base units (6 decimals)
  secret: bigint;
  nullifierSecret: bigint;
  chainId?: number; // which network this position was taken on
}

function randomField(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v % FIELD_MODULUS;
}

/// Poseidon commitment — must match the Noir `Note::commitment` (hash_5 over
/// [market_id, side, amount, secret, nullifier_secret]). poseidon-lite uses the
/// circom-compatible parameters, which are byte-identical to Noir's bn254
/// Poseidon (verified in the aggregation crate's tests).
export function commitment(n: Note): `0x${string}` {
  const h = poseidon5([n.marketId, BigInt(n.side), n.amount, n.secret, n.nullifierSecret]);
  return toBytes32(h);
}

/// Nullifier — matches Noir `Note::nullifier` = hash_2(nullifier_secret, market_id).
export function nullifier(n: Note): `0x${string}` {
  const h = poseidon2([n.nullifierSecret, n.marketId]);
  return toBytes32(h);
}

/// Domain-separated foresight nullifier — matches Noir `Note::foresight_nullifier`
/// = hash_2(nullifier_secret, market_id + FORESIGHT_DOMAIN). Distinct from the
/// spend nullifier so a "I called it" credential is unlinkable to the payout.
export const FORESIGHT_DOMAIN = 0x666f7265736967687400000000000000000000000000000000000000n;
export function foresightNullifier(n: Note): `0x${string}` {
  const h = poseidon2([n.nullifierSecret, n.marketId + FORESIGHT_DOMAIN]);
  return toBytes32(h);
}

export function newNote(marketId: bigint, side: Side, amount: bigint, chainId?: number): Note {
  return { marketId, side, amount, secret: randomField(), nullifierSecret: randomField(), chainId };
}

function toBytes32(v: bigint): `0x${string}` {
  return ("0x" + v.toString(16).padStart(64, "0")) as `0x${string}`;
}

// --- local persistence (a real app would let users export/import notes) ---

const KEY = "obscura.notes";

export interface StoredNote {
  marketId: string;
  side: number;
  amount: string;
  secret: string;
  nullifierSecret: string;
  commitment: string;
  createdAt: number;
  chainId?: number;
}

export function saveNote(n: Note): void {
  const all = loadNotes();
  all.push({
    marketId: n.marketId.toString(),
    side: n.side,
    amount: n.amount.toString(),
    secret: n.secret.toString(),
    nullifierSecret: n.nullifierSecret.toString(),
    commitment: commitment(n),
    createdAt: Date.now(),
    chainId: n.chainId,
  });
  localStorage.setItem(KEY, JSON.stringify(all));
}

/// Import a note from its exported JSON (restore across browsers/devices).
/// Returns false if it's malformed or a duplicate.
export function importNote(json: string): boolean {
  try {
    const p = JSON.parse(json);
    const n: Note = {
      marketId: BigInt(p.marketId),
      side: Number(p.side) as Side,
      amount: BigInt(p.amount),
      secret: BigInt(p.secret),
      nullifierSecret: BigInt(p.nullifierSecret),
      chainId: p.chainId ? Number(p.chainId) : undefined,
    };
    const c = commitment(n);
    if (loadNotes().some((s) => s.commitment === c)) return false; // already have it
    saveNote(n);
    return true;
  } catch {
    return false;
  }
}

export function loadNotes(): StoredNote[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function storedToNote(s: StoredNote): Note {
  return {
    marketId: BigInt(s.marketId),
    side: s.side as Side,
    amount: BigInt(s.amount),
    secret: BigInt(s.secret),
    nullifierSecret: BigInt(s.nullifierSecret),
    chainId: s.chainId,
  };
}

/// Export a note as portable JSON (the holder needs this to claim elsewhere).
export function noteToJson(n: Note): string {
  return JSON.stringify(
    {
      marketId: n.marketId.toString(),
      side: n.side,
      amount: n.amount.toString(),
      secret: n.secret.toString(),
      nullifierSecret: n.nullifierSecret.toString(),
      chainId: n.chainId,
    },
    null,
    2,
  );
}
