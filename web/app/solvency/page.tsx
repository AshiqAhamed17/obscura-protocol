"use client";

import { useMemo } from "react";
import { useChainId, useReadContract, useReadContracts } from "wagmi";
import { abi, contractsFor, feedLabel, parseMarket, type Market, type MarketTuple } from "@/lib/contract";
import { usdc, usdcCompact, outcomeLabel, statusClass, statusLabel, usd } from "@/lib/format";
import { AmbientField } from "@/components/AmbientField";

type Row = { id: bigint; m: Market; totals: readonly bigint[] };

export default function SolvencyPage() {
  const chainId = useChainId();
  const { predictionMarket } = contractsFor(chainId);
  const { data: count, isLoading } = useReadContract({
    abi,
    address: predictionMarket,
    functionName: "marketCount",
  });
  const n = Number(count ?? 0n);

  const { data: raw } = useReadContracts({
    contracts: Array.from({ length: n }, (_, i) => ({
      abi,
      address: predictionMarket,
      functionName: "markets" as const,
      args: [BigInt(i)] as const,
    })),
    query: { enabled: n > 0 },
  });

  const { data: totalsRaw } = useReadContracts({
    contracts: Array.from({ length: n }, (_, i) => ({
      abi,
      address: predictionMarket,
      functionName: "getOutcomeTotals" as const,
      args: [BigInt(i)] as const,
    })),
    query: { enabled: n > 0 },
  });

  const rows = useMemo<Row[]>(() => {
    if (!raw) return [];
    return raw
      .map((r, i) => {
        if (r.status !== "success") return null;
        const totals = totalsRaw?.[i]?.status === "success" ? (totalsRaw[i].result as readonly bigint[]) : [];
        return { id: BigInt(i), m: parseMarket(r.result as unknown as MarketTuple), totals };
      })
      .filter((x): x is Row => x !== null);
  }, [raw, totalsRaw]);

  const stats = useMemo(() => {
    let escrowed = 0n;
    let proven = 0n;
    let settled = 0;
    for (const { m, totals } of rows) {
      escrowed += m.totalPool;
      if (m.status === 2) {
        settled++;
        for (const t of totals) proven += t;
      }
    }
    return { escrowed, proven, settled, total: rows.length };
  }, [rows]);

  return (
    <>
      <AmbientField />
      <main className="wrap page">
        <p className="eyebrow">Audit</p>
        <h1>Solvency</h1>
        <p className="lead">
          Every settled market&apos;s totals were established by an SP1 proof, not by an operator —
          and they must reconcile with the USDC actually escrowed. Anyone can check that here. No
          individual position is ever revealed.
        </p>

        {isLoading && <p className="muted mono">Loading…</p>}
        {!isLoading && n === 0 && <p className="muted">No markets yet.</p>}

        {n > 0 && (
          <div className="statrow">
            <Stat label="Markets" value={String(stats.total)} />
            <Stat label="Settled by proof" value={String(stats.settled)} />
            <Stat label="Total escrowed" value={usdcCompact(stats.escrowed)} />
            <Stat label="Proven totals" value={usdcCompact(stats.proven)} accent />
          </div>
        )}

        <div className="grid">
          {rows.map(({ id, m, totals }) => (
            <SolvencyCard key={id.toString()} id={id} m={m} totals={totals} />
          ))}
        </div>
      </main>
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="stat">
      <span className="stat-label mono">{label}</span>
      <span className={`stat-value ${accent ? "accent" : ""}`}>{value}</span>
    </div>
  );
}

function SolvencyCard({ id, m, totals }: Row) {
  const settled = m.status === 2;
  const provenSum = totals.reduce((a, b) => a + b, 0n);
  const solvent = settled && provenSum === m.totalPool;
  // Binary view (outcomeTotals = [No, Yes]); categorical markets show the sum.
  const totalNo = totals[0] ?? 0n;
  const totalYes = totals[1] ?? 0n;
  const denom = totalNo + totalYes;
  const yesPct = denom > 0n ? Number((totalYes * 10000n) / denom) / 100 : 50;
  const isBinary = m.numOutcomes <= 2;
  const title = m.feed === "0x0000000000000000000000000000000000000000" ? `Market #${id.toString()}` : `${feedLabel(m.feed).asset} ≥ ${usd(m.threshold)}`;

  return (
    <div className="card solvency-card">
      <div className="card-top">
        <span className={`pill ${statusClass(m.status)}`}>{statusLabel(m.status)}</span>
        <span className="card-id">#{id.toString()}</span>
      </div>
      <h3>{title}</h3>

      {!settled ? (
        <div className="meta">
          <div className="row">
            <span>Positions</span>
            <b>{m.depositCount.toString()}</b>
          </div>
          <div className="row">
            <span>Escrowed</span>
            <b>{usdc(m.totalPool)}</b>
          </div>
          <div className="sealed-note">
            <span className="veiled">████████</span>
            <p>Totals stay hidden until an SP1 proof settles the market.</p>
          </div>
        </div>
      ) : (
        <>
          {isBinary && (
            <>
              <div className="stakebar" role="img" aria-label={`Yes ${usdc(totalYes)}, No ${usdc(totalNo)}`}>
                <span className="stakebar-yes" style={{ width: `${yesPct}%` }} />
                <span className="stakebar-no" style={{ width: `${100 - yesPct}%` }} />
              </div>
              <div className="stakebar-legend mono">
                <span className="tag-yes">Yes {usdc(totalYes)}</span>
                <span className="tag-no">No {usdc(totalNo)}</span>
              </div>
            </>
          )}

          <div className="meta">
            <div className="row">
              <span>Outcome</span>
              <b className={m.winningOutcome === 1 ? "tag-yes" : "tag-no"}>{outcomeLabel(m.winningOutcome, m.numOutcomes)}</b>
            </div>
            <div className="row">
              <span>Escrowed</span>
              <b>{usdc(m.totalPool)}</b>
            </div>
            <div className="row">
              <span>Proven total</span>
              <b>{usdc(provenSum)}</b>
            </div>
          </div>

          <div className={`solvent-badge ${solvent ? "ok" : "bad"}`}>
            <span className="solvent-mark">{solvent ? "✓" : "✗"}</span>
            <div>
              <b>{solvent ? "Proven solvent" : "Mismatch"}</b>
              <span className="mono">Σ outcomes {solvent ? "=" : "≠"} escrow · SP1 verified</span>
            </div>
          </div>
          <p className="card-note muted mono">
            merkle root {m.merkleRoot.slice(0, 10)}…{m.merkleRoot.slice(-6)}
          </p>
        </>
      )}
    </div>
  );
}
