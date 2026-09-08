// Freshness- and provenance-gated subgraph client.
//
// Every read is anchored to the PINNED deployment id and refused if:
//   1. the endpoint returns a different deployment id (provenance mismatch),
//   2. the subgraph reports indexing errors, or
//   3. the head block is older than the staleness threshold.
// A refusal is thrown as an Error — the oracle never reasons over data it
// cannot vouch for.

import {
  PINNED_DEPLOYMENT_ID,
  SUBGRAPH_QUERY_URL,
  MAX_STALENESS_SECONDS,
} from "./config.js";
import type { MarketRow } from "./risk.js";

export interface Provenance {
  deploymentId: string;
  endpoint: string;
  blockNumber: number;
  blockTimestamp: number;
  ageSeconds: number;
  maxStalenessSeconds: number;
  hasIndexingErrors: boolean;
  checkedAt: number;
}

export interface ProtocolTotals {
  marketCount: string;
  resolvedMarketCount: string;
  settledMarketCount: string;
  depositCount: string;
  claimCount: string;
  totalDeposited: bigint;
  totalClaimed: bigint;
  totalSettledYes: bigint;
  totalSettledNo: bigint;
  outstandingEscrow: bigint;
}

export interface SubgraphSnapshot {
  provenance: Provenance;
  protocol: ProtocolTotals | null;
  markets: MarketRow[];
}

const QUERY = `{
  _meta { deployment hasIndexingErrors block { number timestamp } }
  protocolSolvencies(first: 1) {
    marketCount resolvedMarketCount settledMarketCount depositCount claimCount
    totalDeposited totalClaimed totalSettledYes totalSettledNo outstandingEscrow
  }
  markets(first: 1000, orderBy: totalDeposited, orderDirection: desc) {
    marketId status totalDeposited totalClaimed totalYes totalNo
  }
}`;

function bi(v: string | null | undefined): bigint {
  return v == null ? 0n : BigInt(v);
}

export async function fetchGatedSnapshot(opts?: {
  maxStalenessSeconds?: number;
}): Promise<SubgraphSnapshot> {
  const maxStale = opts?.maxStalenessSeconds ?? MAX_STALENESS_SECONDS;

  const res = await fetch(SUBGRAPH_QUERY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY }),
  });
  if (!res.ok) {
    throw new Error(`REFUSED: subgraph endpoint returned HTTP ${res.status}.`);
  }
  const json: any = await res.json();
  if (json.errors) {
    throw new Error(`REFUSED: subgraph GraphQL error: ${JSON.stringify(json.errors)}`);
  }

  const meta = json.data?._meta;
  if (!meta) throw new Error("REFUSED: subgraph returned no _meta block.");

  // (1) provenance pin
  if (meta.deployment !== PINNED_DEPLOYMENT_ID) {
    throw new Error(
      `REFUSED: deployment mismatch. Pinned ${PINNED_DEPLOYMENT_ID}, endpoint served ${meta.deployment}.`,
    );
  }
  // (2) indexing health
  if (meta.hasIndexingErrors) {
    throw new Error(
      `REFUSED: subgraph reports indexing errors at block ${meta.block.number}.`,
    );
  }
  // (3) freshness
  const now = Math.floor(Date.now() / 1000);
  const blockTimestamp = Number(meta.block.timestamp);
  const ageSeconds = Math.max(0, now - blockTimestamp);
  if (ageSeconds > maxStale) {
    throw new Error(
      `REFUSED: data stale. Head block ${meta.block.number} is ${ageSeconds}s old (threshold ${maxStale}s).`,
    );
  }

  const provenance: Provenance = {
    deploymentId: meta.deployment,
    endpoint: SUBGRAPH_QUERY_URL,
    blockNumber: Number(meta.block.number),
    blockTimestamp,
    ageSeconds,
    maxStalenessSeconds: maxStale,
    hasIndexingErrors: false,
    checkedAt: now,
  };

  const p = json.data.protocolSolvencies?.[0];
  const protocol: ProtocolTotals | null = p
    ? {
        marketCount: p.marketCount,
        resolvedMarketCount: p.resolvedMarketCount,
        settledMarketCount: p.settledMarketCount,
        depositCount: p.depositCount,
        claimCount: p.claimCount,
        totalDeposited: bi(p.totalDeposited),
        totalClaimed: bi(p.totalClaimed),
        totalSettledYes: bi(p.totalSettledYes),
        totalSettledNo: bi(p.totalSettledNo),
        outstandingEscrow: bi(p.outstandingEscrow),
      }
    : null;

  const markets: MarketRow[] = (json.data.markets ?? []).map((m: any) => ({
    marketId: m.marketId,
    status: m.status,
    totalDeposited: bi(m.totalDeposited),
    totalClaimed: bi(m.totalClaimed),
    totalYes: m.totalYes == null ? null : bi(m.totalYes),
    totalNo: m.totalNo == null ? null : bi(m.totalNo),
  }));

  return { provenance, protocol, markets };
}
