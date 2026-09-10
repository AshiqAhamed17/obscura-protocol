"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
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
  feedLabel,
  foresightRegistryAbi,
  parseMarket,
  type MarketTuple,
} from "@/lib/contract";
import { commitment, foresightNullifier, loadNotes, storedToNote, type Note } from "@/lib/note";
import { generateForesightProof } from "@/lib/prove";
import { outcomeLabel, usd } from "@/lib/format";
import { AmbientField } from "@/components/AmbientField";

export default function ReputationPage() {
  return (
    <>
      <AmbientField />
      <main className="wrap page">
        <p className="eyebrow">Proof of Foresight · Sepolia</p>
        <h1>Foresight &amp; reputation</h1>
        <p className="lead">
          After a market settles, prove in zero knowledge that you called it right — without revealing
          which deposit it was or how much you staked. Each correct call registers an anonymous,
          domain-separated credential, building a verifiable forecasting track record that&apos;s
          unlinkable to your payout.
        </p>
        <Inner />
      </main>
    </>
  );
}

function Inner() {
  const chainId = useChainId();
  const { foresightRegistry } = contractsFor(chainId);
  const { isConnected } = useAccount();
  const [tab, setTab] = useState<"prove" | "record">("prove");
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    setNotes(
      loadNotes()
        .filter((n) => (n.chainId ?? 11155111) === chainId)
        .map(storedToNote),
    );
  }, [chainId]);

  if (!foresightRegistry) {
    return (
      <div className="panel" style={{ maxWidth: 620 }}>
        <div className="note">
          The foresight registry is live on <b>Sepolia</b>. Switch your wallet to Sepolia to prove
          foresight. <Link href="/markets">Browse markets ↗</Link>
        </div>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="panel" style={{ maxWidth: 620 }}>
        <div className="note">Connect your wallet to prove foresight from your saved notes.</div>
      </div>
    );
  }

  if (notes.length === 0) {
    return (
      <div className="panel" style={{ maxWidth: 620 }}>
        <div className="note">
          No saved notes on this network. <Link href="/markets">Take a position</Link>, and once its
          market settles you can prove you called it.
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="seg">
        <button className={tab === "prove" ? "on" : ""} onClick={() => setTab("prove")}>
          Prove a call
        </button>
        <button className={tab === "record" ? "on" : ""} onClick={() => setTab("record")}>
          My track record
        </button>
      </div>
      {tab === "prove" ? (
        <div className="pos-list">
          {notes.map((n, i) => (
            <ForesightRow key={i} note={n} registry={foresightRegistry} />
          ))}
        </div>
      ) : (
        <TrackRecord notes={notes} registry={foresightRegistry} />
      )}
    </>
  );
}

