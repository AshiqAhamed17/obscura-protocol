"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useChainId, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { abi, contractsFor, feedLabel, parseMarket, type Market, type MarketTuple } from "@/lib/contract";
import {
  commitment,
  importNote,
  loadNotes,
  noteToJson,
  nullifier,
  storedToNote,
  type Note,
} from "@/lib/note";
import { generateClaimProof } from "@/lib/prove";
import { usdc, usdcCompact, outcomeLabel, statusLabel, statusClass, usd } from "@/lib/format";
import { AmbientField } from "@/components/AmbientField";
import { ConnectButton } from "@/components/ConnectButton";

type Bucket = "claimable" | "open" | "history";

export default function PortfolioPage() {
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const [notes, setNotes] = useState<Note[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setNotes(loadNotes().map(storedToNote));
  }, [reloadKey]);

  // positions taken on the connected network (notes without a chainId are legacy Sepolia)
  const chainNotes = useMemo(
    () => notes.filter((n) => (n.chainId ?? 11155111) === chainId),
    [notes, chainId],
  );

  return (
    <>
      <AmbientField />
      <main className="wrap page">
        <p className="eyebrow">Your book</p>
        <h1>Portfolio</h1>
        <p className="lead">
          Every position you hold, tracked privately in this browser. Only you can see which side you
          took — the chain sees a commitment. Winners claim in one click.
        </p>

        {!isConnected ? (
          <div className="panel connect-cta">
            <div className="note">Connect your wallet to see your positions and claim.</div>
            <ConnectButton />
          </div>
        ) : chainNotes.length === 0 ? (
          <EmptyState onImported={() => setReloadKey((k) => k + 1)} />
        ) : (
          <PortfolioBody
            notes={chainNotes}
            recipient={address as `0x${string}`}
            onChange={() => setReloadKey((k) => k + 1)}
          />
        )}
      </main>
    </>
  );
}

/// A note's fully-resolved on-chain state, computed once at the parent level so
/// bucket assignment never depends on whether a child has mounted.
interface Position {
  note: Note;
  key: string;
  market?: Market;
  leaves: readonly `0x${string}`[];
  claimed: boolean;
  bucket: Bucket;
  stake: bigint;
  payout: bigint | null;
  loaded: boolean;
}

function keyOf(n: Note): string {
  return `${n.marketId}-${n.secret}`;
}

