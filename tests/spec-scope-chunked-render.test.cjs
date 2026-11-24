/**
 * Spec-scope leak in the chunked render paths — plan.md Step 1 (TDD red).
 *
 * The sync render paths (boot / scan) run renderCraftingTable /
 * renderCraftPlannerTable wrapped in withSpecScope("crafting-table" /
 * "craft-planner-table") — SPEC_SCOPED_RENDERERS, js/spec-settings-panel.js —
 * so their focus costs read the per-table spec levels the user set in the ⚙
 * panel. The interactive re-renders (scheduleRerender → drawOneTable →
 * CHUNKED_RENDERERS, js/app.js) go through renderCraftingTableChunked /
 * renderCraftPlannerTableChunked, which nothing ever wraps: getFocusCost then
 * falls back to the empty scope (_currentSpecScope || "", js/focus-spec.js),
 * i.e. a mastery at 100 and every specialization at 0.
 *
 * Concrete effect, T4_HEAD_PLATE_AVALON (base focus 429, family weights
 * summing 4.45/level per js/focus-spec-items.js):
 *   all-100 scoped levels → FCE 44,500 → 429 × 0.5^4.45 ≈ 19.63 focus/craft
 *   empty scope           → FCE  3,000 → 429 × 0.5^0.3  ≈ 348.46 focus/craft
 *
 * Black-box: the REAL renderers, pricing pipeline and focus-spec module run in
 * one module scope with stubbed market prices and toggles (the
 * tests/crafting-self-found-profit.test.cjs convention, with the planner's
 * file list from tests/helpers/craft-planner-render-harness.cjs).
 * localStorage is a plain object shim. No DOM, no network, no live API.
 *
 * RED BY DESIGN: the sync-path control assertions encode the CURRENT correct
 * behaviour (a scoped sync render reads its table's levels) and pass before
 * AND after the fix; every chunked-path assertion fails because the chunked
 * renderers price at the empty scope.
 *
 * Run: node tests/spec-scope-chunked-render.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
// autocrlf checkouts read CRLF; normalize so regex lifts below match.
const J = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n");

let passed = 0, failed = 0;
function test(name, fn) {
  const done = (e) => {
    if (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
    else { console.log(`  PASS: ${name}`); passed++; }
  };
  try {
    const r = fn();
    if (r && typeof r.then === "function") return r.then(() => done(), done);
    done();
  } catch (e) { done(e); }
  return Promise.resolve();
}

// ─── the sandbox ────────────────────────────────────────────────────────────

const PRELUDE = `
// A localStorage stand-in — focus-spec.js persists the per-table levels here.
const __specStore = {};
const localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(__specStore, k) ? __specStore[k] : null),
  setItem: (k, v) => { __specStore[k] = String(v); },
  removeItem: (k) => { delete __specStore[k]; },
  get length() { return Object.keys(__specStore).length; },
  key: (i) => { const ks = Object.keys(__specStore); return i >= 0 && i < ks.length ? ks[i] : null; },
};
// The DOM-backed toggles (js/utils.js) see an empty header: premium ON,
// order type "market", focus checkbox absent → treated as checked.
const _els = {};
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null };
const window = { addEventListener: () => {} };

// Zone/city topology (tests/crafting-self-found-profit.test.cjs convention).
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];

// The refine ladders (tests/helpers/craft-planner-render-harness.cjs) so the
// planner's real sourcing code can price the metalbar leg.
const RESOURCE_DEFS = [
  { type:"wood", raw:"WOOD", refined:"PLANKS",      tiers:[[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
  { type:"ore",  raw:"ORE",  refined:"METALBAR",    tiers:[[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
  { type:"fiber", raw:"FIBER", refined:"CLOTH",     tiers:[[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
  { type:"hide", raw:"HIDE", refined:"LEATHER",     tiers:[[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
  { type:"rock", raw:"ROCK", refined:"STONEBLOCK",  tiers:[[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
];

// Browser globals the overridden paint layer would need; it never runs.
function tx(en) { return en; }
function dispName(id, fallback) { return fallback; }

// The fixture catalogue: the plan's pin item — Adept's Helmet of Valor — at
// two tiers, real recipes (js/gear-plate-armor.js). No isGearRecipe flag, so
// the crafting table renders exactly these two items.
const CRAFTING_ITEMS = [
  { id: "T4_HEAD_PLATE_AVALON", name: "Adept's Helmet of Valor [T4]",
    matId: "T4_METALBAR", matCount: 8, craftType: "plate_helmet",
    materials: [{ matId: "T4_METALBAR", count: 8 },
                { matId: "T4_ARTEFACT_HEAD_PLATE_AVALON", count: 1 }] },
  { id: "T5_HEAD_PLATE_AVALON", name: "Expert's Helmet of Valor [T5]",
    matId: "T5_METALBAR", matCount: 8, craftType: "plate_helmet",
    materials: [{ matId: "T5_METALBAR", count: 8 },
                { matId: "T5_ARTEFACT_HEAD_PLATE_AVALON", count: 1 }] },
];
const recipeCache = {};
let expandedCraftItems = new Set();
`;

// Deterministic pricing/toggle stubs. Loaded AFTER js/utils.js, so these
// function declarations override its document-backed ones — EXCEPT the focus
// pipeline (getFocusCost → focusSpecMultiplier → getItemFCE), which stays real:
// reading the ambient spec scope inside it is exactly what is under test.
const STUBS = `
function isFocusEnabled() { return true; }          // focus-on benchmark on both paths
function isBlackRedZoneEnabled() { return false; }
function isInvalidCrossRoute() { return false; }    // every leg reachable
function isValidSourceCity() { return true; }
function getCityForce() { return null; }
function getOverridePrice() { return null; }
function getIQRBounds() { return { upper: Infinity }; }
function getBuyPrice(itemData, city) {
  return (itemData && itemData[city] && itemData[city].buy_price) || 0;
}
function getSellPrice(itemData, city) {
  return (itemData && itemData[city] && itemData[city].sell_price) || 0;
}
function calcStationFeeSilver() { return 900; }     // flat fixture station fee
`;

// The paint capture, LAST so the function declarations override the real DOM
// writers: both render paths hand their DEDUPED row data to exactly this one
// seam, so the tests compare what each path actually computed.
const POSTLUDE = `
let __paintedCrafting = null;
let __paintedPlanner = null;
function paintCraftingRows(dedupedRowData) { __paintedCrafting = dedupedRowData; }
function _cpPaintRows(rows) { __paintedPlanner = rows; }

module.exports = {
  renderCraftingTable, renderCraftingTableChunked,
  renderCraftPlannerTable, renderCraftPlannerTableChunked,
  withSpecScope, currentSpecScope, setAllSpecLevels, resetSpecLevels,
  getItemFCE, getCraftFocusCost,
  craftRows: () => __paintedCrafting,
  plannerRows: () => __paintedPlanner,
  store: __specStore,
};
`;

// The Crafting table's Silver/Focus math shares marginalSilverPerFocus with
// the planner's craft-focus step; lift the real definition out of
// js/refining-route.js (tests/helpers/craft-planner-render-harness.cjs does
// the same — the rest of that file is display code the planner never calls).
const MARGINAL_SPF_SRC = (() => {
  const m = J("js/refining-route.js").match(/function marginalSilverPerFocus\([\s\S]*?\n}\n/);
  if (!m) throw new Error("marginalSilverPerFocus not found in js/refining-route.js");
  return m[0];
})();

const SOURCE = [
  PRELUDE,
  J("js/data-city-bonuses.js"),      // CITY_CRAFT_SPEC, bonus constants
  J("js/focus-costs.js"),            // const FOCUS_COSTS (items.xml data)
  J("js/focus-spec-nodes.js"),       // node catalog + level store + withSpecScope
  J("js/focus-spec-items.js"),
  J("js/focus-spec.js"),
  (J("js/calculations.js") + J("js/calculations-margins.js")),           // real PREMIUM_TAX/SETUP_FEE, RRR, focus bar math
  (J("js/utils.js") + J("js/utils-item-ids.js") + J("js/utils-overrides.js") + J("js/utils-focus-fees.js")),                  // real getFocusCost → focusSpecMultiplier pipeline
  STUBS,
  J("js/focus-play.js"),             // makeFocusPlay / pickBestFocusPlay / focusPlayRate
  J("js/refining-chain-recipes.js"),
  J("js/refining-chain-pricing.js"),
  J("js/refining-chain-focus.js"),
  J("js/data-transmute.js"),
  J("js/refining-transmute-substitute.js"),
  MARGINAL_SPF_SRC,
  J("js/craft-planner-quality.js"),  // quality-book reads in computeCraftPlannerRow
  J("js/craft-planner-pricing.js"),  // computeCraftPlannerRow
  J("js/craft-planner-dedupe.js"),
  J("js/render-crafting.js"),        // the real per-item helpers both crafting paths share
  J("js/render-crafting-chunked.js"),
  J("js/render-craft-planner.js"),
  POSTLUDE,
].join("\n");

const mod = new Module("spec-scope-chunked-render-test");
mod._compile(SOURCE, "spec-scope-chunked-render.sandbox.js");
const X = mod.exports;

// ─── fixtures ───────────────────────────────────────────────────────────────

// Raw items.xml figure (js/focus-costs.js). The LIVE getCraftFocusCost already
// applies the empty scope's mastery default, so the base comes from the data.
const BASE_FOCUS = require(path.join(ROOT, "js", "focus-costs.json"))["T4_HEAD_PLATE_AVALON"];
const SCOPED_FOCUS = 429 * Math.pow(0.5, 4.45);   // all-100: FCE 44,500 → ≈ 19.63
const EMPTY_FOCUS = 429 * Math.pow(0.5, 0.3);     // default: FCE  3,000 → ≈ 348.46
const near = (a, b, tol = 0.1) => Math.abs(a - b) <= tol;

/** Simulated price map. Ore is priced absurdly high so the planner's refine
 *  ladder never beats buying the bar: the only focus candidate left is the
 *  craft step, whose focus cost is the spec-scope-sensitive figure. */
