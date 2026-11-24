/**
 * Test: Faction Spending breed column survives thin-market FW mounts.
 *
 * Two behaviors, both reported by the user as "breeding calculations gone":
 *
 *  PART 1 — Degated valuation (js/render-mounts.js): FW saddled mounts trade
 *    only a few per day (live: T5/T8 Wild Boar ≈ 4/24h), well below the
 *    market-mode volume gate (MIN_VOLUME=25). The breeding row must still
 *    resolve the saddled-mount sell price (and baby buy price) so silverPerFp
 *    computes — IQR outlier filtering already protects against troll orders,
 *    and the Vol/24h column communicates the thin liquidity. Mirrors the
 *    faction Direct column, which already passes threshold 0.
 *
 *  PART 2 — Always-editable inputs (js/render-faction-spending.js): when a
 *    saddled mount has NO market price anywhere (silverPerFp=0), the breed cell
 *    must STILL render the expand toggle so the breed-detail sub-row (with the
 *    editable saddled-mount price / food / mats) is reachable. Once the user
 *    sets a price the override bypasses the volume gate and the value computes.
 *
 * Black-box: feed synthetic marketData, assert on the resulting row data and
 * the rendered faction-table HTML. Loads the real modules end-to-end (the bug
 * was a cross-module integration gap that per-module unit tests missed).
 *
 * Run: node tests/faction-breed-thin-market.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const stubs = `
const _els = {}; // toggles absent → market order mode, BRZ off, focus on
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const window = { addEventListener: () => {} };
const tableState = { "mounts-table": { data: [] }, "faction-spending-table": { data: [] } };
function renderTableData(id, rows, fmt) { tableState[id].data = rows; tableState[id].html = rows.map((r,i)=>{ try { return fmt(r,i); } catch(e){ return "ERR:"+e.message; } }); }
// The "+" column cell (js/table-add-button.js) — every row template emits it.
// Row identity for the "+" column (js/sorting.js getRowKey).
function getRowKey(row, tableId){ return String(row && (row.itemId || row.id || "")); }
function addTdForKey(){ return '<td class="cell-add"></td>'; }
function priceTd(p, id, c){ return "<td class='price-editable' data-item-id='"+id+"' data-city='"+c+"'>"+p+"</td>"; }
function volTd(v, id, c){ return "<td>"+v+"</td>"; }
function profitTd(mi){ return "<td>"+(mi&&mi.profit)+"</td>"; }
function pureProfitTd(mi){ return "<td>"+(mi&&mi.profit)+"</td>"; }
function matPriceSpan(matId, city, price){ return "<span class='price-editable mat-price-inline' data-item-id='"+matId+"' data-city='"+(city||"")+"' data-city-list='buy'>@ "+price+" ea</span>"; }
function getProfitClass(){ return ""; }
const ITEM_NAMES_MAP = {};
let lastMpMarketData = null;
let lastMarketData = null;
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
  J("rrr-eligible.js") + J("render-mounts.js") + J("render-mounts-breeding-row.js") + J("render-mounts-craft-row.js") +
  J("render-faction-spending.js");

globalThis.tx = globalThis.tx || ((en) => en);
globalThis.dispName = globalThis.dispName || ((id, fallback) => fallback);
const mod = new Module("breed-thin-market");
mod._compile(
  stubs + sources +
    "\nmodule.exports = { tableState, renderMountsTable, renderFactionSpendingTable, getBreedDataByBaby };",
  "breed-thin-market.js",
);
const X = mod.exports;

const V_HI = 1000, V_LO = 4; // V_LO < MIN_VOLUME (25)
const row = (buy, sell, vol) => ({ buy_price: buy, sell_price: sell, volume_24h: vol });

function scenario(saddledVol, includeSaddled, babyVol = V_LO) {
  const md = {};
  const put = (id, city, buy, sell, vol) => { (md[id] = md[id] || {})[city] = row(buy, sell, vol); };
  // Baby buy side — also thin in reality (T8 ≈ 16/day); V_LO proves the buy
  // side is degated too. The high-vol guard passes babyVol=V_HI.
  put("T5_FARM_DIREBOAR_FW_LYMHURST_BABY", "Lymhurst", 30000, 35000, babyVol);
  put("T8_FARM_DIREBOAR_FW_LYMHURST_BABY", "Lymhurst", 200000, 545979, babyVol);
  // Saddler mats + feed (high volume)
  put("T5_LEATHER", "Lymhurst", 2000, 2200, V_HI);
  put("T8_LEATHER", "Lymhurst", 9000, 9500, V_HI);
  put("T1_FACTION_FOREST_TOKEN_1", "Lymhurst", 8000, 9000, V_HI);
  put("T5_MEAT", "Lymhurst", 300, 350, V_HI);
  put("T8_MEAT", "Lymhurst", 900, 1000, V_HI);
  // Saddled mount output (the crux)
  if (includeSaddled) {
    put("T5_MOUNT_DIREBOAR_FW_LYMHURST", "Lymhurst", 250000, 320000, saddledVol);
    put("T8_MOUNT_DIREBOAR_FW_LYMHURST_ELITE", "Lymhurst", 1500000, 1800000, saddledVol);
  }
  X.renderMountsTable(md);
  X.renderFactionSpendingTable(md);
  return md;
}

const mountsRow = (babyId) =>
  X.tableState["mounts-table"].data.find(
    (r) => r.item && r.item.babyId === babyId && r.section === "royal",
  );
const factionHtml = (babyId) => {
  const i = X.tableState["faction-spending-table"].data.findIndex((r) => r.itemId === babyId);
  return i >= 0 ? X.tableState["faction-spending-table"].html[i] : "";
};

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Faction breed thin-market tests\n");

// ── PART 1: degated valuation ──
test("PART1: T5 breeding row computes silverPerFp when saddled vol=4 (< gate)", () => {
  scenario(V_LO, true);
  const r = mountsRow("T5_FARM_DIREBOAR_FW_LYMHURST_BABY");
  assert.ok(r, "T5 royal breeding row should exist");
  assert.ok(r.sellPot.price > 0, `saddled sell price should resolve, got ${r.sellPot.price}`);
  assert.ok(r.silverPerFp > 0, `silverPerFp should be > 0, got ${r.silverPerFp}`);
});

test("PART1: T8 breeding row computes silverPerFp when saddled vol=4 (< gate)", () => {
  scenario(V_LO, true);
  const r = mountsRow("T8_FARM_DIREBOAR_FW_LYMHURST_BABY");
  assert.ok(r, "T8 royal breeding row should exist");
  assert.ok(r.silverPerFp > 0, `silverPerFp should be > 0, got ${r.silverPerFp}`);
});

test("PART1: faction breed cell shows a numeric value (not —) for thin T5 mount", () => {
  scenario(V_LO, true);
  const html = factionHtml("T5_FARM_DIREBOAR_FW_LYMHURST_BABY");
  assert.ok(/breed-toggle/.test(html), "thin-market row should still expose a toggle");
  assert.ok(!/Breeding only applies to Baby rows/.test(html), "should not be the bare — cell");
});

test("PART1: high-volume mount unchanged (still computes) — regression guard", () => {
  scenario(V_HI, true, V_HI);
  const r = mountsRow("T5_FARM_DIREBOAR_FW_LYMHURST_BABY");
  assert.ok(r.silverPerFp > 0, `silverPerFp should be > 0 for high-vol, got ${r.silverPerFp}`);
});

// ── PART 2: editable inputs when no saddled-mount price at all ──
test("PART2: breed cell renders the expand toggle even when silverPerFp=0 (no data)", () => {
  scenario(V_LO, /*includeSaddled*/ false);
  const r = mountsRow("T5_FARM_DIREBOAR_FW_LYMHURST_BABY");
  assert.strictEqual(r.silverPerFp, 0, "no saddled price → silverPerFp 0");
  const html = factionHtml("T5_FARM_DIREBOAR_FW_LYMHURST_BABY");
  assert.ok(/breed-toggle/.test(html), "toggle must still render so user can open the sub-row");
});

test("PART2: breed-detail sub-row is present and exposes an editable saddled-price span", () => {
  scenario(V_LO, false);
  const html = factionHtml("T5_FARM_DIREBOAR_FW_LYMHURST_BABY");
  assert.ok(/breed-detail-row/.test(html), "detail sub-row must be in the DOM to open");
  assert.ok(/data-city-list="sell"/.test(html), "saddled-mount price must be editable (sell side)");
});

test("PART2: detail toggle + row carry matching data-baby-id so the click handler resolves it", () => {
  scenario(V_LO, false);
  const id = "T5_FARM_DIREBOAR_FW_LYMHURST_BABY";
  const html = factionHtml(id);
  assert.ok(new RegExp(`breed-toggle[^>]*data-baby-id="${id}"`).test(html)
         || new RegExp(`data-baby-id="${id}"[^>]*breed-toggle`).test(html)
         || html.includes(`data-baby-id="${id}"`), "toggle must carry the baby id");
  assert.ok(new RegExp(`breed-detail-row[^>]*data-baby-id="${id}"`).test(html), "detail row must carry the baby id");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
