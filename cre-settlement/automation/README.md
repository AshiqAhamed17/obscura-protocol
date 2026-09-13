# Obscura — CRE auto-resolve workflow

Classic Chainlink Automation was **sunset in 2026** (v1 on Jun 30, v2.1 on Jul
31), so custom-logic upkeeps can no longer be registered. Its official successor
is **CRE**. This workflow replaces the classic `checkUpkeep`/`performUpkeep`
upkeep with a **CRE cron trigger** that drives the on-chain `AutoResolver`.

## What it does

On each schedule tick the DON delivers a signed report to
`AutoResolver.onReport` (Sepolia `0x90095B45E10f650d2b766a86E600d3D672a22606`),
which runs `resolveDue()` — resolving every Chainlink-feed market that has passed
its deadline. `resolveDue` is permissionless and self-validating: it re-checks
each market's status, deadline, and feed freshness on-chain, so the report needs
to carry no data and a race can never force an invalid resolution.

`AutoResolver` still exposes the classic `checkUpkeep`/`performUpkeep` interface
for compatibility, and has been proven live on Sepolia (it resolved market #2).

## Run

```bash
cd cre-settlement/automation
bun install
cre workflow simulate . --target staging-settings   # local simulation
cre workflow deploy .   --target production-settings # deploy to the DON
```

Config: `config.staging.json` / `config.production.json` (`schedule`,
`autoResolver`, `chainSelectorName`).

## Why a cron trigger

A market becomes resolvable purely as a function of time (its `resolveAfter`
deadline) + a fresh feed — exactly the "time-based upkeep → cron trigger"
mapping in Chainlink's CLA→CRE migration guide.
