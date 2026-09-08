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
// from Subgraph Studio"). Secret — supplied via env only, never committed.
export const OBSCURA_API_KEY = process.env.OBSCURA_API_KEY ?? "";
