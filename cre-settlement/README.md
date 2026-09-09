# Obscura — CRE Confidential Settlement (Chainlink)

A **Chainlink CRE Confidential Workflow** that settles an Obscura prediction
market **without node operators ever seeing the individual positions**. The
market's private positions are released by the **Vault DON directly into an
attested AWS Nitro enclave**; inside the TEE the workflow sums the per-outcome
stake totals and checks solvency, and **only the aggregate totals leave** via a
DON-signed report.

This is the *confidentiality* half of Obscura's "confidential **and** verifiable"
settlement. The *verifiability* half is unchanged: on-chain, the escrow still
requires the **SP1 proof** to verify those totals are correct + solvent before
releasing funds. We keep **both** — the TEE hides the plaintext positions from
operators; SP1 makes the settlement trustlessly correct.

## What is / isn't confidential (state this honestly)

- **Confidential:** the `POSITIONS` Vault-DON secret (each bettor's side + amount)
  and every intermediate value derived from it inside the enclave.
- **Not confidential:** the workflow *logic itself* — the binary, including this
  handler, is revealed to the DON. The enclave protects the **data**, not the code.
  Anything crossed back through `usingTheDons()` (here: the per-outcome totals +
  solvency flag) is public by design.

## The flow (`settlement/workflow.ts`)

1. **`cre.handlerInTee`** registers the settlement handler to run inside a Nitro
   TEE (`us-west-2`).
2. **`runtime.getSecret({ id: 'POSITIONS' })`** — fetch the market's raw private
   positions inside the enclave (JSON: `[{outcome, amount}, …]`, amounts in USDC
   base units).
3. **`aggregatePrivatePositions`** — deterministic BigInt sums per outcome +
   `solvent = (Σ stakes == expectedPool)`. Light by design: no Poseidon/heavy
   crypto in the enclave (that stays in SP1).
4. **`runtime.usingTheDons().report(...)`** — cross back and emit an `evm` report
   of `(uint64 marketId, uint256[] outcomeTotals, bool solvent)`. Only aggregates
   leave; no individual position ever crosses out or is logged.

## Prize fit (Best Confidential Workflow — $2,000)

- Uses a **TEE handler** (`handlerInTee` / `TeeRuntime`) processing a **sensitive
  input** (private positions) inside the enclave — meaningfully integrated into the
  protocol's core (settlement).
- **Simulation qualifies** for the track (no private-beta enrollment needed);
  deployment would require beta enrollment.

## Run it

```bash
cd settlement && bun install && bunx cre-setup && cd ..
cp .env.example .env            # fill SECRET_POSITIONS with the market's positions

# Login-free verification (fake TeeRuntime — proves the handler + "only
# aggregates leave the enclave"):
cd settlement && bun run typecheck && bun test && cd ..

# End-to-end enclave simulation (needs `cre login` — browser, one-time):
cre login
cre workflow simulate ./settlement --target staging-settings
```

`SECRET_POSITIONS` is the confidential input; the example sums to `6000000`
(6 USDC) across a binary market → **solvent**. `.env` is gitignored — never commit it.

## Tests (`settlement/workflow.test.ts`)

`bun test` — 11 tests over the confidential math and the TEE handler, including
**`only aggregates leave the enclave`**: a position with a unique stake is fed in
and asserted to appear in *nothing* that crosses the enclave boundary (report or
logs) — only the aggregate outcome total does.

## On-chain wiring (Task 4.2 — done)

When `consumerAddress` is set, the handler crosses back to the DON and calls
`evmClient.writeReport(...)` to deliver the aggregates to the
**`ConfidentialSettlementConsumer`** on Sepolia
(`0x1E9E464F107246f21f32330311b061A8e340d1b4`). That contract decodes the exact
`(uint64 marketId, uint256[] outcomeTotals, bool solvent)` this workflow emits and
**reconciles it against the SP1-verified on-chain totals** — the on-chain evidence
that the two settlement legs agree:

- **confidentiality** — this CRE TEE (operators never see individual positions)
- **verifiability** — `PredictionMarket.settleWithProof` (the SP1 proof), which
  remains the gate that unlocks claims.

Confidential-workflow *deployment* needs private-beta enrollment, so the on-chain
write is exercised in simulation (returns `TxStatus.SUCCESS`; the simulator does
not broadcast). The contract-level wire-compatibility + reconciliation is proven
by `contracts/test/ConfidentialSettlementConsumer.t.sol` (7 tests). See
`SIMULATION.md` Run 3.
