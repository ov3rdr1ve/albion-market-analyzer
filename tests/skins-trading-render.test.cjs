/**
 * Test: renderSkinsTradingTable produces a correct Hybrid (price-board + flip)
 * row set for tradeable vanity "unlock token" skins.
 *
 * Black-box: load the real calculations.js + data-skins.js + render-skins-trading.js
 * with stubbed DOM/pricing helpers and synthetic marketData, capture the rows the
 * renderer hands to renderTableData, and assert the selection logic + economics +
 * rendered cells. No DOM, no live API.
 *
 *   Vanity is illiquid, but the Pricing Model still applies: the buy leg is
 *   priced with getBuyPrice (the ask under Instant, your own buy order under
 *   Market Orders) and the sell leg with getSellPrice. The CHEAPEST buy-side
 *   city is the best buy, the DEAREST sell-side city the best sell — a pure
 *   spatial arbitrage — and the per-city board shows the sell side. Because
 *   vanity rarely carries buy orders, a leg whose field is missing is 0 (reads
 *   "not available" and is hand-priceable), never a fallback to the other
 *   field. calculateFlipMargin (real) prices the flip; single-city skins are
 *   "no flip" (em dash); no-data skins are hidden (margin -1) until "Show All".
 *
 * Run: node tests/skins-trading-render.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

// DOM / market helper stubs. calculateFlipMargin, formatSilver, getProfitClass,
// SETUP_FEE, PREMIUM_TAX come from the REAL calculations.js included below.
const stubs = `
function getOverridePrice(){ return null; }
// Pricing-model stubs shaped exactly like js/utils.js getBuyPrice/getSellPrice.
// The authoritative coverage of those two, against the real module, lives in
// tests/black-market-order-type.test.cjs.
let _mode = "market";
function getOrderType(){ return _mode; }
function __setMode(m){ _mode = m; }
function getBuyPrice(itemData, city, bounds, itemId){
  if (!itemData || !itemData[city]) return 0;
  return (_mode === "instant" ? itemData[city].sell_price : itemData[city].buy_price) || 0;
}
function getSellPrice(itemData, city, bounds, itemId){
  if (!itemData || !itemData[city]) return 0;
  return (_mode === "instant" ? itemData[city].buy_price : itemData[city].sell_price) || 0;
}
function getOverrideVolume(){ return null; }
function priceTd(price, itemId, city){
  const disp = price > 0 ? String(Math.round(price)) : "—";
  return "<td data-item-id='"+itemId+"' data-city='"+(city||"")+"'>"+disp+"</td>";
}
function volTd(v, itemId, city){ return "<td class='vol'>"+(v||0)+"</td>"; }
function profitTd(mi, tableId, rowIdx, sellCity){ return "<td class='profit'>"+mi.margin.toFixed(2)+"%</td>"; }
function pureProfitTd(mi){ const p = mi && mi.profit; return (p===undefined||p===null) ? "<td>—</td>" : "<td>"+Math.round(p)+"</td>"; }
// The "+" column cell (js/table-add-button.js) — every row template emits it.
function addTdForKey(){ return '<td class="cell-add"></td>'; }
function getRowKey(row){ return row.item ? row.item.id : ""; }
const captured = { rows: [], html: [] };
function renderTableData(id, rows, fmt){
  captured.tableId = id;
  captured.rows = rows;
  captured.html = rows.map((r,i) => { try { return fmt(r,i); } catch(e){ return "ERR:"+e.message; } });
}
`;

const sources = J("data-city-bonuses.js") + (J("calculations.js") + J("calculations-margins.js")) + J("data-skins.js") + J("render-skins-trading.js");

globalThis.tx = globalThis.tx || ((en) => en);
globalThis.dispName = globalThis.dispName || ((id, fallback) => fallback);
const mod = new Module("skins-render");
mod._compile(
  stubs + sources +
    "\nmodule.exports = { renderSkinsTradingTable, buildSkinRow, captured, SKIN_TRADE_ITEMS, SKIN_TRADE_CITIES, getSkinsItemIds, calculateFlipMargin, __setMode };",
  "skins-render.js",
);
const {
  renderSkinsTradingTable, captured, SKIN_TRADE_ITEMS, SKIN_TRADE_CITIES,
  getSkinsItemIds, calculateFlipMargin, __setMode,
} = mod.exports;

// Synthetic market (REAL field names: buy_price / sell_price / volume_24h).
//   Skeleton Cape  → two cities, cheap Fort Sterling vs dear Caerleon (a flip)
//   Hygienic Coat  → ONE city only (Fort Sterling) → no flip
//   Chromacannon   → three cities, dearest is Caerleon
//   Wedding Dress  → LISTINGS ONLY, no buy orders (the typical vanity book)
//   everything else → no data
const marketData = {
  UNIQUE_UNLOCK_CAPE_VANITY_SKELETON: {
    Caerleon: { buy_price: 5000000, sell_price: 8000000, volume_24h: 2 },
    "Fort Sterling": { buy_price: 1500000, sell_price: 2000000, volume_24h: 1 },
  },
  UNIQUE_UNLOCK_ARMOR_VANITY_PLAGUEDOC: {
    "Fort Sterling": { buy_price: 20000000, sell_price: 24000000, volume_24h: 1 },
  },
  UNIQUE_UNLOCK_VANITY_2H_GUN_ANNIVERSARY: {
    Caerleon: { buy_price: 11000000, sell_price: 14000000, volume_24h: 1 },
    "Fort Sterling": { buy_price: 9000000, sell_price: 12000000, volume_24h: 1 },
    Bridgewatch: { buy_price: 10000000, sell_price: 13000000, volume_24h: 0 },
  },
  UNIQUE_UNLOCK_ARMOR_VANITY_WEDDING_DRESS: {
    Caerleon: { buy_price: 0, sell_price: 9000000, volume_24h: 1 },
    Martlock: { buy_price: 0, sell_price: 7000000, volume_24h: 1 },
  },
};

__setMode("market");
renderSkinsTradingTable(marketData);
const html = captured.html.join("\n");
const rowOf = (id) => captured.rows.find((r) => r.item && r.item.id === id);
const cellOf = (id) => captured.html[captured.rows.indexOf(rowOf(id))];

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name}\n    ${e.message}`); }
}

console.log("Skins trading render rows\n");

test("renders into #skins-trading-table with one row per catalogued skin", () => {
  assert.strictEqual(captured.tableId, "skins-trading-table");
  // Row count tracks the catalog, which grows with every dump refresh — assert
  // the relationship, not a frozen number.
  assert.strictEqual(captured.rows.length, SKIN_TRADE_ITEMS.length);
  assert.ok(captured.rows.length > 60, `only ${captured.rows.length} skins catalogued`);
});

test("the per-row formatter never throws", () =>
  assert.ok(!html.includes("ERR:"), html));

test("catalog uses only real UNIQUE_UNLOCK..VANITY ids and getSkinsItemIds mirrors it", () => {
  SKIN_TRADE_ITEMS.forEach((i) => {
    assert.ok(/^UNIQUE_UNLOCK_[A-Z0-9_]*VANITY/.test(i.id), `fake id? ${i.id}`);
    assert.ok(i.name && i.slot, `missing name/slot for ${i.id}`);
  });
  assert.deepStrictEqual(getSkinsItemIds(), SKIN_TRADE_ITEMS.map((i) => i.id));
});

console.log("\n— selection logic (cheapest = buy, dearest = sell) —");

test("two-city skin: buys the CHEAPEST city, sells the DEAREST, positive margin", () => {
  const r = rowOf("UNIQUE_UNLOCK_CAPE_VANITY_SKELETON");
  assert.ok(r, "Skeleton Cape row missing");
  assert.strictEqual(r.buy.city, "Fort Sterling");
  assert.strictEqual(r.buy.price, 1500000, "market orders buy at the bid");
  assert.strictEqual(r.sell.city, "Caerleon");
  assert.strictEqual(r.sell.price, 8000000, "market orders sell at your own listing");
  assert.strictEqual(r.hasData, true);
  // margin/profit must equal the real flip calc for (buy 1.5M -> sell 8M)
  const expect = calculateFlipMargin(1500000, 8000000, 0);
  assert.ok(Math.abs(r.marginInfo.profit - expect.profit) < 1e-6, `profit ${r.marginInfo.profit}`);
  assert.ok(r.marginInfo.margin > 0, `margin ${r.marginInfo.margin}`);
});

test("three-city skin: dearest among all priced cities wins as best sell", () => {
  const r = rowOf("UNIQUE_UNLOCK_VANITY_2H_GUN_ANNIVERSARY");
  assert.strictEqual(r.buy.city, "Fort Sterling"); // 9M cheapest bid
  assert.strictEqual(r.sell.city, "Caerleon");      // 14M dearest ask
  assert.strictEqual(r.sell.price, 14000000);
});

test("single-city skin: no flip (buy city == sell city), margin sentinel 0, still hasData", () => {
  const r = rowOf("UNIQUE_UNLOCK_ARMOR_VANITY_PLAGUEDOC");
  assert.ok(r, "Hygienic Coat row missing");
  assert.strictEqual(r.buy.city, "Fort Sterling");
  assert.strictEqual(r.sell.city, "Fort Sterling");
  assert.strictEqual(r.buy.price, 20000000);
  assert.strictEqual(r.hasData, true);
  assert.strictEqual(r.marginInfo.margin, 0, "single-city = no flip sentinel 0");
  // profit cell shows an em dash, not "0"
  assert.ok(cellOf("UNIQUE_UNLOCK_ARMOR_VANITY_PLAGUEDOC").includes("—"), "no-flip profit should be em dash");
});

test("no-data skin: hasData false, margin sentinel -1 (hidden until Show All), still in row set", () => {
  const r = rowOf("UNIQUE_UNLOCK_HEAD_VANITY_JESTER");
  assert.ok(r, "no-data row should still be built");
  assert.strictEqual(r.hasData, false);
  assert.strictEqual(r.marginInfo.margin, -1);
  assert.strictEqual(r.buy.city, null);
  assert.strictEqual(r.sell.city, null);
});

console.log("\n— the Pricing Model applies to both legs —");

test("listings-only skin has NO buy leg under Market Orders — no flip, price stays 0", () => {
  const r = rowOf("UNIQUE_UNLOCK_ARMOR_VANITY_WEDDING_DRESS");
  assert.ok(r, "Wedding Dress row missing");
  assert.strictEqual(r.buy.city, null, "no buy order to place against");
  assert.strictEqual(r.buy.price, 0, "0 renders as not-available and is hand-priceable");
  assert.strictEqual(r.sell.city, "Caerleon", "the dearest listing is still the best sell");
  assert.strictEqual(r.sell.price, 9000000);
  assert.strictEqual(r.canFlip, false);
});

// ── Instant: the two legs swap fields ───────────────────────────────────────
__setMode("instant");
renderSkinsTradingTable(marketData);
const instantRow = (id) => captured.rows.find((r) => r.item && r.item.id === id);

test("Instant buys at the ask and sells into the bid", () => {
  const r = instantRow("UNIQUE_UNLOCK_CAPE_VANITY_SKELETON");
  assert.strictEqual(r.buy.city, "Fort Sterling");
  assert.strictEqual(r.buy.price, 2000000, "instant buy = the listing you fill");
  assert.strictEqual(r.sell.city, "Caerleon");
  assert.strictEqual(r.sell.price, 5000000, "instant sell = the bid you fill");
});

test("Instant: a listings-only skin loses its SELL leg instead", () => {
  const r = instantRow("UNIQUE_UNLOCK_ARMOR_VANITY_WEDDING_DRESS");
  assert.strictEqual(r.buy.city, "Martlock", "cheapest listing to fill");
  assert.strictEqual(r.buy.price, 7000000);
  assert.strictEqual(r.sell.price, 0, "no buy order to sell into");
  assert.strictEqual(r.hasData, false);
});

// Back to the Market Orders render for the board assertions below.
__setMode("market");
renderSkinsTradingTable(marketData);

console.log("\n— hybrid board: per-city columns + slot —");

test("renders one price cell per trading city (full board), plus slot", () => {
  const cell = cellOf("UNIQUE_UNLOCK_CAPE_VANITY_SKELETON");
  SKIN_TRADE_CITIES.forEach((c) => {
    assert.ok(cell.includes(`data-city='${c}'`), `missing board column for ${c}`);
  });
  assert.ok(cell.includes("Cape"), "slot label missing");
  // the two priced cities show their numbers in the board
  assert.ok(cell.includes("8000000") && cell.includes("2000000"), "board prices missing");
});

test("no-data board cells render an em dash, not a zero", () => {
  const cell = cellOf("UNIQUE_UNLOCK_HEAD_VANITY_JESTER");
  assert.ok(cell.includes("—"), "empty city cells should be em dashes");
  // Scope to PRICE board cells (data-city) — the volume cell legitimately shows 0.
  assert.ok(!/data-city='[^']*'>0<\/td>/.test(cell), "no-data price cells must be em dashes, not 0");
});

test("Brecilien is part of the trading-city board", () =>
  assert.ok(SKIN_TRADE_CITIES.includes("Brecilien")));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
