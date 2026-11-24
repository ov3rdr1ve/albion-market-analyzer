/**
 * Test: the Faction dropdown filters the Favor (Energy Manipulator / Shadow Hand)
 * rows as their own "Favor" group — the same way it filters each faction.
 *
 * Contract (black-box on which rows survive buildFactionSpendingRows):
 *   - "" (All factions)      → both FP rows and Favor rows present.
 *   - "Thetford" (a faction) → only Thetford FP rows; NO Favor rows.
 *   - "Favor"                → only Favor rows; NO FP rows.
 *
 * Loads the real js/render-faction-spending.js + js/render-favor-spending.js +
 * js/data-favor-costs.js via Module._compile with faithful helper mirrors and a
 * settable #faction-spending-filter dropdown stub.
 *
 * Run: node tests/faction-spending-favor-filter.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

// Row text runs through tx(english, slug); en-mode identity keeps assertions in English.
globalThis.tx = globalThis.tx || ((en) => en);
const assert = require("assert");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const fpCostsSrc = read("js/data-faction-fp-costs.js");
const favCostsSrc = read("js/data-favor-costs.js");
const favRenderSrc = read("js/render-favor-spending.js");
const renderSrc = read("js/render-faction-spending.js");

const stubs = `
${fpCostsSrc}
${favCostsSrc}

let _filterValue = "";

const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const FACTION_CHESTS = [];
const DEFAULT_CHEST_AVG_YIELD = 73800;
const tableState = { "mounts-table": { data: [] } };

const FACTION_BIOME_TO_CITY = {
  SWAMP: "Thetford", FOREST: "Lymhurst", MOUNTAIN: "Fort Sterling",
  HIGHLAND: "Martlock", STEPPE: "Bridgewatch", CAERLEON: "Caerleon",
};
const FW_CITY_SUFFIX_MAP = {
  THETFORD: "Thetford", LYMHURST: "Lymhurst", FORTSTERLING: "Fort Sterling",
  BRIDGEWATCH: "Bridgewatch", MARTLOCK: "Martlock", CAERLEON: "Caerleon",
};
function getFactionLockCity(itemId) {
  const m = itemId && itemId.match(/_FW_([A-Z]+)(?:_|$)/);
  return m ? (FW_CITY_SUFFIX_MAP[m[1]] || null) : null;
}
function getItemFaction(itemId) {
  if (!itemId || typeof itemId !== "string") return null;
  const fw = getFactionLockCity(itemId);
  if (fw) return fw;
  const heart = itemId.match(/^T1_FACTION_([A-Z]+)_TOKEN_/);
  if (heart) return FACTION_BIOME_TO_CITY[heart[1]] || null;
  const chest = itemId.match(/FACTIONCAMPAIGN_REWARD_([A-Z]+)_/);
  if (chest) return FACTION_BIOME_TO_CITY[chest[1]] || null;
  return null;
}

function getCityForce() { return null; }
function getOverridePrice() { return null; }
function getIQRBounds() { return { lower: 0, upper: Infinity }; }
function getSellPrice(itemData, city) { return (itemData && itemData[city] && itemData[city].sell_price) || 0; }
function getBuyPrice(itemData, city) { return (itemData && itemData[city] && itemData[city].sell_price) || 0; }
function findBestSellCity(marketData, itemId, cities) {
  let bestPrice = 0, bestCity = null;
  cities.forEach((c) => {
    const p = getSellPrice(marketData[itemId], c);
    const v = (marketData[itemId] && marketData[itemId][c] && marketData[itemId][c].volume_24h) || 0;
    if (p > 0 && v >= 0 && p > bestPrice) { bestPrice = p; bestCity = c; }
  });
  return { city: bestCity, price: bestPrice };
}
function getItemDisplayName(id) { return id; }
const ITEM_NAMES_MAP = {};
function renderTableData() {}

// Settable dropdown stub + minimal document so the filter + module IIFEs run.
const _select = { value: "", addEventListener() {} };
const document = {
  _flags: {},
  getElementById: (id) => id === "faction-spending-filter" ? (_select.value = _filterValue, _select) : null,
  addEventListener() {},
};
`;

const mod = new Module("faction-spending-favor-filter-test");
mod._compile(
  stubs + favRenderSrc + renderSrc + `
  module.exports = {
    buildFactionSpendingRows,
    setFilter: (v) => { _filterValue = v; },
  };`,
  "render-faction-spending.js"
);
const { buildFactionSpendingRows, setFilter } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// Minimal market: one Thetford heart (FP) + one Favor row per vendor group.
const market = {
  T1_FACTION_SWAMP_TOKEN_1: { Thetford: { sell_price: 40000, volume_24h: 50 } },
  T4_RUNE: { Caerleon: { sell_price: 300, volume_24h: 50 } },              // Energy Manipulator
  T8_CAPEITEM_SMUGGLER_BP: { Caerleon: { sell_price: 100000, volume_24h: 50 } }, // Smuggler's Den
  T8_CAPEITEM_DEMON_BP: { Caerleon: { sell_price: 90000, volume_24h: 50 } },     // The Antiquarian
  T8_CAPEITEM_FW_BRECILIEN_BP: { Caerleon: { sell_price: 120000, volume_24h: 50 } }, // Brecilien
};
const isFavor = (r) => r.currency === "Favor";
const isFp = (r) => r.currency === "FP";

console.log("Faction Spending — Favor vendor filter group tests\n");

test("All factions: both FP and Favor rows present", () => {
  setFilter("");
  const rows = buildFactionSpendingRows(market);
  assert.ok(rows.some(isFp), "expected FP rows");
  assert.ok(rows.some(isFavor), "expected Favor rows");
});

test("Thetford: FP Thetford rows only, NO Favor rows", () => {
  setFilter("Thetford");
  const rows = buildFactionSpendingRows(market);
  assert.ok(rows.length > 0, "expected some Thetford rows");
  assert.ok(!rows.some(isFavor), "Favor rows must be hidden under a faction filter");
  assert.ok(rows.every(isFp), "all surviving rows are FP rows");
  assert.ok(rows.some((r) => r.itemId === "T1_FACTION_SWAMP_TOKEN_1"), "Thetford heart present");
});

// Each Favor vendor is now its own filter group (no shared "Favor" group).
const vendorCases = [
  ["Energy Manipulator", "T4_RUNE",                    ["T8_CAPEITEM_SMUGGLER_BP", "T8_CAPEITEM_DEMON_BP", "T8_CAPEITEM_FW_BRECILIEN_BP"]],
  ["Smuggler's Den",     "T8_CAPEITEM_SMUGGLER_BP",    ["T4_RUNE", "T8_CAPEITEM_DEMON_BP", "T8_CAPEITEM_FW_BRECILIEN_BP"]],
  ["The Antiquarian",    "T8_CAPEITEM_DEMON_BP",       ["T4_RUNE", "T8_CAPEITEM_SMUGGLER_BP", "T8_CAPEITEM_FW_BRECILIEN_BP"]],
  ["Brecilien",          "T8_CAPEITEM_FW_BRECILIEN_BP",["T4_RUNE", "T8_CAPEITEM_SMUGGLER_BP", "T8_CAPEITEM_DEMON_BP"]],
];
vendorCases.forEach(([group, present, absent]) => {
  test(`${group}: only its own Favor rows, NO FP and NO other-vendor rows`, () => {
    setFilter(group);
    const rows = buildFactionSpendingRows(market);
    assert.ok(rows.length > 0, `expected ${group} rows`);
    assert.ok(!rows.some(isFp), "no FP rows under a Favor vendor filter");
    assert.ok(rows.every((r) => r.favorFaction === group), `all rows belong to ${group}`);
    assert.ok(rows.some((r) => r.itemId === present), `${present} present under ${group}`);
    absent.forEach((id) => assert.ok(!rows.some((r) => r.itemId === id), `${id} must NOT appear under ${group}`));
  });
});

test("old lumped \"Favor\" group no longer matches anything", () => {
  setFilter("Favor");
  const rows = buildFactionSpendingRows(market);
  assert.strictEqual(rows.length, 0, "the retired 'Favor' group should be empty");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
