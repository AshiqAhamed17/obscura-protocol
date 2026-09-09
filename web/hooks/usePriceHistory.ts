"use client";

import { useEffect, useRef, useState } from "react";
import { usePublicClient } from "wagmi";
import { aggregatorAbi } from "@/lib/contract";

export type PricePoint = { t: number; p: number };

const SEED_ROUNDS = 40; // how many historical Chainlink rounds to walk back
const MAX_POINTS = 160; // rolling cap once live points accrue
const POLL_MS = 12_000; // live refresh cadence

/// Live price history for a Chainlink feed, seeded from real on-chain rounds.
///
/// It reads `latestRoundData`, then multicalls `getRoundData` back over the last
/// ~40 rounds (one RPC via Multicall3) to draw an immediate line, and appends a
/// fresh point every 12s. This is genuinely the oracle feed — not an external
/// price API — so the chart matches what actually resolves the market. If a feed
/// has too little history (or rounds revert at a phase boundary), it degrades to
/// starting live and growing from now.
export function usePriceHistory(feed?: `0x${string}`): {
  points: PricePoint[];
  current: number | null;
  loading: boolean;
} {
  const client = usePublicClient();
  const [points, setPoints] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const lastT = useRef(0);

  useEffect(() => {
    if (!client || !feed) return;
    let alive = true;
    lastT.current = 0;
    setPoints([]);
    setLoading(true);

    async function seed() {
      try {
        const latest = (await client!.readContract({
          abi: aggregatorAbi,
          address: feed!,
          functionName: "latestRoundData",
        })) as readonly [bigint, bigint, bigint, bigint, bigint];

        const latestId = latest[0];
        const ids: bigint[] = [];
        for (let i = SEED_ROUNDS - 1; i >= 0; i--) {
          const id = latestId - BigInt(i);
          if (id > 0n) ids.push(id);
        }

        const rounds = await client!.multicall({
          allowFailure: true,
          contracts: ids.map((id) => ({
            abi: aggregatorAbi,
            address: feed!,
            functionName: "getRoundData" as const,
            args: [id] as const,
          })),
        });

        const seeded: PricePoint[] = [];
        for (const r of rounds) {
          if (r.status !== "success") continue;
          const [, answer, , updatedAt] = r.result as readonly [bigint, bigint, bigint, bigint, bigint];
          if (answer <= 0n || updatedAt === 0n) continue;
          seeded.push({ t: Number(updatedAt) * 1000, p: Number(answer) / 1e8 });
        }
        // de-dupe identical timestamps, keep ascending
        const dedup = Array.from(new Map(seeded.map((pt) => [pt.t, pt])).values()).sort((a, b) => a.t - b.t);

        if (!alive) return;
        if (dedup.length > 0) {
          lastT.current = dedup[dedup.length - 1].t;
          setPoints(dedup.slice(-MAX_POINTS));
        } else {
          // no usable history — begin live from the latest reading
          const pt = { t: Number(latest[3]) * 1000 || Date.now(), p: Number(latest[1]) / 1e8 };
          lastT.current = pt.t;
          setPoints([pt]);
        }
      } catch {
        // network hiccup — leave empty; the poll below will retry
      } finally {
        if (alive) setLoading(false);
      }
    }

    async function poll() {
      try {
        const latest = (await client!.readContract({
          abi: aggregatorAbi,
          address: feed!,
          functionName: "latestRoundData",
        })) as readonly [bigint, bigint, bigint, bigint, bigint];
        const t = Number(latest[3]) * 1000 || Date.now();
        const p = Number(latest[1]) / 1e8;
        if (p <= 0) return;
        // only append when the reading is newer than what we have
        if (t <= lastT.current) return;
        lastT.current = t;
        setPoints((prev) => [...prev, { t, p }].slice(-MAX_POINTS));
      } catch {
        /* ignore transient errors */
      }
    }

    seed();
    const iv = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [client, feed]);

  const current = points.length ? points[points.length - 1].p : null;
  return { points, current, loading };
}
