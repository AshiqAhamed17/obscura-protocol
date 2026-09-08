# Obscura Risk Oracle — Agent Run (evidence)

A real run of an AI agent (Claude, via Claude Code) reasoning about Obscura's
protocol risk **over live Sepolia data**, using the `obscura-risk-oracle` MCP
server as its tooling. Every datum is anchored to a pinned subgraph deployment
and freshness-gated; the agent refuses to reason over data it cannot vouch for.

- **Subgraph (pinned deployment):** `QmbdewxRjmhSiQHnkYh72Dt3dgrckfe1tiZrREVHymzcny`
- **Endpoint:** `https://api.studio.thegraph.com/query/1758912/obscura-protocol/v0.0.1`
- **Tooling:** `obscura-risk-oracle` MCP server (this repo, `agent/`)

> Note: our subgraph is deployed to Subgraph Studio but not yet published to the
> decentralized network, so The Graph's *official* Subgraph MCP returns
> `subgraph not found` for it. The `obscura-risk-oracle` MCP is the reusable
> tooling that reads the Studio deployment directly, with the same
> deployment-pinning + freshness discipline. (The official Subgraph MCP is used
> in Task 2.3 against a *published* mainnet Messari subgraph.)

---

## 1. Tool discovery (MCP `tools/list`)

```
get_solvency_snapshot, get_market_concentration, assess_protocol_risk
```

## 2. Agent calls `assess_protocol_risk` (raw MCP `tools/call` response)

The oracle queried Subgraph Studio **authenticated with a Studio API key**
(`provenance.authenticated: true`).

```json
{
  "provenance": {
    "deploymentId": "QmbdewxRjmhSiQHnkYh72Dt3dgrckfe1tiZrREVHymzcny",
    "endpoint": "https://api.studio.thegraph.com/query/1758912/obscura-protocol/v0.0.1",
    "authenticated": true,
    "blockNumber": 11660458,
    "blockTimestamp": 1788862680,
    "ageSeconds": 15,
    "maxStalenessSeconds": 900,
    "hasIndexingErrors": false,
    "checkedAt": 1788862695
  },
  "totals": {
    "marketCount": "8",
    "resolvedMarketCount": "3",
    "settledMarketCount": "0",
    "totalDeposited": "1000000000000000",
    "totalClaimed": "0",
    "outstandingEscrow": "1000000000000000"
  },
  "assessment": {
    "overallRisk": "ELEVATED",
    "rationale": "Overall ELEVATED. Solvency: SOLVENT — No settled obligations outstanding; all 1000000000000000 base units of escrow are unencumbered. Concentration: HIGHLY_CONCENTRATED — HHI 1 across 1 funded market(s); largest is market 0 at 100.0% of deposits.",
    "solvency": {
      "backedFunds": "1000000000000000",
      "settledObligations": "0",
      "coverageRatio": null,
      "verdict": "SOLVENT",
      "rationale": "No settled obligations outstanding; all 1000000000000000 base units of escrow are unencumbered."
    },
    "concentration": {
      "hhi": 1,
      "activeMarketCount": 1,
      "topMarketId": "0",
      "topShare": 1,
      "verdict": "HIGHLY_CONCENTRATED",
      "rationale": "HHI 1 across 1 funded market(s); largest is market 0 at 100.0% of deposits."
    }
  }
}
```

## 3. Agent reasoning

> **Provenance & freshness first.** The response is anchored to the pinned
> deployment `Qmbdew…zcny` (matches — not a substituted subgraph), was fetched
> from Subgraph Studio **authenticated with an API key**, reports no indexing
> errors, and the head block is **15s old**, well inside the 900s staleness
> budget. The snapshot is trustworthy; I may reason over it.
>
> **Solvency.** 8 markets exist; **0 are settled**, so there are no outstanding
> obligations to winners yet. Escrow on hand is `0.001 ETH` (1e15 wei) against
> `0` claimed → `outstandingEscrow == totalDeposited`, fully unencumbered.
> Verdict **SOLVENT** — coverage is trivially satisfied (no obligations). There
> is no liquidation or shortfall pressure at this time.
>
> **Concentration.** This is where the real risk sits. Of 8 markets, **only one
> (market 0) holds any deposits** — 100% of protocol liquidity. HHI = **1.0**,
> the maximum. The protocol's economic activity is entirely dependent on a
> single market/resolution source; any anomaly there (a mispriced feed, a
> disputed resolution) affects 100% of at-risk funds. Verdict
> **HIGHLY_CONCENTRATED**.
>
> **Decision — overall risk: ELEVATED.** Solvency is currently safe, but the
> single-market concentration is a live structural risk, not a theoretical one.
> Recommendation: treat market 0 as systemically important — apply extra
> resolution scrutiny there, and drive liquidity toward the other 7 seeded
> markets to bring HHI down before settlement volume grows. Re-assess after any
> `MarketSettled`, since obligations (and true coverage math) begin then.

## 4. Freshness / provenance gate — demonstrated refusals

The oracle **refuses** rather than returning untrustworthy data. Both paths were
exercised live:

```
# staleness budget tightened to 1s (head was ~8s old):
REFUSED: data stale. Head block 11660359 is 8s old (threshold 1s).

# pinned to a different deployment id than the endpoint serves:
REFUSED: deployment mismatch. Pinned QmWrong…, endpoint served QmbdewxRjmhSiQHnkYh72Dt3dgrckfe1tiZrREVHymzcny.
```

A refusal is surfaced as an MCP tool error — the agent never silently reasons
over stale or wrong-deployment data.

---

### Reproduce

```bash
cd agent && npm install
npm run assess            # combined assessment over live data (CLI, same code path)
npm test                  # 10 unit tests over the risk math
# stale refusal:      OBSCURA_MAX_STALENESS=1 npm run assess
# provenance refusal: OBSCURA_DEPLOYMENT_ID=QmWrong npm run assess
```
