/**
 * Test: the breeding table's "Profit / 10k Focus" cell grows a THIRD value —
 * the per-10k-focus benchmark with self-bred babies AND self-gathered saddler
 * mats (the RRR-eligible leather priced at zero, same rule as the Mounts craft
 * row's self-gathered twin) and the feed at zero too (as the Consumables
 * pasture chain row's twin zeroes its feed). Row fields:
 *
 *   profitFocusOnGathered       — focus-ON nurture EV on the gathered basis
 *   profitPer10kFocusGathered   — that EV x the 10k-focus bar's baby count
 *
 * Harness copied from tests/breeding-self-found-per10k-focus.test.cjs.
 *
 * Run: node tests/breeding-gathered-per10k-focus.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

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
// js/i18n.js and js/table-add-button.js are not part of this harness; the row
// renderer calls them unconditionally, so stand in for them. English-only tx
// here — the ES map itself is asserted directly in scenario g.
function tx(enText, slug){ return enText; }
function dispName(id, fallbackName){ return fallbackName; }
function addTdForKey(){ return "<td></td>"; }
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
  J("sorting-row-key.js") +
  J("rrr-eligible.js") + J("render-mounts.js") + J("render-mounts-breeding-row.js") + J("render-mounts-craft-row.js");

const mod = new Module("breeding-gathered-per10k-focus");
mod._compile(
  stubs + sources + "\nmodule.exports = { tableState, renderMountsTable, _els, renderBreedingMountRow, setCityForce, clearCityForce, formatSilver, feeAndTax: { setupFee: SETUP_FEE, premiumTax: PREMIUM_TAX } };",
  "breeding-gathered-per10k-focus.js",
);
const X = mod.exports;

const priced = (buy, sell, vol) => ({ buy_price: buy, sell_price: sell, volume_24h: vol });
const BABY = "T8_FARM_HORSE_BABY";

// T8 Riding Horse: breeding (baby → grown → saddled via 20x T8_LEATHER) plus a
// cheap plant feed, so the self-found cost basis (feed + saddler mats) is a
// real term and not a degenerate zero.
function market({ babyBuy = 60000, withBaby = true } = {}) {
  const md = {};
  // Caerleon included so the caerleon section's row values too (it scans
  // Caerleon only); the royal rows scan the other two.
  const put = (id, b, s, v) =>
    ["Lymhurst", "Martlock", "Caerleon"].forEach((c) => { (md[id] = md[id] || {})[c] = priced(b, s, v); });
  if (withBaby) put(BABY, babyBuy, Math.round(babyBuy * 1.08), 500);
  put("T8_FARM_HORSE_GROWN", 100000, 110000, 500);
  put("T8_LEATHER", 9000, 9500, 5000);
  put("T8_MOUNT_HORSE", 380000, 420000, 500);
  put("T3_WHEAT", 100, 110, 5000);
  return md;
}

// Focus ON for every default render: the scenarios that recompute expected
// values from the row's exposed inputs rely on the checkbox-on build, where
// row.saddlerMatCost coincides with the focus-ON saddler basis the benchmark
// uses (row.saddlerMatCostFocusOn is not itself exposed).
function render(md) {
  X._els["use-focus"].checked = true;
  X.renderMountsTable(md);
  return {
    rows: X.tableState["mounts-table"].data.slice(),
    html: X.tableState["mounts-table"].html.slice(),
  };
}

function rowsWithFocus(md, on) {
  X._els["use-focus"].checked = on;
  X.renderMountsTable(md);
  return X.tableState["mounts-table"].data.slice();
}

const isBreedRow = (r) => !r.isCraft && r.item && r.item.babyId === BABY;

// A breeding row's `item` has no `id` — it is named by its baby (same key
// shape as tests/mounts-per10k-focus-toggle.test.cjs).
const key = (r) =>
  `${(r.item && (r.item.id || r.item.babyId || r.item.grownId)) || "?"}`
  + `|${r.isCraft ? "craft" : "breed"}|${r.section || ""}`;

const breed = (md) => {
  const s = render(md);
  return s.rows
    .map((row, i) => ({ row, html: s.html[i] }))
    .filter((x) => isBreedRow(x.row));
};

// Whole bar plays while one cycle fits in 10k focus, a fraction once it does
// not — the focusBarCrafts shape (js/calculations.js), mirrored here.
const barPlays = (focus) => (focus > 10000 ? 10000 / focus : Math.floor(10000 / focus));

const near = (a, b) => Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-9);
const fullChance = (r) => (r.meta.baseOffspringPct + r.meta.nurtureGainPct) / 100;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}


// Gathered cycle: babies still BOUGHT (line 3 is "babies bought, gatherable
// mats self-gathered", never stacked on self-found); feed and T8_LEATHER
// (RRR-eligible) at zero. The fixture's only other saddler input is the grown
// mount, produced in-cycle at 0, so the baby (+ setup fee) and the sell travel
// leg are what is left.
const gatheredCycleProfit = (r) => {
  assert.ok(r.feedCost > 0, "fixture precondition: feed must cost something");
  const revenue = r.sellPot.price * (1 - X.feeAndTax.premiumTax);
  return revenue - r.buyMat.price * (1 + X.feeAndTax.setupFee) - (r.brecilienFee || 0);
};

console.log("\n=== Breeding Profit / 10k Focus, self-gathered mats twin ===");

test("a. formula: gathered per-10k = nurture chance × offspring value × bar plays", () => {
  [300000, 60000].forEach((babyBuy) => {
    const rows = breed(market({ babyBuy }));
    assert.ok(rows.length >= 1, "no breeding rows");
    rows.forEach(({ row }) => {
      assert.strictEqual(typeof row.profitPer10kFocusGathered, "number",
        `${key(row)}: profitPer10kFocusGathered missing`);
      const gc = gatheredCycleProfit(row);
      assert.ok(near(row.profitFocusOnGathered, gc + fullChance(row) * Math.max(row.buyMat.price, gc)),
        `${key(row)}: profitFocusOnGathered ${row.profitFocusOnGathered}`);
      // The per-10k line is the focus-ONLY gain (2026-10-07): the nurture
      // slice of the offspring chance, never the cycle's own margin.
      const ev = (row.meta.nurtureGainPct / 100) * Math.max(row.buyMat.price, gc);
      assert.ok(near(row.profitFocusGainGathered, ev),
        `${key(row)}: profitFocusGainGathered ${row.profitFocusGainGathered} != ${ev}`);
      assert.ok(near(row.profitPer10kFocusGathered, ev * barPlays(row.focusCost)),
        `${key(row)}: profitPer10kFocusGathered ${row.profitPer10kFocusGathered} != ${ev * barPlays(row.focusCost)}`);
    });
  });
});

test("b. gathered strictly beats all-bought when feed and leather have a price", () => {
  breed(market()).forEach(({ row }) => {
    assert.ok(row.profitPer10kFocusGathered > row.profitPer10kFocus,
      `${key(row)}: gathered ${row.profitPer10kFocusGathered} must exceed bought ${row.profitPer10kFocus}`);
  });
});

test("c. the Use Focus checkbox does not move profitPer10kFocusGathered", () => {
  const md = market();
  const ON = new Map(rowsWithFocus(md, true).filter(isBreedRow).map((r) => [key(r), r]));
  let compared = 0;
  rowsWithFocus(md, false).filter(isBreedRow).forEach((r) => {
    const a = ON.get(key(r));
    if (!a) return;
    compared++;
    assert.ok(Math.abs(a.profitPer10kFocusGathered - r.profitPer10kFocusGathered) < 1e-6,
      `${key(r)}: gathered figure moved with the checkbox`);
  });
  assert.ok(compared >= 1, "no breeding rows compared across the toggle");
});

test("d. cell renders the gathered line after self-found, with its own tooltip; dash row has none", () => {
  const s = render(market());
  const i = s.rows.findIndex((r) => isBreedRow(r) && r.focusCost > 0 && r.profitPer10kFocus > 0);
  assert.ok(i >= 0, "no valued breeding row to render");
  const row = s.rows[i];
  const cell = String(s.html[i]).split(/<td\b/).slice(1)[8];
  const smalls = cell.match(/<small[^>]*display:block[^>]*>[\s\S]*?<\/small>/g) || [];
  assert.strictEqual(smalls.length, 2, "expected self-found and gathered secondary lines");
  assert.ok(/self-found/.test(smalls[0]), "first secondary line should stay self-found");
  assert.ok(/>gathered /.test(smalls[1]), "second secondary line should be labelled gathered");
  assert.ok(/title="[^"]*self-gathered/.test(smalls[1]), "gathered line tooltip missing");
  assert.ok(smalls[1].includes(X.formatSilver(row.profitPer10kFocusGathered)),
    "gathered line does not show the gathered per-10k value");
  const dashCell = X.renderBreedingMountRow({ ...row, focusCost: 0 }, 0, "dash-check")
    .split(/<td\b/).slice(1)[8];
  assert.ok(!dashCell.includes("<small"), "dash cell must not carry a secondary line");
});

test("e. ES i18n: r_p10k_breed_gathered / _tip exist with placeholders intact", () => {
  const { UI_STRINGS_ES_ROWS } = require("../js/i18n-strings-es-rows.js");
  const { UI_STRINGS_ES } = require("../js/i18n-strings-es.js");
  assert.strictEqual(typeof UI_STRINGS_ES_ROWS.r_p10k_breed_gathered, "string");
  ["{gain}", "{babies}", "{focus}"].forEach((tok) =>
    assert.ok(UI_STRINGS_ES_ROWS.r_p10k_breed_gathered_tip.includes(tok), `tip lost ${tok}`));
  assert.ok(UI_STRINGS_ES.r_p10k_breed_gathered != null && UI_STRINGS_ES.r_p10k_breed_gathered_tip != null,
    "slugs not merged into UI_STRINGS_ES");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
