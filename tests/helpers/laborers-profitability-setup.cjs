// Shared setup for tests/laborers-profitability-*.test.cjs (split from laborers-profitability.test.cjs).
// Each part requires this once; `test` and `finish` keep one pass/fail tally per part.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

// ── Sandbox: minimal globals + stubs that mirror real utils.js behaviour ──
const sandbox = `
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SETUP_FEE = 0.025;
const PREMIUM_TAX = 0.065;

let testBmrEnabled = false;
let testOverrides = {};
let testVolumeOverrides = {};
let testCityForce = {};
function isBlackRedZoneEnabled() { return testBmrEnabled; }
function isValidSourceCity(buyCity, craftCity) {
  if (!buyCity || !craftCity) return false;
  if (isBlackRedZoneEnabled()) return true;
  if (BLACK_ZONE_CITIES.includes(buyCity) || BLACK_ZONE_CITIES.includes(craftCity)) return false;
  return (buyCity === "Caerleon") === (craftCity === "Caerleon");
}
function getOrderType() { return "instant"; }
function getOverridePrice(itemId, city) { return testOverrides[itemId + ":" + city] ?? null; }
function getOverrideVolume(itemId, city) { return testVolumeOverrides[itemId + ":" + city] ?? null; }
function getCityForce(itemId, side) { return testCityForce[itemId]?.[side] ?? null; }
function getIQRBounds() { return { upper: Infinity }; }
function formatSilver(n) { return Math.round(n).toLocaleString(); }

// Match real "instant" mode: getBuyPrice → sell_price (lowest ask, what
// you'd pay); getSellPrice → buy_price (highest bid, what you'd receive).
// Most test fixtures set buy_price === sell_price so existing assertions
// still work; contract tests deliberately split them to verify each side.
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

// Mirrors travel-cost.js: the Brecilien Travel Planner fee is disabled app-wide
// (Brecilien is reachable through safe-zone Avalonian portals in the Mists), so
// every leg costs 0 regardless of origin/dest/BMR.
function legBrecilienCost() { return 0; }
function findBestBuyCity(marketData, itemId, cities, minVolume, destCity) {
  const itemData = marketData[itemId];
  const exitFee = (c) => legBrecilienCost(c, destCity, itemId, 1);
  // Mirror utils.js:627-632 — honor buy-side city force unconditionally when
  // the forced city is in the caller's candidate list (overrides still apply
  // via getBuyPrice).
  const forced = getCityForce(itemId, "buy");
  if (forced && cities.includes(forced)) {
    const p = itemData ? getBuyPrice(itemData, forced, null, itemId) : getBuyPrice(null, forced, null, itemId);
    return { city: forced, price: p > 0 ? p : 0, travelCost: p > 0 ? exitFee(forced) : 0 };
  }
  if (!itemData) return { city: null, price: 0, travelCost: 0 };
  let bestEff = Infinity, bestCity = null, bestPrice = 0;
  for (const c of cities) {
    const p = getBuyPrice(itemData, c, null, itemId);
    if (p <= 0) continue;
    const eff = p + exitFee(c);
    if (eff < bestEff) { bestEff = eff; bestCity = c; bestPrice = p; }
  }
  return { city: bestCity, price: bestPrice, travelCost: bestCity ? exitFee(bestCity) : 0 };
}

function __setBMR(v) { testBmrEnabled = !!v; }
function __setTravelFeeRate(r) { __travelFeeRate = r; }
function __setOverrides(m) { testOverrides = m || {}; }
function __setOverride(itemId, city, price) { testOverrides[itemId + ":" + city] = price; }
function __setCityForce(itemId, side, city) {
  if (!testCityForce[itemId]) testCityForce[itemId] = {};
  testCityForce[itemId][side] = city;
}
function __reset() {
  __setBMR(false); __setOverrides({});
  testVolumeOverrides = {}; testCityForce = {};
}
`;

function loadFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", "..", rel), "utf8");
}

const dataSrc = loadFile("js/data-laborers.js");
const pricingSrc = loadFile("js/laborers-pricing.js");
const renderSrc = loadFile("js/render-laborers.js");

