import Link from "next/link";
import { MarketList } from "@/components/MarketList";

export default function Home() {
  return (
    <main>
      <section className="hero">
        <div className="wrap">
          <div className="eyebrow">Privacy-preserving prediction markets</div>
          <h1>
            Private to place. <em>Proven</em> to pay.
          </h1>
          <p className="sub">
            Take a position without revealing your side. The whole book is settled by a
            zero-knowledge proof — so nobody sees your bet, and nobody has to trust the house.
          </p>
          <div className="cta-row">
            <Link className="btn primary" href="/deposit">
              Take a position
            </Link>
            <a
              className="btn"
              href="https://github.com/AshiqAhamed17/obscura-protocol"
              target="_blank"
              rel="noreferrer"
            >
              How it works ↗
            </a>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2>Markets</h2>
          <p className="desc">
            Live on Sepolia. Deposits are shielded; markets resolve against a Chainlink price
            feed and settle with an SP1 proof.
          </p>
          <MarketList />
        </div>
      </section>

      <footer>
        <div className="wrap foot">
          <span>© 2026 Obscura Protocol · Sepolia testnet</span>
          <span>Noir · SP1 · Chainlink</span>
        </div>
      </footer>
    </main>
  );
}
