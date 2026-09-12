"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useReadContract, useChainId } from "wagmi";
import {
  abi,
  contractsFor,
  feedLabel,
  parseMarket,
  ResolutionSource,
  resolutionLabel,
  type MarketTuple,
} from "@/lib/contract";
import {
  marketTitle,
  marketCategory,
  marketOutcomeLabels,
} from "@/hooks/useMarkets";
import { usePriceHistory } from "@/hooks/usePriceHistory";
import { statusLabel, statusClass, usd, usdc } from "@/lib/format";
import { ChartPanel } from "@/components/ChartPanel";
import { Countdown } from "@/components/Countdown";
import { AmbientField } from "@/components/AmbientField";

export default function MarketDetailPage() {
  const params = useParams();
  const id = BigInt((params.id as string) || "0");
  const chainId = useChainId();
  const { predictionMarket } = contractsFor(chainId);

  const { data: marketData } = useReadContract({ abi, address: predictionMarket, functionName: "markets", args: [id] });
  const { data: cfgData } = useReadContract({ abi, address: predictionMarket, functionName: "resolutionConfig", args: [id] });
  const { data: totalsData } = useReadContract({ abi, address: predictionMarket, functionName: "getOutcomeTotals", args: [id] });

  const m = marketData ? parseMarket(marketData as unknown as MarketTuple) : undefined;
  const cfg = cfgData as readonly [number, string, string] | undefined;
  const source = cfg ? Number(cfg[0]) : ResolutionSource.ChainlinkFeed;
  const sourceRef = cfg ? String(cfg[2]) : "";
  const totals = (totalsData as readonly bigint[] | undefined) ?? [];

  const isFeed = source === ResolutionSource.ChainlinkFeed;
  const { points, current } = usePriceHistory(isFeed && m ? m.feed : ("0x0000000000000000000000000000000000000000" as `0x${string}`));

  return (
    <>
      <AmbientField />
      <main className="wrap page">
        <Link href="/markets" className="back-link mono">← All markets</Link>

        {!m ? (
          <p className="muted mono" style={{ marginTop: "1.4rem" }}>Loading market #{id.toString()}…</p>
        ) : (
          <>
            {(() => {
              const title = marketTitle(m, source, sourceRef);
              const category = marketCategory(m, source);
              const target = Number(m.threshold) / 1e8;
              const feed = isFeed ? feedLabel(m.feed) : null;
              const labels = marketOutcomeLabels(sourceRef, m.numOutcomes);

              return (
                <>
                  <div className="detail-head">
                    <div>
                      <span className="card-cat mono">{category}</span>
                      <h1 className="detail-title">{title}</h1>
                    </div>
                    <div className="detail-tags">
                      <span className={`pill ${statusClass(m.status)}`}>{statusLabel(m.status)}</span>
                      <span className={`src-chip mono ${isFeed ? "src-feed" : source === ResolutionSource.GraphQuery ? "src-graph" : "src-cre"}`}>
                        {resolutionLabel[source] ?? "source"}
                      </span>
                    </div>
                  </div>

                  <div className="detail-grid">
                    <section className="panel detail-main">
                      {isFeed ? (
                        <ChartPanel feed={m.feed} threshold={target} points={points} height={300} />
                      ) : (
                        <OutcomeBoard labels={labels} totals={totals} totalPool={m.totalPool} winning={m.status >= 1 ? m.winningOutcome : undefined} />
                      )}
                    </section>

                    <aside className="panel detail-side">
                      <div className="detail-metrics">
                        {isFeed && (
                          <Metric k={`Live ${feed?.asset}`} v={current === null ? "—" : `$${current.toLocaleString("en-US", { maximumFractionDigits: current < 100 ? 2 : 0 })}`} />
                        )}
                        {isFeed && <Metric k="Target" v={usd(m.threshold)} />}
                        <Metric k="Pool" v={usdc(m.totalPool)} />
                        <Metric k="Positions" v={m.depositCount.toString()} />
                        <Metric k="Outcomes" v={m.numOutcomes.toString()} />
                        <Metric k={m.status >= 1 ? "Resolved" : "Resolves"} v={m.status >= 1 ? labels[m.winningOutcome] ?? `#${m.winningOutcome}` : ""} node={m.status >= 1 ? undefined : <Countdown resolveAfter={m.resolveAfter} />} />
                      </div>

                      {m.status === 0 ? (
                        <Link className="btn primary detail-cta" href={`/deposit?market=${id.toString()}`}>
                          Take a private position
                        </Link>
                      ) : m.status === 2 ? (
                        <Link className="btn primary detail-cta" href="/portfolio">
                          Claim your winnings
                        </Link>
                      ) : (
                        <div className="note">Resolved — awaiting SP1 settlement before claims open.</div>
                      )}

                      <p className="hint">
                        Your side is hidden — only a Poseidon commitment goes on-chain. {isFeed ? "This market resolves against a live Chainlink feed." : "This market resolves via the registered CRE/Graph resolver."}
                      </p>
                    </aside>
                  </div>
                </>
              );
            })()}
          </>
        )}
      </main>
    </>
  );
}

function Metric({ k, v, node }: { k: string; v: string; node?: React.ReactNode }) {
  return (
    <div className="detail-metric">
      <span className="detail-metric-k mono">{k}</span>
      <span className="detail-metric-v">{node ?? v}</span>
    </div>
  );
}

/// Polymarket-style outcome board for categorical / event markets — each outcome
/// with its share of the escrowed pool. No price chart (these aren't price feeds).
function OutcomeBoard({ labels, totals, totalPool, winning }: { labels: string[]; totals: readonly bigint[]; totalPool: bigint; winning?: number }) {
  return (
    <div className="obc">
      <p className="obc-title">Outcomes</p>
      <div className="obc-list">
        {labels.map((label, i) => {
          const t = totals[i] ?? 0n;
          const pct = totalPool > 0n ? Number((t * 10000n) / totalPool) / 100 : 0;
          const isWin = winning === i;
          return (
            <div key={i} className={`obc-row ${isWin ? "win" : ""}`}>
              <div className="obc-bar" style={{ width: `${Math.max(pct, 2)}%` }} />
              <span className="obc-label">{label}{isWin && " ✓"}</span>
              <span className="obc-share mono">{pct.toFixed(0)}% · {usdc(t)}</span>
            </div>
          );
        })}
      </div>
      <p className="hint">Shares reflect escrowed stake per outcome (public aggregate). Individual positions stay shielded.</p>
    </div>
  );
}
