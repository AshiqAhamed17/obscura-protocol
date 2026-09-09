//! ZK Forecasting Reputation — prove, anonymously, that your forecasting track
//! record clears a bar: at least `min_correct` correct calls AND an accuracy of
//! at least `accuracy_num / accuracy_den`, without revealing which markets, which
//! bets, or your identity.
//!
//! This is the reputation layer over Proof of Foresight. Each prediction in the
//! batch is a real shielded note, membership-verified against its market's
//! settled commitments root, and scored correct iff it backed that market's
//! resolved outcome. The circuit reveals only a domain-separated *reputation
//! nullifier* — registered once per forecaster so a badge (">=20 correct,
//! >=60% accuracy") is minted a single time and is unlinkable to any payout,
//! foresight, or parlay nullifier.
//!
//! Absolute thresholds only (no percentile / no comparison against other
//! forecasters), by design: a forecaster's badge depends solely on their own
//! record, so it can be proven offline without a global leaderboard oracle.
//!
//! Public input ordering is load-bearing (must match any on-chain registry):
//!   1. min_correct         — required number of correct calls (e.g. 20)
//!   2. accuracy_num         — accuracy threshold numerator   (e.g. 60)
//!   3. accuracy_den         — accuracy threshold denominator (e.g. 100 -> 60%)
//!   4. badge_nullifier       — revealed to the on-chain reputation registry
//!
//! Trust note: the prover chooses which predictions to include, so this proves a
//! *verified lower bound* — "I have >= this many correct calls at >= this
//! accuracy over a set of real, membership-proven predictions." Padding losses
//! in only lowers the proven accuracy, so a forecaster cannot inflate it; the
//! on-chain foresight registry independently bounds unique correct calls.

use obscura::{MERKLE_DEPTH, MerkleProof, Note, reputation_nullifier};

/// Maximum predictions considered in one reputation proof. Fixed so the circuit
/// (and any on-chain verifier) has a constant shape. Inactive slots are padded.
pub global MAX_HISTORY: u32 = 24;

fn main(
    // --- public inputs ---
    min_correct: pub Field,
    accuracy_num: pub Field,
    accuracy_den: pub Field,
    badge_nullifier: pub Field,
    // --- private witness: the batch of predictions ---
    market_ids: [Field; MAX_HISTORY],
    market_roots: [Field; MAX_HISTORY], // each market's settled commitments root
    winning_outcomes: [Field; MAX_HISTORY],
    note_outcomes: [Field; MAX_HISTORY],
    amounts: [Field; MAX_HISTORY],
    secrets: [Field; MAX_HISTORY],
    nullifier_secrets: [Field; MAX_HISTORY],
    active: [Field; MAX_HISTORY], // 1 = counts toward the record, 0 = padding
    path_indices: [[Field; MERKLE_DEPTH]; MAX_HISTORY],
    path_siblings: [[Field; MERKLE_DEPTH]; MAX_HISTORY],
    forecaster_secret: Field,
) {
    let mut total: u32 = 0;
    let mut correct: u32 = 0;

    for i in 0..MAX_HISTORY {
        let is_active = active[i];
        assert((is_active == 0) | (is_active == 1), "active flag must be a bit");

        // Reconstruct the note and recompute the root implied by its path.
        let note = Note {
            market_id: market_ids[i],
            outcome: note_outcomes[i],
            amount: amounts[i],
            secret: secrets[i],
            nullifier_secret: nullifier_secrets[i],
        };
        let proof = MerkleProof { indices: path_indices[i], siblings: path_siblings[i] };
        let computed_root = proof.compute_root(note.commitment());

        // For ACTIVE predictions, the note must be a real member of that market's
        // settled tree. `is_active * (computed - root) == 0` enforces equality
        // only when active, so padding slots need no valid path.
        assert(is_active * (computed_root - market_roots[i]) == 0, "membership failed for an active prediction");

        let active_u = is_active as u32;
        total += active_u;
        // Correct iff the pick equalled the market's resolved outcome. Counted
        // only for active predictions.
        let is_correct = (note_outcomes[i] == winning_outcomes[i]) as u32;
        correct += active_u * is_correct;
    }

    // (1) at least one prediction, and (2) the absolute count threshold.
    assert(total >= 1, "no active predictions");
    assert(correct >= (min_correct as u32), "correct calls below the required count");

    // (3) accuracy: correct / total >= accuracy_num / accuracy_den, as an integer
    //     cross-multiplication to avoid division. u64 headroom for the products.
    let lhs = (correct as u64) * (accuracy_den as u64);
    let rhs = (accuracy_num as u64) * (total as u64);
    assert(lhs >= rhs, "accuracy below the required threshold");

    // (4) bind the reputation nullifier to the forecaster's secret, so the badge
    //     registers once and is unlinkable to any other nullifier.
    assert(reputation_nullifier(forecaster_secret) == badge_nullifier, "reputation nullifier mismatch");
}

// --- tests -----------------------------------------------------------------

global FORECASTER_SECRET: Field = 0xf0f0f0;

