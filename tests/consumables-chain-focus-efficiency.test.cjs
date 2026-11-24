/**
 * Test: chain-craft consumable rows (raw meat / butter / flour / bread)
 * surface focus efficiency.
 *
 * Background: the consumables table's chain-craft branch (render-consumables.js
 * `buildChainCraftRow`) used to leave "Mats / 10k Focus" and "Silver/Focus"
 * as em-dashes. Butcher, mill, and cook stations DO consume focus — verified
 * via wiki + items.xml FOCUS_COSTS — and butchering additionally pays RRR as
 * extra output (one of items.xml's `returnproductnotresource="true"` flags),
 * mirrored here by the `noReturn: true` flag on the animal input.
 *
 * Two RRR mechanics live in this branch:
 *   - Butcher: more output meat per animal → effectiveOutput = output × (1+rrr)
 *   - Mill / Cook / Alchemist (bread, butter, flour, schnapps): standard input
 *     refund → effectiveCostPerOutput = baseCost × (1 - rrr).
 *
 * The toggle "Use Focus (Craft/Refine/Breed)" routes through `getCraftRRR`'s third
 * arg so focus-off uses just the base royal-city 18% bonus and focus-on adds
 * the +59% focus bonus. Butcher chains additionally have per-meat city specs
 * (+10 PB, e.g. Thetford pork) — routed through getButcherRRR with the
 * chain's `produces` id. Mill/cook/alchemist stations carry a CITY_CRAFT_SPEC
 * spec instead (+15 PB): flour/bread/butter are craftingcategory="food"
 * (Caerleon), alcohol is an alchemist potion craft (Brecilien).
 *
 * Run: node tests/consumables-chain-focus-efficiency.test.cjs
 */

const assert = require("assert");

// ── Mirror getCraftRRR / getButcherRRR (calculations.js).
const BASE_CITY_BONUS = 0.18;
const BUTCHER_SPEC_BONUS = 0.10;
const CRAFT_SPEC_BONUS = 0.15;
const FOCUS_BONUS = 0.59;
// Only the two entries this file exercises; the real table is in
// js/data-city-bonuses.js.
const CITY_CRAFT_SPEC = {
  Caerleon: ["food"],
  Brecilien: ["potion"],
};
const CITY_BUTCHER_SPEC = {
  "Fort Sterling": ["T3_MEAT", "T6_MEAT"],
  Bridgewatch: ["T4_MEAT"],
  Lymhurst: ["T5_MEAT"],
  Thetford: ["T7_MEAT"],
  Martlock: ["T8_MEAT"],
};
function calcRRR(bonus) { return bonus <= 0 ? 0 : bonus / (1 + bonus); }
function getCraftRRR(city, craftType, useFocus = true) {
  let bonus = BASE_CITY_BONUS;
  const specs = CITY_CRAFT_SPEC[city];
  if (specs && craftType && specs.includes(craftType)) bonus += CRAFT_SPEC_BONUS;
  if (useFocus) bonus += FOCUS_BONUS;
  return calcRRR(bonus);
}
function getChainCraftType(station) {
  if (station === "alchemist") return "potion";
  if (station === "mill" || station === "cook") return "food";
  return null;
}
function getOptimalCraftCity(craftType, cityPool, fallback) {
  if (!craftType || !cityPool || cityPool.length === 0) return fallback;
  for (const c of cityPool) {
    if ((CITY_CRAFT_SPEC[c] || []).includes(craftType)) return c;
  }
  return fallback;
}
function getButcherRRR(city, meatId, useFocus = true) {
  let bonus = BASE_CITY_BONUS;
  const specs = CITY_BUTCHER_SPEC[city];
  if (specs && meatId && specs.includes(meatId)) bonus += BUTCHER_SPEC_BONUS;
  if (useFocus) bonus += FOCUS_BONUS;
  return calcRRR(bonus);
}
function getOptimalButcherCity(meatId, cityPool, fallback) {
  if (!meatId || !cityPool || cityPool.length === 0) return fallback;
  for (const c of cityPool) {
    if ((CITY_BUTCHER_SPEC[c] || []).includes(meatId)) return c;
  }
  return fallback;
}
// Match the renderer's behavior: butcher chains route through the spec city
// in the pool (default: all 5 royals). Tests that pass `craftCity` exercise
// the legacy fallback path via an empty pool.
const TEST_CITY_POOL = ["Fort Sterling", "Bridgewatch", "Lymhurst", "Thetford", "Martlock"];

