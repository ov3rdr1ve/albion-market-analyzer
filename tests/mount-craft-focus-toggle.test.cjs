/**
 * Test: "Use Focus" toggle propagates into mount-craft rows.
 *
 * Bug: render-mounts.js:428 called `getCraftRRR(craftCity, null)` without
 * the third arg, so the mount-craft rrr always defaulted to focus-on.
 * Toggling the checkbox had no effect on the mount-craft rows in the Mounts
 * table (Battle Mounts, transport saddled mounts, etc).
 *
 * Black-box: mirror getCraftRRR + the mount-craft cost loop (render-mounts.js:
 * 461-464) and assert that disabling focus shrinks RRR, raises input cost,
 * and lowers profit. Mounts have no city-craft specialization, so only the
 * focus toggle moves the dial.
 *
 * Run: node tests/mount-craft-focus-toggle.test.cjs
 */

const assert = require("assert");

// ── Mirror getCraftRRR (mounts pass craftType=null, so spec is never added) ──
const BASE_CITY_BONUS = 0.18;
const FOCUS_BONUS = 0.59;
function calcRRR(bonus) { return bonus <= 0 ? 0 : bonus / (1 + bonus); }
function getCraftRRR(city, craftType, useFocus = true) {
  let bonus = BASE_CITY_BONUS;
  // mounts pass null — no spec bonus is ever applied here.
  if (useFocus) bonus += FOCUS_BONUS;
  return calcRRR(bonus);
}

// ── Mirror isRrrEligible from js/render-mounts.js:91-94 ──────────────────────
const REFINED_MAT_RE = /^T[1-8]_(LEATHER|CLOTH|METALBAR|PLANKS|STONEBLOCK)(_LEVEL\d)?$/;
function isRrrEligible(matId) { return REFINED_MAT_RE.test(matId); }

