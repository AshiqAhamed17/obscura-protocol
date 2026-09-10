import { poseidon2, poseidon5 } from "poseidon-lite";
import { FIELD_MODULUS } from "./contract";

/// A shielded parlay position — 3 legs, one stake. Mirrors the Noir `ParlayNote`
/// (nested hash_5 commitment + domain-separated nullifier). Kept client-side.

export const PARLAY_LEGS = 3;
export const PARLAY_DOMAIN = 0x7061726c617900000000000000000000000000000000000000000000n;

export interface ParlayLeg {
  marketId: bigint;
  outcome: number; // 0 = No, 1 = Yes (per leg)
}

export interface ParlayNote {
  legs: ParlayLeg[]; // exactly 3
  amount: bigint; // USDC base units
  secret: bigint;
  nullifierSecret: bigint;
  chainId?: number;
}

function randomField(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v % FIELD_MODULUS;
}

function toBytes32(v: bigint): `0x${string}` {
  return ("0x" + v.toString(16).padStart(64, "0")) as `0x${string}`;
}

/// Poseidon commitment — matches Noir `ParlayNote::commitment`:
///   legs = hash_5([m0, o0, m1, o1, m2]); hash_5([o2, amount, secret, ns, legs]).
export function parlayCommitment(n: ParlayNote): `0x${string}` {
  const [a, b, c] = n.legs;
  const legs = poseidon5([a.marketId, BigInt(a.outcome), b.marketId, BigInt(b.outcome), c.marketId]);
  const h = poseidon5([BigInt(c.outcome), n.amount, n.secret, n.nullifierSecret, legs]);
  return toBytes32(h);
}

/// Nullifier — matches Noir `ParlayNote::nullifier` = hash_2(ns, PARLAY_DOMAIN).
export function parlayNullifier(n: ParlayNote): `0x${string}` {
  return toBytes32(poseidon2([n.nullifierSecret, PARLAY_DOMAIN]));
}

export function newParlayNote(legs: ParlayLeg[], amount: bigint, chainId?: number): ParlayNote {
  return { legs, amount, secret: randomField(), nullifierSecret: randomField(), chainId };
}

// --- persistence ---

const KEY = "obscura.parlays";

interface StoredParlay {
  legs: { marketId: string; outcome: number }[];
  amount: string;
  secret: string;
  nullifierSecret: string;
  commitment: string;
  createdAt: number;
  chainId?: number;
}

export function saveParlay(n: ParlayNote): void {
  const all = loadParlays();
  all.push({
    legs: n.legs.map((l) => ({ marketId: l.marketId.toString(), outcome: l.outcome })),
    amount: n.amount.toString(),
    secret: n.secret.toString(),
    nullifierSecret: n.nullifierSecret.toString(),
    commitment: parlayCommitment(n),
    createdAt: Date.now(),
    chainId: n.chainId,
  });
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function loadParlays(): StoredParlay[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function storedToParlay(s: StoredParlay): ParlayNote {
  return {
    legs: s.legs.map((l) => ({ marketId: BigInt(l.marketId), outcome: l.outcome })),
    amount: BigInt(s.amount),
    secret: BigInt(s.secret),
    nullifierSecret: BigInt(s.nullifierSecret),
    chainId: s.chainId,
  };
}

export function parlayToJson(n: ParlayNote): string {
  return JSON.stringify(
    {
      legs: n.legs.map((l) => ({ marketId: l.marketId.toString(), outcome: l.outcome })),
      amount: n.amount.toString(),
      secret: n.secret.toString(),
      nullifierSecret: n.nullifierSecret.toString(),
      chainId: n.chainId,
    },
    null,
    2,
  );
}
