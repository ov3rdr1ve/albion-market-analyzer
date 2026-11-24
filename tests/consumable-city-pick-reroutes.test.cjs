/**
 * Test: the Consumables table RE-PRICES on a City pick.
 *
 * Its two pickers used to filter rendered rows and nothing else. A consumable
 * row keeps exactly one buy city per ingredient and exactly one sell city — the
 * best-margin one — so a pick could only ever surface rows that had already
 * chosen it. Picking "Black Market" emptied the table instead of routing to the
 * BM bid, and a Buy City pick passed any row where a SINGLE ingredient happened
 * to come from that market. Same failure the other route tables had before
 * js/table-sell-city.js re-priced them.
 *
 * Now the picks reach the row builder:
 *   Buy City  → every ingredient is sourced from that one market
 *               (effectiveBuyCities / effectiveFlipCities)
 *   Sell City → the product sells there, and the pick outranks a per-item pin
 *               (effectiveSellCities)
 * A pick the row's craft city cannot reach drops that arm rather than emitting
 * a route that ignores the pick. Zone rules are untouched.
 *
 * Black-box over the real renderConsumableTable against synthetic market data.
 * No live API, no database.
 *
 * Run: node tests/consumable-city-pick-reroutes.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const stubs = `
const _els = { "use-focus": { checked: false }, "premium-account": { checked: true } };
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const window = { addEventListener: () => {} };
const recipeCache = {};
const expandedCraftItems = new Set();
const tableState = { "consumable-table": { data: [] } };
function renderTableData(id, rows, fmt) { tableState[id].data = rows; tableState[id].html = rows.map((r,i)=>{ try { return fmt(r,i); } catch(e){ return "ERR:"+e.message; } }); }
function priceTd(p){ return "<td>"+p+"</td>"; }
function volTd(){ return "<td></td>"; }
function profitTd(){ return "<td></td>"; }
function pureProfitTd(){ return "<td></td>"; }
function aggregateCostTd(c){ return "<td>"+c+"</td>"; }
function matPriceSpan(id, c, p){ return '<span data-item-id="'+id+'" data-city="'+(c||"")+'" data-city-list="buy">@ '+formatSilver(p)+' ea</span>'; }
function addTdForKey(){ return '<td class="cell-add"></td>'; }
function getRowKey(row){ return (row.item && row.item.id) + "|" + (row.section || ""); }
function getProfitClass(){ return ""; }
function dispName(id, name){ return name || id; }
function tx(en){ return en; }
function focusSpecMark(){ return ""; }
function focusSpecTitle(){ return ""; }
function formatSilver(n){ return Math.round(n).toLocaleString("en-US"); }
function getItemDisplayName(id){ return ITEM_NAMES_MAP[id] || id; }
const ITEM_NAMES_MAP = {};
let lastMpMarketData = null, lastMarketData = null;
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
const CRAFTING_ITEMS = [], FLIPPING_ITEMS = [], TRANSPORT_ITEMS = [], FARMING_ITEMS = [], ARTIFACT_FLIP_ITEMS = [], GEAR_CAPES = [];
`;

const sources =
  J("table-sell-city.js") +
  J("route-cell.js") +
  J("focus-play.js") +
  J("data-faction-fp-costs.js") +
  J("focus-costs.js") +
  J("data-mounts.js") +
  J("data-consumables.js") +
  J("data-enchant-sauces.js") +
  J("data-farming.js") +
  J("recipes.js") +
  J("recipe-resolver.js") +
  J("chain-recipes.js") +
  J("pasture-econ.js") +
  J("chain-pricing.js") +
  J("data-city-bonuses.js") +
  (J("calculations.js") + J("calculations-margins.js")) +
  J("travel-cost.js") +
  J("mp-bonus.js") +
  (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) +
  J("render-mounts.js") + J("render-mounts-breeding-row.js") + J("render-mounts-craft-row.js") +
  J("render-consumable-alt-routes.js") +
  J("render-chain-breakdown.js") +
  J("consumable-pasture-row.js") +
  J("render-consumable-chain-row.js") +
  J("render-consumable-no-data-row.js") +
  J("consumable-flip-row.js") +
  J("consumable-enchant-variants.js") +
  J("consumable-city-pick.js") +
  (J("render-consumables.js") + J("render-consumables-row.js"));

const mod = new Module("consumable-city-pick");
mod._compile(
  stubs + sources
    + "\nmodule.exports = { tableState, renderConsumableTable, setTableBuyCity, setTableSellCity,"
    + " clearTableSellCities, tableRepricesOnCityPick, sellCityOptionsFor, buyCityOptionsFor };",
  "consumable-city-pick.js",
);
const X = mod.exports;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    X.clearTableSellCities();
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    failed++;
  } finally {
    X.clearTableSellCities();
  }
}

// ── Fixture ─────────────────────────────────────────────────────────────────
// T4_MEAL_STEW = T4_TURNIP + T4_BREAD + T4_MEAT. Every ingredient is listed in
// every city, CHEAPEST IN THETFORD, so with no pick a royal row sources there.
// The stew itself pays most in Lymhurst (royal) and more still at the Black
// Market, which only the Caerleon arm can reach.
const CITY_LIST = ["Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Brecilien"];
const CHEAPEST_BUY_CITY = "Thetford";
const BEST_SELL_CITY = "Lymhurst";
// A LADDER, not one spike: getSellPrice runs the city asks through an IQR gate
// (js/utils.js), and a single high city reads as bad data and gets clamped away.
const STEW_ASK = {
  Lymhurst: 27000, "Fort Sterling": 26500, Thetford: 26000, Martlock: 25500,
  Bridgewatch: 25000, Brecilien: 24500, Caerleon: 24000,
};

function market() {
  const md = {};
  const put = (id, c, b, s) => { (md[id] = md[id] || {})[c] = { buy_price: b, sell_price: s, volume_24h: 9999 }; };
  const mats = { T4_MEAT: 500, T4_BREAD: 40, T4_TURNIP: 20, T4_FARM_GOAT_GROWN: 1800, T3_FLOUR: 900, T3_WHEAT: 900 };
  CITY_LIST.forEach((c) => {
    Object.entries(mats).forEach(([id, base]) => {
      // Thetford undercuts everywhere else by 10%.
      const p = c === CHEAPEST_BUY_CITY ? base : Math.round(base * 1.1);
      put(id, c, p, p + 5);
    });
    put("T4_MEAL_STEW", c, STEW_ASK[c] - 100, STEW_ASK[c]);
  });
  // The Black Market bids above every city ask, and is exempt from the IQR gate.
  put("T4_MEAL_STEW", "Black Market", 29000, 29000);
  return md;
}

function render() {
  X.renderConsumableTable(market());
  return X.tableState["consumable-table"].data.slice();
}

/** The craft row for `id` in that section, if the pick left one. */
function craftRow(rows, id, section) {
  return rows.find((r) => r.item && r.item.id === id && r.recipe
    && (section === undefined || r.section === section));
}
function anyRow(rows, id, section) {
  return rows.find((r) => r.item && r.item.id === id
    && (section === undefined || r.section === section));
}
/** Every city the row's ingredients are bought in. */
function buyCities(row) {
  return [...new Set(Object.values(row.matBestPrices || {})
    .map((m) => m && m.city).filter(Boolean))];
}
/** A row that priced nothing is the no-data placeholder, not a route. */
function isNoData(row) {
  return !row || !row.marginInfo || row.marginInfo.margin === -1;
}

