/**
 * Test: getFocusCost returns 0 for items not in FOCUS_COSTS (no tier fallback).
 * Items absent from focus-costs.json have craftingfocus="0" in the game data,
 * meaning focus cannot be used to craft them.
 *
 * Run: node tests/focus-cost-fallback.test.cjs
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

// ── helpers ────────────────────────────────────────────────────────────
function loadFileContent(relPath) {
  return fs.readFileSync(path.join(__dirname, "..", relPath), "utf-8");
}

// Load FOCUS_COSTS and getFocusCost
const focusCostsJson = JSON.parse(
  loadFileContent("js/focus-costs.json")
);
const utilsSrc = (loadFileContent("js/utils.js") + loadFileContent("js/utils-item-ids.js") + loadFileContent("js/utils-overrides.js") + loadFileContent("js/utils-focus-fees.js"));

// Provide FOCUS_COSTS global and extract getFocusCost
const sandbox = new Function(
  `const FOCUS_COSTS = ${JSON.stringify(focusCostsJson)};
   ${utilsSrc};
   return { getFocusCost };`
)();
const { getFocusCost } = sandbox;

// ── tests ──────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

console.log("Focus Cost Fallback Tests\n");

// Items that exist in focus-costs.json should return their correct value
const knownItems = [
  ["T5_CAPE", 750],
  ["T7_FURNITUREITEM_TABLE", 5627],
  ["T4_CAPE", 429],
  ["T4_MAIN_SWORD", 1286],
  ["T8_METALBAR", 503],
];

knownItems.forEach(([id, expected]) => {
  test(`known item ${id} returns ${expected}`, () => {
    assert.strictEqual(getFocusCost(id, parseInt(id[1])), expected);
  });
});

// CAPEITEM variants (artifact / faction capes) are a zero-focus COMBINE of a
// finished base cape + cape artifact + tokens — items.xml gives them all
// craftingfocus="0". They must NOT inherit the base cape's focus (the old
// fallback double-counted focus already paid on the separate base-cape craft).
const capeItems = [
  "T5_CAPEITEM_MORGANA",
  "T4_CAPEITEM_FW_BRIDGEWATCH",
  "T5_CAPEITEM_FW_FORTSTERLING",
  "T5_CAPEITEM_FW_THETFORD",
  "T6_CAPEITEM_KEEPER",
  "T7_CAPEITEM_MORGANA",
  "T8_CAPEITEM_FW_BRIDGEWATCH",
  "T4_CAPEITEM_AVALON",
  "T8_CAPEITEM_AVALON",
];

capeItems.forEach((id) => {
  const tier = parseInt(id.slice(1, id.indexOf("_")), 10);
  test(`CAPEITEM ${id} is a 0-focus combine (no base-CAPE fallback)`, () => {
    assert.strictEqual(getFocusCost(id, tier), 0);
    // Even with a category, a 0 base stays 0 (no reduction floor kicks in).
    assert.strictEqual(getFocusCost(id, tier, "crafting"), 0);
  });
});

// ROYAL armor is a zero-focus COMBINE (base SETn armor + Royal Sigil tokens,
// craftingfocus="0") — like capes. It must NOT inherit the base SET1 focus (the
// old fallback double-counted focus already paid on the separate SETn craft).
const royalItems = [
  ["T8_HEAD_CLOTH_ROYAL", 8],
  ["T8_SHOES_LEATHER_ROYAL", 8],
  ["T8_SHOES_PLATE_ROYAL", 8],
  ["T8_ARMOR_CLOTH_ROYAL", 8],
  ["T6_HEAD_PLATE_ROYAL", 6],
];

royalItems.forEach(([id, tier]) => {
  test(`ROYAL item ${id} is a 0-focus combine (no SET1 fallback)`, () => {
    assert.strictEqual(getFocusCost(id, tier), 0);
    assert.strictEqual(getFocusCost(id, tier, "crafting"), 0);
  });
});

// Enchantment suffix stripping should still work
// T4_MAIN_SWORD@1 has its own entry (2251) — should use it, not the base
test("T4_MAIN_SWORD@1 uses its own enchanted entry", () => {
  const result = getFocusCost("T4_MAIN_SWORD@1", 4);
  assert.strictEqual(result, 2251);
});

// Items with their own enchanted entries should use those
test("T4_METALBAR@1 uses its own entry (not base)", () => {
  const result = getFocusCost("T4_METALBAR@1", 4);
  assert.ok(result > 0, "Should have its own focus cost");
});

// calculateProfitPerFocus should return 0 when focusCost is 0
const calcSrc = (loadFileContent("js/calculations.js") + loadFileContent("js/calculations-margins.js"));
const { calculateProfitPerFocus } = new Function(
  `${calcSrc}; return { calculateProfitPerFocus };`
)();

test("calculateProfitPerFocus returns 0 when focusCost is 0", () => {
  assert.strictEqual(calculateProfitPerFocus(50000, 0), 0);
});

test("calculateProfitPerFocus returns correct ratio for valid focusCost", () => {
  const result = calculateProfitPerFocus(1000, 500);
  assert.strictEqual(result, 2);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
