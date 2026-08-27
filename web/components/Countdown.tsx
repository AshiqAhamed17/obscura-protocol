"use client";

import { useCountdown } from "@/hooks/useCountdown";
import { countdownLabel } from "@/lib/format";

/// Live, once-per-second countdown to a market's resolution timestamp.
/// Renders "resolvable" (mint) once the moment has passed.
export function Countdown({ resolveAfter, className = "" }: { resolveAfter: bigint; className?: string }) {
  const left = useCountdown(resolveAfter);
  const ready = left <= 0;
  return (
    <span className={`countdown mono ${ready ? "ready" : ""} ${className}`} suppressHydrationWarning>
      {ready ? "resolvable" : countdownLabel(left)}
    </span>
  );
}
