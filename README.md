# Obscura Protocol

> **A zkVM proves that an entire batch of private prediction markets settled correctly and solvently — without any individual position ever being revealed.**

**Live on Sepolia** — `PredictionMarket` (verified):
[`0x7359…EdF5`](https://sepolia.etherscan.io/address/0x7359B433E925e6e788e6Cd377D02F4e86d76EdF5)
· resolves against Chainlink ETH/USD · deposits & resolution functional
(see [deployment notes](./contracts/deployments/sepolia.json)).

Prediction markets (Polymarket, Kalshi, Augur) make every position public,
leaking strategy and inviting front-running on correlated markets. A few
projects have started hiding *individual* positions with ZK circuits — but
none of them prove that settlement across many markets is actually solvent.
That part is still just trusted.

Obscura does both:

- **Positions are private.** Traders take shielded positions using Noir
  notes (Poseidon commitments + nullifiers) — nothing about who bet what is
  revealed on-chain.
- **Solvency is proven, not promised.** At settlement, a single **SP1 zkVM**
  proof processes an *entire batch* of concurrently-resolving markets — a
  variable, not-fixed-in-advance number of them — verifying every note and
  proving each market is solvent, without exposing any position.

The batch-solvency proof is the point: proving one market's sum is trivial
and a plain circuit could do it. Proving a *variable-size batch* of markets
in one shot is exactly the iterative, not-known-at-compile-time computation a
general-purpose zkVM is built for — that's why Obscura uses SP1 rather than
"just another circuit."

> **Status:** early-stage. Milestone 0 (on-chain market/escrow + Chainlink
> resolution + the batch-settlement crate) is implemented and tested; the
> Noir privacy layer and SP1 proving are the active work. See the roadmap
> below.

---

## How it works

```
Trader ──(private deposit note)──▶ Market/Escrow Contract (Solidity)
                                          │
                              (market resolution time)
                                          ▼
                        Chainlink Price Feed ──▶ winning side determined
                                          │
                                          ▼
                    Operator runs ONE SP1 zkVM guest program over
                    the whole batch of markets resolving this epoch
                    (variable-size list, not fixed in advance)
                                          │
                        proof: every market's totals are correct
                             and every market is solvent
                                          ▼
                        Settlement Contract verifies the proof
                                          │
                                          ▼
                    Winners claim via a Noir circuit — prove a valid
                    unspent note on the winning side, burn its nullifier,
                    receive a pari-mutuel payout, unlinkable to the deposit
```

1. **Deposit** — a position is a Noir note `(market_id, side, amount, secret,
   nullifier_secret)`; only its Poseidon commitment goes on-chain, into a
   Merkle tree. Collateral is escrowed.
2. **Resolve** — the market settles against a real Chainlink price feed
   (`AggregatorV3Interface.latestRoundData()`), with an explicit staleness
   check (some testnet feeds intermittently stop updating).
3. **Prove** — an SP1 guest program takes the full batch of resolved markets,
   verifies each note's Merkle membership (using SP1 precompiled hashing),
   sums stakes per side per market, and proves the batch is solvent.
4. **Claim** — winners prove an unspent winning note in a Noir circuit and
   burn a nullifier to prevent double-claims. Withdrawal reveals the amount
   (funds must move) but not which deposit it came from.

## Trust model (stated honestly)

- The operator that processes deposits sees plaintext positions to build the
  note set — it is trusted for *confidentiality*, not solved via MPC. Named
  as an explicit scope cut, with homomorphic aggregation as future work.
- What the SP1 proof *does* guarantee: the operator cannot fabricate or drop
  notes, or misreport totals, in any market of the batch undetected.
- Withdrawal is *unlinkable*, not amount-hiding — the same privacy model as
  the author's prior ZK-AfterLife project.

Full analysis — what's cryptographically guaranteed vs. assumed vs. out of
scope — is in [`docs/trust-model.md`](./docs/trust-model.md).

## Tech stack

| Layer | Tech |
|---|---|
| Private positions | **Noir** (Poseidon commitments, Merkle proofs, nullifiers) |
| Batch solvency proof | **SP1 zkVM** (Rust guest, precompiled hashing) |
| Settlement / escrow | **Solidity** + **Foundry** |
| Oracle / resolution | **Chainlink** Price Feeds (staleness-checked) |
| Client | **Next.js**, **Wagmi**, **Viem** (in-browser WASM proving) |

## Status & roadmap

| Milestone | Scope | Status |
|---|---|---|
| **M0** | Market/escrow contract + Chainlink resolution + batch settlement crate | ✅ Done |
| **M1** | Noir shielded deposit notes + claim/nullifier circuit | 🔜 Next |
| **M2** | SP1 guest proves batch settlement (the core differentiator) | Planned |
| **M3** | Sepolia deploy, web UI, public solvency page, benchmarks | Planned |
| **M4** | Chainlink Functions markets, multi-operator proof aggregation | Stretch |

## Repo layout

```
contracts/      Foundry — market/escrow contract + tests (M0 ✅)
aggregation/    Plain Rust crate — batch settlement logic, unit tested (M0 ✅)
guest/          SP1 guest program (placeholder until M2)
circuits/       Noir — shielded-note ZK primitives (M1, in progress)
```

## Running locally

```bash
# Solidity contract + tests (13 tests incl. fuzz)
cd contracts && forge test -vv

# Rust workspace — batch settlement logic (6 tests)
cargo test

# Noir circuits — in-circuit unit tests (see circuits/README.md for toolchain)
cd circuits && nargo test
```

## Prior work this builds on

- **ZK-AfterLife** — privacy-preserving inheritance protocol (Noir: Poseidon
  nullifiers, Merkle proofs, private commitments). Obscura reuses this
  note/nullifier pattern.
- **ZK-explorX** — in-browser zk-SNARK generation via WASM + on-chain
  Solidity verifier. Obscura reuses this client-side proving pattern.

## License

MIT
