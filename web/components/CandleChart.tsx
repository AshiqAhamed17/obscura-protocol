"use client";

import { useEffect, useRef } from "react";
import { createChart, ColorType, LineStyle, CrosshairMode, type CandlestickData, type UTCTimestamp } from "lightweight-charts";
import type { Candle } from "@/hooks/useCandles";

/// Candlestick view rendered with TradingView's free lightweight-charts, themed
/// to the Obscura dark palette. Data is real Coinbase OHLC (see useCandles). The
/// market threshold is drawn as a dashed price line so the "target" is always in
/// frame — same rule the line chart shows.
export function CandleChart({ candles, threshold, height = 260 }: { candles: Candle[]; threshold: number; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || candles.length === 0) return;

    const chart = createChart(el, {
      width: el.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(255,255,255,0.5)",
        fontFamily: "var(--mono, ui-monospace, monospace)",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.08)" },
      timeScale: { borderColor: "rgba(255,255,255,0.08)", timeVisible: true, secondsVisible: false },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(150,180,255,0.35)", labelBackgroundColor: "#1a1d24" },
        horzLine: { color: "rgba(150,180,255,0.35)", labelBackgroundColor: "#1a1d24" },
      },
      handleScale: false,
      handleScroll: false,
    });

    const series = chart.addCandlestickSeries({
      upColor: "#8fe6cb",
      downColor: "#ff9fae",
      borderVisible: false,
      wickUpColor: "rgba(143,230,203,0.7)",
      wickDownColor: "rgba(255,159,174,0.7)",
    });
    series.setData(candles as unknown as CandlestickData<UTCTimestamp>[]);

    if (threshold > 0) {
      series.createPriceLine({
        price: threshold,
        color: "rgba(150,180,255,0.7)",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "target",
      });
    }

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [candles, threshold, height]);

  return <div ref={ref} className="candle-chart" style={{ height }} />;
}
