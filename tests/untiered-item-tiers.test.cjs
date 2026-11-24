/**
 * Tier resolution for ids that carry no "T<n>_" prefix.
 *
 * getTierFromId parses the tier out of the id, and fell back to 4 for anything
 * that doesn't start with "T<n>_". Two market items have no prefix but DO have
 * a real tier in items.xml:
 *   UNIQUE_GVGTOKEN_GENERIC  (Siphoned Energy)   tier="1"
 *   QUESTITEM_TOKEN_AVALON   (Avalonian Energy)  tier="6"
 * Both were reported as T4 (Flipping tier column, Brecilien fee table row).
 *
 * Black-box: drive the REAL getTierFromId from js/utils.js. No live data.
 *
 * Run: node tests/untiered-item-tiers.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const sandbox = `
module.exports = { getTierFromId, UNTIERED_ITEM_TIERS };
`;

const src =
  ["utils", "utils-item-ids", "utils-overrides", "utils-focus-fees"].map((n) => fs.readFileSync(path.join(__dirname, "..", "js", n + ".js"), "utf8")).join("\n") +
  "\n" +
  sandbox;
const mod = new Module("untiered-item-tiers");
mod.paths = Module._nodeModulePaths(process.cwd());
mod._compile(src, "untiered-item-tiers.js");
const { getTierFromId, UNTIERED_ITEM_TIERS } = mod.exports;

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.error(`FAIL  ${name}\n      ${e.message}`); }
}

// [id, expected tier]
const CASES = [
  // The two prefix-less tokens — the fix.
  ["UNIQUE_GVGTOKEN_GENERIC", 1],
  ["QUESTITEM_TOKEN_AVALON", 6],
  // Regression: normal ids keep parsing off the prefix.
  ["T1_WORM", 1],
  ["T2_WOOD", 2],
  ["T4_SWORD", 4],
  ["T4_WOOD_LEVEL1@1", 4],
  ["T5_WOOD_LEVEL4@4", 5],
  ["T6_2H_BOW@3", 6],
  ["T8_PLANKS", 8],
  // Regression: unknown prefix-less ids still fall back to 4.
  ["UNIQUE_HIDEOUT", 4],
  ["UNIQUE_LOOTCHEST_CONQUEROR_FAVOR_PURCHASE", 4],
  ["", 4],
  [null, 4],
];

CASES.forEach(([id, tier]) => {
  check(`getTierFromId(${JSON.stringify(id)}) === ${tier}`, () => {
    assert.strictEqual(getTierFromId(id), tier);
  });
});

check("UNTIERED_ITEM_TIERS holds both tokens with items.xml tiers", () => {
  assert.strictEqual(UNTIERED_ITEM_TIERS.UNIQUE_GVGTOKEN_GENERIC, 1);
  assert.strictEqual(UNTIERED_ITEM_TIERS.QUESTITEM_TOKEN_AVALON, 6);
});

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — untiered-item-tiers`);
process.exit(failures === 0 ? 0 : 1);
