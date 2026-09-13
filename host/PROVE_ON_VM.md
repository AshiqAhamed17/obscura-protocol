# Generating a real settlement proof on a cloud VM

Settling a market on-chain requires a real SP1 (Groth16/EVM) proof that the
per-outcome totals and commitments root were computed correctly from the
market's committed notes. That final Groth16 wrap is memory-heavy (>16 GB), so
it runs on a machine with enough RAM — e.g. a free-tier cloud VM — not a laptop.
This is the standard, production path; the proof is real and verified on-chain by
the SP1 gateway.

## 1. A VM with ≥ 32 GB RAM

Any provider works (GCP `e2-standard-8`, etc.), Ubuntu 22.04, ~40 GB disk.

## 2. Install the toolchain

```bash
sudo apt-get update && sudo apt-get install -y build-essential git curl pkg-config libssl-dev
curl -fsSL https://get.docker.com | sudo sh          # SP1's Groth16 wrap runs in Docker
sudo usermod -aG docker "$USER" && newgrp docker
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
curl -L https://sp1up.succinct.xyz | bash
source "$HOME/.bashrc" || true
export PATH="$HOME/.sp1/bin:$PATH"
sp1up
```

## 3. Clone and prove

```bash
git clone https://github.com/AshiqAhamed17/obscura-protocol.git
cd obscura-protocol

# Describe the real market's single note (secrets stay on the VM, never committed):
export SP1_PROVER=cpu
export OBSCURA_MARKET_ID=<id>
export OBSCURA_OUTCOME=<0|1|...>       # the depositor's committed outcome
export OBSCURA_AMOUNT=<usdc base units>
export OBSCURA_ESCROW=<market totalPool, base units>   # must equal the sum of note amounts
export OBSCURA_NUM_OUTCOMES=2
export OBSCURA_SECRET_HEX=0x...        # note.secret as 32-byte big-endian hex
export OBSCURA_NS_HEX=0x...            # note.nullifier_secret as 32-byte big-endian hex

cargo run --release -p host -- --evm
```

The run prints the program verifying key (must match the deployed `programVKey`),
verifies the proof locally, and prints:

```
PUBLIC_VALUES_HEX=0x...
PROOF_HEX=0x...
```

## 4. Settle on-chain

Feed those two hex blobs to `PredictionMarket.settleWithProof(publicValues, proofBytes)`:

```bash
cast send <PredictionMarket> "settleWithProof(bytes,bytes)" <PUBLIC_VALUES_HEX> <PROOF_HEX> \
  --rpc-url "$SEPOLIA_RPC_URL" --private-key "$PRIVATE_KEY"
```

The contract verifies the proof against the SP1 gateway, checks the proven totals
reconcile with the escrowed USDC, records the outcome totals + commitments root,
and flips the market to **Settled** — after which winners can claim in zero
knowledge.