/// Builds a batch of `num_correct` correct + `num_wrong` wrong predictions (rest
/// padding), each a real membership-valid note. Correct picks back outcome 1
/// (the winner); wrong picks back outcome 0.
fn build_batch(
    num_correct: u32,
    num_wrong: u32,
) -> ([Field; MAX_HISTORY], [Field; MAX_HISTORY], [Field; MAX_HISTORY], [Field; MAX_HISTORY], [Field; MAX_HISTORY], [Field; MAX_HISTORY], [Field; MAX_HISTORY], [Field; MAX_HISTORY], [[Field; MERKLE_DEPTH]; MAX_HISTORY], [[Field; MERKLE_DEPTH]; MAX_HISTORY]) {
    let mut market_ids = [0; MAX_HISTORY];
    let mut market_roots = [0; MAX_HISTORY];
    let mut winning_outcomes = [0; MAX_HISTORY];
    let mut note_outcomes = [0; MAX_HISTORY];
    let mut amounts = [0; MAX_HISTORY];
    let mut secrets = [0; MAX_HISTORY];
    let mut nullifier_secrets = [0; MAX_HISTORY];
    let mut active = [0; MAX_HISTORY];
    let mut path_indices = [[0; MERKLE_DEPTH]; MAX_HISTORY];
    let mut path_siblings = [[0; MERKLE_DEPTH]; MAX_HISTORY];

    let indices = [0; MERKLE_DEPTH];
    let mut siblings = [0; MERKLE_DEPTH];
    for j in 0..MERKLE_DEPTH {
        siblings[j] = (j as Field) + 1;
    }

    for i in 0..MAX_HISTORY {
        let iu = i as u32;
        let is_active = iu < (num_correct + num_wrong);
        let is_correct = iu < num_correct;

        market_ids[i] = (i as Field) + 1;
        winning_outcomes[i] = 1;
        note_outcomes[i] = if is_correct { 1 } else { 0 };
        amounts[i] = 1000;
        secrets[i] = (i as Field) + 100;
        nullifier_secrets[i] = (i as Field) + 200;
        active[i] = if is_active { 1 } else { 0 };
        path_indices[i] = indices;
        path_siblings[i] = siblings;

        let note = Note {
            market_id: market_ids[i],
            outcome: note_outcomes[i],
            amount: amounts[i],
            secret: secrets[i],
            nullifier_secret: nullifier_secrets[i],
        };
        let proof = MerkleProof { indices, siblings };
        market_roots[i] = proof.compute_root(note.commitment());
    }

    (
        market_ids, market_roots, winning_outcomes, note_outcomes, amounts, secrets, nullifier_secrets,
        active, path_indices, path_siblings,
    )
}

fn rep_nullifier() -> Field {
    reputation_nullifier(FORECASTER_SECRET)
}

#[test]
fn qualifying_record_passes() {
    // 22 correct + 2 wrong = 24 active. correct 22 >= 20; accuracy 22/24 >= 60%.
    let (mids, roots, wins, outs, amts, secs, nss, act, pidx, psib) = build_batch(22, 2);
    main(20, 60, 100, rep_nullifier(), mids, roots, wins, outs, amts, secs, nss, act, pidx, psib, FORECASTER_SECRET);
}

#[test(should_fail_with = "correct calls below the required count")]
fn below_count_threshold_fails() {
    // Only 18 correct: fails the min_correct = 20 bar regardless of accuracy.
    let (mids, roots, wins, outs, amts, secs, nss, act, pidx, psib) = build_batch(18, 2);
    main(20, 60, 100, rep_nullifier(), mids, roots, wins, outs, amts, secs, nss, act, pidx, psib, FORECASTER_SECRET);
}

#[test(should_fail_with = "accuracy below the required threshold")]
fn below_accuracy_threshold_fails() {
    // 12 correct + 12 wrong = 24 active. correct 12 >= min 10 (count OK), but
    // accuracy 12/24 = 50% < 60% -> fails the accuracy bar.
    let (mids, roots, wins, outs, amts, secs, nss, act, pidx, psib) = build_batch(12, 12);
    main(10, 60, 100, rep_nullifier(), mids, roots, wins, outs, amts, secs, nss, act, pidx, psib, FORECASTER_SECRET);
}

#[test]
fn exact_thresholds_pass() {
    // Boundary: 20 correct + 0 wrong. correct 20 >= 20; accuracy 20/20 = 100%.
    let (mids, roots, wins, outs, amts, secs, nss, act, pidx, psib) = build_batch(20, 0);
    main(20, 60, 100, rep_nullifier(), mids, roots, wins, outs, amts, secs, nss, act, pidx, psib, FORECASTER_SECRET);
}

#[test(should_fail_with = "reputation nullifier mismatch")]
fn wrong_reputation_nullifier_fails() {
    let (mids, roots, wins, outs, amts, secs, nss, act, pidx, psib) = build_batch(22, 2);
    main(20, 60, 100, rep_nullifier() + 1, mids, roots, wins, outs, amts, secs, nss, act, pidx, psib, FORECASTER_SECRET);
}

#[test(should_fail_with = "membership failed for an active prediction")]
fn tampered_membership_fails() {
    // Corrupt one active prediction's root: it is no longer a real member.
    let (mids, mut roots, wins, outs, amts, secs, nss, act, pidx, psib) = build_batch(22, 2);
    roots[0] = roots[0] + 1;
    main(20, 60, 100, rep_nullifier(), mids, roots, wins, outs, amts, secs, nss, act, pidx, psib, FORECASTER_SECRET);
}
