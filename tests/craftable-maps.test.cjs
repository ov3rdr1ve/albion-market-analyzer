/**
 * Test: craftable dungeon/hellgate maps (Artifact Foundry).
 *
 * Eight maps craft from souls at the Artifact Foundry with a FLAT silver cost
 * baked into the recipe (items.xml <craftingrequirements silver="…">) and a
 * 0% Resource Return Rate — verified in-game 2026-07-20 on the Corrupted
 * Dungeon Map (Stalker/Slayer): 54 maps cost 187,272 silver = 54 × 3,468, i.e.
 * exactly the items.xml 3,000 × the 1.156 in-game silver multiplier, and the
 * craft window reports "Resource Return Rate: 0%".
 *
 * Two ids are absent from the repo's stale items.xml/items.json snapshot
 * (T5_CORRUPTED_NONLETHAL_MAP, T6_CORRUPTED_LETHAL_MAP); the catalog is the
 * source of truth for them, taken from live ao-bin-dumps.
 *
 * Black-box: assert on the catalog contract + the real computeCraftRoutesForCity
 * output. No API, no DOM.
 *
 * Run: node tests/craftable-maps.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const { CRAFTABLE_MAPS, injectCraftableMaps } = require("../js/data-maps.js");

const stubs = `
const _els = {};
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const window = { addEventListener: () => {} };
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
const FOCUS_COSTS = {};      // maps have no craftingfocus → focus column stays 0
let recipeCache = {};
let lastMarketData = null;
`;

const mod = new Module("craftable-maps");
mod._compile(
  stubs +
    J("data-city-bonuses.js") +
    (J("calculations.js") + J("calculations-margins.js")) +
    J("travel-cost.js") +
    (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) +
    J("render-crafting.js") +
    "\nmodule.exports = { computeCraftRoutesForCity, SETUP_FEE };",
  "craftable-maps.js",
);
const X = mod.exports;

// In-game silver = items.xml craftingrequirements silver × 1.156.
const SILVER_MULT = 1.156;

// [id, soul tier, soul count, items.xml silver, items.xml itemvalue]
const EXPECTED = [
  ["T5_CORRUPTED_NONLETHAL_MAP", 5, 1, 1000, 200],
  ["T6_CORRUPTED_LETHAL_MAP", 6, 1, 3000, 600],
  ["T5_HELLGATE_2V2_NON_LETHAL_1_MAP", 5, 2, 3000, 600],
  ["T5_HELLGATE_5V5_NON_LETHAL_1_MAP", 5, 5, 20000, 4000],
  ["T5_HELLGATE_10V10_NON_LETHAL_1_MAP", 5, 10, 100000, 20000],
  ["T6_HELLGATE_2V2_LETHAL_1_MAP", 6, 2, 15000, 3000],
  ["T7_HELLGATE_5V5_LETHAL_1_MAP", 7, 5, 100000, 20000],
  ["T8_HELLGATE_10V10_LETHAL_1_MAP", 8, 10, 500000, 10000],
];

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Craftable maps tests\n");

test("catalog holds exactly the 8 craftable maps", () => {
  assert.deepStrictEqual(
    CRAFTABLE_MAPS.map((m) => m.id).sort(),
    EXPECTED.map((e) => e[0]).sort(),
  );
});

EXPECTED.forEach(([id, soulTier, soulCount, xmlSilver, itemValue]) => {
  test(`${id}: ${soulCount}× T${soulTier}_SOUL, silver ${Math.round(xmlSilver * SILVER_MULT)}, no RRR`, () => {
    const m = CRAFTABLE_MAPS.find((x) => x.id === id);
    assert.ok(m, "missing from catalog");
    assert.deepStrictEqual(m.materials, [
      { matId: `T${soulTier}_SOUL`, count: soulCount },
    ]);
    assert.strictEqual(m.silverCost, Math.round(xmlSilver * SILVER_MULT));
    assert.strictEqual(m.noReturn, true, "maps craft at 0% RRR");
    assert.strictEqual(m.craftType, null, "no craft-spec city for maps");
    assert.ok(!m.isGearRecipe, "maps must not spawn @1-@4 enchant variants");
    // Station usage fee is nutrition-based; maps carry no per-material nutrition
    // (one artifact input), so the real item value drives it.
    assert.strictEqual(m.nutritionPerCraft, itemValue * 0.1125);
    assert.ok(m.name && m.name.length > 0, "needs a display name");
  });
});

test("injectCraftableMaps appends every map to a crafting catalog", () => {
  const target = [];
  injectCraftableMaps(target);
  assert.strictEqual(target.length, EXPECTED.length);
  EXPECTED.forEach(([id]) => assert.ok(target.some((i) => i.id === id), id));
});

test("injectCraftableMaps is idempotent (no duplicate rows)", () => {
  const target = [];
  injectCraftableMaps(target);
  injectCraftableMaps(target);
  assert.strictEqual(target.length, EXPECTED.length);
});

test("injectCraftableMaps never overwrites an existing id", () => {
  const target = [{ id: "T6_CORRUPTED_LETHAL_MAP", name: "pre-existing" }];
  injectCraftableMaps(target);
  assert.strictEqual(target.length, EXPECTED.length);
  assert.strictEqual(
    target.find((i) => i.id === "T6_CORRUPTED_LETHAL_MAP").name,
    "pre-existing",
  );
});

// ── Pricing: flat silver is charged, souls get no RRR refund ────────────────
function routesFor(id, soulPrice, sellPrice) {
  const item = CRAFTABLE_MAPS.find((x) => x.id === id);
  const soulId = item.materials[0].matId;
  const md = {
    [soulId]: { Lymhurst: { buy_price: soulPrice, sell_price: soulPrice + 1, volume_24h: 500 } },
    [id]: { Lymhurst: { buy_price: sellPrice - 1, sell_price: sellPrice, volume_24h: 500 } },
  };
  return X.computeCraftRoutesForCity("Lymhurst", item, item.materials, md);
}

test("input cost = souls × (1+setup fee) + flat silver (station fee 0)", () => {
  const routes = routesFor("T6_CORRUPTED_LETHAL_MAP", 100000, 200000);
  assert.ok(routes.length > 0, "expected a route");
  const expected = 100000 * (1 + X.SETUP_FEE) + 3468;
  assert.ok(
    Math.abs(routes[0].totalInputCost - expected) < 1,
    `input cost ${routes[0].totalInputCost} != ${expected}`,
  );
});

test("no RRR discount is applied to the soul (noReturn)", () => {
  // A returnable material would be discounted by (1-rrr) with rrr > 0; the full
  // soul price must survive into the cost.
  const routes = routesFor("T6_CORRUPTED_LETHAL_MAP", 100000, 200000);
  assert.ok(
    routes[0].totalInputCost > 100000,
    "soul cost must not be reduced by a resource return rate",
  );
  assert.strictEqual(routes[0].rrr, 0);
});

test("multi-soul map charges every soul (5× T7 hellgate)", () => {
  const routes = routesFor("T7_HELLGATE_5V5_LETHAL_1_MAP", 200000, 2000000);
  const expected = 5 * 200000 * (1 + X.SETUP_FEE) + 115600;
  assert.ok(
    Math.abs(routes[0].totalInputCost - expected) < 1,
    `input cost ${routes[0].totalInputCost} != ${expected}`,
  );
});

test("flat silver alone can sink a route into negative margin", () => {
  // T8 hellgate map: 578,000 silver on top of 10 souls. A sell price below that
  // must not be reported as profitable.
  const routes = routesFor("T8_HELLGATE_10V10_LETHAL_1_MAP", 300000, 400000);
  routes.forEach((r) =>
    assert.ok(r.marginInfo.margin < 0, "expected a loss-making route"));
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
