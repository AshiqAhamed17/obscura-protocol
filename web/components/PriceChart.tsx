"use client";

import { useId, useMemo, useState } from "react";
import type { PricePoint } from "@/hooks/usePriceHistory";
import { priceUsd } from "@/lib/format";

/// Bespoke SVG price chart in the Dark Pool language: a monochrome moonlight line
/// tracking a Chainlink feed toward the market's threshold rule. The current point
/// is tinted mint/rose by which side it's leaning — never color alone, always with
/// the threshold's position and a label. `full` gets axes + hover crosshair; `spark`
/// is a bare inline trend for cards.
export function PriceChart({
  points,
  threshold,
  variant = "full",
  height,
}: {
  points: PricePoint[];
  threshold: number;
  variant?: "full" | "spark";
  height?: number;
}) {
  const uid = useId().replace(/:/g, "");
  const spark = variant === "spark";
  const h = height ?? (spark ? 44 : 200);
  const [hover, setHover] = useState<number | null>(null);

  // vertical breathing room; leave a touch on the right for the glowing head dot
  const pTop = 0.12;
  const pBot = 0.12;
  const pRight = spark ? 0.02 : 0.03;

  const geom = useMemo(() => {
    if (points.length < 2) return null;
    const prices = points.map((p) => p.p);
    let lo = Math.min(...prices, threshold);
    let hi = Math.max(...prices, threshold);
    if (hi === lo) {
      hi = lo * 1.001 || 1;
      lo = lo * 0.999;
    }
    const n = points.length;
    const x = (i: number) => (i / (n - 1)) * (1 - pRight);
    const y = (v: number) => pTop + (1 - (v - lo) / (hi - lo)) * (1 - pTop - pBot);
    const line = points.map((p, i) => `${x(i)},${y(p.p)}`).join(" ");
    const area = `${x(0)},1 ${line} ${x(n - 1)},1`;
    return { lo, hi, x, y, line, area, n, thY: y(threshold) };
  }, [points, threshold, pRight]);

  if (!geom) {
    return (
      <div className={`pchart ${spark ? "spark" : "full"} loading`} style={{ height }}>
        <div className="pchart-skel" />
        {!spark && <span className="pchart-empty mono">establishing feed…</span>}
      </div>
    );
  }

  const last = points[geom.n - 1];
  const over = last.p >= threshold;
  const headX = geom.x(geom.n - 1) * 100;
  const headY = geom.y(last.p) * 100;
  const hovered = hover !== null ? points[hover] : null;
  const hx = hovered ? geom.x(hover!) * 100 : 0;
  const hy = hovered ? geom.y(hovered.p) * 100 : 0;
  const fmtTime = (t: number) =>
    new Date(t).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className={`pchart ${spark ? "spark" : "full"} ${over ? "over" : "under"}`} style={{ height: h }}>
      <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id={`fill-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(150,180,255)" stopOpacity={spark ? 0.14 : 0.2} />
            <stop offset="100%" stopColor="rgb(150,180,255)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {!spark &&
          [0.25, 0.5, 0.75].map((g) => (
            <line key={g} x1="0" x2="1" y1={g} y2={g} className="pchart-grid" vectorEffect="non-scaling-stroke" />
          ))}

        <polygon points={geom.area} fill={`url(#fill-${uid})`} />
        <polyline points={geom.line} className="pchart-line" vectorEffect="non-scaling-stroke" />
        <line
          x1="0"
          x2="1"
          y1={geom.thY}
          y2={geom.thY}
          className="pchart-threshold"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {/* threshold marker + label */}
      <span className="pchart-thline" style={{ top: `${geom.thY * 100}%` }} />
      {!spark && (
        <span className="pchart-thlabel mono" style={{ top: `${geom.thY * 100}%` }}>
          target {priceUsd(threshold, 0)}
        </span>
      )}

      {/* glowing current-price head */}
      <span className={`pchart-head ${over ? "yes" : "no"}`} style={{ left: `${headX}%`, top: `${headY}%` }} />

      {/* axis labels (full only) */}
      {!spark && (
        <>
          <span className="pchart-ymax mono">{priceUsd(geom.hi, 0)}</span>
          <span className="pchart-ymin mono">{priceUsd(geom.lo, 0)}</span>
          <span className="pchart-xend mono">as of {fmtTime(last.t)}</span>
        </>
      )}

      {/* hover crosshair + tooltip (full only) */}
      {!spark && hovered && (
        <>
          <span className="pchart-cross" style={{ left: `${hx}%` }} />
          <span className={`pchart-hoverdot ${hovered.p >= threshold ? "yes" : "no"}`} style={{ left: `${hx}%`, top: `${hy}%` }} />
          <span
            className="pchart-tip mono"
            style={{ left: `${hx}%`, top: `${hy}%`, transform: `translate(${hx > 60 ? "-108%" : "8%"}, -130%)` }}
          >
            <b>{priceUsd(hovered.p)}</b>
            <span>{fmtTime(hovered.t)}</span>
          </span>
        </>
      )}

      {!spark && (
        <div
          className="pchart-hit"
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
            setHover(Math.round((f / (1 - pRight)) * (geom.n - 1)));
          }}
          onMouseLeave={() => setHover(null)}
        />
      )}
    </div>
  );
}
