/**
 * Test: the Consumables table's Pure Profit twin — plan.md step 1 (TDD red).
 *
 * All three consumables row shapes gain the self-gathered twin (plan.md
 * per-table rules): every ingredient (crops / meat / fish / alchemy inputs) is
 * zeroed; station fee (none on these rows), taxes and any non-ingredient
 * silver (the Brecilien haul-out leg) are kept:
 *
 *   selfFoundProfit = sellPrice × (1 − PREMIUM_TAX) − keptSilverCosts
 *
 *   a. single craft row (T4_POTION_HEAL: 24 herbs + 6 eggs, both gatherable)
 *   b. chain craft row (the milk pasture: 9 turnips per cycle)
 *   c. alt-routes row (consumableAltRoutes: the per-ingredient "make it
 *      yourself" blocks) — the twin of an alt zeroes THAT ingredient's whole
 *      market cost (marketPerUnit × consumedCount × (1 + SETUP_FEE)) on top of
 *      the row's profit, the same per-output-unit basis altProfit uses. With
 *      every input self-gathered the chain vs market choice disappears, so the
 *      twin is independent of chainPerUnit.
 *
 * Black-box: render the REAL renderConsumableTable against synthetic market
 * data (harness mirrors tests/consumables-pasture-row.test.cjs) and assert row
 * fields; drive the REAL consumableAltRoutes (js/render-consumable-alt-routes.js)
 * with a synthetic row. Prices equal in every city, so the fixture's sell leg
 * never hauls (brecilienFee 0) and the hand values stay literal.
 *
 * Tax getter control (repo convention): the live PREMIUM_TAX getter resolves
 * the #premium-account checkbox stub — the pasture-row test flips exactly this
 * element. Market orders keep SETUP_FEE at 0.025.
 *
 * RED BY DESIGN: no renderer writes selfFoundProfit yet, so every twin
 * assertion fails on the missing field. The primary-profit and alt-math
 * assertions are regressions and pass before AND after.
 *
 * Run: node --test tests/consumables-self-found-profit.test.cjs
 */

const assert = require("assert");
const { test } = require("node:test");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const J = (f) => fs.readFileSync(path.join(ROOT, "js", f), "utf8").replace(/\r\n/g, "\n");

// ── a + b: the real renderConsumableTable ────────────────────────────────────

