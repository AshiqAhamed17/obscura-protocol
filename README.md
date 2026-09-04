# Obscura Protocol

**Privacy-first prediction markets, settled by proof instead of trust.**

## The idea

Prediction markets today (Polymarket, Kalshi, Augur) make every position
fully public — anyone can see what you bet, which side, and how much. That
leaks strategy and invites front-running on correlated markets.

Obscura Protocol explores what a privacy-first prediction market could look
like:

- **Shielded positions** — a trader's side and stake are hidden behind a
  cryptographic commitment instead of posted in the clear on-chain.
- **Proven, not promised, solvency** — instead of trusting an operator to
  report correct payout totals, a zero-knowledge proof (via the **SP1
  zkVM**) verifies that settlement was computed correctly before any payouts
  unlock.
- **Real oracle resolution** — markets resolve against a live price feed
  (**Chainlink**), not a manual or disputed outcome.
- **Private, unlinkable claims** — winners prove they hold a valid winning
  position and claim their payout without revealing which deposit it came
  from.

## Why this matters

Most "private" prediction-market attempts stop at hiding individual
positions. The harder, largely unsolved problem is proving that the
*aggregate* settlement of a market — or many markets at once — is actually
correct and solvent, without revealing any individual position. That gap is
what this project explores.

## Planned architecture

```
Trader ──(shielded deposit / commitment)──▶ Market / Escrow contract
                                                  │
                                     market resolves (oracle price feed)
                                                  │
                          zero-knowledge proof: settlement is correct & solvent
                                                  │
                              winners claim privately and unlinkably
```

| Layer | Tech |
|---|---|
| Settlement / escrow | Solidity, Foundry |
| Privacy layer | Zero-knowledge circuits (shielded deposits + claims) |
| Solvency proof | SP1 zkVM |
| Oracle / resolution | Chainlink Price Feeds |
| Client | Next.js, Wagmi, Viem |

## Status

Early build — architecture and scaffolding in progress. More as it lands.

## License

MIT
