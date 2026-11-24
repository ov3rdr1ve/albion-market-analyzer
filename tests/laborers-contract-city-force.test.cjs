/**
 * Test: Laborers table — an edited price keeps the city it was typed at.
 *
 * The price editor stores an override at the city the user picked AND pins a
 * city force there (js/app.js). Cells that priced at the row's route city only
 * never saw either, so a Buy Contract price typed at Lymhurst re-rendered at
 * Caerleon — the reported "it resets to Caerleon".
 *
 * Black-box: drive the real buildLaborersRowData / _contractLookup /
 * _contractPricesAllTiers over synthetic market data and assert which city and
 * price each cell comes back with.
 *
 * Run: node tests/laborers-contract-city-force.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

function loadFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

// Minimal mirror of the real globals. getBuyPrice/getSellPrice honour an
// override only AT THE CITY THEY ARE HANDED (js/utils.js:928) — that asymmetry
// is exactly what the fix is about, so it is reproduced faithfully here.
const sandbox = `
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SETUP_FEE = 0.025;
const PREMIUM_TAX = 0.065;

let testOverrides = {};
let testCityForce = {};
function isBlackRedZoneEnabled() { return false; }
function getOrderType() { return "instant"; }
function getOverridePrice(itemId, city) { return testOverrides[itemId + ":" + city] ?? null; }
function getOverrideVolume() { return null; }
function getCityForce(itemId, side) { return testCityForce[itemId]?.[side] ?? null; }
function getIQRBounds() { return { upper: Infinity }; }
function formatSilver(n) { return Math.round(n).toLocaleString(); }
function legBrecilienCost() { return 0; }

function getBuyPrice(itemData, city, bounds, itemId) {
  const ov = itemId ? getOverridePrice(itemId, city) : null;
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].sell_price || itemData[city].buy_price || 0;
}
function getSellPrice(itemData, city, bounds, itemId) {
  const ov = itemId ? getOverridePrice(itemId, city) : null;
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].buy_price || itemData[city].sell_price || 0;
}
function findBestBuyCity(marketData, itemId, cities) {
  const forced = getCityForce(itemId, "buy");
  if (forced && cities.includes(forced)) {
    const p = getBuyPrice(marketData[itemId], forced, null, itemId);
    return { city: forced, price: p > 0 ? p : 0, travelCost: 0 };
  }
  let bestCity = null, bestPrice = 0;
  for (const c of cities) {
    const p = getBuyPrice(marketData[itemId], c, null, itemId);
    if (p <= 0) continue;
    if (!bestCity || p < bestPrice) { bestCity = c; bestPrice = p; }
  }
  return { city: bestCity, price: bestPrice, travelCost: 0 };
}

function __setOverride(itemId, city, price) { testOverrides[itemId + ":" + city] = price; }
function __setCityForce(itemId, side, city) {
  if (!testCityForce[itemId]) testCityForce[itemId] = {};
  testCityForce[itemId][side] = city;
}
function __reset() { testOverrides = {}; testCityForce = {}; }
`;

const mod = new Module("laborers-contract-city-force-test");
mod._compile(
  sandbox +
    loadFile("js/data-laborers.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/laborers-pricing.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/render-laborers.js").replace(/if \(typeof module[\s\S]*$/, "") +
    "\nmodule.exports = { LABORERS, LABORER_MODE, LABORER_TIERS, buildLaborersRowData, " +
    "_contractLookup, _contractPricesAllTiers, _laborerJournalRowSpec, " +
    "getLaborerContractId, getLaborerFilledJournalId, getLaborerEmptyJournalId, " +
    "__setOverride, __setCityForce, __reset };",
  "laborers-contract-city-force.js",
);
const {
  LABORERS, LABORER_MODE, buildLaborersRowData,
  _contractLookup, _contractPricesAllTiers, _laborerJournalRowSpec,
  getLaborerContractId, getLaborerFilledJournalId,
  __setOverride, __setCityForce, __reset,
} = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { __reset(); fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const CAER = "Caerleon";
const LYM = "Lymhurst";
const MART = "Martlock";

const MERC = LABORERS.find((l) => l.slug === "MERCENARY");
const CONTRACT_T8 = getLaborerContractId(MERC.contractSlug, 8);
const CONTRACT_T5 = getLaborerContractId(MERC.contractSlug, 5);

// Mercenary mode pays flat silver, so a row only needs its filled journal priced
// to produce a route — which keeps these fixtures about the contract cells.
// Filled journals are cheapest in Caerleon, so every route runs out of Caerleon
// and every contract cell defaults to Caerleon (the reported symptom's city).
function mercMarket(extra = {}) {
  const md = {};
  [2, 3, 4, 5, 6, 7, 8].forEach((tier) => {
    md[getLaborerFilledJournalId(MERC.slug, tier)] = {
      [CAER]: { buy_price: 1000, sell_price: 1000, volume_24h: 9999 },
    };
  });
  md[CONTRACT_T8] = { [CAER]: { buy_price: 900000, sell_price: 1000000, volume_24h: 9999 } };
  md[CONTRACT_T5] = { [CAER]: { buy_price: 90000, sell_price: 100000, volume_24h: 9999 } };
  return { ...md, ...extra };
}

const mercRow = (md, tier) => buildLaborersRowData(md).find(
  (r) => r.mode === LABORER_MODE.MERCENARY && r.tier === tier,
);

// ── The Buy Contract cell ──────────────────────────────────────────────────
console.log("\n=== Buy Contract cell ===");

test("with no pin the contract prices at the route city", () => {
  const row = mercRow(mercMarket(), 8);
  assert.ok(row, "mercenary T8 row exists");
  assert.strictEqual(row.rowContract.city, CAER);
  assert.strictEqual(row.rowContract.buyPrice, 1000000); // instant buy = the ask
});

test("a price typed at another city keeps that city", () => {
  __setOverride(CONTRACT_T8, LYM, 555000);
  __setCityForce(CONTRACT_T8, "buy", LYM);
  const row = mercRow(mercMarket(), 8);
  assert.strictEqual(row.rowContract.city, LYM,
    "the cell must re-render at the city the price was typed at, not the route city");
  assert.strictEqual(row.rowContract.buyPrice, 555000);
});

test("a force with no override behind it is inert", () => {
  __setCityForce(CONTRACT_T8, "buy", LYM);       // e.g. left over from a cleared override
  const row = mercRow(mercMarket(), 8);
  assert.strictEqual(row.rowContract.city, CAER);
  assert.strictEqual(row.rowContract.buyPrice, 1000000);
});

test("the pin is per contract tier — T5 pinned leaves T8 alone", () => {
  __setOverride(CONTRACT_T5, MART, 42000);
  __setCityForce(CONTRACT_T5, "buy", MART);
  const md = mercMarket();
  assert.strictEqual(mercRow(md, 5).rowContract.city, MART);
  assert.strictEqual(mercRow(md, 5).rowContract.buyPrice, 42000);
  assert.strictEqual(mercRow(md, 8).rowContract.city, CAER);
});

test("the buy-and-hold T8 contract honours the same pin", () => {
  __setOverride(CONTRACT_T8, LYM, 555000);
  __setCityForce(CONTRACT_T8, "buy", LYM);
  const row = mercRow(mercMarket(), 5);
  assert.strictEqual(row.contract.city, LYM);
  assert.strictEqual(row.contract.buyPrice, 555000);
});

test("the sell side pins independently of the buy side", () => {
  __setOverride(CONTRACT_T8, MART, 777000);
  __setCityForce(CONTRACT_T8, "sell", MART);
  const c = _contractLookup(
    _laborerJournalRowSpec(MERC, 8, LABORER_MODE.MERCENARY), mercMarket(), CAER,
  );
  assert.strictEqual(c.sellPrice, 777000, "sell reads the pinned city");
  assert.strictEqual(c.city, CAER, "buy side is untouched by a sell pin");
});

// ── No-data rows ───────────────────────────────────────────────────────────
console.log("\n=== Rows with no route ===");

test("a no-route row's contract cell keeps the pinned city too", () => {
  __setOverride(CONTRACT_T8, MART, 333000);
  __setCityForce(CONTRACT_T8, "buy", MART);
  // No filled journals priced anywhere → no route, so the row falls back to its
  // anchor city. The pin must still win, or the typed price is invisible on
  // exactly the rows the user is trying to fill in by hand.
  const row = mercRow({}, 8);
  assert.ok(row, "the row still renders without market data");
  assert.strictEqual(row.rowContract.city, MART);
  assert.strictEqual(row.rowContract.buyPrice, 333000);
});

test("a no-route row's filled-journal cell keeps the pinned city", () => {
  const filled = getLaborerFilledJournalId(MERC.slug, 8);
  __setOverride(filled, MART, 4321);
  __setCityForce(filled, "buy", MART);
  const row = mercRow({}, 8);
  assert.strictEqual(row.buy.city, MART);
  assert.strictEqual(row.buy.price, 4321);
});

// ── Best Leveling Path ─────────────────────────────────────────────────────
console.log("\n=== Leveling path prices ===");

test("_contractPricesAllTiers reads a pinned tier at its pinned city", () => {
  __setOverride(CONTRACT_T5, LYM, 61000);
  __setCityForce(CONTRACT_T5, "buy", LYM);
  const prices = _contractPricesAllTiers(MERC, mercMarket(), CAER);
  assert.strictEqual(prices[5].buy, 61000, "the pinned price feeds the leveling path");
  assert.strictEqual(prices[8].buy, 1000000, "unpinned tiers stay on the route city");
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
