"use client";

import Link from "next/link";
import { Reveal } from "@/components/Reveal";

/// The three sponsor integrations, told as an editorial list — what each one
/// does for Obscura, and where to see it in the app.
const STACK = [
  {
    sponsor: "Chainlink CRE",
    title: "Settled confidentially, proven correct",
    body:
      "Node operators sum everyone's private positions inside a TEE and reveal only the totals; an SP1 proof makes that settlement trustlessly correct on-chain. Confidential and verifiable — we keep both.",
    href: "/risk",
    cta: "See the settlement story",
    accent: "var(--yes)",
  },
  {
    sponsor: "The Graph",
    title: "A risk oracle that refuses to guess",
    body:
      "A subgraph indexes only public aggregates — never your position. An AI oracle reasons over it with a pinned deployment and a freshness gate, and benchmarks the book against live mainnet DeFi.",
    href: "/risk",
    cta: "Open the risk oracle",
    accent: "#c8a2ff",
  },
  {
    sponsor: "Circle · Arc",
    title: "Dollars in, dollars out — cross-chain",
    body:
      "Escrow is USDC, and on Arc, USDC is the gas. Bridge USDC from another chain with CCTP and open a shielded position in one journey; winners claim in USDC.",
    href: "/markets",
    cta: "Bet in USDC",
    accent: "#6bd6b0",
  },
];

export function Stack() {
  return (
    <section id="stack" className="wrap stack-section">
      <Reveal>
        <div className="kicker">The stack</div>
        <h2 className="landing-h2 stack-h2">
          Three integrations doing one honest job.
        </h2>
      </Reveal>
      <div className="stack-list">
        {STACK.map((s, i) => (
          <Reveal key={s.sponsor} delay={60 * i}>
            <article className="stack-row">
              <div className="stack-row-head">
                <span className="stack-sponsor mono" style={{ color: s.accent }}>
                  {s.sponsor}
                </span>
                <h3 className="stack-title">{s.title}</h3>
              </div>
              <p className="stack-body">{s.body}</p>
              <Link className="stack-cta" href={s.href}>
                {s.cta} <span aria-hidden>↗</span>
              </Link>
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
