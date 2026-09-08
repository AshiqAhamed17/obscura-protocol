# Obscura — Cross-chain USDC entry (CCTP)

Bring USDC from another chain into Obscura on Arc in one flow:

1. **CCTP bridge** — burn USDC on **Base Sepolia**, mint it on **Arc Testnet**,
   using Circle's **Bridge Kit** (CCTP V2, FAST mode).
2. **Open a shielded position on Arc** — create a market, approve, and deposit
   the USDC into the Obscura `PredictionMarket` (a Poseidon note commitment).

```bash
npm install
PRIVATE_KEY=0x... BRIDGE_AMOUNT=5 DEPOSIT_AMOUNT=3 npm run bridge-and-open
```

`PRIVATE_KEY` is read from the environment only (never hardcoded/committed).
Get testnet USDC from https://faucet.circle.com (Base Sepolia).

## On "Paymaster (gas in USDC)" — why we don't build one

Arc's native gas token **is USDC**. A paymaster exists to let a user who holds
USDC but no gas token still transact — a problem that **does not exist on Arc**.
This tool demonstrates the point literally: the USDC bridged in via CCTP is the
*same asset* that pays for the Arc-side `createMarket`/`approve`/`deposit` gas.
So "gas in USDC" is satisfied natively; a separate paymaster would be redundant.

## Live run (Base Sepolia → Arc Testnet)

A real CCTP V2 transfer + shielded position, verified on-chain:

- **Bridged:** 5 USDC — Base Sepolia balance went `20 → 15` (burn), source
  domain `6` → destination domain `26` (Arc), attested by Circle.
- **Mint on Arc:** [`0xe5f75dd8…047185`](https://testnet.arcscan.app/tx/0xe5f75dd8e1e99886a817fb10c3d11fa269a12084703281d23fbce69aef047185)
- **Position opened (market 1, 3 USDC):**
  - create: [`0x5bf86a74…f44ad`](https://testnet.arcscan.app/tx/0x5bf86a746665f5e4b20b531c3d0e2529b5b9a7829b200a2d00a03c2a503f44ad)
  - approve: [`0x784e418b…21de1`](https://testnet.arcscan.app/tx/0x784e418b52969d11ec0abafa5998d37a9f981a33b6b7696303bff498f0521de1)
  - deposit: [`0x3182bf4b…08744`](https://testnet.arcscan.app/tx/0x3182bf4b5818036e000dc29e4a2d297265b20ce0d9f15f52a76885ce0f308744)
- **On-chain result:** `market 1 totalPool == 3000000` (3 USDC escrowed).

> Funds are fungible on Arc, so this shows the *journey* (real CCTP burn→mint,
> then a real deposit), not an atomic single-tx link. A fully atomic
> "bridge-and-open in one transaction" would use low-level **CCTP V2 Hooks** (a
> destination hook contract that calls `deposit` on mint) — a further stretch
> beyond Bridge Kit's high-level `bridge()`; noted as future work.
