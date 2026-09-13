import { MarketList } from "@/components/MarketList";
import { AmbientField } from "@/components/AmbientField";
import { Explainer } from "@/components/Explainer";

export default function MarketsPage() {
  return (
    <>
      <AmbientField />
      <main className="wrap page">
      <p className="eyebrow">On Sepolia</p>
      <h1>Markets</h1>
      <p className="lead">
        Every position is shielded. Markets resolve against a Chainlink price feed and settle with
        an SP1 proof — the totals are verified on-chain, never trusted.
      </p>
        <Explainer
          title="How Obscura markets work"
          steps={[
            <><b>Bet privately</b> — pick a market and side; only a Poseidon commitment to your bet goes on-chain. No wallet? Browse freely; connect only to trade.</>,
            <><b>Resolve</b> — after the deadline, the market reads its Chainlink feed (or a Graph / CRE resolver) and records the winning outcome.</>,
            <><b>Settle</b> — an SP1 zero-knowledge proof establishes the per-outcome totals and proves the book is solvent, before any payout unlocks.</>,
            <><b>Claim</b> — winners prove they hold a winning note in zero knowledge and withdraw to any address, unlinkable to the deposit.</>,
          ]}
          links={[
            { label: "PredictionMarket", href: "https://sepolia.etherscan.io/address/0x60388bb719F3ccb5a40236076e1AF4B64ed22375" },
            { label: "Subgraph", href: "https://api.studio.thegraph.com/query/1758912/obscura-protocol/v0.0.2" },
            { label: "Source", href: "https://github.com/AshiqAhamed17/obscura-protocol" },
          ]}
        />
        <MarketList />
      </main>
    </>
  );
}
