import { parseAbi } from "viem";
import { sepolia, arcTestnet } from "wagmi/chains";

/// Per-chain deployment. Obscura runs on two chains: Ethereum Sepolia (the
/// canonical, Chainlink-feed + SP1-settled deployment) and Circle's Arc testnet
/// (USDC-native, no Chainlink feeds — markets resolve via CRE/resolver).
export interface ChainDeployment {
  label: string;
  predictionMarket: `0x${string}`;
  usdc: `0x${string}`;
  explorer: string;
  hasFeeds: boolean;
  parlayPool?: `0x${string}`;
  foresightRegistry?: `0x${string}`;
}

export const CHAINS: Record<number, ChainDeployment> = {
  [sepolia.id]: {
    label: "Sepolia",
    predictionMarket: "0x60388bb719F3ccb5a40236076e1AF4B64ed22375",
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    explorer: "https://sepolia.etherscan.io",
    hasFeeds: true,
    parlayPool: "0x4C351042FcF905F76BAe0ef83e80de69eF8e378e",
    foresightRegistry: "0x6d6B0dD2f40BCA7658237dD0F0c9527a068DaF97",
  },
  [arcTestnet.id]: {
    label: "Arc",
    predictionMarket: "0xB0bAF72EC2a249376B468B5E6Bbc88CF87099b50",
    usdc: "0x3600000000000000000000000000000000000000",
    explorer: "https://testnet.arcscan.app",
    hasFeeds: false,
  },
};

/// ParlayPool — dedicated shielded multi-leg pool.
export const parlayPoolAbi = parseAbi([
  "function deposit(bytes32 commitment, uint256 amount) returns (uint256 leafIndex)",
  "function nullifierSpent(bytes32) view returns (bool)",
  "function parlayRoot() view returns (bytes32)",
  "function totalStaked() view returns (uint256)",
  "function depositCount() view returns (uint256)",
  "function getCommitments() view returns (bytes32[])",
  "function claim(uint256[3] marketIds, uint256 amount, bytes32 nullifier, address recipient, bytes proof)",
]);

/// ForesightRegistry — anonymous "I called it" credentials over settled markets.
export const foresightRegistryAbi = parseAbi([
  "function proveForesight(uint256 marketId, bytes32 foresightNullifier, bytes proof)",
  "function foresightProven(bytes32) view returns (bool)",
  "function foresightCount(uint256) view returns (uint256)",
]);

export const SUPPORTED_CHAINS = [sepolia, arcTestnet];

/// Active deployment for the connected chain (defaults to Sepolia).
export function contractsFor(chainId: number | undefined): ChainDeployment {
  return (chainId !== undefined && CHAINS[chainId]) || CHAINS[sepolia.id];
}

/// Sepolia defaults (used by the nav ETH ticker, which reads the Sepolia feed).
export const PREDICTION_MARKET = CHAINS[sepolia.id].predictionMarket;
export const USDC = CHAINS[sepolia.id].usdc;
export const USDC_DECIMALS = 6;

export const CONFIDENTIAL_CONSUMER = "0x1E9E464F107246f21f32330311b061A8e340d1b4" as const;
export const RESOLUTION_CONSUMER = "0x4ae8FF6f6D1957fCb72cb2002223c04Fd64235F3" as const;
export const FORESIGHT_REGISTRY = "0x6d6B0dD2f40BCA7658237dD0F0c9527a068DaF97" as const;
export const CHAIN = sepolia;

/// The Obscura subgraph (Studio v0.0.2) — powers aggregate market data.
export const SUBGRAPH_URL =
  "https://api.studio.thegraph.com/query/1758912/obscura-protocol/v0.0.2";

/// Canonical Chainlink ETH/USD feed on Sepolia — powers the nav price ticker.
export const ETH_USD_FEED = "0x694AA1769357215DE4FAC081bf1f309aDC325306" as const;

