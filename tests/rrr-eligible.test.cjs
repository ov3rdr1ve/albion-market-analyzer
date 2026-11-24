/**
 * Test: which materials the resource return rate gives back (js/rrr-eligible.js).
 *
 * RRR only refunds REFINED station resources. Everything else in a recipe —
 * artifacts, tomes, tokens, grown mounts, quest items, raw resources — is
 * consumed 1:1, and costing it net of the return rate understates the craft.
 *
 * The enchanted forms count: a .1–.4 craft consumes T5_CLOTH_LEVEL1@1, which is
 * refined at the same station as T5_CLOTH and refunded the same way. Missing
 * that made My Crafting List shop the GROSS count for every enchanted row while
 * the row's own Input Cost was net — the ~2x drift the list exists to avoid.
 *
 * Run: node tests/rrr-eligible.test.cjs
 */

const assert = require("assert");
const path = require("path");
const { isRrrEligible } = require(path.join(__dirname, "..", "js", "rrr-eligible.js"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

[
  // refined bars, plain
  ["T4_CLOTH", true],
  ["T5_LEATHER", true],
  ["T6_METALBAR", true],
  ["T7_PLANKS", true],
  ["T8_STONEBLOCK", true],
  // refined bars, enchanted — the AODP id carries BOTH the level and the @n
  ["T5_CLOTH_LEVEL1@1", true],
  ["T6_LEATHER_LEVEL2@2", true],
  ["T8_METALBAR_LEVEL4@4", true],
  // the _LEVELn half alone (some catalogues spell it without the @n)
  ["T5_PLANKS_LEVEL3", true],
  // raw resources are gathered, not refined — the refine CONSUMES them
  ["T5_FIBER", false],
  ["T6_ORE", false],
  ["T4_HIDE_LEVEL1@1", false],
  // non-returnable recipe inputs
  ["T4_SKILLBOOK_STANDARD", false],
  ["T6_ARTEFACT_2H_AXE", false],
  ["T5_MOUNT_HORSE", false],
  ["QUESTITEM_TOKEN_ROYAL", false],
  ["T6_MEAT", false],
  // an equipment id that merely CONTAINS a resource word is not a bar
  ["T6_ARMOR_CLOTH_SET1", false],
  ["T6_ARMOR_CLOTH_SET1@2", false],
  // junk in, false out (never throw — recipes carry odd ids)
  ["", false],
  [null, false],
  [undefined, false],
].forEach(([matId, want]) => {
  test(`${JSON.stringify(matId)} → ${want}`, () => {
    assert.strictEqual(isRrrEligible(matId), want);
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
