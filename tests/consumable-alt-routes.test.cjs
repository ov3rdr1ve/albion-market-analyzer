/**
 * Test: Consumables "alternative routes" — buy the ingredient, or make it.
 *
 * The Ingredients cell used to answer two questions at once. Whenever chain-
 * crafting an ingredient beat buying it, the row silently switched to the chain
 * price and inlined the whole pasture/mill/butcher sub-tree, so "what does this
 * meal cost to build" and "should I be running a butcher" were tangled in one
 * cell — and when the market won instead, the chain vanished with no trace.
 *
 * Now the row buys every ingredient at market, one flat line each, and the
 * chains it passed over live in a panel opened by the ▸ toggle: what each would
 * cost, what it saves, and the profit that would result.
 *
 * Black-box over the real renderConsumableTable + the real cell/panel renderers
 * against synthetic market data. No live API, no database.
 *
 * Run: node tests/consumable-alt-routes.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

// Only the DOM and the table writer are stubbed. renderConsumableIngredients,
// renderChainBreakdown and the whole alt-routes panel are the real sources —
// they are what is under test.
const stubs = `
const _els = { "use-focus": { checked: false }, "premium-account": { checked: true } };
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const window = { addEventListener: () => {} };
const recipeCache = {};
const expandedCraftItems = new Set();
const tableState = { "consumable-table": { data: [] } };
function renderTableData(id, rows, fmt) { tableState[id].data = rows; tableState[id].html = rows.map((r,i)=>{ try { return fmt(r,i); } catch(e){ return "ERR:"+e.message+"\\n"+e.stack; } }); }
function priceTd(p){ return "<td>"+p+"</td>"; }
function volTd(){ return "<td></td>"; }
function profitTd(){ return "<td></td>"; }
function pureProfitTd(){ return "<td></td>"; }
function aggregateCostTd(c){ return "<td>"+c+"</td>"; }
function matPriceSpan(id, c, p){ return '<span class="price-editable" data-item-id="'+id+'" data-city="'+(c||"")+'">@ '+formatSilver(p)+' ea</span>'; }
function addTdForKey(){ return '<td class="cell-add"></td>'; }
function getRowKey(row){ return (row.item && row.item.id) + "|" + (row.section || ""); }
function getProfitClass(){ return ""; }
function dispName(id, name){ return name || id; }
function tx(en){ return en; }
function focusSpecMark(){ return ""; }
function focusSpecTitle(){ return ""; }
function formatSilver(n){ return Math.round(n).toLocaleString("en-US"); }
function getItemDisplayName(id){ return ITEM_NAMES_MAP[id] || id; }
const ITEM_NAMES_MAP = {
  T4_MEAT: "Goat Meat [T4]",
  T4_BREAD: "Bread [T4]",
  T4_TURNIP: "Turnip [T4]",
  T4_FARM_GOAT_GROWN: "Grown Goat [T4]",
  T3_FLOUR: "Flour [T3]",
  T3_WHEAT: "Wheat [T3]",
};
let lastMpMarketData = null, lastMarketData = null;
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
const CRAFTING_ITEMS = [], FLIPPING_ITEMS = [], TRANSPORT_ITEMS = [], FARMING_ITEMS = [], ARTIFACT_FLIP_ITEMS = [], GEAR_CAPES = [];
`;

const sources =
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

const mod = new Module("consumable-alt-routes");
mod._compile(
  stubs + sources
    + "\nmodule.exports = { tableState, renderConsumableTable, consumableOpenAltRows,"
    + " consumableAltRoutes, consumableAltRoutesRow, CONS_ALT_COL_COUNT, SETUP_FEE, getRecipeOutput };",
  "consumable-alt-routes.js",
);
const X = mod.exports;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// ── Fixture ─────────────────────────────────────────────────────────────────
// T4_MEAL_STEW = 4x T4_TURNIP + 4x T4_BREAD + 8x T4_MEAT.
//   T4_MEAT  ← 1x T4_FARM_GOAT_GROWN, 18 per animal (butcher chain)
//   T4_BREAD ← 1x T3_FLOUR ← 1x T3_WHEAT (bakery + mill chain)
//   T4_TURNIP has no chain recipe at all.
// The goat is priced so the butcher chain UNDERCUTS meat on the market, while
// wheat is priced so buying bread beats baking it — one row, both directions.
const MEAT_MARKET = 500;
const GOAT_PRICE = 1800;      // 1800 / 18 = 100 per meat → chain wins
const BREAD_MARKET = 40;
const WHEAT_PRICE = 900;      // bread chain would cost 900 → market wins
const TURNIP_PRICE = 20;
const STEW_SELL = 30000;

function market(overrides) {
  const md = {};
  const put = (id, c, b, s) => { (md[id] = md[id] || {})[c] = { buy_price: b, sell_price: s, volume_24h: 9999 }; };
  const skip = (overrides && overrides.skip) || [];
  CITIES_LIST.forEach((c) => {
    if (!skip.includes("T4_MEAT")) put("T4_MEAT", c, MEAT_MARKET, MEAT_MARKET + 20);
    put("T4_FARM_GOAT_GROWN", c, GOAT_PRICE, GOAT_PRICE + 50);
    put("T4_BREAD", c, BREAD_MARKET, BREAD_MARKET + 5);
    put("T3_FLOUR", c, WHEAT_PRICE, WHEAT_PRICE + 5);
    put("T3_WHEAT", c, WHEAT_PRICE, WHEAT_PRICE + 5);
    put("T4_TURNIP", c, TURNIP_PRICE, TURNIP_PRICE + 5);
    put("T4_MEAL_STEW", c, STEW_SELL - 100, STEW_SELL);
  });
  return md;
}
const CITIES_LIST = ["Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Brecilien"];

function render(overrides) {
  X.consumableOpenAltRows.clear();
  X.renderConsumableTable(market(overrides));
  const state = X.tableState["consumable-table"];
  return { data: state.data.slice(), html: state.html.slice() };
}

function rowFor(state, id) {
  return state.data.find((r) => r.item && r.item.id === id && r.recipe);
}
function htmlFor(state, id) {
  const idx = state.data.findIndex((r) => r.item && r.item.id === id && r.recipe);
  return idx >= 0 ? state.html[idx] : "";
}

const base = render();
const stew = rowFor(base, "T4_MEAL_STEW");
const stewHtml = htmlFor(base, "T4_MEAL_STEW");

console.log("\n=== The row buys its ingredients at market ===");

test("the stew row rendered without throwing", () => {
  assert.ok(stew, "T4_MEAL_STEW row missing from the table");
  assert.ok(!stewHtml.startsWith("ERR:"), stewHtml.slice(0, 400));
});

test("meat is priced at the market buy even though the butcher chain is cheaper", () => {
  const meat = stew.matBestPrices.T4_MEAT;
  assert.strictEqual(meat.price, MEAT_MARKET, "row must use the market price");
  assert.strictEqual(meat.sourcing.source, "market");
  assert.ok(meat.city, "a market-sourced ingredient must name its buy city");
});

test("bread is priced at market too (its chain lost on price)", () => {
  const bread = stew.matBestPrices.T4_BREAD;
  assert.strictEqual(bread.price, BREAD_MARKET);
  assert.strictEqual(bread.sourcing.source, "market");
});

test("the Ingredients cell shows the buy city and no chain sub-tree", () => {
  assert.ok(/Goat Meat \[T4\][\s\S]{0,200}?\(from /.test(stewHtml),
    "meat line must carry a (from <city>) tag");
  assert.ok(!stewHtml.includes("↳"), "no chain leaves in the main cell");
  assert.ok(!stewHtml.includes("butcher batches"), "no batch header in the main cell");
});

console.log("\n=== The chain it passed over is kept as an alternative ===");

test("matAltChains holds the meat chain only", () => {
  const ids = (stew.matAltChains || []).map((a) => a.matId);
  assert.deepStrictEqual(ids, ["T4_MEAT"],
    `expected only the cheaper-to-make ingredient, got ${JSON.stringify(ids)}`);
});

test("the alternative carries both prices and the breakdown node", () => {
  const alt = stew.matAltChains[0];
  assert.strictEqual(alt.marketPerUnit, MEAT_MARKET);
  assert.ok(alt.chainPerUnit > 0 && alt.chainPerUnit < MEAT_MARKET);
  assert.strictEqual(alt.chain.produces, "T4_MEAT");
  assert.strictEqual(alt.chain.station, "butcher");
});

test("an ingredient with no chain recipe is never offered", () => {
  assert.ok(!(stew.matAltChains || []).some((a) => a.matId === "T4_TURNIP"));
});

test("an ingredient whose chain costs more is never offered", () => {
  assert.ok(!(stew.matAltChains || []).some((a) => a.matId === "T4_BREAD"));
});

console.log("\n=== The ▸ toggle ===");

test("the toggle appears in the Ingredients cell when an alternative exists", () => {
  assert.ok(stewHtml.includes("alternative routes"), "toggle label missing");
  assert.ok(stewHtml.includes('data-cons-alt-toggle="T4_MEAL_STEW|'),
    "toggle must carry the row key so the click handler can key the open set");
  assert.ok(stewHtml.includes("▸"), "collapsed toggle shows a closed caret");
});

test("a row with nothing left to offer gets no toggle", () => {
  // Same stew, but with no meat listing anywhere: the chain is then the route
  // the row TOOK, not one it passed over, so there is no panel to open.
  const state = render({ skip: ["T4_MEAT"] });
  const row = rowFor(state, "T4_MEAL_STEW");
  assert.ok(row, "the row must still render");
  assert.strictEqual((row.matAltChains || []).length, 0);
  assert.ok(!htmlFor(state, "T4_MEAL_STEW").includes("alternative routes"),
    "no toggle for a panel that would be empty");
});

console.log("\n=== The panel ===");

test("collapsed row emits no panel", () => {
  assert.strictEqual(X.consumableAltRoutesRow(stew, "T4_MEAL_STEW|royal"), "");
  assert.ok(!stewHtml.includes("cp-paths-row"));
});

test("open row emits the panel with the chain breakdown", () => {
  X.consumableOpenAltRows.add("T4_MEAL_STEW|royal");
  const html = X.consumableAltRoutesRow(stew, "T4_MEAL_STEW|royal");
  X.consumableOpenAltRows.clear();
  assert.ok(html.includes("make Goat Meat [T4] yourself"), "names the ingredient");
  assert.ok(html.includes("saves"), "quotes the saving");
  assert.ok(html.includes("butcher batches"), "reuses the chain breakdown tree");
  assert.ok(html.includes("Grown Goat"), "shows the chain's leaf");
  assert.ok(html.includes('data-item-id="T4_FARM_GOAT_GROWN"'),
    "the leaf price stays click-to-edit inside the panel");
});

test("the panel row spans the table and carries NO data-row-key", () => {
  X.consumableOpenAltRows.add("T4_MEAL_STEW|royal");
  const html = X.consumableAltRoutesRow(stew, "T4_MEAL_STEW|royal");
  X.consumableOpenAltRows.clear();
  assert.ok(html.includes(`colspan="${X.CONS_ALT_COL_COUNT}"`), "panel must span every column");
  assert.strictEqual(X.CONS_ALT_COL_COUNT, 12, "consumable-table has 12 columns");
  assert.ok(!html.includes("data-row-key"),
    "a second row sharing the parent's key would confuse sorting, filters and the Craft List cloner");
});

test("an open row renders the panel right after its own </tr>", () => {
  X.consumableOpenAltRows.add("T4_MEAL_STEW|royal");
  const open = render_keepOpen();
  const html = htmlFor(open, "T4_MEAL_STEW");
  X.consumableOpenAltRows.clear();
  assert.ok(html.includes("▾ alternative routes"), "open toggle shows an open caret");
  const trEnd = html.lastIndexOf("</tr>");
  const panelIdx = html.indexOf("cp-paths-row");
  assert.ok(panelIdx > 0 && panelIdx < trEnd, "panel must sit inside the same emitted chunk");
});

// Render without clearing the open set, so the open-state path is exercised.
function render_keepOpen() {
  X.renderConsumableTable(market());
  const state = X.tableState["consumable-table"];
  return { data: state.data.slice(), html: state.html.slice() };
}

console.log("\n=== Savings arithmetic ===");

test("saving = (market − chain) × consumed × (1 + setup fee), per output unit", () => {
  const alts = X.consumableAltRoutes(stew);
  assert.strictEqual(alts.length, 1);
  const alt = alts[0];
  const expected = (alt.marketPerUnit - alt.chainPerUnit) * alt.consumedCount * (1 + X.SETUP_FEE);
  assert.ok(Math.abs(alt.savings - expected) < 1e-9, `savings ${alt.savings} != ${expected}`);
  assert.ok(alt.savings > 0, "a listed alternative must actually save something");
});

test("the consumed count is the row's own post-RRR amount per output unit", () => {
  const alt = X.consumableAltRoutes(stew)[0];
  const entry = stew.recipe.find((m) => m.matId === "T4_MEAT");
  const recipeOutput = X.getRecipeOutput("T4_MEAL_STEW");
  const perUnitCount = entry.count / recipeOutput;
  const expected = entry.noReturn ? perUnitCount : perUnitCount * (1 - stew.rrr);
  assert.ok(Math.abs(alt.consumedCount - expected) < 1e-9,
    `consumed ${alt.consumedCount} != ${expected}`);
  assert.ok(stew.rrr > 0, "fixture assumes the stew craft refunds some meat");
});

test("altProfit = the row's profit plus the saving, never replacing it", () => {
  const alt = X.consumableAltRoutes(stew)[0];
  assert.strictEqual(alt.baseProfit, stew.marginInfo.profit);
  assert.ok(Math.abs(alt.altProfit - (stew.marginInfo.profit + alt.savings)) < 1e-9);
});

test("the row's own cost and profit are untouched by the panel", () => {
  const before = { cost: stew.totalInputCost, profit: stew.marginInfo.profit };
  X.consumableAltRoutes(stew);
  assert.strictEqual(stew.totalInputCost, before.cost);
  assert.strictEqual(stew.marginInfo.profit, before.profit);
});

test("alternatives are ordered by what they save, biggest first", () => {
  const fake = {
    item: { id: "T4_MEAL_STEW" },
    recipe: [{ matId: "A", count: 10 }, { matId: "B", count: 10 }],
    rrr: 0,
    marginInfo: { profit: 0 },
    matAltChains: [
      { matId: "A", marketPerUnit: 100, chainPerUnit: 90, chain: null },
      { matId: "B", marketPerUnit: 100, chainPerUnit: 10, chain: null },
    ],
  };
  const out = X.consumableAltRoutes(fake);
  assert.deepStrictEqual(out.map((a) => a.matId), ["B", "A"]);
});

console.log("\n=== An unlisted ingredient still prices the row ===");

const unlisted = render({ skip: ["T4_MEAT"] });
const stewU = rowFor(unlisted, "T4_MEAL_STEW");
const stewUHtml = htmlFor(unlisted, "T4_MEAL_STEW");

test("with no meat listing anywhere the row survives, priced off the chain", () => {
  assert.ok(stewU, "the row must not drop off the table for one unlisted intermediate");
  assert.ok(stewU.marginInfo.margin !== -1, "must not fall back to a no-data placeholder");
  const meat = stewU.matBestPrices.T4_MEAT;
  assert.strictEqual(meat.sourcing.source, "chain");
  assert.ok(meat.price > 0, "chain must supply the price");
  assert.strictEqual(meat.unlisted, true);
});

test("the unlisted ingredient keeps its tree in the main cell, tagged", () => {
  assert.ok(stewUHtml.includes("not listed"), "the cell must say why it is priced off a chain");
  assert.ok(stewUHtml.includes("butcher batches"),
    "the tree stays where the leaves are editable — it IS the row's price now");
});

test("an ingredient the row is already making is not offered as an alternative", () => {
  assert.ok(!(stewU.matAltChains || []).some((a) => a.matId === "T4_MEAT"),
    "it is the route taken, not the road not taken");
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
