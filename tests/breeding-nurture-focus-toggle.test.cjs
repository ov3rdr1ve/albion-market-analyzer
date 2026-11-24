/**
 * Test: "Use Focus" gates the NURTURE slice of a breeding row's profit.
 *
 * A breeding cycle hands a baby back, and that expectation is now inside the
 * row's profit (js/render-mounts.js breedingRowFor). The chance has two halves
 * and they answer to the checkbox differently:
 *
 *   base offspring  — arrives whether or not you spend focus. ALWAYS counted.
 *   nurture gain    — is what the focus buys. Counted only with Use Focus on.
 *
 *   profit = baseCycleProfit + (base + (useFocus ? gain : 0)) x max(babyPrice, baseCycleProfit)
 *
 * The companion column, nurtureEv, is the focus-ON twin: it always carries the
 * whole chance, so with focus on it equals profit (the cell renders "-") and
 * with focus off it is what turning focus on would be worth.
 *
 * Historically the checkbox gated the ONLY offspring term there was, and the
 * base chance was worth nothing at all. Both halves of that are pinned here.
 * The valuation itself (max of baby price / cycle margin, uncapped chance) is
 * pinned in tests/breeding-offspring-revenue.test.cjs.
 *
 * Pattern mirrors tests/breeding-saddler-focus-toggle.test.cjs (toggle-on vs
 * toggle-off black-box comparison).
 *
 * Run: node tests/breeding-nurture-focus-toggle.test.cjs
 */

const assert = require("assert");

// -- Mirror of the profit / nurtureEv pair from js/render-mounts.js ---------
function profitFor({ useFocus, profit, babyPrice, maxNurtures, baseOffspringPct, nurtureGainPct }) {
  const offspringValue = Math.max(babyPrice, profit);
  if (offspringValue <= 0) return profit;
  const chance = (baseOffspringPct + (useFocus ? nurtureGainPct : 0)) / 100;
  return profit + chance * offspringValue;
}
function nurtureEvFor(args) {
  const { profit, babyPrice, maxNurtures, baseOffspringPct, nurtureGainPct } = args;
  if (!(profit > 0) || !maxNurtures) return profitFor(args);
  const offspringValue = Math.max(babyPrice, profit);
  return profit + ((baseOffspringPct + nurtureGainPct) / 100) * offspringValue;
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}
const near = (a, b, eps = 1) => Math.abs(a - b) < eps;

console.log("\n=== Breeding nurture-stage focus-toggle propagation ===");

// -- Fixture A: T8 elite mount (rare line) - base 0, 6 nurture cycles x 2.5% --
// Mirrors BREEDING_NURTURE_DATA[T8_FARM_DIREBOAR_FW_LYMHURST_BABY].
const T8_ELITE = { maxNurtures: 6, baseOffspringPct: 0, nurtureGainPct: 15.0 };

// -- Fixture B: T5 horse - non-zero base, gain no longer clipped by 100% ----
// Mirrors BREEDING_NURTURE_DATA[T5_FARM_HORSE_BABY]: base 0.7867, 3 x 0.0889.
const T5_HORSE = { maxNurtures: 3, baseOffspringPct: 78.67, nurtureGainPct: 26.67 };

// -- 1. Toggle ON, profitable cycle, nurture available -> gain IS applied ---
test("focus on: profit = cycle + (base + gain) x max(baby, profit)", () => {
  const p = profitFor({ useFocus: true, profit: 1_000_000, babyPrice: 840_000, ...T8_ELITE });
  // base 0 + gain 15% x max(1M, 840K) = 150_000
  assert.ok(near(p, 1_150_000), `expected 1,150,000, got ${p}`);
});

// -- 2. Toggle OFF -> the nurture slice is excluded, the base slice is not --
test("focus off: the nurture slice is dropped", () => {
  const p = profitFor({ useFocus: false, profit: 1_000_000, babyPrice: 840_000, ...T8_ELITE });
  assert.strictEqual(p, 1_000_000); // this line has no base chance to keep
});

test("focus off: a common animal STILL earns its base offspring chance", () => {
  // The regression this guards: the checkbox used to zero the whole offspring
  // expectation, so a horse that returns a baby 78.67% of the time unfocused
  // was priced as if it returned nothing.
  const p = profitFor({ useFocus: false, profit: 100_000, babyPrice: 60_000, ...T5_HORSE });
  assert.ok(near(p, 100_000 + 0.7867 * 100_000), `expected ~178,670, got ${p}`);
});

