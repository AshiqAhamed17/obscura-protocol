"use client";

import { useState } from "react";

export function ProofSection() {
  const [state, setState] = useState<"idle" | "verifying" | "done">("idle");

  function verify() {
    if (state !== "idle") return;
    setState("verifying");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(() => setState("done"), reduce ? 0 : 900);
  }

  const done = state === "done";

  return (
    <section className="band wrap" id="proof">
      <div className="kicker">
        <b>The differentiator</b> — verify, don&apos;t trust
      </div>
      <div className="landing-h2">The totals stay hidden until the proof checks out.</div>
      <p className="lede">
        Other markets ask you to trust that the pool adds up. Obscura settles a batch of markets with
        one zkVM proof. Until it verifies, the numbers are dark.
      </p>
      <div className="proofline">
        <div>
          <div className={`totals ${done ? "done" : ""}`}>
            {done ? (
              <>
                Yes <span className="val">6.20</span> · No <span className="val">5.40</span> ETH ·{" "}
                <span className="val">3 markets</span>
              </>
            ) : (
              <>
                Yes <span className="veiled">████</span> · No <span className="veiled">████</span> ETH ·{" "}
                <span className="veiled">3 markets</span>
              </>
            )}
          </div>
          <div className={`pmeta ${done ? "done" : ""}`}>
            {done ? (
              <>
                <b>Proof verified ✓</b> · totals proven solvent · no operator trusted
              </>
            ) : (
              "Batch awaiting settlement · totals sealed inside the proof"
            )}
          </div>
        </div>
        <button className="verify" onClick={verify} disabled={state !== "idle"}>
          {state === "idle" ? "Verify settlement proof" : state === "verifying" ? "Verifying…" : "Verified ✓"}
        </button>
      </div>
    </section>
  );
}
