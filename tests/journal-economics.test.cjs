/**
 * Test: journal-filling economics (calcJournalEconomics in js/calculations.js).
 *
 * While gathering you earn base fame, which passively fills any journal you
 * carry. The loop is: BUY an empty journal → fill it with fame you'd earn
 * anyway → SELL the full journal. So the gatherer's profit per journal is the
 * full journal's net sale minus the empty journal's buy cost:
 *
 *   fullNet           = fullGross × (1 − PREMIUM_TAX)   (you SELL the full one)
 *   marginPerJournal  = fullNet − emptyCost             (empty is a BUY, no tax)
 *   silverPerFame     = marginPerJournal ÷ maxfame      (fame is the constraint)
 *   extraSilverPerHour= silverPerFame × baseFamePerHour (the fame you make/h)
 *
 * Only the sell-side market tax applies to the full journal; the empty journal
 * is bought (no premium tax on a purchase). maxfame = 0 must not divide by zero,
 * and a loss (full sells for less than the empty cost) passes straight through
 * as a negative margin so the renderer can dim it.
 *
 * Black-box / TDD: written before the implementation. Pure input→output, no DOM,
 * no live API.
 *
 * Run: node tests/journal-economics.test.cjs
 */

const assert = require("assert");
const { PREMIUM_TAX, calcJournalEconomics } = require("../js/calculations.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`FAIL  ${name}\n      ${e.message}`); }
}
const approx = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `expected ${b}, got ${a}`);

// ── fixtures ──────────────────────────────────────────────────────────────
// A T8 ore gathering journal: empty ~3,000, full ~30,000, 28,800 fame to fill,
// ~19,000 base fame/hour at T8.
const CASES = [
  {
    name: "profitable journal — margin, silver/fame, extra/hour",
    in: { emptyCost: 3000, fullGross: 30000, maxfame: 28800, baseFamePerHour: 19000 },
  },
  {
    name: "low-tier cheap journal",
    in: { emptyCost: 120, fullGross: 900, maxfame: 450, baseFamePerHour: 4000 },
  },
  {
    name: "loss — full sells below empty cost (negative margin passes through)",
    in: { emptyCost: 5000, fullGross: 3000, maxfame: 7200, baseFamePerHour: 10000 },
  },
];

for (const c of CASES) {
  test(c.name, () => {
    const { emptyCost, fullGross, maxfame, baseFamePerHour } = c.in;
    const r = calcJournalEconomics(c.in);
    const fullNet = fullGross * (1 - PREMIUM_TAX);
    const margin = fullNet - emptyCost;
    approx(r.fullNet, fullNet);
    approx(r.marginPerJournal, margin);
    approx(r.silverPerFame, margin / maxfame);
    approx(r.extraSilverPerHour, (margin / maxfame) * baseFamePerHour);
  });
}

test("the loss case really is negative", () => {
  const r = calcJournalEconomics({ emptyCost: 5000, fullGross: 3000, maxfame: 7200, baseFamePerHour: 10000 });
  assert.ok(r.marginPerJournal < 0, "margin should be negative");
  assert.ok(r.silverPerFame < 0, "silver/fame should be negative");
  assert.ok(r.extraSilverPerHour < 0, "extra/hour should be negative");
});

test("maxfame = 0 → no divide-by-zero, silver/fame and extra/hour are 0", () => {
  const r = calcJournalEconomics({ emptyCost: 100, fullGross: 1000, maxfame: 0, baseFamePerHour: 5000 });
  assert.strictEqual(r.silverPerFame, 0);
  assert.strictEqual(r.extraSilverPerHour, 0);
  assert.ok(Number.isFinite(r.silverPerFame) && Number.isFinite(r.extraSilverPerHour));
});

test("baseFamePerHour = 0 → silver/fame still computed, extra/hour is 0", () => {
  const r = calcJournalEconomics({ emptyCost: 100, fullGross: 1000, maxfame: 1000, baseFamePerHour: 0 });
  approx(r.silverPerFame, (1000 * (1 - PREMIUM_TAX) - 100) / 1000);
  approx(r.extraSilverPerHour, 0);
});

test("missing/zero inputs default safely (no NaN)", () => {
  const r = calcJournalEconomics({});
  Object.values(r).forEach((v) => assert.ok(Number.isFinite(v), "all outputs finite"));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
