"use client";

import { useReadContract } from "wagmi";
import { abi, PREDICTION_MARKET, type Market } from "@/lib/contract";
import { eth, sideLabel, statusClass, statusLabel, usd } from "@/lib/format";
import { AmbientField } from "@/components/AmbientField";

export default function SolvencyPage() {
  const { data: count, isLoading } = useReadContract({
    abi,
    address: PREDICTION_MARKET,
    functionName: "marketCount",
  });
  const n = Number(count ?? 0n);

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
      <div className="grid">
        {Array.from({ length: n }, (_, i) => (
          <SolvencyCard key={i} id={BigInt(i)} />
        ))}
      </div>
      </main>
    </>
  );
}

function SolvencyCard({ id }: { id: bigint }) {
  const { data } = useReadContract({
    abi,
    address: PREDICTION_MARKET,
    functionName: "markets",
    args: [id],
  });
  if (!data) return <div className="card"><span className="muted mono">#{id.toString()} …</span></div>;

  const m = data as unknown as Market;
  const [, threshold, , , status, winningSide, totalPool, depositCount, merkleRoot, totalYes, totalNo] = m;
  const settled = Number(status) === 2;
  const solvent = settled && totalYes + totalNo === totalPool;

  return (
    <div className="card">
      <span className={`pill ${statusClass(Number(status))}`}>{statusLabel(Number(status))}</span>
      <span className="card-id">MARKET #{id.toString()}</span>
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
          <p className="card-note muted" style={{ marginTop: "0.4rem" }}>
            Totals stay hidden until an SP1 proof settles the market.
          </p>
        </div>
      ) : (
        <div className="meta">
          <div className="row">
            <span>Outcome</span>
            <b className={Number(winningSide) === 1 ? "tag-yes" : "tag-no"}>{sideLabel(Number(winningSide))}</b>
          </div>
          <div className="row">
            <span>Total Yes</span>
            <b>{eth(totalYes)}</b>
          </div>
          <div className="row">
            <span>Total No</span>
            <b>{eth(totalNo)}</b>
          </div>
          <div className="row">
            <span>Escrowed</span>
            <b>{eth(totalPool)}</b>
          </div>
          <div className="row" style={{ marginTop: "0.3rem" }}>
            <span className={solvent ? "tag-yes" : "tag-no"}>
              {solvent ? "✓ proven solvent" : "✗ mismatch"}
            </span>
            <span className="muted">Yes + No {solvent ? "=" : "≠"} escrow</span>
          </div>
          <p className="card-note muted">
            root {merkleRoot.slice(0, 10)}…{merkleRoot.slice(-6)}
          </p>
        </div>
      )}
    </div>
  );
}
