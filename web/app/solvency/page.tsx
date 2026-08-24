"use client";

import { useReadContract } from "wagmi";
import { abi, PREDICTION_MARKET, type Market } from "@/lib/contract";
import { eth, sideLabel, statusClass, statusLabel, usd } from "@/lib/format";

export default function SolvencyPage() {
  const { data: count, isLoading } = useReadContract({
    abi,
    address: PREDICTION_MARKET,
    functionName: "marketCount",
  });
  const n = Number(count ?? 0n);

  return (
    <main className="wrap section">
      <h2>Solvency</h2>
      <p className="desc">
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
      <span className="id">MARKET #{id.toString()}</span>
      <h3>ETH ≥ {usd(threshold)}</h3>

      {!settled ? (
        <div className="meta">
          <span>positions <b>{depositCount.toString()}</b></span>
          <span>escrowed <b>{eth(totalPool)}</b></span>
          <span className="muted">Totals stay hidden until an SP1 proof settles the market.</span>
        </div>
      ) : (
        <div className="meta">
          <span>won: <b>{sideLabel(Number(winningSide))}</b></span>
          <span>total Yes <b>{eth(totalYes)}</b></span>
          <span>total No <b>{eth(totalNo)}</b></span>
          <span>escrowed <b>{eth(totalPool)}</b></span>
          <span
            style={{
              color: solvent ? "var(--proven)" : "var(--danger)",
              marginTop: "0.3rem",
            }}
          >
            {solvent ? "✓ proven solvent" : "✗ mismatch"} — Yes + No {solvent ? "=" : "≠"} escrow
          </span>
          <span className="muted" style={{ wordBreak: "break-all", fontSize: "0.72rem" }}>
            root {merkleRoot.slice(0, 10)}…{merkleRoot.slice(-6)}
          </span>
        </div>
      )}
    </div>
  );
}
