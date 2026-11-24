/**
 * Test: the Gathering table's Best Journal cell shows a fill time, and takes it
 * from THE ROW'S OWN TIER — the row is a gathering-tier statement ("gather T6
 * ore"), and the journal it picks is bounded by that tier's ±2 fill window.
 *
 * The row and its fill line must contradict each other never: a T8 ore row
 * claiming a T3 fill window, priced at a fame/hour it does not earn, would be
 * nonsense. There is no header Gathering Tier preference any more (the control
 * made way for the Daily Production Bonus select), so the old override hazard is
 * gone entirely — these tests keep writing a legacy value to storage to pin that
 * nothing reads it.
 *
 * TLD (UI): the renderer already existed; this locks the behaviour of the line
 * added to its cell. Black-box — synthetic market, no DOM, no live API.
 *
 * Run: node tests/gathering-journal-fill-line.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const stubs = `
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
function getOrderType(){ return "instant"; }
function isBlackRedZoneEnabled(){ return true; }
function isValidSourceCity(){ return true; }
function getOverridePrice(){ return null; }
function getOverrideVolume(){ return null; }
function getItemDisplayName(id){ const s = resourceShortName(id); return s || id; }
function resourceAliasSpan(){ return ""; }
function tx(en){ return en; }
function dispName(id, fallback){ return fallback; }
function findBestSellCity(marketData, itemId, cities){
  const d = marketData[itemId] || {};
  let best = { city: null, price: 0 };
  cities.forEach((c) => { const p = (d[c] && d[c].sell) || 0; if (p > best.price) best = { city: c, price: p }; });
  return best;
}
function findBestBuyCity(marketData, itemId, cities){
  const d = marketData[itemId] || {};
  let best = { city: null, price: 0 };
  cities.forEach((c) => {
    const p = (d[c] && d[c].buy) || 0;
    if (p > 0 && (!best.city || p < best.price)) best = { city: c, price: p };
  });
  return best;
}
function priceTd(price, itemId, city){ return "<td>"+price+"</td>"; }
function volTd(v){ return "<td class='vol'>"+v+"</td>"; }
function addTdForKey(){ return '<td class="cell-add"></td>'; }
function getRowKey(row){ return (row.rawId||"") + "|" + (row.section||""); }
const captured = { rows: [], html: [] };
function renderTableData(id, rows, fmt){
  captured.tableId = id;
  captured.rows = rows;
  captured.html = rows.map((r,i) => { try { return fmt(r,i); } catch(e){ return "ERR:"+e.message; } });
}
`;

const mod = new Module("gathering-journal-fill");
mod._compile(
  stubs +
    J("resource-names.js") + J("data-city-bonuses.js") + (J("calculations.js") + J("calculations-margins.js")) + J("data-gathering.js") +
    J("gather-fame-rates.js") +
    J("data-journals.js") + J("journal-fill-speed.js") + J("render-journals.js") +
    J("render-gathering.js") +
    "\nmodule.exports = { renderGatheringTable, captured, " +
    "getJournalFillHours, getJournalMaxfame, GATHER_BASE_FAME_PER_HOUR };",
  "gathering-journal-fill.js",
);
const {
  renderGatheringTable, captured,
  getJournalFillHours, getJournalMaxfame, GATHER_BASE_FAME_PER_HOUR,
} = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}
// The legacy storage key the removed Gathering Tier control wrote. The cases
// below keep writing it to prove the Gathering cell ignores whatever sits there.
const LEGACY_TIER_KEY = "journalFillTier";
const setPref = (v) => { if (v == null) store.delete(LEGACY_TIER_KEY); else store.set(LEGACY_TIER_KEY, String(v)); };

// ── market: T6 ore worth gathering, plus a profitable T6 ore journal ───────
const MARKET = {
  T6_ORE: { Bridgewatch: { sell: 300, volume_24h: 500 } },
  T6_JOURNAL_ORE_EMPTY: { Lymhurst: { buy: 1500, sell: 1500, volume_24h: 500 } },
  T6_JOURNAL_ORE_FULL: { Lymhurst: { buy: 26000, sell: 26000, volume_24h: 500 } },
};
// findBestSellCity reads `.sell`, findBestBuyCity reads `.buy` — give the
// journals both so either lookup resolves.
MARKET.T6_JOURNAL_ORE_FULL.Lymhurst.sell = 26000;

function oreRow() {
  renderGatheringTable(MARKET);
  const i = captured.rows.findIndex((r) => r.tier === 6 && r.type === "ore");
  assert.ok(i >= 0, "no T6 ore row rendered");
  return { row: captured.rows[i], html: captured.html[i] };
}

console.log("\n=== The cell reports a fill time ===");

test("the Best Journal cell carries an hours line", () => {
  setPref(null);
  const { row, html } = oreRow();
  assert.ok(row.journalBest, "the fixture must produce a priced journal");
  assert.ok(/to fill/.test(html), "no fill line in the cell: " + html);
});

test("the hours shown are maxfame ÷ the row tier's base fame/hour", () => {
  setPref(null);
  const { row } = oreRow();
  const want = getJournalFillHours(getJournalMaxfame(row.journalBest.slug, row.journalBest.tier),
                                   GATHER_BASE_FAME_PER_HOUR[row.tier]);
  const got = getJournalFillHours(row.journalBest.maxfame, row.journalBest.baseFamePerHour);
  assert.ok(Math.abs(got - want) < 1e-9, `expected ${want}h, got ${got}h`);
});

console.log("\n=== …and no legacy stored tier can move it ===");

// Every storage value, including ones whose fill window would exclude this row's
// journal entirely if anything still read it. The cell must be byte-identical.
test("the cell is identical whatever a legacy stored tier says", () => {
  setPref(null);
  const baseline = oreRow().html;
  [2, 3, 4, 5, 6, 7, 8, "", "junk"].forEach((pref) => {
    setPref(pref);
    assert.strictEqual(oreRow().html, baseline, `preference ${pref} changed the Gathering cell`);
  });
});

test("the journal tier and its fame/hour are unchanged by anything left in storage", () => {
  setPref(null);
  const base = oreRow().row.journalBest;
  [2, 8].forEach((pref) => {
    setPref(pref);
    const now = oreRow().row.journalBest;
    assert.strictEqual(now.tier, base.tier, `preference ${pref} changed the journal tier`);
    assert.strictEqual(now.baseFamePerHour, base.baseFamePerHour, `preference ${pref} changed the fame rate`);
    assert.strictEqual(now.extraSilverPerHour, base.extraSilverPerHour, `preference ${pref} changed the rate`);
  });
});

test("a row with no journal still renders, with no fill line", () => {
  setPref(null);
  renderGatheringTable(MARKET);
  const i = captured.rows.findIndex((r) => !r.journalBest);
  assert.ok(i >= 0, "expected at least one row with no priced journal");
  assert.ok(!/to fill/.test(captured.html[i]), "a journal-less row must not claim a fill time");
});

setPref(null);
console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
