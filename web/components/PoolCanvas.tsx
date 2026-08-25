"use client";

import { useEffect, useRef } from "react";

/// Animated "dark pool" surface: a luminous waterline with shimmering caustics,
/// a faint reflection below, and slow rising motes of light. Cool moonlight
/// palette, kept subtle so the wordmark stays legible. Respects reduced motion.
export function PoolCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0;
    let H = 0;

    type Mote = { x: number; y: number; r: number; sp: number; a: number };
    let motes: Mote[] = [];

    const resize = () => {
      const rect = canvas.parentElement!.getBoundingClientRect();
      W = canvas.width = Math.floor(rect.width * DPR);
      H = canvas.height = Math.floor(rect.height * DPR);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const count = Math.max(24, Math.floor(rect.width / 26));
      motes = Array.from({ length: count }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        r: (0.6 + Math.random() * 1.6) * DPR,
        sp: (0.15 + Math.random() * 0.5) * DPR,
        a: Math.random() * Math.PI * 2,
      }));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement!);

    const C = "150,180,255"; // moonlight

    const drawSurface = (t: number) => {
      const surfaceY = H * 0.6;

      // rising motes
      for (const m of motes) {
        m.y -= m.sp;
        m.x += Math.sin(t * 0.0006 + m.a) * 0.15 * DPR;
        if (m.y < -4) {
          m.y = H + 4;
          m.x = Math.random() * W;
        }
        const near = 1 - Math.min(1, Math.abs(m.y - surfaceY) / (H * 0.5));
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${C},${0.06 + near * 0.22})`;
        ctx.fill();
      }

      // caustic ripple lines above the surface
      const lines = 5;
      ctx.lineWidth = 1 * DPR;
      for (let i = 0; i < lines; i++) {
        const off = (i + 1) * 10 * DPR;
        const amp = (3 + i * 2) * DPR;
        const alpha = 0.05 * (1 - i / lines);
        ctx.beginPath();
        for (let x = W * 0.08; x <= W * 0.92; x += 6 * DPR) {
          const y = surfaceY - off + Math.sin(x * 0.01 + t * 0.001 + i) * amp * Math.sin(x * 0.003 - t * 0.0007);
          x === W * 0.08 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(${C},${alpha})`;
        ctx.stroke();
      }

      // the bright surface line with bloom
      const grad = ctx.createLinearGradient(W * 0.08, 0, W * 0.92, 0);
      grad.addColorStop(0, `rgba(${C},0)`);
      grad.addColorStop(0.22, `rgba(${C},0.75)`);
      grad.addColorStop(0.5, `rgba(255,255,255,0.95)`);
      grad.addColorStop(0.78, `rgba(${C},0.75)`);
      grad.addColorStop(1, `rgba(${C},0)`);
      ctx.save();
      ctx.shadowColor = `rgba(${C},0.6)`;
      ctx.shadowBlur = 22 * DPR;
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.4 * DPR;
      ctx.beginPath();
      ctx.moveTo(W * 0.08, surfaceY);
      ctx.lineTo(W * 0.92, surfaceY);
      ctx.stroke();
      ctx.restore();

      // faint reflection below the surface
      ctx.save();
      ctx.globalAlpha = 0.4;
      const refl = ctx.createLinearGradient(0, surfaceY, 0, surfaceY + 140 * DPR);
      refl.addColorStop(0, `rgba(${C},0.1)`);
      refl.addColorStop(1, `rgba(${C},0)`);
      ctx.fillStyle = refl;
      ctx.fillRect(W * 0.08, surfaceY, W * 0.84, 140 * DPR);
      ctx.restore();
    };

    let raf = 0;
    const loop = (t: number) => {
      ctx.clearRect(0, 0, W, H);
      drawSurface(t);
      raf = requestAnimationFrame(loop);
    };

    if (reduce) {
      drawSurface(0);
    } else {
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="pool-canvas" aria-hidden />;
}
