"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { formatEther, parseEther } from "viem";
import { useAccount, useBalance, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { abi, PREDICTION_MARKET, Side, type Market } from "@/lib/contract";
import { commitment, newNote, saveNote, type Note } from "@/lib/note";
import { usd, statusLabel, priceUsd } from "@/lib/format";
import { usePriceHistory } from "@/hooks/usePriceHistory";
import { PriceChart } from "@/components/PriceChart";
import { Countdown } from "@/components/Countdown";
import { AmbientField } from "@/components/AmbientField";

const CHIPS = ["0.01", "0.05", "0.1"];

export default function DepositPage() {
  return (
    <>
      <AmbientField />
      <main className="wrap page">
        <p className="eyebrow">Deposit</p>
        <h1>Take a private position</h1>
        <p className="lead">
          Your side stays hidden — only a Poseidon commitment to your bet goes on-chain, and the ETH
          is escrowed. Save the note shown after depositing; you need it to claim.
        </p>
        <Suspense fallback={<p className="muted mono">Loading…</p>}>
          <DepositForm />
        </Suspense>
      </main>
    </>
  );
}

function DepositForm() {
  const params = useSearchParams();
  const { address, isConnected } = useAccount();
  const [marketId, setMarketId] = useState<string>(params.get("market") ?? "0");
  const [side, setSide] = useState<Side>(Side.Yes);
  const [amount, setAmount] = useState("0.01");
  const [savedNote, setSavedNote] = useState<Note | null>(null);

  const { data: count } = useReadContract({ abi, address: PREDICTION_MARKET, functionName: "marketCount" });
  const { data: marketData } = useReadContract({
    abi,
    address: PREDICTION_MARKET,
    functionName: "markets",
    args: [BigInt(marketId || "0")],
  });
  const market = marketData as unknown as Market | undefined;
  const { data: balance } = useBalance({ address });

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const pendingNote = useMemo<Note | null>(() => {
    try {
      if (!amount || Number(amount) <= 0) return null;
      return newNote(BigInt(marketId || "0"), side, parseEther(amount));
    } catch {
      return null;
    }
  }, [marketId, side, amount]);

  useEffect(() => {
    if (isSuccess && pendingNote && !savedNote) {
      saveNote(pendingNote);
      setSavedNote(pendingNote);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess]);

  const marketCount = Number(count ?? 0n);
  const status = market ? Number(market[4]) : undefined;
  const isOpen = status === 0;
  const commit = pendingNote ? commitment(pendingNote) : null;

  function submit() {
    if (!pendingNote) return;
    reset();
    setSavedNote(null);
    writeContract({
      abi,
      address: PREDICTION_MARKET,
      functionName: "deposit",
      args: [pendingNote.marketId, commitment(pendingNote)],
      value: pendingNote.amount,
    });
  }

  if (savedNote) return <NoteBackup note={savedNote} hash={hash} />;

  return (
    <div className="split">
      {/* left — the form */}
      <div className="panel">
        {market && <MarketContext market={market} />}
        <div className="form">
          <div className="field">
            <label>Market</label>
            <select value={marketId} onChange={(e) => setMarketId(e.target.value)}>
              {Array.from({ length: Math.max(marketCount, 1) }, (_, i) => (
                <option key={i} value={i}>
                  Market #{i}
                </option>
              ))}
            </select>
            {market && (
              <span className="hint">
                ETH ≥ {usd(market[1])} · {statusLabel(status!)}
              </span>
            )}
          </div>

          <div className="field">
            <label>Your side</label>
            <div className="side-toggle">
              <button type="button" className={side === Side.Yes ? "sel-yes" : ""} onClick={() => setSide(Side.Yes)}>
                Yes · above
              </button>
              <button type="button" className={side === Side.No ? "sel-no" : ""} onClick={() => setSide(Side.No)}>
                No · below
              </button>
            </div>
          </div>

          <div className="field">
            <label>Amount (ETH)</label>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
            <div className="chips">
              {CHIPS.map((c) => (
                <button type="button" key={c} className={`chip ${amount === c ? "on" : ""}`} onClick={() => setAmount(c)}>
                  {c}
                </button>
              ))}
              {balance && (
                <span className="chip-balance mono">
                  balance {Number(formatEther(balance.value)).toLocaleString("en-US", { maximumFractionDigits: 4 })} ETH
                </span>
              )}
            </div>
          </div>

          {!isConnected && <div className="note">Connect your wallet to deposit.</div>}
          {market && !isOpen && <div className="note err">This market is closed for deposits.</div>}
          {error && <div className="note err">{(error as { shortMessage?: string }).shortMessage ?? error.message}</div>}

          <button className="btn primary" onClick={submit} disabled={!isConnected || !isOpen || !pendingNote || isPending || confirming}>
            {isPending ? "Confirm in wallet…" : confirming ? "Depositing…" : "Deposit privately"}
          </button>
        </div>
      </div>

      {/* right — what goes on-chain */}
      <aside className="aside">
        <div>
          <p className="aside-eyebrow">Your position, sealed</p>
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
            <span className="k">side</span>
            <span className="veiled">████ hidden</span>
          </div>
          <div className="seal-row">
            <span className="k">amount</span>
            <span className="mono">{amount || "0"} ETH</span>
          </div>
        </div>

        <div className="steps">
          <div className="step">
            <span className="dot">1</span>
            <p>
              Your <b>Yes/No side is hashed</b> into the commitment — the chain only sees the fingerprint above.
            </p>
          </div>
          <div className="step">
            <span className="dot">2</span>
            <p>
              Your ETH is <b>escrowed</b> by the contract until the market settles.
            </p>
          </div>
          <div className="step">
            <span className="dot">3</span>
            <p>
              Later you <b>claim with a private proof</b> — unlinkable to this deposit. Keep the note safe.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

/// A compact live read of the market you're betting on — the same Chainlink line
/// as the markets page, so you see the target while you size your position.
function MarketContext({ market }: { market: Market }) {
  const [feed, threshold, resolveAfter] = market;
  const { points, current } = usePriceHistory(feed);
  const target = Number(threshold) / 1e8;
  const over = current !== null && current >= target;
  return (
    <div className="mkt-context">
      <div className="mkt-context-top">
        <div>
          <span className="mkt-context-k mono">Live ETH / USD</span>
          <span className="mkt-context-px">{current === null ? "—" : priceUsd(current, 0)}</span>
        </div>
        <div className="mkt-context-right">
          <span className={`dist mono ${over ? "tag-yes" : "tag-no"}`}>{over ? "above target" : "below target"}</span>
          <Countdown resolveAfter={resolveAfter} />
        </div>
      </div>
      <PriceChart points={points} threshold={target} variant="spark" height={52} />
    </div>
  );
}

function NoteBackup({ note, hash }: { note: Note; hash?: `0x${string}` }) {
  const [copied, setCopied] = useState(false);
  const backup = JSON.stringify(
    {
      marketId: note.marketId.toString(),
      side: note.side,
      amount: note.amount.toString(),
      secret: note.secret.toString(),
      nullifierSecret: note.nullifierSecret.toString(),
    },
    null,
    2,
  );
  return (
    <div className="panel" style={{ maxWidth: 620 }}>
      <div className="form">
        <div className="note ok">
          Deposit confirmed — your position is shielded on-chain.
          {hash && (
            <>
              {" "}
              <a href={`https://sepolia.etherscan.io/tx/${hash}`} target="_blank" rel="noreferrer">
                View tx ↗
              </a>
            </>
          )}
        </div>
        <div className="field">
          <label>Back up this note — you need it to claim</label>
          <textarea readOnly value={backup} rows={7} />
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
          <Link className="btn" href="/markets">
            Back to markets
          </Link>
        </div>
      </div>
    </div>
  );
}
