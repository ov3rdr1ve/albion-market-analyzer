/**
 * Test: the Consumables table's "Profit / 10k Focus" column is a focus-ON
 * benchmark, invariant to the global "Use Focus" checkbox — for BOTH row kinds
 * the table renders:
 *   • cook/brew rows  — profit multiplied is `focusProfit` (revenue − input cost
 *                       at the focus-on RRR), per craft;
 *   • chain-craft rows (butcher / mill) — the FOCUS-ON batch (`profitPerBatch`,
 *                       priced at benchmarkRrr), per batch.
 *
 * A 10,000-focus bar is focus-on play by definition, so both operands of the
 * figure are focus-on. Before the fix the column paired an invariant focus cost
 * with the checkbox profit and moved when the user toggled focus.
 *
 * Also asserts WINNER INVARIANCE: the craft city and sell city a row settles on
 * are the same in both toggle states. Today that holds structurally — mat prices
 * come from getChainSourcing across the section's cities (so every candidate
 * craft city sees the same price) and cost is strictly decreasing in RRR, so the
 * highest-RRR city wins either way. If that ever stops being true (e.g. the
 * Brecilien Travel Planner fee is re-enabled — it scales with the RRR-adjusted
 * mat count), the per-10k figure could start tracking the checkbox through the
 * city pick, and this test is the alarm.
 *
 * Black-box: render the REAL renderConsumableTable against synthetic market data
 * with the "use-focus" checkbox stub flipped. No live API, no database.
 *
 * Run: node tests/consumables-per10k-focus-toggle.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

// Only the presentation seam is stubbed: the DOM, the table writer, and the
// cell/format helpers. Every figure under test comes from the real sources.
const stubs = `
const _els = { "use-focus": { checked: true }, "premium-account": { checked: true } };
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const window = { addEventListener: () => {} };
const recipeCache = {};
const expandedCraftItems = new Set();
const tableState = { "consumable-table": { data: [] } };
function renderTableData(id, rows, fmt) { tableState[id].data = rows; tableState[id].html = rows.map((r,i)=>{ try { return fmt(r,i); } catch(e){ return "ERR:"+e.message; } }); }
function priceTd(p){ return "<td>"+p+"</td>"; }
function volTd(){ return "<td></td>"; }
function profitTd(){ return "<td></td>"; }
function pureProfitTd(){ return "<td></td>"; }
function aggregateCostTd(c){ return "<td>"+c+"</td>"; }
function matPriceSpan(id, c, p){ return "<span>"+p+"</span>"; }
function addTdForKey(){ return '<td class="cell-add"></td>'; }
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
let lastMpMarketData = null, lastMarketData = null;
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
  (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) +
  // render-mounts supplies the breeding metadata the butcher chain prices with.
  J("render-mounts.js") + J("render-mounts-breeding-row.js") + J("render-mounts-craft-row.js") +
  J("render-consumable-chain-row.js") +
  J("render-consumable-no-data-row.js") +
  J("consumable-pasture-row.js") +
  J("consumable-flip-row.js") +
  J("consumable-enchant-variants.js") +
  J("consumable-city-pick.js") +
  (J("render-consumables.js") + J("render-consumables-row.js"));

const mod = new Module("consumables-per10k-focus-toggle");
mod._compile(
  stubs + sources + "\nmodule.exports = { tableState, renderConsumableTable, _els };",
  "consumables-per10k-focus-toggle.js",
);
const X = mod.exports;

// One cook/brew row (T3 Resistance Potion — a single-ingredient potion recipe)
// and one chain-craft row (T6 raw mutton, butchered from a grown sheep).
function market() {
  const md = {};
  const put = (id, c, b, s) => { (md[id] = md[id] || {})[c] = { buy_price: b, sell_price: s, volume_24h: 9999 }; };
  ["Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Brecilien"].forEach((c) => {
    put("T3_COMFREY", c, 300, 320);
    put("T3_POTION_STONESKIN", c, 900, 1000);
    put("T6_FARM_SHEEP_GROWN", c, 86000, 88000);
    put("T6_MEAT", c, 6500, 6800);
  });
  return md;
}

function rowsWithFocus(on) {
  X._els["use-focus"].checked = on;
  X.renderConsumableTable(market());
  return X.tableState["consumable-table"].data.slice();
}

const key = (r) => `${r.item && r.item.id}|${r.isChainCraft ? "chain" : r.isFlip ? "flip" : "craft"}|${r.section || ""}`;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("\n=== Consumables Profit / 10k Focus across the Use Focus toggle ===");

const ON = new Map(rowsWithFocus(true).map((r) => [key(r), r]));
const OFF = rowsWithFocus(false);
const paired = OFF.map((r) => [ON.get(key(r)), r]).filter(([a, b]) => a && b);

test("fixture sanity: both row kinds rendered with a per-10k figure", () => {
  const withFigure = OFF.filter((r) => r.profitPer10kFocus != null && r.focusCost > 0);
  assert.ok(withFigure.some((r) => r.isChainCraft), "no chain-craft row priced");
  assert.ok(withFigure.some((r) => !r.isChainCraft && !r.isFlip), "no cook/brew craft row priced");
});

test("fixture sanity: Pure Profit reacts to the checkbox", () => {
  const moved = paired.filter(([a, b]) =>
    a.marginInfo && b.marginInfo &&
    Math.abs((a.marginInfo.profit || 0) - (b.marginInfo.profit || 0)) > 1e-6);
  assert.ok(moved.length > 0, "no row changed profit — fixture cannot prove invariance");
});

test("every row's Profit / 10k Focus is identical across the toggle", () => {
  let compared = 0;
  paired.forEach(([a, b]) => {
    if (a.profitPer10kFocus == null || b.profitPer10kFocus == null) return;
    compared++;
    assert.ok(Math.abs(a.profitPer10kFocus - b.profitPer10kFocus) < 1e-6,
      `${key(b)}: moved with the checkbox (${a.profitPer10kFocus} → ${b.profitPer10kFocus})`);
  });
  assert.ok(compared > 0, "no rows carried a per-10k figure to compare");
});

test("cook/brew rows price the FOCUS-ON craft (profitFocusOn × crafts)", () => {
  const crafts = OFF.filter((r) => !r.isChainCraft && !r.isFlip &&
    r.focusCost > 0 && r.profitPer10kFocus != null);
  assert.ok(crafts.length > 0, "no cook/brew row with a focus cost");
  crafts.forEach((r) => {
    const n = Math.floor(10000 / r.focusCost);
    assert.ok(Math.abs(r.profitPer10kFocus - r.profitFocusOn * n) < 1e-6,
      `${key(r)}: figure does not reproduce profitFocusOn × ${n}`);
  });
});

test("chain-craft rows price the FOCUS-ON batch (profitFocusOn × batches)", () => {
  const chains = OFF.filter((r) => r.isChainCraft && r.focusCost > 0 && r.profitPer10kFocus != null);
  assert.ok(chains.length > 0, "no chain-craft row with a focus cost");
  chains.forEach((r) => {
    const n = Math.floor(10000 / r.focusCost);
    assert.ok(Math.abs(r.profitPer10kFocus - r.profitFocusOn * n) < 1e-6,
      `${key(r)}: figure does not reproduce the focus-on batch × ${n}`);
  });
  // A batch is many units (18 meat per animal), so on a priced row the batch
  // profit must not be the per-unit profit.
  const pricedChains = chains.filter((r) => r.sellPot && r.sellPot.price > 0);
  assert.ok(pricedChains.length > 0, "fixture priced no chain row");
  pricedChains.forEach((r) => {
    assert.ok(Math.abs(r.profitFocusOn - (r.marginInfo.profit || 0)) > 1e-6,
      `${key(r)}: chain rows must multiply a per-BATCH profit, not the per-unit one`);
  });
});

test("with focus OFF the focus-ON profit beats the displayed one (focus cuts cost)", () => {
  const rows = OFF.filter((r) => !r.isFlip && r.profitFocusOn != null &&
    r.marginInfo && typeof r.marginInfo.profit === "number" && r.marginInfo.margin !== -1 &&
    r.focusCost > 0 && !r.isChainCraft);
  assert.ok(rows.length > 0, "no valued cook/brew row");
  rows.forEach((r) => {
    assert.ok(r.profitFocusOn > r.marginInfo.profit,
      `${key(r)}: focus-on profit ${r.profitFocusOn} should exceed the focus-off ${r.marginInfo.profit}`);
  });
});

// Winner invariance — see the header comment. If the route a row settles on
// stopped being focus-invariant, the per-10k figure would move with it even
// though every operand is focus-on.
test("the winning craft city and sell city do not move with the checkbox", () => {
  let compared = 0;
  paired.forEach(([a, b]) => {
    if (a.marginInfo?.margin === -1 || b.marginInfo?.margin === -1) return;
    compared++;
    assert.strictEqual(b.craftCity, a.craftCity, `${key(b)}: craft city flipped with the checkbox`);
    assert.strictEqual(b.sellPot?.city, a.sellPot?.city, `${key(b)}: sell city flipped with the checkbox`);
  });
  assert.ok(compared > 0, "no valued rows to compare");
});

test("no row template threw while rendering", () => {
  const bad = (X.tableState["consumable-table"].html || []).filter((h) => h.includes("ERR:"));
  assert.deepStrictEqual(bad, []);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
