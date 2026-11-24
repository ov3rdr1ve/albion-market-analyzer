/**
 * Test: a farming basket the focus budget cannot cover BUYS SEEDS.
 *
 * Bug (reported): My Crafting List showed "170,556 unfocused" in the footer and
 * an empty "Materials to Buy" board for 13,000 T6 potatoes.
 *
 * Watering is a term in the seed-yield sum (js/calculations.js, cycleAtYield is
 * called at `baseSeedYield + watering + yieldBonus`), so a WATERED crop plot
 * sits at or above 100% seed return and re-seeds itself — 0 seeds to buy. The
 * crops the budget cannot water are grown DRY at `baseSeedYield + yieldBonus`,
 * which for every crop above T1 is BELOW 100%: those plots buy seeds. The
 * farming extractor listed only the watered figure and supplied no
 * `materialsNoFocus`, so aggregateCraftListMaterials fell back to the watered
 * (zero) line for the unfunded tail and the board came out blank.
 *
 * Contract under test, black-box over the three pure layers:
 *   calcFarmingEconomics  → seedsBoughtPerOutputFocusOn / …NoFocus
 *   CRAFT_LIST_EXTRACTORS["farming-table"] → materials / materialsNoFocus
 *   aggregateCraftListMaterials → the shopping lines for a split allocation
 * No DOM, no market, no live data — every row is synthetic.
 *
 * Run: node tests/farming-seeds-unfocused-materials.test.cjs
 */

const assert = require("assert");
const path = require("path");

const { calcFarmingEconomics } = require(path.join(__dirname, "..", "js", "calculations.js"));
const {
  CRAFT_LIST_EXTRACTORS,
  aggregateCraftListMaterials,
} = require(path.join(__dirname, "..", "js", "craft-list-materials.js"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.error(`  FAIL: ${name} — ${e.message}`); }
}

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ── Fixtures: the real FARMING_PRODUCTION shapes, inlined so the test never
// depends on the catalog file staying put. producePerCycle is the Premium
// average the caller passes (js/farming-row-econ.js), 4.5 × 2.
const CROPS = {
  // base + watering
  carrot:  { tier: 1, baseSeedYield: 0,      wateringBonus: 2.0    },
  potato:  { tier: 6, baseSeedYield: 0.8667, wateringBonus: 0.2667 },
  pumpkin: { tier: 8, baseSeedYield: 0.9333, wateringBonus: 0.1333 },
};

function econ(crop, { yieldBonus = 0, useWater = true, seedPrice = 16000, sell = 438 } = {}) {
  return calcFarmingEconomics({
    type: "crop",
    seedPrice,
    outputSellPrice: sell,
    baseSeedYield: crop.baseSeedYield,
    wateringBonus: crop.wateringBonus,
    yieldBonus,
    plotsPerCycle: 9,
    producePerCycle: 9,
    cycleHours: 22,
    focusPerCycle: 1125,
    useWater,
    seedSellPrice: seedPrice,
  });
}

// ── 1. the economics layer reports BOTH seed legs ───────────────────────────

console.log("\n=== calcFarmingEconomics: the two seed legs ===");

test("a watered T6 potato plot in the +10% city re-seeds itself", () => {
  const e = econ(CROPS.potato, { yieldBonus: 0.10 });
  // 0.8667 + 0.2667 = 1.1334 - above 1, so nothing is bought. The city's +10%
  // is not in that sum: it is a product yield bonus, and it only widens the
  // crop count the seed leg is divided over.
  assert.ok(near(e.seedsBoughtPerOutputFocusOn, 0), `got ${e.seedsBoughtPerOutputFocusOn}`);
});

test("the SAME plot left dry buys seeds", () => {
  const e = econ(CROPS.potato, { yieldBonus: 0.10 });
  // 0.8667 dry → (1 - 0.8667) of a seed a plot, spread over 9 × 1.10 crops.
  assert.ok(near(e.seedsBoughtPerOutputNoFocus, (1 - 0.8667) / (9 * 1.10), 1e-6),
    `got ${e.seedsBoughtPerOutputNoFocus}`);
  assert.ok(e.seedsBoughtPerOutputNoFocus > 0, "a dry T6 plot is below 100% seed return");
});

[
  ["T1 carrot has no base return at all", CROPS.carrot, 0, 1 / 9],
  ["T6 potato, no city bonus", CROPS.potato, 0, (1 - 0.8667) / 9],
  ["T8 pumpkin, no city bonus", CROPS.pumpkin, 0, (1 - 0.9333) / 9],
  // The city bonus never touches the seed return; it only spreads the same
  // shortfall over 10% more crops.
  ["T8 pumpkin, +10% city bonus", CROPS.pumpkin, 0.10, (1 - 0.9333) / (9 * 1.10)],
].forEach(([label, crop, yieldBonus, expect]) => {
  test(`dry seed leg: ${label}`, () => {
    const e = econ(crop, { yieldBonus });
    assert.ok(near(e.seedsBoughtPerOutputNoFocus, expect, 1e-6),
      `expected ${expect}, got ${e.seedsBoughtPerOutputNoFocus}`);
  });
});

test("neither seed leg moves with the Use Focus checkbox", () => {
  const on = econ(CROPS.potato, { yieldBonus: 0.10, useWater: true });
  const off = econ(CROPS.potato, { yieldBonus: 0.10, useWater: false });
  assert.strictEqual(on.seedsBoughtPerOutputFocusOn, off.seedsBoughtPerOutputFocusOn);
  assert.strictEqual(on.seedsBoughtPerOutputNoFocus, off.seedsBoughtPerOutputNoFocus);
});

