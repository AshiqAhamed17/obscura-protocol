"use client";

import { useMemo } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { abi, PREDICTION_MARKET, type Market } from "@/lib/contract";
import { eth, ethCompact, sideLabel, statusClass, statusLabel, usd } from "@/lib/format";
import { AmbientField } from "@/components/AmbientField";

export default function SolvencyPage() {
  const { data: count, isLoading } = useReadContract({
    abi,
    address: PREDICTION_MARKET,
    functionName: "marketCount",
  });
  const n = Number(count ?? 0n);

  const { data: raw } = useReadContracts({
    contracts: Array.from({ length: n }, (_, i) => ({
      abi,
      address: PREDICTION_MARKET,
      functionName: "markets" as const,
      args: [BigInt(i)] as const,
    })),
    query: { enabled: n > 0 },
  });

  const rows = useMemo(() => {
    if (!raw) return [] as { id: bigint; m: Market }[];
    return raw
      .map((r, i) => (r.status === "success" ? { id: BigInt(i), m: r.result as unknown as Market } : null))
      .filter((x): x is { id: bigint; m: Market } => x !== null);
  }, [raw]);

  const stats = useMemo(() => {
    let escrowed = 0n;
    let proven = 0n;
    let settled = 0;
    for (const { m } of rows) {
      escrowed += m[6];
      if (Number(m[4]) === 2) {
        settled++;
        proven += m[9] + m[10];
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
          and they must reconcile with the ETH actually escrowed. Anyone can check that here. No
          individual position is ever revealed.
        </p>

        {isLoading && <p className="muted mono">Loading…</p>}
        {!isLoading && n === 0 && <p className="muted">No markets yet.</p>}

        {n > 0 && (
          <div className="statrow">
            <Stat label="Markets" value={String(stats.total)} />
            <Stat label="Settled by proof" value={String(stats.settled)} />
            <Stat label="Total escrowed" value={ethCompact(stats.escrowed)} />
            <Stat label="Proven totals" value={ethCompact(stats.proven)} accent />
          </div>
        )}

        <div className="grid">
          {rows.map(({ id, m }) => (
            <SolvencyCard key={id.toString()} id={id} m={m} />
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

function SolvencyCard({ id, m }: { id: bigint; m: Market }) {
  const [, threshold, , , status, winningSide, totalPool, depositCount, merkleRoot, totalYes, totalNo] = m;
  const settled = Number(status) === 2;
  const solvent = settled && totalYes + totalNo === totalPool;
  const total = totalYes + totalNo;
  const yesPct = total > 0n ? Number((totalYes * 10000n) / total) / 100 : 50;

  return (
    <div className="card solvency-card">
      <div className="card-top">
        <span className={`pill ${statusClass(Number(status))}`}>{statusLabel(Number(status))}</span>
        <span className="card-id">#{id.toString()}</span>
      </div>
      <h3>ETH ≥ {usd(threshold)}</h3>

      {!settled ? (
        <div className="meta">
          <div className="row">
            <span>Positions</span>
            <b>{depositCount.toString()}</b>
          </div>
          <div className="row">
            <span>Escrowed</span>
            <b>{eth(totalPool)}</b>
          </div>
          <div className="sealed-note">
            <span className="veiled">████████</span>
            <p>Totals stay hidden until an SP1 proof settles the market.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="stakebar" role="img" aria-label={`Yes ${eth(totalYes)}, No ${eth(totalNo)}`}>
            <span className="stakebar-yes" style={{ width: `${yesPct}%` }} />
            <span className="stakebar-no" style={{ width: `${100 - yesPct}%` }} />
          </div>
          <div className="stakebar-legend mono">
            <span className="tag-yes">Yes {eth(totalYes)}</span>
            <span className="tag-no">No {eth(totalNo)}</span>
          </div>

          <div className="meta">
            <div className="row">
              <span>Outcome</span>
              <b className={Number(winningSide) === 1 ? "tag-yes" : "tag-no"}>{sideLabel(Number(winningSide))}</b>
            </div>
            <div className="row">
              <span>Escrowed</span>
              <b>{eth(totalPool)}</b>
            </div>
          </div>

          <div className={`solvent-badge ${solvent ? "ok" : "bad"}`}>
            <span className="solvent-mark">{solvent ? "✓" : "✗"}</span>
            <div>
              <b>{solvent ? "Proven solvent" : "Mismatch"}</b>
              <span className="mono">Yes + No {solvent ? "=" : "≠"} escrow · SP1 verified</span>
            </div>
          </div>
          <p className="card-note muted mono">
            merkle root {merkleRoot.slice(0, 10)}…{merkleRoot.slice(-6)}
          </p>
        </>
      )}
    </div>
  );
}