function PortfolioBody({ notes, recipient, onChange }: { notes: Note[]; recipient: `0x${string}`; onChange: () => void }) {
  const chainId = useChainId();
  const { predictionMarket, explorer } = contractsFor(chainId);

  // One multicall for every position's on-chain state (market, totals,
  // commitments, spent). Reads live at the PARENT so buckets are known before
  // any row renders — the child no longer has to mount to classify itself.
  const { data: multi, isLoading } = useReadContracts({
    contracts: notes.flatMap((n) => [
      { abi, address: predictionMarket, functionName: "markets" as const, args: [n.marketId] as const },
      { abi, address: predictionMarket, functionName: "getOutcomeTotals" as const, args: [n.marketId] as const },
      { abi, address: predictionMarket, functionName: "getCommitments" as const, args: [n.marketId] as const },
      { abi, address: predictionMarket, functionName: "nullifierSpent" as const, args: [nullifier(n)] as const },
    ]),
    query: { enabled: notes.length > 0 },
  });

  const positions = useMemo<Position[]>(() => {
    return notes.map((n) => {
      const key = keyOf(n);
      const base = notes.indexOf(n) * 4;
      const marketRes = multi?.[base]?.result as unknown as MarketTuple | undefined;
      const totals = (multi?.[base + 1]?.result as readonly bigint[] | undefined) ?? [];
      const leaves = (multi?.[base + 2]?.result as readonly `0x${string}`[] | undefined) ?? [];
      const claimed = multi?.[base + 3]?.result === true;
      const market = marketRes ? parseMarket(marketRes) : undefined;

      const isSettled = market?.status === 2;
      const onWinningSide = market !== undefined && n.side === market.winningOutcome;
      const winningTotal = market ? (totals[market.winningOutcome] ?? 0n) : 0n;
      const payout = market && isSettled && onWinningSide && winningTotal > 0n ? (n.amount * market.totalPool) / winningTotal : null;
      const bucket: Bucket = !isSettled ? "open" : onWinningSide && !claimed ? "claimable" : "history";

      return { note: n, key, market, leaves, claimed, bucket, stake: n.amount, payout, loaded: !!market };
    });
  }, [notes, multi]);

  const summary = useMemo(() => {
    let atStake = 0n;
    let claimableEst = 0n;
    let claimed = 0;
    for (const p of positions) {
      if (p.bucket === "open") atStake += p.stake;
      if (p.bucket === "claimable") claimableEst += p.payout ?? 0n;
      if (p.claimed) claimed++;
    }
    return { atStake, claimableEst, claimed, total: notes.length };
  }, [positions, notes.length]);

  const inBucket = (b: Bucket) => positions.filter((p) => p.bucket === b);
  const loadingRows = isLoading && positions.every((p) => !p.loaded);

  return (
    <>
      <div className="statrow">
        <Stat label="Positions" value={String(summary.total)} />
        <Stat label="At stake" value={usdcCompact(summary.atStake)} />
        <Stat label="Claimable now" value={usdcCompact(summary.claimableEst)} accent />
        <Stat label="Claimed" value={String(summary.claimed)} />
      </div>

      {loadingRows && <p className="muted mono port-empty">Reading your positions on-chain…</p>}

      <Section title="Claimable" hint="Winning positions — prove and withdraw in USDC.">
        {inBucket("claimable").map((p) => (
          <PositionRow key={p.key} pos={p} recipient={recipient} predictionMarket={predictionMarket} explorer={explorer} onClaimed={onChange} />
        ))}
        {inBucket("claimable").length === 0 && <p className="muted mono port-empty">Nothing to claim yet.</p>}
      </Section>

      <Section title="Open" hint="Waiting on resolution + an SP1 settlement proof.">
        {inBucket("open").map((p) => (
          <PositionRow key={p.key} pos={p} recipient={recipient} predictionMarket={predictionMarket} explorer={explorer} onClaimed={onChange} />
        ))}
        {inBucket("open").length === 0 && !loadingRows && <p className="muted mono port-empty">No open positions.</p>}
      </Section>

      <Section title="History" hint="Settled positions — claimed, or on the losing side.">
        {inBucket("history").map((p) => (
          <PositionRow key={p.key} pos={p} recipient={recipient} predictionMarket={predictionMarket} explorer={explorer} onClaimed={onChange} />
        ))}
        {inBucket("history").length === 0 && <p className="muted mono port-empty">No settled positions yet.</p>}
      </Section>

      <NotesTools notes={notes} onImported={onChange} />
    </>
  );
}

