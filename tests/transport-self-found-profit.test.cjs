/**
 * Test: the Refining/Transports table's Pure Profit twin — plan.md step 1
 * (TDD red).
 *
 * The refining row already prices a gathered basis: computeRefineGatheredProfit
 * (js/refining-route.js) values the route with the RAW side free — raws cost 0
 * here and at every step of a secondary chain (chainSilverCostGathered), carry
 * no haul-out fee, while market-bought bars stay paid with their setup fee,
 * station fee, haul fees on bought legs and the sell tax all kept.
 *
 * The twin under test is that same basis surfaced on the Pure Profit cell:
 *
 *   marginInfo.selfFoundProfit (or row.selfFoundProfit)
 *     = the computeRefineGatheredProfit figure for the SAME row.
 *
 * Black-box: drive the REAL renderTransportTable (+ real refining-chain
 * recipes/pricing, real calculations.js getters) with synthetic market data and
 * a single-route TRANSPORT_ITEMS catalog (harness mirrors
 * tests/refining-no-data-row-render.test.cjs). Exact hand values on a
 * single-tier route; a chained route asserts consistency with the row's own
 * gathered figure. No live API.
 *
 * Tax getter control (repo convention): the live PREMIUM_TAX/SETUP_FEE getters
 * from js/calculations.js resolve the #premium-account checkbox stub and a
 * fixed "market" order type — the same _els pattern
 * tests/breeding-self-found-per10k-focus.test.cjs uses.
 *
 * RED BY DESIGN: nothing writes selfFoundProfit yet, so the twin assertions
 * fail on the missing field. The gathered-figure regressions pass before AND
 * after.
 *
 * Run: node --test tests/transport-self-found-profit.test.cjs
 */

const assert = require("assert");
const { test } = require("node:test");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const J = (f) => fs.readFileSync(path.join(ROOT, "js", f), "utf8").replace(/\r\n/g, "\n");

const REFINERY_FEE = 360; // flat silver the stubbed refinery charges per output

