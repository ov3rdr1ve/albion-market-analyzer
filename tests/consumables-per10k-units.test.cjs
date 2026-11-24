/**
 * Test: the Consumables "Profit / 10k Focus" figure on a BATCH-yield row, pinned
 * end-to-end against the reported screenshot row — Minor Gigantify Potion [T3],
 * 8× Brightleaf Comfrey [T3.1] @ 304, crafted in Brecilien, sold in Lymhurst @
 * 1,245, maxed alchemy spec (⚙ all 100).
 *
 * items.xml charges craftingfocus PER OUTPUT UNIT, and the row prices everything
 * per single unit, so a 10,000-focus bar buys floor(10000/focusCost) UNITS. For a
 * yields-5 recipe that is 8,081 units = 1,616 craft ACTIONS. The figure must
 * multiply the per-unit focus-on profit by the whole-unit count — never a
 * per-batch profit, never an inflated count.
 *
 * Also pins the shopping-list wording: "8,081x crafts" mislabeled those units;
 * the craft actions are 8,081 / 5 = 1,616.
 *
 * Run: node tests/consumables-per10k-units.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

// Same presentation seam as tests/consumables-per10k-focus-toggle.test.cjs, plus
// the REAL focus-spec stack and the real yield map, so the focus cost, the RRR
// and the batch output all come from the shipped data.
const stubs = `
const _els = { "use-focus": { checked: true }, "premium-account": { checked: true } };
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const window = { addEventListener: () => {} };
const recipeCache = {};
const expandedCraftItems = new Set();
const tableState = { "consumable-table": { data: [] } };
function renderTableData(id, rows, fmt) { tableState[id].data = rows; tableState[id].html = rows.map((r,i)=>{ try { return fmt(r,i); } catch(e){ return "ERR:"+e.message; } }); }
function priceTd(){ return ""; }
function volTd(){ return ""; }
function profitTd(){ return ""; }
function pureProfitTd(){ return ""; }
function aggregateCostTd(){ return ""; }
function matPriceSpan(){ return ""; }
function addTdForKey(){ return ""; }
function getRowKey(row){ return (row.item && row.item.id) + "|" + (row.section || ""); }
function getProfitClass(){ return ""; }
function dispName(id, name){ return name || id; }
function tx(en){ return en; }
function focusSpecMark(){ return ""; }
function focusSpecTitle(){ return ""; }
function renderConsumableIngredients(){ return ""; }
function renderChainBreakdown(){ return ""; }
function getItemDisplayName(id){ return id; }
const ITEM_NAMES_MAP = {};
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
const CRAFTING_ITEMS = [], FLIPPING_ITEMS = [], TRANSPORT_ITEMS = [], FARMING_ITEMS = [], ARTIFACT_FLIP_ITEMS = [], GEAR_CAPES = [];
`;
const sources =
  J("route-cell.js") +
  J("focus-play.js") +
  J("data-faction-fp-costs.js") +
  J("focus-costs.js") +
  J("data-mounts.js") +
  J("data-consumables.js") +
  J("data-enchant-sauces.js") +
  J("recipes.js") +
  J("recipe-resolver.js") +
  J("chain-recipes.js") +
  J("chain-pricing.js") +
  J("data-city-bonuses.js") +
  (J("calculations.js") + J("calculations-margins.js")) +
  J("travel-cost.js") +
  J("mp-bonus.js") +
  J("focus-spec-nodes.js") +
  J("focus-spec-items.js") +
  J("focus-spec.js") +
  J("consumable-output.js") +
  (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) +
  J("render-mounts.js") + J("render-mounts-breeding-row.js") + J("render-mounts-craft-row.js") +
  J("render-consumable-chain-row.js") +
  J("render-consumable-no-data-row.js") +
  J("consumable-pasture-row.js") +
  J("consumable-flip-row.js") +
  J("consumable-enchant-variants.js") +
  J("consumable-city-pick.js") +
  (J("render-consumables.js") + J("render-consumables-row.js"));

const mod = new Module("consumables-per10k-units");
mod._compile(
  stubs + sources + "\nmodule.exports = { tableState, renderConsumableTable, _els, recipeCache, setAllSpecLevels, withSpecScope, getFocusCost, getRecipeOutput };",
  "consumables-per10k-units.js",
);
const X = mod.exports;

// The screenshot's ⚙ panel: every alchemy node maxed → potions pay ~2.21% of base
X.setAllSpecLevels("consumable-table", 100);
// The live recipe parse for the base T3 gigantify potion: 8 enchanted herbs.
X.recipeCache["T3_POTION_REVIVE"] = [{ matId: "T3_COMFREY@1", count: 8 }];

// Brightleaf Comfrey @ 304 everywhere; the potion only has a sell market in
// Lymhurst (0 = no listing elsewhere) so the winning route is Brecilien →
// Lymhurst, exactly like the screenshot row. A single-city price pool also
// keeps the IQR outlier gate from rejecting the lone ask.
function market() {
  const md = {};
  const put = (id, c, b, s) => { (md[id] = md[id] || {})[c] = { buy_price: b, sell_price: s, volume_24h: 9999 }; };
  ["Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Brecilien"].forEach((c) => {
    put("T3_COMFREY@1", c, 304, 304);
    put("T3_POTION_REVIVE", c, 90, 0);
  });
  put("T3_POTION_REVIVE", "Lymhurst", 1200, 1245);
  return md;
}

function rowsWithFocus(on) {
  X._els["use-focus"].checked = on;
  X.withSpecScope("consumable-table", () => X.renderConsumableTable(market()));
  return X.tableState["consumable-table"].data;
}

function gigantifyRow(on) {
  return rowsWithFocus(on).find((r) =>
    r.item && r.item.id === "T3_POTION_REVIVE" && !r.isFlip
    && r.section === "royal" && r.marginInfo && r.marginInfo.margin !== -1);
}

function gigantifyHtml(on) {
  X._els["use-focus"].checked = on;
  X.withSpecScope("consumable-table", () => X.renderConsumableTable(market()));
  const data = X.tableState["consumable-table"].data;
  const i = data.findIndex((r) =>
    r.item && r.item.id === "T3_POTION_REVIVE" && !r.isFlip
    && r.section === "royal" && r.marginInfo && r.marginInfo.margin !== -1);
  return (X.tableState["consumable-table"].html || [])[i] || "";
}

const close = (a, b, eps) => Math.abs(a - b) < eps;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}
console.log("\n=== Consumables Profit / 10k Focus on a batch-yield row ===");

test("fixture reproduces the screenshot route (Brecilien → Lymhurst @ 1,245)", () => {
  const r = gigantifyRow(true);
  assert.ok(r, "no gigantify craft row rendered");
  assert.strictEqual(r.craftCity, "Brecilien");
  assert.strictEqual(r.sellPot.city, "Lymhurst");
  assert.strictEqual(r.sellPot.price, 1245);
});

test("focus cost is the real per-unit charge (56 base × maxed alchemy mult)", () => {
  const r = gigantifyRow(true);
  const fc = X.withSpecScope("consumable-table", () => X.getFocusCost("T3_POTION_REVIVE", 3, "crafting"));
  assert.strictEqual(r.focusCost, fc);
  assert.ok(close(fc, 1.2374, 1e-3), `focus cost ${fc} should be ~1.2374 at maxed spec`);
});

test("a bar buys 8,081 UNITS — 1,616 craft actions of a yields-5 recipe", () => {
  const r = gigantifyRow(true);
  const units = Math.floor(10000 / r.focusCost);
  assert.strictEqual(units, 8081);
  assert.strictEqual(X.getRecipeOutput("T3_POTION_REVIVE"), 5);
  assert.strictEqual(Math.floor(units / 5), 1616);
});

test("the figure is per-unit focus-on profit × whole units (exactly)", () => {
  const r = gigantifyRow(true);
  const units = Math.floor(10000 / r.focusCost);
  assert.ok(Math.abs(r.profitPer10kFocus - r.profitFocusOn * units) < 1e-6,
    `per10k ${r.profitPer10kFocus} != profitFocusOn ${r.profitFocusOn} × ${units}`);
});

test("the focus-on profit matches the hand model (904.41 @ input 259.67)", () => {
  const r = gigantifyRow(true);
  // revenue 1245 × (1 − 6.5%) = 1164.075; input 8 × (1 − 47.92%) / 5 × 304 × 1.025
  assert.ok(close(r.totalInputCost, 259.667, 2), `input cost ${r.totalInputCost}`);
  assert.ok(close(r.profitFocusOn, 904.408, 2), `focus-on profit ${r.profitFocusOn}`);
});

test("the figure never exceeds the row's whole-bar revenue ceiling", () => {
  const r = gigantifyRow(true);
  const units = Math.floor(10000 / r.focusCost);
  const ceiling = 1245 * 0.935 * units; // every unit sold at the ask, tax only
  assert.ok(r.profitPer10kFocus <= ceiling,
    `per10k ${r.profitPer10kFocus} exceeds revenue ceiling ${ceiling}`);
  // and pins the absolute value the shipped data must produce
  assert.ok(Math.abs(r.profitPer10kFocus - 7308524) < 2000,
    `per10k ${r.profitPer10kFocus} drifted from the pinned 7,308,524`);
});

test("the figure is invariant to the Use Focus checkbox", () => {
  const on = gigantifyRow(true);
  const off = gigantifyRow(false);
  assert.ok(Math.abs(on.profitPer10kFocus - off.profitPer10kFocus) < 1e-6,
    "a full bar is focus-on play either way");
});

test("the shopping-list label says UNITS with the craft actions in parens", () => {
  const html = gigantifyHtml(true);
  assert.ok(/8,081x units/.test(html), `expected "8,081x units" in: ${html}`);
  assert.ok(/\(1,616x crafts\)/.test(html), `expected "(1,616x crafts)" in: ${html}`);
  assert.ok(!/8,081x\s*crafts/.test(html), "the units count must not be labeled 'crafts'");
});

test("the per-10k tooltip quotes per-unit operands for a batch row", () => {
  const html = gigantifyHtml(true);
  assert.ok(/profit\/unit/.test(html), `expected a per-unit tooltip in: ${html}`);
  assert.ok(/8,081 units/.test(html), "tooltip must quote the whole-unit count");
  assert.ok(!/8,081 crafts/.test(html), "tooltip must not call the units 'crafts'");
});

test("no row template threw while rendering", () => {
  const bad = (X.tableState["consumable-table"].html || []).filter((h) => h.includes("ERR:"));
  assert.deepStrictEqual(bad, []);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);