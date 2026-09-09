# Obscura — CRE Graph-Query Resolution

A **Chainlink CRE** workflow that resolves an Obscura market from a **live
subgraph metric**, completing the resolution-source trio:

| Source | How it resolves |
| --- | --- |
| `ChainlinkFeed` | on-chain price read (`PredictionMarket.resolveMarket`) |
| **`GraphQuery`** | **this workflow** — reads the subgraph, DON-signs the outcome |
| `CreWorkflow` | off-chain event via a CRE workflow (same on-chain landing pad) |

This is a cross-sponsor showcase: **The Graph** data → **Chainlink CRE** → an
on-chain market resolution.

## Flow (`workflow.ts`)

1. **Cron trigger** fires the (non-confidential) handler on the DON.
2. **`httpClient.sendRequest`** POSTs a GraphQL query to the Obscura subgraph
   under **DON consensus** (median-aggregated, robust to a node seeing the
   subgraph one block ahead), reading a public metric — here
   `protocolSolvencies.marketCount`.
3. **`deriveOutcome`** — Yes (1) if `metric ≥ threshold`, else No (0).
4. **`evmClient.writeReport`** delivers the DON-signed `(uint64 marketId,
   uint8 winningOutcome)` to the **`CreResolutionConsumer`** on Sepolia
   (`0x4ae8FF6f6D1957fCb72cb2002223c04Fd64235F3`), which calls
   `PredictionMarket.reportResolution` — landing a Graph-sourced, DON-signed
   outcome on-chain.

The on-chain market (id 3) is created with `SourceType.GraphQuery` and its
`resolver` set to that consumer, with the pinned subgraph deployment id as
`sourceRef`.

> **Trust model — state it honestly:** Graph-resolved markets are
> *trust-minimised* (they trust the DON + the pinned subgraph deployment), not
> trustless. The `sourceRef` pins provenance.

## Run it

```bash
bun install && bunx cre-setup
bun run typecheck && bun test        # 7 tests (no login)

# End-to-end simulation against the LIVE subgraph (needs `cre login`):
cre workflow simulate ./resolution --target staging-settings
# -> [USER LOG] Graph metric=4, threshold=3 -> outcome=1
#    "market 3: metric=4 -> outcome=1, tx=0x"
```

As with the settlement workflow, the on-chain write returns `TxStatus.SUCCESS`
in simulation (the simulator does not broadcast). The contract-level flow — a
DON report resolving a GraphQuery market — is proven by
`contracts/test/CreResolutionConsumer.t.sol` (6 tests).
