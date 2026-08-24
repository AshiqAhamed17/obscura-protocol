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

export { Side, Status };
