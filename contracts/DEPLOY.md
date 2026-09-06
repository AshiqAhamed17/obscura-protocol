# Deploying Obscura to Sepolia

## Prerequisites

- Foundry (`forge`, `cast`).
- A funded Sepolia account ([faucet](https://sepoliafaucet.com)).
- An RPC URL and an Etherscan API key (for verification).

```bash
cd contracts
cp .env.example .env      # then fill it in
source .env               # or rely on forge auto-loading .env
```

`.env` is gitignored. For real keys, prefer a Foundry keystore over a raw
`PRIVATE_KEY`:

```bash
cast wallet import deployer --interactive   # paste the key once; use --account deployer
```

## 1. Deploy the contracts

Deploys `HonkVerifier` (the Noir claim verifier) and `PredictionMarket`, wired
to the SP1 verifier gateway and the batch-settlement program's verifying key.

```bash
forge script script/Deploy.s.sol:Deploy \
  --rpc-url sepolia --broadcast --verify -vvvv
# with a keystore instead of PRIVATE_KEY, add: --account deployer
```

Note the printed `PredictionMarket` address.

- `SP1_VERIFIER_GATEWAY` defaults to the canonical gateway
  `0x397A5f7f3dBd538f23DE225B51f532c34448dA9B` (same address on every chain).
- `PROGRAM_VKEY` may start as `0x0` — deposits and resolution still work, but
  `settleWithProof` rejects every proof until it's set. Get the real value from
  `cargo run --release -p host -- --evm` (see `../host/README.md`), put it in
  `.env`, and redeploy (it's immutable).

## 2. Open a market (live Chainlink ETH/USD)

```bash
MARKET_ADDRESS=0xYourDeployedMarket \
forge script script/CreateMarket.s.sol:CreateMarket \
  --rpc-url sepolia --broadcast -vvvv
```

Defaults: Chainlink ETH/USD on Sepolia
(`0x694AA1769357215DE4FAC081bf1f309aDC325306`), threshold `$3,000` (`3000e8`),
resolves after 1 day, max price staleness 3h. Override via `THRESHOLD`,
`RESOLVE_AFTER`, `MAX_STALENESS`, `ETH_USD_FEED`.

## 3. Lifecycle on-chain

1. **Deposit** — `deposit(marketId, commitment)` with escrow (built in the app).
2. **Resolve** — after `resolveAfter`, anyone calls `resolveMarket(marketId)`;
   it reads Chainlink and records the winning side (reverts on a stale feed).
3. **Settle** — generate the SP1 batch proof on the Succinct Prover Network
   (`cargo run --release -p host -- --evm`, see `../host/README.md`), then call
   `settleWithProof(publicValues, proofBytes)`.
4. **Claim** — winners call `claim(...)` with a Noir proof.

## Local dry run

```bash
forge script script/Deploy.s.sol:Deploy        # simulate, no broadcast
forge test                                      # 29 tests
```
