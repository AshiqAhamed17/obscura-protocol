"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { useReadContract, useReadContracts, useWaitForTransactionReceipt, useWriteContract, useAccount } from "wagmi";
import { abi, PREDICTION_MARKET, type Market } from "@/lib/contract";
import { statusLabel, statusClass, sideLabel, usd, eth, ethCompact, priceUsd } from "@/lib/format";
import { usePriceHistory } from "@/hooks/usePriceHistory";
import { PriceChart } from "./PriceChart";
import { Countdown } from "./Countdown";

type Row = { id: bigint; m: Market };
type Filter = "all" | "open" | "resolved" | "settled";
type Sort = "soon" | "pool" | "newest";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "resolved", label: "Resolved" },
  { key: "settled", label: "Settled" },
];

export function MarketList() {
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

  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("soon");

  const rows: Row[] = useMemo(() => {
    if (!raw) return [];
    return raw
      .map((r, i) => (r.status === "success" ? { id: BigInt(i), m: r.result as unknown as Market } : null))
      .filter((x): x is Row => x !== null);
  }, [raw]);

  const stats = useMemo(() => {
    let tvl = 0n;
    let positions = 0n;
    let open = 0;
    for (const { m } of rows) {
      tvl += m[6];
      positions += m[7];
      if (Number(m[4]) === 0) open++;
    }
    return { tvl, positions, open, total: rows.length };
  }, [rows]);

  // the featured market: the open market resolving soonest
  const featured = useMemo(() => {
    const openRows = rows.filter((r) => Number(r.m[4]) === 0);
    if (openRows.length === 0) return null;
    return [...openRows].sort((a, b) => Number(a.m[2] - b.m[2]))[0];
  }, [rows]);

  const shown = useMemo(() => {
    let list = rows;
    if (filter !== "all") {
      const want = filter === "open" ? 0 : filter === "resolved" ? 1 : 2;
      list = list.filter((r) => Number(r.m[4]) === want);
    }
    // don't repeat the featured card in the grid when we're showing it
    if (featured && (filter === "all" || filter === "open")) list = list.filter((r) => r.id !== featured.id);
    const arr = [...list];
    if (sort === "pool") arr.sort((a, b) => Number(b.m[6] - a.m[6]));
    else if (sort === "newest") arr.sort((a, b) => Number(b.id - a.id));
    else arr.sort((a, b) => Number(a.m[2] - b.m[2]));
    return arr;
  }, [rows, filter, sort, featured]);

  if (isLoading) return <p className="muted mono">Loading markets…</p>;
  if (n === 0) return <p className="muted">No markets yet — check back soon.</p>;

  return (
    <>
      <div className="statrow">
        <Stat label="Markets" value={String(stats.total)} />
        <Stat label="Open now" value={String(stats.open)} />
        <Stat label="Total escrowed" value={ethCompact(stats.tvl)} />
        <Stat label="Shielded positions" value={String(stats.positions)} accent />
      </div>

      {featured && (filter === "all" || filter === "open") && <FeaturedMarket key={featured.id.toString()} id={featured.id} m={featured.m} />}

      <div className="filterbar">
        <div className="segmented">
          {FILTERS.map((f) => (
            <button key={f.key} className={filter === f.key ? "on" : ""} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        <label className="sortsel">
          <span className="mono">Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="soon">Resolving soon</option>
            <option value="pool">Pool size</option>
            <option value="newest">Newest</option>
          </select>
        </label>
      </div>

      {shown.length === 0 ? (
        <p className="muted" style={{ marginTop: "1.4rem" }}>Nothing here in this view.</p>
      ) : (
        <div className="grid">
          {shown.map((r, i) => (
            <MarketCard key={r.id.toString()} id={r.id} m={r.m} index={i} />
          ))}
        </div>
      )}
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

/// Distance of the live price to the market threshold, tinted + labelled by side.
function ThresholdDistance({ current, threshold }: { current: number | null; threshold: number }) {
  if (current === null) return <span className="dist muted mono">reading feed…</span>;
  const pct = ((current - threshold) / threshold) * 100;
  const over = current >= threshold;
  return (
    <span className={`dist mono ${over ? "tag-yes" : "tag-no"}`}>
      {over ? "▲" : "▼"} {Math.abs(pct).toFixed(2)}% {over ? "over" : "to target"}
    </span>
  );
}

function FeaturedMarket({ id, m }: Row) {
  const [feed, threshold, resolveAfter, , status, , totalPool, depositCount] = m;
  const { points, current } = usePriceHistory(feed);
  const target = Number(threshold) / 1e8;

  return (
    <motion.section
      className="featured"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.2, 0.7, 0.2, 1] }}
    >
      <div className="featured-head">
        <div>
          <span className="eyebrow">Resolving soonest</span>
          <h2 className="featured-title">ETH ≥ {usd(threshold)}</h2>
          <p className="featured-sub">
            Live Chainlink ETH/USD versus the threshold that decides this market. Positions stay shielded —
            the price is the only public signal.
          </p>
        </div>
        <span className={`pill ${statusClass(Number(status))}`}>{statusLabel(Number(status))}</span>
      </div>

      <PriceChart points={points} threshold={target} variant="full" />

      <div className="featured-foot">
        <div className="featured-metrics">
          <div className="fm">
            <span className="fm-k mono">Live ETH</span>
            <span className="fm-v">{current === null ? "—" : priceUsd(current, 0)}</span>
          </div>
          <div className="fm">
            <span className="fm-k mono">Pool</span>
            <span className="fm-v">{eth(totalPool)}</span>
          </div>
          <div className="fm">
            <span className="fm-k mono">Positions</span>
            <span className="fm-v">{depositCount.toString()}</span>
          </div>
          <div className="fm">
            <span className="fm-k mono">Resolves</span>
            <span className="fm-v"><Countdown resolveAfter={resolveAfter} /></span>
          </div>
        </div>
        <div className="featured-cta">
          <ThresholdDistance current={current} threshold={target} />
          <Link className="btn primary" href={`/deposit?market=${id.toString()}`}>
            Take a position
          </Link>
        </div>
      </div>
    </motion.section>
  );
}

function MarketCard({ id, m, index }: Row & { index: number }) {
  const { isConnected } = useAccount();

  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [6, -6]), { stiffness: 200, damping: 18 });
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [-6, 6]), { stiffness: 200, damping: 18 });
  const onMove = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width - 0.5);
    py.set((e.clientY - r.top) / r.height - 0.5);
  };
  const onLeave = () => {
    px.set(0);
    py.set(0);
  };

  const [feed, threshold, resolveAfter, , status, winningSide, totalPool] = m;
  const target = Number(threshold) / 1e8;
  const { points, current } = usePriceHistory(feed);

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });
  const { refetch } = useReadContract({ abi, address: PREDICTION_MARKET, functionName: "markets", args: [id], query: { enabled: false } });

  useEffect(() => {
    if (isSuccess) refetch();
  }, [isSuccess, refetch]);

  const now = BigInt(Math.floor(Date.now() / 1000));
  const isOpen = Number(status) === 0;
  const resolvable = isOpen && now >= resolveAfter;

  return (
    <motion.article
      className="card tilt"
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.55, ease: [0.2, 0.7, 0.2, 1], delay: index * 0.06 }}
      whileHover={{ y: -4 }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{ rotateX, rotateY, transformPerspective: 900 }}
    >
      <div className="card-top">
        <span className={`pill ${statusClass(Number(status))}`}>{statusLabel(Number(status))}</span>
        <span className="card-id">#{id.toString()}</span>
      </div>
      <h3>ETH ≥ {usd(threshold)}</h3>

      <div className="card-spark">
        <PriceChart points={points} threshold={target} variant="spark" />
      </div>

      <div className="meta">
        <div className="row">
          <span>Pool</span>
          <b>{eth(totalPool)}</b>
        </div>
        {Number(status) >= 1 ? (
          <div className="row">
            <span>Outcome</span>
            <b className={Number(winningSide) === 1 ? "tag-yes" : "tag-no"}>{sideLabel(Number(winningSide))}</b>
          </div>
        ) : (
          <div className="row">
            <span>Resolves</span>
            <b><Countdown resolveAfter={resolveAfter} /></b>
          </div>
        )}
        <div className="row">
          <span>Live</span>
          <ThresholdDistance current={current} threshold={target} />
        </div>
      </div>

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
            onClick={() => writeContract({ abi, address: PREDICTION_MARKET, functionName: "resolveMarket", args: [id] })}
            title={resolvable ? "Read Chainlink and set the outcome" : "Resolves later"}
          >
            {isPending ? "Confirm…" : confirming ? "Resolving…" : resolvable ? "Resolve" : "Locked"}
          </button>
        )}
        {Number(status) === 2 && (
          <Link className="btn sm" href={`/claim?market=${id.toString()}`}>
            Claim
          </Link>
        )}
        <Link className="btn sm ghost" href={`/solvency?market=${id.toString()}`}>
          Solvency
        </Link>
      </div>

      {error && (
        <p className="card-note tag-no">{(error as { shortMessage?: string }).shortMessage ?? "Transaction failed"}</p>
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
