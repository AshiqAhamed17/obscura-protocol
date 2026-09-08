// Benchmark data source: a PUBLISHED, Messari-standardized subgraph on The
// Graph's decentralized network, read via the gateway. This is the "compose two
// Graph products / standardized schema" half of Task 2.3 — we read a live
// mainnet DeFi protocol through the same freshness discipline as our own data.
//
// Requires a gateway API key (OBSCURA_API_KEY): the decentralized network,
// unlike the Studio dev endpoint, is key-gated. Free tier covers this.

import {
  BENCHMARK_LABEL,
  BENCHMARK_SUBGRAPH_ID,
  GRAPH_GATEWAY,
  MAX_STALENESS_SECONDS,
  OBSCURA_API_KEY,
} from "./config.js";

export interface BenchmarkProvenance {
  source: string;
  subgraphId: string;
  endpoint: string;
  blockNumber: number;
  blockTimestamp: number;
  ageSeconds: number;
  maxStalenessSeconds: number;
}

export interface BenchmarkSnapshot {
  provenance: BenchmarkProvenance;
  protocolName: string;
  tvlUSD: number;
  // TVL (USD) of each funded market, descending.
  marketTvlsUSD: number[];
  topMarkets: { name: string; tvlUSD: number }[];
}

// Standardized Messari lending-schema query: protocol + per-market TVL.
const QUERY = `{
  _meta { block { number timestamp } }
  lendingProtocols(first: 1) { name totalValueLockedUSD }
  markets(first: 1000, orderBy: totalValueLockedUSD, orderDirection: desc) {
    name totalValueLockedUSD
  }
}`;

export async function fetchBenchmark(opts?: {
  maxStalenessSeconds?: number;
}): Promise<BenchmarkSnapshot> {
  if (!OBSCURA_API_KEY) {
    throw new Error(
      "REFUSED: benchmark needs a gateway API key. Set OBSCURA_API_KEY (Subgraph Studio key) to read the published Messari subgraph.",
    );
  }
  const maxStale = opts?.maxStalenessSeconds ?? MAX_STALENESS_SECONDS;
  const endpoint = `${GRAPH_GATEWAY}/${OBSCURA_API_KEY}/subgraphs/id/${BENCHMARK_SUBGRAPH_ID}`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY }),
  });
  if (!res.ok) {
    throw new Error(`REFUSED: benchmark gateway returned HTTP ${res.status}.`);
  }
  const json: any = await res.json();
  if (json.errors) {
    throw new Error(`REFUSED: benchmark GraphQL error: ${JSON.stringify(json.errors)}`);
  }

  const meta = json.data?._meta;
  if (!meta) throw new Error("REFUSED: benchmark returned no _meta block.");

  const now = Math.floor(Date.now() / 1000);
  const blockTimestamp = Number(meta.block.timestamp);
  const ageSeconds = Math.max(0, now - blockTimestamp);
  if (ageSeconds > maxStale) {
    throw new Error(
      `REFUSED: benchmark data stale. Head block ${meta.block.number} is ${ageSeconds}s old (threshold ${maxStale}s).`,
    );
  }

  const proto = json.data.lendingProtocols?.[0];
  const markets: { name: string; tvlUSD: number }[] = (json.data.markets ?? [])
    .map((m: any) => ({ name: m.name as string, tvlUSD: Number(m.totalValueLockedUSD) }))
    .filter((m: { tvlUSD: number }) => m.tvlUSD > 0);

  return {
    provenance: {
      source: BENCHMARK_LABEL,
      subgraphId: BENCHMARK_SUBGRAPH_ID,
      endpoint: `${GRAPH_GATEWAY}/<api-key>/subgraphs/id/${BENCHMARK_SUBGRAPH_ID}`,
      blockNumber: Number(meta.block.number),
      blockTimestamp,
      ageSeconds,
      maxStalenessSeconds: maxStale,
    },
    protocolName: proto?.name ?? "unknown",
    tvlUSD: proto ? Number(proto.totalValueLockedUSD) : 0,
    marketTvlsUSD: markets.map((m) => m.tvlUSD),
    topMarkets: markets.slice(0, 5),
  };
}
