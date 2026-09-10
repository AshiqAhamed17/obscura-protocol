import { SUBGRAPH_URL } from "./contract";

/// Browser port of the `agent/` risk oracle: fetch the Obscura subgraph, verify
/// provenance + freshness, and compute the same solvency-coverage + HHI
/// concentration verdict. No key needed (Studio dev query endpoint is public).

export const PINNED_DEPLOYMENT = "QmRVbZNT9mDmJxez7VnhARRgF52nfdTy8KjoiJQmGmYcf3";
const MAX_STALENESS = 900;

export interface Provenance {
  deployment: string;
  matchesPinned: boolean;
  block: number;
  ageSeconds: number;
  hasIndexingErrors: boolean;
}
export interface MarketAgg {
  marketId: string;
  status: string;
  totalDeposited: bigint;
  totalClaimed: bigint;
  totalYes: bigint | null;
  totalNo: bigint | null;
}
export type SolvencyVerdict = "SOLVENT" | "WATCH" | "INSOLVENT";
export type ConcVerdict = "DIVERSE" | "MODERATE" | "CONCENTRATED" | "HIGHLY_CONCENTRATED" | "EMPTY";
export type RiskLevel = "LOW" | "ELEVATED" | "HIGH" | "CRITICAL";

export interface RiskReport {
  provenance: Provenance;
  totals: { marketCount: string; resolvedMarketCount: string; settledMarketCount: string; totalDeposited: bigint; totalClaimed: bigint; outstandingEscrow: bigint };
  solvency: { backedFunds: bigint; settledObligations: bigint; coverageRatio: number | null; verdict: SolvencyVerdict; rationale: string };
  concentration: { hhi: number; activeMarketCount: number; topMarketId: string | null; topShare: number; verdict: ConcVerdict; rationale: string };
  overallRisk: RiskLevel;
}

const QUERY = `{
  _meta { deployment hasIndexingErrors block { number timestamp } }
  protocolSolvencies(first: 1) { marketCount resolvedMarketCount settledMarketCount totalDeposited totalClaimed outstandingEscrow }
  markets(first: 1000, orderBy: totalDeposited, orderDirection: desc) { marketId status totalDeposited totalClaimed totalYes totalNo }
}`;

function bi(v: string | null | undefined): bigint {
  return v == null ? 0n : BigInt(v);
}

