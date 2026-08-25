export function Features() {
  return (
    <section className="band wrap" id="features">
      <div className="kicker">
        <b>The protocol</b> — five guarantees
      </div>
      <div className="landing-h2">Everything hidden. Nothing unaccounted&nbsp;for.</div>
      <div className="bento">
        <article className="feat wide">
          <div className="n">01 — SHIELDED POSITIONS</div>
          <h3>Your side never touches the chain</h3>
          <p>
            A bet becomes a Poseidon commitment. Only its fingerprint is stored — the Yes/No side,
            and the link back to you, stay hidden. Two identical bets look nothing alike.
          </p>
          <div className="isomark" aria-hidden>
            <span className="tile t1" />
            <span className="tile t2" />
            <span className="tile t3" />
          </div>
        </article>
        <article className="feat reg">
          <div className="n">02 — PROVEN SOLVENCY</div>
          <h3>The pool proves it can pay</h3>
          <p>
            Before any payout, an SP1 zkVM proves the totals are correct and the book is solvent —
            computed from every note, revealing none.
          </p>
        </article>
        <article className="feat third">
          <div className="n">03 — NO TRUSTED OPERATOR</div>
          <h3>Permissionless settlement</h3>
          <p>Anyone can submit the settlement proof. No admin posts the numbers; the proof is the only authority.</p>
        </article>
        <article className="feat third">
          <div className="n">04 — UNLINKABLE CLAIMS</div>
          <h3>Payouts can&apos;t be traced</h3>
          <p>Winners withdraw with a proof and a one-time nullifier — no double-claims, and no link from payout to deposit.</p>
        </article>
        <article className="feat third">
          <div className="n">05 — REAL RESOLUTION</div>
          <h3>Chainlink decides outcomes</h3>
          <p>Markets resolve against a live price feed with a staleness guard — deterministic, no discretionary verdict.</p>
        </article>
      </div>
    </section>
  );
}
