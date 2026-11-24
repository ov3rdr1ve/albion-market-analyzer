/**
 * Test: the Journal Filling table's "Fill Speed / Max Profit" column.
 *
 * The table already ranks journals by silver-per-fame, which never says how long
 * a journal takes to fill — the reason a small journal can out-earn a big one.
 * This column adds the fill time at the journal's own tier and the
 * silver/hour it implies, and dashes the rows that tier genuinely cannot fill
 * (a journal fills from its own tier up to two tiers higher).
 *
 * TLD (UI): the renderer existed; this locks the column's behaviour. Black-box —
 * synthetic market, no DOM, no live API.
 *
 * Run: node tests/journals-fill-speed-column.test.cjs
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
const SELL_CITIES = [...CITIES, "Black Market"];
function getOrderType(){ return "instant"; }
function isBlackRedZoneEnabled(){ return true; }
function getOverridePrice(){ return null; }
function getOverrideVolume(){ return null; }
function tx(en){ return en; }
function getProfitClass(){ return ""; }
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
function priceTd(price){ return "<td>"+price+"</td>"; }
function addTdForKey(){ return '<td class="cell-add"></td>'; }
function getRowKey(row){ return row.fullId + "|" + (row.section||""); }
const captured = { rows: [], html: [] };
function renderTableData(id, rows, fmt){
  captured.tableId = id;
  captured.rows = rows;
  captured.html = rows.map((r,i) => { try { return fmt(r,i); } catch(e){ return "ERR:"+e.message; } });
}
`;

const mod = new Module("journals-fill-speed-column");
mod._compile(
  stubs + J("data-city-bonuses.js") + (J("calculations.js") + J("calculations-margins.js")) + J("data-gathering.js") + J("gather-fame-rates.js") +
    J("data-journals.js") + J("journal-fill-speed.js") + J("render-journals.js") +
    "\nmodule.exports = { renderJournalFillingTable, captured, " +
    "GATHER_BASE_FAME_PER_HOUR, getJournalMaxfame, formatFillHours };",
  "journals-fill-speed-column.js",
);
const {
  renderJournalFillingTable, captured,
  GATHER_BASE_FAME_PER_HOUR, getJournalMaxfame, formatFillHours,
} = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}
// The legacy storage key the removed Gathering Tier control wrote. Cases below
// keep writing it to prove a stale value can no longer move a row's pricing.
const LEGACY_TIER_KEY = "journalFillTier";
const setPref = (v) => { if (v == null) store.delete(LEGACY_TIER_KEY); else store.set(LEGACY_TIER_KEY, String(v)); };

// Every ore journal tier priced at a healthy margin, so no row is dashed for
// want of a price and the window is the only thing that can dash one.
const MARKET = {};
[2, 3, 4, 5, 6, 7, 8].forEach((t) => {
  const fame = getJournalMaxfame("ORE", t);
  MARKET[`T${t}_JOURNAL_ORE_EMPTY`] = { Lymhurst: { buy: fame * 0.05, sell: fame * 0.05, volume_24h: 500 } };
  MARKET[`T${t}_JOURNAL_ORE_FULL`] = { Lymhurst: { buy: fame * 1.2, sell: fame * 1.2, volume_24h: 500 } };
});

function oreRows() {
  renderJournalFillingTable(MARKET);
  const out = {};
  captured.rows.forEach((r, i) => {
    if (r.slug === "ORE") out[r.tier] = { row: r, html: captured.html[i] };
  });
  return out;
}

console.log("\n=== Auto: every journal fills at its own tier ===");

test("every ore tier is fillable and shows hours + a rate", () => {
  setPref("match");
  const rows = oreRows();
  [2, 3, 4, 5, 6, 7, 8].forEach((t) => {
    const { row, html } = rows[t];
    assert.strictEqual(row.fillable, true, `T${t} should be fillable at its own tier`);
    assert.strictEqual(row.fillGatherTier, t, `T${t} gather tier`);
    assert.ok(row.fillHours > 0, `T${t} hours`);
    assert.ok(row.journalFillPerHour > 0, `T${t} rate`);
    assert.ok(html.includes(formatFillHours(row.fillHours)), `T${t} cell must show the time: ${html}`);
    assert.ok(/\/h<\/span>/.test(html), `T${t} cell must show a rate: ${html}`);
  });
});

test("hours are maxfame ÷ the gathering tier's base fame/hour", () => {
  setPref("match");
  const rows = oreRows();
  [2, 5, 8].forEach((t) => {
    const want = getJournalMaxfame("ORE", t) / GATHER_BASE_FAME_PER_HOUR[t];
    assert.ok(Math.abs(rows[t].row.fillHours - want) < 1e-9, `T${t}: expected ${want}h`);
  });
});

test("the rate is the margin divided by those hours", () => {
  setPref("match");
  const rows = oreRows();
  [2, 5, 8].forEach((t) => {
    const r = rows[t].row;
    assert.ok(Math.abs(r.journalFillPerHour - r.journalMargin / r.fillHours) < 1e-6, `T${t}`);
  });
});

// There is no header Gathering Tier any more: every row prices at its OWN tier,
// and a stale value left in storage by an old install must not change that.
test("every row prices at its own tier, even with a stale tier left in storage", () => {
  setPref(5);
  const rows = oreRows();
  [2, 3, 4, 5, 6, 7, 8].forEach((t) => {
    assert.strictEqual(rows[t].row.fillGatherTier, t, `T${t} gather tier`);
    assert.strictEqual(rows[t].row.fillable, true, `T${t} fillable`);
  });
  setPref(null);
});

console.log("\n=== A stored tier is dead: the window rides the row's own tier ===");

const WINDOW = [
  { pref: 8 },
  { pref: 5 },
  { pref: 2 },
];
for (const c of WINDOW) {
  test(`with ${c.pref} left in storage every ore tier still fills at its own tier`, () => {
    setPref(c.pref);
    const rows = oreRows();
    [2, 3, 4, 5, 6, 7, 8].forEach((t) => {
      const { row } = rows[t];
      assert.strictEqual(row.fillable, true, `T${t} at storage ${c.pref}`);
      assert.strictEqual(row.fillGatherTier, t, `T${t} gather tier`);
      assert.strictEqual(row.fillReason, null, `T${t} reason`);
      assert.ok(row.fillHours > 0, `T${t} hours`);
      assert.ok(row.journalFillPerHour > 0, `T${t} must keep the rate it can earn`);
    });
    setPref(null);
  });
}

test("each journal turns over at its own tier: the T6 one faster than the T8 one", () => {
  setPref(8);
  const rows = oreRows();
  assert.strictEqual(rows[6].row.fillGatherTier, 6, "the T6 row prices at T6, not at storage");
  assert.strictEqual(rows[8].row.fillGatherTier, 8);
  assert.ok(rows[6].row.fillHours < rows[8].row.fillHours);
  setPref(null);
});

test("the per-fame headline is untouched by anything left in storage", () => {
  setPref(null);
  const base = oreRows();
  [2, 5, 8].forEach((pref) => {
    setPref(pref);
    const now = oreRows();
    [2, 5, 8].forEach((t) => {
      assert.strictEqual(now[t].row.silverPer1kFame, base[t].row.silverPer1kFame,
        `T${t}: preference ${pref} moved the silver/1k fame ranking`);
      assert.strictEqual(now[t].row.journalMargin, base[t].row.journalMargin, `T${t}: margin moved`);
    });
  });
});

console.log("\n=== Unpriced rows ===");

test("an unpriced journal dashes without claiming a rate", () => {
  setPref(null);
  renderJournalFillingTable({});           // nothing priced at all
  const i = captured.rows.findIndex((r) => r.slug === "ORE" && r.tier === 8);
  const row = captured.rows[i];
  assert.strictEqual(row.priced, false);
  assert.strictEqual(row.journalFillPerHour, 0);
  // The fill TIME is still knowable — it does not depend on any price.
  assert.ok(row.fillHours > 0, "hours come from fame, not from prices");
  assert.ok(!/\/h<\/span>/.test(captured.html[i]), "no rate without prices: " + captured.html[i]);
});

setPref(null);
console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
