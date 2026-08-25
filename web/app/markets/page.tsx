import { MarketList } from "@/components/MarketList";

export default function MarketsPage() {
  return (
    <main className="wrap page">
      <p className="eyebrow">On Sepolia</p>
      <h1>Markets</h1>
      <p className="lead">
        Every position is shielded. Markets resolve against a Chainlink price feed and settle with
        an SP1 proof — the totals are verified on-chain, never trusted.
      </p>
      <MarketList />
    </main>
  );
}
