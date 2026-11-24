/**
 * Test: a breeding cycle is worth the offspring it returns.
 *
 * A cycle used to be priced as `sell - inputs`, which values the baby the cycle
 * hands back at zero. That is most of the play: a T3 horse returns a baby 84% of
 * the time before a single focus point is spent, and nurturing lifts a common
 * animal's chance PAST 100% - the slice above 100 is an occasional second baby,
 * which the old `Math.min(1, ...)` cap threw away.
 *
 * The model this pins:
 *
 *   offspringValue  = max(babyBuyPrice, baseCycleProfit)   <- unchanged valuation
 *   chance          = baseOffspring + (useFocus ? nurtureGain : 0)   <- UNCAPPED
 *   profit          = baseCycleProfit + chance * offspringValue
 *   nurtureEv       = baseCycleProfit + (base + gain) * offspringValue
 *                     (the focus-ON twin: what nurturing would make this cycle
 *                      worth, whatever the checkbox says)
 *
 * The offspring value is deliberately measured against the BASE cycle profit,
 * never against the offspring-inclusive profit - otherwise the definition feeds
 * on itself and one baby prices the next.
 *
 * Separately: Sil/Focus stays MARGINAL (what the focus alone buys - the gain
 * slice only) and must not move because Profit now carries the base slice. That
 * invariant lives in tests/breeding-nurture-silver-focus-toggle.test.cjs.
 *
 * Black-box mirror of js/render-mounts.js breedingRowFor. Simulated numbers only.
 *
 * Run: node tests/breeding-offspring-revenue.test.cjs
 */

const assert = require("assert");

// -- Mirror of the row math under test --------------------------------------
function cycle({ useFocus, baseProfit, babyPrice, baseOffspring, nurtureGain, maxNurtures = 1 }) {
  const offspringValue = Math.max(babyPrice, baseProfit);
  const chance = baseOffspring + (useFocus ? nurtureGain : 0);
  const revenue = offspringValue > 0 ? chance * offspringValue : 0;
  const profit = baseProfit + revenue;
  const nurtureEv = (baseProfit > 0 && maxNurtures > 0)
    ? baseProfit + (baseOffspring + nurtureGain) * offspringValue
    : profit;
  return { offspringValue, chance, offspringRevenue: revenue, profit, nurtureEv };
}

