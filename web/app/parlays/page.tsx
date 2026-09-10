"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import {
  useAccount,
  useChainId,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import {
  abi,
  contractsFor,
  erc20Abi,
  parlayPoolAbi,
  Side,
  USDC_DECIMALS,
} from "@/lib/contract";
import {
  newParlayNote,
  parlayCommitment,
  parlayToJson,
  loadParlays,
  saveParlay,
  storedToParlay,
  PARLAY_LEGS,
  type ParlayLeg,
  type ParlayNote,
} from "@/lib/parlay";
import { AmbientField } from "@/components/AmbientField";
import { useMarkets, type MarketOption } from "@/hooks/useMarkets";
import { statusLabel } from "@/lib/format";

const CHIPS = ["1", "5", "10"];

export default function ParlaysPage() {
  return (
    <>
      <AmbientField />
      <main className="wrap page">
        <p className="eyebrow">The parlay pool · Sepolia</p>
        <h1>Private parlays</h1>
        <p className="lead">
          Stack three shielded picks into one bet. Only a single Poseidon commitment to all three
          legs lands on-chain — the book never learns which markets you tied together. Win all three
          and claim with one zero-knowledge proof; miss one and the whole ticket is dead.
        </p>
        <Inner />
      </main>
    </>
  );
}

function Inner() {
  const chainId = useChainId();
  const { parlayPool } = contractsFor(chainId);
  const [tab, setTab] = useState<"build" | "mine">("build");

  if (!parlayPool) {
    return (
      <div className="panel" style={{ maxWidth: 620 }}>
        <div className="note">
          The parlay pool is live on <b>Sepolia</b>. Switch your wallet to Sepolia to build a private
          parlay. <Link href="/markets">Browse markets ↗</Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="seg">
        <button className={tab === "build" ? "on" : ""} onClick={() => setTab("build")}>
          Build a ticket
        </button>
        <button className={tab === "mine" ? "on" : ""} onClick={() => setTab("mine")}>
          My parlays
        </button>
      </div>
      {tab === "build" ? <BuildParlay pool={parlayPool} /> : <MyParlays pool={parlayPool} />}
    </>
  );
}

// --- build --------------------------------------------------------------

function BuildParlay({ pool }: { pool: `0x${string}` }) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { predictionMarket, usdc: usdcAddr, explorer } = contractsFor(chainId);
  const [legs, setLegs] = useState<ParlayLeg[]>([
    { marketId: 0n, outcome: Side.Yes },
    { marketId: 1n, outcome: Side.Yes },
    { marketId: 2n, outcome: Side.No },
  ]);
  const [amount, setAmount] = useState("5");
  const [saved, setSaved] = useState<ParlayNote | null>(null);

  const { options: marketOptions } = useMarkets();
  const { data: count } = useReadContract({ abi, address: predictionMarket, functionName: "marketCount" });
  const marketCount = Math.max(Number(count ?? 0n), PARLAY_LEGS);

  const { data: usdcBalance } = useReadContract({
    abi: erc20Abi,
    address: usdcAddr,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    abi: erc20Abi,
    address: usdcAddr,
    functionName: "allowance",
    args: address ? [address, pool] : undefined,
    query: { enabled: !!address },
  });

  const amountBase = useMemo(() => {
    try {
      if (!amount || Number(amount) <= 0) return 0n;
      return parseUnits(amount, USDC_DECIMALS);
    } catch {
      return 0n;
    }
  }, [amount]);

  const legsKey = legs.map((l) => `${l.marketId}:${l.outcome}`).join("|");
  const dupLeg = new Set(legs.map((l) => l.marketId.toString())).size !== legs.length;

  const note = useMemo<ParlayNote | null>(() => {
    if (amountBase <= 0n || dupLeg) return null;
    return newParlayNote(legs, amountBase, chainId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legsKey, amountBase, dupLeg, chainId]);

  const commit = note ? parlayCommitment(note) : null;
  const needsApproval = ((allowance as bigint | undefined) ?? 0n) < amountBase;

  const { writeContract: writeApprove, data: approveHash, isPending: approving } = useWriteContract();
  const { isLoading: approveConfirming, isSuccess: approved } = useWaitForTransactionReceipt({ hash: approveHash });
  useEffect(() => {
    if (approved) refetchAllowance();
  }, [approved, refetchAllowance]);

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isSuccess, isLoading: confirming } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess && note && !saved) {
      saveParlay(note);
      setSaved(note);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess]);

  function setLeg(i: number, patch: Partial<ParlayLeg>) {
    setLegs((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function approve() {
    writeApprove({ abi: erc20Abi, address: usdcAddr, functionName: "approve", args: [pool, amountBase] });
  }

  function submit() {
    if (!note) return;
    reset();
    writeContract({
      abi: parlayPoolAbi,
      address: pool,
      functionName: "deposit",
      args: [parlayCommitment(note), note.amount],
    });
  }

  if (saved) return <ParlaySaved note={saved} hash={hash} explorer={explorer} />;

  return (
    <div className="split">
      <div className="panel">
        <div className="form">
          <p className="aside-eyebrow">Three legs, one ticket</p>
          {legs.map((leg, i) => (
            <LegPicker
              key={i}
              index={i}
              leg={leg}
              marketCount={marketCount}
              options={marketOptions}
              onChange={(patch) => setLeg(i, patch)}
            />
          ))}

          {dupLeg && <div className="note err">Each leg must be a different market.</div>}

          <div className="field">
            <label>Stake (USDC)</label>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
            <div className="chips">
              {CHIPS.map((c) => (
                <button type="button" key={c} className={`chip ${amount === c ? "on" : ""}`} onClick={() => setAmount(c)}>
                  {c}
                </button>
              ))}
              {usdcBalance !== undefined && (
                <span className="chip-balance mono">
                  balance {Number(formatUnits(usdcBalance as bigint, USDC_DECIMALS)).toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC
                </span>
              )}
            </div>
          </div>

          {!isConnected && <div className="note">Connect your wallet to build a parlay.</div>}
          {error && <div className="note err">{(error as { shortMessage?: string }).shortMessage ?? error.message}</div>}

          {isConnected && needsApproval ? (
            <button className="btn primary" onClick={approve} disabled={!note || approving || approveConfirming}>
              {approving ? "Confirm in wallet…" : approveConfirming ? "Approving USDC…" : `Approve ${amount} USDC`}
            </button>
          ) : (
            <button className="btn primary" onClick={submit} disabled={!isConnected || !note || isPending || confirming}>
              {isPending ? "Confirm in wallet…" : confirming ? "Sealing parlay…" : "Seal parlay privately"}
            </button>
          )}
          {isConnected && needsApproval && (
            <span className="hint">Approve the parlay pool to pull your stake, then seal the ticket.</span>
          )}
        </div>
      </div>

      <aside className="aside">
        <div>
          <p className="aside-eyebrow">Your ticket, sealed</p>
          <h3>What actually goes on-chain</h3>
        </div>
        <div className="seal">
          <div className="seal-row">
            <span className="k">commitment</span>
            <span className="commit" key={commit ?? "none"}>
              {commit ? `${commit.slice(0, 16)}…${commit.slice(-6)}` : "—"}
            </span>
          </div>
          <div className="seal-row">
            <span className="k">legs</span>
            <span className="veiled">████ 3 hidden</span>
          </div>
          <div className="seal-row">
            <span className="k">stake</span>
            <span className="mono">{amount || "0"} USDC</span>
          </div>
        </div>
        <div className="steps">
          <div className="step">
            <span className="dot">1</span>
            <p>
              All three <b>picks are hashed together</b> into one commitment — the pool can&apos;t see
              which markets you correlated.
            </p>
          </div>
          <div className="step">
            <span className="dot">2</span>
            <p>
              Your USDC is <b>escrowed in the parlay pool</b>, separate from the single-market book.
            </p>
          </div>
          <div className="step">
            <span className="dot">3</span>
            <p>
              When every leg resolves, one <b>zk proof</b> that all three hit unlocks the combined
              payout — unlinkable to this deposit.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

function LegPicker({
  index,
  leg,
  marketCount,
  options,
  onChange,
}: {
  index: number;
  leg: ParlayLeg;
  marketCount: number;
  options: MarketOption[];
  onChange: (patch: Partial<ParlayLeg>) => void;
}) {
  return (
    <div className="leg">
      <span className="leg-n mono">Leg {index + 1}</span>
      <select
        className="leg-market"
        value={leg.marketId.toString()}
        onChange={(e) => onChange({ marketId: BigInt(e.target.value) })}
      >
        {options.length > 0
          ? options.map((o) => (
              <option key={o.id} value={o.id}>
                #{o.id} · {o.title} · {statusLabel(o.market.status)}
              </option>
            ))
          : Array.from({ length: marketCount }, (_, i) => (
              <option key={i} value={i}>
                Market #{i}
              </option>
            ))}
      </select>
      <div className="leg-side">
        <button className={leg.outcome === Side.Yes ? "sel-yes" : ""} onClick={() => onChange({ outcome: Side.Yes })}>
          Yes
        </button>
        <button className={leg.outcome === Side.No ? "sel-no" : ""} onClick={() => onChange({ outcome: Side.No })}>
          No
        </button>
      </div>
    </div>
  );
}

function ParlaySaved({ note, hash, explorer }: { note: ParlayNote; hash?: `0x${string}`; explorer: string }) {
  const [copied, setCopied] = useState(false);
  const backup = parlayToJson(note);
  return (
    <div className="panel" style={{ maxWidth: 640 }}>
      <div className="form">
        <div className="note ok">
          Parlay sealed — your three-leg ticket is shielded on-chain.
          {hash && (
            <>
              {" "}
              <a href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer">
                View tx ↗
              </a>
            </>
          )}
        </div>
        <div className="field">
          <label>Back up this parlay note — you need it to claim</label>
          <textarea readOnly value={backup} rows={9} />
          <span className="hint">
            Also saved in this browser. Anyone with this note can claim the winnings — keep it safe.
          </span>
        </div>
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
          <button
            className="btn"
            onClick={() => {
              navigator.clipboard.writeText(backup);
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }}
          >
            {copied ? "Copied ✓" : "Copy note"}
          </button>
          <Link className="btn" href="/parlays">
            Build another
          </Link>
        </div>
      </div>
    </div>
  );
}

// --- my parlays ---------------------------------------------------------

function MyParlays({ pool }: { pool: `0x${string}` }) {
  const chainId = useChainId();
  const [items, setItems] = useState<ReturnType<typeof loadParlays>>([]);
  useEffect(() => {
    setItems(loadParlays().filter((p) => (p.chainId ?? 11155111) === chainId));
  }, [chainId]);

  const { data: root } = useReadContract({ abi: parlayPoolAbi, address: pool, functionName: "parlayRoot" });
  const { data: staked } = useReadContract({ abi: parlayPoolAbi, address: pool, functionName: "totalStaked" });
  const { data: depositCount } = useReadContract({ abi: parlayPoolAbi, address: pool, functionName: "depositCount" });

  const settled = root && root !== "0x0000000000000000000000000000000000000000000000000000000000000000";

  if (items.length === 0) {
    return (
      <div className="panel" style={{ maxWidth: 620 }}>
        <div className="note">
          No parlays yet on this network. <Link href="/parlays">Build a ticket</Link> to get started.
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="port-summary">
        <div className="port-stat">
          <span className="port-stat-k mono">Pool escrow</span>
          <span className="port-stat-v">{staked !== undefined ? usdc6(staked as bigint) : "—"}</span>
        </div>
        <div className="port-stat">
          <span className="port-stat-k mono">Tickets in pool</span>
          <span className="port-stat-v">{depositCount !== undefined ? Number(depositCount) : "—"}</span>
        </div>
        <div className="port-stat">
          <span className="port-stat-k mono">Your tickets</span>
          <span className="port-stat-v">{items.length}</span>
        </div>
      </div>

      <div className="pk-list">
        {items.map((p, i) => (
          <div className="pk-row" key={p.commitment + i}>
            <div className="pk-main">
              <div className="pk-legs">
                {p.legs.map((l, j) => (
                  <span className="pk-leg-tag mono" key={j}>
                    #{l.marketId} {l.outcome === 1 ? "Yes" : "No"}
                  </span>
                ))}
              </div>
              <span className="pk-commit mono" title={p.commitment}>
                {p.commitment.slice(0, 14)}…{p.commitment.slice(-6)}
              </span>
            </div>
            <div className="pk-side">
              <span className="pk-stake mono">{usdc6(BigInt(p.amount))}</span>
              <span className={`pk-bucket ${settled ? "warn" : ""}`}>{settled ? "settleable" : "awaiting settlement"}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="panel" style={{ marginTop: "1.2rem" }}>
        <p className="aside-eyebrow">Claiming a winning parlay</p>
        <p className="muted" style={{ lineHeight: 1.6 }}>
          A parlay pays out only after <b>every leg&apos;s market has resolved</b> and the settler posts the
          combined <span className="mono">parlayRoot</span> to the pool. At that point your browser builds
          the Merkle path to your sealed ticket, proves in zero knowledge that all three legs backed the
          winning outcome, and submits <span className="mono">claim()</span> — the pool marks your nullifier
          spent and pays the product-of-ratios payout. The current pool root is{" "}
          <span className="mono">{root ? `${(root as string).slice(0, 10)}…` : "—"}</span>
          {settled ? " (settled)." : " — not yet settled, so no ticket is claimable."}
        </p>
      </div>
    </>
  );
}

function usdc6(base: bigint): string {
  return (Number(base) / 1e6).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}
