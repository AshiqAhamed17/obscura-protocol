#!/usr/bin/env -S npx tsx
// Obscura Risk Oracle — MCP server.
//
// Reusable MCP tooling that turns the Obscura subgraph into freshness-gated,
// provenance-pinned risk assessments any AI agent can reason over. Every tool
// refuses stale or wrong-deployment data rather than returning it.
//
// Add to an MCP client (stdio), e.g. Claude Code:
//   claude mcp add obscura-risk-oracle -- npx tsx /abs/path/agent/src/server.ts

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BENCHMARK_LABEL, PINNED_DEPLOYMENT_ID, SUBGRAPH_QUERY_URL } from "./config.js";
import {
  benchmarkReport,
  concentrationReport,
  protocolRisk,
  solvencySnapshot,
} from "./report.js";

const server = new McpServer({
  name: "obscura-risk-oracle",
  version: "0.1.0",
});

const stalenessArg = {
  maxStalenessSeconds: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Override the staleness threshold (seconds). Older data is refused."),
};

function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function fail(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

server.tool(
  "get_solvency_snapshot",
  `Freshness-gated solvency snapshot of the Obscura protocol from the pinned ` +
    `subgraph deployment (${PINNED_DEPLOYMENT_ID}). Returns escrow on hand, ` +
    `settled obligations, coverage ratio, and a SOLVENT/WATCH/INSOLVENT verdict, ` +
    `plus full provenance. Throws (refuses) on stale, wrong-deployment, or ` +
    `error-state data.`,
  stalenessArg,
  async (args) => {
    try {
      return ok(await solvencySnapshot(args));
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "get_market_concentration",
  `Freshness-gated liquidity-concentration report. Returns the Herfindahl ` +
    `index (HHI) over per-market deposit share, the dominant market, and a ` +
    `DIVERSE/MODERATE/CONCENTRATED/HIGHLY_CONCENTRATED verdict, with provenance.`,
  { ...stalenessArg, topN: z.number().int().positive().optional() },
  async (args) => {
    try {
      return ok(await concentrationReport(args));
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "assess_protocol_risk",
  `Combined, freshness-gated risk assessment: solvency + concentration rolled ` +
    `into an overall LOW/ELEVATED/HIGH/CRITICAL risk level with rationale. This ` +
    `is the primary tool for an agent making a go/no-go risk decision over live ` +
    `Obscura data. Refuses stale or wrong-deployment data.`,
  stalenessArg,
  async (args) => {
    try {
      return ok(await protocolRisk(args));
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "benchmark_vs_defi",
  `Composable benchmark: reads Obscura (Subgraph Studio) AND a published, ` +
    `Messari-standardized subgraph on The Graph's decentralized network ` +
    `(${BENCHMARK_LABEL}) in one flow, then compares Obscura's liquidity ` +
    `concentration (HHI) against live mainnet DeFi using the same methodology. ` +
    `Both sources are freshness-gated. Requires a gateway API key for the ` +
    `benchmark read.`,
  stalenessArg,
  async (args) => {
    try {
      return ok(await benchmarkReport(args));
    } catch (e) {
      return fail(e);
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr so stdout stays a clean MCP channel.
  console.error(
    `obscura-risk-oracle MCP server up. Pinned ${PINNED_DEPLOYMENT_ID} @ ${SUBGRAPH_QUERY_URL}`,
  );
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
