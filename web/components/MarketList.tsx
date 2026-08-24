"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useReadContract, useWaitForTransactionReceipt, useWriteContract, useAccount } from "wagmi";
import { abi, PREDICTION_MARKET, type Market } from "@/lib/contract";
import { statusLabel, statusClass, sideLabel, usd, eth, whenResolves } from "@/lib/format";

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
  const { isConnected } = useAccount();
  const { data, refetch } = useReadContract({
    abi,
    address: PREDICTION_MARKET,
    functionName: "markets",
    args: [id],
  });

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess) refetch();
  }, [isSuccess, refetch]);

  if (!data)
    return (
      <div className="card">
        <span className="muted mono">#{id.toString()} …</span>
      </div>
    );
  const m = data as unknown as Market;
  const [, threshold, resolveAfter, , status, winningSide, totalPool] = m;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const isOpen = status === 0;
  const resolvable = isOpen && now >= resolveAfter;

  return (
    <div className="card">
      <span className={`pill ${statusClass(status)}`}>{statusLabel(status)}</span>
      <span className="id">MARKET #{id.toString()}</span>
      <h3>ETH ≥ {usd(threshold)}</h3>
      <div className="meta">
        <span>
          pool <b>{eth(totalPool)}</b>
        </span>
        {status >= 1 ? (
          <span>
            outcome <b>{sideLabel(winningSide)}</b>
          </span>
        ) : (
          <span>
            resolves <b>{whenResolves(resolveAfter)}</b>
          </span>
        )}
      </div>

      <div className="actions">
        {isOpen && (
          <Link className="btn primary" href={`/deposit?market=${id.toString()}`}>
            Take a position
          </Link>
        )}
        {isOpen && (
          <button
            className="btn"
            disabled={!isConnected || !resolvable || isPending || confirming}
            onClick={() =>
              writeContract({ abi, address: PREDICTION_MARKET, functionName: "resolveMarket", args: [id] })
            }
            title={resolvable ? "Read Chainlink and set the outcome" : "Not resolvable yet"}
          >
            {isPending ? "Confirm…" : confirming ? "Resolving…" : resolvable ? "Resolve" : "Locked"}
          </button>
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

      {error && (
        <span className="muted" style={{ fontSize: "0.72rem", color: "var(--danger)" }}>
          {(error as { shortMessage?: string }).shortMessage ?? "Transaction failed"}
        </span>
      )}
      {isSuccess && (
        <span className="muted" style={{ fontSize: "0.72rem", color: "var(--proven)" }}>
          Resolved ✓{" "}
          <a href={`https://sepolia.etherscan.io/tx/${hash}`} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
            tx ↗
          </a>
        </span>
      )}
    </div>
  );
}
