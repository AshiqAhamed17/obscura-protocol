# Obscura Risk Oracle — reusable MCP tooling

An **AI Solvency & Risk Oracle** for Obscura Protocol, packaged as a
[Model Context Protocol](https://modelcontextprotocol.io) server. It turns the
Obscura subgraph into **freshness-gated, provenance-pinned** risk assessments
that any MCP-capable AI agent (Claude Code, Claude Desktop, Cursor, …) can reason
over — and it **refuses stale or wrong-deployment data** instead of returning it.

See [`SAMPLE_RUN.md`](./SAMPLE_RUN.md) for a real agent run over live Sepolia data.

## Why this shape

- **Provenance-pinned.** Every read is anchored to a specific subgraph
  deployment id (`QmbdewxRjmhSiQHnkYh72Dt3dgrckfe1tiZrREVHymzcny`). If the
  endpoint serves a different deployment, the oracle refuses.
- **Freshness-gated.** If the indexed head is older than the staleness budget
  (default 900s) or the subgraph reports indexing errors, the oracle refuses.
- **Reasoning, not raw output.** Tools return verdicts + rationale
  (SOLVENT/WATCH/INSOLVENT, an HHI concentration verdict, an overall
  LOW/ELEVATED/HIGH/CRITICAL level) — the analysis an agent needs to make a
  decision, with full provenance attached.
- **Privacy-preserving.** It only ever reads public aggregates the subgraph
  exposes; no plaintext positions exist to leak.

## Tools

| Tool | Returns |
| --- | --- |
| `get_solvency_snapshot` | Escrow on hand, settled obligations, coverage ratio, SOLVENT/WATCH/INSOLVENT verdict + provenance. |
| `get_market_concentration` | HHI over per-market deposit share, dominant market, DIVERSE→HIGHLY_CONCENTRATED verdict + provenance. |
| `assess_protocol_risk` | Combined solvency + concentration → overall LOW/ELEVATED/HIGH/CRITICAL with rationale. Primary go/no-go tool. |

Each tool accepts an optional `maxStalenessSeconds` to override the freshness budget.

## Solvency model

Obscura pools are pari-mutuel, so per-note solvency is enforced by the SP1 proof
at settlement. This oracle is a **public monitoring layer** over the subgraph
aggregates:

```
backedFunds        = totalDeposited - totalClaimed                 (escrow on hand)
settledObligations = Σ over settled markets of max(0, pool - claimed)   (pool = totalYes + totalNo)
coverageRatio      = backedFunds / settledObligations              (∞ when nothing is owed yet)
```

Concentration is the Herfindahl-Hirschman Index over each market's share of total
deposits (`HHI ∈ (0,1]`, `1` = all liquidity in one market).

## Run it

```bash
npm install
npm test          # 10 unit tests over the pure risk math
npm run assess    # print a live assessment (CLI, same code path as the MCP tools)
npm run typecheck
```

### Add to Claude Code (or any MCP client)

```bash
claude mcp add obscura-risk-oracle -- \
  "$(pwd)/node_modules/.bin/tsx" "$(pwd)/src/server.ts"
```

Then an agent can call `assess_protocol_risk` and reason over the result.

### Configuration (env)

| Var | Default | Meaning |
| --- | --- | --- |
| `OBSCURA_API_KEY` | _(unset)_ | Subgraph Studio API key. When set, the oracle queries Studio **authenticated** ("querying Subgraphs with an API key from Subgraph Studio"). Free tier; keep it out of git. |
| `OBSCURA_DEPLOYMENT_ID` | `Qmbdew…zcny` | Pinned deployment id the oracle will accept. |
| `OBSCURA_SUBGRAPH_URL` | Studio v0.0.1 endpoint | Where to read from. |
| `OBSCURA_MAX_STALENESS` | `900` | Staleness budget in seconds. |

Copy `.env.example` → `.env` (gitignored) and set `OBSCURA_API_KEY`, then e.g.
`node --env-file=.env node_modules/.bin/tsx src/cli.ts`, or pass it to the MCP
client: `claude mcp add obscura-risk-oracle -e OBSCURA_API_KEY=<key> -- …`.
`provenance.authenticated` in every response reflects whether a key was used.

> **Phase-4 note:** when the N-outcome contract is redeployed and the subgraph
> re-published (v0.0.2), update `OBSCURA_DEPLOYMENT_ID` + `OBSCURA_SUBGRAPH_URL`
> (or `src/config.ts`) to re-pin. The risk math is unit-agnostic and unchanged.
```
