/**
 * Test: the Mounts table's "Profit / 10k Focus" columns (breeding cycles and
 * mount crafts) are focus-ON benchmarks, invariant to the "Use Focus" checkbox.
 *
 * A 10,000-focus bar is focus-on play by definition, so both operands of the
 * figure are focus-on: the breeding row prices the cycle at the focus-on
 * saddler RRR (focusCycleProfit) and the craft row at the focus-on craft RRR.
 * Before the fix the column multiplied the checkbox profit by an invariant
 * focus cost, so it moved when the user toggled focus.
 *
 * Black-box: render the REAL renderMountsTable against synthetic market data
 * with the "use-focus" checkbox stub flipped, and compare the resulting rows.
 * Pure Profit must move; the per-10k columns must not.
 *
 * Run: node tests/mounts-per10k-focus-toggle.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const stubs = `
const _els = { "use-focus": { checked: true }, "premium-account": { checked: true } };
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
function getRowKey(r, t){ return "k"; }
function addTdForKey(t, k){ return "<td></td>"; }
function focusPlayCell(p){ return "<td></td>"; }
function dispName(id, n){ return n || id; }
function tx(s){ return s; }
function brecilienFeeBadge(){ return ""; }
function aggregateCostTd(c){ return "<td>"+c+"</td>"; }
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

const mod = new Module("mounts-per10k-focus-toggle");
mod._compile(
  stubs + sources + "\nmodule.exports = { tableState, renderMountsTable, _els };",
  "mounts-per10k-focus-toggle.js",
);
const X = mod.exports;

const priced = (buy, sell, vol) => ({ buy_price: buy, sell_price: sell, volume_24h: vol });

// Riding Horse T8: breeding (baby → grown → saddled) and the craft row
// (T8_FARM_HORSE_GROWN + 20x T8_LEATHER → T8_MOUNT_HORSE) both value here.
function market() {
  const md = {};
  const put = (id, c, b, s, v) => { (md[id] = md[id] || {})[c] = priced(b, s, v); };
  ["Lymhurst", "Martlock"].forEach((c) => {
    put("T8_FARM_HORSE_BABY", c, 60000, 65000, 500);
    put("T8_FARM_HORSE_GROWN", c, 100000, 110000, 500);
    put("T8_LEATHER", c, 9000, 9500, 5000);
    put("T8_MOUNT_HORSE", c, 380000, 420000, 500);
    put("T6_MEAT", c, 900, 950, 5000);
  });
  return md;
}

function rowsWithFocus(on) {
  X._els["use-focus"].checked = on;
  X.renderMountsTable(market());
  return X.tableState["mounts-table"].data.slice();
}

// A breeding row's `item` is a BREEDING_ITEMS entry, which has no `id` — it is
// named by its baby. Keying on `item.id` alone collapsed all 45 royal breeding
// rows onto one entry, and the comparison then measured whichever row happened
// to be written last. That went unnoticed while the mounts table still emitted
// item-less no-data sentinels: those keyed to the same string, sorted last, and
// carried a null profitPer10kFocus, so every row under the key was skipped.
const key = (r) =>
  `${(r.item && (r.item.id || r.item.babyId || r.item.grownId)) || "?"}`
  + `|${r.isCraft ? "craft" : "breed"}|${r.section || ""}`;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("\n=== Mounts Profit / 10k Focus across the Use Focus toggle ===");

const ON = new Map(rowsWithFocus(true).map((r) => [key(r), r]));
const OFF = rowsWithFocus(false);

test("fixture sanity: some row's Pure Profit reacts to the checkbox", () => {
  const moved = OFF.filter((r) => {
    const a = ON.get(key(r));
    return a && a.marginInfo && r.marginInfo &&
      Math.abs((a.marginInfo.profit || 0) - (r.marginInfo.profit || 0)) > 1e-6;
  });
  assert.ok(moved.length > 0, "no row changed profit — fixture cannot prove invariance");
});

test("every row's Profit / 10k Focus is identical across the toggle", () => {
  let compared = 0;
  OFF.forEach((r) => {
    const a = ON.get(key(r));
    if (!a || a.profitPer10kFocus == null || r.profitPer10kFocus == null) return;
    compared++;
    assert.ok(Math.abs(a.profitPer10kFocus - r.profitPer10kFocus) < 1e-6,
      `${key(r)}: moved with the checkbox (${a.profitPer10kFocus} → ${r.profitPer10kFocus})`);
  });
  assert.ok(compared > 0, "no rows carried a per-10k figure to compare");
});

// Whole plays while one fits in the bar, a fraction of one once it does not.
const barPlays = (focus) => (focus > 10000 ? 10000 / focus : Math.floor(10000 / focus));

// Since 2026-10-07 a breeding row's figure is the focus-ONLY gain of a bar of
// nurtures (the extra offspring), still a focus-on benchmark the checkbox
// cannot move — so the gain is read off the focus-OFF render here.
test("breeding rows price the focus-only nurture gain (profitFocusGain × cycles)", () => {
  const breeds = OFF.filter((r) => !r.isCraft && r.focusCost > 0 && r.profitPer10kFocus != null);
  assert.ok(breeds.length > 0, "no breeding row with a nurture focus cost");
  breeds.forEach((r) => {
    const cycles = barPlays(r.focusCost);
    assert.ok(Math.abs(r.profitPer10kFocus - r.profitFocusGain * cycles) < 1e-6,
      `${key(r)}: figure does not reproduce profitFocusGain × ${cycles}`);
  });
});

test("craft rows price the FOCUS-ON craft (profitFocusOn × crafts)", () => {
  const crafts = OFF.filter((r) => r.isCraft && r.focusCost > 0 && r.profitPer10kFocus != null);
  assert.ok(crafts.length > 0, "no craft row with a focus cost");
  crafts.forEach((r) => {
    const n = barPlays(r.focusCost);
    assert.ok(Math.abs(r.profitPer10kFocus - r.profitFocusOn * n) < 1e-6,
      `${key(r)}: figure does not reproduce profitFocusOn × ${n}`);
  });
});

// Every operand of the figure is focus-on, but a row that settled on a
// DIFFERENT route in the two states would still move the number. Mount crafts
// have no craft spec (getCraftRRR(city, null, …)), so every candidate city
// shares one RRR and the winner cannot flip. This is the alarm for the day that
// stops being true — e.g. if the Brecilien Travel Planner fee is re-enabled,
// since it scales with the RRR-adjusted mat count.
test("the winning craft city and sell city do not move with the checkbox", () => {
  let compared = 0;
  OFF.forEach((r) => {
    const a = ON.get(key(r));
    if (!a || !r.marginInfo || r.marginInfo.margin === -1 || a.marginInfo.margin === -1) return;
    compared++;
    assert.strictEqual(r.craftCity, a.craftCity, `${key(r)}: craft city flipped with the checkbox`);
    assert.strictEqual(r.sellPot && r.sellPot.city, a.sellPot && a.sellPot.city,
      `${key(r)}: sell city flipped with the checkbox`);
    assert.strictEqual(r.saddlerCity, a.saddlerCity, `${key(r)}: saddler city flipped with the checkbox`);
  });
  assert.ok(compared > 0, "no valued rows to compare");
});

test("with focus OFF the focus-ON profit beats the displayed one (focus cuts cost)", () => {
  const crafts = OFF.filter((r) => r.isCraft && r.profitFocusOn != null && r.marginInfo &&
    typeof r.marginInfo.profit === "number" && r.marginInfo.margin !== -1);
  assert.ok(crafts.length > 0, "no valued craft row");
  crafts.forEach((r) => {
    assert.ok(r.profitFocusOn > r.marginInfo.profit,
      `${key(r)}: focus-on profit ${r.profitFocusOn} should exceed the focus-off ${r.marginInfo.profit}`);
  });
});

test("rendered mount craft row 10k focus tooltip quotes profitFocusOn when focus toggle is OFF", () => {
  X._els["use-focus"].checked = false;
  X.renderMountsTable(market());
  let checkedCount = 0;
  X.tableState["mounts-table"].data.forEach((r, i) => {
    if (!r.isCraft || !r.focusCost || r.profitFocusOn == null || !r.marginInfo) return;
    const html = X.tableState["mounts-table"].html[i];
    const expectedProfitStr = Math.round(r.profitFocusOn).toLocaleString();
    const offProfitStr = Math.round(r.marginInfo.profit).toLocaleString();
    if (expectedProfitStr !== offProfitStr) {
      checkedCount++;
      assert.ok(html.includes(expectedProfitStr + " profit/craft"),
        `HTML tooltip should quote focus-on profit ${expectedProfitStr}, got: ${html}`);
    }
  });
  assert.ok(checkedCount > 0, "expected at least one craft row where focus-on and focus-off profits differ");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
