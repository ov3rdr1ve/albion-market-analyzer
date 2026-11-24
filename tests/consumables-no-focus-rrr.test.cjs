/**
 * Test: Items without `craftingfocus` in items.xml don't get the +59%
 * focus RRR bonus when the "Use Focus" toggle is on.
 *
 * Backstory: T1_FISHSAUCE_LEVEL{1,2,3} and T1_FISHCHOPS have NO
 * `craftingfocus` attribute in items.xml. The game won't let you spend
 * focus on these crafts, so applying the focus-boosted RRR (+59%) when
 * the global toggle is on overstated the refund and made input costs
 * artificially low. The fix gates every `getCraftRRR(_, _, true|on)` on
 * `focusCost > 0` for the item in scope:
 *   render-consumables.js:147, 198, 339, 458
 *   render-crafting.js:50, 258
 *   render-mounts.js:215, 453, 516
 *
 * Also: tooltip on the Silver/Focus "—" cell must explain why it's empty
 * (not focus-craftable per items.xml — base RRR still applied).
 *
 * Black-box: mirrors the gating logic + tooltip strings.
 *
 * Run: node tests/consumables-no-focus-rrr.test.cjs
 */

const assert = require("assert");

// ── Mirror calcRRR / getCraftRRR (calculations.js) ──────────────────────────
const BASE_CITY_BONUS = 0.18;
const CRAFT_SPEC_BONUS = 0.15;
const FOCUS_BONUS = 0.59;
const CITY_CRAFT_SPEC = { Caerleon: ["food"], Brecilien: ["potion"] };

function calcRRR(bonus) { return bonus <= 0 ? 0 : bonus / (1 + bonus); }
function getCraftRRR(city, craftType, useFocus = true) {
  let bonus = BASE_CITY_BONUS;
  const specs = CITY_CRAFT_SPEC[city];
  if (specs && craftType && specs.includes(craftType)) bonus += CRAFT_SPEC_BONUS;
  if (useFocus) bonus += FOCUS_BONUS;
  return calcRRR(bonus);
}

// ── Mirror the gating: third arg becomes (toggle && focusCost > 0) ──────────
function effectiveFocusOn(toggleIsOn, focusCost) {
  return toggleIsOn && focusCost > 0;
}

// ── Mirror ppfTitle construction (render-consumables.js chain-craft path) ───
function makeChainCraftPpfTitle({ focusCost, station, profit, output, chainRrr }) {
  if (focusCost > 0) {
    return `${profit * output} profit/batch ÷ ${focusCost} focus (RRR ${(chainRrr * 100).toFixed(1)}% applied to ${station === "butcher" ? "output meat" : "input refund"})`;
  }
  return "Not focus-craftable per items.xml — base RRR still applied to inputs (no craftingfocus attribute on this item)";
}

