/**
 * Test: render-volume.js must pick the correct displayPriceCity when the user
 * has overrides at multiple cities.
 *
 * Bug: the old logic used Object.keys(priceOverrides[itemId])[0], which returns
 * the OLDEST inserted city. So if the user had previously overridden city X
 * and then opened the editor, changed the city to Y, and saved, the volume row
 * still showed X (no city force was consulted). The cell appeared to "reset
 * the city" on commit.
 *
 * Fix: prefer the city force set by the price editor's commit() path; fall
 * back to the most recently inserted override key; finally fall back to the
 * top-volume city.
 *
 * Run: node tests/volume-city-resolution.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const renderSrc = fs.readFileSync(
  path.join(__dirname, "..", "js", "render-volume.js"),
  "utf8",
);

// ── Stubs ────────────────────────────────────────────────────────────────────
const stubs = `
const SELL_CITIES = ["Lymhurst","Bridgewatch","Caerleon","Martlock","Thetford","Fort Sterling"];

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
function getItemCategory(id) { return "test"; }
function getRowKey(row, tableId) { return row.itemId + ":" + tableId; }

// renderTableData captures the rows passed in so the test can inspect them.
let _captured = null;
function renderTableData(tableId, rows, formatter) {
  _captured = { tableId, rows: rows.slice(), formatter, html: rows.map((r,i) => formatter(r,i)) };
}

// priceTd encodes the city the row will display — assertions read this back
// from the formatter output.
function priceTd(price, itemId, city) {
  return '<td data-item-id="' + itemId + '" data-city="' + city + '" data-raw-price="' + price + '">' + price + '</td>';
}
`;

const mod = new Module("render-volume-test");
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
      priceOverrides,
      cityForces,
    };`,
  "render-volume.js",
);

const {
  renderVolumeTable,
  setOverridePrice,
  setCityForce,
  clearOverrides,
} = mod.exports;

let passed = 0,
  failed = 0;
function test(name, fn) {
  clearOverrides();
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

// ── Fixture: T4_RUNE with Lymhurst as the highest-volume city ────────────────
function marketData() {
  return {
    T4_RUNE: {
      Lymhurst:     { sell_price: 8,  buy_price: 7,  volume_24h: 73448146 },
      Bridgewatch:  { sell_price: 12, buy_price: 9,  volume_24h: 10000 },
      Caerleon:     { sell_price: 15, buy_price: 11, volume_24h: 5000 },
    },
  };
}

function dataCityOf(html) {
  const m = html.match(/data-city="([^"]+)"/g);
  // Index -1 of the matches is the price cell (last column rendered).
  return m ? m[m.length - 1].replace(/data-city="|"/g, "") : null;
}

console.log("\n=== render-volume — displayPriceCity resolution ===");

test("no override → uses topCity (highest volume)", () => {
  renderVolumeTable(marketData());
  const html = mod.exports.captured.html[0];
  assert.strictEqual(dataCityOf(html), "Lymhurst", "expected price cell at Lymhurst");
});

test("single override at non-top city → uses that city", () => {
  setOverridePrice("T4_RUNE", "Bridgewatch", 50);
  renderVolumeTable(marketData());
  const html = mod.exports.captured.html[0];
  assert.strictEqual(dataCityOf(html), "Bridgewatch", "single override should be displayed");
});

test("two overrides + city force → forced city wins (the bug scenario)", () => {
  // Original override at Bridgewatch (older)
  setOverridePrice("T4_RUNE", "Bridgewatch", 50);
  // User opens editor, changes city to Caerleon, sets new price.
  // commit() does setOverridePrice + setCityForce.
  setOverridePrice("T4_RUNE", "Caerleon", 100);
  setCityForce("T4_RUNE", "sell", "Caerleon");

  renderVolumeTable(marketData());
  const html = mod.exports.captured.html[0];
  assert.strictEqual(
    dataCityOf(html),
    "Caerleon",
    "with city force pinned, the row must show the forced city (not the older override)",
  );
});

test("two overrides, no city force → most recent insertion wins", () => {
  // Legacy localStorage state — overrides exist but no force was saved.
  setOverridePrice("T4_RUNE", "Bridgewatch", 50);
  setOverridePrice("T4_RUNE", "Caerleon", 100);
  // (no setCityForce call)
  renderVolumeTable(marketData());
  const html = mod.exports.captured.html[0];
  assert.strictEqual(
    dataCityOf(html),
    "Caerleon",
    "with no force, the latest override should be shown (not Object.keys()[0])",
  );
});

test("city force without matching override → ignored, fall through to override keys", () => {
  // Pathological: force pinned at city with no override price.
  setOverridePrice("T4_RUNE", "Bridgewatch", 50);
  setCityForce("T4_RUNE", "sell", "Thetford"); // no override at Thetford

  renderVolumeTable(marketData());
  const html = mod.exports.captured.html[0];
  assert.strictEqual(
    dataCityOf(html),
    "Bridgewatch",
    "ignored stale force, should fall through to the override city",
  );
});

test("no overrides, but city force set → fall through to topCity (force needs an override to take effect)", () => {
  setCityForce("T4_RUNE", "sell", "Caerleon");
  renderVolumeTable(marketData());
  const html = mod.exports.captured.html[0];
  assert.strictEqual(
    dataCityOf(html),
    "Lymhurst",
    "force alone (no override price) shouldn't override topCity in the volume table",
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
