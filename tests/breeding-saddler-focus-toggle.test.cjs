/**
 * Test: "Use Focus" toggle propagates into the saddler stage of breeding rows.
 *
 * Bug: render-mounts.js:215 called `getCraftRRR(saddlerCity, null)` without
 * the third arg, so saddlerRrr always defaulted to focus-on. Toggling the
 * checkbox had no effect on Input Cost / Pure Profit / Profit % in any
 * breeding row that chains into a saddler step (most of them — every farmed
 * mount that's saddled into a riding mount).
 *
 * Black-box: mirror getCraftRRR + the saddler cost loop (render-mounts.js:
 * 220-248) and assert that disabling focus shrinks RRR and grows the
 * saddler material cost — but only for RRR-eligible inputs (leather, cloth,
 * metalbar, planks, stoneblock). Hearts and grown mounts are consumed 1:1.
 *
 * Run: node tests/breeding-saddler-focus-toggle.test.cjs
 */

const assert = require("assert");

// ── Mirror getCraftRRR from js/calculations.js ───────────────────────────────
const BASE_CITY_BONUS = 0.18;
const CRAFT_SPEC_BONUS = 0.15;
const FOCUS_BONUS = 0.59;
const CITY_CRAFT_SPEC = {
  Caerleon: ["food"],
  Brecilien: ["potion"],
};
function calcRRR(bonus) { return bonus <= 0 ? 0 : bonus / (1 + bonus); }
function getCraftRRR(city, craftType, useFocus = true) {
  let bonus = BASE_CITY_BONUS;
  const specs = CITY_CRAFT_SPEC[city];
  if (specs && craftType && specs.includes(craftType)) bonus += CRAFT_SPEC_BONUS;
  if (useFocus) bonus += FOCUS_BONUS;
  return calcRRR(bonus);
}

// ── Mirror isRrrEligible from js/render-mounts.js:91-94 ──────────────────────
const REFINED_MAT_RE = /^T[1-8]_(LEATHER|CLOTH|METALBAR|PLANKS|STONEBLOCK)(_LEVEL\d)?$/;
function isRrrEligible(matId) { return REFINED_MAT_RE.test(matId); }

