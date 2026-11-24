/**
 * Test: "Show All" reveals EVERY chain start, not just the best one per product.
 *
 * Normally the renderer collapses each (axis | end product) chain group to its
 * single most profitable start, so a stone table shows only 4 single steps + 3
 * chain rows (one per end product) — the 4→…→7, 4→…→8, 5→…→8 routes never
 * appear, even with "Show All" checked, because they are dropped at BUILD time
 * (before the sorting.js display filter can put them back).
 *
 * With the checkbox on, every priced, market-bought candidate must render.
 * Produced-source rows stay hidden in both modes (they are not buy → sell
 * routes, so their price cell would show a produced cost as a market price).
 *
 * Black-box: real resource-names + data-transmute + render-transmute, stubbed
 * table helpers and a fake `document` for the checkbox. No DOM, no live API.
 *
 * Run: node tests/transmute-show-all-chains.test.cjs
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
const SELL_CITIES = [...CITIES, "Black Market"];
const SETUP_FEE = 0.025, PREMIUM_TAX = 0.04, MAX_MARGIN_PERCENT = 100000;
let __showAll = false;
function setShowAll(v){ __showAll = v; }
const document = {
  getElementById: (id) => (id === "show-all-items" ? { checked: __showAll } : null),
};
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
function getItemDisplayName(id){ const s = resourceShortName(id); return s || id; }
function matPriceSpan(id, city, price){ return "<span data-item-id='"+id+"'>@ "+price+"</span>"; }
function resourceAliasSpan(){ return ""; }
// Read-only aggregate cost cell (js/app.js aggregateCostTd) — the Input Cost
// column is a sum, so it is not a click-to-override price cell.
function aggregateCostTd(c, cls) { return '<td class="' + (cls || "silver-val cell-num") + '">' + (Number(c) > 0 ? c : "—") + '</td>'; }
function priceTd(p, id, city, side, cls, showCity){ return "<td>"+p+(showCity && city ? " ("+city+")" : "")+"</td>"; }
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
const mod = new Module("transmute-show-all-chains");
mod._compile(
  stubs + sources + "\nmodule.exports = { renderTransmuteTable, captured, setShowAll };",
  "tsac.js",
);
const { renderTransmuteTable, captured, setShowAll } = mod.exports;

// Stone ladder priced like the live market screenshot: every raw rock tier is
// buyable (so no start is "produced"), T8 rock sells. Chain groups to T8 have
// three candidates (4→…→8, 5→…→8, 6→7→8), to T7 two, to T6 one.
const stoneData = {
  T4_ROCK: { Lymhurst: { buy: 4, volume_24h: 999 } },
  T5_ROCK: {
    Brecilien: { buy: 53, volume_24h: 999 },
    Martlock: { sell: 78, volume_24h: 999 },
  },
  T6_ROCK: {
    Brecilien: { buy: 270, volume_24h: 999 },
    Bridgewatch: { sell: 588, volume_24h: 999 },
  },
  T7_ROCK: {
    "Fort Sterling": { buy: 1664, volume_24h: 999 },
    Thetford: { sell: 2963, volume_24h: 999 },
  },
  T8_ROCK: { Martlock: { buy: 17800, sell: 17900, volume_24h: 999 } },
};

const stoneRows = (showAll) => {
  setShowAll(showAll);
  renderTransmuteTable(stoneData);
  return {
    rows: captured.rows.filter((r) => r.transition && /rock/.test(r.transition.label)),
    html: captured.html.filter((h) => h && h.includes("<tr")).join("\n"),
    errors: captured.html.filter((h) => h && h.includes("ERR:")),
  };
};

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name}\n    ${e.message}`); }
}

console.log("Transmute — Show All reveals every chain start\n");

const labels = (rows) => rows.map((r) => r.transition.label);
// Chain labels are pure coords ("4 → 5 → 6 rock"); single steps carry the word
// on both sides ("T5 rock → T6 rock"), so "rock →" only matches single steps.
const chainsTo = (rows, endCoord) =>
  labels(rows).filter((l) => / → /.test(l) && !/rock →/.test(l) && l.endsWith(`${endCoord} rock`));

// ── Show All OFF: current curated behaviour (must not regress) ──
{
  const off = stoneRows(false);
  test("no formatter errors (Show All off)", () => assert.deepStrictEqual(off.errors, []));

  test("off: one chain row per end product (T6, T7, T8)", () => {
    assert.deepStrictEqual(chainsTo(off.rows, 6), ["4 → 5 → 6 rock"]);
    assert.strictEqual(chainsTo(off.rows, 7).length, 1, `got ${chainsTo(off.rows, 7)}`);
    assert.strictEqual(chainsTo(off.rows, 8).length, 1, `got ${chainsTo(off.rows, 8)}`);
  });

  test("off: 4 single steps + 3 chains = 7 stone rows", () =>
    assert.strictEqual(off.rows.length, 7, `got ${off.rows.length}: ${labels(off.rows)}`));
}

// ── Show All ON: every bought start renders ──
{
  const on = stoneRows(true);
  test("no formatter errors (Show All on)", () => assert.deepStrictEqual(on.errors, []));

  test("on: both T7 chain starts render (4→…→7 and 5→6→7)", () => {
    const got = chainsTo(on.rows, 7);
    assert.ok(got.includes("4 → 5 → 6 → 7 rock"), `missing 4→…→7, got ${got}`);
    assert.ok(got.includes("5 → 6 → 7 rock"), `missing 5→6→7, got ${got}`);
  });

  test("on: all three T8 chain starts render", () => {
    const got = chainsTo(on.rows, 8);
    ["4 → 5 → 6 → 7 → 8 rock", "5 → 6 → 7 → 8 rock", "6 → 7 → 8 rock"].forEach((l) =>
      assert.ok(got.includes(l), `missing ${l}, got ${got}`));
  });

  test("on: 4 single steps + 6 chains = 10 stone rows", () =>
    assert.strictEqual(on.rows.length, 10, `got ${on.rows.length}: ${labels(on.rows)}`));

  test("on: every rendered row still starts from a market BUY (no produced sources)", () =>
    assert.ok(!on.rows.some((r) => r.sourceProduced)));

  test("on: no duplicate rows (each start → end appears once)", () => {
    const ls = labels(on.rows);
    assert.strictEqual(new Set(ls).size, ls.length, `dupes in ${ls}`);
  });

  test("on: each extra chain is priced (input cost > 0, sell city set)", () => {
    on.rows.forEach((r) => {
      assert.ok(r.totalInputCost > 0, `${r.transition.label} has no input cost`);
      assert.ok(r.sellCity, `${r.transition.label} has no sell city`);
    });
  });
}

// ── Produced-source rows stay hidden even under Show All ──
// Only cheap 8.1 logs (buy) + 8.4 logs (sell) are priced, so 8.2/8.3 are cheaper
// to produce than to buy: the single steps starting there must never render.
{
  setShowAll(true);
  renderTransmuteTable({
    "T8_WOOD_LEVEL1@1": { Thetford: { buy: 12205, volume_24h: 99 } },
    "T8_WOOD_LEVEL4@4": { Martlock: { sell: 1299997, volume_24h: 99 } },
  });
  const woodRows = captured.rows.filter((r) => r.transition);

  test("Show All on: produced-source single steps remain hidden", () => {
    assert.ok(!woodRows.some((r) => r.sourceProduced), "no row may have a produced source");
    assert.ok(!woodRows.some((r) => r.transition.label === "8.3 logs → 8.4 logs"),
      "8.3→8.4 must stay hidden — its 8.3 source is produced");
  });

  test("Show All on: the bought 8.1 chain to 8.4 still renders", () =>
    assert.ok(woodRows.some((r) => r.transition.label === "8.1 → 8.2 → 8.3 → 8.4 logs")));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
