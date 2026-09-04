# Obscura Protocol — Trust Model & Threat Analysis

This document states precisely what Obscura **guarantees cryptographically**,
what it **assumes**, and what is **out of scope**. It does not overclaim.
Obscura is an unaudited, testnet-stage research protocol — do not use it with
funds you can't lose.

## Summary

| Property | Status | Enforced / assumed by |
|---|---|---|
| Your Yes/No side is hidden | **Guaranteed** | Poseidon commitment (side is inside the hash) |
| Deposit amount is hidden | **Not claimed** | `msg.value` is public on-chain |
| Withdrawal isn't linkable to your deposit | **Guaranteed** | Nullifier is unlinkable to the commitment |
| Withdrawal amount is hidden | **Not claimed** | Payout is a public transfer |
| You can't claim a bet you didn't make | **Guaranteed** | Noir Merkle-membership proof |
| You can't inflate your claimed amount | **Guaranteed** | `amount` is a bound public input to the claim proof |
| You can't claim twice | **Guaranteed** | On-chain nullifier registry |
| Your claim can't be front-run | **Guaranteed** | Recipient bound into the claim proof |
| Reported totals are correct & solvent | **Guaranteed** | SP1 batch-settlement proof + on-chain `totalPool` check |
| No operator is trusted for the numbers | **Guaranteed** | `settleWithProof` only accepts verified public values |
| Operator can't see your position | **Assumed false** | Operator processes plaintext deposits (see §3) |
| Operator can't stall settlement | **Assumed** | Liveness assumption (see §3, §5) |
| Outcome is honest | **Assumed** | Chainlink price feed (see §4) |

## 1. Actors

- **Trader** — deposits a private position, later claims if they win. Holds
  their own note secrets.
- **Operator / relay** — collects deposits' plaintext notes, batches resolved
  markets, and produces the SP1 settlement proof. **Untrusted for correctness;
  trusted for confidentiality and liveness** (see §3).
- **Prover** — generates the SP1 proof. Can be anyone (permissionless);
  in practice the operator or the Succinct Prover Network.
- **Contract** — `PredictionMarket` on Ethereum. The trust anchor: it holds
  escrow and verifies both proofs. Has no admin/owner and no upgrade path.

## 2. What is cryptographically guaranteed

### 2.1 Position privacy (side)
A bet is a note `{market_id, side, amount, secret, nullifier_secret}`. Only its
Poseidon commitment `hash5(market_id, side, amount, secret, nullifier_secret)`
is stored on-chain. `side` is one of the hashed pre-images, and `secret` is a
random blinding factor, so:
- the chain cannot tell Yes from No, and
- two identical bets produce different commitments (no correlation).

