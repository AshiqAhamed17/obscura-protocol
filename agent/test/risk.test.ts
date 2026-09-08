import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessRisk,
  computeConcentration,
  computeSolvency,
  type MarketRow,
} from "../src/risk.js";

function mkt(
  id: string,
  status: string,
  dep: bigint,
  claimed = 0n,
  yes: bigint | null = null,
  no: bigint | null = null,
): MarketRow {
  return { marketId: id, status, totalDeposited: dep, totalClaimed: claimed, totalYes: yes, totalNo: no };
}

test("solvency: no settled obligations => SOLVENT, null coverage", () => {
  const r = computeSolvency(1000n, 0n, [mkt("0", "Open", 1000n)]);
  assert.equal(r.verdict, "SOLVENT");
  assert.equal(r.settledObligations, 0n);
  assert.equal(r.coverageRatio, null);
  assert.equal(r.backedFunds, 1000n);
});

test("solvency: settled + fully covered => SOLVENT", () => {
  // pool = 60+40 = 100 owed, 30 already claimed => 70 obligation; escrow 100-30=70 => 1.0x
  const r = computeSolvency(100n, 30n, [mkt("1", "Settled", 100n, 30n, 60n, 40n)]);
  assert.equal(r.verdict, "SOLVENT");
  assert.equal(r.settledObligations, 70n);
  assert.equal(r.coverageRatio, 1);
});

test("solvency: under-covered => INSOLVENT", () => {
  // obligation 100, escrow only 50 => 0.5x
  const r = computeSolvency(150n, 100n, [mkt("2", "Settled", 100n, 0n, 100n, 0n)]);
  assert.equal(r.verdict, "INSOLVENT");
  assert.equal(r.coverageRatio, 0.5);
});

test("solvency: negative escrow => INSOLVENT", () => {
  const r = computeSolvency(100n, 150n, []);
  assert.equal(r.verdict, "INSOLVENT");
  assert.equal(r.backedFunds, -50n);
});

test("concentration: single funded market => HHI 1, HIGHLY_CONCENTRATED", () => {
  const r = computeConcentration([mkt("0", "Open", 1000n), mkt("1", "Open", 0n)]);
  assert.equal(r.hhi, 1);
  assert.equal(r.verdict, "HIGHLY_CONCENTRATED");
  assert.equal(r.topMarketId, "0");
  assert.equal(r.topShare, 1);
  assert.equal(r.activeMarketCount, 1);
});

test("concentration: two equal markets => HHI 0.5, CONCENTRATED", () => {
  const r = computeConcentration([mkt("0", "Open", 500n), mkt("1", "Open", 500n)]);
  assert.equal(r.hhi, 0.5);
  assert.equal(r.verdict, "CONCENTRATED");
});

test("concentration: four equal markets => HHI 0.25, MODERATE", () => {
  const r = computeConcentration([
    mkt("0", "Open", 25n),
    mkt("1", "Open", 25n),
    mkt("2", "Open", 25n),
    mkt("3", "Open", 25n),
  ]);
  assert.equal(r.hhi, 0.25);
  assert.equal(r.verdict, "MODERATE");
});

test("concentration: no deposits => EMPTY", () => {
  const r = computeConcentration([mkt("0", "Open", 0n)]);
  assert.equal(r.verdict, "EMPTY");
  assert.equal(r.activeMarketCount, 0);
});

test("assessRisk: solvent + highly concentrated => ELEVATED (the current live shape)", () => {
  const r = assessRisk(1000n, 0n, [mkt("0", "Open", 1000n), mkt("1", "Open", 0n)]);
  assert.equal(r.solvency.verdict, "SOLVENT");
  assert.equal(r.concentration.verdict, "HIGHLY_CONCENTRATED");
  assert.equal(r.overallRisk, "ELEVATED");
});

test("assessRisk: insolvent => CRITICAL regardless of concentration", () => {
  const r = assessRisk(100n, 150n, [mkt("0", "Settled", 100n, 150n, 100n, 0n)]);
  assert.equal(r.overallRisk, "CRITICAL");
});