// ── Mirror the saddler cost loop from render-mounts.js:220-248 ───────────────
// `recipe.materials` is the saddler recipe; matBestPrices is a per-matId lookup
// produced by the renderer's price-search pass. The grown mount has price=0
// here (the breeder produces it in-house), and the loop never multiplies it
// into the cost — same shape as the production code.
function computeSaddlerCost({ recipe, matBestPrices, grownId, saddlerCity, useFocus }) {
  const rrr = getCraftRRR(saddlerCity, null, useFocus); // mounts have no city spec
  let saddlerMatCost = 0;
  recipe.materials.forEach((m) => {
    if (m.matId === grownId) return; // produced in-house, not bought
    const { price, city } = matBestPrices[m.matId] || { price: 0, city: null };
    if (!city) return; // mirrors hasMissingSaddlerMats early-exit
    const effectiveCount = isRrrEligible(m.matId) ? m.count * (1 - rrr) : m.count;
    saddlerMatCost += price * effectiveCount;
  });
  return { rrr, saddlerMatCost };
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("\n=== Breeding saddler-stage focus-toggle propagation ===");

// Fixture: T6 Riding Horse saddler recipe — grown horse + 4 thick leather
// (RRR-eligible) + 2 hearts (NOT eligible). Realistic shapes for the assertion.
const GROWN_ID = "T6_FARM_HORSE";
const RECIPE = {
  materials: [
    { matId: GROWN_ID, count: 1 },
    { matId: "T6_LEATHER", count: 4 },
    { matId: "T1_FACTION_FOREST_TOKEN_1", count: 2 }, // heart fragment — no return
  ],
};
const MAT_PRICES = {
  [GROWN_ID]: { price: 0, city: "Lymhurst", isProduced: true },
  T6_LEATHER: { price: 8_000, city: "Lymhurst" },
  T1_FACTION_FOREST_TOKEN_1: { price: 12_000, city: "Lymhurst" },
};

test("focus-on saddler RRR > focus-off saddler RRR (Lymhurst, no mount spec)", () => {
  const on = computeSaddlerCost({ recipe: RECIPE, matBestPrices: MAT_PRICES, grownId: GROWN_ID, saddlerCity: "Lymhurst", useFocus: true });
  const off = computeSaddlerCost({ recipe: RECIPE, matBestPrices: MAT_PRICES, grownId: GROWN_ID, saddlerCity: "Lymhurst", useFocus: false });
  assert.ok(on.rrr > off.rrr, `focus-on RRR (${on.rrr}) should exceed focus-off RRR (${off.rrr})`);
});

test("disabling focus raises saddler material cost", () => {
  const on = computeSaddlerCost({ recipe: RECIPE, matBestPrices: MAT_PRICES, grownId: GROWN_ID, saddlerCity: "Lymhurst", useFocus: true });
  const off = computeSaddlerCost({ recipe: RECIPE, matBestPrices: MAT_PRICES, grownId: GROWN_ID, saddlerCity: "Lymhurst", useFocus: false });
  assert.ok(off.saddlerMatCost > on.saddlerMatCost,
    `focus-off saddler cost (${off.saddlerMatCost}) should exceed focus-on cost (${on.saddlerMatCost})`);
});

test("hearts (non-RRR-eligible) contribute the same cost regardless of focus", () => {
  const on = computeSaddlerCost({ recipe: RECIPE, matBestPrices: MAT_PRICES, grownId: GROWN_ID, saddlerCity: "Lymhurst", useFocus: true });
  const off = computeSaddlerCost({ recipe: RECIPE, matBestPrices: MAT_PRICES, grownId: GROWN_ID, saddlerCity: "Lymhurst", useFocus: false });
  // Hearts: 2 × 12_000 = 24_000 silver — same in both passes. The delta in
  // total saddler cost must come ONLY from the leather (RRR-eligible) line.
  const heartsCost = 2 * 12_000;
  const onLeather = on.saddlerMatCost - heartsCost;
  const offLeather = off.saddlerMatCost - heartsCost;
  // Sanity: leather portion is positive in both and bigger when focus off.
  assert.ok(onLeather > 0 && offLeather > 0 && offLeather > onLeather,
    `leather portion on=${onLeather} off=${offLeather}`);
  // Cross-check the math: leather contribution = 4 * 8000 * (1 - rrr)
  assert.ok(Math.abs(onLeather - 4 * 8_000 * (1 - on.rrr)) < 0.001, "on-leather cost matches RRR formula");
  assert.ok(Math.abs(offLeather - 4 * 8_000 * (1 - off.rrr)) < 0.001, "off-leather cost matches RRR formula");
});

test("grown mount input is skipped (produced in-house, never multiplied in)", () => {
  // Even if we falsely priced the grown mount at 99k, the loop must skip it.
  const matsWithFalseGrownPrice = {
    ...MAT_PRICES,
    [GROWN_ID]: { price: 99_000, city: "Lymhurst" }, // would dominate the cost if not skipped
  };
  const on = computeSaddlerCost({ recipe: RECIPE, matBestPrices: matsWithFalseGrownPrice, grownId: GROWN_ID, saddlerCity: "Lymhurst", useFocus: true });
  // Cost should still be leather (4×8000×(1-rrr)) + hearts (24_000) — no grown contribution.
  const expected = 4 * 8_000 * (1 - on.rrr) + 24_000;
  assert.ok(Math.abs(on.saddlerMatCost - expected) < 0.001,
    `grown mount skipped: expected ${expected}, got ${on.saddlerMatCost}`);
});

test("regression: pre-fix bug shape — getCraftRRR(city, null) ≡ focus-on", () => {
  // The bug was render-mounts.js:215 calling getCraftRRR(saddlerCity, null) with
  // no third arg, so useFocus defaulted to true regardless of UI state.
  const buggy = getCraftRRR("Lymhurst", null);          // pre-fix call shape
  const focusOn = getCraftRRR("Lymhurst", null, true);
  const focusOff = getCraftRRR("Lymhurst", null, false);
  assert.strictEqual(buggy, focusOn, "no-third-arg pins to focus-on");
  assert.notStrictEqual(buggy, focusOff, "if the fix were missing, focus-off path would mismatch");
});

test("FW mount: same toggle behavior at a faction-locked city (Thetford swamp dragon)", () => {
  // T5 swamp dragon FW is saddled at Thetford (faction-locked). Same RRR
  // formula applies — no spec for mounts, so toggling focus is the only knob.
  const onR = getCraftRRR("Thetford", null, true);
  const offR = getCraftRRR("Thetford", null, false);
  assert.ok(onR > offR, "Thetford focus-on > focus-off");
  assert.ok(Math.abs(onR - getCraftRRR("Lymhurst", null, true)) < 1e-9,
    "every non-spec royal city yields identical RRR for mount craft");
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
