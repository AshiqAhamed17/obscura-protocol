import { formatEther } from "viem";
import { Side, Status } from "./contract";

export function statusLabel(s: number): string {
  return ["Open", "Resolved", "Settled"][s] ?? "Unknown";
}
export function statusClass(s: number): string {
  return ["open", "resolved", "settled"][s] ?? "";
}
export function sideLabel(s: number): string {
  return s === Side.Yes ? "Yes" : "No";
}

/// Chainlink price feeds use 8 decimals; render the threshold as USD.
export function usd(threshold: bigint): string {
  const dollars = Number(threshold) / 1e8;
  return dollars.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function eth(wei: bigint, digits = 4): string {
  const v = Number(formatEther(wei));
  return `${v.toLocaleString("en-US", { maximumFractionDigits: digits })} ETH`;
}

export function whenResolves(resolveAfter: bigint): string {
  const d = new Date(Number(resolveAfter) * 1000);
  const now = Date.now();
  const ms = d.getTime() - now;
  if (ms <= 0) return `resolvable now`;
  const hrs = Math.round(ms / 3.6e6);
  return hrs >= 24 ? `in ${Math.round(hrs / 24)}d` : `in ${hrs}h`;
}

/// Plain USD (8-decimal Chainlink price) with cents, for live tickers/tooltips.
export function priceUsd(scaled: number, digits = 2): string {
  return scaled.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/// Compact ETH, e.g. "1.24 ETH" / "12.3k ETH", for dense stat rows.
export function ethCompact(wei: bigint): string {
  const v = Number(formatEther(wei));
  if (v >= 1000) return `${(v / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}k ETH`;
  return `${v.toLocaleString("en-US", { maximumFractionDigits: 3 })} ETH`;
}

/// Split a remaining-seconds count into d/h/m/s for a ticking countdown.
export function splitDuration(secondsLeft: number): { d: number; h: number; m: number; s: number } {
  const s = Math.max(0, Math.floor(secondsLeft));
  return {
    d: Math.floor(s / 86400),
    h: Math.floor((s % 86400) / 3600),
    m: Math.floor((s % 3600) / 60),
    s: s % 60,
  };
}

/// Compact countdown string, e.g. "2d 04h", "58m 12s", or "resolvable".
export function countdownLabel(secondsLeft: number): string {
  if (secondsLeft <= 0) return "resolvable";
  const { d, h, m, s } = splitDuration(secondsLeft);
  if (d > 0) return `${d}d ${h.toString().padStart(2, "0")}h`;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

export { Side, Status };
