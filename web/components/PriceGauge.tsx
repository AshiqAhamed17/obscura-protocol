"use client";

import { motion } from "framer-motion";
import { useReadContract } from "wagmi";
import { aggregatorAbi } from "@/lib/contract";

/// Live price-vs-threshold gauge, read straight from the market's Chainlink
/// feed. Shows how close the market is to resolving Yes (price ≥ threshold).
export function PriceGauge({ feed, threshold }: { feed: `0x${string}`; threshold: bigint }) {
  const { data } = useReadContract({ abi: aggregatorAbi, address: feed, functionName: "latestRoundData" });

  const target = Number(threshold) / 1e8;
  if (!data) return <div className="gauge"><div className="gauge-track" /></div>;

  const price = Number((data as readonly bigint[])[1]) / 1e8;
  const min = target * 0.85;
  const max = target * 1.15;
  const pos = Math.max(2, Math.min(98, ((price - min) / (max - min)) * 100));
  const over = price >= target;
  const fmt = (v: number) => `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

  return (
    <div className="gauge">
      <div className="gauge-head">
        <span className="mono">Live ETH</span>
        <span className={`mono ${over ? "tag-yes" : "tag-no"}`}>{over ? "leaning Yes" : "leaning No"}</span>
      </div>
      <div className="gauge-track">
        <div className="gauge-threshold" />
        <motion.div
          className={`gauge-marker ${over ? "yes" : "no"}`}
          initial={{ left: "0%", opacity: 0 }}
          animate={{ left: `${pos}%`, opacity: 1 }}
          transition={{ duration: 0.9, ease: [0.2, 0.7, 0.2, 1], delay: 0.15 }}
        />
      </div>
      <div className="gauge-foot mono">
        <span style={{ color: over ? "var(--yes)" : "var(--no)" }}>{fmt(price)}</span>
        <span className="muted">target {fmt(target)}</span>
      </div>
    </div>
  );
}
