/**
 * Test: Fire Dragon Scales (T4-T8_SHARD_FIRE_DRAGON) and the Dragonhide
 * artifacts they buy are first-class tradeable items, exactly like Crystal
 * Shards.
 *
 * Reported bug: "dragon scales pieces and artifacts missing". The scales had no
 * name (raw id leaked), category "Other", no Flipping row, the gear-class travel
 * weight fallback, and no Brecilien fee row. Crystal Shards, their sibling
 * exchange fragment, were all wired.
 *
 * Black-box: real catalogs loaded in the browser order; assertions on outputs
 * only. No live API / DB — document/localStorage are stubbed.
 *
 * Run: node tests/fire-dragon-scales-catalog.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

globalThis.tx = globalThis.tx || ((en) => en);

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const stubs = `
const document = { getElementById: () => null, addEventListener: () => {}, querySelector: () => null };
const window = { addEventListener: () => {} };
const localStorage = { getItem: () => null, setItem: () => {} };
`;

const src =
  stubs +
  J("item-names.js") + J("resource-names.js") + J("data-artifacts.js") + J("data.js") +
  J("data-consumables.js") + J("data-mounts.js") +
  J("gear-cloth-armor.js") + J("gear-leather-armor.js") + J("gear-leather-dragon.js") + J("gear-plate-armor.js") +
  J("gear-melee-light.js") + J("gear-melee-heavy.js") + J("gear-ranged.js") +
  J("gear-staves-a.js") + J("gear-staves-b.js") + J("gear-staves-c.js") +
  J("gear-offhand.js") + J("gear-capes.js") + J("gear-tools.js") + J("gear-gatherer.js") +
  J("gear-crystal-weapons.js") + J("gear-crystal-weapons-b.js") + J("gear-token-substitute.js") +
  J("gear.js") + J("data-flip-extras.js") + (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) +
  "\nbuildArtifactFlipItems(); buildResourceFlipItems();" +
  "\nmodule.exports = { getAllFlippingItems, getItemDisplayName, getItemCategory, ARTIFACT_FLIP_ITEMS };";

const mod = new Module("fire-dragon-scales-catalog");
mod.paths = Module._nodeModulePaths(process.cwd());
mod._compile(src, "fire-dragon-scales-catalog.js");
const { getAllFlippingItems, getItemDisplayName, getItemCategory } = mod.exports;

const tc = require("../js/travel-cost.js");

// The Brecilien fee table is a browser IIFE; load it with a window stub the way
// tests/brecilien-fees-table.test.cjs does, reading the built rows.
const feeWindow = {};
new Function(
  "window", "document", "brecilienExitCostPerUnit", "tx",
  J("render-brecilien-fees.js")
)(feeWindow, { addEventListener: () => {}, querySelector: () => null, getElementById: () => null },
  tc.brecilienExitCostPerUnit, (en) => en);
const feeRows = feeWindow.buildBrecilienFeeRows();

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name}\n    ${e.message}`); }
}

const TIERS = [4, 5, 6, 7, 8];
const TIER_WORDS = { 4: "Adept's", 5: "Expert's", 6: "Master's", 7: "Grandmaster's", 8: "Elder's" };
const flipIds = new Set(getAllFlippingItems().map((i) => i.id));

console.log("Fire Dragon Scales catalog\n");

TIERS.forEach((t) => {
  const id = `T${t}_SHARD_FIRE_DRAGON`;
  test(`${id}: display name is "${TIER_WORDS[t]} Fire Dragon Scales"`, () => {
    assert.strictEqual(getItemDisplayName(id), `${TIER_WORDS[t]} Fire Dragon Scales`);
  });
  test(`${id}: category matches T${t}_SHARD_CRYSTAL`, () => {
    const expected = getItemCategory(`T${t}_SHARD_CRYSTAL`);
    assert.strictEqual(expected, "Fragment");
    assert.strictEqual(getItemCategory(id), expected);
  });
  test(`${id}: present in getAllFlippingItems()`, () => {
    assert.ok(flipIds.has(id), `${id} missing from Flipping universe`);
  });
  test(`${id}: travel weight is the artifact-mat tier weight, not the gear fallback`, () => {
    assert.strictEqual(tc.getItemWeight(id), tc.getItemWeight(`T${t}_SHARD_CRYSTAL`));
    assert.ok(tc.getItemWeight(id) <= 1, `weight ${tc.getItemWeight(id)} looks like the gear fallback`);
  });
  test(`${id}: Brecilien exit fee equals the same-tier Crystal Shard`, () => {
    assert.strictEqual(
      tc.brecilienExitCostPerUnit(id),
      tc.brecilienExitCostPerUnit(`T${t}_SHARD_CRYSTAL`)
    );
  });
});

test("Brecilien fee table has a Fire Dragon Scales row equal to Crystal Shard per tier", () => {
  const scales = feeRows.find((r) => r.kind === "tiered" && r.label === "Fire Dragon Scales");
  const crystal = feeRows.find((r) => r.kind === "tiered" && r.label === "Crystal Shard");
  assert.ok(scales, "no Fire Dragon Scales row");
  TIERS.forEach((t) => assert.strictEqual(scales.fees[t], crystal.fees[t]));
});

console.log("\nDragonhide artifacts (guard)");

["HEAD", "ARMOR", "SHOES"].forEach((slot) => {
  TIERS.forEach((t) => {
    const id = `T${t}_ARTEFACT_${slot}_LEATHER_DRAGON`;
    test(`${id}: resolves a real name and is in getAllFlippingItems()`, () => {
      const name = getItemDisplayName(id);
      assert.notStrictEqual(name, id, "raw id leaked as name");
      assert.ok(flipIds.has(id), `${id} missing from Flipping universe`);
    });
  });
});

console.log(`\nTotal: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