// ── Mirror ppfTitle construction (multi-ingredient craft path) ──────────────
function makeMultiIngredientPpfTitle({ focusCost, profit, craftsWithFocus, focusRrr }) {
  if (focusCost > 0) {
    return `${profit * craftsWithFocus} profit/10K focus ÷ ${craftsWithFocus} crafts (focus cost ${focusCost} ea, RRR ${(focusRrr * 100).toFixed(1)}%)`;
  }
  return "Not focus-craftable per items.xml — base RRR still applied to inputs (no craftingfocus attribute on this item)";
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("\n=== effectiveFocusOn gating ===");

test("focus toggle ON + focusCost > 0 → use focus", () => {
  assert.strictEqual(effectiveFocusOn(true, 38), true);
});
test("focus toggle ON + focusCost === 0 → DON'T use focus", () => {
  // fish sauce, fish chops, and any other item with no craftingfocus in items.xml
  assert.strictEqual(effectiveFocusOn(true, 0), false);
});
test("focus toggle OFF + focusCost > 0 → DON'T use focus", () => {
  assert.strictEqual(effectiveFocusOn(false, 38), false);
});
test("focus toggle OFF + focusCost === 0 → DON'T use focus", () => {
  assert.strictEqual(effectiveFocusOn(false, 0), false);
});

console.log("\n=== Resulting RRR — fish sauce (focusCost=0) NEVER gets focus boost ===");

test("Lymhurst, focusCost=0, toggle ON → base RRR only (no +59%)", () => {
  const useFocus = effectiveFocusOn(true, 0);
  assert.strictEqual(useFocus, false);
  const rrr = getCraftRRR("Lymhurst", "food", useFocus);
  // Base only: 0.18 / 1.18 ≈ 0.1525
  assert.ok(Math.abs(rrr - 0.18 / 1.18) < 1e-9, `expected base RRR, got ${rrr}`);
});

test("Caerleon (food spec), focusCost=0, toggle ON → base + spec only", () => {
  const useFocus = effectiveFocusOn(true, 0);
  const rrr = getCraftRRR("Caerleon", "food", useFocus);
  // base 0.18 + spec 0.15 = 0.33 → 0.33 / 1.33 ≈ 0.248
  assert.ok(Math.abs(rrr - 0.33 / 1.33) < 1e-9);
});

test("Lymhurst, focusCost=38 (meat), toggle ON → full RRR (base + focus)", () => {
  const useFocus = effectiveFocusOn(true, 38);
  const rrr = getCraftRRR("Lymhurst", null, useFocus);
  // base 0.18 + focus 0.59 = 0.77 → 0.77 / 1.77 ≈ 0.435
  assert.ok(Math.abs(rrr - 0.77 / 1.77) < 1e-9);
});

console.log("\n=== Tooltip strings — chain-craft path ===");

test("focusCost=0 → 'Not focus-craftable per items.xml' substring", () => {
  const title = makeChainCraftPpfTitle({ focusCost: 0, station: "butcher" });
  assert.ok(title.includes("Not focus-craftable per items.xml"), title);
  assert.ok(title.includes("base RRR still applied"), title);
});

test("focusCost=0 + cook station → same explanatory text (station-independent)", () => {
  const title = makeChainCraftPpfTitle({ focusCost: 0, station: "cook" });
  assert.ok(title.includes("Not focus-craftable per items.xml"));
});

test("focusCost > 0 → formula tooltip with profit, focus, RRR%", () => {
  const title = makeChainCraftPpfTitle({
    focusCost: 38, station: "butcher",
    profit: 100, output: 18, chainRrr: 0.435,
  });
  assert.ok(title.includes("profit/batch"));
  assert.ok(title.includes("38 focus"));
  assert.ok(title.includes("43.5%"));
  assert.ok(title.includes("output meat"));
});

test("focusCost > 0 + cook station → 'input refund' label", () => {
  const title = makeChainCraftPpfTitle({
    focusCost: 42, station: "cook",
    profit: 50, output: 1, chainRrr: 0.2,
  });
  assert.ok(title.includes("input refund"));
});

console.log("\n=== Tooltip strings — multi-ingredient craft path ===");

test("focusCost=0 → same 'Not focus-craftable' explanation", () => {
  const title = makeMultiIngredientPpfTitle({ focusCost: 0 });
  assert.ok(title.includes("Not focus-craftable per items.xml"));
  assert.ok(title.includes("base RRR still applied"));
});

test("focusCost > 0 → formula tooltip with crafts/10K-focus", () => {
  const title = makeMultiIngredientPpfTitle({
    focusCost: 100, profit: 50, craftsWithFocus: 100, focusRrr: 0.43,
  });
  assert.ok(title.includes("profit/10K focus"));
  assert.ok(title.includes("100 crafts"));
  assert.ok(title.includes("100 ea"));
  assert.ok(title.includes("43.0%"));
});

console.log("\n=== Cost arithmetic — fish chops with focus toggle ===");

// Mirror the chain-craft butcher cost math:
//   isButcher: effectiveCostPerOutput = perUnit * output / (output * (1 + chainRrr))
//                                     = perUnit / (1 + chainRrr)
function butcherCostPerChop(fishPrice, useFocus) {
  const rrr = getCraftRRR("Lymhurst", null, useFocus);
  return fishPrice * 1 / ((1) * (1 + rrr));  // chain.output=1 for T1 FW common
}

test("fish chops with focusCost=0, toggle ON → base-RRR cost only", () => {
  const useFocus = effectiveFocusOn(true, 0);
  const cost = butcherCostPerChop(100, useFocus);
  // Base RRR at Lymhurst: 0.18 / 1.18 ≈ 0.1525
  // effectiveOutput = 1 × (1 + 0.1525) = 1.1525 → cost = 100 / 1.1525 ≈ 86.79
  assert.ok(Math.abs(cost - 100 / (1 + 0.18 / 1.18)) < 1e-9);
});

test("fish chops cost SAME whether toggle on or off (focusCost=0)", () => {
  const costOn = butcherCostPerChop(100, effectiveFocusOn(true, 0));
  const costOff = butcherCostPerChop(100, effectiveFocusOn(false, 0));
  assert.strictEqual(costOn, costOff);
});

test("meat (focusCost=38) cost DROPS when toggle on", () => {
  const costOn = butcherCostPerChop(100, effectiveFocusOn(true, 38));
  const costOff = butcherCostPerChop(100, effectiveFocusOn(false, 38));
  assert.ok(costOn < costOff, `expected costOn (${costOn}) < costOff (${costOff})`);
});

console.log("\n=== Multi-ingredient render path — fish sauce inputs ignore RRR ===");

// Mirror render-consumables.js:670 — the multi-ingredient craft branch
// that drives the "(~Nx consumed)" annotation on every fish sauce row.
// When an input is flagged noReturn (fish sauce has this on both chops and
// seaweed), the consumed count stays at the raw recipe count regardless
// of the city's RRR. Same gate applies to butcher meat inputs and to
// enchant-sauce add-ons.
function effectiveIngredientCount(count, noReturn, rrr) {
  return noReturn ? count : count * (1 - rrr);
}

test("noReturn input ignores RRR at every base-city value (0.18/1.18)", () => {
  const baseRrr = 0.18 / 1.18;
  assert.strictEqual(effectiveIngredientCount(135, true, baseRrr), 135);
  assert.strictEqual(effectiveIngredientCount(45, true, baseRrr), 45);
  assert.strictEqual(effectiveIngredientCount(9, true, baseRrr), 9);
});

test("noReturn input ignores RRR at Caerleon food spec (0.33/1.33)", () => {
  const specRrr = 0.33 / 1.33;
  assert.strictEqual(effectiveIngredientCount(135, true, specRrr), 135);
});

test("noReturn input ignores RRR even when focus boost is on (0.77/1.77)", () => {
  // Guard against a future regression where someone passes effectiveFocusOn=true
  // to an item that shouldn't get it — the noReturn flag still wins.
  const focusRrr = 0.77 / 1.77;
  assert.strictEqual(effectiveIngredientCount(135, true, focusRrr), 135);
});

test("regular (returnable) input still drops by (1 - rrr)", () => {
  // Sanity: the flag is the only thing that flips behavior; without it,
  // RRR still applies to ordinary cook recipes like soup or salad.
  const baseRrr = 0.18 / 1.18;
  const expected = 100 * (1 - baseRrr);
  assert.ok(Math.abs(effectiveIngredientCount(100, false, baseRrr) - expected) < 1e-9);
});

// Mirror the totalInputCost accumulator at render-consumables.js:428.
// Verifies that a fish-sauce LEVEL3 row's input cost is invariant to the
// craft city's RRR when both ingredients are noReturn.
function totalInputCost(recipe, prices, rrr) {
  return recipe.reduce((sum, m) => {
    const eff = effectiveIngredientCount(m.count, m.noReturn, rrr);
    return sum + (prices[m.matId] ?? 0) * eff;
  }, 0);
}

test("fish sauce LEVEL3 input cost is identical at every city RRR", () => {
  const recipe = [
    { matId: "T1_FISHCHOPS", count: 135, noReturn: true },
    { matId: "T1_SEAWEED", count: 9, noReturn: true },
  ];
  const prices = { T1_FISHCHOPS: 161, T1_SEAWEED: 42 };
  const expected = 135 * 161 + 9 * 42; // 22113
  for (const rrr of [0, 0.18 / 1.18, 0.33 / 1.33, 0.77 / 1.77, 0.92 / 1.92]) {
    assert.strictEqual(totalInputCost(recipe, prices, rrr), expected,
      `cost should be invariant to RRR; got mismatch at rrr=${rrr}`);
  }
});

test("removing noReturn (regression guard) makes cost RRR-dependent", () => {
  const recipe = [
    { matId: "T1_FISHCHOPS", count: 135 },          // no flag → RRR applies
    { matId: "T1_SEAWEED", count: 9, noReturn: true },
  ];
  const prices = { T1_FISHCHOPS: 161, T1_SEAWEED: 42 };
  const baseRrr = 0.18 / 1.18;
  const expected = 135 * (1 - baseRrr) * 161 + 9 * 42;
  assert.ok(Math.abs(totalInputCost(recipe, prices, baseRrr) - expected) < 1e-9);
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
