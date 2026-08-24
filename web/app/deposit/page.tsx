"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { parseEther } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { abi, PREDICTION_MARKET, Side, type Market } from "@/lib/contract";
import { commitment, newNote, saveNote, type Note } from "@/lib/note";
import { usd, statusLabel } from "@/lib/format";

export default function DepositPage() {
  return (
    <main className="wrap section">
      <h2>Take a private position</h2>
      <p className="desc">
        Your side is hidden. Only a Poseidon commitment to your bet goes on-chain; the ETH you
        send is escrowed. Save the note that appears after depositing — you need it to claim.
      </p>
      <Suspense fallback={<p className="muted mono">Loading…</p>}>
        <DepositForm />
      </Suspense>
    </main>
  );
}

function DepositForm() {
  const params = useSearchParams();
  const { isConnected } = useAccount();
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

  // Persist the note once the deposit confirms.
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
          <span className="muted mono" style={{ fontSize: "0.8rem" }}>
            ETH ≥ {usd(market[1])} · {statusLabel(status!)}
          </span>
        )}
      </div>

      <div className="field">
        <label>Your side</label>
        <div className="side-toggle">
          <button
            type="button"
            className={side === Side.Yes ? "sel-yes" : ""}
            onClick={() => setSide(Side.Yes)}
          >
            Yes
          </button>
          <button
            type="button"
            className={side === Side.No ? "sel-no" : ""}
            onClick={() => setSide(Side.No)}
          >
            No
          </button>
        </div>
      </div>

      <div className="field">
        <label>Amount (ETH)</label>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
      </div>

      {!isConnected && <div className="note">Connect your wallet to deposit.</div>}
      {market && !isOpen && <div className="note err">This market is not open for deposits.</div>}
      {error && <div className="note err">{(error as { shortMessage?: string }).shortMessage ?? error.message}</div>}

      <button
        className="btn primary"
        onClick={submit}
        disabled={!isConnected || !isOpen || !pendingNote || isPending || confirming}
      >
        {isPending ? "Confirm in wallet…" : confirming ? "Depositing…" : "Deposit privately"}
      </button>
    </div>
  );
}

function NoteBackup({ note, hash }: { note: Note; hash?: `0x${string}` }) {
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
    <div className="form">
      <div className="note ok">
        Deposit confirmed. Your position is shielded on-chain.
        {hash && (
          <>
            {" "}
            <a
              href={`https://sepolia.etherscan.io/tx/${hash}`}
              target="_blank"
              rel="noreferrer"
              style={{ textDecoration: "underline" }}
            >
              View tx ↗
            </a>
          </>
        )}
      </div>
      <div className="field">
        <label>Back up this note — you need it to claim</label>
        <textarea
          readOnly
          value={backup}
          rows={7}
          style={{
            background: "var(--panel)",
            border: "1px solid var(--line-2)",
            borderRadius: 8,
            padding: "0.8rem 1rem",
            color: "var(--fg)",
            fontFamily: "var(--mono)",
            fontSize: "0.82rem",
          }}
        />
        <span className="muted" style={{ fontSize: "0.8rem" }}>
          It&apos;s also saved in this browser. Anyone with this note can claim the winnings — keep it safe.
        </span>
      </div>
      <div style={{ display: "flex", gap: "0.6rem" }}>
        <button className="btn" onClick={() => navigator.clipboard.writeText(backup)}>
          Copy note
        </button>
        <Link className="btn" href="/">
          Back to markets
        </Link>
      </div>
    </div>
  );
}
