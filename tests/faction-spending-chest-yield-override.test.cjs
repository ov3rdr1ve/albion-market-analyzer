/**
 * Test: fixed-yield chest rows (Iron Campaign Chests + Conqueror's Chest) read
 * their overrideable expected-silver yield from WHICHEVER city the user set it
 * at, and render a normal (non-locked) editable yield cell.
 *
 * Background — the bug this guards against:
 *   These chests are NOT tradeable; their "yield" is one city-independent
 *   number the user overrides by clicking the cell. The override lives in the
 *   city-keyed override map. The chest NPCs (Faction Enlistment NPC for Iron
 *   Chests, Energy Manipulator for the Conqueror's Chest) stand in every city,
 *   so the user must be able to set the yield from any city and read it back.
 *   Previously the read used a hardcoded city ("Thetford"), so any override set
 *   elsewhere was lost and the yield appeared to reset to its default.
 *   Fix: scan all cities and return the first override found. The chest's item
 *   id is unique, so the key never collides with another chest.
 *
 * Black-box contract:
 *   - buildFactionSpendRow({fixedYield}) returns sellPrice = the override set at
 *     ANY city when present, else the default fixedYield.
 *   - Works for a non-Thetford chest (the original headline failure).
 *   - The rendered non-tradeable cell is a normal sell-side editable cell (no
 *     single-city lock) so the dropdown still offers every city.
 *
 * Run: node tests/faction-spending-chest-yield-override.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

// Row text runs through tx(english, slug); en-mode identity keeps assertions in English.
globalThis.tx = globalThis.tx || ((en) => en);
const assert = require("assert");

const fpCostsSrc = fs.readFileSync(
  path.join(__dirname, "..", "js", "data-faction-fp-costs.js"),
  "utf8"
);
const renderSrc = fs.readFileSync(
  path.join(__dirname, "..", "js", "render-faction-spending.js"),
  "utf8"
);

// Per-test override map keyed "ID|City".
let _overrides = {};

const stubs = `
${fpCostsSrc}
let _renderedRows = [];
const tableState = { "mounts-table": { data: [] }, "faction-spending-table": { data: [] } };
function renderTableData(tbodyId, rows, formatter) {
  _renderedRows = rows.map((r, i) => formatter(r, i));
  tableState[tbodyId].data = rows;
}
function findBestSellCity(marketData, itemId, cities) {
  for (const c of cities) {
    const p = marketData?.[itemId]?.[c]?.sell_price || 0;
    if (p > 0) return { city: c, price: p };
  }
  return { city: null, price: 0 };
}
function netSilverAfterFees(gross) { return gross; }
function calculateSilverPerFp(silver, fp) { return fp > 0 ? silver / fp : 0; }
function getOverridePrice(itemId, city) {
  const k = itemId + "|" + city;
  return Object.prototype.hasOwnProperty.call(_overrides, k) ? _overrides[k] : null;
}
function getItemDisplayName(id) { return id; }
const ITEM_NAMES_MAP = {};
function formatSilver(n) { return String(Math.round(n)); }
// The "+" column cell (js/table-add-button.js) — every row template emits it.
// Row identity for the "+" column (js/sorting.js getRowKey).
function getRowKey(row, tableId){ return String(row && (row.itemId || row.id || "")); }
function addTdForKey(){ return '<td class="cell-add"></td>'; }
function priceTd(price, itemId, city) {
  return \`<td class="silver-val price-editable" data-item-id="\${itemId}" data-city="\${city}" data-raw-price="\${price}">\${price}</td>\`;
}
function volTd(v, itemId, city) {
  return \`<td class="vol-cell" data-item-id="\${itemId}" data-city="\${city}">\${v}</td>\`;
}
function matPriceSpan(matId, city, price) { return String(price); }
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
const DEFAULT_CHEST_AVG_YIELD = 73800;
const FACTION_CHESTS = [
  { id: "UNIQUE_LOOTCHEST_FACTIONCAMPAIGN_REWARD_FOREST_01", name: "Iron Campaign Chest: Lymhurst", city: "Lymhurst", biome: "forest" },
];
`;

const mod = new Module("render-faction-spending-chest-test");
mod._compile(
  stubs + renderSrc + `
    module.exports = {
      buildFactionSpendRow,
      renderFactionSpendingTable,
      setOverrides: (o) => { _overrides = o || {}; },
      get renderedRows() { return _renderedRows; },
    };`,
  "render-faction-spending.js"
);

const { buildFactionSpendRow, renderFactionSpendingTable, setOverrides } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const DEFAULT = 73800;
const FOREST = "UNIQUE_LOOTCHEST_FACTIONCAMPAIGN_REWARD_FOREST_01";
const ironChestOpts = (openCity) => ({
  tradeable: false,
  category: "Iron Chest",
  openCity,
  displayName: "Iron Campaign Chest",
  fixedYield: DEFAULT,
  note: "",
});

console.log("\n=== Fixed-yield chest yield override (read from any city) ===");

test("no override → sellPrice is the default fixed yield", () => {
  setOverrides({});
  const r = buildFactionSpendRow(FOREST, {}, ironChestOpts("Lymhurst"));
  assert.strictEqual(r.sellPrice, DEFAULT);
});

test("override set at the chest's own city (Lymhurst) is applied", () => {
  setOverrides({ [`${FOREST}|Lymhurst`]: 120000 });
  const r = buildFactionSpendRow(FOREST, {}, ironChestOpts("Lymhurst"));
  assert.strictEqual(r.sellPrice, 120000);
});

test("override set at a DIFFERENT city is still applied (NPC is in every city)", () => {
  // The headline fix: the user may set the yield wherever they play.
  setOverrides({ [`${FOREST}|Martlock`]: 250000 });
  const r = buildFactionSpendRow(FOREST, {}, ironChestOpts("Lymhurst"));
  assert.strictEqual(r.sellPrice, 250000);
});

test("override set in Caerleon is applied", () => {
  setOverrides({ [`${FOREST}|Caerleon`]: 88000 });
  const r = buildFactionSpendRow(FOREST, {}, ironChestOpts("Lymhurst"));
  assert.strictEqual(r.sellPrice, 88000);
});

test("rendered non-tradeable yield cell is a normal sell-side editable cell (no city lock)", () => {
  setOverrides({});
  renderFactionSpendingTable({});
  const html = mod.exports.renderedRows.join("");
  const m = html.match(new RegExp(`<td[^>]*data-item-id="${FOREST}"[^>]*>`));
  assert.ok(m, "Iron Chest yield cell rendered");
  const cell = m[0];
  assert.ok(/data-city-list="sell"/.test(cell), "sell-side editable cell");
  assert.ok(!/data-lock-city/.test(cell), "must NOT be locked to a single city");
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
