"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { abi, PREDICTION_MARKET, type Market } from "@/lib/contract";
import { commitment, loadNotes, nullifier, storedToNote, type Note } from "@/lib/note";
import { generateClaimProof } from "@/lib/prove";
import { eth, sideLabel, statusLabel, usd } from "@/lib/format";

export default function ClaimPage() {
  const { address, isConnected } = useAccount();
  const [notes, setNotes] = useState<Note[]>([]);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    setNotes(loadNotes().map(storedToNote));
  }, []);

  return (
    <main className="wrap page">
      <h1>Claim your winnings</h1>
      <p className="lead">
        Prove you hold a winning note without revealing which deposit it is. The proof is generated
        in your browser and the payout goes to a recipient bound into it, so the claim can&apos;t be
        front-run.
      </p>

      {!isConnected && <div className="panel"><div className="note">Connect your wallet to claim.</div></div>}
      {isConnected && notes.length === 0 && (
        <div className="panel">
          <div className="note">No saved notes in this browser. Deposit first, or restore a note.</div>
        </div>
      )}

      {isConnected && notes.length > 0 && (
        <div className="panel">
          <div className="form">
            <div className="field">
              <label>Your notes</label>
              <select value={selected} onChange={(e) => setSelected(Number(e.target.value))}>
                {notes.map((n, i) => (
                  <option key={i} value={i}>
                    Market #{n.marketId.toString()} · {sideLabel(n.side)} · {eth(n.amount)}
                  </option>
                ))}
              </select>
            </div>
            <ClaimForm note={notes[selected]} recipient={address as `0x${string}`} />
          </div>
        </div>
      )}
    </main>
  );
}

function ClaimForm({ note, recipient }: { note: Note; recipient: `0x${string}` }) {
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [proving, setProving] = useState(false);
  const [payoutAddr, setPayoutAddr] = useState<string>(recipient);

  const { data: marketData } = useReadContract({
    abi,
    address: PREDICTION_MARKET,
    functionName: "markets",
    args: [note.marketId],
  });
  const { data: leavesData } = useReadContract({
    abi,
    address: PREDICTION_MARKET,
    functionName: "getCommitments",
    args: [note.marketId],
  });
  const nul = useMemo(() => nullifier(note), [note]);
  const { data: spent } = useReadContract({
    abi,
    address: PREDICTION_MARKET,
    functionName: "nullifierSpent",
    args: [nul],
  });

  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const market = marketData as unknown as Market | undefined;
  const marketStatus = market ? Number(market[4]) : undefined;
  const winningSide = market ? Number(market[5]) : undefined;
  const leaves = (leavesData as readonly `0x${string}`[] | undefined) ?? [];

  const isSettled = marketStatus === 2;
  const onWinningSide = winningSide !== undefined && note.side === winningSide;
  const alreadySpent = spent === true;

  async function claim() {
    setError("");
    setStatus("");
    try {
      const leafIndex = leaves.findIndex((c) => c.toLowerCase() === commitment(note).toLowerCase());
      if (leafIndex < 0) throw new Error("This note's commitment isn't in the market tree.");

      setProving(true);
      setStatus("Generating proof in your browser (this can take tens of seconds)…");
      const cp = await generateClaimProof({
        note,
        winningSide: winningSide!,
        leaves: leaves.map((c) => BigInt(c)),
        leafIndex,
        recipient: payoutAddr as `0x${string}`,
      });

      if (market && cp.computedRoot.toLowerCase() !== market[8].toLowerCase()) {
        throw new Error("Reconstructed root doesn't match the on-chain root — is the market fully settled?");
      }

      setStatus("Submitting claim…");
      writeContract({
        abi,
        address: PREDICTION_MARKET,
        functionName: "claim",
        args: [note.marketId, cp.amount, cp.nullifier, cp.recipient, cp.proof],
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProving(false);
    }
  }

  const disabled = !isSettled || !onWinningSide || alreadySpent || proving || isPending || confirming;

  return (
    <>
      <div className="field">
        <label>Payout recipient (bound into the proof)</label>
        <input value={payoutAddr} onChange={(e) => setPayoutAddr(e.target.value)} />
      </div>

      <div className="note">
        Market #{note.marketId.toString()}: {market ? statusLabel(marketStatus!) : "…"}
        {market && ` · ETH ≥ ${usd(market[1])}`}
        {isSettled && ` · winning side: ${sideLabel(winningSide!)}`}
      </div>

      {market && !isSettled && (
        <div className="note err">
          Not claimable yet — the market must be settled (an SP1 proof posted its totals + root).
        </div>
      )}
      {isSettled && !onWinningSide && (
        <div className="note err">This note is on the losing side.</div>
      )}
      {alreadySpent && <div className="note err">This note has already been claimed.</div>}
      {status && <div className="note">{status}</div>}
      {error && <div className="note err">{error}</div>}
      {isSuccess && (
        <div className="note ok">
          Claim confirmed — payout sent to {payoutAddr.slice(0, 6)}…{payoutAddr.slice(-4)}.{" "}
          {hash && (
            <a href={`https://sepolia.etherscan.io/tx/${hash}`} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
              View tx ↗
            </a>
          )}
        </div>
      )}

      <button className="btn primary" onClick={claim} disabled={disabled}>
        {proving ? "Proving…" : isPending ? "Confirm in wallet…" : confirming ? "Claiming…" : "Prove & claim"}
      </button>
    </>
  );
}