function marketData() {
  const leg = (buy, sell) => ({ buy_price: buy, sell_price: sell, volume_24h: 9999 });
  return {
    T3_ORE: { "Fort Sterling": leg(9999, 9999), Caerleon: leg(9999, 9999) },
    T4_ORE: { "Fort Sterling": leg(9999, 9999), Caerleon: leg(9999, 9999) },
    T5_ORE: { "Fort Sterling": leg(9999, 9999), Caerleon: leg(9999, 9999) },
    T4_METALBAR: { "Fort Sterling": leg(200, 210), Caerleon: leg(200, 210) },
    T5_METALBAR: { "Fort Sterling": leg(320, 330), Caerleon: leg(320, 330) },
    T4_ARTEFACT_HEAD_PLATE_AVALON: { "Fort Sterling": leg(10000, 10010), Caerleon: leg(10000, 10010) },
    T5_ARTEFACT_HEAD_PLATE_AVALON: { "Fort Sterling": leg(12000, 12010), Caerleon: leg(12000, 12010) },
    T4_HEAD_PLATE_AVALON: { "Fort Sterling": leg(1, 90000), Caerleon: leg(1, 85000) },
    T5_HEAD_PLATE_AVALON: { "Fort Sterling": leg(1, 120000), Caerleon: leg(1, 110000) },
  };
}

