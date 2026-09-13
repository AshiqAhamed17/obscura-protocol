# Obscura Protocol

**Privacy-first prediction markets, settled by proof instead of trust.**

*Prove you were right  without revealing your bet.*

---

## The idea

Prediction markets today (Polymarket, Kalshi, Augur) make every position fully
public  anyone can see what you bet, which side, and how much. That leaks
strategy and invites front-running on correlated markets.

Obscura is a prediction market where **your position is shielded end to end**,
yet the market's payouts are **provably correct and solvent**  no operator is
trusted for the numbers.

- **Shielded positions**  your side and stake are hidden behind a Poseidon
  commitment; the chain only ever sees a fingerprint.
- **Proven, not promised, solvency**  an **SP1 zkVM** proof verifies that each
  market's per-outcome totals and commitments root were computed correctly from
  the real deposits, and reconcile with the escrowed USDC, before any payout
  unlocks.
- **Confidential *and* verifiable settlement**  a **Chainlink CRE** workflow
  aggregates positions inside a TEE (operators never see plaintext), while the
  SP1 proof keeps the result trustless on-chain. Both properties, kept.
- **Real oracle resolution**  markets resolve against a live **Chainlink**
  price feed, a **Graph** metric, or a **CRE** workflow  a resolution-source
  agnostic market factory.
- **Private, unlinkable claims**  winners prove in zero knowledge that they
  hold a winning note and withdraw to any address, with no on-chain link back
  to the deposit.

Built on top of shielded positions: **Private Parlays** (stack picks into one
shielded bet), **Proof of Foresight** ("I called it"  an anonymous, verifiable
track record), and **ZK accuracy reputation**.

## Why this matters

Most "private" prediction-market attempts stop at hiding individual positions.
The harder, largely unsolved problem is proving that the *aggregate* settlement
of a market  or many markets at once  is actually correct and solvent, without
revealing any individual position. That composition is what Obscura demonstrates.

## What's live

- **Full Next.js app**  a market board (Crypto · Commodities · Forex · Sports),
  shielded deposit, private parlays, portfolio with P&L + one-click claim, an
  in-browser AI risk oracle, a public solvency audit, and Proof-of-Foresight /
  reputation. In-browser Noir proving for claims and foresight.
- **11 real markets on Sepolia**  ETH/BTC/LINK/Gold/EUR price markets plus
  categorical event markets (UEFA Champions League, F1 drivers'/constructors'
  champions, Spanish & Azerbaijan GP winners).
- **Deployed + verified on Ethereum Sepolia and Circle Arc testnet.**

### Deployed contracts (Ethereum Sepolia)

| Contract | Address |
|---|---|
| PredictionMarket | `0x60388bb719F3ccb5a40236076e1AF4B64ed22375` |
| HonkVerifier (claim) | `0x57C24427795E3b22D0E448C252E04ACb6711949D` |
| ForesightRegistry | `0x6d6B0dD2f40BCA7658237dD0F0c9527a068DaF97` |
| ParlayPool | `0x4C351042FcF905F76BAe0ef83e80de69eF8e378e` |
| ConfidentialSettlementConsumer (CRE) | `0x1E9E464F107246f21f32330311b061A8e340d1b4` |
| CreResolutionConsumer | `0x4ae8FF6f6D1957fCb72cb2002223c04Fd64235F3` |
| AutoResolver (CRE cron keeper) | `0x90095B45E10f650d2b766a86E600d3D672a22606` |
| USDC (Circle, Sepolia) | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |

Subgraph (Studio v0.0.2): `api.studio.thegraph.com/query/1758912/obscura-protocol/v0.0.2`
· Arc testnet PredictionMarket: `0xB0bAF72EC2a249376B468B5E6Bbc88CF87099b50`

## How it works (a bet, end to end)

1. **Deposit**  your browser builds a secret note and posts only its Poseidon
   commitment; your USDC is escrowed. Side and stake stay hidden.
2. **Resolve**  after the deadline, `resolveMarket` reads the Chainlink feed
   (or a Graph/CRE resolver reports it) and records the winning outcome.
3. **Settle**  an SP1 proof establishes the per-outcome totals + commitments
   root and proves they reconcile with the escrowed USDC; the market flips to
   *Settled*. (Confidentially aggregated in a Chainlink CRE TEE; verifiably
   correct via SP1.)
