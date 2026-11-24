/**
 * Test: the Consumables table renders milk and eggs as a PASTURE row.
 *
 * Goat's Milk used to render as a flip — "buy it here, sell it there" — which is
 * not what the table is for and not how milk reaches your inventory. You buy a
 * goat, feed it 9 turnips per 22h cycle and collect 9 milk (18 with Premium),
 * and the goat is still standing afterwards.
 *
 * Black-box over the real renderConsumableTable against synthetic market data.
 * No live API, no database.
 *
 * Run: node tests/consumables-pasture-row.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

// Only the presentation seam is stubbed: the DOM, the table writer and the
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
function renderChainBreakdown(chain, out){ return (chain.inputs||[]).map((i)=>i.count+"x "+i.matId).join("<br>"); }
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

const mod = new Module("consumables-pasture-row");
mod._compile(
  stubs + sources + "\nmodule.exports = { tableState, renderConsumableTable, _els, SETUP_FEE };",
  "consumables-pasture-row.js",
);
const X = mod.exports;

// Feed at 100, milk listed at 400, the grown goat at a price no cycle could ever
// pay back inside one batch — if the animal were charged, every assertion below
// about cost would blow up.
const FEED_PRICE = 100;
const ANIMAL_PRICE = 250000;

function market() {
  const md = {};
  const put = (id, c, b, s) => { (md[id] = md[id] || {})[c] = { buy_price: b, sell_price: s, volume_24h: 9999 }; };
  ["Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Brecilien"].forEach((c) => {
    put("T4_TURNIP", c, FEED_PRICE, FEED_PRICE + 10);
    put("T4_MILK", c, 400, 420);
    put("T4_FARM_GOAT_GROWN", c, ANIMAL_PRICE, ANIMAL_PRICE + 1000);
    put("T3_WHEAT", c, 60, 70);
    put("T3_EGG", c, 300, 320);
    put("T3_FARM_CHICKEN_GROWN", c, 40000, 41000);
  });
  return md;
}

function render(premium) {
  X._els["premium-account"].checked = premium !== false;
  X.renderConsumableTable(market());
  // Snapshot: the renderer writes into one shared tableState object, so a later
  // render would otherwise rewrite an earlier one under the caller's feet.
  const state = X.tableState["consumable-table"];
  return { data: state.data.slice(), html: state.html.slice() };
}

function rowFor(state, id) {
  return state.data.find((r) => r.item && r.item.id === id);
}

function htmlFor(state, id) {
  const idx = state.data.findIndex((r) => r.item && r.item.id === id);
  return idx >= 0 ? state.html[idx] : "";
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

console.log("\n=== Consumables: milk and eggs are a pasture play ===");

const PREMIUM = render(true);
const FREE = render(false);

// Every pasture byproduct, and what feeds it.
const CASES = [
  { id: "T4_MILK", feed: "T4_TURNIP", animal: "T4_FARM_GOAT_GROWN" },
  { id: "T6_MILK", feed: "T6_POTATO", animal: "T6_FARM_SHEEP_GROWN" },
  { id: "T8_MILK", feed: "T8_PUMPKIN", animal: "T8_FARM_COW_GROWN" },
  { id: "T3_EGG",  feed: "T3_WHEAT",  animal: "T3_FARM_CHICKEN_GROWN" },
  { id: "T5_EGG",  feed: "T5_CABBAGE", animal: "T5_FARM_GOOSE_GROWN" },
];

CASES.forEach((c) => {
  test(`${c.id} is a chain-craft row, never a flip`, () => {
    const row = rowFor(PREMIUM, c.id);
    assert.ok(row, `${c.id} produced no row`);
    assert.ok(!row.isFlip, `${c.id} still renders as a flip`);
  });
});

test("the milk row is a pasture station fed by turnips", () => {
  const row = rowFor(PREMIUM, "T4_MILK");
  assert.strictEqual(row.isChainCraft, true);
  assert.strictEqual(row.chainStation, "pasture");
  const inputs = row.chainSourcing.chain.inputs;
  assert.strictEqual(inputs.length, 1);
  assert.strictEqual(inputs[0].matId, "T4_TURNIP");
  assert.strictEqual(inputs[0].count, 9);
});

test("a pasture pays no return rate", () => {
  const row = rowFor(PREMIUM, "T4_MILK");
  assert.strictEqual(row.chainRrr, 0);
});

test("no focus is spent on a produce cycle", () => {
  const row = rowFor(PREMIUM, "T4_MILK");
  assert.strictEqual(row.focusCost, 0);
  assert.ok(!row.profitPerFocus, "a pasture row must not claim a silver/focus rate");
});

test("the cycle costs the feed alone — the goat is capital", () => {
  [FREE, PREMIUM].forEach((state) => {
    const row = rowFor(state, "T4_MILK");
    // Whatever the produce works out to, the cycle only ever bought 9 turnips.
    // The buy-side setup fee rides on the feed, as it does on every bought input.
    const wantCycle = 9 * FEED_PRICE * (1 + X.SETUP_FEE);
    const cycleCost = row.totalInputCost * row.effectiveOutput;
    assert.ok(Math.abs(cycleCost - wantCycle) < 1e-6,
      `cycle cost ${cycleCost}, want ${wantCycle}`);
    assert.ok(row.totalInputCost < ANIMAL_PRICE / 100,
      "the animal leaked into the cost per unit");
  });
});

test("Premium's +100% yield halves the cost per unit in the same city", () => {
  const free = rowFor(FREE, "T4_MILK");
  const prem = rowFor(PREMIUM, "T4_MILK");
  // Both rows stand in the spec city, so their ratio is 2.1/1.1 — Premium's
  // +100% Product Yield sums with the same +10% both rows carry.
  assert.ok(Math.abs(prem.effectiveOutput - free.effectiveOutput * (2.1 / 1.1)) < 1e-6,
    `produce ${prem.effectiveOutput}, want ${free.effectiveOutput * (2.1 / 1.1)}`);
  assert.ok(Math.abs(prem.totalInputCost - free.totalInputCost * (1.1 / 2.1)) < 1e-6,
    `${prem.totalInputCost} is not ${free.totalInputCost} x 1.1/2.1`);
});

test("the animal is priced and carried on the row for display", () => {
  const row = rowFor(PREMIUM, "T4_MILK");
  assert.ok(row.pastureCapital, "no capital leg on the row");
  assert.strictEqual(row.pastureCapital.matId, "T4_FARM_GOAT_GROWN");
  assert.strictEqual(row.pastureCapital.price, ANIMAL_PRICE);
});

test("the spec city pays its +10% on the produce", () => {
  const row = rowFor(PREMIUM, "T4_MILK");
  // data-city-bonuses.js gives exactly one royal city the T4_MILK byproduct.
  assert.ok(row.craftCity, "no pasture city picked");
  assert.strictEqual(row.craftBonus, "+10%");
  // Premium (+100%) and the spec city (+10%) are one stat summed once: x2.1.
  assert.ok(Math.abs(row.effectiveOutput - 9 * 2.1) < 1e-6,
    `produce ${row.effectiveOutput}, want ${9 * 2.1}`);
  const free = rowFor(FREE, "T4_MILK");
  assert.ok(Math.abs(free.effectiveOutput - 9 * 1.1) < 1e-6,
    `free-account produce ${free.effectiveOutput}, want ${9 * 1.1}`);
});

test("the rendered row shows the feed and the capital line", () => {
  const html = htmlFor(PREMIUM, "T4_MILK");
  assert.ok(!html.startsWith("ERR:"), `row template threw: ${html}`);
  assert.ok(html.includes("9x T4_TURNIP"), "the feed is missing from the ingredients cell");
  assert.ok(html.includes("capital"), "the capital line is missing");
  assert.ok(html.includes("Pasture"), "the route does not name the pasture");
});

test("butter still renders, milling from milk", () => {
  const row = rowFor(PREMIUM, "T4_BUTTER");
  assert.ok(row, "no butter row");
  assert.strictEqual(row.chainStation, "mill");
});

test("crops are still flips — only produced items left that branch", () => {
  const row = rowFor(PREMIUM, "T4_TURNIP");
  assert.ok(row, "no turnip row");
  assert.strictEqual(row.isFlip, true);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