/** Reset both tables' levels (the real API also drops the FCE memo per scope). */
function resetScopes() {
  X.resetSpecLevels("crafting-table");
  X.resetSpecLevels("craft-planner-table");
}

/** Focus-relevant projection of the crafting rows, in a stable order. */
function craftView() {
  return (X.craftRows() || []).map((r) => ({
    id: r.item.id, city: r.craftCity, focusCost: r.focusCost,
    focusMats: r.focusMats, profitPer10kFocus: r.profitPer10kFocus,
  })).sort((a, b) => (a.id + a.city).localeCompare(b.id + b.city));
}

/** Focus-relevant projection of the priced planner rows. */
function plannerView() {
  return (X.plannerRows() || []).filter((r) => !r.noData && r.focusPerCraft > 0).map((r) => ({
    id: r.item.id, city: r.craftCity, focusPerCraft: r.focusPerCraft,
    stepFocus: r.bestFocusStep ? r.bestFocusStep.focusCost : null,
    craftsPer10kFocus: r.craftsPer10kFocus, profitPer10kFocus: r.profitPer10kFocus,
  })).sort((a, b) => (a.id + a.city).localeCompare(b.id + b.city));
}

/** budgetMs 0 + a frozen clock: a yield between every pair of items, so the
 *  chunked pass really crosses await boundaries. */