console.log("The Consumables table is registered as a re-pricing table\n");

test("tableRepricesOnCityPick says so", () => {
  assert.strictEqual(X.tableRepricesOnCityPick("consumable-table"), true);
});

test("the sell picker offers every sell city, the Black Market included", () => {
  const opts = X.sellCityOptionsFor("consumable-table");
  assert.ok(Array.isArray(opts) && opts.includes("Black Market"),
    `expected the full sell list, got ${JSON.stringify(opts)}`);
});

test("the buy picker offers the real markets only (never the Black Market)", () => {
  const opts = X.buyCityOptionsFor("consumable-table");
  assert.ok(Array.isArray(opts) && opts.length > 0);
  assert.ok(!opts.includes("Black Market"), "the Black Market sells to nobody");
});

console.log("\n=== No pick: today's routes, unchanged ===");

const base = render();
const baseRoyal = craftRow(base, "T4_MEAL_STEW", "royal");

test("the royal stew row sources every ingredient where they are cheapest", () => {
  assert.ok(baseRoyal, "no royal stew row rendered");
  assert.deepStrictEqual(buyCities(baseRoyal), [CHEAPEST_BUY_CITY]);
});

test("the royal stew row sells where the ask is highest", () => {
  assert.strictEqual(baseRoyal.sellPot.city, BEST_SELL_CITY);
});

