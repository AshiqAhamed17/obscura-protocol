import Link from "next/link";
import { MarketList } from "@/components/MarketList";
import { Reveal } from "@/components/Reveal";

export default function Home() {
  return (
    <main>
      {/* Hero — the dark pool */}
      <div className="stage">
        <section className="hero">
          <div className="hero-surface" aria-hidden />
          <div className="hero-body">
            <p className="hero-eyebrow">Privacy-preserving prediction markets</p>
            <h1 className="wordmark">OBSCURA</h1>
          </div>
          <div className="hero-foot">
            <span>
              Built with <b>Noir</b> · <b>SP1</b> · <b>Chainlink</b>
            </span>
            <span className="live">
              <span className="beat" aria-hidden />
              Live on Sepolia
            </span>
          </div>
        </section>
      </div>

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
            <Link className="btn primary" href="/deposit">
              Take a position
            </Link>
            <Link className="btn" href="/solvency">
              Verify solvency
            </Link>
          </Reveal>
        </div>
      </div>

      {/* Markets */}
      <section className="section">
        <div className="wrap">
          <Reveal>
            <p className="eyebrow">On Sepolia</p>
            <h2>Markets</h2>
            <p className="desc">
              Deposits are shielded. Markets resolve against a Chainlink price feed and settle with
              an SP1 proof — the totals are verified, never trusted.
            </p>
          </Reveal>
          <MarketList />
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