// -- The uncapped total chance, mirroring getBreedingMeta -------------------
function totalChance({ baseOffspring, maxCycles, bonusPerCycle }) {
  return baseOffspring + maxCycles * bonusPerCycle;
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

console.log("\n=== Breeding: offspring chance is revenue ===");

// Fixtures mirror js/data-mounts.js BREEDING_NURTURE_DATA.
const T3_HORSE = { baseOffspring: 0.84, nurtureGain: 0.20, maxNurtures: 1 };     // 1 x 0.2000
const T5_HORSE = { baseOffspring: 0.7867, nurtureGain: 0.2667, maxNurtures: 3 }; // 3 x 0.0889
const T8_ELITE = { baseOffspring: 0, nurtureGain: 0.15, maxNurtures: 6 };        // rare line, 6 x 2.5%

// -- 1. The base chance is worth money with focus OFF -----------------------
test("focus off: profit carries the BASE offspring chance", () => {
  const r = cycle({ useFocus: false, baseProfit: 100_000, babyPrice: 60_000, ...T3_HORSE });
  // value = max(60_000, 100_000) = 100_000; 0.84 x 100_000 = 84_000
  assert.ok(near(r.profit, 184_000), `expected 184,000, got ${r.profit}`);
});

test("focus off: an offspring-free line adds nothing", () => {
  const r = cycle({ useFocus: false, baseProfit: 100_000, babyPrice: 60_000, ...T8_ELITE });
  assert.strictEqual(r.profit, 100_000);
});

// -- 2. Focus adds the nurture slice on top of the base ---------------------
test("focus on: profit carries base + nurture", () => {
  const r = cycle({ useFocus: true, baseProfit: 100_000, babyPrice: 60_000, ...T3_HORSE });
  // chance 1.04 x 100_000 = 104_000
  assert.ok(near(r.chance, 1.04), `expected chance 1.04, got ${r.chance}`);
  assert.ok(near(r.profit, 204_000), `expected 204,000, got ${r.profit}`);
});

test("the focus delta is exactly the nurture gain x offspring value", () => {
  const on = cycle({ useFocus: true, baseProfit: 100_000, babyPrice: 60_000, ...T5_HORSE });
  const off = cycle({ useFocus: false, baseProfit: 100_000, babyPrice: 60_000, ...T5_HORSE });
  assert.ok(near(on.profit - off.profit, T5_HORSE.nurtureGain * 100_000));
});

// -- 3. The 100% cap is gone ------------------------------------------------
test("a common animal's total chance is NOT clamped at 100%", () => {
  assert.ok(near(totalChance({ baseOffspring: 0.84, maxCycles: 1, bonusPerCycle: 0.2 }), 1.04));
  assert.ok(near(totalChance({ baseOffspring: 0.7867, maxCycles: 3, bonusPerCycle: 0.0889 }), 1.0534));
  assert.ok(near(totalChance({ baseOffspring: 0.9333, maxCycles: 1, bonusPerCycle: 0.1333 }), 1.0666));
});

test("the nurture gain is the whole ladder, not what fits under 100%", () => {
  // Old behaviour clipped the T5 horse's gain to 21.33 points (1 - 0.7867).
  assert.ok(near(T5_HORSE.nurtureGain, 3 * 0.0889));
  const r = cycle({ useFocus: true, baseProfit: 200_000, babyPrice: 10_000, ...T5_HORSE });
  assert.ok(near(r.chance, 1.0534), `expected 1.0534, got ${r.chance}`);
});

test("a chance over 100% pays more than one whole baby", () => {
  const r = cycle({ useFocus: true, baseProfit: 100_000, babyPrice: 100_000, ...T3_HORSE });
  assert.ok(r.offspringRevenue > r.offspringValue,
    `${r.offspringRevenue} should exceed one baby (${r.offspringValue})`);
});

// -- 4. Valuation source: baby price vs another cycle -----------------------
const valuationCases = [
  ["baby price wins when it beats the cycle margin", 50_000, 75_000, 75_000],
  ["cycle margin wins when it beats the baby price", 150_000, 75_000, 150_000],
  ["equal - same either way", 80_000, 80_000, 80_000],
];
for (const [label, baseProfit, babyPrice, expected] of valuationCases) {
  test(`offspring valuation: ${label}`, () => {
    const r = cycle({ useFocus: true, baseProfit, babyPrice, ...T5_HORSE });
    assert.strictEqual(r.offspringValue, expected);
  });
}

test("the offspring is valued against the BASE profit, never the inclusive one", () => {
  // If the inclusive profit fed the valuation, one baby would price the next and
  // the row would inflate without limit.
  const r = cycle({ useFocus: true, baseProfit: 100_000, babyPrice: 10_000, ...T3_HORSE });
  assert.strictEqual(r.offspringValue, 100_000);
  assert.ok(r.profit < 100_000 * 3, "offspring valuation must not compound");
});

// -- 5. Loss-making cycles --------------------------------------------------
test("a loss-making cycle still credits the baby at its BUY price", () => {
  // The baby comes back whether or not the sale was profitable, and it is worth
  // what one costs - nothing about a bad sell price makes the animal worthless.
  const r = cycle({ useFocus: true, baseProfit: -50_000, babyPrice: 80_000, ...T3_HORSE });
  assert.strictEqual(r.offspringValue, 80_000);
  assert.ok(near(r.profit, -50_000 + 1.04 * 80_000));
});

test("nothing to value (no baby price, no margin) - profit unchanged", () => {
  const r = cycle({ useFocus: true, baseProfit: -50_000, babyPrice: 0, ...T3_HORSE });
  assert.strictEqual(r.offspringRevenue, 0);
  assert.strictEqual(r.profit, -50_000);
});

// -- 6. nurtureEv is the focus-ON twin --------------------------------------
test("nurtureEv equals profit when focus is ON", () => {
  const r = cycle({ useFocus: true, baseProfit: 100_000, babyPrice: 60_000, ...T5_HORSE });
  assert.ok(near(r.nurtureEv, r.profit));
});

test("nurtureEv exceeds profit when focus is OFF (it shows what nurture would add)", () => {
  const r = cycle({ useFocus: false, baseProfit: 100_000, babyPrice: 60_000, ...T5_HORSE });
  assert.ok(near(r.nurtureEv - r.profit, T5_HORSE.nurtureGain * 100_000));
});

test("nurtureEv collapses to profit when the base cycle loses money", () => {
  const r = cycle({ useFocus: false, baseProfit: -10_000, babyPrice: 60_000, ...T5_HORSE });
  assert.strictEqual(r.nurtureEv, r.profit);
});

test("nurtureEv collapses to profit with no nurture data", () => {
  const r = cycle({ useFocus: false, baseProfit: 100_000, babyPrice: 60_000, baseOffspring: 0, nurtureGain: 0, maxNurtures: 0 });
  assert.strictEqual(r.nurtureEv, r.profit);
});

// -- 7. Profit / 10k Focus follows the offspring ----------------------------
// A focus bar is focus-ON play, so the per-10k column prices the focus-ON cycle:
//   profitPer10kFocus = nurtureEvFocusOn x floor(10000 / focusPerBaby)
function per10k(nurtureEvFocusOn, focusPerBaby) {
  return focusPerBaby > 0 ? nurtureEvFocusOn * Math.floor(10000 / focusPerBaby) : 0;
}
test("profit / 10k focus counts the offspring, not the bare cycle", () => {
  const baseProfit = 100_000, babyPrice = 60_000;
  const ev = cycle({ useFocus: true, baseProfit, babyPrice, ...T5_HORSE }).nurtureEv;
  const withOffspring = per10k(ev, 300);
  const bareCycle = per10k(baseProfit, 300);
  assert.ok(withOffspring > bareCycle,
    `expected the offspring-inclusive bar (${withOffspring}) to beat the bare one (${bareCycle})`);
  assert.ok(near(withOffspring, ev * 33));
});

test("profit / 10k focus does NOT follow the Use Focus checkbox", () => {
  const args = { baseProfit: 100_000, babyPrice: 60_000, ...T5_HORSE };
  const on = per10k(cycle({ useFocus: true, ...args }).nurtureEv, 300);
  const off = per10k(cycle({ useFocus: false, ...args }).nurtureEv, 300);
  assert.strictEqual(on, off);
});

// -- 8. Sil/Focus stays marginal --------------------------------------------
test("the focus play is worth the GAIN slice only, never the base slice", () => {
  const baseProfit = 100_000, babyPrice = 60_000;
  const value = Math.max(babyPrice, baseProfit);
  const marginal = T3_HORSE.nurtureGain * value;   // what the focus buys
  const inclusive = cycle({ useFocus: true, baseProfit, babyPrice, ...T3_HORSE }).offspringRevenue;
  assert.ok(marginal < inclusive, "the marginal slice must be smaller than the whole chance");
  assert.ok(near(marginal / 300, (0.20 * value) / 300));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
