import { parseAbi } from "viem";
import { sepolia } from "wagmi/chains";

/// Deployed on Sepolia (see contracts/deployments/sepolia.json).
export const PREDICTION_MARKET = "0x7359B433E925e6e788e6Cd377D02F4e86d76EdF5" as const;
export const CHAIN = sepolia;

/// Canonical Chainlink ETH/USD feed on Sepolia — powers the nav price ticker.
export const ETH_USD_FEED = "0x694AA1769357215DE4FAC081bf1f309aDC325306" as const;

/// BN254 scalar field modulus — note commitments must be below this.
export const FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/// 0 = No, 1 = Yes — matches the Solidity `Side` enum and the Noir circuit.
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

/// Minimal Chainlink AggregatorV3 read interface (for the live price chart).
export const aggregatorAbi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function getRoundData(uint80 roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
]);

export const abi = parseAbi([
  "function marketCount() view returns (uint256)",
  "function markets(uint256) view returns (address priceFeed, int256 threshold, uint256 resolveAfter, uint256 maxPriceStaleness, uint8 status, uint8 winningSide, uint256 totalPool, uint256 depositCount, bytes32 merkleRoot, uint256 totalYes, uint256 totalNo)",
  "function getCommitments(uint256 marketId) view returns (bytes32[])",
  "function nullifierSpent(bytes32) view returns (bool)",
  "function deposit(uint256 marketId, bytes32 commitment) payable returns (uint256 leafIndex)",
  "function resolveMarket(uint256 marketId)",
  "function claim(uint256 marketId, uint256 amount, bytes32 nullifier, address recipient, bytes proof)",
  "function createMarket(address priceFeed, int256 threshold, uint256 resolveAfter, uint256 maxPriceStaleness) returns (uint256)",
]);

/// Shape returned by `markets(id)`.
export type Market = readonly [
  priceFeed: `0x${string}`,
  threshold: bigint,
  resolveAfter: bigint,
  maxPriceStaleness: bigint,
  status: number,
  winningSide: number,
  totalPool: bigint,
  depositCount: bigint,
  merkleRoot: `0x${string}`,
  totalYes: bigint,
  totalNo: bigint,
];