const mod = new Module("laborers-profitability-test");
mod._compile(
  sandbox + dataSrc + pricingSrc + renderSrc +
    "\nmodule.exports = { LABORER_MODE, LABORERS, TROPHY_LABORERS, LABORER_TIERS, getLaborerYield, getLaborerYieldFor, " +
    "GATHERER_BASELOOT, CRAFTING_BASELOOT, MERCENARY_SILVER_BY_TIER, ENCHANT_DISTRIBUTION, getLaborerEnchantDistribution, " +
    "FISH_LABORER_BASELOOT, FISH_JOURNAL_LOOTLIST, getFishResourceIds, _fishResourceRevenue, " +
    "getLaborerFilledJournalId, getLaborerEmptyJournalId, getLaborerTrophyId, getLaborerContractId, " +
    "getEnchantedResourceId, getLaborerForTrophyLine, getLaborersItemIds, " +
    "getLaborerUpgradeJournals, LABORER_FAME_PER_JOURNAL, LABORER_FAME_TO_UPGRADE, HIRE_COST, " +
    "computeBestLaborerRoute, buildLaborersRowData, computeBestLevelingPath, " +
    "_trophyRevenue, _resourceRevenue, _craftingRevenue, _mercenaryRevenue, " +
    "_levelingFameKeys, _contractPricesAllTiers, _bestJournalForLaborer, " +
    "__setBMR, __setOverrides, __setOverride, __setCityForce, __reset, SETUP_FEE, PREMIUM_TAX };",
  "laborers-profitability.js"
);
const M = mod.exports;
const {
  LABORER_MODE, LABORERS, TROPHY_LABORERS, LABORER_TIERS, getLaborerYield, getLaborerYieldFor,
  GATHERER_BASELOOT, CRAFTING_BASELOOT, MERCENARY_SILVER_BY_TIER, ENCHANT_DISTRIBUTION, getLaborerEnchantDistribution,
  FISH_LABORER_BASELOOT, FISH_JOURNAL_LOOTLIST, getFishResourceIds, _fishResourceRevenue,
  getLaborerFilledJournalId, getLaborerEmptyJournalId, getLaborerTrophyId, getLaborerContractId,
  getEnchantedResourceId, getLaborersItemIds,
  computeBestLaborerRoute, buildLaborersRowData, computeBestLevelingPath, _bestJournalForLaborer,
  getLaborerUpgradeJournals, LABORER_FAME_PER_JOURNAL, LABORER_FAME_TO_UPGRADE, HIRE_COST,
  __setBMR, __setOverride, __setCityForce, __reset,
  SETUP_FEE, PREMIUM_TAX,
} = M;

let passed = 0, failed = 0;
function test(name, fn) {
  try { __reset(); fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

function approx(actual, expected, tol = 0.01) {
  assert.ok(Math.abs(actual - expected) <= tol,
    `expected ~${expected}, got ${actual}`);
}

function md(entries) {
  const out = {};
  for (const e of entries) {
    if (!out[e.id]) out[e.id] = {};
    out[e.id][e.city] = { buy_price: e.price, sell_price: e.price, volume_24h: 9999 };
  }
  return out;
}

const FS = "Fort Sterling";
const LY = "Lymhurst";
const BR = "Brecilien";


// Helper for contracts: lets us set buy_price ≠ sell_price so we can verify
// that contractBuyCost reads from sell_price (lowest ask) and contractSell
// reads from buy_price (highest bid) — that's how real markets quote a spread.
function mdSplit(entries) {
  const out = {};
  for (const e of entries) {
    if (!out[e.id]) out[e.id] = {};
    out[e.id][e.city] = {
      buy_price:  e.bid ?? e.price,
      sell_price: e.ask ?? e.price,
      volume_24h: 9999,
    };
  }
  return out;
}


function finish() {
  // ────────────────────────────────────────────────────────────────────────────
  console.log(`\n--- ${passed} passed, ${failed} failed ---`);
  process.exit(failed > 0 ? 1 : 0);
}

module.exports = {
  assert, fs, path, Module, sandbox, loadFile, dataSrc, pricingSrc, renderSrc, mod, M, LABORER_MODE, LABORERS, TROPHY_LABORERS, LABORER_TIERS, getLaborerYield, getLaborerYieldFor, GATHERER_BASELOOT, CRAFTING_BASELOOT, MERCENARY_SILVER_BY_TIER, ENCHANT_DISTRIBUTION, getLaborerEnchantDistribution, FISH_LABORER_BASELOOT, FISH_JOURNAL_LOOTLIST, getFishResourceIds, _fishResourceRevenue, getLaborerFilledJournalId, getLaborerEmptyJournalId, getLaborerTrophyId, getLaborerContractId, getEnchantedResourceId, getLaborersItemIds, computeBestLaborerRoute, buildLaborersRowData, computeBestLevelingPath, _bestJournalForLaborer, getLaborerUpgradeJournals, LABORER_FAME_PER_JOURNAL, LABORER_FAME_TO_UPGRADE, HIRE_COST, __setBMR, __setOverride, __setCityForce, __reset, SETUP_FEE, PREMIUM_TAX, passed, failed, test, approx, md, FS, LY, BR, mdSplit, finish,
};