console.log("\n=== A Buy City pick sources the whole row there ===");

test("every ingredient comes from the picked market", () => {
  X.setTableBuyCity("consumable-table", "Martlock");
  const row = craftRow(render(), "T4_MEAL_STEW", "royal");
  assert.ok(row, "the royal row must survive a royal buy pick");
  assert.deepStrictEqual(buyCities(row), ["Martlock"]);
});

test("the sell leg is untouched by a buy pick", () => {
  X.setTableBuyCity("consumable-table", "Martlock");
  const row = craftRow(render(), "T4_MEAL_STEW", "royal");
  assert.strictEqual(row.sellPot.city, BEST_SELL_CITY);
});

test("a buy pick the craft city cannot source from drops that arm", () => {
  // Caerleon and the royals do not trade with each other.
  X.setTableBuyCity("consumable-table", "Caerleon");
  const rows = render();
  assert.ok(isNoData(anyRow(rows, "T4_MEAL_STEW", "royal")),
    "no royal craft city can buy in Caerleon");
  assert.ok(!isNoData(craftRow(rows, "T4_MEAL_STEW", "caerleon")),
    "the Caerleon arm still routes");
});

console.log("\n=== A Sell City pick sells the row there ===");

test("the product sells at the picked city", () => {
  X.setTableSellCity("consumable-table", "Bridgewatch");
  const row = craftRow(render(), "T4_MEAL_STEW", "royal");
  assert.ok(row, "the royal row must survive a royal sell pick");
  assert.strictEqual(row.sellPot.city, "Bridgewatch");
});

test("picking the Black Market routes the Caerleon arm to the BM bid", () => {
  X.setTableSellCity("consumable-table", "Black Market");
  const rows = render();
  const caer = craftRow(rows, "T4_MEAL_STEW", "caerleon");
  assert.ok(caer, "the Caerleon arm must reach the Black Market");
  assert.strictEqual(caer.sellPot.city, "Black Market");
  assert.ok(isNoData(anyRow(rows, "T4_MEAL_STEW", "royal")),
    "no royal city can sell at the Black Market");
});

test("both picks at once route both legs", () => {
  X.setTableBuyCity("consumable-table", "Martlock");
  X.setTableSellCity("consumable-table", "Bridgewatch");
  const row = craftRow(render(), "T4_MEAL_STEW", "royal");
  assert.deepStrictEqual(buyCities(row), ["Martlock"]);
  assert.strictEqual(row.sellPot.city, "Bridgewatch");
});

console.log("\n=== The chain and flip rows follow the same picks ===");

test("a chain-craft row (T4_MEAT) sells at the picked city", () => {
  X.setTableSellCity("consumable-table", "Bridgewatch");
  const row = anyRow(render(), "T4_MEAT", "royal");
  assert.ok(row && !isNoData(row), "the T4_MEAT chain row must survive");
  assert.strictEqual(row.sellPot.city, "Bridgewatch");
});

test("a flip row (T4_TURNIP) buys and sells at the picked cities", () => {
  X.setTableBuyCity("consumable-table", "Martlock");
  X.setTableSellCity("consumable-table", "Bridgewatch");
  const row = anyRow(render(), "T4_TURNIP", "royal");
  assert.ok(row && !isNoData(row), "the T4_TURNIP flip row must survive");
  assert.strictEqual(row.buyMat.city, "Martlock");
  assert.strictEqual(row.sellPot.city, "Bridgewatch");
});

test("a flip row whose pick its section cannot reach stays as a no-data row", () => {
  X.setTableSellCity("consumable-table", "Black Market");
  const row = anyRow(render(), "T4_TURNIP", "royal");
  assert.ok(row, "the item must stay on the table, editable");
  assert.ok(isNoData(row), "and it must not claim a route it cannot run");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