/// One saved note → its settled-market state + a "prove I called it" action.
function ForesightRow({ note, registry }: { note: Note; registry: `0x${string}` }) {
  const chainId = useChainId();
  const { predictionMarket, explorer } = contractsFor(chainId);

  const { data: marketData } = useReadContract({ abi, address: predictionMarket, functionName: "markets", args: [note.marketId] });
  const { data: leavesData } = useReadContract({ abi, address: predictionMarket, functionName: "getCommitments", args: [note.marketId] });
  const fNul = useMemo(() => foresightNullifier(note), [note]);
  const { data: proven, refetch: refetchProven } = useReadContract({ abi: foresightRegistryAbi, address: registry, functionName: "foresightProven", args: [fNul] });
  const { data: count } = useReadContract({ abi: foresightRegistryAbi, address: registry, functionName: "foresightCount", args: [note.marketId] });

  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [proving, setProving] = useState(false);
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });
  useEffect(() => {
    if (isSuccess) refetchProven();
  }, [isSuccess, refetchProven]);

  const market = marketData ? parseMarket(marketData as unknown as MarketTuple) : undefined;
  const leaves = (leavesData as readonly `0x${string}`[] | undefined) ?? [];
  const isSettled = market?.status === 2;
  const winningOutcome = market?.winningOutcome;
  const calledIt = winningOutcome !== undefined && note.side === winningOutcome;
  const alreadyProven = proven === true;
  const feed = market && market.feed !== "0x0000000000000000000000000000000000000000" ? feedLabel(market.feed) : null;

  async function prove() {
    setError("");
    setStatus("");
    try {
      const leafIndex = leaves.findIndex((c) => c.toLowerCase() === commitment(note).toLowerCase());
      if (leafIndex < 0) throw new Error("This note's commitment isn't in the market tree.");
      setProving(true);
      setStatus("Generating foresight proof in your browser (tens of seconds)…");
      const fp = await generateForesightProof({
        note,
        winningOutcome: winningOutcome!,
        leaves: leaves.map((c) => BigInt(c)),
        leafIndex,
      });
      if (market && fp.computedRoot.toLowerCase() !== market.merkleRoot.toLowerCase()) {
        throw new Error("Reconstructed root doesn't match the on-chain root — is the market fully settled?");
      }
      setStatus("Registering your credential…");
      writeContract({
        abi: foresightRegistryAbi,
        address: registry,
        functionName: "proveForesight",
        args: [note.marketId, fp.foresightNullifier, fp.proof],
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProving(false);
    }
  }

  return (
    <div className="pos-row" style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1.3fr) auto" }}>
      <div>
        <div className="pos-head">
          <span className="pos-title">Market #{note.marketId.toString()}</span>
        </div>
        <div className="pos-tags">
          <span className="pk-leg-tag mono">your call · {outcomeLabel(note.side, market?.numOutcomes ?? 2)}</span>
          {feed && <span className="pk-leg-tag mono">{feed.asset} ≥ {usd(market!.threshold)}</span>}
        </div>
      </div>

      <div className="pos-nums">
        <div className="pos-num">
          <span className="pos-k">Status</span>
          <b>{!market ? "…" : isSettled ? "settled" : "open"}</b>
        </div>
        <div className="pos-num">
          <span className="pos-k">Credentials</span>
          <b>{count !== undefined ? Number(count) : "—"}</b>
        </div>
      </div>

      <div className="pos-action">
        {alreadyProven ? (
          <span className="pk-bucket warn">credential registered</span>
        ) : isSuccess ? (
          <span className="pk-bucket warn">
            registered{" "}
            {hash && <a href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer">↗</a>}
          </span>
        ) : (
          <button
            className="btn primary"
            onClick={prove}
            disabled={!isSettled || !calledIt || proving || isPending || confirming}
          >
            {proving ? "Proving…" : isPending ? "Confirm…" : confirming ? "Registering…" : "Prove I called it"}
          </button>
        )}
      </div>

      {market && !isSettled && <p className="pos-note muted">Not provable yet — the market must be settled first.</p>}
      {isSettled && !calledIt && <p className="pos-note muted">This note backed the losing outcome, so there&apos;s nothing to prove.</p>}
      {status && <p className="pos-note">{status}</p>}
      {error && <p className="pos-note err">{error}</p>}
    </div>
  );
}

/// The forecaster's own verified record, derived from real on-chain settlement +
/// their local notes. The ZK reputation badge clears the same bar in one proof.
function TrackRecord({ notes, registry }: { notes: Note[]; registry: `0x${string}` }) {
  const chainId = useChainId();
  const { predictionMarket } = contractsFor(chainId);
  void registry;

  // Read each note's market to classify settled/correct. One hook per note is
  // fine here (a forecaster's saved set is small).
  const records = notes.map((n) => <Classifier key={n.secret.toString()} note={n} market={predictionMarket} />);

  // We aggregate via a shared store the Classifiers write into.
  const [tally, setTally] = useState<Record<string, "correct" | "wrong" | "open">>({});
  const settled = Object.values(tally).filter((v) => v !== "open");
  const correct = settled.filter((v) => v === "correct").length;
  const total = settled.length;
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

  // Badge thresholds mirror the reputation circuit's default bar.
  const MIN_CORRECT = 3;
  const MIN_ACCURACY = 60;
  const earned = correct >= MIN_CORRECT && accuracy >= MIN_ACCURACY;

  return (
    <TallyContext.Provider value={setTally}>
      <div style={{ display: "none" }}>{records}</div>

      <div className="port-summary">
        <div className="port-stat">
          <span className="port-stat-k mono">Correct calls</span>
          <span className="port-stat-v">{correct}</span>
        </div>
        <div className="port-stat">
          <span className="port-stat-k mono">Settled calls</span>
          <span className="port-stat-v">{total}</span>
        </div>
        <div className="port-stat">
          <span className="port-stat-k mono">Accuracy</span>
          <span className="port-stat-v">{total > 0 ? `${accuracy}%` : "—"}</span>
        </div>
      </div>

      <div className={`rep-badge ${earned ? "earned" : ""}`}>
        <div className="rep-badge-mark">◆</div>
        <div>
          <div className="rep-badge-title">
            {earned ? "Forecaster badge earned" : "Badge locked"}
          </div>
          <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
            The reputation circuit proves <b>≥{MIN_CORRECT} correct calls</b> at{" "}
            <b>≥{MIN_ACCURACY}% accuracy</b> over a batch of real, membership-proven predictions —
            revealing only a one-time badge nullifier, unlinkable to any market, payout, or foresight
            credential. Your record above {earned ? "clears" : "does not yet clear"} that bar
            {total === 0 ? " (no settled calls yet)" : ""}.
          </p>
        </div>
      </div>

      <div className="panel" style={{ marginTop: "1.2rem" }}>
        <p className="aside-eyebrow">How the badge stays anonymous</p>
        <p className="muted" style={{ lineHeight: 1.6 }}>
          Each prediction in the proof is a shielded note, membership-verified against its market&apos;s
          settled root and scored correct only if it backed the resolved outcome. Padding losses in can
          only lower the proven accuracy, so the badge is a verified lower bound — never inflatable. The
          on-chain foresight registry independently bounds unique correct calls.
        </p>
      </div>
    </TallyContext.Provider>
  );
}

const TallyContext = createContext<((fn: (prev: Record<string, "correct" | "wrong" | "open">) => Record<string, "correct" | "wrong" | "open">) => void) | null>(null);

function Classifier({ note, market }: { note: Note; market: `0x${string}` }) {
  const setTally = useContext(TallyContext);
  const { data } = useReadContract({ abi, address: market, functionName: "markets", args: [note.marketId] });
  const m = data ? parseMarket(data as unknown as MarketTuple) : undefined;
  const key = note.secret.toString();
  useEffect(() => {
    if (!setTally || !m) return;
    const verdict = m.status !== 2 ? "open" : note.side === m.winningOutcome ? "correct" : "wrong";
    setTally((prev) => (prev[key] === verdict ? prev : { ...prev, [key]: verdict }));
  }, [m, note.side, key, setTally]);
  return null;
}
