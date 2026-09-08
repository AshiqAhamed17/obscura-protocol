// Cross-chain USDC entry for Obscura.
//
// One flow, two real steps:
//   1. CCTP bridge — burn USDC on Base Sepolia, mint it on Arc (Circle Bridge Kit).
//   2. Open a shielded position on Arc — create a market, approve, and deposit
//      the USDC into the Obscura PredictionMarket (a Poseidon note commitment).
//
// Note on Arc's economics: USDC is Arc's *native gas token*, so the bridged USDC
// also pays for the Arc-side transactions — no separate gas asset, and no
// paymaster needed (that redundancy is why we don't build one; see README).
//
// Secrets: PRIVATE_KEY is read from the environment only, never hardcoded.

import { BridgeKit } from "@circle-fin/bridge-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
import { createPublicClient, createWalletClient, defineChain, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { inspect } from "util";

const PREDICTION_MARKET = "0xB0bAF72EC2a249376B468B5E6Bbc88CF87099b50" as const;
const ARC_USDC = "0x3600000000000000000000000000000000000000" as const;
// A real Poseidon note commitment (from the claim fixture) — a valid BN254 field
// element. Per-market, so reusing it across fresh markets is fine.
const COMMITMENT = "0x061a4960a702e1605e3442b65b6fe17b3ea6b2ca30d7b6135fe1b00b01535252" as const;
const SOURCE_REF = "0x6f62736375726100000000000000000000000000000000000000000000000000" as const; // "obscura"

const BRIDGE_AMOUNT = process.env.BRIDGE_AMOUNT ?? "5"; // USDC to bridge
const DEPOSIT_AMOUNT = process.env.DEPOSIT_AMOUNT ?? "3"; // USDC to escrow on Arc

const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
  blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } },
});

const marketAbi = [
  { type: "function", name: "marketCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "createMarketWithSource",
    stateMutability: "nonpayable",
    inputs: [
      { name: "source", type: "uint8" },
      { name: "resolver", type: "address" },
      { name: "threshold", type: "int256" },
      { name: "resolveAfter", type: "uint256" },
      { name: "sourceRef", type: "bytes32" },
      { name: "numOutcomes", type: "uint8" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "commitment", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
] as const;

function requirePrivateKey(): `0x${string}` {
  const pk = process.env.PRIVATE_KEY;
  if (!pk || !pk.startsWith("0x")) throw new Error("PRIVATE_KEY env var must be set and 0x-prefixed");
  return pk as `0x${string}`;
}

async function bridge(pk: `0x${string}`) {
  const kit = new BridgeKit();
  const adapter = createViemAdapterFromPrivateKey({ privateKey: pk });
  console.log(`\n[1/2] CCTP bridge ${BRIDGE_AMOUNT} USDC: Base Sepolia -> Arc Testnet ...`);
  const result = await kit.bridge({
    from: { adapter, chain: "Base_Sepolia" },
    to: { adapter, chain: "Arc_Testnet" },
    amount: `${BRIDGE_AMOUNT}.00`,
  });
  console.log("bridge result:", inspect(result, false, 4, true));
  if (result.state !== "success") throw new Error(`bridge did not succeed: state=${result.state}`);
  return result;
}

async function openPosition(pk: `0x${string}`) {
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http() });
  const pub = createPublicClient({ chain: arcTestnet, transport: http() });
  const amount = parseUnits(DEPOSIT_AMOUNT, 6); // USDC is 6 decimals

  console.log(`\n[2/2] Open shielded position on Arc (${DEPOSIT_AMOUNT} USDC) ...`);

  const marketId = (await pub.readContract({
    address: PREDICTION_MARKET,
    abi: marketAbi,
    functionName: "marketCount",
  })) as bigint;

  const resolveAfter = BigInt(Math.floor(Date.now() / 1000) - 60);
  const createHash = await wallet.writeContract({
    address: PREDICTION_MARKET,
    abi: marketAbi,
    functionName: "createMarketWithSource",
    args: [2, account.address, 0n, resolveAfter, SOURCE_REF, 2],
  });
  await pub.waitForTransactionReceipt({ hash: createHash });

  const approveHash = await wallet.writeContract({
    address: ARC_USDC,
    abi: erc20Abi,
    functionName: "approve",
    args: [PREDICTION_MARKET, amount],
  });
  await pub.waitForTransactionReceipt({ hash: approveHash });

  const depositHash = await wallet.writeContract({
    address: PREDICTION_MARKET,
    abi: marketAbi,
    functionName: "deposit",
    args: [marketId, COMMITMENT, amount],
  });
  await pub.waitForTransactionReceipt({ hash: depositHash });

  const ex = (h: string) => `https://testnet.arcscan.app/tx/${h}`;
  console.log("position opened:");
  console.log("  marketId   :", marketId.toString());
  console.log("  createTx   :", ex(createHash));
  console.log("  approveTx  :", ex(approveHash));
  console.log("  depositTx  :", ex(depositHash));
  return { marketId, createHash, approveHash, depositHash };
}

async function main() {
  const pk = requirePrivateKey();
  await bridge(pk);
  await openPosition(pk);
  console.log("\nDone: bridged USDC into Arc and opened a shielded Obscura position.");
}

main().catch((e) => {
  console.error("ERROR:", e instanceof Error ? e.message : e);
  process.exit(1);
});
