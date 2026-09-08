// Builds JSON-serializable reports (bigint -> string) shared by the MCP server
// and the CLI. Each builder fetches a freshness/provenance-gated snapshot and
// runs the pure risk math over it.

import { fetchGatedSnapshot } from "./subgraph.js";
import { fetchBenchmark } from "./messari.js";
import {
  assessRisk,
  compareConcentration,
  computeConcentration,
  computeSolvency,
  herfindahl,
  type MarketRow,
} from "./risk.js";

function marketOut(m: MarketRow) {
  return {
    marketId: m.marketId,
    status: m.status,
    totalDeposited: m.totalDeposited.toString(),
    totalClaimed: m.totalClaimed.toString(),
    totalYes: m.totalYes?.toString() ?? null,
    totalNo: m.totalNo?.toString() ?? null,
  };
}

export async function solvencySnapshot(opts?: { maxStalenessSeconds?: number }) {
  const snap = await fetchGatedSnapshot(opts);
  const totalDeposited = snap.protocol?.totalDeposited ?? 0n;
  const totalClaimed = snap.protocol?.totalClaimed ?? 0n;
  const solvency = computeSolvency(totalDeposited, totalClaimed, snap.markets);
  return {
    provenance: snap.provenance,
    totals: {
      marketCount: snap.protocol?.marketCount ?? "0",
      resolvedMarketCount: snap.protocol?.resolvedMarketCount ?? "0",
      settledMarketCount: snap.protocol?.settledMarketCount ?? "0",
      depositCount: snap.protocol?.depositCount ?? "0",
      claimCount: snap.protocol?.claimCount ?? "0",
      totalDeposited: totalDeposited.toString(),
      totalClaimed: totalClaimed.toString(),
      outstandingEscrow: (snap.protocol?.outstandingEscrow ?? 0n).toString(),
    },
    solvency: {
      backedFunds: solvency.backedFunds.toString(),
      settledObligations: solvency.settledObligations.toString(),
      coverageRatio: solvency.coverageRatio,
      verdict: solvency.verdict,
      rationale: solvency.rationale,
    },
  };
}

export async function concentrationReport(opts?: {
  maxStalenessSeconds?: number;
  topN?: number;
}) {
  const snap = await fetchGatedSnapshot(opts);
  const concentration = computeConcentration(snap.markets);
  const topN = opts?.topN ?? 5;
  return {
    provenance: snap.provenance,
    concentration,
    topMarkets: snap.markets
      .filter((m) => m.totalDeposited > 0n)
      .slice(0, topN)
      .map(marketOut),
  };
}

// Task 2.3 — composition: our Studio subgraph + a published Messari standardized
// subgraph, benchmarking Obscura's concentration against live mainnet DeFi.
export async function benchmarkReport(opts?: { maxStalenessSeconds?: number }) {
  const [obscura, bench] = await Promise.all([
    fetchGatedSnapshot(opts),
    fetchBenchmark(opts),
  ]);

  const obscuraConc = computeConcentration(obscura.markets);
  const benchHhi = herfindahl(bench.marketTvlsUSD);
  const comparison = compareConcentration(
    obscuraConc.hhi,
    obscuraConc.activeMarketCount,
    bench.protocolName,
    benchHhi.hhi,
    benchHhi.fundedCount,
  );

  return {
    composition: [
      { role: "subject", source: "Obscura (Subgraph Studio)", provenance: obscura.provenance },
      { role: "benchmark", source: bench.provenance.source, provenance: bench.provenance },
    ],
    obscura: {
      concentration: obscuraConc,
      totalDepositedBaseUnits: (obscura.protocol?.totalDeposited ?? 0n).toString(),
    },
    benchmark: {
      protocolName: bench.protocolName,
      tvlUSD: bench.tvlUSD,
      hhi: benchHhi.hhi,
      fundedMarkets: benchHhi.fundedCount,
      topShare: benchHhi.topShare,
      topMarkets: bench.topMarkets,
    },
    comparison,
  };
}

export async function protocolRisk(opts?: { maxStalenessSeconds?: number }) {
  const snap = await fetchGatedSnapshot(opts);
  const totalDeposited = snap.protocol?.totalDeposited ?? 0n;
  const totalClaimed = snap.protocol?.totalClaimed ?? 0n;
  const assessment = assessRisk(totalDeposited, totalClaimed, snap.markets);
  return {
    provenance: snap.provenance,
    totals: {
      marketCount: snap.protocol?.marketCount ?? "0",
      resolvedMarketCount: snap.protocol?.resolvedMarketCount ?? "0",
      settledMarketCount: snap.protocol?.settledMarketCount ?? "0",
      totalDeposited: totalDeposited.toString(),
      totalClaimed: totalClaimed.toString(),
      outstandingEscrow: (snap.protocol?.outstandingEscrow ?? 0n).toString(),
    },
    assessment: {
      overallRisk: assessment.overallRisk,
      rationale: assessment.rationale,
      solvency: {
        backedFunds: assessment.solvency.backedFunds.toString(),
        settledObligations: assessment.solvency.settledObligations.toString(),
        coverageRatio: assessment.solvency.coverageRatio,
        verdict: assessment.solvency.verdict,
        rationale: assessment.solvency.rationale,
      },
      concentration: assessment.concentration,
    },
  };
}