test("a pasture animal eats the same feed watered or not", () => {
  const e = calcFarmingEconomics({
    type: "byproduct",
    seedPrice: 400,
    outputSellPrice: 900,
    baseSeedYield: 0,
    wateringBonus: 0,
    yieldBonus: 0.10,
    plotsPerCycle: 1,
    feedCount: 9,
    producePerCycle: 9,
    cycleHours: 22,
  });
  assert.ok(e.seedsBoughtPerOutputFocusOn > 0, "feed is always bought");
  assert.strictEqual(e.seedsBoughtPerOutputNoFocus, e.seedsBoughtPerOutputFocusOn);
});

// ── 2. the extractor carries both legs onto the list entry ──────────────────

console.log("\n=== farming extractor: materials vs materialsNoFocus ===");

/** A row in the shape js/render-farming.js hands to the list. */
function farmRow({ seeds, seedsDry }) {
  return {
    item: { id: "T6_FARM_POTATO_SEED", outputId: "T6_POTATO", name: "Potato [T6]" },
    buySeed: { city: "Bridgewatch", price: 16000 },
    sellCrop: { city: "Thetford", price: 438 },
    totalInputCost: 26,
    marginInfo: { profit: 210, margin: 800 },
    focusPerOutput: 13.9,
    focusProfitPerOutput: 40,
    seedsPerOutput: seeds,
    seedsPerOutputNoFocus: seedsDry,
  };
}

const extractFarm = (row) => CRAFT_LIST_EXTRACTORS["farming-table"](row);

test("a self-seeding watered row lists no seed line", () => {
  const e = extractFarm(farmRow({ seeds: 0, seedsDry: 0.0037 }));
  assert.deepStrictEqual(e.materials, []);
});

test("but its unfocused twin does", () => {
  const e = extractFarm(farmRow({ seeds: 0, seedsDry: 0.0037 }));
  assert.strictEqual(e.materialsNoFocus.length, 1);
  assert.strictEqual(e.materialsNoFocus[0].matId, "T6_FARM_POTATO_SEED");
  assert.strictEqual(e.materialsNoFocus[0].city, "Bridgewatch");
  assert.strictEqual(e.materialsNoFocus[0].perUnit, 16000);
  assert.ok(near(e.materialsNoFocus[0].count, 0.0037));
});

test("a row that is self-seeding even DRY lists nothing either way", () => {
  const e = extractFarm(farmRow({ seeds: 0, seedsDry: 0 }));
  assert.deepStrictEqual(e.materials, []);
  assert.deepStrictEqual(e.materialsNoFocus, []);
});

test("a row missing the dry field falls back to the funded line, never to null", () => {
  const row = farmRow({ seeds: 0.5, seedsDry: undefined });
  const e = extractFarm(row);
  assert.strictEqual(e.materials.length, 1);
  assert.ok(Array.isArray(e.materialsNoFocus), "materialsNoFocus must always be an array");
});

// ── 3. the board: a split allocation buys the dry seeds ─────────────────────

console.log("\n=== Materials to Buy over a split focus budget ===");

/** What allocateCraftListFocus returns, stubbed positionally. */
const alloc = (...pairs) => ({
  splits: pairs.map(([fundedQty, unfundedQty]) => ({ fundedQty, unfundedQty })),
});

const potatoEntry = (qty) => ({
  ...extractFarm(farmRow({ seeds: 0, seedsDry: (1 - 0.9667) / 9 })),
  qty,
});

test("the reported basket: 13,000 potatoes, only 720 of them watered", () => {
  const entries = [potatoEntry(13000)];
  const { lines } = aggregateCraftListMaterials(entries, alloc([720, 12280]));
  assert.strictEqual(lines.length, 1, "the seed line must appear");
  const [line] = lines;
  assert.strictEqual(line.matId, "T6_FARM_POTATO_SEED");
  assert.strictEqual(line.city, "Bridgewatch");
  assert.ok(near(line.count, 12280 * (1 - 0.9667) / 9, 1e-6), `got ${line.count}`);
  assert.ok(line.total > 0, "a seed line with a price must carry a cost");
});

test("a fully funded basket still buys nothing", () => {
  const { lines } = aggregateCraftListMaterials([potatoEntry(13000)], alloc([13000, 0]));
  assert.deepStrictEqual(lines, []);
});

test("a fully unfunded basket buys the whole dry count", () => {
  const { lines } = aggregateCraftListMaterials([potatoEntry(13000)], alloc([0, 13000]));
  assert.ok(near(lines[0].count, 13000 * (1 - 0.9667) / 9, 1e-6));
});

test("with no allocation at all every unit is funded — the pre-budget behaviour", () => {
  const { lines } = aggregateCraftListMaterials([potatoEntry(13000)]);
  assert.deepStrictEqual(lines, []);
});

test("two farming rows in one basket merge per material and city", () => {
  const a = potatoEntry(1000);
  const b = potatoEntry(500);
  const { lines } = aggregateCraftListMaterials([a, b], alloc([0, 1000], [0, 500]));
  assert.strictEqual(lines.length, 1);
  assert.ok(near(lines[0].count, 1500 * (1 - 0.9667) / 9, 1e-6));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
