/**
 * Test: transmute rows are tiered by their FINAL product, not the bought start.
 *
 * The Tier picker (and the Tier column) must describe what the row PRODUCES:
 * selecting T6 has to surface "T4 → T5 → T6" chains, which used to be tagged T4
 * because `recipe.tier` is the source tier. The renderer pins the pickers with
 * data-filter-tier / data-filter-ench read off targetId, and prints the same
 * tier (with its enchant) in the first cell.
 *
 * Black-box / TLD: real data-transmute + render-transmute with stubbed table
 * helpers and synthetic marketData. No DOM, no live API.
 *
 * Run: node tests/transmute-tier-filter-target.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");
// Cell text runs through tx(english, slug); en-mode identity keeps assertions in English.
globalThis.tx = globalThis.tx || ((en) => en);

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const stubs = `
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
const SETUP_FEE = 0.025, PREMIUM_TAX = 0.04, MAX_MARGIN_PERCENT = 100000;
function getOrderType(){ return "buy"; }
function isBlackRedZoneEnabled(){ return true; }
function isValidSourceCity(){ return true; }
function isSuspectMargin(m){ return Number.isFinite(m) && m > MAX_MARGIN_PERCENT; }
function suspectMarginBadge(){ return ""; }
function getIQRBounds(){ return null; }
function calcStationFeeSilver(){ return 0; }
function getBuyPrice(data, city){ return data && data[city] ? (data[city].buy || 0) : 0; }
function getSellPrice(data, city){ return data && data[city] ? (data[city].sell || 0) : 0; }
function getCityForce(){ return null; }
function getOverridePrice(){ return null; }
function isInvalidCrossRoute(){ return false; }
function getMinVol(){ return 123; }
function getMinVol2(){ return 123; }
function formatSilver(n){ return String(n); }
function getItemDisplayName(id){ const s = resourceShortName(id); return s || id; }
function matPriceSpan(id, city, price){ return "<span data-item-id='"+id+"'>@ "+price+"</span>"; }
function resourceAliasSpan(){ return ""; }
// Read-only aggregate cost cell (js/app.js aggregateCostTd) — the Input Cost
// column is a sum, so it is not a click-to-override price cell.
function aggregateCostTd(c, cls) { return '<td class="' + (cls || "silver-val cell-num") + '">' + (Number(c) > 0 ? c : "—") + '</td>'; }
function priceTd(p){ return "<td>"+p+"</td>"; }
function profitTd(mi){ return "<td>"+(mi&&mi.profit)+"</td>"; }
function pureProfitTd(mi){ return "<td>"+(mi&&mi.profit)+"</td>"; }
function volTd(v){ return "<td>"+v+"</td>"; }
// The "+" column cell (js/table-add-button.js) — every row template emits it.
function addTdForKey(){ return '<td class="cell-add"></td>'; }
function getRowKey(row){ return row.tier + "|" + (row.transition && row.transition.label) + "|" + row.section; }
const captured = { rows: [], html: [] };
function renderTableData(id, rows, fmt){
  captured.rows = rows;
  captured.html = rows.map((r,i) => { try { return fmt(r,i); } catch(e){ return "ERR:"+e.message; } });
}
`;

const sources = J("resource-names.js") + J("data-transmute.js") + J("render-transmute.js");

const mod = new Module("transmute-tier-filter");
mod._compile(
  stubs + sources + "\nmodule.exports = { renderTransmuteTable, captured };",
  "transmute-tier-filter.js",
);
const { renderTransmuteTable, captured } = mod.exports;

// Cheap start, rich end → every seeded route renders.
const marketData = {
  // single-step tier-up T4 ore → T5 ore
  T4_ORE: { Caerleon: { buy: 100, volume_24h: 50 } },
  T5_ORE: { Caerleon: { sell: 2000, volume_24h: 50 } },
  // multi-step tier chain ending T7 ore
  T6_ORE: { Caerleon: { buy: 400, sell: 900, volume_24h: 50 } },
  T7_ORE: { Caerleon: { sell: 40000, volume_24h: 50 } },
  // enchant-up T6 logs → T6.1 logs
  T6_WOOD: { Caerleon: { buy: 500, volume_24h: 50 } },
  "T6_WOOD_LEVEL1@1": { Caerleon: { sell: 9000, volume_24h: 50 } },
  // material type-up (same tier) T4 Rune → T4 Soul
  T4_RUNE: { Caerleon: { buy: 300, volume_24h: 50 } },
  T4_SOUL: { Caerleon: { sell: 5000, volume_24h: 50 } },
};

renderTransmuteTable(marketData);

// One rendered <tr> per row, indexed by its recipe's targetId.
const byTarget = new Map();
captured.rows.forEach((row, i) => {
  const html = captured.html[i];
  if (!html || !html.includes("<tr") || !row.targetId) return;
  if (!byTarget.has(row.targetId)) byTarget.set(row.targetId, []);
  byTarget.get(row.targetId).push({ row, html });
});

const attr = (html, name) => {
  const m = new RegExp(name + '="([^"]*)"').exec(html);
  return m ? m[1] : null;
};
const firstCell = (html) => {
  // The first cell is the "+" (My Crafting List) cell; the label follows it.
  const m = /<tr[^>]*>\s*<td class="cell-add"><\/td>\s*<td>([^<]*)<\/td>/.exec(html);
  return m ? m[1].trim() : null;
};

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name}\n    ${e.message}`); }
}

console.log("Transmute tier filter follows the final product\n");

test("every rendered row carries data-filter-tier / data-filter-ench", () => {
  const rendered = captured.html.filter((h) => h && h.includes("<tr"));
  assert.ok(rendered.length > 0, "no rows rendered");
  rendered.forEach((h) => {
    assert.ok(attr(h, "data-filter-tier"), "row missing data-filter-tier: " + h.slice(0, 120));
    assert.ok(attr(h, "data-filter-ench") !== null, "row missing data-filter-ench");
  });
});

test("single-step tier-up T4 ore → T5 ore filters (and prints) as T5", () => {
  const hit = (byTarget.get("T5_ORE") || [])[0];
  assert.ok(hit, "no T5_ORE row rendered");
  assert.strictEqual(attr(hit.html, "data-filter-tier"), "5");
  assert.strictEqual(attr(hit.html, "data-filter-ench"), "0");
  assert.strictEqual(firstCell(hit.html), "T5");
});

test("multi-step chain ending at T7 ore filters as T7, not its T4/T5/T6 start", () => {
  const hits = byTarget.get("T7_ORE") || [];
  assert.ok(hits.length > 0, "no T7_ORE row rendered");
  hits.forEach(({ row, html }) => {
    assert.strictEqual(attr(html, "data-filter-tier"), "7", row.transition.label);
    assert.strictEqual(firstCell(html), "T7", row.transition.label);
  });
  // At least one of them really did start below T7 (that's the bug being fixed).
  assert.ok(hits.some(({ row }) => row.tier < 7), "no sub-T7 start among the T7 rows");
});

test("enchant-up T6 → T6.1 filters as tier 6 / enchant 1 and prints T6.1", () => {
  const hit = (byTarget.get("T6_WOOD_LEVEL1@1") || [])[0];
  assert.ok(hit, "no T6.1 wood row rendered");
  assert.strictEqual(attr(hit.html, "data-filter-tier"), "6");
  assert.strictEqual(attr(hit.html, "data-filter-ench"), "1");
  assert.strictEqual(firstCell(hit.html), "T6.1");
});

test("same-tier material type-up keeps its own tier (T4 Rune → T4 Soul)", () => {
  const hit = (byTarget.get("T4_SOUL") || [])[0];
  assert.ok(hit, "no T4_SOUL row rendered");
  assert.strictEqual(attr(hit.html, "data-filter-tier"), "4");
  assert.strictEqual(firstCell(hit.html), "T4");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
