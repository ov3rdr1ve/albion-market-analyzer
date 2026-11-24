/**
 * The gear catalogue's tier floor (js/gear.js).
 *
 * GEAR_RECIPES is what js/app.js injects into CRAFTING_ITEMS, and CRAFTING_ITEMS
 * is the only row source of the Crafting table, the Crafting Planner and the
 * flip universe. It used to be filtered to T4+, so T2/T3 gear — the bags most
 * visibly — existed in the catalogue files and appeared in no table at all.
 *
 * T1 stays excluded: a T1 item has no marketplace, so a T1 row could never be
 * priced. GEAR_RECIPES_ALL keeps T1 because the crafting JOURNALS count the
 * craft, not the sale (js/laborer-craft-fill.js).
 *
 * Black box: the two exported arrays, checked against ids and recipes read from
 * items.xml. No app, no prices, no DOM.
 *
 * Run: node tests/gear-low-tier-catalog.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const loadFile = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const GEAR_FILES = [
  "js/gear-cloth-armor.js", "js/gear-leather-armor.js", "js/gear-leather-dragon.js", "js/gear-plate-armor.js",
  "js/gear-melee-light.js", "js/gear-melee-heavy.js", "js/gear-ranged.js",
  "js/gear-staves-a.js", "js/gear-staves-b.js", "js/gear-staves-c.js",
  "js/gear-offhand.js", "js/gear-capes.js", "js/gear-tools.js", "js/gear-gatherer.js",
  "js/gear-crystal-weapons.js", "js/gear-crystal-weapons-b.js",
];

const mod = new Module("gear-low-tier-catalog-test");
mod._compile(
  GEAR_FILES.map(loadFile).join("\n") +
    loadFile("js/gear.js") +
    "\nmodule.exports = { GEAR_RECIPES, GEAR_RECIPES_ALL };",
  "gear.js",
);
const { GEAR_RECIPES, GEAR_RECIPES_ALL } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

const byId = new Map(GEAR_RECIPES.map((g) => [g.id, g]));
const tierOf = (id) => parseInt(String(id).slice(1), 10);

// ── the recipes as items.xml states them ────────────────────────────────────

const ITEMS_XML = loadFile("data/dumps/items.xml");

/** Every craftresource of one item id, straight from the dump. */
function xmlRecipe(uniqueName) {
  const open = new RegExp(`<(equipmentitem|weapon)[^>]*uniquename="${uniqueName}"`);
  const m = open.exec(ITEMS_XML);
  if (!m) return null;
  let seg = ITEMS_XML.slice(m.index);
  const next = /<(equipmentitem|weapon)[^>]*uniquename="/.exec(seg.slice(10));
  if (next) seg = seg.slice(0, 10 + next.index);
  return [...seg.matchAll(/<craftresource uniquename="([^"]+)" count="(\d+)"/g)]
    .map((r) => ({ matId: r[1], count: Number(r[2]) }));
}

console.log("Gear catalogue — tier floor\n");

// ── 1. the low tiers that were missing ──────────────────────────────────────

const LOW_TIER_IDS = ["T2_BAG", "T3_BAG", "T2_CAPE", "T3_CAPE"];

LOW_TIER_IDS.forEach((id) => {
  test(`${id} reaches GEAR_RECIPES`, () => {
    assert.ok(byId.has(id), `${id} missing — the tier floor dropped it again`);
  });

  test(`${id} carries the items.xml recipe`, () => {
    const want = xmlRecipe(id);
    assert.ok(want && want.length, `${id} has no craftresource in items.xml`);
    const got = byId.get(id).materials.map((m) => ({ matId: m.matId, count: m.count }));
    assert.deepStrictEqual(got, want);
  });
});

// ── 2. where the floor sits ─────────────────────────────────────────────────

test("T1 is excluded — it has no marketplace to price against", () => {
  const t1 = GEAR_RECIPES.filter((g) => tierOf(g.id) === 1).map((g) => g.id);
  assert.deepStrictEqual(t1, [], "T1 leaked into the priced catalogue: " + t1.join(","));
});

test("T1 is still in GEAR_RECIPES_ALL — journals count the craft, not the sale", () => {
  assert.ok(GEAR_RECIPES_ALL.some((g) => tierOf(g.id) === 1), "no T1 gear left for the journals");
});

test("every tier T2-T8 is represented", () => {
  const tiers = new Set(GEAR_RECIPES.map((g) => tierOf(g.id)));
  [2, 3, 4, 5, 6, 7, 8].forEach((t) => assert.ok(tiers.has(t), `no T${t} gear`));
});

test("GEAR_RECIPES is GEAR_RECIPES_ALL minus T1 exactly — nothing else was dropped", () => {
  const want = GEAR_RECIPES_ALL.filter((g) => tierOf(g.id) >= 2).map((g) => g.id);
  assert.deepStrictEqual(GEAR_RECIPES.map((g) => g.id), want);
});

test("every entry is a real member of GEAR_RECIPES_ALL, not a copy", () => {
  const all = new Set(GEAR_RECIPES_ALL);
  GEAR_RECIPES.forEach((g) => assert.ok(all.has(g), `${g.id} is not the catalogue object`));
});

// ── 3. shape, so the injection into CRAFTING_ITEMS cannot half-work ─────────

test("every low-tier entry has the fields js/app.js injects", () => {
  GEAR_RECIPES.filter((g) => tierOf(g.id) <= 3).forEach((g) => {
    assert.ok(g.name, `${g.id} has no name`);
    assert.ok(g.craftType, `${g.id} has no craftType`);
    assert.ok(Array.isArray(g.materials) && g.materials.length, `${g.id} has no materials`);
    g.materials.forEach((m) => {
      assert.ok(m.matId, `${g.id} material with no matId`);
      assert.ok(Number(m.count) > 0, `${g.id} material ${m.matId} has no count`);
    });
  });
});

test("no id is listed twice", () => {
  assert.strictEqual(byId.size, GEAR_RECIPES.length, "duplicate ids in GEAR_RECIPES");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
