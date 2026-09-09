"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { useReadContract, useReadContracts, useWaitForTransactionReceipt, useWriteContract, useAccount } from "wagmi";
import {
  abi,
  PREDICTION_MARKET,
  ResolutionSource,
  resolutionLabel,
  feedLabel,
  parseMarket,
  type Market,
  type MarketTuple,
} from "@/lib/contract";
import { statusLabel, statusClass, outcomeLabel, usd, usdc, usdcCompact, priceUsd } from "@/lib/format";
import { usePriceHistory } from "@/hooks/usePriceHistory";
import { PriceChart } from "./PriceChart";
import { Countdown } from "./Countdown";

type Row = { id: bigint; m: Market; source: number };
type Filter = "all" | "open" | "resolved" | "settled";
type Sort = "soon" | "pool" | "newest";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "resolved", label: "Resolved" },
  { key: "settled", label: "Settled" },
];

/// Human title for a market: feed-resolved shows the asset + threshold;
/// Graph/CRE-resolved markets have no on-chain feed, so name them by source.
function marketTitle(m: Market, source: number): string {
  if (source === ResolutionSource.ChainlinkFeed) {
    return `${feedLabel(m.feed).asset} ≥ ${usd(m.threshold)}`;
  }
  if (source === ResolutionSource.GraphQuery) return "Graph-resolved market";
  return "CRE-resolved market";
}

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

  const { data: sources } = useReadContracts({
    contracts: Array.from({ length: n }, (_, i) => ({
      abi,
      address: PREDICTION_MARKET,
      functionName: "resolutionConfig" as const,
      args: [BigInt(i)] as const,
    })),
    query: { enabled: n > 0 },
  });

  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("soon");

  const rows: Row[] = useMemo(() => {
    if (!raw) return [];
    return raw
      .map((r, i) => {
        if (r.status !== "success") return null;
        const src = sources?.[i]?.status === "success" ? Number((sources[i].result as readonly unknown[])[0]) : 0;
        return { id: BigInt(i), m: parseMarket(r.result as unknown as MarketTuple), source: src };
      })
      .filter((x): x is Row => x !== null);
  }, [raw, sources]);

  const stats = useMemo(() => {
    let tvl = 0n;
    let positions = 0n;
    let open = 0;
    for (const { m } of rows) {
      tvl += m.totalPool;
      positions += m.depositCount;
      if (m.status === 0) open++;
    }
    return { tvl, positions, open, total: rows.length };
  }, [rows]);

  // the featured market: the open, feed-resolved market resolving soonest
  const featured = useMemo(() => {
    const openRows = rows.filter((r) => r.m.status === 0 && r.source === ResolutionSource.ChainlinkFeed);
    if (openRows.length === 0) return null;
    return [...openRows].sort((a, b) => Number(a.m.resolveAfter - b.m.resolveAfter))[0];
  }, [rows]);

  const shown = useMemo(() => {
    let list = rows;
    if (filter !== "all") {
      const want = filter === "open" ? 0 : filter === "resolved" ? 1 : 2;
      list = list.filter((r) => r.m.status === want);
    }
    if (featured && (filter === "all" || filter === "open")) list = list.filter((r) => r.id !== featured.id);
    const arr = [...list];
    if (sort === "pool") arr.sort((a, b) => Number(b.m.totalPool - a.m.totalPool));
    else if (sort === "newest") arr.sort((a, b) => Number(b.id - a.id));
    else arr.sort((a, b) => Number(a.m.resolveAfter - b.m.resolveAfter));
    return arr;
  }, [rows, filter, sort, featured]);

  if (isLoading) return <p className="muted mono">Loading markets…</p>;
  if (n === 0) return <p className="muted">No markets yet — check back soon.</p>;

  return (
    <>
      <div className="statrow">
        <Stat label="Markets" value={String(stats.total)} />
        <Stat label="Open now" value={String(stats.open)} />
        <Stat label="Total escrowed" value={usdcCompact(stats.tvl)} />
        <Stat label="Shielded positions" value={String(stats.positions)} accent />
      </div>

      {featured && (filter === "all" || filter === "open") && (
        <FeaturedMarket key={featured.id.toString()} id={featured.id} m={featured.m} source={featured.source} />
      )}

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
            <MarketCard key={r.id.toString()} id={r.id} m={r.m} source={r.source} index={i} />
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

/// A small chip naming a market's resolution source (Chainlink / Graph / CRE).
function SourceChip({ source }: { source: number }) {
  const cls = source === ResolutionSource.ChainlinkFeed ? "src-feed" : source === ResolutionSource.GraphQuery ? "src-graph" : "src-cre";
  return <span className={`src-chip ${cls} mono`}>{resolutionLabel[source] ?? "source"}</span>;
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

function FeaturedMarket({ id, m, source }: Row) {
  const { points, current } = usePriceHistory(m.feed);
  const target = Number(m.threshold) / 1e8;
  const feed = feedLabel(m.feed);

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
          <h2 className="featured-title">{feed.asset} ≥ {usd(m.threshold)}</h2>
          <p className="featured-sub">
            Live Chainlink {feed.asset}/{feed.unit} versus the threshold that decides this market. Positions stay
            shielded — the price is the only public signal.
          </p>
        </div>
        <div className="featured-tags">
          <span className={`pill ${statusClass(m.status)}`}>{statusLabel(m.status)}</span>
          <SourceChip source={source} />
        </div>
      </div>

      <PriceChart points={points} threshold={target} variant="full" />

      <div className="featured-foot">
        <div className="featured-metrics">
          <div className="fm">
            <span className="fm-k mono">Live {feed.asset}</span>
            <span className="fm-v">{current === null ? "—" : priceUsd(current, 0)}</span>
          </div>
          <div className="fm">
            <span className="fm-k mono">Pool</span>
            <span className="fm-v">{usdc(m.totalPool)}</span>
          </div>
          <div className="fm">
            <span className="fm-k mono">Positions</span>
            <span className="fm-v">{m.depositCount.toString()}</span>
          </div>
          <div className="fm">
            <span className="fm-k mono">Resolves</span>
            <span className="fm-v"><Countdown resolveAfter={m.resolveAfter} /></span>
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

function MarketCard({ id, m, source, index }: Row & { index: number }) {
  const { isConnected } = useAccount();
  const isFeed = source === ResolutionSource.ChainlinkFeed;

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

  const target = Number(m.threshold) / 1e8;
  const { points, current } = usePriceHistory(isFeed ? m.feed : ("0x0000000000000000000000000000000000000000" as `0x${string}`));

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });
  const { refetch } = useReadContract({ abi, address: PREDICTION_MARKET, functionName: "markets", args: [id], query: { enabled: false } });

  useEffect(() => {
    if (isSuccess) refetch();
  }, [isSuccess, refetch]);

  const now = BigInt(Math.floor(Date.now() / 1000));
  const isOpen = m.status === 0;
  const resolvable = isOpen && isFeed && now >= m.resolveAfter;

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
        <span className={`pill ${statusClass(m.status)}`}>{statusLabel(m.status)}</span>
        <span className="card-id">#{id.toString()}</span>
      </div>
      <h3>{marketTitle(m, source)}</h3>

      <div className="card-src"><SourceChip source={source} />{m.numOutcomes > 2 && <span className="src-chip mono">{m.numOutcomes} outcomes</span>}</div>

      {isFeed && (
        <div className="card-spark">
          <PriceChart points={points} threshold={target} variant="spark" />
        </div>
      )}

      <div className="meta">
        <div className="row">
          <span>Pool</span>
          <b>{usdc(m.totalPool)}</b>
        </div>
        {m.status >= 1 ? (
          <div className="row">
            <span>Outcome</span>
            <b className={m.winningOutcome === 1 ? "tag-yes" : "tag-no"}>{outcomeLabel(m.winningOutcome, m.numOutcomes)}</b>
          </div>
        ) : (
          <div className="row">
            <span>Resolves</span>
            <b><Countdown resolveAfter={m.resolveAfter} /></b>
          </div>
        )}
        {isFeed && (
          <div className="row">
            <span>Live</span>
            <ThresholdDistance current={current} threshold={target} />
          </div>
        )}
      </div>

      <div className="actions">
        {isOpen && (
          <Link className="btn primary sm" href={`/deposit?market=${id.toString()}`}>
            Take a position
          </Link>
        )}
        {isOpen && isFeed && (
          <button
            className="btn sm"
            disabled={!isConnected || !resolvable || isPending || confirming}
            onClick={() => writeContract({ abi, address: PREDICTION_MARKET, functionName: "resolveMarket", args: [id] })}
            title={resolvable ? "Read Chainlink and set the outcome" : "Resolves later"}
          >
            {isPending ? "Confirm…" : confirming ? "Resolving…" : resolvable ? "Resolve" : "Locked"}
          </button>
        )}
        {m.status === 2 && (
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
