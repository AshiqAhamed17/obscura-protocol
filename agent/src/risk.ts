// Pure risk math over PUBLIC AGGREGATE subgraph data. No I/O, fully unit-tested.
//
// Solvency model (aggregate monitoring layer):
//   Obscura pools are pari-mutuel, so per-note solvency is enforced by the SP1
//   proof at settlement. This oracle is a PUBLIC monitoring layer over the
//   aggregates the subgraph exposes. It checks that the escrow the protocol
//   still holds covers what it still owes on already-settled markets:
//     backedFunds       = totalDeposited - totalClaimed        (escrow on hand)
//     settledObligations = Σ over settled markets of max(0, pool - claimed)
//                          where pool = totalYes + totalNo      (pot owed to winners)
//     coverageRatio     = backedFunds / settledObligations      (∞ if none owed)
//   Deposits in still-open markets are held but are not yet obligations.
//
// Concentration model:
//   Herfindahl-Hirschman Index over each market's share of total deposits.
//   HHI ∈ (0, 1]; 1 = all liquidity in a single market.

export interface MarketRow {
  marketId: string;
  status: string; // "Open" | "Resolved" | "Settled"
  totalDeposited: bigint;
  totalClaimed: bigint;
  totalYes: bigint | null;
  totalNo: bigint | null;
}

export type SolvencyVerdict = "SOLVENT" | "WATCH" | "INSOLVENT";
export type ConcentrationVerdict =
  | "DIVERSE"
  | "MODERATE"
  | "CONCENTRATED"
  | "HIGHLY_CONCENTRATED"
  | "EMPTY";
export type RiskLevel = "LOW" | "ELEVATED" | "HIGH" | "CRITICAL";

export interface SolvencyResult {
  backedFunds: bigint;
  settledObligations: bigint;
  // null == no settled obligations yet (trivially covered)
  coverageRatio: number | null;
  verdict: SolvencyVerdict;
  rationale: string;
}

export interface ConcentrationResult {
  hhi: number;
  activeMarketCount: number;
  topMarketId: string | null;
  topShare: number;
  verdict: ConcentrationVerdict;
  rationale: string;
}

export interface RiskAssessment {
  solvency: SolvencyResult;
  concentration: ConcentrationResult;
  overallRisk: RiskLevel;
  rationale: string;
}

// Ratio of two bigints as a JS number, rounded to 4 dp. Returns null on /0.
function ratio(numerator: bigint, denominator: bigint): number | null {
  if (denominator === 0n) return null;
  const scaled = (numerator * 10_000n) / denominator;
  return Number(scaled) / 10_000;
}

export function computeSolvency(
  totalDeposited: bigint,
  totalClaimed: bigint,
  markets: MarketRow[],
): SolvencyResult {
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
  if (backedFunds < 0n) {
    verdict = "INSOLVENT";
    rationale = `Escrow on hand is negative (${backedFunds} base units): more has been claimed than deposited.`;
  } else if (settledObligations === 0n) {
    verdict = "SOLVENT";
    rationale = `No settled obligations outstanding; all ${backedFunds} base units of escrow are unencumbered.`;
  } else if (coverageRatio! >= 1) {
    verdict = "SOLVENT";
    rationale = `Escrow on hand (${backedFunds}) covers settled obligations (${settledObligations}) at ${coverageRatio}× coverage.`;
  } else if (coverageRatio! >= 0.98) {
    verdict = "WATCH";
    rationale = `Coverage ${coverageRatio}× is within a thin margin of settled obligations (${settledObligations}); monitor.`;
  } else {
    verdict = "INSOLVENT";
    rationale = `Escrow on hand (${backedFunds}) is below settled obligations (${settledObligations}); coverage only ${coverageRatio}×.`;
  }

  return { backedFunds, settledObligations, coverageRatio, verdict, rationale };
}

export function computeConcentration(markets: MarketRow[]): ConcentrationResult {
  const active = markets.filter((m) => m.totalDeposited > 0n);
  const total = active.reduce((acc, m) => acc + m.totalDeposited, 0n);

  if (total === 0n || active.length === 0) {
    return {
      hhi: 0,
      activeMarketCount: 0,
      topMarketId: null,
      topShare: 0,
      verdict: "EMPTY",
      rationale: "No market currently holds deposits; concentration is undefined.",
    };
  }

  let hhi = 0;
  let topShare = 0;
  let topMarketId: string | null = null;
  for (const m of active) {
    const share = Number((m.totalDeposited * 1_000_000n) / total) / 1_000_000;
    hhi += share * share;
    if (share > topShare) {
      topShare = share;
      topMarketId = m.marketId;
    }
  }
  hhi = Math.round(hhi * 10_000) / 10_000;
  topShare = Math.round(topShare * 10_000) / 10_000;

  let verdict: ConcentrationVerdict;
  if (hhi > 0.5) verdict = "HIGHLY_CONCENTRATED";
  else if (hhi > 0.25) verdict = "CONCENTRATED";
  else if (hhi > 0.15) verdict = "MODERATE";
  else verdict = "DIVERSE";

  const rationale = `HHI ${hhi} across ${active.length} funded market(s); largest is market ${topMarketId} at ${(topShare * 100).toFixed(1)}% of deposits.`;

  return {
    hhi,
    activeMarketCount: active.length,
    topMarketId,
    topShare,
    verdict,
    rationale,
  };
}

export function assessRisk(
  totalDeposited: bigint,
  totalClaimed: bigint,
  markets: MarketRow[],
): RiskAssessment {
  const solvency = computeSolvency(totalDeposited, totalClaimed, markets);
  const concentration = computeConcentration(markets);

  // Solvency dominates; concentration escalates.
  let overallRisk: RiskLevel;
  if (solvency.verdict === "INSOLVENT") {
    overallRisk = "CRITICAL";
  } else if (solvency.verdict === "WATCH") {
    overallRisk = concentration.verdict === "HIGHLY_CONCENTRATED" ? "HIGH" : "ELEVATED";
  } else {
    // SOLVENT
    if (concentration.verdict === "HIGHLY_CONCENTRATED") overallRisk = "ELEVATED";
    else overallRisk = "LOW";
  }

  const rationale =
    `Overall ${overallRisk}. Solvency: ${solvency.verdict} — ${solvency.rationale} ` +
    `Concentration: ${concentration.verdict} — ${concentration.rationale}`;

  return { solvency, concentration, overallRisk, rationale };
}
