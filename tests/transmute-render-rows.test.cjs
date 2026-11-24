/**
 * Test: renderTransmuteTable emits rows for BOTH material and resource recipes.
 *
 * Resource transmutes (tier-up + enchant-up of Wood/Ore/Fiber/Hide/Stone) share
 * the renderer with the legacy Rune→Soul→Relic→Shard rows. The renderer was
 * generalized from a same-tier from/to assumption to an arbitrary
 * sourceId/targetId recipe feed (getTransmuteRecipes). This guards that:
 *   - a resource tier-up row renders with the generic "<src> → <tgt>" label,
 *     its source name, and its in-game silver fee;
 *   - a resource enchant-up row renders likewise;
 *   - the material rows still render (regression);
 *   - the per-row formatter never throws for any produced row.
 *
 * Black-box / TLD: load the real resource-names + data-transmute + render-transmute
 * with stubbed table helpers and synthetic marketData. No DOM, no live API.
 *
 * Run: node tests/transmute-render-rows.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");
// Cell text runs through tx(english, slug); en-mode identity keeps assertions in English.
globalThis.tx = globalThis.tx || ((en) => en);

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

// Minimal stand-ins for the table/pricing helpers the renderer calls. getBuyPrice
// reads `.buy`, getSellPrice reads `.sell` from marketData[id][city]; everything
// else is inert so the focus stays on which rows the renderer produces.
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

const mod = new Module("transmute-render");
mod._compile(
  stubs + sources + "\nmodule.exports = { renderTransmuteTable, captured };",
  "transmute-render.js",
);
const { renderTransmuteTable, captured } = mod.exports;

// Synthetic prices: cheap source, rich target → a profitable, renderable row.
const marketData = {
  // resource tier-up T4 ore → T5 ore (fee 781)
  T4_ORE: { Caerleon: { buy: 100, volume_24h: 50 } },
  T5_ORE: { Caerleon: { sell: 2000, volume_24h: 50 } },
  // resource enchant-up T6 logs → T6.1 logs (fee 3000)
  T6_WOOD: { Caerleon: { buy: 500, volume_24h: 50 } },
  "T6_WOOD_LEVEL1@1": { Caerleon: { sell: 9000, volume_24h: 50 } },
  // material T4 Rune → T4 Soul (fee 723)
  T4_RUNE: { Caerleon: { buy: 300, volume_24h: 50 } },
  T4_SOUL: { Caerleon: { sell: 5000, volume_24h: 50 } },
};

renderTransmuteTable(marketData);
const html = captured.html.join("\n");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name}\n    ${e.message}`); }
}

console.log("Transmute render rows\n");

test("the per-row formatter never throws", () =>
  assert.ok(!html.includes("ERR:"), html));

test("resource tier-up row renders (label + source name + 781 fee)", () => {
  assert.ok(html.includes("T4 ore → T5 ore"), "missing tier-up label");
  assert.ok(/silver-val"[^>]*>781</.test(html), "missing 781 silver fee");
  assert.ok(html.includes("data-item-id='T4_ORE'"), "missing source price span");
});

test("resource enchant-up row renders (label + 3000 fee)", () => {
  assert.ok(html.includes("T6 logs → T6.1 logs"), "missing enchant-up label");
  assert.ok(/silver-val"[^>]*>3000</.test(html), "missing 3000 silver fee");
});

test("material Rune→Soul row still renders (regression, 723 fee)", () => {
  assert.ok(html.includes("Rune → Soul"), "missing material label");
  assert.ok(/silver-val"[^>]*>723</.test(html), "missing 723 silver fee");
});

test("renders at least the 3 seeded rows", () => {
  const real = captured.html.filter((h) => h && !h.includes("ERR:") && h.includes("<tr"));
  assert.ok(real.length >= 3, `only ${real.length} rows rendered`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
