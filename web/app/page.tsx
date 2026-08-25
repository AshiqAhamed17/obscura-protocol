import Link from "next/link";
import { Reveal } from "@/components/Reveal";
import { Hero } from "@/components/Hero";

const STEPS = [
  {
    n: "01",
    title: "Deposit privately",
    body: "Your bet becomes a Poseidon commitment. Only the fingerprint goes on-chain — your Yes/No side stays hidden.",
  },
  {
    n: "02",
    title: "Resolve on Chainlink",
    body: "After the deadline the market reads a Chainlink price feed and records the winning side. No admin verdict.",
  },
  {
    n: "03",
    title: "Settle by proof",
    body: "An SP1 zkVM proves the whole book's totals are correct and solvent — then winners claim, unlinkably.",
  },
];

export default function Home() {
  return (
    <main>
      {/* Hero — the dark pool */}
      <Hero />

      {/* Headline */}
      <div className="wrap headline">
        <div>
          <Reveal>
            <h1>
              Private to place. <em>Proven</em> to pay.
            </h1>
          </Reveal>
          <Reveal delay={90}>
            <p className="sub">
              Take a position without revealing your side. The whole book settles under a
              zero-knowledge proof — so nobody sees your bet, and nobody has to trust the house.
            </p>
          </Reveal>
          <Reveal delay={160} className="cta-row">
            <Link className="btn primary" href="/markets">
              View markets
            </Link>
            <Link className="btn" href="/solvency">
              Verify solvency
            </Link>
          </Reveal>
        </div>
      </div>

      {/* How it works */}
      <section className="section">
        <div className="wrap">
          <Reveal>
            <p className="eyebrow">How it works</p>
            <h2>Three steps, deposit to payout.</h2>
            <p className="desc">
              Two proofs do the work: one keeps your position private, the other keeps the pool
              honest.
            </p>
          </Reveal>
          <div className="grid">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 80}>
                <article className="card">
                  <span className="step-n">{s.n}</span>
                  <h3 style={{ marginTop: "auto" }}>{s.title}</h3>
                  <p className="step-body">{s.body}</p>
                </article>
              </Reveal>
            ))}
          </div>
          <Reveal delay={120} className="cta-row" >
            <Link className="btn primary" href="/markets" style={{ marginTop: "1.6rem" }}>
              Take a position
            </Link>
          </Reveal>
        </div>
      </section>

      <footer>
        <div className="wrap foot">
          <span>© 2026 Obscura Protocol · Sepolia testnet</span>
          <span>Noir · SP1 · Chainlink · Solidity</span>
        </div>
      </footer>
    </main>
  );
}