/// Verified Sepolia price feeds → human labels, for the marketplace detail.
export const FEEDS: Record<string, { asset: string; unit: string }> = {
  "0x694aa1769357215de4fac081bf1f309adc325306": { asset: "ETH", unit: "USD" },
  "0x1b44f3514812d835eb1bdb0acb33d3fa3351ee43": { asset: "BTC", unit: "USD" },
  "0xc59e3633baac79493d908e63626716e204a45edf": { asset: "LINK", unit: "USD" },
  "0xc5981f461d74c46eb4b0cf3f4ec79f025573b0ea": { asset: "XAU", unit: "USD" },
  "0x1a81afb8146aeffcfc5e50e8479e826e7d55b910": { asset: "EUR", unit: "USD" },
};

export function feedLabel(feed: string): { asset: string; unit: string } {
  return FEEDS[feed.toLowerCase()] ?? { asset: "Feed", unit: "USD" };
}

/// BN254 scalar field modulus — note commitments must be below this.
export const FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/// Outcome index convention: 0 = No, 1 = Yes (binary); 0..N for categorical.
export enum Side {
  No = 0,
  Yes = 1,
}

/// 0 = Open, 1 = Resolved, 2 = Settled — matches the Solidity `Status` enum.
export enum Status {
  Open = 0,
  Resolved = 1,
  Settled = 2,
}

/// Resolution source — matches the Solidity `ResolutionSource` enum.
export enum ResolutionSource {
  ChainlinkFeed = 0,
  GraphQuery = 1,
  CreWorkflow = 2,
}

export const resolutionLabel = ["Chainlink feed", "Graph query", "CRE workflow"] as const;

/// Minimal Chainlink AggregatorV3 read interface (for the live price chart).
export const aggregatorAbi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function getRoundData(uint80 roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
]);

/// ERC-20 surface for USDC (approve / allowance / balance).
export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
]);

export const abi = parseAbi([
  "function marketCount() view returns (uint256)",
  "function markets(uint256) view returns (address priceFeed, int256 threshold, uint256 resolveAfter, uint256 maxPriceStaleness, uint8 status, uint8 winningOutcome, uint8 numOutcomes, uint256 totalPool, uint256 depositCount, bytes32 merkleRoot)",
  "function resolutionConfig(uint256) view returns (uint8 source, address resolver, bytes32 sourceRef)",
  "function getOutcomeTotals(uint256 marketId) view returns (uint256[])",
  "function getCommitments(uint256 marketId) view returns (bytes32[])",
  "function nullifierSpent(bytes32) view returns (bool)",
  "function collateral() view returns (address)",
  "function deposit(uint256 marketId, bytes32 commitment, uint256 amount) returns (uint256 leafIndex)",
  "function resolveMarket(uint256 marketId)",
  "function claim(uint256 marketId, uint256 amount, bytes32 nullifier, address recipient, bytes proof)",
  "function createMarket(address priceFeed, int256 threshold, uint256 resolveAfter, uint256 maxPriceStaleness) returns (uint256)",
]);

/// Raw tuple returned by `markets(id)`.
export type MarketTuple = readonly [
  priceFeed: `0x${string}`,
  threshold: bigint,
  resolveAfter: bigint,
  maxPriceStaleness: bigint,
  status: number,
  winningOutcome: number,
  numOutcomes: number,
  totalPool: bigint,
  depositCount: bigint,
  merkleRoot: `0x${string}`,
];

/// Named view over a market tuple — use this everywhere instead of index access.
export interface Market {
  feed: `0x${string}`;
  threshold: bigint;
  resolveAfter: bigint;
  maxStaleness: bigint;
  status: number;
  winningOutcome: number;
  numOutcomes: number;
  totalPool: bigint;
  depositCount: bigint;
  merkleRoot: `0x${string}`;
}

export function parseMarket(t: MarketTuple): Market {
  return {
    feed: t[0],
    threshold: t[1],
    resolveAfter: t[2],
    maxStaleness: t[3],
    status: Number(t[4]),
    winningOutcome: Number(t[5]),
    numOutcomes: Number(t[6]),
    totalPool: t[7],
    depositCount: t[8],
    merkleRoot: t[9],
  };
}
