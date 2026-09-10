"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { formatUnits, parseUnits } from "viem";
import { useAccount, useChainId, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import {
  abi,
  erc20Abi,
  contractsFor,
  Side,
  USDC_DECIMALS,
  parseMarket,
  feedLabel,
  type Market,
  type MarketTuple,
} from "@/lib/contract";
import { commitment, newNote, saveNote, type Note } from "@/lib/note";
import { usd, statusLabel, priceUsd } from "@/lib/format";
import { usePriceHistory } from "@/hooks/usePriceHistory";
import { PriceChart } from "@/components/PriceChart";
import { Countdown } from "@/components/Countdown";
import { AmbientField } from "@/components/AmbientField";

const CHIPS = ["1", "5", "10"];

export default function DepositPage() {
  return (
    <>
      <AmbientField />
      <main className="wrap page">
        <p className="eyebrow">Deposit</p>
        <h1>Take a private position</h1>
        <p className="lead">
          Your side stays hidden — only a Poseidon commitment to your bet goes on-chain, and your USDC
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
  const chainId = useChainId();
  const { predictionMarket, usdc: usdcAddr, explorer } = contractsFor(chainId);
  const [marketId, setMarketId] = useState<string>(params.get("market") ?? "0");
  const [side, setSide] = useState<Side>(Side.Yes);
  const [amount, setAmount] = useState("5");
  const [savedNote, setSavedNote] = useState<Note | null>(null);

  const { data: count } = useReadContract({ abi, address: predictionMarket, functionName: "marketCount" });
  const { data: marketData } = useReadContract({
    abi,
    address: predictionMarket,
    functionName: "markets",
    args: [BigInt(marketId || "0")],
  });
  const market = marketData ? parseMarket(marketData as unknown as MarketTuple) : undefined;

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
    args: address ? [address, predictionMarket] : undefined,
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

  // approve tx
  const { writeContract: writeApprove, data: approveHash, isPending: approving } = useWriteContract();
  const { isLoading: approveConfirming, isSuccess: approved } = useWaitForTransactionReceipt({ hash: approveHash });
  useEffect(() => {
    if (approved) refetchAllowance();
  }, [approved, refetchAllowance]);

  // deposit tx
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const pendingNote = useMemo<Note | null>(() => {
    try {
      if (amountBase <= 0n) return null;
      return newNote(BigInt(marketId || "0"), side, amountBase, chainId);
    } catch {
      return null;
    }
  }, [marketId, side, amountBase]);

  useEffect(() => {
    if (isSuccess && pendingNote && !savedNote) {
      saveNote(pendingNote);
      setSavedNote(pendingNote);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess]);

  const marketCount = Number(count ?? 0n);
  const status = market ? market.status : undefined;
  const isOpen = status === 0;
  const commit = pendingNote ? commitment(pendingNote) : null;
  const needsApproval = (allowance as bigint | undefined ?? 0n) < amountBase;

  function approve() {
    writeApprove({ abi: erc20Abi, address: usdcAddr, functionName: "approve", args: [predictionMarket, amountBase] });
  }

  function submit() {
    if (!pendingNote) return;
    reset();
    setSavedNote(null);
    writeContract({
      abi,
      address: predictionMarket,
      functionName: "deposit",
      args: [pendingNote.marketId, commitment(pendingNote), pendingNote.amount],
    });
  }

  if (savedNote) return <NoteBackup note={savedNote} hash={hash} />;

  const feed = market ? feedLabel(market.feed) : null;

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
            {market && feed && (
              <span className="hint">
                {feed.asset} ≥ {usd(market.threshold)} · {statusLabel(status!)}
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
            <label>Amount (USDC)</label>
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

          {!isConnected && <div className="note">Connect your wallet to deposit.</div>}
          {market && !isOpen && <div className="note err">This market is closed for deposits.</div>}
          {error && <div className="note err">{(error as { shortMessage?: string }).shortMessage ?? error.message}</div>}

          {isConnected && isOpen && needsApproval ? (
            <button className="btn primary" onClick={approve} disabled={!pendingNote || approving || approveConfirming}>
              {approving ? "Confirm in wallet…" : approveConfirming ? "Approving USDC…" : `Approve ${amount} USDC`}
            </button>
          ) : (
            <button className="btn primary" onClick={submit} disabled={!isConnected || !isOpen || !pendingNote || isPending || confirming}>
              {isPending ? "Confirm in wallet…" : confirming ? "Depositing…" : "Deposit privately"}
            </button>
          )}
          {isConnected && isOpen && needsApproval && (
            <span className="hint">USDC is an ERC-20 — approve the escrow to pull your stake, then deposit.</span>
          )}
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
            <span className="mono">{amount || "0"} USDC</span>
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
              Your USDC is <b>escrowed</b> by the contract until the market settles.
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
  const { points, current } = usePriceHistory(market.feed);
  const target = Number(market.threshold) / 1e8;
  const over = current !== null && current >= target;
  const feed = feedLabel(market.feed);
  return (
    <div className="mkt-context">
      <div className="mkt-context-top">
        <div>
          <span className="mkt-context-k mono">Live {feed.asset} / {feed.unit}</span>
          <span className="mkt-context-px">{current === null ? "—" : priceUsd(current, 0)}</span>
        </div>
        <div className="mkt-context-right">
          <span className={`dist mono ${over ? "tag-yes" : "tag-no"}`}>{over ? "above target" : "below target"}</span>
          <Countdown resolveAfter={market.resolveAfter} />
        </div>
      </div>
      <PriceChart points={points} threshold={target} variant="spark" height={52} />
    </div>
  );
}

function NoteBackup({ note, hash }: { note: Note; hash?: `0x${string}` }) {
  const [copied, setCopied] = useState(false);
  const { explorer } = contractsFor(useChainId());
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
              <a href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer">
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