const sandbox = `
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];

// refining-chain-recipes.js walks this at load to build its recipe ladder.
const RESOURCE_DEFS = [
  { type: "wood", raw: "WOOD", refined: "PLANKS",
    tiers: [[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
];

const _els = {
  "premium-account": { checked: true },
  "station-fee": { value: "0" },
};
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const window = { addEventListener: () => {} };
// The live PREMIUM_TAX / SETUP_FEE getters (js/calculations.js) resolve these.
function isPremiumEnabled() {
  const cb = document.getElementById("premium-account");
  return !cb || cb.checked;
}
function getOrderType() { return "market"; }

function isBlackRedZoneEnabled() { return false; }
function isValidSourceCity(buyCity, craftCity) {
  if (!buyCity || !craftCity) return false;
  if (isBlackRedZoneEnabled()) return true;
  if (BLACK_ZONE_CITIES.includes(buyCity) || BLACK_ZONE_CITIES.includes(craftCity)) return false;
  return (buyCity === "Caerleon") === (craftCity === "Caerleon");
}
function isFocusEnabled() { return false; }
function getOverridePrice() { return null; }
function getOverrideVolume() { return null; }
function getCityForce() { return null; }
function isInvalidCrossRoute() { return false; }
function getIQRBounds() { return { upper: Infinity }; }
function getBuyPrice(itemData, city) { return (itemData && itemData[city] && itemData[city].buy_price) || 0; }
function getSellPrice(itemData, city) { return (itemData && itemData[city] && itemData[city].sell_price) || 0; }
function getCityVol(md, id, c) { return (md && md[id] && md[id][c] && md[id][c].volume_24h) || 0; }
function getTierFromId(id) { const m = String(id).match(/T(\\d+)/); return m ? parseInt(m[1],10) : 0; }
function getFocusCost() { return 100; }
function calcStationFeeSilver() { return 0; }
function refineStationFeeSilver() { return ${REFINERY_FEE}; }
function legBrecilienCost() { return 0; }   // no Brecilien legs in these fixtures
function getMinVol() { return 0; }
function getMinVol2() { return 0; }
function matsNeededFor10kFocus(focusCost, per, applyRrr, rrr) { const c = Math.floor(10000/focusCost); const e = applyRrr ? per*(1-(rrr||0)) : per; return Math.round(c*e); }
function formatSilver(n) { if (n === null || n === undefined) return "N/A"; return Math.round(n).toLocaleString("en-US"); }
function formatFocusCost(n) { if (n == null || !Number.isFinite(n)) return "N/A"; const a = Math.abs(n); if (a >= 100) return Math.round(n).toLocaleString("en-US"); return String(Number(n.toFixed(a >= 10 ? 1 : 2))); }
function getItemDisplayName(id) { return id; }
function matPriceSpan(id, city, price) { return "<span class='mat' data-item-id='"+id+"' data-city='"+(city||"")+"'>@ "+(price>0?price:"no data")+" ea</span>"; }
function resourceAliasSpan() { return ""; }
function aggregateCostTd(c, cls) { return '<td class="' + (cls || "silver-val cell-num") + '">' + (Number(c) > 0 ? c : "—") + '</td>'; }
function priceTd(p) { return "<td class='price'>"+(p>0?p:"no data")+"</td>"; }
function profitTd(mi) { return "<td class='PROFITPCT'>"+mi.margin.toFixed(2)+"%</td>"; }
function pureProfitTd(mi) { const pr = mi && mi.profit; if (pr===undefined||pr===null) return "<td class='PUREPROFIT'>dash</td>"; return "<td class='PUREPROFIT'>"+pr+"</td>"; }
function volTd(v) { return "<td class='vol'>"+v+"</td>"; }
function addTdForKey(){ return '<td class="cell-add"></td>'; }
function getRowKey(row) { return row.route.refinedId + "|" + (row.section || ""); }
function findBestBuyCity(marketData, itemId, cities) { let best = { city: null, price: 0 }; for (const c of cities) { const p = getBuyPrice(marketData[itemId], c); if (p > best.price) best = { city: c, price: p }; } if (!best.city) best = { city: cities[0] || null, price: 0 }; return best; }
function findBestSellCity(marketData, itemId, cities) { let best = { city: null, price: 0 }; for (const c of cities) { const p = getSellPrice(marketData[itemId], c); if (p > best.price) best = { city: c, price: p }; } if (!best.city) best = { city: cities[0] || null, price: 0 }; return best; }
function renderChainBreakdown() { return ""; }
const captured = { rows: [], html: [] };
function renderTableData(id, rows, fmt) { captured.tableId = id; captured.rows = rows; captured.html = rows.map((r,i) => { try { return fmt(r,i); } catch(e){ return "ERR:"+e.message; } }); }

// One synthetic single-tier route (NO secondary bar) and one chained route.
const TRANSPORT_ITEMS = [
  { mat: "Whitewood Logs [T6]", rawId: "T6_WOOD", refinedId: "T6_PLANKS",
    rawRatio: 4, resourceType: "wood" },
  { mat: "Whitewood Logs [T8]", rawId: "T8_WOOD", refinedId: "T8_PLANKS",
    rawRatio: 5, resourceType: "wood", secondaryMatId: "T7_PLANKS", secondaryMatCount: 1 },
];
`;

const mod = new Module("transport-self-found-profit-test");
mod._compile(
  sandbox +
    J("route-cell.js") +
    J("focus-play.js") +
    J("data-city-bonuses.js") +
    (J("calculations.js") + J("calculations-margins.js")) +
    J("refining-chain-recipes.js") +
    J("refining-chain-pricing.js") +
    J("refining-route.js") + J("render-transport.js") +
    "\nfunction fees(){ return { premiumTax: PREMIUM_TAX, setupFee: SETUP_FEE }; }" +
    "\nmodule.exports = { renderTransportTable, captured, _els, fees };",
  "transport-self-found-profit.js",
);
const X = mod.exports;

// The twin lands on marginInfo.selfFoundProfit; accept a row field (plan.md
// allows either shape).
const sfOf = (row) => {
  if (row.marginInfo && row.marginInfo.selfFoundProfit !== undefined) {
    return row.marginInfo.selfFoundProfit;
  }
  return row.selfFoundProfit;
};

const near = (a, b) => Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-9);

const FS = "Fort Sterling";

// Single-tier market: raws at 1,000, planks sell at 40,000 — all at the wood
// spec city so the fallback path prices a real row.
const singleTierMarket = () => ({
  T6_WOOD: { [FS]: { buy_price: 1000, sell_price: 1100, volume_24h: 9999 } },
  T6_PLANKS: { [FS]: { buy_price: 1, sell_price: 40000, volume_24h: 9999 } },
});

