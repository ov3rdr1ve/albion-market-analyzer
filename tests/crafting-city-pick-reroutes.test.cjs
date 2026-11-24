/**
 * Test: the Crafting table's Buy City pick SOURCES the materials there.
 *
 * The pick used to be a DOM filter only: every row kept buying each material
 * wherever it was cheapest, so "Buy City = Lymhurst" still showed materials
 * "from Thetford / Martlock". User decision (2026-09-10): "if i set source city
 * lymhurst, then all mats should show from lymhurst. same applies for other
 * tables."
 *
 * Now the pick reaches the route search (effectiveBuyCities,
 * js/table-sell-city.js):
 *   - an active pick narrows every material's buy pool to that one market;
 *   - a craft city that cannot source from the pick (royal vs Caerleon with
 *     Black/Red Zone Routes off) has no honest row, so that section is dropped;
 *   - a pick that simply has no listing keeps the row as a no-data row whose
 *     unpriced cells name the picked city;
 *   - the pick outranks a per-item buy pin;
 *   - no pick = the cheapest-across-cities search, unchanged.
 *
 * Black box over the real computeCraftRoutesForCity / craftingRowsForItem /
 * bestMatBuySource against synthetic market data. No live API.
 *
 * Run: node tests/crafting-city-pick-reroutes.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const stubs = `
const _els = {};
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null };
const localStorage = { _s: {}, getItem(k){ return this._s[k] ?? null; }, setItem(k,v){ this._s[k]=v; }, removeItem(k){ delete this._s[k]; } };
const window = { addEventListener: () => {} };
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
const FOCUS_COSTS = {};
let recipeCache = {};
let lastMarketData = null;
`;

const sources =
  J("table-sell-city.js") +
  J("data-city-bonuses.js") +
  (J("calculations.js") + J("calculations-margins.js")) +
  J("travel-cost.js") +
  (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) +
  J("focus-play.js") +
  J("render-crafting.js");

const mod = new Module("crafting-city-pick-reroutes");
mod._compile(
  stubs + sources
    + "\nmodule.exports = { computeCraftRoutesForCity, craftingRowsForItem, bestMatBuySource,"
    + " setCityForce, clearCityForce, setTableBuyCity, setTableSellCity, clearTableSellCities };",
  "crafting-city-pick-reroutes.js",
);
const X = mod.exports;

let passed = 0;
let failed = 0;
function test(name, fn) {
  X.clearTableSellCities();
  X.clearCityForce("T4_MAT_A", "buy");
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    failed++;
  } finally {
    X.clearTableSellCities();
    X.clearCityForce("T4_MAT_A", "buy");
  }
}

// ── Fixture ─────────────────────────────────────────────────────────────────
// Two materials listed in every city, CHEAPEST IN THETFORD. The output sells
// best in Martlock among the royals and at the Black Market overall.
const ALL = ["Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Brecilien"];
const CHEAPEST = "Thetford";
const OUT = "T4_TESTBAG";

/** `omit` = [[itemId, city], …] listings nobody has placed. */
function market(omit = []) {
  const skip = new Set(omit.map(([id, c]) => `${id}|${c}`));
  const md = {};
  const put = (id, c, b, s, v) => {
    if (skip.has(`${id}|${c}`)) return;
    (md[id] = md[id] || {})[c] = { buy_price: b, sell_price: s, volume_24h: v };
  };
  ALL.forEach((c) => {
    const k = c === CHEAPEST ? 1 : 1.1;
    put("T4_MAT_A", c, Math.round(1000 * k), Math.round(1100 * k), 500);
    put("T4_MAT_B", c, Math.round(400 * k), Math.round(440 * k), 500);
  });
  put(OUT, "Caerleon", 49000, 50000, 60);
  put(OUT, "Lymhurst", 47000, 48000, 60);
  put(OUT, "Martlock", 59000, 60000, 60);
  put(OUT, "Fort Sterling", 41000, 42000, 60);
  put(OUT, "Thetford", 43000, 44000, 60);
  put(OUT, "Bridgewatch", 45000, 46000, 60);
  put(OUT, "Black Market", 68000, 70000, 90);
  return md;
}

const item = {
  id: OUT,
  name: "Test Satchel",
  craftType: null,
  materials: [{ matId: "T4_MAT_A", count: 8 }, { matId: "T4_MAT_B", count: 4 }],
};

