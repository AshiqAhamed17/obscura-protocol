"use client";

import Link from "next/link";
import { useEffect } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { useReadContract, useWaitForTransactionReceipt, useWriteContract, useAccount } from "wagmi";
import { abi, PREDICTION_MARKET, type Market } from "@/lib/contract";
import { statusLabel, statusClass, sideLabel, usd, eth, whenResolves } from "@/lib/format";
import { PriceGauge } from "./PriceGauge";

export function MarketList() {
  const { data: count, isLoading } = useReadContract({
    abi,
    address: PREDICTION_MARKET,
    functionName: "marketCount",
  });

  if (isLoading) return <p className="muted mono">Loading markets…</p>;
  const n = Number(count ?? 0n);
  if (n === 0) return <p className="muted">No markets yet — check back soon.</p>;

  return (
    <div className="grid">
      {Array.from({ length: n }, (_, i) => (
        <MarketCard key={i} id={BigInt(i)} index={i} />
      ))}
    </div>
  );
}

function MarketCard({ id, index }: { id: bigint; index: number }) {
  const { isConnected } = useAccount();

  // pointer-driven 3D tilt
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [7, -7]), { stiffness: 200, damping: 18 });
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [-7, 7]), { stiffness: 200, damping: 18 });
  const onMove = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width - 0.5);
    py.set((e.clientY - r.top) / r.height - 0.5);
  };
  const onLeave = () => {
    px.set(0);
    py.set(0);
  };

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

  if (!data) {
    return (
      <div className="card">
        <span className="muted mono">#{id.toString()} …</span>
      </div>
    );
  }

  const m = data as unknown as Market;
  const [feed, threshold, resolveAfter, , status, winningSide, totalPool] = m;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const isOpen = status === 0;
  const resolvable = isOpen && now >= resolveAfter;

  return (
    <motion.article
      className="card tilt"
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.55, ease: [0.2, 0.7, 0.2, 1], delay: index * 0.07 }}
      whileHover={{ y: -4 }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{ rotateX, rotateY, transformPerspective: 900 }}
    >
      <span className={`pill ${statusClass(status)}`}>{statusLabel(status)}</span>
      <span className="card-id">MARKET #{id.toString()}</span>
      <h3>ETH ≥ {usd(threshold)}</h3>

      <div className="meta">
        <div className="row">
          <span>Pool</span>
          <b>{eth(totalPool)}</b>
        </div>
        {status >= 1 ? (
          <div className="row">
            <span>Outcome</span>
            <b className={winningSide === 1 ? "tag-yes" : "tag-no"}>{sideLabel(winningSide)}</b>
          </div>
        ) : (
          <div className="row">
            <span>Resolves</span>
            <b>{whenResolves(resolveAfter)}</b>
          </div>
        )}
      </div>

      <PriceGauge feed={feed} threshold={threshold} />

      <div className="actions">
        {isOpen && (
          <Link className="btn primary sm" href={`/deposit?market=${id.toString()}`}>
            Take a position
          </Link>
        )}
        {isOpen && (
          <button
            className="btn sm"
            disabled={!isConnected || !resolvable || isPending || confirming}
            onClick={() =>
              writeContract({ abi, address: PREDICTION_MARKET, functionName: "resolveMarket", args: [id] })
            }
            title={resolvable ? "Read Chainlink and set the outcome" : "Resolves later"}
          >
            {isPending ? "Confirm…" : confirming ? "Resolving…" : resolvable ? "Resolve" : "Locked"}
          </button>
        )}
        {status === 2 && (
          <Link className="btn sm" href={`/claim?market=${id.toString()}`}>
            Claim
          </Link>
        )}
        <Link className="btn sm" href={`/solvency?market=${id.toString()}`}>
          Solvency
        </Link>
      </div>

      {error && (
        <p className="card-note tag-no">
          {(error as { shortMessage?: string }).shortMessage ?? "Transaction failed"}
        </p>
      )}
      {isSuccess && (
        <p className="card-note tag-yes">
          Resolved ✓{" "}
          <a href={`https://sepolia.etherscan.io/tx/${hash}`} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
            view tx ↗
          </a>
        </p>
      )}
    </motion.article>
  );
}
