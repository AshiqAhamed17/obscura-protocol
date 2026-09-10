"use client";

import { useCallback, useEffect, useState } from "react";
import { AmbientField } from "@/components/AmbientField";
import { fetchRiskReport, isStale, MESSARI_BENCHMARK, PINNED_DEPLOYMENT, type RiskReport } from "@/lib/risk";

const RISK_TINT: Record<string, string> = {
  LOW: "var(--yes)",
  ELEVATED: "#ffce9f",
  HIGH: "#ffb27a",
  CRITICAL: "var(--no)",
};

function usdc6(base: bigint): string {
  return (Number(base) / 1e6).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export default function RiskPage() {
  const [report, setReport] = useState<RiskReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setReport(await fetchRiskReport());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <AmbientField />
      <main className="wrap page">
        <p className="eyebrow">The Graph · AI oracle</p>
        <h1>Solvency &amp; risk</h1>
        <p className="lead">
          An AI risk oracle reads the Obscura subgraph — public aggregates only, never a single
          position — and judges the book&apos;s solvency and concentration. It pins the subgraph
          deployment and refuses stale data. This runs live in your browser.
        </p>

        {loading && <p className="muted mono">Reading the subgraph…</p>}
        {error && <div className="panel"><div className="note err">{error}</div></div>}

        {report && (
          <>
            <ProvenanceBar report={report} onRefresh={load} />

            <section className="risk-verdict" style={{ ["--risk" as string]: RISK_TINT[report.overallRisk] }}>
              <div>
                <span className="risk-eyebrow mono">Overall risk</span>
                <div className="risk-level">{report.overallRisk}</div>
              </div>
              <p className="risk-rationale">
                Solvency <b>{report.solvency.verdict}</b> · Concentration{" "}
                <b>{report.concentration.verdict.replace(/_/g, " ").toLowerCase()}</b>. A go/no-go read the
                same as the <span className="mono">obscura-risk-oracle</span> MCP tool.
              </p>
            </section>

            <div className="risk-grid">
              <div className="risk-card">
                <span className="risk-eyebrow mono">Solvency</span>
                <div className="risk-metric">
                  {report.solvency.coverageRatio === null ? "∞" : `${report.solvency.coverageRatio}×`}
                  <span className="risk-metric-k">coverage</span>
                </div>
                <div className={`risk-badge ${report.solvency.verdict === "SOLVENT" ? "ok" : report.solvency.verdict === "WATCH" ? "warn" : "bad"}`}>
                  {report.solvency.verdict}
                </div>
                <dl className="risk-lines">
                  <div><dt>Escrow on hand</dt><dd>{usdc6(report.solvency.backedFunds)}</dd></div>
                  <div><dt>Settled obligations</dt><dd>{usdc6(report.solvency.settledObligations)}</dd></div>
                  <div><dt>Outstanding escrow</dt><dd>{usdc6(report.totals.outstandingEscrow)}</dd></div>
                </dl>
                <p className="risk-note">{report.solvency.rationale}</p>
              </div>

              <div className="risk-card">
                <span className="risk-eyebrow mono">Concentration</span>
                <div className="risk-metric">
                  {report.concentration.hhi}
                  <span className="risk-metric-k">HHI</span>
                </div>
                <div className={`risk-badge ${report.concentration.hhi > 0.5 ? "bad" : report.concentration.hhi > 0.25 ? "warn" : "ok"}`}>
                  {report.concentration.verdict.replace(/_/g, " ")}
                </div>
                <dl className="risk-lines">
                  <div><dt>Funded markets</dt><dd>{report.concentration.activeMarketCount}</dd></div>
                  <div><dt>Largest market</dt><dd>#{report.concentration.topMarketId ?? "—"} · {(report.concentration.topShare * 100).toFixed(0)}%</dd></div>
                  <div><dt>Markets total</dt><dd>{report.totals.marketCount}</dd></div>
                </dl>
                <p className="risk-note">{report.concentration.rationale}</p>
              </div>
            </div>

            <section className="risk-bench">
              <span className="risk-eyebrow mono">Composable benchmark · Messari standardized subgraph</span>
              <div className="bench-row">
                <div className="bench-side">
                  <span className="bench-k">Obscura</span>
                  <span className="bench-hhi">HHI {report.concentration.hhi}</span>
                  <span className="bench-sub mono">{report.concentration.activeMarketCount} funded market(s)</span>
                </div>
                <span className="bench-vs mono">vs</span>
                <div className="bench-side">
                  <span className="bench-k">{MESSARI_BENCHMARK.name.split(" (")[0]}</span>
                  <span className="bench-hhi">HHI {MESSARI_BENCHMARK.hhi}</span>
                  <span className="bench-sub mono">{MESSARI_BENCHMARK.fundedMarkets} markets · ${(MESSARI_BENCHMARK.tvlUSD / 1e6).toFixed(0)}M TVL</span>
                </div>
              </div>
              <p className="risk-note">
                Composing two Graph sources: our subgraph vs a live mainnet DeFi protocol, same HHI
                methodology. A high Obscura HHI is the signature of an early, single-market book — the
                mature benchmark is the diversification target. Benchmark fetched by the{" "}
                <span className="mono">agent/</span> tool (keyed gateway call, run off-chain).
              </p>
            </section>
          </>
        )}
      </main>
    </>
  );
}

function ProvenanceBar({ report, onRefresh }: { report: RiskReport; onRefresh: () => void }) {
  const p = report.provenance;
  const stale = isStale(p);
  return (
    <div className={`prov-bar ${stale ? "stale" : "fresh"}`}>
      <span className="prov-dot" />
      <span className="mono prov-txt">
        {p.matchesPinned ? "pinned deployment ✓" : "⚠ deployment mismatch"} · block {p.block} · {p.ageSeconds}s old
        {p.hasIndexingErrors ? " · indexing errors" : ""}
      </span>
      <span className="mono prov-id" title={PINNED_DEPLOYMENT}>{PINNED_DEPLOYMENT.slice(0, 8)}…{PINNED_DEPLOYMENT.slice(-4)}</span>
      <button className="btn sm ghost" onClick={onRefresh}>Refresh</button>
    </div>
  );
}
