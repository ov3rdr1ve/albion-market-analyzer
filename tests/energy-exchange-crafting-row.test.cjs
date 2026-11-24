/**
 * Test: an Energy Manipulator exchange renders as a Crafting-table row.
 *
 * The exchange is 50 fragments for the artifact you pick, at an NPC — so the
 * priced row must show, all at once:
 *   • no return rate: all 50 fragments are consumed, even with a city bonus and
 *     focus available (`noReturn: true`);
 *   • no station usage fee, even with a station-fee setting typed in
 *     (`nutritionPerCraft: 0`) — 50 fragments would otherwise bill a fortune,
 *     because a fragment is not an "ARTEFACT" id and so counts as an ordinary
 *     material in calcStationFeeSilver;
 *   • no recipe silver.
 *
 * UI-first (TLD): renders the REAL renderCraftingTable through a captured
 * renderTableData, with the REAL calcStationFeeSilver formula, and asserts the
 * emitted row. No live API or DB.
 *
 * Run: node tests/energy-exchange-crafting-row.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

function loadFile(rel) { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); }

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name + " — " + e.message); failed++; }
}

const ITEM = "T8_ARTEFACT_ARMOR_LEATHER_DRAGON";
const FRAGMENT = "T8_SHARD_FIRE_DRAGON";
const FRAG_PRICE = 4000;
const SELL_PRICE = 900000;
const SETUP_FEE = 0.025;
const PREMIUM_TAX = 0.065;
// The station-fee box is deliberately NOT zero: a row that pays a fee would
// show it, and 50 T8 materials is a very visible amount of silver.
const STATION_FEE_INPUT = 400;

const sandbox = `
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = CITIES;
const SETUP_FEE = ${SETUP_FEE};
const PREMIUM_TAX = ${PREMIUM_TAX};
const BASE_CITY_BONUS = 0.18;
const CRAFT_SPEC_BONUS = 0.15;
const FOCUS_BONUS = 0.59;
const CITY_CRAFT_SPEC = {};

let expandedCraftItems = new Set();
let recipeCache = {};
function isBlackRedZoneEnabled() { return true; }
function isValidSourceCity() { return true; }
function isInvalidCrossRoute() { return false; }
// Focus ON and a city bonus available — a returnable row would visibly refund.
function isFocusEnabled() { return true; }
function getOverridePrice() { return null; }
function getOverrideVolume() { return null; }
function getCityForce() { return null; }
function getIQRBounds() { return { upper: Infinity }; }
function getBuyPrice(itemData, city) { return (itemData && itemData[city] && itemData[city].buy_price) || 0; }
function getSellPrice(itemData, city) { return (itemData && itemData[city] && itemData[city].sell_price) || 0; }
function calcRRR(b) { return b <= 0 ? 0 : b / (1 + b); }
function getCraftRRR(city, ct, f) { let b = BASE_CITY_BONUS; if (f) b += FOCUS_BONUS; return calcRRR(b); }
function getFocusCost() { return 0; }
function getCraftFocusCost() { return 0; }
// The REAL formula (js/utils.js), with the station-fee box set to ${STATION_FEE_INPUT}.
function calcStationFeeSilver(tier, nonArtifactMats, nutritionOverride = null) {
  const ivPerMat = 14 * Math.pow(2, tier - 4);
  const itemValue = nonArtifactMats * ivPerMat;
  const nutrition = nutritionOverride != null ? nutritionOverride : itemValue * 0.1125;
  return (${STATION_FEE_INPUT} / 100) * nutrition;
}
function getTierFromId(id) { const m = id && id.match(/^T(\\d+)/); return m ? parseInt(m[1],10) : 4; }
function calculateProfitPerFocus(profit, focusCost) { return focusCost > 0 ? profit / focusCost : 0; }
function marginalSilverPerFocus() { return 0; }
function calculateProfitPer10kFocus(profit, focusCost) { return focusCost > 0 ? profit * Math.floor(10000/focusCost) : 0; }
function matsNeededFor10kFocus() { return 0; }
function getCityVol() { return 100; }
function formatSilver(n) { if (n == null) return "N/A"; return Math.round(n).toLocaleString(); }
function formatFocusCost(n) { return String(n); }
function getItemDisplayName(id) { return id; }
function dispName(id, name) { return name; }
function addTdForKey(){ return '<td class="cell-add"></td>'; }
function getRowKey(row) { return (row.item && row.item.id || "") + "|" + (row.craftCity || ""); }
function matPriceSpan(id, city, price) { return "<span class='mat' data-item-id='" + id + "'>@ " + (price > 0 ? price : "no data") + " ea</span>"; }
function aggregateCostTd(c, cls) { return '<td class="' + (cls || "silver-val cell-num") + '">' + (Number(c) > 0 ? c : "—") + '</td>'; }
function priceTd(p) { return '<td class="silver-val">' + (p > 0 ? p : "no data") + '</td>'; }
function profitTd(mi) { return '<td class="pct">' + (mi.margin || 0).toFixed(1) + '</td>'; }
function pureProfitTd(mi) { return '<td class="silver-val pure">' + Math.round(mi.profit || 0) + '</td>'; }
function brecilienFeeBadge() { return ""; }
function getLaborerJournalFill() { return null; }
const captured = {};
function renderTableData(id, rows, fmt) {
  captured.tableId = id;
  captured.rows = rows;
  captured.html = rows.map((r, i) => { try { return fmt(r, i); } catch (e) { return "ERR:" + e.message; } });
}
`;

globalThis.tx = globalThis.tx || ((en) => en);

const mod = new Module("energy-exchange-crafting-row-test");
mod._compile(
  sandbox +
    loadFile("js/data-artifacts.js") +
    loadFile("js/data-energy-exchange.js") +
    // The exchange catalog IS the crafting catalog for this render, exactly as
    // js/app.js injects it into CRAFTING_ITEMS.
    "\nconst CRAFTING_ITEMS = injectEnergyExchange([]);\n" +
    loadFile("js/gear-token-substitute.js") +
    loadFile("js/route-cell.js") +
    loadFile("js/focus-play.js") +
    loadFile("js/render-crafting.js") +
    "\nmodule.exports = { renderCraftingTable, captured, CRAFTING_ITEMS, getCraftStation: typeof getCraftStation === 'function' ? getCraftStation : null };",
  "energy-exchange-crafting-row.js",
);
const { renderCraftingTable, captured, CRAFTING_ITEMS } = mod.exports;

const FS = "Fort Sterling";
const marketData = {
  [FRAGMENT]: { [FS]: { buy_price: FRAG_PRICE, sell_price: FRAG_PRICE + 50, volume_24h: 9999 } },
  [ITEM]: { [FS]: { buy_price: SELL_PRICE - 1000, sell_price: SELL_PRICE, volume_24h: 9999 } },
};

renderCraftingTable(marketData);
const row = (captured.rows || []).find((r) => r.item && r.item.id === ITEM && r.marginInfo.margin !== -1);

// 50 fragments, none refunded, plus the 2.5% buy-order setup fee. Nothing else.
const EXPECTED_COST = 50 * FRAG_PRICE * (1 + SETUP_FEE);

console.log("\n=== The exchange reaches the Crafting table ===");
test("the injected catalog is what the renderer walked", () => {
  assert.ok(CRAFTING_ITEMS.some((i) => i.id === ITEM), ITEM + " is not in the catalog");
  assert.ok(row, ITEM + " produced no priced row");
});
test("the row consumes 50 fragments of its own tier", () => {
  assert.deepStrictEqual(row.item.materials, [{ matId: FRAGMENT, count: 50 }]);
});

console.log("\n=== 50 fragments in, no refund, no fee ===");
test("input cost is exactly 50 fragments + the 2.5% setup fee", () => {
  assert.ok(
    Math.abs(row.totalInputCost - EXPECTED_COST) < 0.01,
    `inputCost ${row.totalInputCost} != ${EXPECTED_COST}`
  );
});
test("no return rate — focus and a city bonus refund nothing", () => {
  // With a return rate the cost would fall by ~43% (0.77/1.77) at focus-on.
  assert.ok(row.totalInputCost > 50 * FRAG_PRICE, "fragments were partly refunded");
});
test("no station usage fee, even with the fee box at " + STATION_FEE_INPUT, () => {
  // 50 T8 materials at the default fee would add ~50 × 112 × 0.1125 × 4 silver.
  const withFee = EXPECTED_COST + (STATION_FEE_INPUT / 100) * 50 * 14 * 16 * 0.1125;
  assert.ok(row.totalInputCost < withFee - 1, "a station fee was billed");
});

console.log("\n=== Profit is the plain buy-then-sell difference ===");
test("profit = net sale − exchange cost", () => {
  const expected = SELL_PRICE * (1 - PREMIUM_TAX) - EXPECTED_COST;
  assert.ok(
    Math.abs(row.marginInfo.profit - expected) < 1,
    `profit ${row.marginInfo.profit} != ${expected}`
  );
});
test("a fragment with no price leaves no phantom row", () => {
  renderCraftingTable({ [ITEM]: marketData[ITEM] });
  const orphan = (captured.rows || []).find(
    (r) => r.item && r.item.id === ITEM && r.marginInfo.margin !== -1
  );
  assert.strictEqual(orphan, undefined, "priced a row whose fragment has no market");
});

console.log("\n" + "=".repeat(50));
console.log("Total: " + (passed + failed) + " | Passed: " + passed + " | Failed: " + failed);
if (failed > 0) process.exit(1);
