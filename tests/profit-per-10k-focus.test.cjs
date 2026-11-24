/**
 * "Profit / 10k Focus" column.
 *
 * Replaces "Profit/Ox" in the Refining/Transports table and is added to the
 * Crafting, Consumables and Mounts tables. The number answers "if I dump a full
 * 10,000 focus bar into this row, how much silver do I make?" — profit per
 * craft/refine × how many WHOLE crafts 10k focus buys (leftover focus is idle).
 *
 * Part 1 — black-box parameterized cases for calculateProfitPer10kFocus.
 * Part 2 — index.html header wiring (column present/absent per table).
 * Part 3 — renderTransportTable renders the cell, and the row keeps the same
 *          number of <td>s as the table has <th>s.
 *
 * Run: node tests/profit-per-10k-focus.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

// Row text runs through tx(english, slug); en-mode identity keeps assertions in English.
globalThis.tx = globalThis.tx || ((en) => en);

const { calculateProfitPer10kFocus, focusBarCrafts, FOCUS_BAR } = require("../js/calculations.js");
const { readIndexHtml } = require("./helpers/page-source.cjs");

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); console.log(`  PASS: ${name}`); passed++; } catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; } }

console.log("Profit / 10k Focus\n");

// ---------------------------------------------------------------- part 1
assert.strictEqual(FOCUS_BAR, 10000);

const cases = [
  // [name, profitPerCraft, focusCostPerCraft, expected]
  ["screenshot case: 9,510 profit @ 31 focus → 322 refines", 9510, 31, 9510 * 322],
  ["exact divisor: no focus wasted", 100, 100, 100 * 100],
  ["partial craft dropped (10000/3 = 3333.33)", 6, 3, 6 * 3333],
  // A craft that costs more than a whole bar used to floor to 0 crafts, so the
  // column read 0 on every T8 artifact craft (Elder's Great Frost Staff needs
  // ~13,066 focus). Above the bar the bar buys a FRACTION of one craft.
  ["focus cost above the bar → a fraction of one craft", 5000, 10001, 5000 * (10000 / 10001)],
  ["screenshot case: 13,066 focus/craft → 0.765 of a craft", 264808, 13066, 264808 * (10000 / 13066)],
  ["focus cost equal to the bar → exactly one craft", 5000, 10000, 5000],
  ["just above half the bar still floors to one whole craft", 5000, 5001, 5000],
  ["negative profit above the bar scales the loss by the fraction", -300, 20000, -300 * 0.5],
  ["negative profit scales the loss, not the gain", -250, 500, -250 * 20],
  ["zero profit stays zero", 0, 31, 0],
  ["fractional focus cost (enchanted rock, per-output basis)", 1000, 12.5, 1000 * 800],
  // getFocusCost used to round the spec-reduced cost to an integer: T4 Avalonian
  // Goat Stew is 58 × 0.0221 = 1.2816 focus/unit, and round()→1 turned 7,802
  // crafts into a flat 10,000 — the column read 135.3M instead of 105.5M.
  ["max-spec cooking fraction is not rounded to 1", 13527, 1.2816, 13527 * 7802],
  ["zero focus cost → 0 (not Infinity/NaN)", 9510, 0, 0],
  ["null focus cost → 0", 9510, null, 0],
  ["undefined focus cost → 0", 9510, undefined, 0],
  ["negative focus cost → 0", 9510, -5, 0],
];

for (const [name, profit, focusCost, expected] of cases) {
  test(`calc: ${name}`, () => {
    assert.strictEqual(calculateProfitPer10kFocus(profit, focusCost), expected);
  });
}

test("calc: a sub-2 fractional cost never buys a whole 10,000 crafts", () => {
  const profit = 13527, focusCost = 1.2816;
  assert.notStrictEqual(calculateProfitPer10kFocus(profit, focusCost), profit * 10000);
  assert.ok(calculateProfitPer10kFocus(profit, focusCost) < profit * 10000);
});

test("calc: equals profitPerFocus × focus actually spent (no rounding drift)", () => {
  const profit = 9510, focusCost = 31;
  const crafts = Math.floor(10000 / focusCost);
  const perFocus = profit / focusCost;
  assert.strictEqual(
    calculateProfitPer10kFocus(profit, focusCost),
    perFocus * focusCost * crafts,
  );
});

// focusBarCrafts — how many crafts one bar buys. Whole crafts while a craft fits
// inside the bar (leftover focus buys nothing), a fraction once it does not.
[
  ["cheap craft floors", 31, 322],
  ["exact divisor", 100, 100],
  ["half the bar plus one → one whole craft", 5001, 1],
  ["exactly the bar → one craft", 10000, 1],
  ["just above the bar → fraction", 10001, 10000 / 10001],
  ["T8 artifact craft → fraction", 13066, 10000 / 13066],
  ["twice the bar → half a craft", 20000, 0.5],
  ["fractional sub-1 focus still floors", 1.2816, 7802],
  ["zero → 0", 0, 0],
  ["negative → 0", -5, 0],
  ["null → 0", null, 0],
  ["undefined → 0", undefined, 0],
  ["NaN → 0", NaN, 0],
].forEach(([name, focusCost, expected]) => {
  test(`focusBarCrafts: ${name}`, () => {
    assert.strictEqual(focusBarCrafts(focusCost), expected);
  });
});

test("calc: a fractional bar still divides by actionsPerOutput", () => {
  assert.strictEqual(calculateProfitPer10kFocus(100, 20000, 2), 100 * (0.5 / 2));
});

test("calc: the figure is continuous across the bar boundary", () => {
  const at = calculateProfitPer10kFocus(1000, 10000);
  const above = calculateProfitPer10kFocus(1000, 10000.001);
  assert.ok(Math.abs(at - above) < 0.01, `${at} vs ${above}`);
});

// ---------------------------------------------------------------- part 2
const html =readIndexHtml();

function theadOf(tableId) {
  const m = html.match(new RegExp(`<table id="${tableId}"[\\s\\S]*?</thead>`));
  assert.ok(m, `thead for #${tableId} not found`);
  return m[0];
}
const countHeaders = (thead) => (thead.match(/<th\b/g) || []).length;
const has = (thead, sortKey) => thead.includes(`data-sort="${sortKey}"`);

for (const tableId of ["crafting-table", "transport-table", "consumable-table", "mounts-table"]) {
  test(`html: #${tableId} has a sortable Profit / 10k Focus header`, () => {
    const thead = theadOf(tableId);
    assert.ok(has(thead, "profitPer10kFocus"), "profitPer10kFocus header missing");
    assert.strictEqual(
      (thead.match(/data-sort="profitPer10kFocus"/g) || []).length, 1,
      "header must appear exactly once",
    );
    assert.ok(/data-sort="profitPer10kFocus"[^>]*class="sortable"/.test(thead), "header must be sortable");
  });
}

test("html: transport table dropped Profit/Ox in favour of the focus column", () => {
  const thead = theadOf("transport-table");
  assert.ok(!has(thead, "profitPerLoad"), "Profit/Ox must be gone from the refining table");
});

test("html: flipping table keeps Profit/Ox (no focus is spent flipping)", () => {
  const thead = theadOf("flipping-table");
  assert.ok(has(thead, "profitPerLoad"), "Profit/Ox must survive in the flipping table");
  assert.ok(!has(thead, "profitPer10kFocus"), "flipping rows have no focus cost");
});

test("html: the focus column follows the profit column", () => {
  // The Crafting table sits its "Profit + Laborer Journal" column (pure profit
  // plus the journal this craft fills, worked by your own laborer) between the
  // two, so the focus column comes one further along there.
  for (const [tableId, profitKey, between] of [
    ["crafting-table", "profit", ["profitWithLaborer"]],
    ["transport-table", "profit", []],
    ["consumable-table", "profit", []],
    ["mounts-table", "profit", []],
  ]) {
    const thead = theadOf(tableId);
    const order = [...thead.matchAll(/data-sort="([^"]+)"/g)].map((m) => m[1]);
    const i = order.indexOf(profitKey);
    assert.deepStrictEqual(
      order.slice(i + 1, i + 2 + between.length),
      [...between, "profitPer10kFocus"],
      `${tableId}: wrong column position`,
    );
  }
});

// ---------------------------------------------------------------- part 2b
// The figure ALREADY nets out mat costs: profit per play = revenue − mats −
// fees, so the "Mats to Buy (10k Focus)" list is exactly the mat component
// inside the figure, not an extra charge. That was misread as revenue-side and
// a "subtract the list again" change was requested — which would double-count.
// The wording now says so, and these tests keep it said.
//
// Deliberately absent: r_pg10k_refine_tip (raws cost 0 — its tooltip already
// states that) and the FP-inputs header (the FP-bought item itself costs 0).
const PER10K_HEADER_KEYS = [
  "profit_per_play_the_plays_one_10_000_focus_b", // joined-summary board
  "total_profit_from_spending_a_full_10_000_foc", // crafting
  "cp_profit_10k_focus_tip",                      // crafting planner
  "total_profit_from_spending_a_full_10_000_foc_2", // refining/transports
  "total_profit_from_spending_a_full_10_000_foc_3", // consumables
  "profit_per_harvest_cycle_the_whole_cycles_a_", // farming (seed costs)
  "total_profit_from_spending_a_full_10_000_foc_4", // mounts
];
const PER10K_TIP_SITES = [
  ["js/render-crafting.js", "r_p10k_craft_tip"],
  ["js/render-consumables-row.js", "r_p10k_craft_tip"],
  ["js/render-consumables-row.js", "r_p10k_unit_tip"],
  ["js/render-craft-planner.js", "r_p10k_craft_tip"],
  ["js/render-transport.js", "r_p10k_refine_tip"],
  ["js/render-consumable-chain-row.js", "r_p10k_batch_tip"],
  ["js/render-mounts-breeding-row.js", "r_p10k_breed_tip"],
  ["js/render-mounts-craft-row.js", "r_p10k_craft_tip"],
  ["js/render-farming.js", "r_p10k_farming_tip"],
];

test("i18n: every Profit / 10k Focus header title states the figure is after mat (or seed) costs", () => {
  const enDict = fs.readFileSync(path.join(__dirname, "..", "js", "i18n-strings-en.js"), "utf8");
  PER10K_HEADER_KEYS.forEach((key) => {
    const m = enDict.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, "m"));
    assert.ok(m, `UI_STRINGS_EN entry for ${key} not found`);
    assert.ok(/after (mat|seed) costs/.test(m[1]),
      `${key}: header title must state the figure is after mat/seed costs`);
  });
});

test("html: the inline per-10k title attributes carry the same net-of-mats wording", () => {
  PER10K_HEADER_KEYS.forEach((key) => {
    const th = html.match(new RegExp(`<th[^>]*data-i18n-title="${key}"[^>]*>`));
    assert.ok(th, `th with data-i18n-title="${key}" not found`);
    assert.ok(/after (mat|seed) costs/.test(th[0]),
      `${key}: inline title attribute must state the figure is after mat/seed costs`);
  });
});

test("renderers: every per-10k cell tooltip states the figure is after mat (or seed) costs", () => {
  PER10K_TIP_SITES.forEach(([file, slug]) => {
    const src = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    const m = src.match(new RegExp(`tx\\("([^"]+)",\\s*"${slug}"\\)`));
    assert.ok(m, `${file}: tx(..., "${slug}") not found`);
    assert.ok(/after (mat|seed) costs/.test(m[1]),
      `${file}: "${slug}" tooltip must state the figure is after mat/seed costs`);
  });
});

// ---------------------------------------------------------------- part 3
const sandbox = `
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SETUP_FEE = 0.025;
const PREMIUM_TAX = 0.065;
const BASE_CITY_BONUS = 0.18;
const REFINE_SPEC_BONUS = 0.40;
const FOCUS_BONUS = 0.59;
const OX_CAPACITY_KG = 1500;
const FOCUS_PER_REFINE = 31;
const CITY_REFINE_SPEC = { "Fort Sterling": "wood", Lymhurst: "fiber", Bridgewatch: "rock", Thetford: "ore", Martlock: "hide" };
const RESOURCE_DEFS = [
  { type: "wood", raw: "WOOD", refined: "PLANKS", tiers: [[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
];
const TRANSPORT_ITEMS = [{
  mat: "Whitewood Logs [T8]", rawId: "T8_WOOD", refinedId: "T8_PLANKS",
  rawRatio: 5, resourceType: "wood", secondaryMatId: "T7_PLANKS", secondaryMatCount: 1,
}];

function isBlackRedZoneEnabled() { return false; }
function isValidSourceCity(buyCity, craftCity) {
  if (!buyCity || !craftCity) return false;
  if (isBlackRedZoneEnabled()) return true;
  if (BLACK_ZONE_CITIES.includes(buyCity) || BLACK_ZONE_CITIES.includes(craftCity)) return false;
  return (buyCity === "Caerleon") === (craftCity === "Caerleon");
}
function isFocusEnabled() { return globalThis.__TEST_FOCUS__ === true; }
function getOrderType() { return "market"; }
function getOverridePrice() { return null; }
function getOverrideVolume() { return null; }
function getCityForce() { return null; }
function isInvalidCrossRoute() { return false; }
function getIQRBounds() { return { upper: Infinity }; }
function getBuyPrice(itemData, city) { return (itemData && itemData[city] && itemData[city].buy_price) || 0; }
function getSellPrice(itemData, city) { return (itemData && itemData[city] && itemData[city].sell_price) || 0; }
function calcRRR(b) { return b <= 0 ? 0 : b / (1 + b); }
function getRefineRRR(city, t, f) { let b = BASE_CITY_BONUS; if (CITY_REFINE_SPEC[city]===t) b+=REFINE_SPEC_BONUS; if (f) b+=FOCUS_BONUS; return calcRRR(b); }
function getFocusCost() { return FOCUS_PER_REFINE; }
function calcStationFeeSilver() { return 0; }
function refineStationFeeSilver() { return 0; }
function getTierFromId(id) { const m = id.match(/T(\\d+)/); return m ? parseInt(m[1],10) : 0; }
function getResourceWeightKg(tier) { return 0.1 * Math.pow(1.5, tier); }
function getMinVol() { return 0; }
function getMinVol2() { return 0; }
function matsNeededFor10kFocus(focusCost, per, applyRrr, rrr) { const c = Math.floor(10000/focusCost); const e = applyRrr ? per*(1-(rrr||0)) : per; return Math.round(c*e); }
function calculateTransportMargin(buyCost, sellPrice, rrr=0, sec=0, station=0, travel=0, nonRet=0) {
  if (!buyCost || !sellPrice) return { profit: 0, margin: 0 };
  const eff = ((buyCost + sec) * (1 - rrr) + nonRet) * (1 + SETUP_FEE) + station + travel;
  const rev = sellPrice * (1 - PREMIUM_TAX);
  return { profit: rev - eff, margin: (rev - eff) / eff * 100 };
}
function calculateOxLoad(profit, weight) { if (!weight || weight <= 0) return { itemsPerLoad: 0, profitPerLoad: 0 }; const n = Math.floor(OX_CAPACITY_KG/weight); return { itemsPerLoad: n, profitPerLoad: profit * n }; }
function calculateProfitPer10kFocus(profit, focusCost) { if (!focusCost || focusCost <= 0) return 0; return profit * Math.floor(10000 / focusCost); }
function calculateProfitPerFocus(p, f) { if (!f || f <= 0) return 0; return p / f; }
function formatSilver(n) { if (n === null || n === undefined) return "N/A"; return Math.round(n).toLocaleString(); }
function formatFocusCost(n) { if (n == null || !Number.isFinite(n)) return "N/A"; const a = Math.abs(n); if (a >= 100) return Math.round(n).toLocaleString(); return String(Number(n.toFixed(a >= 10 ? 1 : 2))); }
function getItemDisplayName(id) { return id; }
function matPriceSpan(id, city, price) { return "<span class='mat'>@ "+(price>0?price:"no data")+" ea</span>"; }
function resourceAliasSpan() { return ""; }
// Read-only aggregate cost cell (js/app.js aggregateCostTd) — the Input Cost
// column is a sum, so it is not a click-to-override price cell.
function aggregateCostTd(c, cls) { return '<td class="' + (cls || "silver-val cell-num") + '">' + (Number(c) > 0 ? c : "—") + '</td>'; }
function priceTd(p) { return "<td class='price'>"+(p>0?p:"no data")+"</td>"; }
function profitTd(mi) { return "<td class='PROFITPCT'>"+mi.margin.toFixed(2)+"%</td>"; }
function pureProfitTd(mi) { const pr = mi && mi.profit; if (pr===undefined||pr===null) return "<td class='PUREPROFIT'>dash</td>"; return "<td class='PUREPROFIT'>"+pr+"</td>"; }
function volTd(v) { return "<td class='vol'>"+v+"</td>"; }
// The "+" column cell (js/table-add-button.js) — every row template emits it.
function addTdForKey(){ return '<td class="cell-add"></td>'; }
function getRowKey(row) { return row.route.refinedId + "|" + (row.section || ""); }
function findBestBuyCity(marketData, itemId, cities) { let best = { city: null, price: 0 }; for (const c of cities) { const p = getBuyPrice(marketData[itemId], c); if (p > best.price) best = { city: c, price: p }; } if (!best.city) best = { city: cities[0] || null, price: 0 }; return best; }
function findBestSellCity(marketData, itemId, cities) { let best = { city: null, price: 0 }; for (const c of cities) { const p = getSellPrice(marketData[itemId], c); if (p > best.price) best = { city: c, price: p }; } if (!best.city) best = { city: cities[0] || null, price: 0 }; return best; }
function renderChainBreakdown() { return ""; }
const captured = { rows: [], html: [] };
function renderTableData(id, rows, fmt) { captured.tableId = id; captured.rows = rows; captured.html = rows.map((r,i) => { try { return fmt(r,i); } catch(e){ return "ERR:"+e.message; } }); }
`;

function loadFile(rel) { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); }
const mod = new Module("profit-per-10k-focus-test");
mod._compile(
  sandbox +
    loadFile("js/route-cell.js") +
    loadFile("js/refining-chain-recipes.js") +
    loadFile("js/refining-chain-pricing.js") +
    loadFile("js/focus-play.js") + loadFile("js/refining-route.js") + loadFile("js/render-transport.js") +
    "\nmodule.exports = { renderTransportTable, captured };",
  "render-transport.js",
);
const { renderTransportTable, captured } = mod.exports;

const fullMarket = {
  T8_WOOD: { "Fort Sterling": { buy_price: 1500, sell_price: 1600, volume_24h: 9999 } },
  T7_PLANKS: { "Fort Sterling": { buy_price: 3000, sell_price: 3100, volume_24h: 9999 } },
  T8_PLANKS: { "Fort Sterling": { buy_price: 1, sell_price: 1200000, volume_24h: 9999 } },
};

// The figure multiplies the FOCUS-ON profit (row.profitFocusOn), not the
// checkbox-dependent Pure Profit: a 10,000-focus bar is focus-on play by
// definition, so the column is a benchmark. See
// tests/refining-per10k-focus-toggle.test.cjs.
test("render: priced refining row carries focus-ON profit × whole refines per 10k focus", () => {
  renderTransportTable(fullMarket);
  const row = captured.rows.find((r) => r.refineCity === "Fort Sterling");
  assert.ok(row, "Fort Sterling (wood spec) row should exist");
  const refines = Math.floor(10000 / row.focusCost);
  assert.strictEqual(row.profitPer10kFocus, row.profitFocusOn * refines);
  const cellHtml = captured.html[captured.rows.indexOf(row)];
  assert.ok(cellHtml.includes(formatSilverLocal(row.profitPer10kFocus)),
    "rendered row must print the 10k-focus profit");
  assert.ok(!cellHtml.includes("ERR:"), "row template must not throw");
});
function formatSilverLocal(n) { return Math.round(n).toLocaleString(); }

test("render: the 10k-focus columns do not move when Use Focus is toggled", () => {
  const key = (r) => r.route.refinedId + "|" + r.refineCity;
  globalThis.__TEST_FOCUS__ = true;
  renderTransportTable(fullMarket);
  const on = new Map(captured.rows.map((r) => [key(r), r]));
  globalThis.__TEST_FOCUS__ = false;
  renderTransportTable(fullMarket);
  const off = captured.rows;
  let compared = 0, profitMoved = 0;
  off.forEach((r) => {
    const a = on.get(key(r));
    if (!a || a.profitPer10kFocus == null || r.profitPer10kFocus == null) return;
    compared++;
    if (Math.abs((a.marginInfo.profit || 0) - (r.marginInfo.profit || 0)) > 1e-6) profitMoved++;
    assert.ok(Math.abs(a.profitPer10kFocus - r.profitPer10kFocus) < 1e-6,
      `${key(r)}: Profit / 10k Focus moved with the checkbox (${a.profitPer10kFocus} → ${r.profitPer10kFocus})`);
    assert.ok(Math.abs(a.profitGatheredPer10kFocus - r.profitGatheredPer10kFocus) < 1e-6,
      `${key(r)}: Profit Gathered / 10k Focus moved with the checkbox`);
  });
  assert.ok(compared > 0, "fixture produced no priced rows to compare");
  assert.ok(profitMoved > 0, "fixture sanity: Pure Profit must react to the checkbox");
  globalThis.__TEST_FOCUS__ = false;
});

test("render: unpriced refining row shows the n/a dash, never a number", () => {
  renderTransportTable({
    T7_PLANKS: { "Fort Sterling": { buy_price: 949999, sell_price: 950500, volume_24h: 9999 } },
    T8_PLANKS: { "Fort Sterling": { buy_price: 1, sell_price: 1200000, volume_24h: 9999 } },
  });
  for (const row of captured.rows) {
    assert.strictEqual(row.profitPer10kFocus, null,
      `n/a route ${row.route.refinedId} must not report a 10k-focus profit`);
  }
});

test("render: every transport row emits one <td> per <th> in the header", () => {
  renderTransportTable(fullMarket);
  const expected = countHeaders(theadOf("transport-table"));
  for (const rowHtml of captured.html) {
    const tds = (rowHtml.match(/<td\b/g) || []).length;
    assert.strictEqual(tds, expected, `row has ${tds} cells, header declares ${expected}`);
  }
});

test("render: the ox-load column is gone from the rendered row", () => {
  renderTransportTable(fullMarket);
  const row = captured.rows.find((r) => r.refineCity === "Fort Sterling");
  const rowHtml = captured.html[captured.rows.indexOf(row)];
  const oxSilver = formatSilverLocal(row.oxLoad.profitPerLoad);
  assert.ok(!rowHtml.includes(oxSilver) || oxSilver === formatSilverLocal(row.profitPer10kFocus),
    "profit-per-ox-load silver must no longer be printed");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
