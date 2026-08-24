"use client";

import Link from "next/link";
import { useReadContract } from "wagmi";
import { abi, PREDICTION_MARKET, type Market } from "@/lib/contract";
import { statusLabel, statusClass, usd, eth, whenResolves } from "@/lib/format";

export function MarketList() {
  const { data: count, isLoading } = useReadContract({
    abi,
    address: PREDICTION_MARKET,
    functionName: "marketCount",
  });

  if (isLoading) return <p className="muted mono">Loading markets…</p>;
  const n = Number(count ?? 0n);
  if (n === 0) return <p className="muted">No markets yet.</p>;

  return (
    <div className="grid">
      {Array.from({ length: n }, (_, i) => (
        <MarketCard key={i} id={BigInt(i)} />
      ))}
    </div>
  );
}

function MarketCard({ id }: { id: bigint }) {
  const { data } = useReadContract({
    abi,
    address: PREDICTION_MARKET,
    functionName: "markets",
    args: [id],
  });

  if (!data) return <div className="card"><span className="muted mono">#{id.toString()} …</span></div>;
  const m = data as unknown as Market;
  const [, threshold, resolveAfter, , status, , totalPool] = m;

  return (
    <div className="card">
      <span className={`pill ${statusClass(status)}`}>{statusLabel(status)}</span>
      <span className="id">MARKET #{id.toString()}</span>
      <h3>ETH ≥ {usd(threshold)}</h3>
      <div className="meta">
        <span>
          pool <b>{eth(totalPool)}</b>
        </span>
        <span>
          resolves <b>{whenResolves(resolveAfter)}</b>
        </span>
      </div>
      <div className="actions">
        {status === 0 && (
          <Link className="btn primary" href={`/deposit?market=${id.toString()}`}>
            Take a position
          </Link>
        )}
        {status === 2 && (
          <Link className="btn" href={`/claim?market=${id.toString()}`}>
            Claim
          </Link>
        )}
        <Link className="btn" href={`/solvency?market=${id.toString()}`}>
          Solvency
        </Link>
      </div>
    </div>
  );
}
