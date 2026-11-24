/**
 * Test: watering focus is charged PER SEED, not once per harvest cycle.
 *
 * Albion charges the watering focus on every planted seed — 1,000 unspecced,
 * 125 at full specialization — so a full 9-slot plot costs 9x that, 1,125 at max
 * spec (Albion forum thread 78912; the wiki's Island Farms page gives the same
 * endpoints). The table used to bill ONE 125 charge for a whole 9-slot cycle
 * while pricing the watering gain over all nine slots, which overstated every
 * Farming Silver/Focus and Profit / 10k Focus figure ninefold.
 *
 * This pins the two halves apart:
 *   - getFarmingFocusCost stays the PER-SEED charge (its contract never changed)
 *   - the row's focusCost is that charge x the plot's seed slots
 *
 * Black box over the shipped renderer with a synthetic market. No live API, no
 * database.
 *
 * Run: node tests/farming-focus-per-seed.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const stubs = `
const _els = {
  "include-caerleon": { checked: true },
  "sort-instant": { checked: true },
  "use-focus": { checked: true },
  "premium-account": { checked: true },
};
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const window = { addEventListener: () => {} };
const tableState = { "farming-table": { data: [], html: [] } };
function renderTableData(id, rows, fmt) {
  tableState[id].data = rows;
  tableState[id].html = rows.map((r, i) => { try { return fmt(r, i); } catch (e) { return "ERR:" + e.message; } });
}
function priceTd(price, itemId, city) {
  return '<td data-item-id="' + itemId + '" data-city="' + city + '">' + (price > 0 ? String(price) : "-") + '</td>';
}
function profitTd() { return "<td></td>"; }
function volTd() { return "<td></td>"; }
function getProfitClass() { return ""; }
function addTdForKey() { return "<td></td>"; }
function getRowKey(row) { return ((row.item && row.item.id) || "?") + "|" + (row.section || ""); }
function dispName(id, name) { return name || id; }
function tx(en) { return en; }
function focusPlayCell() { return "<td></td>"; }
function formatSilver(n) { return String(Math.round(Number(n) || 0)); }
function formatFocusCost(n) { return String(Math.round(Number(n) || 0)); }
const ITEM_NAMES_MAP = {};
let lastMarketData = null;
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
`;

const sources =
  J("data-city-bonuses.js") +
  (J("calculations.js") + J("calculations-margins.js")) +
  J("travel-cost.js") +
  J("mp-bonus.js") +
  (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) +
  J("focus-play.js") +
  J("focus-costs.js") +
  J("data-farming.js") +
  J("farming-row-econ.js") +
  J("render-farming.js");

const mod = new Module("farming-focus-per-seed");
mod._compile(
  stubs + sources +
    "\nmodule.exports = { tableState, renderFarmingTable, getFarmingFocusCost, FARMING_PRODUCTION, FARMING_FOCUS_BASE };",
  "farming-focus-per-seed.js",
);
const X = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name + " — " + e.message); failed++; }
}

// No spec data is loaded in this harness, so focusSpecMultiplier is absent and
// getFarmingFocusCost falls back to the max-spec 0.5^3 — a fixed 125 per seed.
const MAX_SPEC_PER_SEED = 125;
const SEED = "T6_FARM_POTATO_SEED";
const CROP = "T6_POTATO";
const PASTURE_OUTPUT = "T6_MILK";

function market(seedPrices, cropPrices) {
  const md = {};
  const put = (id, city, price) => {
    (md[id] = md[id] || {})[city] = { buy_price: price, sell_price: price, volume_24h: 500 };
  };
  Object.entries(seedPrices).forEach(([c, p]) => put(SEED, c, p));
  Object.entries(cropPrices).forEach(([c, p]) => put(CROP, c, p));
  return md;
}

const MARKET = market({ "Fort Sterling": 14264, Martlock: 15958 }, { Thetford: 900 });

function rowFor(predicate, md) {
  X.renderFarmingTable(md || MARKET);
  const t = X.tableState["farming-table"];
  const idx = t.data.findIndex((r) => r.item && predicate(r.item));
  assert.ok(idx >= 0, "no matching row rendered");
  return { row: t.data[idx], html: t.html[idx] };
}

const cropRow = (md) => rowFor((it) => it.id === SEED && it.type !== "byproduct", md);
const pastureRow = () => rowFor((it) => it.outputId === PASTURE_OUTPUT);

console.log("Farming — watering focus is per seed\n");

console.log("=== the per-seed charge itself is unchanged ===");

test("getFarmingFocusCost is still the PER-SEED charge at max spec", () => {
  assert.strictEqual(X.getFarmingFocusCost(SEED), MAX_SPEC_PER_SEED);
});

test("the unspecced endpoint is the game's 1,000 per seed", () => {
  assert.strictEqual(X.FARMING_FOCUS_BASE, 1000);
});

console.log("\n=== a row bills the whole plot ===");

test("a crop row's focusCost is the per-seed charge x its seed slots", () => {
  const { row } = cropRow();
  assert.strictEqual(row.item.plotsPerCycle, 9, "fixture assumption: a plot holds 9 seeds");
  assert.strictEqual(row.focusCost, MAX_SPEC_PER_SEED * 9);
});

// Parameterized over the plot size, so the rule is the multiplication and not a
// hard-coded 1,125. FARMING_PRODUCTION entries are plain data the renderer reads
// fresh on every call.
[1, 2, 9, 16].forEach((slots) => {
  test(`plotsPerCycle ${slots}: focusCost is ${MAX_SPEC_PER_SEED} x ${slots}`, () => {
    const item = X.FARMING_PRODUCTION.find((it) => it.id === SEED && it.type !== "byproduct");
    const original = item.plotsPerCycle;
    try {
      item.plotsPerCycle = slots;
      const { row } = cropRow();
      assert.strictEqual(row.focusCost, MAX_SPEC_PER_SEED * slots);
    } finally {
      item.plotsPerCycle = original;
    }
  });
});

test("the marginal rate divides the whole-plot delta by the whole-plot focus", () => {
  const { row } = cropRow();
  assert.ok(row.bestFocusPlay, "the crop row lost its watering play");
  assert.strictEqual(
    row.profitPerFocus,
    row.bestFocusPlay.profitDelta / (MAX_SPEC_PER_SEED * 9),
  );
});

test("Profit / 10k Focus counts only the whole plots a bar waters", () => {
  const { row } = cropRow();
  const cycles = Math.floor(10000 / (MAX_SPEC_PER_SEED * 9)); // 8, not 80
  assert.strictEqual(cycles, 8);
  assert.strictEqual(row.profitPer10kFocus, row.profitFocusOn * cycles);
});

test("the per-crop focus sibling divides the whole-plot charge", () => {
  const { row } = cropRow();
  assert.strictEqual(row.focusPerOutput, row.focusCost / row.outputsPerCycle);
  assert.ok(row.focusPerOutput > 1, "a crop should cost more than 1 focus, got " + row.focusPerOutput);
});

console.log("\n=== a pasture row still has no focus play ===");

test("a byproduct row is charged no watering focus at all", () => {
  const { row } = pastureRow();
  assert.strictEqual(row.focusCost, 0);
  assert.strictEqual(row.bestFocusPlay, null);
  assert.strictEqual(row.profitPer10kFocus, 0);
});

console.log("\n=== the source names the charge for what it is ===");

const dataSrc = J("data-farming.js");
const renderSrc = J("render-farming.js");

test("the max-spec constant is named per SEED, not per cycle", () => {
  assert.ok(/FARMING_FOCUS_PER_SEED\s*=\s*125/.test(dataSrc),
    "js/data-farming.js still calls the per-seed charge a per-cycle one");
  assert.ok(!/FARMING_FOCUS_PER_CYCLE/.test(dataSrc + renderSrc),
    "the misleading FARMING_FOCUS_PER_CYCLE name survives somewhere");
});

test("the renderer multiplies by the plot's seed slots", () => {
  assert.ok(/plotsPerCycle\s*\|\|\s*9/.test(renderSrc),
    "js/render-farming.js does not scale the per-seed charge by plotsPerCycle");
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