// Only the presentation seam is stubbed (same shim set as
// tests/consumables-pasture-row.test.cjs); every figure under test comes from
// the real sources.
const stubs = `
const _els = { "use-focus": { checked: true }, "premium-account": { checked: true }, "station-fee": { value: "0" } };
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
function renderChainBreakdown(chain, out){ return ""; }
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
  J("data-farming.js") +
  J("recipes.js") +
  J("recipe-resolver.js") +
  J("chain-recipes.js") +
  J("pasture-econ.js") +
  J("chain-pricing.js") +
  J("data-city-bonuses.js") +
  (J("calculations.js") + J("calculations-margins.js")) +
  J("self-found-profit.js") +
  J("travel-cost.js") +
  J("mp-bonus.js") +
  (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) +
  J("render-mounts.js") + J("render-mounts-breeding-row.js") + J("render-mounts-craft-row.js") +
  J("consumable-pasture-row.js") +
  J("render-consumable-chain-row.js") +
  J("render-consumable-no-data-row.js") +
  J("consumable-flip-row.js") +
  J("consumable-enchant-variants.js") +
  J("consumable-city-pick.js") +
  (J("render-consumables.js") + J("render-consumables-row.js"));

const mod = new Module("consumables-self-found-profit");
mod._compile(
  stubs + sources + "\nmodule.exports = { tableState, renderConsumableTable, _els, SETUP_FEE, getRecipeOutput," +
    " fees: { premiumTax: () => PREMIUM_TAX } };",
  "consumables-self-found-profit.js",
);
const X = mod.exports;

const FEED_PRICE = 100;
const ANIMAL_PRICE = 250000; // the goat is capital, never in the cycle
const POTION_SELL = 2000;

function market() {
  const md = {};
  const put = (id, c, b, s) => { (md[id] = md[id] || {})[c] = { buy_price: b, sell_price: s, volume_24h: 9999 }; };
  ["Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Brecilien"].forEach((c) => {
    put("T4_TURNIP", c, FEED_PRICE, FEED_PRICE + 10);
    put("T4_MILK", c, 400, 420);            // the pasture's produce
    put("T4_FARM_GOAT_GROWN", c, ANIMAL_PRICE, ANIMAL_PRICE + 1000);
    put("T4_BURDOCK", c, 50, 55);           // potion herb
    put("T3_EGG", c, 300, 320);             // potion binder (pasture byproduct)
    put("T4_POTION_HEAL", c, 1000, POTION_SELL);
  });
  return md;
}

function render() {
  X._els["premium-account"].checked = true;
  X.renderConsumableTable(market());
  const state = X.tableState["consumable-table"];
  return { data: state.data.slice(), html: state.html.slice() };
}

function rowFor(state, id) {
  return state.data.find((r) => r.item && r.item.id === id);
}

// The twin lands on marginInfo.selfFoundProfit; accept a row field (plan.md
// allows either shape).
const sfOf = (row) => {
  if (row.marginInfo && row.marginInfo.selfFoundProfit !== undefined) {
    return row.marginInfo.selfFoundProfit;
  }
  return row.selfFoundProfit;
};

const near = (a, b) => Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-9);

const PREMIUM = render();

// ── a. the single craft row ──────────────────────────────────────────────────

test("fixture sanity: T4_POTION_HEAL is a plain craft row (no chain, no flip)", () => {
  const row = rowFor(PREMIUM, "T4_POTION_HEAL");
  assert.ok(row, "no potion row rendered");
  assert.ok(!row.isFlip, "the potion must not render as a flip");
  assert.ok(!row.isChainCraft, "the potion must not render as a chain craft");
  assert.ok(row.recipe && row.recipe.length >= 2, "the potion renders through its recipe");
  assert.ok(row.sellPot.price === POTION_SELL, "sell price injected");
});

test("single craft row: twin zeroes herbs and eggs, keeps taxes (and any haul leg)", () => {
  const row = rowFor(PREMIUM, "T4_POTION_HEAL");
  // Both ingredients are gatherable/farmable → zeroed. Kept: the sell tax and
  // the row's own haul-out leg (0 in this fixture — prices are equal everywhere,
  // so the best sale never hauls).
  const want = POTION_SELL * (1 - X.fees.premiumTax()) - (row.brecilienFee || 0);
  assert.strictEqual(typeof sfOf(row), "number",
    "marginInfo.selfFoundProfit missing on the single craft row (feature not implemented)");
  assert.ok(near(sfOf(row), want), `twin ${sfOf(row)} != ${want} (1859 + kept legs)`);
  assert.ok(row.marginInfo.profit < sfOf(row),
    `twin ${sfOf(row)} must exceed the bought profit ${row.marginInfo.profit}`);
});

test("single craft row: regression, the bought profit keeps today's formula", () => {
  const row = rowFor(PREMIUM, "T4_POTION_HEAL");
  const PRICES = { T4_BURDOCK: 50, T3_EGG: 300 };
  const rrr = row.rrr;
  const recipeOutput = X.getRecipeOutput ? X.getRecipeOutput(row.item.id) || 1 : 1;
  let mats = 0;
  row.recipe.forEach((m) => {
    const price = PRICES[m.matId] || 0;
    const eff = (m.noReturn ? m.count : m.count * (1 - rrr)) / recipeOutput;
    mats += price * eff * (1 + X.SETUP_FEE);
  });
  const want = POTION_SELL * (1 - X.fees.premiumTax()) - mats - (row.brecilienFee || 0);
  assert.ok(near(row.marginInfo.profit, want),
    `primary profit ${row.marginInfo.profit} drifted from the hand formula ${want}`);
});

test("single craft row Profit / 10k Focus: gathered line = the twin × the bar", () => {
  const i = PREMIUM.data.findIndex((r) => r.item && r.item.id === "T4_POTION_HEAL");
  const row = PREMIUM.data[i];
  assert.ok(row.focusCost > 0, "fixture precondition: the potion is focus-craftable");
  const bar = row.focusCost > 10000 ? 10000 / row.focusCost : Math.floor(10000 / row.focusCost);
  assert.ok(near(row.profitFocusOnGathered, sfOf(row)), "gathered operand is not the row's twin");
  assert.ok(near(row.profitPer10kFocusGathered, sfOf(row) * bar),
    `profitPer10kFocusGathered ${row.profitPer10kFocusGathered} != ${sfOf(row) * bar}`);
  assert.ok(row.profitPer10kFocusGathered > row.profitPer10kFocus, "gathered bar must beat the bought bar");
  assert.ok(/>gathered [^<]+<\/small>/.test(PREMIUM.html[i]), "the potion's p10k cell has no gathered line");
});

// ── b. the chain craft row (pasture) ─────────────────────────────────────────

test("fixture sanity: the milk row is a pasture chain row", () => {
  const row = rowFor(PREMIUM, "T4_MILK");
  assert.ok(row, "no milk row rendered");
  assert.strictEqual(row.isChainCraft, true);
  assert.strictEqual(row.chainStation, "pasture");
});

test("chain craft row: twin zeroes the feed, keeps taxes (and any haul leg)", () => {
  const row = rowFor(PREMIUM, "T4_MILK");
  // 420 x (1 - 0.065) = 392.7 per milk. The 9-turnip feed and its setup fee
  // are gone; the goat stays capital, outside every figure.
  const want = 420 * (1 - X.fees.premiumTax()) - (row.brecilienFee || 0);
  assert.strictEqual(typeof sfOf(row), "number",
    "marginInfo.selfFoundProfit missing on the chain craft row (feature not implemented)");
  assert.ok(near(sfOf(row), want), `twin ${sfOf(row)} != ${want}`);
  assert.ok(row.totalInputCost > 0, "fixture precondition: the bought cycle costs something");
  assert.ok(row.marginInfo.profit < sfOf(row),
    `twin ${sfOf(row)} must exceed the bought profit ${row.marginInfo.profit}`);
});

test("chain craft row: regression, the bought profit is revenue minus the fed cycle", () => {
  const row = rowFor(PREMIUM, "T4_MILK");
  const cycleCostPerUnit = (9 * FEED_PRICE * (1 + X.SETUP_FEE)) / row.effectiveOutput;
  const want = 420 * (1 - X.fees.premiumTax()) - cycleCostPerUnit - (row.brecilienFee || 0);
  assert.ok(near(row.marginInfo.profit, want),
    `primary profit ${row.marginInfo.profit} drifted from the hand formula ${want}`);
});

// ── c. the alt-routes row ────────────────────────────────────────────────────

// consumableAltRoutes is a pure-data module: stand up the live SETUP_FEE getter
// next to it (the block math multiplies by it), then drive a synthetic row.
const altMod = new Module("consumables-alt-routes-self-found");
altMod._compile(
  J("data-city-bonuses.js") + (J("calculations.js") + J("calculations-margins.js")) + J("render-consumable-alt-routes.js") +
    "\nmodule.exports = { consumableAltRoutes, fees: { setupFee: () => SETUP_FEE } };",
  "consumables-alt-routes-self-found.js",
);
const ALT = altMod.exports;

const ALT_ROW = {
  marginInfo: { profit: 500, margin: 20 },
  rrr: 0.2,
  recipe: [
    { matId: "T3_FLOUR", count: 10 },
    { matId: "T3_MEAT", count: 2, noReturn: true },
  ],
  item: { id: "T4_BREAD", name: "Bread" },
  matAltChains: [
    { matId: "T3_FLOUR", marketPerUnit: 200, chainPerUnit: 120, marketCity: "Lymhurst", chain: { inputs: [] } },
    { matId: "T3_MEAT", marketPerUnit: 150, chainPerUnit: 90, marketCity: "Martlock", chain: { inputs: [] } },
  ],
};

test("alt-routes row: regression, savings/altProfit keep today's formulas", () => {
  const alts = ALT.consumableAltRoutes(ALT_ROW);
  assert.strictEqual(alts.length, 2);
  const flour = alts.find((a) => a.matId === "T3_FLOUR");
  // consumed = 10 x (1 - 0.2) = 8; savings = (200-120) x 8 x 1.025 = 656.
  assert.ok(near(flour.consumedCount, 8), `consumedCount ${flour.consumedCount} != 8`);
  assert.ok(near(flour.savings, 80 * 8 * (1 + ALT.fees.setupFee())),
    `savings ${flour.savings} drifted`);
  assert.ok(near(flour.altProfit, 500 + flour.savings), "altProfit = baseProfit + savings");
});

test("alt-routes row: the twin zeroes the ingredient's WHOLE market cost", () => {
  const alts = ALT.consumableAltRoutes(ALT_ROW);
  const flour = alts.find((a) => a.matId === "T3_FLOUR");
  assert.strictEqual(typeof flour.selfFoundProfit, "number",
    "selfFoundProfit missing on the alt-routes block (feature not implemented)");
  // 500 + 200 x 8 x 1.025 = 2,140 — the market price AND its setup fee leave
  // together; chainPerUnit plays no part (self-gathered beats both).
  const want = 500 + 200 * 8 * (1 + ALT.fees.setupFee());
  assert.ok(near(flour.selfFoundProfit, want),
    `twin ${flour.selfFoundProfit} != ${want} — it must not depend on chainPerUnit`);
});

test("alt-routes row: a no-return ingredient's twin consumes it 1:1", () => {
  const alts = ALT.consumableAltRoutes(ALT_ROW);
  const meat = alts.find((a) => a.matId === "T3_MEAT");
  assert.strictEqual(typeof meat.selfFoundProfit, "number", "selfFoundProfit missing (noReturn alt)");
  const want = 500 + 150 * 2 * (1 + ALT.fees.setupFee()); // 500 + 307.5 = 807.5
  assert.ok(near(meat.selfFoundProfit, want), `twin ${meat.selfFoundProfit} != ${want}`);
});

test("alt-routes row: a row without alternatives yields no blocks at all", () => {
  assert.deepStrictEqual(ALT.consumableAltRoutes({ marginInfo: { profit: 5 } }), []);
});
