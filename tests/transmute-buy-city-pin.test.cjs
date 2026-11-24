/**
 * Test: a pinned BUY city sticks on Transmute rows.
 *
 * Editing the source price cell pins the buy city (setCityForce(id,"buy")), and
 * priceTransmuteRoute is supposed to buy the source there instead of re-scanning
 * for the cheapest city. Resource rows (Wood/Ore/Fiber/Hide/Stone) take their
 * start cost from the produce-or-buy acquire map (computeTransmuteAcquireCosts),
 * which knows nothing about the pin — so before the fix the pin was silently
 * dropped for every resource + chain row, and a start that was cheaper to
 * PRODUCE than to buy hid the row entirely.
 *
 * Black-box: real data-transmute + render-transmute, stubbed table helpers, a
 * mutable force map, synthetic marketData. No DOM, no live API.
 *
 * Run: node tests/transmute-buy-city-pin.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const stubs = `
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
const SETUP_FEE = 0.025, PREMIUM_TAX = 0.04, MAX_MARGIN_PERCENT = 100000;
function getOrderType(){ return "buy"; }             // MIN_VOLUME = 0
function isBlackRedZoneEnabled(){ return true; }      // single section over CITIES
function isSuspectMargin(m){ return Number.isFinite(m) && m > MAX_MARGIN_PERCENT; }
function suspectMarginBadge(){ return ""; }
function getIQRBounds(){ return null; }
function calcStationFeeSilver(){ return 0; }
function getBuyPrice(data, city){ return data && data[city] ? (data[city].buy || 0) : 0; }
function getSellPrice(data, city){ return data && data[city] ? (data[city].sell || 0) : 0; }
const FORCE = {};
function getCityForce(id, side){ return FORCE[id + "|" + side] || null; }
function getOverridePrice(){ return null; }
function isInvalidCrossRoute(){ return false; }
function getMinVol(){ return 123; }
function getMinVol2(){ return 123; }
function formatSilver(n){ return String(n); }
function getItemDisplayName(id){ const s = resourceShortName(id); return s || id; }
function matPriceSpan(id, city, price){ return "<span data-item-id='"+id+"'>@ "+price+"</span>"; }
function resourceAliasSpan(){ return ""; }
function priceTd(p){ return "<td>"+p+"</td>"; }
function profitTd(mi){ return "<td>"+(mi&&mi.profit)+"</td>"; }
function pureProfitTd(mi){ return "<td>"+(mi&&mi.profit)+"</td>"; }
function volTd(v){ return "<td>"+v+"</td>"; }
function getRowKey(row){ return row.tier + "|" + (row.transition && row.transition.label) + "|" + row.section; }
const captured = { rows: [] };
function renderTableData(id, rows, fmt){ captured.rows = rows; rows.forEach((r,i) => { try { fmt(r,i); } catch(e){} }); }
`;

const sources = J("resource-names.js") + J("data-transmute.js") + J("render-transmute.js");

const mod = new Module("transmute-pin");
mod._compile(
  stubs + sources + "\nmodule.exports = { renderTransmuteTable, captured, FORCE };",
  "transmute-pin.js",
);
const { renderTransmuteTable, captured, FORCE } = mod.exports;

// Two-city order book. Caerleon is always the cheapest source, Martlock is a
// pricier alternative — so any row that reads "Martlock" did so because of a pin.
const marketData = {
  T4_ORE: {
    Caerleon: { buy: 100, volume_24h: 50 },
    Martlock: { buy: 500, volume_24h: 50 },
  },
  T5_ORE: {
    Caerleon: { buy: 900, sell: 2000, volume_24h: 50 },
    Martlock: { buy: 1500, sell: 2100, volume_24h: 50 },
  },
  T6_ORE: { Caerleon: { sell: 9000, volume_24h: 50 }, Martlock: { sell: 9000, volume_24h: 50 } },
  T4_RUNE: {
    Caerleon: { buy: 300, volume_24h: 50 },
    Martlock: { buy: 800, volume_24h: 50 },
  },
  T4_SOUL: { Caerleon: { sell: 5000, volume_24h: 50 }, Martlock: { sell: 5000, volume_24h: 50 } },
};

function render(forces) {
  Object.keys(FORCE).forEach((k) => delete FORCE[k]);
  Object.entries(forces || {}).forEach(([k, v]) => { FORCE[k] = v; });
  renderTransmuteTable(marketData);
  return captured.rows.filter((r) => r && r.sourceId);
}

const findRow = (rows, sourceId, targetId) =>
  rows.find((r) => r.sourceId === sourceId && r.targetId === targetId);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name}\n    ${e.message}`); }
}

console.log("Transmute buy-city pin\n");

test("unpinned resource row buys at the cheapest city", () => {
  const r = findRow(render(null), "T4_ORE", "T5_ORE");
  assert.ok(r, "T4→T5 ore row missing");
  assert.strictEqual(r.buyCity, "Caerleon");
  assert.strictEqual(r.buyPrice, 100);
});

test("pinned resource row buys at the pinned city", () => {
  const r = findRow(render({ "T4_ORE|buy": "Martlock" }), "T4_ORE", "T5_ORE");
  assert.ok(r, "T4→T5 ore row missing");
  assert.strictEqual(r.buyCity, "Martlock");
  assert.strictEqual(r.buyPrice, 500);
});

test("pinned row prices its input off the pinned city, not the cheapest", () => {
  const r = findRow(render({ "T4_ORE|buy": "Martlock" }), "T4_ORE", "T5_ORE");
  // 500 * (1 + 0.025) + fee(781) + stationFee — must be well above the
  // Caerleon-based 100 * 1.025 + 781.
  assert.ok(r.totalInputCost > 1200, `totalInputCost ${r.totalInputCost} looks like the Caerleon price`);
});

test("pin beats the produce-or-buy acquire map (row not hidden as produced)", () => {
  // T5 ore is far cheaper to PRODUCE (T4 @100 + 781 fee) than to buy anywhere,
  // so unpinned it renders as produced → hidden. Pinning it must bring back a
  // real market-buy row at that city.
  const unpinned = findRow(render(null), "T5_ORE", "T6_ORE");
  assert.ok(!unpinned, "T5→T6 row should be hidden while its start is produced");
  const r = findRow(render({ "T5_ORE|buy": "Martlock" }), "T5_ORE", "T6_ORE");
  assert.ok(r, "pinned T5→T6 row missing");
  assert.strictEqual(r.buyCity, "Martlock");
  assert.strictEqual(r.buyPrice, 1500);
  assert.strictEqual(r.sourceProduced, false);
});

test("material row pin still honored (regression)", () => {
  const r = findRow(render({ "T4_RUNE|buy": "Martlock" }), "T4_RUNE", "T4_SOUL");
  assert.ok(r, "Rune→Soul row missing");
  assert.strictEqual(r.buyCity, "Martlock");
  assert.strictEqual(r.buyPrice, 800);
});

test("pin at a city with no price falls back instead of dropping the row", () => {
  const r = findRow(render({ "T4_ORE|buy": "Bridgewatch" }), "T4_ORE", "T5_ORE");
  assert.ok(r, "row lost to an unpriceable pin");
  assert.strictEqual(r.buyCity, "Caerleon");
});

test("chain rows honor the pin on their bought start", () => {
  const rows = render({ "T4_ORE|buy": "Martlock" });
  const chains = rows.filter((r) => r.sourceId === "T4_ORE");
  assert.ok(chains.length > 0, "no rows start at T4_ORE");
  chains.forEach((r) => assert.strictEqual(r.buyCity, "Martlock", `${r.targetId} ignored the pin`));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
