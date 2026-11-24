/**
 * Test: the Crafting table's "Profit + Laborer Journal" column.
 *
 * The column answers "what is this craft worth if I keep the journals my
 * crafting fame fills and work them with my own laborer, instead of buying
 * empty journals to sell full ones?" — Pure Profit + the laborer's payout per
 * journal, spread over the fame one craft awards.
 *
 * UI-first (TLD): renders the REAL renderCraftingTable through a captured
 * renderTableData and asserts the emitted cells.
 *
 * Run: node tests/crafting-laborer-journal-column.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const sandbox = `
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = CITIES;
const SETUP_FEE = 0.025;
const PREMIUM_TAX = 0.065;
const BASE_CITY_BONUS = 0.18;
const CRAFT_SPEC_BONUS = 0.15;
const FOCUS_BONUS = 0.59;
const CITY_CRAFT_SPEC = {};

// Two priced crafts (plate → WARRIOR journal, food → no journal) and one
// unpriced craft that must fall back to the no-data placeholder row.
const CRAFTING_ITEMS = [
  { id:"T8_ARMOR_PLATE_SET1", name:"Soldier Armor", matId:"T8_METALBAR", matCount:16, craftType:"plate_armor",
    materials:[{ matId:"T8_METALBAR", count:16 }] },
  { id:"T8_MEAL_STEW", name:"Beef Stew", matId:"T8_MEAT", matCount:4, craftType:"food",
    materials:[{ matId:"T8_MEAT", count:4 }] },
  { id:"T8_2H_HAMMER", name:"Great Hammer", matId:"T8_METALBAR", matCount:20, craftType:"hammer",
    materials:[{ matId:"T8_METALBAR", count:20 }] },
];

let expandedCraftItems = new Set();
let recipeCache = {};
function isBlackRedZoneEnabled() { return true; }
function isValidSourceCity() { return true; }
function isInvalidCrossRoute() { return false; }
function isFocusEnabled() { return false; }
function getOverridePrice() { return null; }
function getOverrideVolume() { return null; }
function getCityForce() { return null; }
function getIQRBounds() { return { upper: Infinity }; }
function getBuyPrice(itemData, city) { return (itemData && itemData[city] && itemData[city].buy_price) || 0; }
function getSellPrice(itemData, city) { return (itemData && itemData[city] && itemData[city].sell_price) || 0; }
function calcRRR(b) { return b <= 0 ? 0 : b / (1 + b); }
function getCraftRRR(city, ct, f) { let b = BASE_CITY_BONUS; if (f) b += FOCUS_BONUS; return calcRRR(b); }
function getFocusCost() { return 500; }
function getCraftFocusCost() { return 500; }
function calcStationFeeSilver() { return 0; }
function getTierFromId(id) { const m = id && id.match(/^T(\\d+)/); return m ? parseInt(m[1],10) : 4; }
function calculateProfitPerFocus(profit, focusCost) { return focusCost > 0 ? profit / focusCost : 0; }
function marginalSilverPerFocus(matCost, baseRrr, focusRrr, focusCost) { return focusCost > 0 ? (matCost * (focusRrr - baseRrr) * (1 + SETUP_FEE)) / focusCost : 0; }
function calculateProfitPer10kFocus(profit, focusCost) { return focusCost > 0 ? profit * Math.floor(10000/focusCost) : 0; }
function matsNeededFor10kFocus(focusCost, per, applyRrr, rrr) { const c = Math.floor(10000/focusCost); return Math.round(c * (applyRrr ? per * (1-(rrr||0)) : per)); }
function getCityVol() { return 100; }
function formatSilver(n) { if (n == null) return "N/A"; return Math.round(n).toLocaleString(); }
function formatFocusCost(n) { if (n == null || !Number.isFinite(n)) return "N/A"; const a = Math.abs(n); if (a >= 100) return Math.round(n).toLocaleString(); return String(Number(n.toFixed(a >= 10 ? 1 : 2))); }
function getItemDisplayName(id) { return id; }
function dispName(id, name) { return name; }
function getCraftStation() { return ""; }
// The "+" column cell (js/table-add-button.js) — every row template emits it.
function addTdForKey(){ return '<td class="cell-add"></td>'; }
function getRowKey(row) { return (row.item && row.item.id || "") + "|" + (row.craftCity || ""); }
function matPriceSpan(id, city, price) { return "<span class='mat'>@ " + (price > 0 ? price : "no data") + " ea</span>"; }
// Read-only aggregate cost cell (js/app.js aggregateCostTd) — the Input Cost
// column is a sum, so it is not a click-to-override price cell.
function aggregateCostTd(c, cls) { return '<td class="' + (cls || "silver-val cell-num") + '">' + (Number(c) > 0 ? c : "—") + '</td>'; }
function priceTd(p, itemId, city, side) { return '<td class="silver-val">' + (p > 0 ? p : "no data") + '</td>'; }
function profitTd(mi) { return '<td class="pct">' + (mi.margin || 0).toFixed(1) + '</td>'; }
function pureProfitTd(mi) { return '<td class="silver-val pure">' + Math.round(mi.profit || 0) + '</td>'; }
function brecilienFeeBadge() { return ""; }
const captured = {};
function renderTableData(id, rows, fmt) {
  captured.tableId = id;
  captured.rows = rows;
  captured.html = rows.map((r, i) => { try { return fmt(r, i); } catch (e) { return "ERR:" + e.message; } });
}
`;

function loadFile(rel) { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); }
globalThis.tx = globalThis.tx || ((en) => en);

const mod = new Module("crafting-laborer-journal-column-test");
mod._compile(
  sandbox +
    loadFile("js/route-cell.js") +
    loadFile("js/data-laborers.js") +
    loadFile("js/data-craft-journal-fame.js") +
    loadFile("js/data-craft-planner.js") +
    loadFile("js/laborers-pricing.js") +
    loadFile("js/render-laborers.js") +
    loadFile("js/laborer-journal-value.js") +
    loadFile("js/focus-play.js") +
    loadFile("js/render-crafting.js") +
    loadFile("js/render-crafting-no-data-row.js") +
    "\nmodule.exports = { renderCraftingTable, captured, getLaborerJournalFill };",
  "render-crafting.js",
);
const { renderCraftingTable, captured } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const FS = "Fort Sterling";
function priceMap(entries) {
  const out = {};
  for (const e of entries) {
    if (!out[e.id]) out[e.id] = {};
    out[e.id][e.city] = { buy_price: e.buy || 0, sell_price: e.sell || 0, volume_24h: 9999 };
  }
  return out;
}

// Priced: the plate craft + the stew, plus the refined mix a Blacksmith returns.
const MARKET = priceMap([
  { id: "T8_METALBAR", city: FS, buy: 2000, sell: 2100 },
  { id: "T8_PLANKS", city: FS, buy: 900, sell: 950 },
  { id: "T8_CLOTH", city: FS, buy: 1100, sell: 1150 },
  { id: "T8_ARMOR_PLATE_SET1", city: FS, sell: 90000, buy: 88000 },
  { id: "T8_MEAT", city: FS, buy: 300, sell: 320 },
  { id: "T8_MEAL_STEW", city: FS, sell: 4000, buy: 3900 },
]);

function render(md) {
  renderCraftingTable(md);
  return captured;
}
function rowFor(id) {
  return captured.rows.find((r) => r.item && r.item.id === id && r.marginInfo.margin !== -1);
}
function htmlFor(id) {
  const i = captured.rows.findIndex((r) => r.item && r.item.id === id && r.marginInfo.margin !== -1);
  return i >= 0 ? captured.html[i] : "";
}
const tdCount = (html) => (html.match(/<td\b/g) || []).length;

console.log("\n=== Crafting table: Profit + Laborer Journal ===");

test("a plate craft carries the laborer-journal figure on its row", () => {
  render(MARKET);
  const row = rowFor("T8_ARMOR_PLATE_SET1");
  assert.ok(row, "plate row rendered");
  assert.ok(row.laborerJournal, "laborerJournal attached");
  assert.strictEqual(row.laborerJournal.slug, "WARRIOR");
  assert.ok(row.laborerJournal.extraSilverPerCraft > 0, "laborer value should be positive");
});

test("the column value = Pure Profit + the laborer's per-craft value", () => {
  render(MARKET);
  const row = rowFor("T8_ARMOR_PLATE_SET1");
  const expected = row.marginInfo.profit + row.laborerJournal.extraSilverPerCraft;
  assert.ok(Math.abs(row.profitWithLaborer - expected) < 1e-6);
});

test("the cell renders the total, the added value and the laborer + journal tier", () => {
  render(MARKET);
  const html = htmlFor("T8_ARMOR_PLATE_SET1");
  const row = rowFor("T8_ARMOR_PLATE_SET1");
  assert.ok(html.includes(Math.round(row.profitWithLaborer).toLocaleString()), "total missing");
  assert.ok(/\+[\d,]+ · Blacksmith T\d/.test(html), `laborer label missing: ${html}`);
});

test("the laborer cell sits directly after the Pure Profit cell", () => {
  render(MARKET);
  const html = htmlFor("T8_ARMOR_PLATE_SET1");
  const pure = html.indexOf('class="silver-val pure"');
  const lab = html.indexOf("Blacksmith T");
  const p10k = html.indexOf("crafts @");
  assert.ok(pure >= 0 && lab > pure, "laborer cell must follow Pure Profit");
  assert.ok(p10k < 0 || lab < p10k, "laborer cell must precede the 10k-focus cell");
});

test("a craft that fills no crafting journal shows an em dash", () => {
  render(MARKET);
  const row = rowFor("T8_MEAL_STEW");
  assert.ok(row, "stew row rendered");
  assert.strictEqual(row.laborerJournal, null);
  assert.strictEqual(row.profitWithLaborer, row.marginInfo.profit);
});

test("no-data placeholder rows keep the same cell count as data rows", () => {
  render(MARKET);
  const dataHtml = htmlFor("T8_ARMOR_PLATE_SET1");
  const i = captured.rows.findIndex((r) => r.marginInfo.margin === -1);
  assert.ok(i >= 0, "a no-data row should exist (T8_2H_HAMMER is unpriced)");
  assert.strictEqual(tdCount(captured.html[i]), tdCount(dataHtml));
});

test("unpriced refined output → dash, and the column falls back to Pure Profit", () => {
  // Only the plate item + its bar are priced; the Blacksmith's returned mix has
  // no sell price at all, so there is nothing to value the journal at.
  const md = priceMap([
    { id: "T8_METALBAR", city: FS, buy: 2000 },
    { id: "T8_ARMOR_PLATE_SET1", city: FS, sell: 90000 },
  ]);
  render(md);
  const row = rowFor("T8_ARMOR_PLATE_SET1");
  assert.strictEqual(row.laborerJournal.bestJournal, null);
  assert.strictEqual(row.profitWithLaborer, row.marginInfo.profit);
  assert.ok(htmlFor("T8_ARMOR_PLATE_SET1").includes("—"), "cell should render a dash");
});

test("journal market prices never move the column (the empty comes back)", () => {
  render(MARKET);
  const before = rowFor("T8_ARMOR_PLATE_SET1").profitWithLaborer;
  const md = priceMap([
    { id: "T8_METALBAR", city: FS, buy: 2000, sell: 2100 },
    { id: "T8_PLANKS", city: FS, buy: 900, sell: 950 },
    { id: "T8_CLOTH", city: FS, buy: 1100, sell: 1150 },
    { id: "T8_ARMOR_PLATE_SET1", city: FS, sell: 90000, buy: 88000 },
    { id: "T8_MEAT", city: FS, buy: 300, sell: 320 },
    { id: "T8_MEAL_STEW", city: FS, sell: 4000, buy: 3900 },
    { id: "T8_JOURNAL_WARRIOR_EMPTY", city: FS, buy: 250000, sell: 250000 },
    { id: "T8_JOURNAL_WARRIOR_FULL", city: FS, buy: 1, sell: 1 },
  ]);
  render(md);
  assert.strictEqual(rowFor("T8_ARMOR_PLATE_SET1").profitWithLaborer, before);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
