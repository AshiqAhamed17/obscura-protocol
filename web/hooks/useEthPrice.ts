"use client";

import { useReadContract } from "wagmi";
import { useEffect, useRef, useState } from "react";
import { aggregatorAbi, ETH_USD_FEED } from "@/lib/contract";

export type Trend = "up" | "down" | "flat";

/// Latest ETH/USD from the canonical Sepolia feed, polled for the nav ticker,
/// plus the tick direction versus the previous reading (for a subtle up/down cue).
export function useEthPrice(): { price: number | null; trend: Trend } {
  const { data } = useReadContract({
    abi: aggregatorAbi,
    address: ETH_USD_FEED,
    functionName: "latestRoundData",
    query: { refetchInterval: 15_000 },
  });

  const price = data ? Number((data as readonly bigint[])[1]) / 1e8 : null;
  const prev = useRef<number | null>(null);
  const [trend, setTrend] = useState<Trend>("flat");

  useEffect(() => {
    if (price === null) return;
    if (prev.current !== null && price !== prev.current) {
      setTrend(price > prev.current ? "up" : "down");
    }
    prev.current = price;
  }, [price]);

  return { price, trend };
}
