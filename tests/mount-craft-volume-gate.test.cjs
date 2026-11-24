/**
 * Test: Mount CRAFT rows are valuations, not volume-gated trade picks.
 *
 * Same root cause as the breeding rows (see faction-breed-thin-market.test.cjs):
 * the market-order volume gate (MIN_VOLUME=25) suppressed any craftable mount
 * whose output (or materials) traded below 25/24h, even when real IQR-valid
 * prices existed. Mount rows are always-visible valuations — the Vol/24h column
 * already warns about thin liquidity — so their price lookups use
 * MOUNT_MIN_VOLUME (0). IQR filtering still rejects troll orders.
 *
 * Black-box: feed synthetic marketData, assert on the resulting craft-row data.
 *
 * Run: node tests/mount-craft-volume-gate.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const stubs = `
const _els = {};
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const window = { addEventListener: () => {} };
const tableState = { "mounts-table": { data: [] }, "faction-spending-table": { data: [] } };
function renderTableData(id, rows, fmt) { tableState[id].data = rows; tableState[id].html = rows.map((r,i)=>{ try { return fmt(r,i); } catch(e){ return "ERR:"+e.message; } }); }
function priceTd(p){ return "<td>"+p+"</td>"; }
function volTd(){ return "<td></td>"; }
function profitTd(){ return "<td></td>"; }
function pureProfitTd(){ return "<td></td>"; }
function matPriceSpan(id, c, p){ return "<span>"+p+"</span>"; }
function getProfitClass(){ return ""; }
const ITEM_NAMES_MAP = {};
let lastMpMarketData = null, lastMarketData = null;
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
const CRAFTING_ITEMS = [], FLIPPING_ITEMS = [], TRANSPORT_ITEMS = [], CONSUMABLES = [], FARMING_ITEMS = [], ARTIFACT_FLIP_ITEMS = [], GEAR_CAPES = [];
`;

const sources =
  J("focus-play.js") +
  J("data-faction-fp-costs.js") +
  J("focus-costs.js") +
  J("data-mounts.js") +
  J("data-city-bonuses.js") +
  (J("calculations.js") + J("calculations-margins.js")) +
  J("travel-cost.js") +
  J("mp-bonus.js") +
  (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) +
  J("rrr-eligible.js") + J("render-mounts.js") + J("render-mounts-breeding-row.js") + J("render-mounts-craft-row.js");

const mod = new Module("mount-craft-gate");
mod._compile(
  stubs + sources + "\nmodule.exports = { tableState, renderMountsTable };",
  "mount-craft-gate.js",
);
const X = mod.exports;

const row = (buy, sell, vol) => ({ buy_price: buy, sell_price: sell, volume_24h: vol });

// Riding Horse T8 = T8_FARM_HORSE_GROWN + 20x T8_LEATHER → sells as T8_MOUNT_HORSE.
function render(matVol, outputVol) {
  const md = {};
  const put = (id, c, b, s, v) => { (md[id] = md[id] || {})[c] = row(b, s, v); };
  put("T8_FARM_HORSE_GROWN", "Lymhurst", 100000, 110000, matVol);
  put("T8_LEATHER", "Lymhurst", 9000, 9500, matVol);
  put("T8_MOUNT_HORSE", "Lymhurst", 380000, 420000, outputVol);
  X.renderMountsTable(md);
}
const craftRow = () =>
  X.tableState["mounts-table"].data.find(
    (r) => r.item && r.item.id === "T8_MOUNT_HORSE" && r.isCraft && r.section === "royal",
  );

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const V_HI = 1000, V_LO = 4; // V_LO < MIN_VOLUME (25)

console.log("Mount craft-row volume-gate tests\n");

test("craft row appears when OUTPUT trades below the gate (sell vol=4)", () => {
  render(V_HI, V_LO);
  const r = craftRow();
  assert.ok(r, "craft row for T8_MOUNT_HORSE should exist with low output volume");
  assert.ok(r.sellPot.price > 0, `sell price should resolve, got ${r.sellPot && r.sellPot.price}`);
});

test("craft row appears when MATERIALS trade below the gate (mat vol=4)", () => {
  render(V_LO, V_HI);
  const r = craftRow();
  assert.ok(r, "craft row should exist when mats are thinly traded");
  assert.ok(r.totalInputCost > 0, `input cost should compute, got ${r.totalInputCost}`);
});

test("craft row appears when BOTH output and mats are thin (vol=4)", () => {
  render(V_LO, V_LO);
  const r = craftRow();
  assert.ok(r, "craft row should exist when both sides are thin");
  assert.ok(r.sellPot.price > 0 && r.totalInputCost > 0, "both sides should resolve");
});

test("high-volume craft mount unchanged — regression guard", () => {
  render(V_HI, V_HI);
  const r = craftRow();
  assert.ok(r && r.sellPot.price > 0, "high-vol craft row should still exist");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
