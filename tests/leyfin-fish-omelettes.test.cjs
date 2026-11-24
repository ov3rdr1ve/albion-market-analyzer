/**
 * Test: Leyfin — the Ancient Lands rare fish — and the Leyfin Omelettes cooked
 * from them (Dragonfire, 2026-08-31).
 *
 * Leyfin behave like the six existing freshwater biome rares: three tiers
 * (T3/T5/T7), a Fish Chops butcher route with the same 10/20/30 yields, and a
 * cooked meal line. What is different is WHERE they come from — the instanced
 * Ancient Lands, not an open-world biome — so they must NOT be folded into
 * FISH_RARE_BIOMES, which is what the merged open-world fishing rows price.
 * That separation is asserted here and the dedicated Ancient Lands gathering
 * rows are covered by tests/ancient-lands-fishing-row.test.cjs.
 *
 * Black-box: reads the real catalogs and recipe tables plus items.xml. No live
 * API or DB. Recipe counts are the per-craft-action <craftresource> values
 * verbatim from the ao-bin-dumps items.xml of 2026-08-31.
 *
 * Run: node tests/leyfin-fish-omelettes.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

function load(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const FISH = [
  { tier: 3, id: "T3_FISH_FRESHWATER_DRAGON_AREA_RARE", name: "Carefree Leyfin", chops: 10 },
  { tier: 5, id: "T5_FISH_FRESHWATER_DRAGON_AREA_RARE", name: "Brightsoul Leyfin", chops: 20 },
  { tier: 7, id: "T7_FISH_FRESHWATER_DRAGON_AREA_RARE", name: "Dragonbound Leyfin", chops: 30 },
];

const MEALS = [
  {
    id: "T3_MEAL_OMELETTE_DRAGONAREA",
    name: "Carefree Leyfin Omelette",
    focus: 77,
    mats: [["T3_FISH_FRESHWATER_DRAGON_AREA_RARE", 1], ["T4_MILK", 1],
           ["T3_COMFREY", 1], ["T3_EGG", 1]],
  },
  {
    id: "T5_MEAL_OMELETTE_DRAGONAREA",
    name: "Brightsoul Leyfin Omelette",
    focus: 225,
    mats: [["T5_FISH_FRESHWATER_DRAGON_AREA_RARE", 1], ["T6_MILK", 2],
           ["T5_TEASEL", 2], ["T5_EGG", 2]],
  },
  {
    id: "T7_MEAL_OMELETTE_DRAGONAREA",
    name: "Dragonbound Leyfin Omelette",
    focus: 672,
    mats: [["T7_FISH_FRESHWATER_DRAGON_AREA_RARE", 1], ["T7_MULLEIN", 6],
           ["T5_TEASEL", 6], ["T5_EGG", 6]],
  },
];

// ── Compile the real browser modules together. ───────────────────────────────
const stubs = [
  "function getTierFromId(id) {",
  "  const m = id.match(/^T(\\d)/);",
  "  return m ? parseInt(m[1], 10) : 0;",
  "}",
  "",
].join("\n");

const mod = new Module("leyfin-test");
mod._compile(
  stubs +
    load("js/data-consumables.js") +
    load("js/recipes.js") +
    load("js/chain-recipes.js") +
    load("js/data-gathering.js") +
    load("js/item-names.js") +
    "\nmodule.exports = { CONSUMABLES, BUNDLED_RECIPES, CHAIN_RECIPES, FISHCHOPS_FISH_SOURCES, FISH_RARE_BIOMES, ITEM_NAMES_MAP };",
  "leyfin-test.js"
);
const {
  CONSUMABLES,
  BUNDLED_RECIPES,
  FISHCHOPS_FISH_SOURCES,
  FISH_RARE_BIOMES,
  ITEM_NAMES_MAP,
} = mod.exports;

const FOCUS_COSTS = require("../js/focus-costs.json");
const CONSUMABLE_OUTPUT = require("../js/consumable-output.json");
const ITEMS_XML = load("data/dumps/items.xml");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name + " — " + e.message); failed++; }
}

const catalogIds = new Set(CONSUMABLES.map((c) => c.id));

console.log("\n=== The three Leyfin exist in the dump and in the flip catalog ===");
for (const f of FISH) {
  test(f.id + " is a real items.xml id", () => {
    assert.ok(ITEMS_XML.includes('uniquename="' + f.id + '"'),
      f.id + " is not in items.xml");
  });
  test(f.id + " is in CONSUMABLES as a raw flip", () => {
    const row = CONSUMABLES.find((c) => c.id === f.id);
    assert.ok(row, f.id + " missing from CONSUMABLES");
    assert.strictEqual(row.herbId, null, f.id + " is a raw fish, not a herb craft");
    assert.ok(!BUNDLED_RECIPES[f.id], f.id + " is fished, it must have no recipe");
  });
  test(f.id + " renders as \"" + f.name + "\"", () => {
    const shown = (CONSUMABLES.find((c) => c.id === f.id) || {}).name || ITEM_NAMES_MAP[f.id];
    assert.ok(shown && shown.includes(f.name),
      f.id + " shows as \"" + shown + "\", expected to contain \"" + f.name + "\"");
  });
}
test("Leyfin exist only at T3 / T5 / T7", () => {
  const stray = [2, 4, 6, 8].filter((t) =>
    ITEMS_XML.includes('uniquename="T' + t + '_FISH_FRESHWATER_DRAGON_AREA_RARE"'));
  assert.deepStrictEqual(stray, [], "unexpected Leyfin tiers in the dump");
});

console.log("\n=== Fish Chops: Leyfin butcher at the same 10/20/30 as the other rares ===");
for (const f of FISH) {
  test(f.id + " butchers into " + f.chops + " Fish Chops", () => {
    const src = FISHCHOPS_FISH_SOURCES.find((s) => s.fishId === f.id);
    assert.ok(src, f.id + " missing from FISHCHOPS_FISH_SOURCES");
    assert.strictEqual(src.yield, f.chops, f.id + " yield mismatch");
    assert.ok(src.label && src.label.includes(f.name),
      f.id + " label \"" + src.label + "\" should name the fish");
  });
}

console.log("\n=== Omelettes: catalog rows, exact recipes, focus, single output ===");
for (const m of MEALS) {
  test(m.id + " is in CONSUMABLES", () => {
    assert.ok(catalogIds.has(m.id), m.id + " missing from CONSUMABLES");
  });
  test(m.id + " recipe matches items.xml", () => {
    const rec = BUNDLED_RECIPES[m.id];
    assert.ok(Array.isArray(rec), m.id + " has no BUNDLED_RECIPES entry");
    assert.deepStrictEqual(
      rec.map((x) => [x.matId, x.count]),
      m.mats,
      m.id + " material list/order differs from the dump"
    );
  });
  test(m.id + " refunds every ingredient (no noReturn mats)", () => {
    // A cooked meal takes normal RRR — the Leyfin is a plain ingredient, not an
    // artifact, and carries no maxreturnamount="0" in the dump.
    const rec = BUNDLED_RECIPES[m.id];
    assert.deepStrictEqual(rec.filter((x) => x.noReturn).map((x) => x.matId), []);
  });
  test(m.id + " base focus = " + m.focus, () => {
    assert.strictEqual(FOCUS_COSTS[m.id], m.focus,
      m.id + " focus mismatch (got " + FOCUS_COSTS[m.id] + ")");
  });
  test(m.id + " yields one meal per craft action", () => {
    assert.strictEqual(CONSUMABLE_OUTPUT[m.id], 1,
      m.id + " output should be 1 (got " + CONSUMABLE_OUTPUT[m.id] + ")");
  });
  test(m.id + " renders as \"" + m.name + "\"", () => {
    const row = CONSUMABLES.find((c) => c.id === m.id) || {};
    assert.ok(row.name && row.name.includes(m.name),
      m.id + " shows as \"" + row.name + "\"");
    assert.ok(!String(row.name).includes("_"), m.id + " name leaks a raw id");
  });
}

console.log("\n=== Ancient Lands stays out of the open-world biome list ===");
test("FISH_RARE_BIOMES is still the six open-world biomes", () => {
  assert.deepStrictEqual(
    [...FISH_RARE_BIOMES].sort(),
    ["AVALON", "FOREST", "HIGHLANDS", "MOUNTAIN", "STEPPE", "SWAMP"],
    "Leyfin must not be folded into the open-world fishing rows"
  );
});

console.log("\n" + "=".repeat(50));
console.log("Total: " + (passed + failed) + " | Passed: " + passed + " | Failed: " + failed);
if (failed > 0) process.exit(1);