function PositionRow({
  pos,
  recipient,
  predictionMarket,
  explorer,
  onClaimed,
}: {
  pos: Position;
  recipient: `0x${string}`;
  predictionMarket: `0x${string}`;
  explorer: string;
  onClaimed: () => void;
}) {
  const { note, market, leaves, claimed, bucket, payout } = pos;
  const [proving, setProving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess) onClaimed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess]);

  async function claim() {
    setError("");
    try {
      if (!market) throw new Error("Market not loaded yet.");
      const leafIndex = leaves.findIndex((c) => c.toLowerCase() === commitment(note).toLowerCase());
      if (leafIndex < 0) throw new Error("Commitment not found in this market's tree.");
      setProving(true);
      setStatus("Proving in your browser…");
      const cp = await generateClaimProof({
        note,
        winningOutcome: market.winningOutcome,
        leaves: leaves.map((c) => BigInt(c)),
        leafIndex,
        recipient,
      });
      if (cp.computedRoot.toLowerCase() !== market.merkleRoot.toLowerCase()) {
        throw new Error("Root mismatch — is the market fully settled?");
      }
      setStatus("Submitting claim…");
      writeContract({ abi, address: predictionMarket, functionName: "claim", args: [note.marketId, cp.amount, cp.nullifier, cp.recipient, cp.proof] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProving(false);
    }
  }

  const feed = market?.feed && market.feed !== "0x0000000000000000000000000000000000000000" ? feedLabel(market.feed) : null;
  const title = feed ? `${feed.asset} ≥ ${usd(market!.threshold)}` : `Market #${note.marketId.toString()}`;
  const sideLbl = market ? outcomeLabel(note.side, market.numOutcomes) : note.side === 1 ? "Yes" : "No";

  return (
    <div className="pos-row">
      <div className="pos-main">
        <div className="pos-head">
          <span className="pos-title">{title}</span>
          <span className="card-id mono">#{note.marketId.toString()}</span>
        </div>
        <div className="pos-tags">
          <span className={`src-chip mono ${note.side === 1 ? "src-graph" : "src-cre"}`} title="Your side — visible only to you">
            your side · {sideLbl}
          </span>
          {market && <span className={`pill ${statusClass(market.status)}`}>{statusLabel(market.status)}</span>}
        </div>
      </div>

      <div className="pos-nums">
        <div className="pos-num">
          <span className="pos-k mono">Stake</span>
          <b>{usdc(note.amount)}</b>
        </div>
        {bucket === "claimable" && (
          <div className="pos-num">
            <span className="pos-k mono">Est. payout</span>
            <b className="tag-yes">{payout !== null ? usdc(payout) : "—"}</b>
          </div>
        )}
        {bucket === "history" && (
          <div className="pos-num">
            <span className="pos-k mono">Result</span>
            <b className={claimed ? "tag-yes" : "tag-no"}>{claimed ? "Claimed ✓" : "Lost"}</b>
          </div>
        )}
        {bucket === "open" && (
          <div className="pos-num">
            <span className="pos-k mono">Status</span>
            <b className="mono muted">sealed</b>
          </div>
        )}
      </div>

      <div className="pos-action">
        {bucket === "claimable" && (
          <button className="btn primary sm" onClick={claim} disabled={proving || isPending || confirming}>
            {proving ? "Proving…" : isPending ? "Confirm…" : confirming ? "Claiming…" : "Prove & claim"}
          </button>
        )}
        {bucket === "open" && (
          <Link className="btn sm ghost" href={`/markets`}>Markets</Link>
        )}
        {isSuccess && hash && (
          <a className="pos-tx mono tag-yes" href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer">tx ↗</a>
        )}
      </div>

      {(status || error) && (
        <p className={`pos-note mono ${error ? "tag-no" : "muted"}`}>{error || status}</p>
      )}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="port-section">
      <div className="port-section-head">
        <h2>{title}</h2>
        <span className="hint">{hint}</span>
      </div>
      <div className="pos-list">{children}</div>
    </section>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="stat">
      <span className="stat-label mono">{label}</span>
      <span className={`stat-value ${accent ? "accent" : ""}`}>{value}</span>
    </div>
  );
}

function NotesTools({ notes, onImported }: { notes: Note[]; onImported: () => void }) {
  const [imp, setImp] = useState("");
  const [msg, setMsg] = useState("");

  function exportAll() {
    const blob = new Blob([JSON.stringify(notes.map((n) => JSON.parse(noteToJson(n))), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "obscura-notes.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function doImport() {
    const ok = importNote(imp.trim());
    setMsg(ok ? "Position restored." : "Couldn't import — check the note JSON (or you already have it).");
    if (ok) {
      setImp("");
      onImported();
    }
  }

  return (
    <section className="port-section">
      <div className="port-section-head">
        <h2>Notes</h2>
        <span className="hint">Positions live in this browser. Back them up — a note is what lets you claim.</span>
      </div>
      <div className="notes-tools">
        <textarea placeholder="Paste a note JSON to restore a position…" value={imp} onChange={(e) => setImp(e.target.value)} rows={3} />
        <div className="notes-actions">
          <button className="btn sm" onClick={doImport} disabled={!imp.trim()}>Import note</button>
          <button className="btn sm ghost" onClick={exportAll} disabled={notes.length === 0}>Export all</button>
          {msg && <span className="hint">{msg}</span>}
        </div>
      </div>
    </section>
  );
}

function EmptyState({ onImported }: { onImported: () => void }) {
  return (
    <div className="panel">
      <div className="form">
        <div className="note">No positions on this network yet.</div>
        <p className="hint">Take a shielded position from the markets, or import a note you saved earlier.</p>
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
          <Link className="btn primary" href="/markets">Browse markets</Link>
        </div>
        <NotesTools notes={[]} onImported={onImported} />
      </div>
    </div>
  );
}
