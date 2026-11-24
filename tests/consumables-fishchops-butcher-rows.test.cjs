/**
 * Test: Fish Chops butcher-route rows in the Consumables table.
 *
 * Fish Chops (T1_FISHCHOPS) can be butchered from 41 different fish
 * types per items.xml:1201-1316. Each fish source gets its own row in
 * the Consumables table via a synthetic id `T1_FISHCHOPS__<fishId>`.
 * All 41 rows route their sell-side market lookups to the real
 * `T1_FISHCHOPS` id via a new `sellAs` field.
 *
 * The list and generation loops live in js/chain-recipes.js
 * (loads AFTER data-consumables.js, so CONSUMABLES is already defined
 * when chain-recipes.js executes its push loop).
 *
 * Run: node tests/consumables-fishchops-butcher-rows.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

function load(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const stub = `globalThis.fetch = globalThis.fetch || (() => Promise.resolve(null));\n`;
const dataConsumablesSrc = load("js/data-consumables.js");
const recipesSrc = load("js/recipes.js");
const chainRecipesSrc = load("js/chain-recipes.js");
const apiSrc = load("js/api.js");

const mod = new Module("fishchops-butcher-rows-test");
mod._compile(
  stub +
    dataConsumablesSrc +
    recipesSrc +
    chainRecipesSrc +
    apiSrc +
    "\nmodule.exports = { CONSUMABLES, CHAIN_RECIPES, FISHCHOPS_FISH_SOURCES, isSyntheticId, NON_TRADEABLE_PREFIXES };",
  "fishchops-butcher-rows-test.js",
);
const {
  CONSUMABLES,
  CHAIN_RECIPES,
  FISHCHOPS_FISH_SOURCES,
  isSyntheticId,
} = mod.exports;

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

// Expected yields per the items.xml table.
const EXPECTED_YIELDS = {
  // Freshwater common: 1,2,3,4,6,8,10,14
  T1_FISH_FRESHWATER_ALL_COMMON: 1,
  T2_FISH_FRESHWATER_ALL_COMMON: 2,
  T3_FISH_FRESHWATER_ALL_COMMON: 3,
  T4_FISH_FRESHWATER_ALL_COMMON: 4,
  T5_FISH_FRESHWATER_ALL_COMMON: 6,
  T6_FISH_FRESHWATER_ALL_COMMON: 8,
  T7_FISH_FRESHWATER_ALL_COMMON: 10,
  T8_FISH_FRESHWATER_ALL_COMMON: 14,
  // Saltwater common: mirror
  T1_FISH_SALTWATER_ALL_COMMON: 1,
  T2_FISH_SALTWATER_ALL_COMMON: 2,
  T3_FISH_SALTWATER_ALL_COMMON: 3,
  T4_FISH_SALTWATER_ALL_COMMON: 4,
  T5_FISH_SALTWATER_ALL_COMMON: 6,
  T6_FISH_SALTWATER_ALL_COMMON: 8,
  T7_FISH_SALTWATER_ALL_COMMON: 10,
  T8_FISH_SALTWATER_ALL_COMMON: 14,
  // Rare T3/T5/T7 across all 6 freshwater biomes + saltwater (7 groups × 3 tiers = 21)
  T3_FISH_FRESHWATER_FOREST_RARE: 10,
  T5_FISH_FRESHWATER_FOREST_RARE: 20,
  T7_FISH_FRESHWATER_FOREST_RARE: 30,
  T3_FISH_FRESHWATER_STEPPE_RARE: 10,
  T5_FISH_FRESHWATER_STEPPE_RARE: 20,
  T7_FISH_FRESHWATER_STEPPE_RARE: 30,
  T3_FISH_FRESHWATER_MOUNTAIN_RARE: 10,
  T5_FISH_FRESHWATER_MOUNTAIN_RARE: 20,
  T7_FISH_FRESHWATER_MOUNTAIN_RARE: 30,
  T3_FISH_FRESHWATER_HIGHLANDS_RARE: 10,
  T5_FISH_FRESHWATER_HIGHLANDS_RARE: 20,
  T7_FISH_FRESHWATER_HIGHLANDS_RARE: 30,
  T3_FISH_FRESHWATER_SWAMP_RARE: 10,
  T5_FISH_FRESHWATER_SWAMP_RARE: 20,
  T7_FISH_FRESHWATER_SWAMP_RARE: 30,
  T3_FISH_FRESHWATER_AVALON_RARE: 10,
  T5_FISH_FRESHWATER_AVALON_RARE: 20,
  T7_FISH_FRESHWATER_AVALON_RARE: 30,
  // Ancient Lands leyfin (Dragonfire, 2026-08-31)
  T3_FISH_FRESHWATER_DRAGON_AREA_RARE: 10,
  T5_FISH_FRESHWATER_DRAGON_AREA_RARE: 20,
  T7_FISH_FRESHWATER_DRAGON_AREA_RARE: 30,
  T3_FISH_SALTWATER_ALL_RARE: 10,
  T5_FISH_SALTWATER_ALL_RARE: 20,
  T7_FISH_SALTWATER_ALL_RARE: 30,
  // Boss
  T8_FISH_SALTWATER_ALL_BOSS_SHARK: 200,
};

const EXPECTED_COUNT = Object.keys(EXPECTED_YIELDS).length;

console.log("\n=== FISHCHOPS_FISH_SOURCES — 38 entries from items.xml ===");

test("FISHCHOPS_FISH_SOURCES.length matches the items.xml craftingrequirements count", () => {
  assert.strictEqual(FISHCHOPS_FISH_SOURCES.length, EXPECTED_COUNT);
  assert.strictEqual(FISHCHOPS_FISH_SOURCES.length, EXPECTED_COUNT);
});

test("every entry has fishId, yield, label fields", () => {
  for (const f of FISHCHOPS_FISH_SOURCES) {
    assert.ok(typeof f.fishId === "string" && f.fishId.length > 0, `bad fishId on ${JSON.stringify(f)}`);
    assert.ok(Number.isInteger(f.yield) && f.yield > 0, `bad yield on ${f.fishId}`);
    assert.ok(typeof f.label === "string" && f.label.length > 0, `bad label on ${f.fishId}`);
  }
});

test("every entry matches expected yield from items.xml", () => {
  for (const f of FISHCHOPS_FISH_SOURCES) {
    const expected = EXPECTED_YIELDS[f.fishId];
    assert.ok(expected !== undefined, `unexpected fish id ${f.fishId}`);
    assert.strictEqual(f.yield, expected, `${f.fishId} yield mismatch: got ${f.yield}, expected ${expected}`);
  }
});

test("no duplicate fishIds", () => {
  const ids = FISHCHOPS_FISH_SOURCES.map((f) => f.fishId);
  assert.strictEqual(ids.length, new Set(ids).size);
});

console.log("\n=== CHAIN_RECIPES — synthetic butcher entries ===");

test("CHAIN_RECIPES['T1_FISHCHOPS'] is a multi-option recipe marked forcedChainOnly", () => {
  // The aggregate row uses a multi-option chain so the renderer picks the
  // cheapest fish source at render time. Marked forcedChainOnly so it is
  // ONLY consumed by force-chain (the row's own breakdown) — never inline
  // expanded inside other recipes that use T1_FISHCHOPS as an ingredient
  // (fish sauce still uses market price for fish chops).
  const entry = CHAIN_RECIPES["T1_FISHCHOPS"];
  assert.ok(entry, "T1_FISHCHOPS aggregate chain entry missing");
  assert.strictEqual(entry.forcedChainOnly, true);
  assert.strictEqual(entry.station, "butcher");
  assert.ok(Array.isArray(entry.options));
  assert.strictEqual(entry.options.length, EXPECTED_COUNT);
  // No top-level `inputs` field — only options.
  assert.strictEqual(entry.inputs, undefined);
});

test("aggregate options mirror FISHCHOPS_FISH_SOURCES (same fishIds, yields)", () => {
  const optByFishId = new Map();
  for (const opt of CHAIN_RECIPES["T1_FISHCHOPS"].options) {
    assert.strictEqual(opt.inputs.length, 1);
    optByFishId.set(opt.inputs[0].matId, opt);
  }
  for (const f of FISHCHOPS_FISH_SOURCES) {
    const opt = optByFishId.get(f.fishId);
    assert.ok(opt, `aggregate option missing for ${f.fishId}`);
    assert.strictEqual(opt.output, f.yield);
    assert.strictEqual(opt.inputs[0].noReturn, true);
  }
});

test("aggregate T1_FISHCHOPS row exists in CONSUMABLES (real id, no sellAs)", () => {
  const row = CONSUMABLES.find((c) => c.id === "T1_FISHCHOPS");
  assert.ok(row, "T1_FISHCHOPS aggregate row missing from CONSUMABLES");
  assert.strictEqual(row.sellAs, undefined, "aggregate row should not have sellAs (id already matches sell id)");
  assert.ok(row.name.includes("Fish Chops"), `name should mention fish chops, got "${row.name}"`);
});

test("synthetic CHAIN_RECIPES['T1_FISHCHOPS__<fishId>'] exists for every fish source", () => {
  for (const f of FISHCHOPS_FISH_SOURCES) {
    const key = `T1_FISHCHOPS__${f.fishId}`;
    const entry = CHAIN_RECIPES[key];
    assert.ok(entry, `missing CHAIN_RECIPES entry for ${key}`);
    assert.strictEqual(entry.output, f.yield, `${key} output mismatch`);
    assert.strictEqual(entry.station, "butcher", `${key} station should be butcher`);
    assert.deepStrictEqual(entry.inputs, [{ matId: f.fishId, count: 1, noReturn: true }],
      `${key} inputs malformed`);
  }
});

test("sample: T8 boss shark chain yields 200", () => {
  const entry = CHAIN_RECIPES["T1_FISHCHOPS__T8_FISH_SALTWATER_ALL_BOSS_SHARK"];
  assert.ok(entry);
  assert.strictEqual(entry.output, 200);
  assert.strictEqual(entry.inputs[0].matId, "T8_FISH_SALTWATER_ALL_BOSS_SHARK");
  assert.strictEqual(entry.inputs[0].noReturn, true);
});

test("sample: T1 freshwater common chain yields 1 (1:1)", () => {
  const entry = CHAIN_RECIPES["T1_FISHCHOPS__T1_FISH_FRESHWATER_ALL_COMMON"];
  assert.ok(entry);
  assert.strictEqual(entry.output, 1);
});

test("sample: T3 forest rare (Greenriver Eel) chain yields 10", () => {
  const entry = CHAIN_RECIPES["T1_FISHCHOPS__T3_FISH_FRESHWATER_FOREST_RARE"];
  assert.ok(entry);
  assert.strictEqual(entry.output, 10);
});

console.log("\n=== CONSUMABLES — 38 synthetic rows with sellAs='T1_FISHCHOPS' ===");

test("one CONSUMABLES row pushed per fish source", () => {
  const fishchopsRows = CONSUMABLES.filter((c) => c.id.startsWith("T1_FISHCHOPS__"));
  assert.strictEqual(fishchopsRows.length, EXPECTED_COUNT);
});

test("every fishchops row has sellAs='T1_FISHCHOPS'", () => {
  const fishchopsRows = CONSUMABLES.filter((c) => c.id.startsWith("T1_FISHCHOPS__"));
  for (const row of fishchopsRows) {
    assert.strictEqual(row.sellAs, "T1_FISHCHOPS", `${row.id} should have sellAs T1_FISHCHOPS`);
  }
});

test("row name format is 'Fish Chops [T1] (← <fishLabel>)'", () => {
  const row = CONSUMABLES.find((c) => c.id === "T1_FISHCHOPS__T3_FISH_FRESHWATER_FOREST_RARE");
  assert.ok(row);
  assert.ok(row.name.startsWith("Fish Chops [T1]"), `got name "${row.name}"`);
  assert.ok(row.name.includes("←") || row.name.includes("from"),
    `row name should indicate source, got "${row.name}"`);
});

test("every fishId in FISHCHOPS_FISH_SOURCES has a corresponding CONSUMABLES row", () => {
  for (const f of FISHCHOPS_FISH_SOURCES) {
    const expectedId = `T1_FISHCHOPS__${f.fishId}`;
    const row = CONSUMABLES.find((c) => c.id === expectedId);
    assert.ok(row, `missing CONSUMABLES row for ${expectedId}`);
  }
});

console.log("\n=== isSyntheticId — API fetch guard ===");

test("isSyntheticId('T1_FISHCHOPS__<x>') returns true", () => {
  assert.strictEqual(isSyntheticId("T1_FISHCHOPS__T1_FISH_FRESHWATER_ALL_COMMON"), true);
  assert.strictEqual(isSyntheticId("T1_FISHCHOPS__T8_FISH_SALTWATER_ALL_BOSS_SHARK"), true);
});

test("isSyntheticId('T1_FISHCHOPS') returns false (real item)", () => {
  assert.strictEqual(isSyntheticId("T1_FISHCHOPS"), false);
});

test("isSyntheticId on common real ids returns false", () => {
  for (const id of ["T6_MEAL_SALAD", "T1_SEAWEED", "T4_BREAD", "T3_FISH_FRESHWATER_FOREST_RARE", ""]) {
    assert.strictEqual(isSyntheticId(id), false, `${JSON.stringify(id)} should not be synthetic`);
  }
});

test("isSyntheticId on non-string returns false (graceful)", () => {
  assert.strictEqual(isSyntheticId(null), false);
  assert.strictEqual(isSyntheticId(undefined), false);
  assert.strictEqual(isSyntheticId(42), false);
});

console.log("\n=== Input cost math (per-output-unit, pre-RRR, pre-fee) ===");

// Helper mirrors the renderer's basic chain-cost arithmetic:
//   cost_per_chop = fish_price * input_count / output
// (RRR multiplier and SETUP_FEE are applied on top in the renderer.)
function costPerChop(syntheticId, fishPrice) {
  const entry = CHAIN_RECIPES[syntheticId];
  return entry.inputs[0].count * fishPrice / entry.output;
}

test("T1 fw common @ 100 silver → 100 silver/chop (1:1 yield)", () => {
  assert.strictEqual(costPerChop("T1_FISHCHOPS__T1_FISH_FRESHWATER_ALL_COMMON", 100), 100);
});

test("T3 forest rare @ 1000 silver → 100 silver/chop (1:10 yield)", () => {
  assert.strictEqual(costPerChop("T1_FISHCHOPS__T3_FISH_FRESHWATER_FOREST_RARE", 1000), 100);
});

test("T8 boss shark @ 50000 silver → 250 silver/chop (1:200 yield)", () => {
  assert.strictEqual(costPerChop("T1_FISHCHOPS__T8_FISH_SALTWATER_ALL_BOSS_SHARK", 50000), 250);
});

test("T8 fw common @ 2800 silver → 200 silver/chop (1:14 yield)", () => {
  assert.strictEqual(costPerChop("T1_FISHCHOPS__T8_FISH_FRESHWATER_ALL_COMMON", 2800), 200);
});

test("cost scales linearly with fish price", () => {
  const a = costPerChop("T1_FISHCHOPS__T5_FISH_FRESHWATER_FOREST_RARE", 1000);
  const b = costPerChop("T1_FISHCHOPS__T5_FISH_FRESHWATER_FOREST_RARE", 3000);
  assert.strictEqual(b / a, 3);
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
