/**
 * Test: the Volume table's City pick RE-PRICES its rows instead of filtering
 * them (js/table-sell-city.js owns the rule; js/render-volume.js applies it).
 *
 * Bug it pins: a volume row names ONE market, the argmax of volume_24h over
 * SELL_CITIES. The City picker used to match that single city, so "Black
 * Market" meant "items whose BUSIEST market is the Black Market", not "items
 * traded at the Black Market". Reported case, from a real scan:
 *
 *   T4_CAPEITEM_FW_LYMHURST  Black Market 1195, Lymhurst 3199   -> hidden
 *   T5_CAPEITEM_FW_LYMHURST  Black Market  453, Brecilien  674  -> hidden
 *   T6_CAPEITEM_FW_LYMHURST  Black Market 3423, Lymhurst   915  -> shown
 *
 * so the T4 and plain-T5 capes looked like missing data while their siblings
 * listed. Under a pick each row is now built AT that city: its volume in the
 * Top City Volume column, its price in the price cell, its name in Top City.
 * Total Volume (All Cities) keeps summing every market.
 *
 * Black-box: drive the real renderVolumeTable with stubbed globals and read the
 * rows/HTML it hands renderTableData. No DOM, no network, no live prices.
 *
 * Run: node tests/volume-city-pick-reprices.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

// The real pick store — it publishes getTableSellCity/setTableSellCity as
// globals for Node, which is exactly how the browser reaches them.
const {
  setTableSellCity,
  clearTableSellCities,
  sellCityOptionsFor,
} = require("../js/table-sell-city.js");

const renderSrc = fs.readFileSync(
  path.join(__dirname, "..", "js", "render-volume.js"),
  "utf8",
);

// SELL_CITIES is a top-level const in js/data.js, which does NOT land on
// globalThis; the render module reads it from its own scope, so declare it here.
globalThis.SELL_CITIES = [
  "Caerleon", "Bridgewatch", "Fort Sterling", "Lymhurst", "Martlock",
  "Thetford", "Brecilien", "Smuggler's Den", "Black Market",
];

const stubs = `
const SELL_CITIES = globalThis.SELL_CITIES;

const priceOverrides = {};
const cityForces = {};

function getOverridePrice(itemId, city) {
  return priceOverrides[itemId]?.[city] ?? null;
}
function getCityForce(itemId, side) {
  return cityForces[itemId]?.[side] ?? null;
}
function setOverridePrice(itemId, city, price) {
  if (!priceOverrides[itemId]) priceOverrides[itemId] = {};
  priceOverrides[itemId][city] = price;
}
function setCityForce(itemId, side, city) {
  if (!cityForces[itemId]) cityForces[itemId] = {};
  cityForces[itemId][side] = city;
}
function clearOverrides() {
  for (const k of Object.keys(priceOverrides)) delete priceOverrides[k];
  for (const k of Object.keys(cityForces)) delete cityForces[k];
}

function getIQRBounds() { return { lower: 0, upper: Infinity }; }
function getSellPrice(itemData, city, bounds, itemId) {
  const ov = itemId ? getOverridePrice(itemId, city) : null;
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].sell_price || 0;
}
function getItemDisplayName(id) { return id; }
function getTierFromId(id) {
  const m = id.match(/^T(\\d)/);
  return m ? parseInt(m[1]) : 0;
}
function getItemCategory(id) { return "Gear"; }
function getRowKey(row, tableId) { return row.itemId + ":" + tableId; }

let _captured = null;
function renderTableData(tableId, rows, formatter) {
  _captured = { tableId, rows: rows.slice(), html: rows.map((r, i) => formatter(r, i)) };
}

function priceTd(price, itemId, city) {
  return '<td data-item-id="' + itemId + '" data-city="' + city + '" data-raw-price="' + price + '">' + price + '</td>';
}
`;

const mod = new Module("render-volume-city-pick-test");
mod._compile(
  stubs +
    renderSrc +
    `
    module.exports = {
      renderVolumeTable,
      get captured() { return _captured; },
      setOverridePrice,
      setCityForce,
      clearOverrides,
    };`,
  "render-volume.js",
);

const { renderVolumeTable, setOverridePrice, setCityForce, clearOverrides } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  clearOverrides();
  clearTableSellCities();
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

// Fixture: the reported Lymhurst capes, with the scan's real 24h volumes.
// Prices differ per city so the price cell proves WHICH city was read.
const CAPES = {
  // Black Market 1195, but Lymhurst is the argmax at 3199.
  T4_CAPEITEM_FW_LYMHURST: {
    "Black Market":  { sell_price: 4100, volume_24h: 1195 },
    Lymhurst:        { sell_price: 4200, volume_24h: 3199 },
    "Fort Sterling": { sell_price: 4300, volume_24h: 1078 },
    Brecilien:       { sell_price: 4400, volume_24h: 548 },
    Bridgewatch:     { sell_price: 4500, volume_24h: 315 },
    Caerleon:        { sell_price: 4600, volume_24h: 117 },
    Martlock:        { sell_price: 4700, volume_24h: 525 },
    Thetford:        { sell_price: 4800, volume_24h: 2 },
  },
  // Black Market 453, argmax is Brecilien at 674.
  T5_CAPEITEM_FW_LYMHURST: {
    "Black Market":  { sell_price: 5100, volume_24h: 453 },
    Brecilien:       { sell_price: 5200, volume_24h: 674 },
    "Fort Sterling": { sell_price: 5300, volume_24h: 576 },
  },
  // Argmax already IS the Black Market.
  T6_CAPEITEM_FW_LYMHURST: {
    "Black Market": { sell_price: 45425, volume_24h: 3423 },
    Lymhurst:       { sell_price: 46000, volume_24h: 915 },
  },
  // Never traded at the Black Market at all.
  "T4_CAPEITEM_FW_LYMHURST@4": {
    Lymhurst: { sell_price: 9000, volume_24h: 8 },
  },
};

const T4_TOTAL = 1195 + 3199 + 1078 + 548 + 315 + 117 + 525 + 2; // 6979

function render(pick) {
  if (pick) setTableSellCity("volume-table", pick);
  renderVolumeTable(JSON.parse(JSON.stringify(CAPES)));
  return mod.exports.captured;
}
const rowFor = (cap, id) => cap.rows.find((r) => r.itemId === id) || null;
const priceCityOf = (cap, id) => {
  const i = cap.rows.findIndex((r) => r.itemId === id);
  const m = i >= 0 ? cap.html[i].match(/data-city="([^"]+)"/g) : null;
  return m ? m[m.length - 1].replace(/data-city="|"/g, "") : null;
};

console.log("\n=== render-volume - City pick re-prices the rows ===");

// The reported bug.
test("Black Market pick keeps a row whose argmax city is Lymhurst", () => {
  const cap = render("Black Market");
  assert.ok(rowFor(cap, "T4_CAPEITEM_FW_LYMHURST"), "T4 cape must be listed under a Black Market pick");
  assert.ok(rowFor(cap, "T5_CAPEITEM_FW_LYMHURST"), "plain T5 cape must be listed too");
});

test("kept row is re-expressed at the picked city", () => {
  const row = rowFor(render("Black Market"), "T4_CAPEITEM_FW_LYMHURST");
  assert.strictEqual(row.topCity, "Black Market");
  assert.strictEqual(row.topCityVol, 1195, "Top City Volume must be the picked city's volume");
  assert.strictEqual(row.displayPriceCity, "Black Market");
  assert.strictEqual(row.topCityPrice, 4100, "price must come from the picked city");
});

test("Total Volume (All Cities) still sums every market under a pick", () => {
  const row = rowFor(render("Black Market"), "T4_CAPEITEM_FW_LYMHURST");
  assert.strictEqual(row.totalVol, T4_TOTAL);
});

test("price cell is rendered at the picked city", () => {
  assert.strictEqual(priceCityOf(render("Black Market"), "T4_CAPEITEM_FW_LYMHURST"), "Black Market");
});

test("row with no volume at the picked city is dropped", () => {
  const cap = render("Black Market");
  assert.strictEqual(rowFor(cap, "T4_CAPEITEM_FW_LYMHURST@4"), null,
    "@4 trades only in Lymhurst, so a Black Market pick must not list it");
});

test("row whose argmax already IS the pick is unchanged", () => {
  const row = rowFor(render("Black Market"), "T6_CAPEITEM_FW_LYMHURST");
  assert.strictEqual(row.topCity, "Black Market");
  assert.strictEqual(row.topCityVol, 3423);
  assert.strictEqual(row.topCityPrice, 45425);
});

test("ranking basis: picked-city volumes order T6 > T4 > T5", () => {
  const cap = render("Black Market");
  const order = cap.rows
    .slice()
    .sort((a, b) => b.topCityVol - a.topCityVol)
    .map((r) => r.itemId);
  assert.deepStrictEqual(order, [
    "T6_CAPEITEM_FW_LYMHURST",
    "T4_CAPEITEM_FW_LYMHURST",
    "T5_CAPEITEM_FW_LYMHURST",
  ]);
});

// A pick at a royal city reads that city, not the Black Market.
test("Lymhurst pick reads Lymhurst", () => {
  const row = rowFor(render("Lymhurst"), "T4_CAPEITEM_FW_LYMHURST");
  assert.strictEqual(row.topCityVol, 3199);
  assert.strictEqual(row.topCityPrice, 4200);
});

test("Thetford pick keeps a 2-unit row (any volume counts)", () => {
  const row = rowFor(render("Thetford"), "T4_CAPEITEM_FW_LYMHURST");
  assert.strictEqual(row.topCityVol, 2);
  assert.strictEqual(rowFor(render("Thetford"), "T6_CAPEITEM_FW_LYMHURST"), null,
    "T6 never traded in Thetford");
});

// No pick: today's behaviour, untouched.
test("no pick - argmax city, all-cities gate", () => {
  const cap = render(null);
  const t4 = rowFor(cap, "T4_CAPEITEM_FW_LYMHURST");
  assert.strictEqual(t4.topCity, "Lymhurst");
  assert.strictEqual(t4.topCityVol, 3199);
  assert.strictEqual(t4.totalVol, T4_TOTAL);
  assert.ok(rowFor(cap, "T4_CAPEITEM_FW_LYMHURST@4"), "a Lymhurst-only row still lists with no pick");
  assert.strictEqual(rowFor(cap, "T5_CAPEITEM_FW_LYMHURST").topCity, "Brecilien");
});

// Precedence: the table-wide pick outranks a per-item pin.
test("pick outranks a per-item sell force", () => {
  setCityForce("T4_CAPEITEM_FW_LYMHURST", "sell", "Bridgewatch");
  setOverridePrice("T4_CAPEITEM_FW_LYMHURST", "Bridgewatch", 12345);
  setTableSellCity("volume-table", "Black Market");
  renderVolumeTable(JSON.parse(JSON.stringify(CAPES)));
  const row = rowFor(mod.exports.captured, "T4_CAPEITEM_FW_LYMHURST");
  assert.strictEqual(row.displayPriceCity, "Black Market");
  assert.strictEqual(row.topCityPrice, 4100);
});

test("a typed override AT the picked city still wins", () => {
  setOverridePrice("T4_CAPEITEM_FW_LYMHURST", "Black Market", 7777);
  setTableSellCity("volume-table", "Black Market");
  renderVolumeTable(JSON.parse(JSON.stringify(CAPES)));
  assert.strictEqual(rowFor(mod.exports.captured, "T4_CAPEITEM_FW_LYMHURST").topCityPrice, 7777);
});

test("force still applies once the pick is cleared", () => {
  setCityForce("T4_CAPEITEM_FW_LYMHURST", "sell", "Bridgewatch");
  setOverridePrice("T4_CAPEITEM_FW_LYMHURST", "Bridgewatch", 12345);
  renderVolumeTable(JSON.parse(JSON.stringify(CAPES)));
  const row = rowFor(mod.exports.captured, "T4_CAPEITEM_FW_LYMHURST");
  assert.strictEqual(row.displayPriceCity, "Bridgewatch");
  assert.strictEqual(row.topCityPrice, 12345);
});

// The picker itself must offer every city, or a city that tops no row could
// never be picked - which is the whole point of the re-pricing.
console.log("\n=== table-sell-city - the Volume picker offers every city ===");

test("sellCityOptionsFor('volume-table') returns the full SELL_CITIES list", () => {
  const opts = sellCityOptionsFor("volume-table");
  assert.ok(Array.isArray(opts), "must not fall back to the pruned option list");
  assert.deepStrictEqual(opts, globalThis.SELL_CITIES);
  assert.ok(opts.includes("Black Market"));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
