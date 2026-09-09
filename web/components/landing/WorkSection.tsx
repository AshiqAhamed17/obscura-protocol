"use client";

import { useEffect, useRef, useState } from "react";

const STEPS = [
  {
    i: "01",
    label: "Deposit",
    body: (
      <>
        <p>
          You escrow ETH and submit a Poseidon <code>commitment</code> to your bet. The chain records
          a fingerprint, not your side.
        </p>
        <p>Two identical bets produce different commitments, so nothing can be correlated.</p>
      </>
    ),
  },
  {
    i: "02",
    label: "Resolve",
    body: (
      <>
        <p>
          After the deadline, the contract reads the outcome from a <code>Chainlink</code> price feed
          and records the winning side.
        </p>
        <p>A staleness guard rejects a dead feed — resolution is deterministic, never a verdict.</p>
      </>
    ),
  },
  {
    i: "03",
    label: "Settle",
    body: (
      <>
        <p>
          An <code>SP1</code> zkVM proves every market&apos;s totals and Merkle root are correct and
          solvent — across the whole batch in one proof.
        </p>
        <p>Anyone can submit it on-chain. No operator is trusted for the numbers.</p>
      </>
    ),
  },
  {
    i: "04",
    label: "Claim",
    body: (
      <>
        <p>
          You prove in <code>Noir</code> that you hold a winning note and burn its nullifier — no
          double-claims, no link from payout to deposit.
        </p>
        <p>The recipient is bound into the proof, so the claim can&apos;t be front-run.</p>
      </>
    ),
  },
];

export function WorkSection() {
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0;
    let H = 0;

    const size = () => {
      const r = cv.getBoundingClientRect();
      W = cv.width = r.width * DPR;
      H = cv.height = r.height * DPR;
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(cv);

    let t = 0;
    let raf = 0;
    const draw = () => {
      t += 0.01;
      ctx.clearRect(0, 0, W, H);
      const levels = 4;
      const cx = W / 2;
      const topY = H * 0.16;
      const botY = H * 0.82;
      const spanTop = W * 0.62;
      const nodes: { x: number; y: number }[][] = [];
      for (let l = 0; l < levels; l++) {
        const count = 2 ** l;
        const y = topY + (botY - topY) * (l / (levels - 1));
        const span = spanTop * (l / (levels - 1)) * 1.1 + W * 0.12;
        const row: { x: number; y: number }[] = [];
        for (let i = 0; i < count; i++) {
          const x = count === 1 ? cx : cx - span / 2 + span * (i / (count - 1));
          row.push({ x, y });
        }
        nodes.push(row);
      }
      ctx.lineWidth = 1 * DPR;
      for (let l = 0; l < levels - 1; l++) {
        for (let i = 0; i < nodes[l].length; i++) {
          const p = nodes[l][i];
          [nodes[l + 1][i * 2], nodes[l + 1][i * 2 + 1]].forEach((c) => {
            ctx.strokeStyle = "rgba(255,255,255,0.06)";
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(c.x, c.y);
            ctx.stroke();
          });
        }
      }
      const reveal = (activeRef.current + 1) / 4;
      for (let l = 0; l < levels; l++) {
        const depthFrac = 1 - l / (levels - 1);
        const lit = depthFrac <= reveal + 0.001;
        for (let i = 0; i < nodes[l].length; i++) {
          const n = nodes[l][i];
          const pulse = 0.5 + 0.5 * Math.sin(t * 2 + l + i);
          ctx.beginPath();
          ctx.arc(n.x, n.y, (l === 0 ? 4.5 : 3) * DPR, 0, 7);
          if (l === 0) {
            ctx.fillStyle = `rgba(${lit ? "143,230,203" : "180,190,210"},${0.5 + pulse * 0.4})`;
            ctx.shadowColor = "rgba(143,230,203,0.6)";
            ctx.shadowBlur = (lit ? 12 : 0) * DPR;
          } else {
            ctx.fillStyle = `rgba(168,192,255,${lit ? 0.55 + pulse * 0.35 : 0.14})`;
            ctx.shadowColor = "rgba(168,192,255,0.5)";
            ctx.shadowBlur = (lit ? 10 : 0) * DPR;
          }
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
      if (!reduce) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <section className="band wrap" id="work">
      <div className="kicker">
        <b>How it works</b> — deposit to payout
      </div>
      <div className="landing-h2">
        Four steps. <em>Two</em> proofs.
      </div>
      <div className="work">
        <div className="work-left">
          <div className="tabs">
            {STEPS.map((s, i) => (
              <button key={s.i} className={`tab ${active === i ? "on" : ""}`} onClick={() => setActive(i)}>
                <span className="mk">→</span>
                <span className="step-i">{s.i}</span>
                {s.label}
              </button>
            ))}
          </div>
          <div className="panel-copy">{STEPS[active].body}</div>
          <a className="doclink" href="https://github.com/AshiqAhamed17/obscura-protocol" target="_blank" rel="noreferrer">
            Read the code ↗
          </a>
        </div>
        <div className="viz">
          <canvas ref={canvasRef} aria-hidden />
          <div className="viz-cap">
            commitments tree · <b>root proven by SP1</b>
          </div>
        </div>
      </div>
    </section>
  );
}
