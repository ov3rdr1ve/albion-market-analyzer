/**
 * Test: renderTransmuteTable prices magical-material TIER-UP rows at 5:1.
 *
 * A tier-up row (5× T4 Relic → 1× T5 Relic, silver 0) is the only transmute
 * shape that consumes more than one source unit, so the renderer must:
 *   - charge 5 × the source price (plus setup fee) into totalInputCost, not 1 ×;
 *   - keep showing the PER-UNIT market price in the source cell (that's the
 *     click-to-override price the user reads off the market), prefixed with the
 *     5× ratio so the row can't be misread as 1:1;
 *   - leave 1:1 rows (type-up + every resource row) priced exactly as before.
 *
 * Black-box / TLD: real resource-names + data-transmute + render-transmute with
 * stubbed table helpers and synthetic marketData. No DOM, no live API.
 *
 * Run: node tests/transmute-material-tier-up-render.test.cjs
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
const SELL_CITIES = [...CITIES, "Black Market"];
const SETUP_FEE = 0.025, PREMIUM_TAX = 0.04, MAX_MARGIN_PERCENT = 100000;
function getOrderType(){ return "buy"; }            // MIN_VOLUME = 0
function isBlackRedZoneEnabled(){ return true; }     // single section over CITIES
function isSuspectMargin(m){ return Number.isFinite(m) && m > MAX_MARGIN_PERCENT; }
function suspectMarginBadge(){ return ""; }
function getIQRBounds(){ return null; }
function calcStationFeeSilver(){ return 0; }
function getBuyPrice(data, city){ return data && data[city] ? (data[city].buy || 0) : 0; }
function getSellPrice(data, city){ return data && data[city] ? (data[city].sell || 0) : 0; }
function getCityForce(){ return null; }
function getOverridePrice(){ return null; }
function isInvalidCrossRoute(){ return false; }
function getMinVol2(){ return 123; }
function formatSilver(n){ return String(n); }
function getItemDisplayName(id){ return resourceShortName(id) || id; }
function matPriceSpan(id, city, price){ return "<span data-item-id='"+id+"'>@ "+price+"</span>"; }
function resourceAliasSpan(){ return ""; }
// Read-only aggregate cost cell (js/app.js aggregateCostTd) — the Input Cost
// column is a sum, so it is not a click-to-override price cell.
function aggregateCostTd(c, cls) { return '<td class="' + (cls || "silver-val cell-num") + '">' + (Number(c) > 0 ? c : "—") + '</td>'; }
function priceTd(p){ return "<td>"+p+"</td>"; }
function profitTd(mi){ return "<td>"+(mi&&mi.profit)+"</td>"; }
function pureProfitTd(mi){ return "<td>"+(mi&&mi.profit)+"</td>"; }
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
const mod = new Module("transmute-tierup-render");
mod._compile(
  stubs + sources + "\nmodule.exports = { renderTransmuteTable, captured };",
  "transmute-tierup-render.js",
);
const { renderTransmuteTable, captured } = mod.exports;

// One city only, so buy/sell city selection is forced and the arithmetic is
// exactly checkable.
const marketData = {
  // tier-up 5× T4 Relic (1,000 ea) → 1× T5 Relic
  T4_RELIC: { Caerleon: { buy: 1000, volume_24h: 50 } },
  T5_RELIC: { Caerleon: { sell: 9000, volume_24h: 50 } },
  // type-up 1× T4 Rune (300) → 1× T4 Soul, fee 723 (1:1 regression)
  T4_RUNE: { Caerleon: { buy: 300, volume_24h: 50 } },
  T4_SOUL: { Caerleon: { sell: 5000, volume_24h: 50 } },
};

renderTransmuteTable(marketData);
const rows = captured.rows.filter((r) => r.transition);
const rowFor = (sourceId, targetId) =>
  rows.find((r) => r.sourceId === sourceId && r.targetId === targetId);
const htmlFor = (row) => captured.html[captured.rows.indexOf(row)];

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name}\n    ${e.message}`); }
}

console.log("Transmute material tier-up render\n");

test("the per-row formatter never throws", () =>
  assert.ok(!captured.html.some((h) => h && h.includes("ERR:")), captured.html.join("\n")));

test("tier-up row renders at all (T4 Relic → T5 Relic)", () =>
  assert.ok(rowFor("T4_RELIC", "T5_RELIC"), "no T4_RELIC → T5_RELIC row"));

test("tier-up input cost = 5 × price × (1 + setup fee), no silver", () => {
  const r = rowFor("T4_RELIC", "T5_RELIC");
  assert.strictEqual(r.silverCost, 0);
  // 5 × 1000 × 1.025 = 5125
  assert.ok(Math.abs(r.totalInputCost - 5125) < 0.01, `totalInputCost=${r.totalInputCost}`);
});

test("tier-up profit is net of the 5× input (9000 × 0.96 − 5125)", () => {
  const r = rowFor("T4_RELIC", "T5_RELIC");
  assert.ok(Math.abs(r.marginInfo.profit - (9000 * 0.96 - 5125)) < 0.01,
    `profit=${r.marginInfo.profit}`);
});

test("tier-up source cell shows the 5× ratio and the PER-UNIT price", () => {
  const html = htmlFor(rowFor("T4_RELIC", "T5_RELIC"));
  assert.ok(/5×/.test(html), `no 5× ratio in source cell: ${html}`);
  assert.ok(html.includes("data-item-id='T4_RELIC'"), "missing source price span");
  assert.ok(html.includes("@ 1000"), `source cell should show per-unit 1000: ${html}`);
});

test("1:1 type-up row still costs 1 × price + silver (regression)", () => {
  const r = rowFor("T4_RUNE", "T4_SOUL");
  assert.ok(r, "no T4_RUNE → T4_SOUL row");
  // 300 × 1.025 + 723 = 1030.5
  assert.ok(Math.abs(r.totalInputCost - 1030.5) < 0.01, `totalInputCost=${r.totalInputCost}`);
});

test("1:1 source cell carries no ratio prefix (regression)", () => {
  const html = htmlFor(rowFor("T4_RUNE", "T4_SOUL"));
  assert.ok(!/5×/.test(html), `unexpected ratio prefix: ${html}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