function singleTierRow() {
  X.renderTransportTable(singleTierMarket());
  const row = X.captured.rows.find(
    (r) => r.route && r.route.refinedId === "T6_PLANKS" && r.refineCity === FS && r.marginInfo.margin !== -1);
  assert.ok(row, "the fully-priced single-tier Fort Sterling row must render");
  return row;
}

test("fixture sanity: the single-tier row prices raws, sale and a real station fee", () => {
  const row = singleTierRow();
  assert.ok(row.sellRefined.price === 40000, "the sale is injected");
  assert.ok(row.buyRaw.price === 1000, "the raws are bought at 1,000");
  assert.ok(row.gatheredProfit != null && Number.isFinite(row.gatheredProfit),
    "the gathered basis must already be valued on the row");
  assert.ok(!row.route.secondaryMatId, "the fixture is single-tier");
});

test("single-tier twin: raws zeroed, refinery fee and taxes kept — exact value", () => {
  const row = singleTierRow();
  assert.strictEqual(typeof sfOf(row), "number",
    "selfFoundProfit missing on the refining row (feature not implemented)");
  // 40,000 x (1 - 0.065) - 360 = 37,400 - 360 = 37,040.
  const want = 40000 * (1 - X.fees().premiumTax) - REFINERY_FEE;
  assert.ok(near(sfOf(row), want), `twin ${sfOf(row)} != ${want}`);
});

test("single-tier twin: equals the computeRefineGatheredProfit basis for the same row", () => {
  const row = singleTierRow();
  assert.ok(near(sfOf(row), row.gatheredProfit),
    `twin ${sfOf(row)} != gathered basis ${row.gatheredProfit}`);
  assert.ok(row.marginInfo.profit < sfOf(row),
    "the bought profit must sit below the self-found twin");
});

test("single-tier twin: follows the live premium-account getter", () => {
  X._els["premium-account"].checked = false;
  try {
    const row = singleTierRow();
    // 40,000 x (1 - 0.105) - 360 = 35,800 - 360 = 35,440.
    const want = 40000 * (1 - X.fees().premiumTax) - REFINERY_FEE;
    assert.ok(near(sfOf(row), want), `twin ${sfOf(row)} != ${want}`);
  } finally {
    X._els["premium-account"].checked = true;
  }
});

// Chained route: raws free at every step, the MARKET-BOUGHT T7 bar stays paid
// (with its setup fee), the refinery fee and taxes stay — the twin must keep
// matching the row's own gathered figure, whatever the chain costs.
const chainedMarket = () => {
  const md = {};
  const set = (id, buy, sell) => { md[id] = { [FS]: { buy_price: buy, sell_price: sell, volume_24h: 9999 } }; };
  set("T8_PLANKS", 1, 30000);
  set("T8_WOOD", 1500, 1600);
  set("T7_PLANKS", 3000, 3100);
  set("T7_WOOD", 800, 900);
  set("T6_WOOD", 400, 500);
  set("T5_WOOD", 150, 200);
  set("T4_WOOD", 80, 120);
  return md;
};

test("chained twin: raws free down the chain, market-bought bars paid", () => {
  X.renderTransportTable(chainedMarket());
  const row = X.captured.rows.find(
    (r) => r.route && r.route.refinedId === "T8_PLANKS" && r.refineCity === FS && r.marginInfo.margin !== -1);
  assert.ok(row, "the fully-priced chained Fort Sterling row must render");
  assert.strictEqual(typeof sfOf(row), "number",
    "selfFoundProfit missing on the chained refining row (feature not implemented)");
  assert.ok(near(sfOf(row), row.gatheredProfit),
    `twin ${sfOf(row)} != gathered basis ${row.gatheredProfit}`);
  const revenue = row.sellRefined.price * (1 - X.fees().premiumTax);
  assert.ok(sfOf(row) < revenue && row.gatheredProfit > 0,
    "fixture precondition: the chained gathered basis must be positive but taxed");
});

test("regression: the bought pure profit keeps pricing the market raws", () => {
  const row = singleTierRow();
  assert.ok(row.marginInfo.profit != null && Number.isFinite(row.marginInfo.profit),
    "the bought profit must stay finite");
  assert.ok(row.marginInfo.profit < row.gatheredProfit,
    "buying the raws must cost more than gathering them");
});
