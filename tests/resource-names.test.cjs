/**
 * Test: resourceShortName() — uniform short labels for raw/refined resources.
 *
 * Resources render as "<tier>[.<enchant>] <word>" (e.g. "T6.1 planks", "T4 bar",
 * "T3 logs") instead of tier-specific proper names. Non-resource ids return null
 * so getItemDisplayName falls through to its normal resolution.
 *
 * Black-box: feed an item id, assert the label (or null).
 *
 * Run: node tests/resource-names.test.cjs
 */

const assert = require("assert");
const { resourceShortName } = require("../js/resource-names.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name}\n    ${e.message}`); }
}

// ── Refined products: the row's "Refined" column word per family ──
const REFINED = {
  T2_PLANKS: "T2 planks", T3_PLANKS: "T3 planks", T6_PLANKS: "T6 planks",
  T4_METALBAR: "T4 bar", T8_METALBAR: "T8 bar",
  T2_LEATHER: "T2 leather", T7_LEATHER: "T7 leather",
  T4_CLOTH: "T4 cloth", T6_CLOTH: "T6 cloth",
  T2_STONEBLOCK: "T2 block", T5_STONEBLOCK: "T5 block",
};
for (const [id, expect] of Object.entries(REFINED)) {
  test(`refined ${id} -> "${expect}"`, () => assert.strictEqual(resourceShortName(id), expect));
}

// ── Raw materials: each family's raw word ──
const RAW = {
  T6_WOOD: "T6 logs", T2_WOOD: "T2 logs",
  T4_ORE: "T4 ore", T5_HIDE: "T5 hide",
  T4_FIBER: "T4 fiber", T5_ROCK: "T5 rock",
};
for (const [id, expect] of Object.entries(RAW)) {
  test(`raw ${id} -> "${expect}"`, () => assert.strictEqual(resourceShortName(id), expect));
}

// ── Enchant suffixes: both id forms (_LEVELn@n and @n) read the level ──
const ENCHANT = {
  "T6_PLANKS_LEVEL1@1": "T6.1 planks",
  "T6_WOOD_LEVEL2@2": "T6.2 logs",
  "T5_LEATHER@3": "T5.3 leather",          // short @n form
  "T4_CLOTH_LEVEL4@4": "T4.4 cloth",
};
for (const [id, expect] of Object.entries(ENCHANT)) {
  test(`enchant ${id} -> "${expect}"`, () => assert.strictEqual(resourceShortName(id), expect));
}

// ── Non-resources return null (so getItemDisplayName keeps its own name) ──
const NON_RESOURCE = [
  "T6_2H_BOW", "T4_ARMOR_CLOTH_SET1", "T4_HEAD_LEATHER_SET1",
  "QUESTITEM_TOKEN_MISTS", "T8_MOUNT_OX", "T1_FACTION_CAERLEON_TOKEN_1",
  "T4_PLANKS_BP", "", null, undefined, 42,
];
for (const id of NON_RESOURCE) {
  test(`non-resource ${JSON.stringify(id)} -> null`, () => assert.strictEqual(resourceShortName(id), null));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