4. **Claim**  you generate a Noir proof in-browser that you hold an unspent,
   winning note, burn a one-time nullifier, and the pari-mutuel payout is sent
   to a recipient bound into the proof  unlinkable to your deposit.

Payouts are pari-mutuel: `payout = your stake × pool ÷ winning-side total`.

## Architecture  three sponsor integrations

### Chainlink CRE  confidential + verifiable settlement

Node operators sum private positions **inside a TEE** and return only
aggregates, while an **SP1 proof** makes the settlement trustlessly correct
on-chain. Confidentiality *and* verifiability  both kept. Markets resolve
against live Chainlink price feeds, and a **CRE cron workflow** resolves them
hands-free the moment they pass their deadline via the on-chain `AutoResolver`
keeper (`resolveDue()`)  the successor to classic Chainlink Automation, which
sunset in 2026.

![Chainlink confidential + verifiable settlement](docs/diagrams/chainlink.svg)

> **Where:** `cre-settlement/settlement/workflow.ts` (TEE handler) ·
> `contracts/src/ConfidentialSettlementConsumer.sol` (reconciles vs SP1 totals) ·
> `contracts/src/PredictionMarket.sol` `settleWithProof` · `guest/` + `host/` (SP1) ·
> `cre-settlement/automation/` (CRE cron auto-resolve) + `contracts/src/AutoResolver.sol` (on-chain keeper).

### The Graph  subgraph + AI solvency/risk oracle

A subgraph indexes only public/aggregate data (never plaintext positions); an
AI risk oracle reasons over it with a **pinned deployment id + freshness gate**,
computing solvency coverage + HHI concentration, and benchmarks Obscura against
a **Messari-standardized** mainnet subgraph. The `/risk` page runs this live in
the browser.

![The Graph subgraph + AI risk oracle](docs/diagrams/thegraph.svg)

> **Where:** `subgraph/` (schema + mappings, Studio v0.0.2) ·
> `agent/src/` (`obscura-risk-oracle` MCP server) · `web/lib/risk.ts` (in-browser port).

### Circle / Arc  USDC-native escrow + CCTP cross-chain entry

The escrow is USDC-denominated (ERC-20 + EIP-2612 permit); on Arc, USDC is the
native gas token. Users can bridge USDC **Base → Arc via CCTP** and open a
shielded position in one journey.

![Circle/Arc USDC escrow + CCTP entry](docs/diagrams/arc.svg)

> **Where:** `contracts/src/PredictionMarket.sol` (USDC escrow) ·
> `cctp-entry/src/bridge-and-open.ts` (CCTP bridge → deposit) ·
> live on Arc testnet (`contracts/deployments/arc-testnet.json`).

| Layer | Tech |
|---|---|
| Settlement / escrow | Solidity, Foundry (USDC-denominated) |
| Privacy layer | Noir zk circuits  shielded deposits, claims, foresight, parlays, reputation |
| Solvency proof | SP1 zkVM |
| Confidential settlement | Chainlink CRE (TEE) |
| Indexing / risk agent | The Graph subgraph + MCP AI oracle |
| Stablecoin / cross-chain | Circle USDC, Arc, CCTP |
| Client | Next.js 16, Wagmi, Viem, in-browser Noir + lightweight-charts (Sepolia + Arc) |

## Run it locally

```bash
# Frontend (Sepolia)  needs a browser wallet
cd web && npm install && npm run dev        # localhost:3000

# Contracts + circuits + proofs
cd contracts && forge test                   # Solidity tests
cargo test -p aggregation                     # Rust settlement reference
cd circuits && nargo test                     # Noir circuit tests
```

## Trust model & proving

`docs/trust-model.md` details what each proof guarantees. The SP1 settlement
proof (EVM/Groth16) is memory-heavy, so it is generated on prover infrastructure
(the Succinct Prover Network or a ≥32 GB machine) and verified on-chain by the
SP1 gateway  the standard production path. See `host/PROVE_ON_VM.md` for a
reproducible run. The claim + foresight proofs run in the browser (Noir) against
the deployed on-chain verifiers.

## License

MIT
