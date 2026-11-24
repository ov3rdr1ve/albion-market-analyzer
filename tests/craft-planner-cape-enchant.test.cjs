/**
 * Tests for enchant handling of faction/smuggler capes in the Crafting Planner
 * plus the lazy on-demand variant-price id collection.
 *
 * Feature under test (js/render-craft-planner.js):
 *   1. `_CAPEITEM_` combine capes DO enchant (.1–.4 exist in-game). The planner
 *      must emit their enchant variants, and each .n must consume the ENCHANTED
 *      base cape (T*_CAPE@n) while the crest (_BP) and faction token stay flat.
 *   2. The base scan skips @n ids for speed, so newly-shown variant rows are
 *      priced lazily. `_cpCollectVariantIds` gathers exactly the ids one
 *      enchant level (picker) or one base item (row expand) needs priced.
 *
 * Black-box: drive the REAL expandCraftPlannerItems / _cpCollectVariantIds over
 * a synthetic catalogue and assert the id/material sets. No DOM, no network.
 *
 * Run: node tests/craft-planner-cape-enchant.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

// Minimal catalogue: a faction cape (combine), a mainline weapon (refined-mat
// gear), and a furniture item (no enchant ladder).
const sandbox = `
const CRAFTING_ITEMS = [
  { id:"T6_CAPEITEM_FW_BRIDGEWATCH", name:"Expert's Bridgewatch Cape [T6]", craftType:"cape", isGearRecipe:true,
    materials:[ {matId:"T6_CAPE",count:1}, {matId:"T6_CAPEITEM_FW_BRIDGEWATCH_BP",count:1}, {matId:"T1_FACTION_STEPPE_TOKEN_1",count:3} ] },
  { id:"T6_2H_BOW", name:"Expert's Bow [T6]", matId:"T6_PLANKS", craftType:"bow", isGearRecipe:true,
    materials:[ {matId:"T6_PLANKS",count:16} ] },
  { id:"T6_FURNITUREITEM_TABLE", name:"Table [T6]", craftType:null,
    materials:[ {matId:"T6_PLANKS",count:30} ] },
];
`;

function loadFile(rel) { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); }
const mod = new Module("craft-planner-cape-enchant-test");
mod._compile(
  sandbox +
    loadFile("js/craft-planner-quality.js") +   // planner globals shared with the renderer
    loadFile("js/render-craft-planner.js") +
    // The lazy variant fetch lives in its own file (js/craft-planner-variant-prices.js);
    // in the browser both are plain scripts sharing one scope, which is what
    // concatenating them here reproduces.
    loadFile("js/craft-planner-variant-prices.js") +
    "\nmodule.exports = { expandCraftPlannerItems, _cpEnchantVariant, _cpCollectVariantIds, CRAFTING_ITEMS };",
  "render-craft-planner.js"
);
const { expandCraftPlannerItems, _cpEnchantVariant, _cpCollectVariantIds, CRAFTING_ITEMS } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); console.log(`  PASS: ${name}`); passed++; } catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; } }

const idsOf = (arr) => arr.map((i) => i.id);
const capeBase = CRAFTING_ITEMS[0];

console.log("Craft Planner — cape enchant variants + lazy price ids\n");

// ── 1. Faction cape enchants (CAPEITEM matched) ──────────────────────────────
test("faction cape expands to base + .1–.4 variants", () => {
  const ids = idsOf(expandCraftPlannerItems([capeBase]));
  assert.deepStrictEqual(ids, [
    "T6_CAPEITEM_FW_BRIDGEWATCH",
    "T6_CAPEITEM_FW_BRIDGEWATCH@1",
    "T6_CAPEITEM_FW_BRIDGEWATCH@2",
    "T6_CAPEITEM_FW_BRIDGEWATCH@3",
    "T6_CAPEITEM_FW_BRIDGEWATCH@4",
  ]);
});

test("cape .n consumes the ENCHANTED base cape (T*_CAPE@n); crest + token stay flat", () => {
  const v2 = _cpEnchantVariant(capeBase, 2);
  const mats = v2.materials.map((m) => m.matId);
  assert.ok(mats.includes("T6_CAPE@2"), "base cape must enchant to @2, got " + mats.join(","));
  assert.ok(mats.includes("T6_CAPEITEM_FW_BRIDGEWATCH_BP"), "crest must stay flat");
  assert.ok(mats.includes("T1_FACTION_STEPPE_TOKEN_1"), "token must stay flat");
  assert.ok(!mats.some((m) => /_BP@/.test(m) || /TOKEN.*@/.test(m)), "crest/token must NOT be enchanted");
});

test("cape variant name carries the .n tier tag", () => {
  assert.strictEqual(_cpEnchantVariant(capeBase, 3).name, "Expert's Bridgewatch Cape [T6.3]");
});

// ── 2. Refined-mat gear still enchants via _LEVELn@n (regression) ─────────────
test("weapon .n enchants its refined resource mat to _LEVELn@n", () => {
  const bow = CRAFTING_ITEMS[1];
  const mats = _cpEnchantVariant(bow, 4).materials.map((m) => m.matId);
  assert.deepStrictEqual(mats, ["T6_PLANKS_LEVEL4@4"]);
});

test("furniture stays a single base row (no enchant ladder)", () => {
  const furn = CRAFTING_ITEMS[2];
  assert.deepStrictEqual(idsOf(expandCraftPlannerItems([furn])), ["T6_FURNITUREITEM_TABLE"]);
});

// ── 2b. The slot token may END the id, and the ladder starts at T4 ───────────
//
// `T4_BAG` and `T4_CAPE` carry nothing after the slot token. They were matched
// by a pattern that demanded a trailing `_`, so plain bags and capes lost their
// .1–.4 rows even though both enchant in-game. The catalogue also carries T2/T3
// gear now (js/gear.js), which has no enchanted form at all — the tier gate is
// what keeps those to a single row.
const LADDER_CASES = [
  { id: "T4_BAG", name: "Adept's Bag [T4]", variants: true },
  { id: "T4_CAPE", name: "Adept's Cape [T4]", variants: true },
  { id: "T8_BAG_INSIGHT", name: "Elder's Satchel of Insight [T8]", variants: true },
  { id: "T4_HEAD_CLOTH_SET1", name: "Adept's Scholar Cowl [T4]", variants: true },
  { id: "T2_BAG", name: "Novice's Bag [T2]", variants: false },
  { id: "T3_BAG", name: "Journeyman's Bag [T3]", variants: false },
  { id: "T3_CAPE", name: "Journeyman's Cape [T3]", variants: false },
  { id: "T2_2H_TOOL_PICK", name: "Novice's Pickaxe [T2]", variants: false },
];

LADDER_CASES.forEach(({ id, name, variants }) => {
  test(`${id} → ${variants ? "base + .1–.4" : "base row only"}`, () => {
    const item = { id, name, craftType: "x", isGearRecipe: true, materials: [{ matId: "T4_CLOTH", count: 8 }] };
    const want = variants ? [id, `${id}@1`, `${id}@2`, `${id}@3`, `${id}@4`] : [id];
    assert.deepStrictEqual(idsOf(expandCraftPlannerItems([item])), want);
  });
});

// ── 3. Lazy price-id collection ──────────────────────────────────────────────
test("collect by enchant level: only that level's outputs + enchanted mats", () => {
  const ids = _cpCollectVariantIds({ enchLevel: 1 });
  // cape @1 output + its enchanted base cape + flat crest/token
  assert.ok(ids.includes("T6_CAPEITEM_FW_BRIDGEWATCH@1"));
  assert.ok(ids.includes("T6_CAPE@1"));
  assert.ok(ids.includes("T6_CAPEITEM_FW_BRIDGEWATCH_BP"));
  assert.ok(ids.includes("T1_FACTION_STEPPE_TOKEN_1"));
  // weapon @1 output + enchanted refined mat
  assert.ok(ids.includes("T6_2H_BOW@1"));
  assert.ok(ids.includes("T6_PLANKS_LEVEL1@1"));
  // must NOT reach into other enchant levels
  assert.ok(!ids.some((id) => /@[234]$/.test(id) || /_LEVEL[234]@/.test(id)),
    "level-1 fetch leaked other levels: " + ids.filter((id) => /@[234]$/.test(id) || /_LEVEL[234]@/.test(id)));
  // furniture has no variants → never requested
  assert.ok(!ids.some((id) => id.includes("FURNITURE")));
});

test("collect by baseId: only that base item's four variants", () => {
  const ids = _cpCollectVariantIds({ baseId: "T6_2H_BOW" });
  assert.ok(ids.includes("T6_2H_BOW@1") && ids.includes("T6_2H_BOW@4"));
  assert.ok(ids.includes("T6_PLANKS_LEVEL2@2"));
  // no cape ids in a bow-scoped fetch
  assert.ok(!ids.some((id) => id.includes("CAPEITEM")));
});

test("collect with no target returns nothing", () => {
  assert.deepStrictEqual(_cpCollectVariantIds({}), []);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
