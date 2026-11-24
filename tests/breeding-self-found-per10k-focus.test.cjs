/**
 * Test: the breeding table's "Profit / 10k Focus" cell grows a second value —
 * the same per-10k-focus benchmark priced with SELF-FOUND babies.
 *
 * Today the cell prices one variant only: the baby BOUGHT at market price. A
 * self-bred baby (bred from your own stock instead of purchased) enters the
 * cycle at zero acquisition cost, so its whole effBuy.price term — setup-fee
 * share included — leaves the cost basis, while surplus offspring keep their
 * market value. The feature adds, on the row:
 *
 *   profitFocusOnSelfFound        — the focus-ON nurture EV on the self-found basis
 *   profitPer10kFocusSelfFound    — that EV × the 10k-focus bar's baby count
 *
 * and, inside the same cell, a dimmed secondary line with its own tooltip.
 *
 * Scenarios (plan.md step 1, a–g):
 *   a. formula — offspring arm at the baby price (baby >= self-found cycle margin)
 *   b. arm flip — a self-found cycle margin above the baby price takes over
 *   c. baby at zero cost — the self-found figure EQUALS the bought figure
 *   d. baby priced, cycle profitable — self-found STRICTLY beats bought
 *   e. Use Focus checkbox invariance of the self-found figure
 *   f. cell render — main value + dimmed secondary with its own title tooltip;
 *      dash rows (focusCost <= 0) carry no secondary
 *   g. ES i18n — r_p10k_breed_self / r_p10k_breed_self_tip present, placeholders intact
 *
 * RED BY DESIGN: the feature is not implemented yet, so every feature
 * assertion below must fail on the missing row fields / cell line / ES
 * entries. The regression assertions (bought figure keeps its formula and its
 * checkbox invariance) pass before AND after the feature.
 *
 * Black-box: render the REAL renderMountsTable against synthetic market data
 * (harness mirrors tests/mounts-per10k-focus-toggle.test.cjs) and assert row
 * fields and rendered HTML — never internals. No live APIs.
 *
 * Run: node tests/breeding-self-found-per10k-focus.test.cjs
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

const mod = new Module("breeding-self-found-per10k-focus");
mod._compile(
  stubs + sources + "\nmodule.exports = { tableState, renderMountsTable, _els, renderBreedingMountRow, setCityForce, clearCityForce, formatSilver, feeAndTax: { setupFee: SETUP_FEE, premiumTax: PREMIUM_TAX } };",
  "breeding-self-found-per10k-focus.js",
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

// Recompute the self-found cycle margin from the row's own exposed fields:
// revenue = sell × (1 − premium tax); inputs = (feed + BASE-rate saddler mats)
// × (1 + setup fee) + sell travel — the baby's price is absent by definition.
// The bar bills nurture focus only, so the saddler craft runs unfocused: the
// inputs are the fully unfocused cycle's (totalInputCostNoFocus) less the baby.
const selfFoundCycleProfit = (r) => {
  const revenue = r.sellPot.price * (1 - X.feeAndTax.premiumTax);
  return revenue - (r.totalInputCostNoFocus - r.buyMat.price * (1 + X.feeAndTax.setupFee));
};

const near = (a, b) => Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-9);
const fullChance = (r) => (r.meta.baseOffspringPct + r.meta.nurtureGainPct) / 100;
// Since 2026-10-07 the per-10k lines are the focus-ONLY gain (the user: "show
// only additional profit from focus usage"): the nurture slice of the
// offspring chance × that plan's offspring value, never the cycle itself.
const nurtureChance = (r) => r.meta.nurtureGainPct / 100;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("\n=== Breeding Profit / 10k Focus, self-found babies twin ===");

test("fixture sanity: T8 horse breeding rows value with a focus cost and a profitable bought cycle", () => {
  const rows = breed(market());
  assert.ok(rows.length >= 1, `no breeding row valued for ${BABY}`);
  rows.forEach(({ row, html }) => {
    assert.ok(row.focusCost > 0, `${key(row)}: no nurture focus cost`);
    assert.ok(row.profitPer10kFocus > 0,
      `${key(row)}: bought cycle should be profitable in this fixture (got ${row.profitPer10kFocus})`);
    assert.ok(html && !/^ERR/.test(String(html).trim()),
      `${key(row)}: row HTML failed to render — ${String(html).slice(0, 140)}`);
  });
});

// a. baby price >= self-found cycle margin → the offspring arm is the baby
test("a. formula: self-found per-10k = nurture chance × baby price × bar plays", () => {
  // A 300k baby dwarfs the self-found margin (~246k here) in every city, so
  // the offspring arm must settle on the baby price.
  const rows = breed(market({ babyBuy: 300000 }));
  assert.ok(rows.length >= 1, "no breeding rows");
  rows.forEach(({ row }) => {
    assert.strictEqual(typeof row.profitPer10kFocusSelfFound, "number",
      `${key(row)}: profitPer10kFocusSelfFound missing on the breeding row`);
    assert.strictEqual(typeof row.profitFocusOnSelfFound, "number",
      `${key(row)}: profitFocusOnSelfFound missing on the breeding row`);
    const sfc = selfFoundCycleProfit(row);
    assert.ok(sfc > 0 && sfc < row.buyMat.price,
      `fixture precondition: self-found cycle ${sfc} must be profitable and below the baby price ${row.buyMat.price}`);
    assert.ok(near(row.profitFocusOnSelfFound, sfc + fullChance(row) * row.buyMat.price),
      `${key(row)}: profitFocusOnSelfFound ${row.profitFocusOnSelfFound}`);
    const ev = nurtureChance(row) * row.buyMat.price;
    assert.ok(near(row.profitFocusGainSelfFound, ev),
      `${key(row)}: profitFocusGainSelfFound ${row.profitFocusGainSelfFound} != ${ev}`);
    assert.ok(near(row.profitPer10kFocusSelfFound, ev * barPlays(row.focusCost)),
      `${key(row)}: profitPer10kFocusSelfFound ${row.profitPer10kFocusSelfFound} != ${ev * barPlays(row.focusCost)}`);
  });
});

// b. self-found cycle margin above the baby price → the arm flips to the margin
test("b. arm flip: the offspring value becomes the self-found cycle margin when it beats the baby price", () => {
  const rows = breed(market({ babyBuy: 60000 }));
  assert.ok(rows.length >= 1, "no breeding rows");
  rows.forEach(({ row }) => {
    assert.strictEqual(typeof row.profitPer10kFocusSelfFound, "number",
      `${key(row)}: profitPer10kFocusSelfFound missing on the breeding row`);
    const sfc = selfFoundCycleProfit(row);
    assert.ok(sfc > row.buyMat.price,
      `fixture precondition: self-found cycle ${sfc} must beat the baby price ${row.buyMat.price}`);
    const ev = nurtureChance(row) * sfc;
    assert.ok(near(row.profitFocusGainSelfFound, ev),
      `${key(row)}: profitFocusGainSelfFound ${row.profitFocusGainSelfFound} != ${ev}`);
    assert.ok(near(row.profitPer10kFocusSelfFound, ev * barPlays(row.focusCost)),
      `${key(row)}: profitPer10kFocusSelfFound ${row.profitPer10kFocusSelfFound} != ${ev * barPlays(row.focusCost)}`);
  });
});

// c. baby acquired free → the twin collapses onto the bought figure (and the
// equality is non-trivial: the bought benchmark itself stays positive)
test("c. baby at zero cost: profitPer10kFocusSelfFound equals profitPer10kFocus", () => {
  // Pin the baby's buy city so the row keeps market data while pricing at 0 —
  // an unforced no-data baby would drop the row out of margin scoring and make
  // the equality vacuous (0 === 0).
  X.setCityForce(BABY, "buy", "Lymhurst");
  try {
    const rows = breed(market({ withBaby: false })).map((x) => x.row);
    const valued = rows.filter((r) => r.buyMat.price === 0 && r.profitPer10kFocus > 0);
    assert.ok(valued.length >= 1,
      "no non-vacuous zero-baby row — the city-forced buy leg lost its market data");
    valued.forEach((row) => {
      assert.strictEqual(typeof row.profitPer10kFocusSelfFound, "number",
        `${key(row)}: profitPer10kFocusSelfFound missing on the breeding row`);
      assert.ok(Math.abs(row.profitPer10kFocusSelfFound - row.profitPer10kFocus) < 1e-6,
        `${key(row)}: self-found ${row.profitPer10kFocusSelfFound} != bought ${row.profitPer10kFocus} at a 0 baby price`);
    });
  } finally {
    X.clearCityForce(BABY, "buy");
  }
});

// d. a priced baby with a profitable cycle on both bases → strict inequality
test("d. baby priced and cycle profitable: self-found strictly beats the bought figure", () => {
  const rows = breed(market({ babyBuy: 60000 }));
  assert.ok(rows.length >= 1, "no breeding rows");
  rows.forEach(({ row }) => {
    assert.strictEqual(typeof row.profitPer10kFocusSelfFound, "number",
      `${key(row)}: profitPer10kFocusSelfFound missing on the breeding row`);
    assert.ok(row.profitPer10kFocus > 0,
      `fixture precondition: bought figure ${row.profitPer10kFocus} should be positive`);
    assert.ok(row.profitPer10kFocusSelfFound > row.profitPer10kFocus,
      `${key(row)}: self-found ${row.profitPer10kFocusSelfFound} must strictly exceed bought ${row.profitPer10kFocus}`);
  });
});

// e. the 10k bar is focus-on play: the self-found twin must not track the checkbox
test("e. the Use Focus checkbox does not move profitPer10kFocusSelfFound", () => {
  const md = market();
  const ON = new Map(rowsWithFocus(md, true).filter(isBreedRow).map((r) => [key(r), r]));
  let compared = 0;
  rowsWithFocus(md, false).filter(isBreedRow).forEach((r) => {
    const a = ON.get(key(r));
    if (!a) return;
    assert.strictEqual(typeof a.profitPer10kFocusSelfFound, "number",
      `${key(r)}: profitPer10kFocusSelfFound missing (focus ON)`);
    assert.strictEqual(typeof r.profitPer10kFocusSelfFound, "number",
      `${key(r)}: profitPer10kFocusSelfFound missing (focus OFF)`);
    compared++;
    assert.ok(Math.abs(a.profitPer10kFocusSelfFound - r.profitPer10kFocusSelfFound) < 1e-6,
      `${key(r)}: self-found figure moved with the checkbox (${a.profitPer10kFocusSelfFound} → ${r.profitPer10kFocusSelfFound})`);
  });
  assert.ok(compared >= 1, "no breeding rows compared across the toggle");
});

// regression: the feature must leave the bought figure exactly where it was
test("bought profitPer10kFocus is the focus-only gain and ignores the checkbox", () => {
  const md = market();
  const ON = new Map(rowsWithFocus(md, true).filter(isBreedRow).map((r) => [key(r), r]));
  rowsWithFocus(md, false).filter(isBreedRow).forEach((r) => {
    const a = ON.get(key(r));
    if (!a || a.profitPer10kFocus == null || r.profitPer10kFocus == null) return;
    assert.ok(Math.abs(a.profitPer10kFocus - r.profitPer10kFocus) < 1e-6,
      `${key(r)}: bought figure moved with the checkbox (${a.profitPer10kFocus} → ${r.profitPer10kFocus})`);
  });
  ON.forEach((r) => {
    if (!(r.focusCost > 0) || r.profitPer10kFocus == null) return;
    // Bought line: nurture chance × max(baby, the fully unfocused cycle).
    const cycle = r.sellPot.price * (1 - X.feeAndTax.premiumTax) - r.totalInputCostNoFocus;
    const gain = nurtureChance(r) * Math.max(r.buyMat.price, cycle);
    assert.ok(near(r.profitPer10kFocus, gain * barPlays(r.focusCost)),
      `${key(r)}: bought figure ${r.profitPer10kFocus} != focus-only gain ${gain} × ${barPlays(r.focusCost)}`);
  });
});

// f. the cell carries BOTH values — main bought + dimmed self-found secondary
//    with its own tooltip; dash rows (focusCost <= 0) stay bare
test("f. cell renders main value plus dimmed self-found secondary with own tooltip; dash row has none", () => {
  const s = render(market());
  const i = s.rows.findIndex((r) => isBreedRow(r) && r.focusCost > 0 && r.profitPer10kFocus > 0);
  assert.ok(i >= 0, "no valued breeding row to render");
  const html = String(s.html[i]);
  assert.ok(!/^ERR/.test(html.trim()), `breeding row failed to render — ${html.slice(0, 140)}`);
  const row = s.rows[i];
  const tds = html.split(/<td\b/).slice(1);
  assert.strictEqual(tds.length, 15, "breeding row column count changed — p10k cell index stale");
  const cell = tds[8]; // Profit / 10k Focus (after add-td, item, route, mats, input, price, profit, pure profit)
  assert.ok(cell.includes("Extra profit from focus only"), "p10k cell lost its bought-value tooltip");
  assert.ok(cell.includes(X.formatSilver(row.profitPer10kFocus)),
    `p10k cell lost the main (bought) value ${X.formatSilver(row.profitPer10kFocus)}`);
  const small = cell.match(/<small[^>]*display:block[^>]*>[\s\S]*?<\/small>/);
  assert.ok(small, "no dimmed secondary line in the Profit / 10k Focus cell");
  const smallHtml = small[0];
  assert.ok(/title="/.test(smallHtml), "secondary line carries no own title tooltip");
  assert.ok(/self-bred/.test(smallHtml),
    "secondary tooltip does not explain the self-bred pricing");
  assert.ok(smallHtml.includes(X.formatSilver(row.profitFocusGainSelfFound)),
    `secondary tooltip lost the self-found per-baby gain ${X.formatSilver(row.profitFocusGainSelfFound)}`);
  assert.ok(smallHtml.includes(X.formatSilver(row.profitPer10kFocusSelfFound)),
    `secondary line does not show the self-found per-10k value ${X.formatSilver(row.profitPer10kFocusSelfFound)}`);

  // Dash fallback: no nurture budget → the cell reads "—" with NO secondary.
  const dashTds = X.renderBreedingMountRow({ ...row, focusCost: 0 }, 0, "dash-check")
    .split(/<td\b/).slice(1);
  const dashCell = dashTds[8];
  assert.ok(dashCell.includes("—"), "dash cell lost its dash");
  assert.ok(!dashCell.includes("<small") && !dashCell.includes("display:block"),
    "dash cell must not carry a secondary line");
});

// g. the ES overlay must translate both new strings, placeholders intact
test("g. ES i18n: r_p10k_breed_self / r_p10k_breed_self_tip exist with placeholders intact", () => {
  const { UI_STRINGS_ES_ROWS } = require("../js/i18n-strings-es-rows.js");
  const { UI_STRINGS_ES } = require("../js/i18n-strings-es.js");
  assert.strictEqual(typeof UI_STRINGS_ES_ROWS.r_p10k_breed_self, "string",
    "missing ES entry r_p10k_breed_self in js/i18n-strings-es-rows.js");
  assert.ok(!/\{[a-z]+\}/.test(UI_STRINGS_ES_ROWS.r_p10k_breed_self),
    "r_p10k_breed_self is a plain label and must not carry placeholders");
  assert.strictEqual(typeof UI_STRINGS_ES_ROWS.r_p10k_breed_self_tip, "string",
    "missing ES entry r_p10k_breed_self_tip in js/i18n-strings-es-rows.js");
  ["{gain}", "{babies}", "{focus}"].forEach((tok) => {
    assert.ok(UI_STRINGS_ES_ROWS.r_p10k_breed_self_tip.includes(tok),
      `r_p10k_breed_self_tip lost the ${tok} placeholder`);
  });
  assert.ok(UI_STRINGS_ES.r_p10k_breed_self != null && UI_STRINGS_ES.r_p10k_breed_self_tip != null,
    "slugs not merged into UI_STRINGS_ES — tx() would render English in the Spanish UI");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
