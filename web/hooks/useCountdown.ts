"use client";

import { useEffect, useState } from "react";

/// Seconds remaining until a unix timestamp, ticking once per second.
/// Returns 0 once the target has passed. SSR-safe (starts from a stable value).
export function useCountdown(targetUnixSeconds?: bigint | number): number {
  const target = targetUnixSeconds === undefined ? 0 : Number(targetUnixSeconds);
  const [secondsLeft, setSecondsLeft] = useState(() => remaining(target));

  useEffect(() => {
    setSecondsLeft(remaining(target));
    const iv = setInterval(() => setSecondsLeft(remaining(target)), 1000);
    return () => clearInterval(iv);
  }, [target]);

  return secondsLeft;
}

function remaining(target: number): number {
  if (!target) return 0;
  return Math.max(0, target - Math.floor(Date.now() / 1000));
}
