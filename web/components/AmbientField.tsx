"use client";

import { useEffect, useRef } from "react";

/// A faint, slow field of rising motes behind app pages — a lightweight echo of
/// the landing's dark pool, so the whole app feels of a piece. 2D canvas, cheap.
export function AmbientField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0;
    let H = 0;
    let pts: { x: number; y: number; r: number; sp: number; a: number }[] = [];

    const resize = () => {
      W = cv.width = window.innerWidth * DPR;
      H = cv.height = window.innerHeight * DPR;
      cv.style.width = `${window.innerWidth}px`;
      cv.style.height = `${window.innerHeight}px`;
      const n = Math.max(36, Math.floor(window.innerWidth / 24));
      pts = Array.from({ length: n }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        r: (0.5 + Math.random() * 1.3) * DPR,
        sp: (0.05 + Math.random() * 0.22) * DPR,
        a: Math.random() * Math.PI * 2,
      }));
    };
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      const now = Date.now();
      for (const p of pts) {
        p.y -= p.sp;
        if (p.y < -4) {
          p.y = H + 4;
          p.x = Math.random() * W;
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(150,180,255,${0.08 + 0.1 * Math.sin(now * 0.001 + p.a)})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    if (reduce) {
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(150,180,255,0.12)";
        ctx.fill();
      }
    } else {
      raf = requestAnimationFrame(draw);
    }
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={ref} className="ambient-field" aria-hidden />;
}
