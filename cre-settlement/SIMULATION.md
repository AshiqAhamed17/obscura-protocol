# CRE Confidential Settlement — Simulation Evidence

Evidence for the Chainlink **Best Confidential Workflow** track: the Obscura
settlement workflow simulated end-to-end via the CRE CLI (`cre workflow
simulate`), running the TEE handler and proving **only aggregate totals leave the
enclave**. Captured 2026-09-09.

Command:

```bash
cd cre-settlement
export CRE_ETH_PRIVATE_KEY=<any 64-hex>
export SECRET_POSITIONS='[{"outcome":0,"amount":"1000000"},{"outcome":1,"amount":"2000000"},{"outcome":1,"amount":"3000000"}]'
cre workflow simulate ./settlement --target staging-settings
```

## Run 1 — solvent (private stakes reconcile to the 6,000,000 escrow)

`SECRET_POSITIONS = [{0, 1000000}, {1, 2000000}, {1, 3000000}]` (sum 6,000,000)

```
✓ Workflow compiled
  Binary hash: 34767be499975e1e408a1ae9a19f4496ed309be0177e28d97121870e6b836e13
2026-09-09T06:24:37Z [SIMULATION] Running trigger trigger=cron-trigger@1.0.0

╭─ Trigger requested TEE Execution your trigger will run in one of the following Tees:
│     - AWS Nitro in us-west-2
│ During real execution, user logs for this trigger will not be visible, and will not leave the TEE.
│ They are presented in the simulator for debugging only.
╰─

2026-09-09T06:25:00Z [USER LOG] Enclave settled market 0: 3 private positions -> totals=[1000000, 5000000], pool=6000000, solvent=true

✓ Workflow Simulation Result:
"market 0: solvent=true, totals=[1000000, 5000000]"
```

## Run 2 — insolvent (private stakes do NOT reconcile)

`SECRET_POSITIONS = [{0, 1000000}, {1, 2000000}]` (sum 3,000,000 ≠ 6,000,000 escrow)

```
2026-09-09T06:26:00Z [USER LOG] Enclave settled market 0: 2 private positions -> totals=[1000000, 2000000], pool=3000000, solvent=false
✓ Workflow Simulation Result:
"market 0: solvent=false, totals=[1000000, 2000000]"
```

## What this demonstrates

- **A real TEE handler runs** — the simulator confirms the trigger requests
  execution in **AWS Nitro (us-west-2)**, and states that in real execution the
  logs *"will not leave the TEE"*.
- **Confidential input processed in-enclave** — the private positions
  (`SECRET_POSITIONS`, a Vault-DON secret) are summed per outcome and
  solvency-checked inside the enclave.
- **Only aggregates cross the boundary** — the result and the DON report carry
  only `outcomeTotals` + `solvent`. No individual position's side/amount ever
  appears in the output. (The `workflow.test.ts` `only aggregates leave the
  enclave` test asserts this at the unit level too.)
- **Solvency gate works** — identical logic returns `solvent=true` when the
  private stakes reconcile to the public escrow and `solvent=false` when they
  don't.

Simulation qualifies for the track without private-beta enrollment. The account
used also shows `Deploy Access: Enabled`, so a live CRE deployment is possible as
a follow-up, but the simulation above is sufficient evidence per the track rules.