// -- 3. Toggle ON vs OFF: delta = (gainPct/100) x offspringValue ------------
test("delta(on - off) equals exactly (gainPct/100) x offspringValue", () => {
  const args = { profit: 1_000_000, babyPrice: 840_000, ...T8_ELITE };
  const on = profitFor({ useFocus: true, ...args });
  const off = profitFor({ useFocus: false, ...args });
  assert.strictEqual(on - off, (T8_ELITE.nurtureGainPct / 100) * 1_000_000);
});

test("delta(on - off) is the gain slice for a common animal too", () => {
  const args = { profit: 100_000, babyPrice: 60_000, ...T5_HORSE };
  const on = profitFor({ useFocus: true, ...args });
  const off = profitFor({ useFocus: false, ...args });
  assert.ok(near(on - off, (T5_HORSE.nurtureGainPct / 100) * 100_000));
});

// -- 4. Nothing to value -> the toggle changes nothing ----------------------
test("no baby price and a loss-making cycle: profit is untouched either way", () => {
  const args = { profit: -50_000, babyPrice: 0, ...T8_ELITE };
  assert.strictEqual(profitFor({ useFocus: true, ...args }), -50_000);
  assert.strictEqual(profitFor({ useFocus: false, ...args }), -50_000);
});

// -- 5. No nurture rows -> only the base slice, on either setting -----------
test("maxNurtures = 0: the toggle has nothing to add", () => {
  const args = { profit: 500_000, babyPrice: 100_000, maxNurtures: 0, baseOffspringPct: 0, nurtureGainPct: 0 };
  assert.strictEqual(profitFor({ useFocus: true, ...args }), 500_000);
  assert.strictEqual(profitFor({ useFocus: false, ...args }), 500_000);
});

// -- 6. A loss-making cycle still credits the baby at its buy price ---------
test("focus toggle still moves a loss-making cycle valued at the baby price", () => {
  const args = { profit: -50_000, babyPrice: 100_000, ...T8_ELITE };
  const on = profitFor({ useFocus: true, ...args });
  const off = profitFor({ useFocus: false, ...args });
  assert.ok(near(on - off, 0.15 * 100_000));
});

// -- 7. nurtureEv is the focus-ON twin -------------------------------------
test("nurtureEv equals profit with focus ON (the cell then reads '-')", () => {
  const args = { profit: 150_000, babyPrice: 75_000, ...T5_HORSE };
  assert.ok(near(nurtureEvFor(args), profitFor({ useFocus: true, ...args })));
});

test("nurtureEv exceeds profit with focus OFF by exactly the nurture slice", () => {
  const args = { profit: 150_000, babyPrice: 75_000, ...T5_HORSE };
  const off = profitFor({ useFocus: false, ...args });
  assert.ok(near(nurtureEvFor(args) - off, (T5_HORSE.nurtureGainPct / 100) * 150_000));
});

test("nurtureEv collapses to profit on a loss-making cycle", () => {
  const args = { useFocus: false, profit: -50_000, babyPrice: 100_000, ...T8_ELITE };
  assert.strictEqual(nurtureEvFor(args), profitFor(args));
});

// -- 8. Downstream s/FP propagation ----------------------------------------
// Mirrors the fpAdjustedProfit shape from render-mounts.js:
//   fpAdjustedProfit = (nurtureEv || profit) + fpMatSilverCost x (1 + setupFee)
//   silverPerFp = fpAdjustedProfit / totalFpCost
test("downstream: s/FP bred rises with the offspring the cycle returns", () => {
  const profit = 1_000_000, babyPrice = 840_000;
  const fpMatSilverCost = 50_000, setupFee = 0.015, totalFpCost = 110_000;

  const evOn = profitFor({ useFocus: true, profit, babyPrice, ...T8_ELITE });
  const evOff = profitFor({ useFocus: false, profit, babyPrice, ...T8_ELITE });
  const sfp = (ev) => (ev + fpMatSilverCost * (1 + setupFee)) / totalFpCost;

  assert.ok(sfp(evOn) > sfp(evOff), "the nurtured cycle must rate higher per FP");
  const expectedDelta = ((T8_ELITE.nurtureGainPct / 100) * Math.max(profit, babyPrice)) / totalFpCost;
  assert.ok(Math.abs((sfp(evOn) - sfp(evOff)) - expectedDelta) < 1e-9,
    `delta mismatch: got ${sfp(evOn) - sfp(evOff)}, expected ${expectedDelta}`);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