// ── Pure helper: mirrors the chain-craft branch math we're about to land in
// render-consumables.js. Single source-of-truth so the test and the renderer
// can both validate against it.
//
// Convention (matches the craft row convention at render-consumables.js:362-379):
//   - Input cost / per-unit profit REACT to the `useFocus` toggle. With focus
//     off, the user is paying the higher base-RRR-only input cost.
//   - profitPerFocus is a BENCHMARK — it always answers "if you DID spend
//     focus on this batch, what's the return per focus?". So it's computed
//     against focus-on RRR regardless of `useFocus`.
function applyChainRrr({ chain, rrr }) {
  const isButcher = chain.station === "butcher";
  const anyReturnable = chain.inputs.some((i) => !i.noReturn);
  const effectiveOutput = isButcher ? chain.output * (1 + rrr) : chain.output;
  let effectiveCostPerOutput;
  if (isButcher) {
    effectiveCostPerOutput = chain.costPerOutput * chain.output / effectiveOutput;
  } else if (anyReturnable) {
    effectiveCostPerOutput = chain.costPerOutput * (1 - rrr);
  } else {
    effectiveCostPerOutput = chain.costPerOutput;
  }
  return { effectiveOutput, effectiveCostPerOutput };
}

function computeChainCraftEconomics({ chain, sellPrice, focusCost, craftCity, useFocus, cityPool }) {
  const SETUP_FEE = 0.025;
  const PREMIUM_TAX = 0.065;
  // Butcher chains use the per-meat spec RRR (+10 PB when city boosts this
  // meat tier); mill/cook/alchemist chains use the CITY_CRAFT_SPEC one
  // (+15 PB for "food"/"potion"). Either way the craft city defaults to
  // craftCity and routes to the spec city when it's in the active pool.
  const isButcherChain = chain.station === "butcher";
  const pool = cityPool || []; // empty pool = old single-city behavior
  const chainCraftType = getChainCraftType(chain.station);
  const butcherCity = isButcherChain
    ? getOptimalButcherCity(chain.produces, pool, craftCity)
    : craftCity;
  const craftAt = isButcherChain
    ? butcherCity
    : getOptimalCraftCity(chainCraftType, pool, craftCity);
  const rrr = isButcherChain
    ? getButcherRRR(butcherCity, chain.produces, useFocus)
    : getCraftRRR(craftAt, chainCraftType, useFocus);
  const benchmarkRrr = isButcherChain
    ? getButcherRRR(butcherCity, chain.produces, true)
    : getCraftRRR(craftAt, chainCraftType, true);

  const toggle = applyChainRrr({ chain, rrr });
  const bench  = applyChainRrr({ chain, rrr: benchmarkRrr });

  // Display values — react to the toggle.
  const inputCostPerOutput = toggle.effectiveCostPerOutput * (1 + SETUP_FEE);
  const revenuePerOutput = sellPrice * (1 - PREMIUM_TAX);
  const profitPerOutput = revenuePerOutput - inputCostPerOutput;

  // Silver/Focus benchmark — always computed against focus-on RRR.
  const benchInputCost = bench.effectiveCostPerOutput * (1 + SETUP_FEE);
  const benchProfitPerOutput = revenuePerOutput - benchInputCost;
  const profitPerBatch = benchProfitPerOutput * bench.effectiveOutput;
  const profitPerFocus = (focusCost > 0) ? profitPerBatch / focusCost : 0;
  const batchesPer10kFocus = (focusCost > 0) ? Math.floor(10000 / focusCost) : 0;

  return {
    craftAt,
    rrr, effectiveOutput: toggle.effectiveOutput,
    benchmarkRrr, benchEffectiveOutput: bench.effectiveOutput,
    inputCostPerOutput, revenuePerOutput,
    profitPerOutput, profitPerBatch, profitPerFocus, batchesPer10kFocus,
  };
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("\n=== Chain-craft focus efficiency ===");

// ── Butcher: T6 Raw Mutton — the screenshot scenario.
// 1 Tame Sheep @ 7,505 → 18 raw mutton @ 433 sell. Focus cost 38/batch.
// Existing tests use craftCity="Thetford", which has NO T6 bonus (FS does) —
// so the assertions about base-RRR behavior still hold. New tests below
// cover the bonus-city path.
const BUTCHER_T6 = {
  station: "butcher",
  produces: "T6_MEAT",
  output: 18,
  inputs: [{ matId: "T6_FARM_SHEEP_GROWN", count: 1, noReturn: true }],
  costPerOutput: 7505 / 18,  // 416.94 per meat before setup fee + RRR
};

test("butcher: silver/focus is a benchmark — identical across toggle states", () => {
  // Matches the craft-row convention (render-consumables.js:362-379): the
  // Silver/Focus column answers "what return per focus IF you used focus",
  // independent of the checkbox state. The checkbox only affects displayed
  // input cost / per-unit profit.
  const on = computeChainCraftEconomics({ chain: BUTCHER_T6, sellPrice: 433, focusCost: 38, craftCity: "Thetford", useFocus: true });
  const off = computeChainCraftEconomics({ chain: BUTCHER_T6, sellPrice: 433, focusCost: 38, craftCity: "Thetford", useFocus: false });
  assert.strictEqual(on.profitPerFocus, off.profitPerFocus,
    `silver/focus must be identical: on=${on.profitPerFocus}, off=${off.profitPerFocus}`);
});

test("butcher: focus toggle changes input cost (display value reacts)", () => {
  const on = computeChainCraftEconomics({ chain: BUTCHER_T6, sellPrice: 433, focusCost: 38, craftCity: "Thetford", useFocus: true });
  const off = computeChainCraftEconomics({ chain: BUTCHER_T6, sellPrice: 433, focusCost: 38, craftCity: "Thetford", useFocus: false });
  assert.ok(on.inputCostPerOutput < off.inputCostPerOutput,
    `focus-on per-unit cost (${on.inputCostPerOutput.toFixed(2)}) should be cheaper than focus-off (${off.inputCostPerOutput.toFixed(2)})`);
});

test("butcher: focus toggle changes per-unit profit (display value reacts)", () => {
  const on = computeChainCraftEconomics({ chain: BUTCHER_T6, sellPrice: 433, focusCost: 38, craftCity: "Thetford", useFocus: true });
  const off = computeChainCraftEconomics({ chain: BUTCHER_T6, sellPrice: 433, focusCost: 38, craftCity: "Thetford", useFocus: false });
  assert.ok(on.profitPerOutput > off.profitPerOutput,
    `focus-on per-unit profit (${on.profitPerOutput.toFixed(2)}) should exceed focus-off (${off.profitPerOutput.toFixed(2)})`);
});

test("butcher: benchmark effective output expands by (1 + focus-on RRR)", () => {
  const on = computeChainCraftEconomics({ chain: BUTCHER_T6, sellPrice: 433, focusCost: 38, craftCity: "Thetford", useFocus: true });
  // RRR(0.77) = 0.77 / 1.77 ≈ 0.4350. Effective = 18 × 1.4350 ≈ 25.83.
  assert.ok(Math.abs(on.benchEffectiveOutput - 18 * (1 + 0.435028)) < 0.01,
    `benchmark effective output: expected ~25.83, got ${on.benchEffectiveOutput}`);
});

test("butcher: batchesPer10kFocus = floor(10000 / focusCost)", () => {
  const on = computeChainCraftEconomics({ chain: BUTCHER_T6, sellPrice: 433, focusCost: 38, craftCity: "Thetford", useFocus: true });
  assert.strictEqual(on.batchesPer10kFocus, 263, "10000 / 38 = 263.16 → floor 263");
});

test("butcher: focus-off display still applies +15.3% base-city RRR (not zero)", () => {
  const off = computeChainCraftEconomics({ chain: BUTCHER_T6, sellPrice: 433, focusCost: 38, craftCity: "Thetford", useFocus: false });
  // Royal city base 18% bonus → RRR = 0.18 / 1.18 ≈ 0.1525.
  // Effective output (toggle-reactive) = 18 × 1.1525 ≈ 20.75.
  assert.ok(Math.abs(off.effectiveOutput - 18 * 1.152542) < 0.01,
    `focus-off display effective output: expected ~20.75, got ${off.effectiveOutput}`);
});

// ── Butcher city spec — the FS-mutton bonus.
test("butcher: T6 mutton at Fort Sterling applies +10 PB (RRR 21.9%, no focus)", () => {
  const fs = computeChainCraftEconomics({ chain: BUTCHER_T6, sellPrice: 433, focusCost: 38, craftCity: "Fort Sterling", useFocus: false });
  // PB = 18 + 10 = 28 → RRR 28/128 ≈ 0.21875.
  assert.ok(Math.abs(fs.rrr - 28 / 128) < 1e-9,
    `expected RRR 28/128 (FS T6 bonus), got ${fs.rrr}`);
});

test("butcher: T6 mutton at Thetford uses base RRR only (no T6 bonus there)", () => {
  const thet = computeChainCraftEconomics({ chain: BUTCHER_T6, sellPrice: 433, focusCost: 38, craftCity: "Thetford", useFocus: false });
  assert.ok(Math.abs(thet.rrr - 18 / 118) < 1e-9,
    `expected base RRR (Thetford has no T6 bonus), got ${thet.rrr}`);
});

test("butcher: bonus city beats non-bonus city on effective output", () => {
  const fs = computeChainCraftEconomics({ chain: BUTCHER_T6, sellPrice: 433, focusCost: 38, craftCity: "Fort Sterling", useFocus: false });
  const thet = computeChainCraftEconomics({ chain: BUTCHER_T6, sellPrice: 433, focusCost: 38, craftCity: "Thetford", useFocus: false });
  assert.ok(fs.effectiveOutput > thet.effectiveOutput,
    `FS mutton output (${fs.effectiveOutput.toFixed(2)}) should exceed Thetford mutton (${thet.effectiveOutput.toFixed(2)})`);
});

// ── Pork at Thetford — the original user-screenshot scenario.
const BUTCHER_T7 = {
  station: "butcher",
  produces: "T7_MEAT",
  output: 18,
  inputs: [{ matId: "T7_FARM_PIG_GROWN", count: 1, noReturn: true }],
  costPerOutput: 5000 / 18,
};

test("butcher: T7 pork at Thetford matches in-game 21.8% RRR (no focus)", () => {
  const thet = computeChainCraftEconomics({ chain: BUTCHER_T7, sellPrice: 600, focusCost: 38, craftCity: "Thetford", useFocus: false });
  assert.ok(Math.abs(thet.rrr - 0.21875) < 1e-4,
    `expected 21.875% per in-game tooltip, got ${(thet.rrr * 100).toFixed(2)}%`);
});

test("butcher: T7 pork at Martlock falls back to base 15.2% RRR (no Martlock pork bonus)", () => {
  const mart = computeChainCraftEconomics({ chain: BUTCHER_T7, sellPrice: 600, focusCost: 38, craftCity: "Martlock", useFocus: false });
  assert.ok(Math.abs(mart.rrr - 18 / 118) < 1e-9);
});

// ── Butcher routing — spec city wins over buy city in the royal pool.
test("butcher: T7 pork bought at Bridgewatch, royal pool -> butchers at Thetford (RRR 21.9%)", () => {
  const r = computeChainCraftEconomics({
    chain: BUTCHER_T7, sellPrice: 600, focusCost: 38,
    craftCity: "Bridgewatch", cityPool: TEST_CITY_POOL, useFocus: false,
  });
  assert.ok(Math.abs(r.rrr - 28 / 128) < 1e-9,
    `expected Thetford-bonus RRR; got ${r.rrr}`);
});

test("butcher: T7 pork bought at Bridgewatch, Caerleon-only pool -> stays at Bridgewatch (base RRR)", () => {
  const r = computeChainCraftEconomics({
    chain: BUTCHER_T7, sellPrice: 600, focusCost: 38,
    craftCity: "Bridgewatch", cityPool: ["Caerleon"], useFocus: false,
  });
  assert.ok(Math.abs(r.rrr - 18 / 118) < 1e-9,
    `expected base RRR when no royal spec city in pool; got ${r.rrr}`);
});

// ── Mill: T3 Flour from T3 Wheat. RRR refunds wheat → cheaper per flour.
const MILL_T3 = {
  station: "mill",
  output: 1,
  inputs: [{ matId: "T3_WHEAT", count: 1 }], // returnable input
  costPerOutput: 50,  // 50 silver of wheat per flour before RRR
};

test("mill: focus toggle changes per-unit input cost", () => {
  const on = computeChainCraftEconomics({ chain: MILL_T3, sellPrice: 80, focusCost: 38, craftCity: "Lymhurst", useFocus: true });
  const off = computeChainCraftEconomics({ chain: MILL_T3, sellPrice: 80, focusCost: 38, craftCity: "Lymhurst", useFocus: false });
  assert.ok(on.inputCostPerOutput < off.inputCostPerOutput,
    `mill focus-on cost (${on.inputCostPerOutput.toFixed(2)}) should be cheaper than focus-off (${off.inputCostPerOutput.toFixed(2)})`);
});

test("mill: effective output stays at 1 (no extra flour from RRR — RRR refunds inputs)", () => {
  const on = computeChainCraftEconomics({ chain: MILL_T3, sellPrice: 80, focusCost: 38, craftCity: "Lymhurst", useFocus: true });
  assert.strictEqual(on.effectiveOutput, 1, "mill output is 1:1; RRR refunds wheat, not adds flour");
});

test("mill: per-unit cost = baseCost × (1 - rrr) for returnable input", () => {
  const on = computeChainCraftEconomics({ chain: MILL_T3, sellPrice: 80, focusCost: 38, craftCity: "Lymhurst", useFocus: true });
  // baseCost 50 × (1 - 0.435) × 1.025 setup = 28.97
  const expected = 50 * (1 - on.rrr) * 1.025;
  assert.ok(Math.abs(on.inputCostPerOutput - expected) < 0.01,
    `expected ~${expected.toFixed(2)}, got ${on.inputCostPerOutput.toFixed(2)}`);
});

// ── Cook (butter / bread): same shape as mill — RRR refunds input.
const COOK_T6_BUTTER = {
  station: "cook",
  output: 1,
  inputs: [{ matId: "T6_MILK", count: 1 }],
  costPerOutput: 1_200,
};

test("cook (butter): silver/focus benchmark is non-zero when profit is positive", () => {
  const result = computeChainCraftEconomics({ chain: COOK_T6_BUTTER, sellPrice: 2_000, focusCost: 38, craftCity: "Lymhurst", useFocus: false });
  // Even with the toggle off, the benchmark profitPerFocus is positive
  // because it's computed against focus-on RRR (refunding milk by 43.5%).
  assert.ok(result.profitPerFocus > 0, "cook benchmark silver/focus should be > 0 for a profitable cook recipe");
});

// ── Regression: focus cost = 0 → silver/focus reports 0, no NaN/Infinity.
test("focusCost=0: silver/focus stays 0 (no NaN)", () => {
  const result = computeChainCraftEconomics({ chain: BUTCHER_T6, sellPrice: 433, focusCost: 0, craftCity: "Thetford", useFocus: true });
  assert.strictEqual(result.profitPerFocus, 0, "no focus cost → no focus efficiency");
  assert.strictEqual(result.batchesPer10kFocus, 0, "no focus cost → 0 batches per 10k focus");
});

// ── Regression: noReturn-only input chain (hypothetical mill where wheat is
// also flagged noReturn) — RRR has nothing to refund, costs stay the same.
test("non-butcher chain with all noReturn inputs: focus has no cost effect", () => {
  const allNoReturn = {
    station: "cook",
    output: 1,
    inputs: [{ matId: "T6_MILK", count: 1, noReturn: true }],
    costPerOutput: 1_200,
  };
  const on = computeChainCraftEconomics({ chain: allNoReturn, sellPrice: 2_000, focusCost: 38, craftCity: "Lymhurst", useFocus: true });
  const off = computeChainCraftEconomics({ chain: allNoReturn, sellPrice: 2_000, focusCost: 38, craftCity: "Lymhurst", useFocus: false });
  assert.strictEqual(on.inputCostPerOutput, off.inputCostPerOutput,
    "no returnable inputs → focus toggle leaves cost unchanged");
});

// ── Regression: focus-off display values still get +15.3% base-city RRR. The
// user is "not using focus" but still has the city's base 18% production
// bonus — without this distinction the toggle-off cost would be wrong.
test("focus-off baseline RRR > 0 (city base bonus applies even without focus)", () => {
  const off = computeChainCraftEconomics({ chain: BUTCHER_T6, sellPrice: 433, focusCost: 38, craftCity: "Thetford", useFocus: false });
  // RRR(0.18) = 0.18 / 1.18 ≈ 0.1525.
  assert.ok(Math.abs(off.rrr - 0.152542) < 0.001, `focus-off rrr should be ~0.1525, got ${off.rrr}`);
});

// ── Alchemist (schnapps) — same input-refund shape as mill/cook, plus the
// CITY_CRAFT_SPEC bonus that this branch used to throw away.
const ALCHEMIST_T6 = {
  station: "alchemist",
  produces: "T6_ALCOHOL",
  output: 1,
  inputs: [{ matId: "T6_POTATO", count: 1 }],
  costPerOutput: 1_000,
};
const FULL_POOL = ["Lymhurst", "Bridgewatch", "Martlock", "Thetford", "Fort Sterling", "Caerleon", "Brecilien"];

// Parameterized over the two non-butcher spec stations: the pool must pull the
// craft into the bonus city, and the bonus must cut the input cost.
[
  { label: "alchemist (schnapps)", chain: ALCHEMIST_T6, bonusCity: "Brecilien", sell: 2_000 },
  { label: "mill (flour)",         chain: MILL_T3,      bonusCity: "Caerleon",  sell: 80 },
].forEach(({ label, chain, bonusCity, sell }) => {
  test(`${label}: the craft routes to ${bonusCity} when it is in the pool`, () => {
    const r = computeChainCraftEconomics({
      chain, sellPrice: sell, focusCost: 38, craftCity: "Lymhurst", useFocus: true, cityPool: FULL_POOL,
    });
    assert.strictEqual(r.craftAt, bonusCity);
  });

  test(`${label}: ${bonusCity} beats a non-spec city on RRR and input cost`, () => {
    const bonus = computeChainCraftEconomics({
      chain, sellPrice: sell, focusCost: 38, craftCity: "Lymhurst", useFocus: true, cityPool: FULL_POOL,
    });
    const plain = computeChainCraftEconomics({
      chain, sellPrice: sell, focusCost: 38, craftCity: "Lymhurst", useFocus: true, cityPool: ["Lymhurst"],
    });
    assert.ok(bonus.rrr > plain.rrr, `${bonus.rrr} should exceed ${plain.rrr}`);
    assert.ok(bonus.inputCostPerOutput < plain.inputCostPerOutput,
      `bonus city should refund more input (${bonus.inputCostPerOutput} vs ${plain.inputCostPerOutput})`);
  });

  test(`${label}: falls back to the buy city when ${bonusCity} is unreachable`, () => {
    const r = computeChainCraftEconomics({
      chain, sellPrice: sell, focusCost: 38, craftCity: "Lymhurst", useFocus: true,
      cityPool: FULL_POOL.filter((c) => c !== bonusCity),
    });
    assert.strictEqual(r.craftAt, "Lymhurst");
  });
});

test("alchemist: input refund follows (1 - rrr), same as mill", () => {
  const on = computeChainCraftEconomics({
    chain: ALCHEMIST_T6, sellPrice: 2_000, focusCost: 38, craftCity: "Brecilien", useFocus: true,
  });
  const expected = 1_000 * (1 - on.rrr) * 1.025;
  assert.ok(Math.abs(on.inputCostPerOutput - expected) < 0.01,
    `expected ~${expected.toFixed(2)}, got ${on.inputCostPerOutput.toFixed(2)}`);
  // 1 potato in → 1 schnapps out; RRR is a refund, never extra output.
  assert.strictEqual(on.effectiveOutput, 1);
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
