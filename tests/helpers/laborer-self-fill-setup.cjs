// Shared setup for tests/laborer-self-fill-*.test.cjs (split from laborer-self-fill.test.cjs).
// Each part requires this once; `test` and `finish` keep one pass/fail tally per part.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

function loadFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", "..", rel), "utf8");
}

const store = new Map();

const sandbox = `
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SETUP_FEE = 0.025;
const PREMIUM_TAX = 0.065;

function isBlackRedZoneEnabled() { return false; }
function getOrderType() { return "instant"; }
function getOverridePrice() { return null; }
function getOverrideVolume() { return null; }
function getCityForce() { return null; }
function getIQRBounds() { return { upper: Infinity }; }
function formatSilver(n) { return Math.round(n).toLocaleString(); }
function tx(en) { return en; }

function getBuyPrice(itemData, city) {
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].sell_price || itemData[city].buy_price || 0;
}
function getSellPrice(itemData, city) {
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].buy_price || itemData[city].sell_price || 0;
}
function findBestBuyCity(marketData, itemId, cities) {
  let bestCity = null, bestPrice = 0;
  for (const c of cities) {
    const p = getBuyPrice(marketData[itemId], c);
    if (p <= 0) continue;
    if (!bestCity || p < bestPrice) { bestCity = c; bestPrice = p; }
  }
  return { city: bestCity, price: bestPrice, travelCost: 0 };
}
function findBestSellCity(marketData, itemId, cities) {
  let bestCity = null, bestPrice = 0;
  for (const c of cities) {
    const p = getSellPrice(marketData[itemId], c);
    if (p <= 0) continue;
    if (!bestCity || p > bestPrice) { bestCity = c; bestPrice = p; }
  }
  return { city: bestCity, price: bestPrice };
}
`;

// The REAL journal economics, so the fame price this sandbox charges can never
// drift from the Journal Filling table's own margin. Injected as a global
// because the sandbox resolves bare identifiers against this process's globals.
global.calcJournalEconomics = require("../../js/calculations.js").calcJournalEconomics;

const mod = new Module("laborer-self-fill-test");
mod._compile(
  sandbox +
    loadFile("js/data-gathering.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/gather-fame-rates.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/data-journals.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/journal-fill-speed.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/journal-fame-price.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/data-laborers.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/laborers-pricing.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/data-craft-planner.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/laborer-journal-value.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/laborer-self-fill.js").replace(/if \(typeof module[\s\S]*$/, "") +
    "\nmodule.exports = { LABORERS, TROPHY_LABORERS, LABORER_TIERS, LABORER_MODE, " +
    "getLaborersItemIds, getLaborerYield, getLaborerJournalYield, _computeRevenueForMode, " +
    "_laborerJournalRowSpec, _trophyRowSpec, LABORER_CYCLE_HOURS, laborerSelfFillPayout, " +
    "computeLaborerSelfFill, selfFillCapacity, " +
    "getJournalFamePrice, getJournalFameCost, getJournalFameBill, getJournalMaxfame, " +
    "GATHER_BASE_FAME_PER_HOUR };",
  "laborer-self-fill.js",
);

// localStorage must exist before the module reads the pref, and the compiled
// sandbox shares this process's globals.
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const {
  LABORERS, TROPHY_LABORERS, LABORER_MODE, getLaborersItemIds,
  getLaborerJournalYield, _computeRevenueForMode, _laborerJournalRowSpec, _trophyRowSpec,
  LABORER_CYCLE_HOURS, laborerSelfFillPayout, computeLaborerSelfFill, selfFillCapacity,
  getJournalFamePrice, getJournalFameBill, getJournalMaxfame,
  GATHER_BASE_FAME_PER_HOUR,
} = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}
// The legacy storage key the removed Gathering Tier control wrote. Cases below
// keep setting it to prove a stale value can no longer move a row's pricing.
const LEGACY_TIER_KEY = "journalFillTier";
const setPref = (v) => { if (v == null) store.delete(LEGACY_TIER_KEY); else store.set(LEGACY_TIER_KEY, String(v)); };
const CITY = "Lymhurst";

// ── synthetic market ───────────────────────────────────────────────────────
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}
function syntheticMarket(journalPriceFactor = 1) {
  const md = {};
  const cities = ["Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Brecilien"];
  getLaborersItemIds().forEach((id) => {
    md[id] = {};
    const isJournal = id.includes("_JOURNAL_");
    cities.forEach((c) => {
      let price = 40 + (hash(id + c) % 9000);
      if (isJournal) price = Math.max(1, Math.round(price * journalPriceFactor));
      md[id][c] = { buy_price: price, sell_price: Math.round(price * 1.15), volume_24h: 9999 };
    });
  });
  return md;
}
const MD = syntheticMarket();

function specFor(laborer, tier, mode) { return _laborerJournalRowSpec(laborer, tier, mode); }
function trophySpecFor(line, tier) { return _trophyRowSpec(line, tier); }

const GATHERING_LABORERS = LABORERS.filter((l) => l.modes.includes(LABORER_MODE.RESOURCE));
const CRAFTING_LABORERS = LABORERS.filter((l) => l.modes.includes(LABORER_MODE.CRAFTING));
const PROFESSION_TROPHIES = TROPHY_LABORERS.filter((l) => l.journalSlug !== "TROPHY_MERCENARY" && l.journalSlug !== "TROPHY_GENERAL");

const ORE = LABORERS.find((l) => l.slug === "ORE");
const FISHER = LABORERS.find((l) => l.slug === "FISHING");

function finish() {
  setPref(null);
  console.log(`\n--- ${passed} passed, ${failed} failed ---`);
  process.exit(failed > 0 ? 1 : 0);
}

module.exports = {
  assert, fs, path, Module, loadFile, store, sandbox, mod, LABORERS, TROPHY_LABORERS, LABORER_MODE, getLaborersItemIds, getLaborerJournalYield, _computeRevenueForMode, _laborerJournalRowSpec, _trophyRowSpec, LABORER_CYCLE_HOURS, laborerSelfFillPayout, computeLaborerSelfFill, selfFillCapacity, getJournalFamePrice, getJournalFameBill, getJournalMaxfame, GATHER_BASE_FAME_PER_HOUR, passed, failed, test, LEGACY_TIER_KEY, setPref, CITY, hash, syntheticMarket, MD, specFor, trophySpecFor, GATHERING_LABORERS, CRAFTING_LABORERS, PROFESSION_TROPHIES, ORE, FISHER, finish,
};
