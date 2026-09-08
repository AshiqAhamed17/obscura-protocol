# Obscura Protocol — Subgraph

A subgraph over the Obscura `PredictionMarket` on **Ethereum Sepolia**, indexing
public and aggregate data plus the shielded primitives (Poseidon commitments and
nullifiers) that are meant to be public.

## Privacy invariant

This subgraph **never indexes a plaintext position.** Which side/outcome a
depositor took is committed inside a Poseidon hash and is not recoverable here.
`Deposit.amount` is the public escrow value (needed for solvency accounting), not
a position. Only commitments, nullifiers, and aggregate pool totals are stored.

## Deployment

- **Contract:** `PredictionMarket` @ `0x3B50a4e83cD1f1AEF171749371A6c25CA07358bD` (Sepolia)
- **Start block:** `11652891` (contract creation)
- **Studio dashboard:** https://thegraph.com/studio/subgraph/obscura-protocol
- **Query endpoint (v0.0.1):** `https://api.studio.thegraph.com/query/1758912/obscura-protocol/v0.0.1`
- **Deployment ID:** `QmbdewxRjmhSiQHnkYh72Dt3dgrckfe1tiZrREVHymzcny`

> The live contract is the **binary baseline** (deployed before the categorical /
> N-outcome refactor), so `MarketSettled` carries `totalYes` / `totalNo`. The
> schema exposes a forward-compatible `outcomeTotals: [BigInt!]` so the Phase-4
> N-outcome redeploy is a manifest re-point, not a schema rewrite.

## Entities

| Entity | Purpose |
| --- | --- |
| `Market` | Per-market state: creation params, lifecycle status, resolution, settlement, and running deposit/claim aggregates. |
| `Deposit` | Append-only shielded deposit (commitment, leaf index, public escrow amount). Immutable. |
| `Settlement` | Aggregate settlement of a market's pool (merkle root + per-outcome totals). |
| `Claim` | Append-only private claim, keyed by nullifier. Immutable. |
| `ProtocolSolvency` | Singleton (`id = "protocol"`): protocol-wide totals and `outstandingEscrow = totalDeposited - totalClaimed`. Powers the AI solvency/risk agent (Task 2.2). |

## Events indexed

- `MarketCreated(uint256,address,int256,uint256)`
- `Deposit(uint256,bytes32,uint256,uint256)`
- `MarketResolved(uint256,uint8,int256)`
- `MarketSettled(uint256,bytes32,uint256,uint256)`
- `Claimed(uint256,bytes32,address,uint256)`

## Develop

```bash
npm install
npm run codegen        # generate types from schema + ABI
npm run build          # compile mappings to WASM
graph auth <DEPLOY_KEY>
npm run deploy         # graph deploy obscura-protocol
```

## Example query

```graphql
{
  protocolSolvencies { marketCount resolvedMarketCount totalDeposited outstandingEscrow }
  markets(orderBy: marketId) { marketId status winningSide totalDeposited depositCount }
}
```