const chunkOpts = () => ({ budgetMs: 0, now: () => 0, yieldTo: async () => {} });

// ─── scenarios ──────────────────────────────────────────────────────────────

(async () => {

await test("fixture sanity: the focus data and the scoped SYNC crafting path agree", () => {
  assert.strictEqual(BASE_FOCUS, 429, "T4_HEAD_PLATE_AVALON base focus (js/focus-costs.js)");
  assert.strictEqual(X.getItemFCE("T4_HEAD_PLATE_AVALON", ""), 3000, "empty scope = mastery 100 only");
  resetScopes();
  X.setAllSpecLevels("crafting-table", 100);
  assert.strictEqual(X.getItemFCE("T4_HEAD_PLATE_AVALON", "crafting-table"), 44500,
    "all-100 crafting-table levels → FCE 44,500 (weights sum 4.45/level)");

  X.withSpecScope("crafting-table", () => X.renderCraftingTable(marketData()));
  const rows = craftView();
  assert.ok(rows.length >= 4, "both items price a royal and a Caerleon row");
  const scopedFor = (id) => (id === "T4_HEAD_PLATE_AVALON" ? SCOPED_FOCUS : 750 * Math.pow(0.5, 4.45));
  rows.forEach((r) => {
    assert.ok(near(r.focusCost, scopedFor(r.id)),
      `${r.id}@${r.city}: scoped sync focus ${r.focusCost} ≈ ${scopedFor(r.id).toFixed(2)}`);
    assert.ok(r.focusCost !== EMPTY_FOCUS, "the scoped numbers are not the empty-scope ones");
  });
  assert.strictEqual(X.currentSpecScope(), null, "withSpecScope restored the ambient scope");
});

await test("fixture sanity: the scoped SYNC planner path reads craft-planner-table", () => {
  resetScopes();
  X.setAllSpecLevels("craft-planner-table", 100);
  X.withSpecScope("craft-planner-table", () => X.renderCraftPlannerTable(marketData()));
  const rows = plannerView();
  assert.ok(rows.length >= 2, "both helmets price at least one row each");
  rows.forEach((r) => {
    assert.strictEqual(r.stepFocus, r.focusPerCraft, "the craft step carries the focus cost");
    assert.ok(near(r.focusPerCraft, r.id === "T4_HEAD_PLATE_AVALON" ? SCOPED_FOCUS : 750 * Math.pow(0.5, 4.45)),
      `${r.id}@${r.city}: scoped sync focusPerCraft ${r.focusPerCraft}`);
  });
});

await test("crafting parity: the chunked path must read the crafting-table levels", async () => {
  resetScopes();
  // The empty-scope result is what the bug falls back to — the scoped levels
  // must move BOTH paths away from it.
  X.renderCraftingTable(marketData());
  const emptyView = craftView();
  assert.ok(near(emptyView[0].focusCost, EMPTY_FOCUS), "no scope set → default-level focus");

  X.setAllSpecLevels("crafting-table", 100);
  X.withSpecScope("crafting-table", () => X.renderCraftingTable(marketData()));
  const syncView = craftView();
  assert.notDeepStrictEqual(syncView, emptyView, "control: the scoped levels change the numbers");

  assert.strictEqual(X.currentSpecScope(), null,
    "the scheduler call site runs with no ambient scope");
  await X.renderCraftingTableChunked(marketData(), chunkOpts());
  const chunkedView = craftView();

  assert.notDeepStrictEqual(chunkedView, emptyView,
    "chunked rows must not be priced at the empty scope");
  assert.deepStrictEqual(chunkedView, syncView,
    "chunked rows must equal the scoped sync rows (focusCost " +
    `${chunkedView[0].focusCost.toFixed(2)} vs ${syncView[0].focusCost.toFixed(2)})`);
});

await test("craft planner parity: the chunked path must read craft-planner-table", async () => {
  resetScopes();
  X.renderCraftPlannerTable(marketData());
  const emptyView = plannerView();
  assert.ok(near(emptyView[0].focusPerCraft, EMPTY_FOCUS), "no scope set → default-level focus");

  X.setAllSpecLevels("craft-planner-table", 100);
  X.withSpecScope("craft-planner-table", () => X.renderCraftPlannerTable(marketData()));
  const syncView = plannerView();
  assert.notDeepStrictEqual(syncView, emptyView, "control: the scoped levels change the numbers");

  await X.renderCraftPlannerTableChunked(marketData(), chunkOpts());
  const chunkedView = plannerView();

  assert.notDeepStrictEqual(chunkedView, emptyView,
    "chunked planner rows must not be priced at the empty scope");
  assert.deepStrictEqual(chunkedView, syncView,
    "chunked planner rows must equal the scoped sync rows (focusPerCraft " +
    `${chunkedView[0].focusPerCraft.toFixed(2)} vs ${syncView[0].focusPerCraft.toFixed(2)})`);
});

await test("absolute pin: chunked focus = 429 × 0.5^4.45 ≈ 19.63, not 429 × 0.5^0.3 ≈ 348.46", async () => {
  resetScopes();
  X.setAllSpecLevels("crafting-table", 100);
  await X.renderCraftingTableChunked(marketData(), chunkOpts());
  craftView().filter((r) => r.id === "T4_HEAD_PLATE_AVALON").forEach((r) => {
    assert.ok(near(r.focusCost, SCOPED_FOCUS),
      `chunked focusCost ${r.focusCost.toFixed(2)} must be ≈ ${SCOPED_FOCUS.toFixed(2)}`);
    assert.ok(!near(r.focusCost, EMPTY_FOCUS, 1),
      `chunked focusCost ${r.focusCost.toFixed(2)} must not be the empty-scope ${EMPTY_FOCUS.toFixed(2)}`);
    // Profit / 10k Focus moves with the focus cost: ~509 crafts per bar, not ~28.
    assert.ok(r.profitPer10kFocus > 0, "a profitable focus craft prices its bar");
  });

  X.setAllSpecLevels("craft-planner-table", 100);
  await X.renderCraftPlannerTableChunked(marketData(), chunkOpts());
  plannerView().filter((r) => r.id === "T4_HEAD_PLATE_AVALON").forEach((r) => {
    assert.ok(near(r.focusPerCraft, SCOPED_FOCUS),
      `chunked focusPerCraft ${r.focusPerCraft.toFixed(2)} must be ≈ ${SCOPED_FOCUS.toFixed(2)}`);
    assert.strictEqual(r.craftsPer10kFocus, 509,
      `a 10k bar buys 509 crafts at ${SCOPED_FOCUS.toFixed(2)} focus, not ${r.craftsPer10kFocus}`);
  });
});

await test("persistence independence: no ambient scope anywhere, still the scoped numbers", async () => {
  resetScopes();
  X.setAllSpecLevels("crafting-table", 100);
  X.setAllSpecLevels("craft-planner-table", 100);

  // Prove the ambient scope is genuinely absent DURING the chunked passes —
  // the yield runs inside the generator, between the per-item slices.
  let yields = 0;
  const noScope = async () => {
    yields++;
    assert.strictEqual(X.currentSpecScope(), null,
      "the scheduler call site must not set a spec scope");
  };
  await X.renderCraftingTableChunked(marketData(), { ...chunkOpts(), yieldTo: noScope });
  await X.renderCraftPlannerTableChunked(marketData(), { ...chunkOpts(), yieldTo: noScope });
  assert.ok(yields >= 2, "both chunked passes actually yielded across await boundaries");

  craftView().forEach((r) => {
    // Per-item scoped pin (same mapping as the sync control above): T4's base
    // is 429, T5's is 750 — one constant cannot pin both.
    const want = r.id === "T4_HEAD_PLATE_AVALON" ? SCOPED_FOCUS : 750 * Math.pow(0.5, 4.45);
    assert.ok(near(r.focusCost, want),
      `${r.id}: chunked focusCost ${r.focusCost.toFixed(2)} must be the scoped ${want.toFixed(2)}`);
  });
  plannerView().forEach((r) => {
    const want = r.id === "T4_HEAD_PLATE_AVALON" ? SCOPED_FOCUS : 750 * Math.pow(0.5, 4.45);
    assert.ok(near(r.focusPerCraft, want),
      `${r.id}: chunked focusPerCraft ${r.focusPerCraft.toFixed(2)} must be the scoped ${want.toFixed(2)}`);
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

})();
