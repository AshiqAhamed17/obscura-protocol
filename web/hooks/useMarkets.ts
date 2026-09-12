"use client";

import { useMemo } from "react";
import { useChainId, useReadContracts, useReadContract } from "wagmi";
import {
  abi,
  contractsFor,
  ResolutionSource,
  feedLabel,
  parseMarket,
  type Market,
  type MarketTuple,
} from "@/lib/contract";
import { usd } from "@/lib/format";

/// Human title for a market: feed-resolved shows the asset + threshold;
/// Graph/CRE-resolved markets have no on-chain feed, so name them by source.
export function marketTitle(m: Market, source: number): string {
  if (source === ResolutionSource.ChainlinkFeed) {
    return `${feedLabel(m.feed).asset} ≥ ${usd(m.threshold)}`;
  }
  if (source === ResolutionSource.GraphQuery) return "Graph-resolved market";
  return "CRE-resolved market";
}

export type MarketCategory = "Crypto" | "Commodities" | "Forex" | "Sports";

/// Verified Sepolia feed → category. Crypto assets, gold (commodity), EUR (forex).
const FEED_CATEGORY: Record<string, MarketCategory> = {
  "0x694aa1769357215de4fac081bf1f309adc325306": "Crypto", // ETH
  "0x1b44f3514812d835eb1bdb0acb33d3fa3351ee43": "Crypto", // BTC
  "0xc59e3633baac79493d908e63626716e204a45edf": "Crypto", // LINK
  "0xc5981f461d74c46eb4b0cf3f4ec79f025573b0ea": "Commodities", // XAU (gold)
  "0x1a81afb8146aeffcfc5e50e8479e826e7d55b910": "Forex", // EUR
};

/// Category for the secondary nav: price-feed markets by asset class; non-feed
/// (Graph/CRE event) markets are grouped under Sports.
export function marketCategory(m: Market, source: number): MarketCategory {
  if (source === ResolutionSource.ChainlinkFeed) {
    return FEED_CATEGORY[m.feed.toLowerCase()] ?? "Crypto";
  }
  return "Sports";
}

export interface MarketOption {
  id: number;
  market: Market;
  source: number;
  title: string;
  category: MarketCategory;
}

/// Loads every market on the connected chain (via multicall) with a ready-made
/// human title — shared by the marketplace, the deposit form, and the parlay
/// builder so dropdowns read "ETH ≥ $4,000" instead of "Market #1".
export function useMarkets(): { options: MarketOption[]; count: number; isLoading: boolean } {
  const chainId = useChainId();
  const { predictionMarket } = contractsFor(chainId);

  const { data: count, isLoading: loadingCount } = useReadContract({
    abi,
    address: predictionMarket,
    functionName: "marketCount",
  });
  const n = Number(count ?? 0n);

  const { data: raw, isLoading: loadingMarkets } = useReadContracts({
    contracts: Array.from({ length: n }, (_, i) => ({
      abi,
      address: predictionMarket,
      functionName: "markets" as const,
      args: [BigInt(i)] as const,
    })),
    query: { enabled: n > 0 },
  });

  const { data: sources } = useReadContracts({
    contracts: Array.from({ length: n }, (_, i) => ({
      abi,
      address: predictionMarket,
      functionName: "resolutionConfig" as const,
      args: [BigInt(i)] as const,
    })),
    query: { enabled: n > 0 },
  });

  const options = useMemo<MarketOption[]>(() => {
    if (!raw) return [];
    return raw
      .map((r, i) => {
        if (r.status !== "success" || !r.result) return null;
        const market = parseMarket(r.result as unknown as MarketTuple);
        const src = sources?.[i]?.result as readonly [number, ...unknown[]] | undefined;
        const source = src ? Number(src[0]) : ResolutionSource.ChainlinkFeed;
        return { id: i, market, source, title: marketTitle(market, source), category: marketCategory(market, source) };
      })
      .filter((o): o is MarketOption => o !== null);
  }, [raw, sources]);

  return { options, count: n, isLoading: loadingCount || loadingMarkets };
}
