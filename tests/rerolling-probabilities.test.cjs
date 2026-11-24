/**
 * Tests for the quality-reroll model (repair station "Reroll Quality").
 *
 * The old model treated a reroll as a single independent draw against the
 * CRAFTING quality table (25% / 5% / 1% / 0.1%), so Normal -> Excellent came out
 * at ceil(1/0.011) = 91 attempts and the cost was a flat per-tier guess.
 *
 * Since the Lands Awaken reroll rework the station rolls a source-quality
 * dependent table, and a reroll never lowers quality:
 *
 *            from Normal  from Good  from Outstanding  from Excellent
 *   Good           80%        30%           0%               0%
 *   Outstanding    15%        60%          50%               0%
 *   Excellent       5%       9.9%        49.9%             99.5%
 *   Masterpiece    0.1%       0.1%         0.1%              0.5%
 *
 * Two consequences the old model got wrong:
 *   - a reroll of a Normal item ALWAYS upgrades it (the column has no
 *     "stays Normal" mass), so Normal -> Good is exactly one attempt;
 *   - the walk climbs through the intermediate qualities, so Normal ->
 *     Excellent averages ~3.8 attempts, not 91.
 *
 * Cost is [item value] * [reroll modifier of the CURRENT quality]
 * (4.4 / 5.5 / 6.6 / 27.5), so the expected silver has to be accumulated along
 * the same walk rather than multiplied by a single per-attempt price.
 *
 * Black-box: drive the public helpers with a table of hand-solved absorbing
 * Markov chain values.
 *
 * Run: node tests/rerolling-probabilities.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const mod = new Module("rerolling-probabilities-test");
mod._compile(
  read("item-values.js") +
    read("data-rerolling.js") +
    "\nmodule.exports = { REROLL_MATRIX, REROLL_COST_MODIFIER, QUALITY_TRANSITIONS," +
    " getExpectedAttempts, getExpectedRerollCost, getGearItemValue, ITEM_VALUES };",
  "data-rerolling.js",
);
const {
  REROLL_MATRIX,
  REROLL_COST_MODIFIER,
  QUALITY_TRANSITIONS,
  getExpectedAttempts,
  getExpectedRerollCost,
  getGearItemValue,
  ITEM_VALUES,
} = mod.exports;

let passed = 0,
  failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL: ${name} — ${err.message}`);
    failed++;
  }
}
const close = (actual, expected, tol, msg) =>
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${msg}: expected ~${expected}, got ${actual}`,
  );

console.log("\n=== Quality reroll probabilities ===");

// ─── The published matrix ────────────────────────────────────────────────────

[
  [1, { 2: 0.8, 3: 0.15, 4: 0.05, 5: 0.001 }],
  [2, { 2: 0.3, 3: 0.6, 4: 0.099, 5: 0.001 }],
  [3, { 3: 0.5, 4: 0.499, 5: 0.001 }],
  [4, { 4: 0.995, 5: 0.005 }],
].forEach(([from, row]) => {
  test(`matrix row from quality ${from} matches the in-game table`, () => {
    Object.entries(row).forEach(([to, p]) => {
      close(REROLL_MATRIX[from][to], p, 1e-9, `P(${from} -> ${to})`);
    });
  });
});

test("no matrix row can downgrade an item", () => {
  Object.entries(REROLL_MATRIX).forEach(([from, row]) => {
    Object.keys(row).forEach((to) => {
      assert.ok(Number(to) >= Number(from), `${from} -> ${to} is a downgrade`);
    });
  });
});

test("every matrix row is a probability distribution (mass <= 1)", () => {
  Object.entries(REROLL_MATRIX).forEach(([from, row]) => {
    const mass = Object.values(row).reduce((a, b) => a + b, 0);
    assert.ok(mass <= 1.002, `row ${from} sums to ${mass}`);
    assert.ok(mass > 0.99, `row ${from} sums to ${mass}`);
  });
});

test("a reroll of a Normal item always upgrades it", () => {
  assert.ok(!REROLL_MATRIX[1][1], "Normal has no stay-put mass");
});

// ─── Expected attempts ───────────────────────────────────────────────────────

console.log("\n=== Expected attempts ===");

[
  [1, 2, 1, "Normal -> Good is guaranteed on the first reroll"],
  [1, 3, 2.142857, "Normal -> Outstanding"],
  [1, 4, 3.814286, "Normal -> Excellent (user reported 5-10 in practice)"],
  [1, 5, 203.251429, "Normal -> Masterpiece"],
  [2, 3, 1.428571, "Good -> Outstanding"],
  [2, 4, 3.142857, "Good -> Excellent"],
  [2, 5, 202.514286, "Good -> Masterpiece"],
  [3, 4, 2, "Outstanding -> Excellent"],
  [3, 5, 201.6, "Outstanding -> Masterpiece"],
  [4, 5, 200, "Excellent -> Masterpiece"],
].forEach(([from, to, expected, why]) => {
  test(`${why}: ~${expected} attempts`, () => {
    close(getExpectedAttempts(from, to), expected, 1e-4, `attempts ${from}->${to}`);
  });
});

test("expected attempts drop as the starting quality rises", () => {
  [3, 4, 5].forEach((to) => {
    const series = [1, 2, 3, 4]
      .filter((from) => from < to)
      .map((from) => getExpectedAttempts(from, to));
    series.forEach((v, i) => {
      if (i === 0) return;
      assert.ok(v < series[i - 1], `to=${to}: start ${i + 1} is not cheaper in attempts`);
    });
  });
});

test("every listed transition yields a finite positive attempt count", () => {
  QUALITY_TRANSITIONS.forEach(({ from, to }) => {
    const n = getExpectedAttempts(from, to);
    assert.ok(Number.isFinite(n) && n >= 1, `${from}->${to} gave ${n}`);
  });
});

test("a target at or below the current quality needs no reroll", () => {
  [
    [3, 3],
    [4, 2],
    [5, 5],
  ].forEach(([from, to]) => {
    assert.strictEqual(getExpectedAttempts(from, to), 0, `${from}->${to}`);
  });
});

// ─── Item value ──────────────────────────────────────────────────────────────

console.log("\n=== Item value ===");

[
  ["T4_2H_BOW", 512, "32 x T4_METALBAR — the wiki's own cost example"],
  ["T4_MAIN_SWORD", 384, "16 bars + 8 leather"],
  ["T8_MAIN_SWORD", 6144, "same recipe at T8 (16x the T4 value)"],
  ["T4_CAPE", 128, "cape"],
  ["T4_MOUNT_HORSE", 320, "mount — real items.xml value, not the plain-armor fallback"],
  ["T5_MOUNT_ARMORED_HORSE", 960, "armored mount"],
  ["T8_MOUNT_HORSE", 5120, "same horse recipe at T8 (16x the T4 value)"],
].forEach(([id, expected, why]) => {
  test(`${id} item value is ${expected} (${why})`, () => {
    assert.strictEqual(getGearItemValue(id), expected);
  });
});

test("item value doubles per tier for a fixed recipe shape", () => {
  const tiers = [4, 5, 6, 7, 8].map((t) => ITEM_VALUES[`T${t}_MAIN_SWORD`]);
  tiers.forEach((v, i) => {
    if (i === 0) return;
    assert.strictEqual(v, tiers[i - 1] * 2, `T${i + 4} sword`);
  });
});

test("an unknown id falls back to a tier estimate instead of zero", () => {
  const v = getGearItemValue("T6_NOT_A_REAL_ITEM");
  assert.ok(v > 0, "fallback must be positive so cost never collapses to 0");
});

// ─── Expected cost ───────────────────────────────────────────────────────────

console.log("\n=== Expected reroll cost ===");

test("reroll modifiers match the wiki", () => {
  assert.deepStrictEqual(REROLL_COST_MODIFIER, { 1: 4.4, 2: 5.5, 3: 6.6, 4: 27.5 });
});

// Multiples of item value, solved on the same chain as the attempt counts.
[
  [1, 2, 4.4, "one Normal reroll at 4.4x item value"],
  [1, 3, 10.685714, "Normal -> Outstanding"],
  [1, 4, 21.717143, "Normal -> Excellent"],
  [2, 4, 19.171429, "Good -> Excellent"],
  [3, 4, 13.2, "Outstanding -> Excellent"],
  [4, 5, 5500, "Excellent -> Masterpiece"],
].forEach(([from, to, mult, why]) => {
  test(`${why}: ${mult}x item value`, () => {
    const v = getGearItemValue("T4_2H_BOW"); // 512
    close(getExpectedRerollCost("T4_2H_BOW", from, to), v * mult, v * 1e-5, `cost ${from}->${to}`);
  });
});

test("cost scales linearly with item value across tiers", () => {
  const t4 = getExpectedRerollCost("T4_MAIN_SWORD", 1, 4);
  const t8 = getExpectedRerollCost("T8_MAIN_SWORD", 1, 4);
  close(t8 / t4, 16, 1e-6, "T8 sword vs T4 sword");
});

test("Normal -> Excellent is far cheaper than the old flat 91-attempt model", () => {
  // Old: 91 attempts * 2000 silver = 182,000 for a T4 item.
  assert.ok(getExpectedRerollCost("T4_2H_BOW", 1, 4) < 20000);
});

test("a target at or below the current quality is free", () => {
  assert.strictEqual(getExpectedRerollCost("T4_2H_BOW", 4, 3), 0);
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