const routeAt = (craftCity, md) => X.computeCraftRoutesForCity(craftCity, item, item.materials, md)[0] || null;
const matCities = (r) => [...new Set(Object.values(r.matBestPrices).map((m) => m.city))];
const rowsBySection = (md) => {
  const rows = X.craftingRowsForItem(item, md);
  return {
    royal: rows.filter((r) => r.section === "royal"),
    caerleon: rows.filter((r) => r.section === "caerleon"),
  };
};
const summary = (rows) => rows.map((r) => ({
  craftCity: r.craftCity,
  margin: r.marginInfo.margin,
  sell: r.sellGear && r.sellGear.city,
  mats: r.matBestPrices ? matCities(r) : null,
}));

console.log("Crafting — the Buy City pick sources every material\n");

console.log("=== No pick: cheapest across cities ===");

test("a royal craft buys every material where it is cheapest", () => {
  assert.deepStrictEqual(matCities(routeAt("Lymhurst", market())), [CHEAPEST]);
});

console.log("\n=== A Buy City pick ===");

["Lymhurst", "Martlock", "Bridgewatch"].forEach((pick) => {
  test(`pick ${pick}: every material of a royal craft comes from ${pick}`, () => {
    X.setTableBuyCity("crafting-table", pick);
    const r = routeAt("Lymhurst", market());
    assert.ok(r, "the royal route must survive a royal buy pick");
    assert.deepStrictEqual(matCities(r), [pick]);
  });
});

test("the buy pick leaves the sell leg alone", () => {
  X.setTableBuyCity("crafting-table", "Bridgewatch");
  assert.strictEqual(routeAt("Lymhurst", market()).sellCity, "Martlock");
});

test("the rows the table draws carry the picked source on every material", () => {
  X.setTableBuyCity("crafting-table", "Lymhurst");
  const { royal } = rowsBySection(market());
  assert.ok(royal.length > 0, "no royal row");
  royal.forEach((r) => assert.deepStrictEqual(matCities(r), ["Lymhurst"], `craft city ${r.craftCity}`));
});

test("a pick the craft city cannot source from drops that whole section", () => {
  X.setTableBuyCity("crafting-table", "Caerleon");
  const { royal, caerleon } = rowsBySection(market());
  assert.strictEqual(royal.length, 0, "no royal craft city can buy in Caerleon — not even a no-data row");
  assert.ok(caerleon.length > 0, "the Caerleon section still routes");
  caerleon.forEach((r) => assert.deepStrictEqual(matCities(r), ["Caerleon"]));
});

test("a royal pick drops the Caerleon section", () => {
  X.setTableBuyCity("crafting-table", "Martlock");
  const { royal, caerleon } = rowsBySection(market());
  assert.strictEqual(caerleon.length, 0);
  assert.ok(royal.length > 0);
});

test("the pick outranks a per-item buy pin", () => {
  X.setCityForce("T4_MAT_A", "buy", "Thetford");
  X.setTableBuyCity("crafting-table", "Martlock");
  assert.deepStrictEqual(matCities(routeAt("Lymhurst", market())), ["Martlock"]);
});

test("with no pick the per-item pin still applies", () => {
  X.setCityForce("T4_MAT_A", "buy", "Bridgewatch");
  const r = routeAt("Lymhurst", market());
  assert.strictEqual(r.matBestPrices.T4_MAT_A.city, "Bridgewatch");
  assert.strictEqual(r.matBestPrices.T4_MAT_B.city, CHEAPEST);
});

console.log("\n=== A pick with no listing keeps the row, unpriced, at the pick ===");

test("an unlisted material under the pick leaves a no-data row, not another city", () => {
  X.setTableBuyCity("crafting-table", "Brecilien");
  const md = market([["T4_MAT_B", "Brecilien"]]);
  assert.strictEqual(routeAt("Lymhurst", md), null, "no route may buy T4_MAT_B elsewhere");
  const { royal } = rowsBySection(md);
  assert.ok(royal.length > 0, "the royal row stays on the table, editable");
  royal.forEach((r) => assert.strictEqual(r.marginInfo.margin, -1));
});

test("the no-data row's material sources name the pick", () => {
  X.setTableBuyCity("crafting-table", "Brecilien");
  const md = market([["T4_MAT_B", "Brecilien"]]);
  assert.deepStrictEqual(X.bestMatBuySource("T4_MAT_A", "Lymhurst", md).city, "Brecilien");
  assert.strictEqual(X.bestMatBuySource("T4_MAT_B", "Lymhurst", md).city, null,
    "the blocker is unpriced AT the pick, never quietly sourced in Thetford");
});

console.log("\n=== Pick back to All: identical to before ===");

test("clearing the pick restores the cheapest-across-cities rows exactly", () => {
  const before = summary(X.craftingRowsForItem(item, market()));
  X.setTableBuyCity("crafting-table", "Lymhurst");
  X.craftingRowsForItem(item, market());
  X.clearTableSellCities();
  assert.deepStrictEqual(summary(X.craftingRowsForItem(item, market())), before);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
