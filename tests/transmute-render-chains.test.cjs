/**
 * Test: renderTransmuteTable shows the BEST multi-step chain per end product.
 *
 * Several starts can reach one end product (7.0/7.1/7.2 → 7.4). The renderer
 * groups candidates by (axis | end product) and emits a single row for the
 * most profitable start. This drives the real renderer with synthetic prices
 * rigged so the 3-step chain 7.1→7.2→7.3→7.4 is cheapest (hence best margin),
 * and asserts:
 *   - exactly one chain row renders (not one per start),
 *   - it shows the winning path + summed fee + the chosen start (7.1),
 *   - the deeper (7.0) and shallower (7.2) starts are NOT shown.
 *
 * Black-box / TLD: real resource-names + data-transmute + render-transmute with
 * stubbed table helpers. No DOM, no live API.
 *
 * Run: node tests/transmute-render-chains.test.cjs
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
function getOrderType(){ return "buy"; }            // MIN_VOLUME = 0
function isBlackRedZoneEnabled(){ return true; }     // single section over CITIES
function isValidSourceCity(buyCity, craftCity) {
  if (!buyCity || !craftCity) return false;
  if (isBlackRedZoneEnabled()) return true;
  if (BLACK_ZONE_CITIES.includes(buyCity) || BLACK_ZONE_CITIES.includes(craftCity)) return false;
  return (buyCity === "Caerleon") === (craftCity === "Caerleon");
}
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
function priceTd(p, id, city, side, cls, showCity){ return "<td>"+p+(showCity && city ? " ("+city+")" : "")+"</td>"; }
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
const mod = new Module("transmute-render-chains");
mod._compile(stubs + sources + "\nmodule.exports = { renderTransmuteTable, captured };", "trc.js");
const { renderTransmuteTable, captured } = mod.exports;

// Only T7.4 logs is sell-priced, so only routes ending there render. Three
// enchant-chain starts are buy-priced (in Caerleon); costs are rigged so 7.1 is
// cheapest:
//   7.0→7.4 fees 269400, buy 5000  -> 274525
//   7.1→7.4 fees 264600, buy 1000  -> 265625  (winner)
//   7.2→7.4 fees 249480, buy 30000 -> 280230
// Tier- and mixed-chain starts (lower tier/enchant) are left unpriced so no
// tier/mixed chain competes for T7.4. The sell is in Martlock (≠ the Caerleon
// buy city) so the asserted "(Martlock)" can only come from the sell cell.
const marketData = {
  T7_WOOD:            { Caerleon: { buy: 5000,    volume_24h: 50 } }, // 7.0
  "T7_WOOD_LEVEL1@1": { Caerleon: { buy: 1000,    volume_24h: 50 } }, // 7.1
  "T7_WOOD_LEVEL2@2": { Caerleon: { buy: 30000,   volume_24h: 50 } }, // 7.2
  "T7_WOOD_LEVEL4@4": { Martlock: { sell: 2000000, volume_24h: 50 } }, // 7.4 (sell)
};

renderTransmuteTable(marketData);
const rendered = captured.html.filter((h) => h && h.includes("<tr"));
const html = rendered.join("\n");
const s1Rows = captured.rows.filter((r) => r.transition);   // priced rows, scenario 1

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name}\n    ${e.message}`); }
}

console.log("Transmute render — best chain per product\n");

// A chain row's label is all coords ("7.1 → 7.2 → … → 7.4 logs"); a single-step
// label has the word on both sides ("7.3 logs → 7.4 logs"). Distinguish by the
// "logs →" / "ore →" marker, which only single-steps contain.
const isChainLabel = (lbl) => / → /.test(lbl) && !/(logs|ore) →/.test(lbl);

test("no formatter errors", () =>
  assert.ok(!captured.html.some((h) => h && h.includes("ERR:"))));

test("best-per-group: only the cheapest enchant-chain start (7.1) reaches 7.4", () => {
  const chainsTo74 = s1Rows.filter((r) => isChainLabel(r.transition.label) && r.transition.label.endsWith("7.4 logs"));
  assert.strictEqual(chainsTo74.length, 1,
    `expected 1 chain row to 7.4, got ${chainsTo74.length}: ${chainsTo74.map((r) => r.transition.label)}`);
  assert.strictEqual(chainsTo74[0].transition.label, "7.1 → 7.2 → 7.3 → 7.4 logs");
  assert.ok(/silver-val"[^>]*>264600</.test(html), "missing summed 264600 fee");
});

test("the chosen chain start is 7.1 (cheapest), not 7.0 or 7.2", () => {
  assert.ok(html.includes("data-item-id='T7_WOOD_LEVEL1@1'"), "start should be 7.1");
  assert.ok(!html.includes("data-item-id='T7_WOOD'"), "7.0 start must not win");
  assert.ok(!html.includes("data-item-id='T7_WOOD_LEVEL2@2'"), "7.2 start must not win");
});

test("the Sell Price cell shows WHERE to sell (the sell city)", () =>
  assert.ok(html.includes("(Martlock)"), "sell cell should tag the sell city"));

// ── Scenario 2: a MIXED tier+enchant chain, produced single-steps hidden ──
// Only T5.0 ore (buy, Caerleon) and T6.1 ore (sell, Martlock) are priced. Every
// intermediate is cheaper to PRODUCE from the cheap 5.0 than to buy, so the only
// real buy → sell route to 6.1 is the mixed chain 5 → 6 → 6.1 (bought 5.0); the
// produced-source single-steps (e.g. 6 → 6.1, made from 5.0) are HIDDEN.
const mixedData = {
  T5_ORE:            { Caerleon: { buy: 4000,   volume_24h: 50 } }, // 5.0
  "T6_ORE_LEVEL1@1": { Martlock: { sell: 500000, volume_24h: 50 } }, // 6.1 (sell)
};
renderTransmuteTable(mixedData);
const mixedRows = captured.rows.filter((r) => r.transition);
const mixedHtml = captured.html.filter((h) => h && h.includes("<tr")).join("\n");

test("no formatter errors (mixed scenario)", () =>
  assert.ok(!captured.html.some((h) => h && h.includes("ERR:"))));
test("the mixed tier+enchant chain renders with the combined-axis label", () =>
  assert.ok(mixedRows.some((r) => r.transition.label === "5 → 6 → 6.1 ore"), "missing mixed path label"));
test("produced-source rows are hidden — single-step 6→6.1 (6.0 produced from 5.0) does NOT render", () => {
  assert.ok(!mixedRows.some((r) => r.transition.label === "6 ore → 6.1 ore"),
    "single-step 6→6.1 must be hidden: its 6.0 source is produced, not bought");
  assert.ok(!mixedRows.some((r) => r.sourceProduced), "no rendered row may have a produced source");
});
test("the surviving 6.1 route is a buy → sell chain from the bought 5.0 base", () => {
  const r = mixedRows.find((x) => x.transition.label === "5 → 6 → 6.1 ore");
  assert.ok(r, "mixed chain 5 → 6 → 6.1 should render");
  assert.ok(!r.sourceProduced, "its 5.0 source must be a real market buy");
  assert.strictEqual(r.sourceId, "T5_ORE", "source is 5.0 ore");
  assert.strictEqual(r.buyCity, "Caerleon", "bought at Caerleon");
  assert.ok(mixedHtml.includes("(Caerleon)"), "source cell shows the buy city");
});
test("the mixed row's sell cell shows the sell city", () =>
  assert.ok(mixedHtml.includes("(Martlock)"), "missing sell city on mixed row"));

// ── Scenario 3: HEADLINE FIX — a produced-source single step is HIDDEN; the
// route to 8.4 surfaces as a real buy → sell CHAIN from the cheap 8.1 base.
// 8.1 cheap, 8.3 expensive at market, 8.4 sells. Buying 8.1 and transmuting up
// beats buying the intermediate 8.3, so "8.3 → 8.4" (8.3 produced) is dropped and
// "8.1 → 8.2 → 8.3 → 8.4" is shown with the same full-chain input (≈991,998),
// not the inflated buy-8.3-at-market input (≈1,009,229).
const headlineData = {
  "T8_WOOD_LEVEL1@1": { Thetford: { buy: 12205,   volume_24h: 99 } }, // 8.1 cheap
  "T8_WOOD_LEVEL3@3": { Thetford: { buy: 219306,  volume_24h: 99 } }, // 8.3 expensive
  "T8_WOOD_LEVEL4@4": { Martlock: { sell: 1299997, volume_24h: 99 } }, // 8.4 sell
};
renderTransmuteTable(headlineData);
const headlineRows = captured.rows.filter((r) => r.transition);
const r83 = headlineRows.find((r) => r.transition.label === "8.3 logs → 8.4 logs");
const chain81 = headlineRows.find((r) => r.transition.label === "8.1 → 8.2 → 8.3 → 8.4 logs");

test("the produced 8.3→8.4 single-step is hidden (8.3 is cheaper to produce than buy)", () => {
  assert.ok(!r83, "8.3→8.4 must NOT render — its 8.3 source is produced, not bought");
  assert.ok(!headlineRows.some((r) => r.sourceProduced), "no rendered row may have a produced source");
});

test("the 8.4 route is shown as a buy → sell chain from the bought 8.1 base, same full-chain input", () => {
  assert.ok(chain81, "chain 8.1 → 8.2 → 8.3 → 8.4 should render");
  assert.ok(!chain81.sourceProduced, "its 8.1 source must be a real market buy");
  assert.strictEqual(chain81.sourceId, "T8_WOOD_LEVEL1@1", "source is 8.1");
  assert.strictEqual(chain81.buyCity, "Thetford", "bought at Thetford");
  // input ≈ 12205*1.025 + 45360 + 149688 + 784440 ≈ 991,998 (full chain),
  // NOT 219306*1.025 + 784440 ≈ 1,009,229 (buying 8.3 at market).
  assert.ok(Math.abs(chain81.totalInputCost - 991998) < 2,
    `expected full-chain input ≈991,998, got ${chain81.totalInputCost}`);
  assert.ok(chain81.totalInputCost < 1000000, "must be below the buy-8.3-at-market input (1,009,229)");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