**Limit:** the deposit `amount` equals `msg.value`, which is public. Obscura
hides *which side* you took and *the link* between your deposit and your later
claim — it does **not** hide the sizes of deposits or payouts. (See §3 for the
operator's view.)

### 2.2 Unlinkable, single-use claims
To claim, a trader reveals a nullifier `hash2(nullifier_secret, market_id)` and
proves in Noir that their commitment is a leaf of the settled Merkle root, on
the winning side. The contract records spent nullifiers.
- **Double-claim resistance:** a note has exactly one nullifier; the second
  attempt hits the on-chain registry and reverts.
- **Unlinkability:** the nullifier is derived from `nullifier_secret` (never
  from `secret`/`side`/`amount`), so an observer who sees the deposit
  commitment and the claim nullifier cannot connect them without the secret.

### 2.3 No inflated claims
`amount` and `market_id` are public inputs to the claim circuit and feed the
commitment. Claiming a different amount changes the commitment, which then
fails Merkle membership. A winner can only claim exactly what their note
encodes.

### 2.4 Front-running resistance
`recipient` is a bound public input to the claim proof (`assert recipient != 0`).
An attacker who copies a claim proof from the mempool and swaps the payout
address changes the public inputs, so verification fails. Payout goes only to
the address the prover committed to.

### 2.5 Settlement correctness & solvency
`settleWithProof` accepts per-market totals + Merkle root **only** if an SP1
proof attests they were computed correctly from that market's note set. The SP1
guest:
- reconstructs each market's commitment root from its notes (Poseidon), and
- sums stakes per side and checks the sum equals the market's escrowed
  collateral (solvency).

On-chain, the contract **also** re-checks `totalYes + totalNo == totalPool`
against the ETH actually escrowed. So neither the operator nor the prover can
misreport totals, invent a root, or settle an insolvent book. There is no
trusted `settle()` — the removed M1 operator path no longer exists.

### 2.6 Cross-implementation Poseidon (verified, not assumed)
Two proof systems must agree on one Merkle root: SP1 (Rust, `light-poseidon`)
establishes it; the Noir claim circuit proves membership against it. These use
different Poseidon implementations, so byte-equality is a correctness
requirement. It is **verified by fixed test vectors** (identical `hash2`,
`hash5`, and a full commitment/nullifier produced by both), not assumed. See
`aggregation/src/lib.rs` tests.

## 3. What is assumed (the honest limitations)

### 3.1 The operator sees plaintext positions
To build the note set and run the prover, the operator receives deposits'
plaintext notes. **It therefore knows every trader's side and amount.** Obscura
protects privacy against the *public chain and other traders*, **not** against
the operator. This is the single largest assumption.
- It does **not** let the operator steal or misreport (§2.5 holds regardless).
- Removing it requires MPC/FHE matching or client-side note handling with a
  different data-availability design — **future work**, not implemented.

### 3.2 Amount ↔ deposit binding
A note's committed `amount` should equal the `msg.value` escrowed for that
deposit. This is **not** checked on-chain at deposit time (the amount is inside
the commitment). It is enforced indirectly: the SP1 solvency check requires the
summed note amounts to equal `totalPool`, so the batch **cannot over-pay**. A
mismatched note can't inflate payouts, but it can make a market **unsettleable**
until corrected. A cleaner design records `(commitment, amount)` on-chain at
deposit and has the guest bind each note's amount to it — **future work**.

### 3.3 Liveness depends on a prover
Markets settle only once *someone* submits a valid SP1 proof. If no prover runs
(operator offline, no one pays for proving), a resolved market cannot settle and
funds stay escrowed until it does. Mitigations: settlement is **permissionless**
(anyone can prove and submit), and the operator cannot finalize a *partial*
book — omitting a note makes the summed totals fall short of `totalPool`, so
settlement reverts (omission is a liveness/griefing risk, never theft).

### 3.4 Withdrawal reveals amount, not identity
A claim is a public transfer of a specific amount to a chosen address. The
amount and recipient are visible; the *link back to the original deposit* is
not. This is unlinkability, not amount-confidentiality. Large, uniquely-sized
positions may be statistically correlatable across deposit/claim by amount —
users wanting stronger privacy should use round/common denominations.

### 3.5 Oracle trust (Chainlink)
Outcomes come from a Chainlink price feed. Obscura assumes the feed is honest
and live; it guards against a *stale* feed (rejects answers older than a
per-market `maxPriceStaleness`) but not against Chainlink itself being wrong,
manipulated, or deprecated. Only price-threshold markets are supported today;
arbitrary event markets (Chainlink Functions) would add trust in whatever data
source Functions calls — out of scope.

### 3.6 Groth16 trusted setup
On-chain verification uses SP1's Groth16 wrapper, which relies on a trusted
setup. Obscura inherits that assumption from SP1. The core/compressed SP1 proof
(used off-chain) does not.

### 3.7 Range limits
Amounts and per-side totals are handled as `u64` in the settlement crate
(≈ up to ~18 ETH per total). This is a testnet-MVP limit; widening to `u128`/
`u256` is mechanical future work.

## 4. Adversary scenarios

| Adversary attempts… | Outcome |
|---|---|
| Read a trader's side from chain data | Fails — only the commitment is on-chain |
| Link a claim to a deposit | Fails — nullifier is unlinkable to the commitment |
| Claim a bet they never made | Fails — no Merkle membership proof exists |
| Claim more than they staked | Fails — `amount` is bound; commitment/membership breaks |
| Claim the same note twice | Fails — nullifier already spent |
| Steal a mempool claim by changing recipient | Fails — recipient is bound into the proof |
| Operator misreports totals to skim | Fails — SP1 proof + on-chain `totalPool` check |
| Operator settles an insolvent/partial book | Fails — solvency check + `totalYes+totalNo==totalPool` |
| Operator censors a trader's note | No theft; blocks settlement until included (liveness) |
| Operator deanonymizes a trader | **Succeeds** — operator sees plaintext (§3.1) |
| Manipulate the Chainlink price | Depends on Chainlink; out of Obscura's control (§3.5) |

## 5. Security posture

- **No admin, no owner, no upgradeability** in `PredictionMarket` — verifier
  addresses and the program vkey are immutable constructor args.
- **Effects before interactions** in `claim` (nullifier marked spent before the
  ETH transfer).
- **Unaudited.** Testnet only. The contract has unit + fuzz + real-proof
  end-to-end tests, but no third-party audit.

## 6. Future work to strengthen this model

1. Remove operator plaintext access (MPC/FHE matching, or client-side notes).
2. Bind `amount` to `msg.value` on-chain at deposit (§3.2).
3. Forced-inclusion / permissionless note submission to remove the liveness
   dependency on a single operator (§3.3).
4. A custom SP1 BN254-field precompile so full-batch proofs are cheap to
   generate without the prover network.
5. Wider integer ranges; multi-outcome and event (Functions) markets.
6. A third-party audit before any mainnet consideration.
