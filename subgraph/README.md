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

- **Contract:** `PredictionMarket` @ `0x60388bb719F3ccb5a40236076e1AF4B64ed22375` (Sepolia)
- **Start block:** `11664680` (contract creation)
- **Studio dashboard:** https://thegraph.com/studio/subgraph/obscura-protocol
- **Query endpoint (v0.0.2):** `https://api.studio.thegraph.com/query/1758912/obscura-protocol/v0.0.2`
- **Deployment ID:** `QmRVbZNT9mDmJxez7VnhARRgF52nfdTy8KjoiJQmGmYcf3`

> **v0.0.2 (Phase 4 re-point):** indexes the N-outcome/categorical, USDC-denominated
> redeploy. `MarketSettled` now carries the per-outcome `uint256[] outcomeTotals`
> array (binary = `[No, Yes]`); the schema already exposed `outcomeTotals: [BigInt!]`,
> so this was a manifest + handler re-point, not a schema rewrite. The prior v0.0.1
> indexed the binary baseline at `0x3B50a4e8…`.

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
