// Pinned provenance for the Obscura Risk Oracle.
//
// The oracle refuses to reason over any subgraph deployment other than this one:
// every response is anchored to a specific, immutable deployment id. When the
// Phase-4 N-outcome redeploy lands, bump PINNED_DEPLOYMENT_ID (and the query URL)
// in one place — nothing else changes.

export const PINNED_DEPLOYMENT_ID =
  process.env.OBSCURA_DEPLOYMENT_ID ??
  "QmbdewxRjmhSiQHnkYh72Dt3dgrckfe1tiZrREVHymzcny";

export const SUBGRAPH_QUERY_URL =
  process.env.OBSCURA_SUBGRAPH_URL ??
  "https://api.studio.thegraph.com/query/1758912/obscura-protocol/v0.0.1";

// A snapshot older than this (in seconds) is treated as stale and refused.
export const MAX_STALENESS_SECONDS = Number(
  process.env.OBSCURA_MAX_STALENESS ?? 900,
);

// Subgraph Studio API key (created in Studio → API Keys). When set, the oracle
// queries the Studio endpoint authenticated ("querying Subgraphs with an API key
// from Subgraph Studio"). The same key authenticates decentralized-network
// gateway queries (used for the Messari benchmark). Secret — env only, never committed.
export const OBSCURA_API_KEY = process.env.OBSCURA_API_KEY ?? "";

// --- Task 2.3: composable/standardized benchmark ---
// A PUBLISHED, Messari-standardized subgraph on the decentralized network, read
// via the gateway to benchmark Obscura's risk against live mainnet DeFi. Default
// is Aave v2 (Ethereum) — a canonical Messari standardized lending subgraph.
export const GRAPH_GATEWAY = process.env.GRAPH_GATEWAY_URL ?? "https://gateway.thegraph.com/api";
export const BENCHMARK_SUBGRAPH_ID =
  process.env.OBSCURA_BENCHMARK_SUBGRAPH_ID ??
  "C2zniPn45RnLDGzVeGZCx2Sw3GXrbc9gL4ZfL8B8Em2j";
export const BENCHMARK_LABEL =
  process.env.OBSCURA_BENCHMARK_LABEL ?? "Aave v2 (Ethereum, Messari standardized)";
