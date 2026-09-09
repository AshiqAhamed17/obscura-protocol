# Obscura — web app

Next.js frontend for Obscura Protocol, styled with the "Dark Pool" identity.
Talks to the live `PredictionMarket` on Sepolia.

## Run

```bash
npm install
npm run dev      # http://localhost:3000
```

A browser wallet (MetaMask etc.) on **Sepolia** is required for deposits/claims.
Reads (markets, solvency) work without a wallet.

## Pages

- `/` — hero + live market list (reads the deployed contract).
- `/deposit` — take a private position: generates a note + Poseidon commitment
  client-side, escrows ETH via `deposit()`, and shows the note to back up.
- `/claim` — prove ownership of a winning note in-browser (Noir + bb.js) and
  withdraw to a bound recipient.
- `/solvency` — anyone can verify each settled market's proven totals reconcile
  with the escrowed pool, without seeing positions.

## Architecture notes

- **Poseidon** (`lib/note.ts`, `lib/merkle.ts`) uses `poseidon-lite` (circom
  params), verified byte-identical to the Noir circuit and the aggregation
  crate — so commitments and the reconstructed Merkle root match on-chain state.
- **Contract binding** is in `lib/contract.ts` (address + ABI). Update the
  address if you redeploy.

## Known caveats (honest)

- **Claim proving needs real-browser testing.** `lib/prove.ts` uses
  `@noir-lang/noir_js` + `@aztec/bb.js` (WASM, browser-only, dynamically
  imported). For a proof to verify on-chain, those library versions **must
  match the toolchain that generated the deployed verifier** — nargo
  `1.0.0-beta.25` and bb `5.1.0`. If they drift, the proof is valid locally but
  rejected on-chain.
- **Claiming requires a settled market.** The current live deployment has a
  placeholder `programVKey` (`0x0`), so settlement — and therefore claiming —
  is disabled until the contract is redeployed with the real vkey and a batch
  proof is generated on the Succinct Prover Network. Deposits and the solvency
  view are fully functional today.
- Notes are stored in `localStorage` for the demo. A production build would let
  users export/import notes; anyone with a note can claim its winnings.