// ── Mirror the mount-craft cost + margin loop from render-mounts.js:461-475 ──
function computeMountCraft({ materials, matBestPrices, sellPrice, craftCity, useFocus }) {
  const SETUP_FEE = 0.025;
  const PREMIUM_TAX = 0.065;
  const rrr = getCraftRRR(craftCity, null, useFocus);
  let totalInputCost = 0;
  materials.forEach((m) => {
    const effectiveCount = isRrrEligible(m.matId) ? m.count * (1 - rrr) : m.count;
    totalInputCost += matBestPrices[m.matId].price * effectiveCount * (1 + SETUP_FEE);
  });
  const revenue = sellPrice * (1 - PREMIUM_TAX);
  const profit = revenue - totalInputCost;
  const margin = totalInputCost > 0 ? (profit / totalInputCost) * 100 : 0;
  return { rrr, totalInputCost, profit, margin };
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("\n=== Mount-craft focus-toggle propagation ===");

// Fixture: a battle mount craft recipe — leather (RRR-eligible) + cloth
// (RRR-eligible) + an artifact-style heart fragment (NOT eligible).
const MATERIALS = [
  { matId: "T7_LEATHER", count: 12 },
  { matId: "T7_CLOTH",   count: 8 },
  { matId: "T1_FACTION_SWAMP_TOKEN_1", count: 4 }, // heart — no return
];
const MAT_PRICES = {
  T7_LEATHER: { price: 24_000 },
  T7_CLOTH:   { price: 18_000 },
  T1_FACTION_SWAMP_TOKEN_1: { price: 9_000 },
};
const SELL_PRICE = 1_400_000;

test("focus-on RRR > focus-off RRR (Thetford, no spec for mounts)", () => {
  const on = computeMountCraft({ materials: MATERIALS, matBestPrices: MAT_PRICES, sellPrice: SELL_PRICE, craftCity: "Thetford", useFocus: true });
  const off = computeMountCraft({ materials: MATERIALS, matBestPrices: MAT_PRICES, sellPrice: SELL_PRICE, craftCity: "Thetford", useFocus: false });
  assert.ok(on.rrr > off.rrr, `focus-on RRR (${on.rrr}) should exceed focus-off (${off.rrr})`);
});

test("disabling focus raises input cost", () => {
  const on = computeMountCraft({ materials: MATERIALS, matBestPrices: MAT_PRICES, sellPrice: SELL_PRICE, craftCity: "Thetford", useFocus: true });
  const off = computeMountCraft({ materials: MATERIALS, matBestPrices: MAT_PRICES, sellPrice: SELL_PRICE, craftCity: "Thetford", useFocus: false });
  assert.ok(off.totalInputCost > on.totalInputCost,
    `focus-off cost (${off.totalInputCost}) should exceed focus-on cost (${on.totalInputCost})`);
});

test("disabling focus shrinks profit and margin", () => {
  const on = computeMountCraft({ materials: MATERIALS, matBestPrices: MAT_PRICES, sellPrice: SELL_PRICE, craftCity: "Thetford", useFocus: true });
  const off = computeMountCraft({ materials: MATERIALS, matBestPrices: MAT_PRICES, sellPrice: SELL_PRICE, craftCity: "Thetford", useFocus: false });
  assert.ok(off.profit < on.profit, `focus-off profit (${off.profit}) should be smaller than focus-on (${on.profit})`);
  assert.ok(off.margin < on.margin, `focus-off margin (${off.margin}) should be smaller than focus-on (${on.margin})`);
});

test("non-RRR-eligible inputs (hearts) contribute the same cost regardless of focus", () => {
  // Hearts: 4 × 9_000 × (1 + 0.025) = 36_900 silver. Always the same.
  const SETUP_FEE = 0.025;
  const heartsCost = 4 * 9_000 * (1 + SETUP_FEE);
  const on = computeMountCraft({ materials: MATERIALS, matBestPrices: MAT_PRICES, sellPrice: SELL_PRICE, craftCity: "Thetford", useFocus: true });
  const off = computeMountCraft({ materials: MATERIALS, matBestPrices: MAT_PRICES, sellPrice: SELL_PRICE, craftCity: "Thetford", useFocus: false });
  // The delta between focus-on and focus-off must come from leather + cloth only,
  // not hearts. Subtract hearts from both and confirm the remainder math.
  const onMinusHearts = on.totalInputCost - heartsCost;
  const offMinusHearts = off.totalInputCost - heartsCost;
  assert.ok(offMinusHearts > onMinusHearts, "leather+cloth portion grows when focus off");
  // Cross-check: focus-off remainder ≈ 12 * 24_000 * (1-rrr_off) * 1.025
  //                                  + 8 * 18_000 * (1-rrr_off) * 1.025
  const expectedOff = (12 * 24_000 + 8 * 18_000) * (1 - off.rrr) * (1 + SETUP_FEE);
  assert.ok(Math.abs(offMinusHearts - expectedOff) < 0.01,
    `expected off-cost minus hearts ~${expectedOff}, got ${offMinusHearts}`);
});

test("regression: pre-fix bug shape — getCraftRRR(city, null) ≡ focus-on", () => {
  // Pre-fix render-mounts.js:428 called getCraftRRR(craftCity, null) — useFocus
  // defaulted to true so the toggle was a no-op for mount-craft rows.
  const buggy = getCraftRRR("Thetford", null);
  const focusOn = getCraftRRR("Thetford", null, true);
  const focusOff = getCraftRRR("Thetford", null, false);
  assert.strictEqual(buggy, focusOn, "no-third-arg pins to focus-on");
  assert.notStrictEqual(buggy, focusOff, "if the fix were missing, focus-off path would mismatch");
});

test("all-non-RRR-eligible recipe: focus has zero effect on input cost", () => {
  // A hypothetical mount-craft made entirely of hearts (no leather/cloth).
  // RRR has nothing to bite into, so toggling focus must not change cost.
  const allHearts = [{ matId: "T1_FACTION_SWAMP_TOKEN_1", count: 10 }];
  const on = computeMountCraft({ materials: allHearts, matBestPrices: MAT_PRICES, sellPrice: SELL_PRICE, craftCity: "Thetford", useFocus: true });
  const off = computeMountCraft({ materials: allHearts, matBestPrices: MAT_PRICES, sellPrice: SELL_PRICE, craftCity: "Thetford", useFocus: false });
  assert.strictEqual(on.totalInputCost, off.totalInputCost,
    "no RRR-eligible mats means focus toggle has no cost effect");
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