export async function fetchRiskReport(): Promise<RiskReport> {
  const res = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY }),
  });
  if (!res.ok) throw new Error(`subgraph HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(`subgraph error: ${JSON.stringify(json.errors)}`);
  const meta = json.data._meta;
  const now = Math.floor(Date.now() / 1000);
  const ageSeconds = Math.max(0, now - Number(meta.block.timestamp));

  const provenance: Provenance = {
    deployment: meta.deployment,
    matchesPinned: meta.deployment === PINNED_DEPLOYMENT,
    block: Number(meta.block.number),
    ageSeconds,
    hasIndexingErrors: !!meta.hasIndexingErrors,
  };

  const p = json.data.protocolSolvencies?.[0];
  const markets: MarketAgg[] = (json.data.markets ?? []).map((m: Record<string, string>) => ({
    marketId: m.marketId,
    status: m.status,
    totalDeposited: bi(m.totalDeposited),
    totalClaimed: bi(m.totalClaimed),
    totalYes: m.totalYes == null ? null : bi(m.totalYes),
    totalNo: m.totalNo == null ? null : bi(m.totalNo),
  }));

  const totalDeposited = bi(p?.totalDeposited);
  const totalClaimed = bi(p?.totalClaimed);
  const solvency = computeSolvency(totalDeposited, totalClaimed, markets);
  const concentration = computeConcentration(markets);

  let overallRisk: RiskLevel;
  if (solvency.verdict === "INSOLVENT") overallRisk = "CRITICAL";
  else if (solvency.verdict === "WATCH") overallRisk = concentration.verdict === "HIGHLY_CONCENTRATED" ? "HIGH" : "ELEVATED";
  else overallRisk = concentration.verdict === "HIGHLY_CONCENTRATED" ? "ELEVATED" : "LOW";

  return {
    provenance,
    totals: {
      marketCount: p?.marketCount ?? "0",
      resolvedMarketCount: p?.resolvedMarketCount ?? "0",
      settledMarketCount: p?.settledMarketCount ?? "0",
      totalDeposited,
      totalClaimed,
      outstandingEscrow: bi(p?.outstandingEscrow),
    },
    solvency,
    concentration,
    overallRisk,
  };
}

export function isStale(p: Provenance): boolean {
  return p.ageSeconds > MAX_STALENESS || p.hasIndexingErrors || !p.matchesPinned;
}

function ratio(n: bigint, d: bigint): number | null {
  if (d === 0n) return null;
  return Number((n * 10000n) / d) / 10000;
}

function computeSolvency(totalDeposited: bigint, totalClaimed: bigint, markets: MarketAgg[]): RiskReport["solvency"] {
  const backedFunds = totalDeposited - totalClaimed;
  let settledObligations = 0n;
  for (const m of markets) {
    if (m.status !== "Settled") continue;
    const pool = (m.totalYes ?? 0n) + (m.totalNo ?? 0n);
    const owed = pool - m.totalClaimed;
    if (owed > 0n) settledObligations += owed;
  }
  const coverageRatio = ratio(backedFunds, settledObligations);
  let verdict: SolvencyVerdict;
  let rationale: string;
  if (backedFunds < 0n) { verdict = "INSOLVENT"; rationale = "More has been claimed than deposited."; }
  else if (settledObligations === 0n) { verdict = "SOLVENT"; rationale = "No settled obligations outstanding; all escrow is unencumbered."; }
  else if (coverageRatio! >= 1) { verdict = "SOLVENT"; rationale = `Escrow covers settled obligations at ${coverageRatio}× coverage.`; }
  else if (coverageRatio! >= 0.98) { verdict = "WATCH"; rationale = `Coverage ${coverageRatio}× is within a thin margin — monitor.`; }
  else { verdict = "INSOLVENT"; rationale = `Escrow below settled obligations; coverage only ${coverageRatio}×.`; }
  return { backedFunds, settledObligations, coverageRatio, verdict, rationale };
}

function computeConcentration(markets: MarketAgg[]): RiskReport["concentration"] {
  const active = markets.filter((m) => m.totalDeposited > 0n);
  const total = active.reduce((a, m) => a + m.totalDeposited, 0n);
  if (total === 0n) return { hhi: 0, activeMarketCount: 0, topMarketId: null, topShare: 0, verdict: "EMPTY", rationale: "No market currently holds deposits." };
  let hhi = 0, topShare = 0;
  let topMarketId: string | null = null;
  for (const m of active) {
    const share = Number((m.totalDeposited * 1000000n) / total) / 1000000;
    hhi += share * share;
    if (share > topShare) { topShare = share; topMarketId = m.marketId; }
  }
  hhi = Math.round(hhi * 10000) / 10000;
  topShare = Math.round(topShare * 10000) / 10000;
  let verdict: ConcVerdict;
  if (hhi > 0.5) verdict = "HIGHLY_CONCENTRATED";
  else if (hhi > 0.25) verdict = "CONCENTRATED";
  else if (hhi > 0.15) verdict = "MODERATE";
  else verdict = "DIVERSE";
  return { hhi, activeMarketCount: active.length, topMarketId, topShare, verdict, rationale: `HHI ${hhi} across ${active.length} funded market(s); largest is market ${topMarketId} at ${(topShare * 100).toFixed(1)}%.` };
}

/// The composable benchmark from the agent's real run (Aave v2 mainnet, via the
/// Messari-standardized subgraph + The Graph gateway). Shown as evidence — the
/// live gateway call needs a keyed request, run server-side by `agent/`.
export const MESSARI_BENCHMARK = { name: "Aave v2 (Ethereum, Messari standardized)", hhi: 0.16, fundedMarkets: 37, tvlUSD: 97_600_000 };
