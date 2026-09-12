"use client";

import { useState } from "react";
import { PriceChart } from "./PriceChart";
import { CandleChart } from "./CandleChart";
import { candleProductForFeed, useCandles } from "@/hooks/useCandles";
import type { PricePoint } from "@/hooks/usePriceHistory";

/// The market's price surface with two real views:
///  • Line — the live Chainlink feed that actually resolves the market.
///  • Candles — real Coinbase OHLC (crypto only; keyless). Lazily fetched.
/// The candle toggle only appears when a candle source exists for the feed
/// (gold/forex have none, so those stay line-only).
export function ChartPanel({
  feed,
  threshold,
  points,
  height,
}: {
  feed?: `0x${string}`;
  threshold: number;
  points: PricePoint[];
  height?: number;
}) {
  const product = candleProductForFeed(feed);
  const [mode, setMode] = useState<"line" | "candles">("line");
  const { candles, loading, error } = useCandles(mode === "candles" ? product : null);

  return (
    <div className="chartpanel">
      <div className="chart-toggle" role="tablist" aria-label="Chart type">
        <button role="tab" aria-selected={mode === "line"} className={mode === "line" ? "on" : ""} onClick={() => setMode("line")}>
          <span aria-hidden>〜</span> Line
        </button>
        {product && (
          <button role="tab" aria-selected={mode === "candles"} className={mode === "candles" ? "on" : ""} onClick={() => setMode("candles")}>
            <span aria-hidden>▮</span> Candles
          </button>
        )}
      </div>

      {mode === "line" ? (
        <PriceChart points={points} threshold={threshold} variant="full" height={height} />
      ) : error ? (
        <div className="pchart full loading" style={{ height: height ?? 260 }}>
          <span className="pchart-empty mono">candles unavailable — showing line view</span>
        </div>
      ) : loading || candles.length === 0 ? (
        <div className="pchart full loading" style={{ height: height ?? 260 }}>
          <div className="pchart-skel" />
          <span className="pchart-empty mono">loading candles…</span>
        </div>
      ) : (
        <CandleChart candles={candles} threshold={threshold} height={height ?? 260} />
      )}

      {mode === "candles" && !error && (
        <p className="chart-note mono">Candles: Coinbase spot (reference). The market resolves on the Chainlink feed — see the Line view.</p>
      )}
    </div>
  );
}
