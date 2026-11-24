/**
 * Test: the Farming table's "Seeds to Plant (10k Focus)" column.
 *
 * Consumables and Crafting both publish a "Mats to Buy (10k Focus)" cell that
 * turns a whole focus bar into a shopping list. Farming had no such cell: the
 * only place the watering count existed was inside the Profit / 10k Focus
 * tooltip, so nothing on the row said how many plots a bar actually waters.
 *
 * The farming figure is deliberately three numbers, not one:
 *   - seeds PLANTED  — a bar waters `plots x whole cycles` slots, one seed each
 *   - seeds TO BUY   — net of the seed return, which is the Consumables
 *                      convention. A WATERED plot is always at or above 100%
 *                      yield in Albion, so this is 0 for every crop and herb:
 *                      the column has to say so rather than print a bare 0.
 *   - the action line — whole cycles, plots, and the per-cycle focus charge
 *
 * Seeds PLANTED and the action line are the bar's own arithmetic and never move
 * with the global Use Focus checkbox. Seeds TO BUY and the seed return quoted
 * beside it DO follow the checkbox: with Use Focus off the plot is grown dry, so
 * the line reads the dry return (e.g. 91.1% on a T7 herb) and the seeds that
 * return leaves short — reported by the user, who saw 108.9% "self-seeding"
 * with focus switched off. Profit / 10k Focus stays the focus-ON benchmark.
 *
 * Black box over the shipped renderer and index.html. No live API, no database.
 *
 * Run: node tests/farming-seeds-to-plant-10k-focus.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");
const { readIndexHtml } = require("./helpers/page-source.cjs");

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

const mod = new Module("farming-seeds-to-plant");
mod._compile(
  stubs + sources +
    "\nmodule.exports = { tableState, renderFarmingTable, calcFarmingEconomics, matsNeededFor10kFocus, _els };",
  "farming-seeds-to-plant.js",
);
const X = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name + " — " + e.message); failed++; }
}

const SEED = "T6_FARM_POTATO_SEED";
const CROP = "T6_POTATO";
const PASTURE_OUTPUT = "T6_MILK";
const FOCUS_PER_CYCLE = 125 * 9; // max-spec per seed x the plot's 9 slots
const CYCLES = Math.floor(10000 / FOCUS_PER_CYCLE); // 8

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

console.log("Farming — Seeds to Plant (10k Focus)\n");

console.log("=== the arithmetic, parameterized over yield and focus cost ===");

// The shared helper every other 10k-focus column already uses (js/utils.js).
// seeds a bar plants = the cycles a bar buys x the plot's slots — whole cycles
// while one fits the bar, a fraction of one when it does not (focusBarCrafts)
[
  { focusCost: 1125, plots: 9, seeds: 72 },   // max spec, a full island plot
  { focusCost: 9000, plots: 9, seeds: 9 },    // unspecced: one cycle a bar
  { focusCost: 12000, plots: 9, seeds: 8 },   // 0.83 of a cycle, never a flat 0
  { focusCost: 125, plots: 1, seeds: 80 },    // a one-slot plot
].forEach(({ focusCost, plots, seeds }) => {
  test(`focusCost ${focusCost} over ${plots} slots plants ${seeds} seeds a bar`, () => {
    assert.strictEqual(X.matsNeededFor10kFocus(focusCost, plots), seeds);
  });
});

// Seeds to BUY is net of the seed return, exactly as the Consumables column is
// net of the resource return rate.
[
  { yieldTotal: 0.5, plots: 9, buy: 36 },   // half the seeds come back
  { yieldTotal: 0.75, plots: 9, buy: 18 },
  { yieldTotal: 1.0, plots: 9, buy: 0 },    // break-even: the plot re-seeds itself
  { yieldTotal: 1.2334, plots: 9, buy: 0 }, // a surplus is revenue, never a negative purchase
].forEach(({ yieldTotal, plots, buy }) => {
  test(`yield ${(yieldTotal * 100).toFixed(1)}% buys ${buy} of the ${CYCLES * plots} seeds planted`, () => {
    const perAction = plots * Math.max(0, 1 - yieldTotal);
    assert.strictEqual(X.matsNeededFor10kFocus(1125, perAction), buy);
  });
});

console.log("\n=== calcFarmingEconomics publishes the WATERED seed leg ===");

const CROP_ECON = {
  type: "crop", seedPrice: 300, outputSellPrice: 900,
  baseSeedYield: 0.5, wateringBonus: 0.25, plotsPerCycle: 9, cycleHours: 22,
};

test("the watered seed yield is published and does not follow useWater", () => {
  const on = X.calcFarmingEconomics({ ...CROP_ECON, focusPerCycle: 1125, useWater: true });
  const off = X.calcFarmingEconomics({ ...CROP_ECON, focusPerCycle: 1125, useWater: false });
  assert.strictEqual(on.wateredSeedYield, 0.75);
  assert.strictEqual(on.wateredSeedYield, off.wateredSeedYield);
});

test("the watered seeds-per-output twin is fixed the same way", () => {
  const on = X.calcFarmingEconomics({ ...CROP_ECON, focusPerCycle: 1125, useWater: true });
  const off = X.calcFarmingEconomics({ ...CROP_ECON, focusPerCycle: 1125, useWater: false });
  assert.strictEqual(on.seedsBoughtPerOutputFocusOn, off.seedsBoughtPerOutputFocusOn);
  assert.ok(on.seedsBoughtPerOutputFocusOn > 0, "a 75% plot must still buy seeds");
  assert.ok(off.seedsBoughtPerOutput > off.seedsBoughtPerOutputFocusOn,
    "the dry cycle buys MORE seeds than the watered one — that is what watering saves");
});

test("the dry-cycle sibling still follows useWater, so nothing else moved", () => {
  const on = X.calcFarmingEconomics({ ...CROP_ECON, focusPerCycle: 1125, useWater: true });
  const off = X.calcFarmingEconomics({ ...CROP_ECON, focusPerCycle: 1125, useWater: false });
  assert.notStrictEqual(on.seedsBoughtPerOutput, off.seedsBoughtPerOutput);
});

console.log("\n=== the row publishes the sortable figure ===");

test("the row carries seedsPer10kFocus and mirrors it onto the focusMats sort key", () => {
  const { row } = cropRow();
  assert.strictEqual(row.seedsPer10kFocus, CYCLES * 9); // 72
  assert.strictEqual(row.focusMats, row.seedsPer10kFocus);
});

test("a watered T6 potato plot buys none of them — it re-seeds itself", () => {
  const { row } = cropRow();
  assert.strictEqual(row.seedsToBuyPer10kFocus, 0);
  assert.ok(row.wateredSeedYield > 1, "fixture assumption: watering puts T6 over 100%");
});

test("seeds PLANTED ignore the Use Focus checkbox", () => {
  const on = cropRow().row;
  X._els["use-focus"].checked = false;
  try {
    const off = cropRow().row;
    assert.strictEqual(off.seedsPer10kFocus, on.seedsPer10kFocus);
    assert.strictEqual(off.focusMats, on.focusMats);
  } finally {
    X._els["use-focus"].checked = true;
  }
});

// T6 potato: 86.67% dry, +26.67% watered = 113.33%. A bar is 8 cycles x 9 slots.
[
  { focusOn: true, yieldShown: 0.8667 + 0.2667, toBuy: 0 },
  { focusOn: false, yieldShown: 0.8667, toBuy: Math.round(CYCLES * 9 * (1 - 0.8667)) }, // 10
].forEach(({ focusOn, yieldShown, toBuy }) => {
  test(`Use Focus ${focusOn ? "on" : "off"}: seeds to buy ${toBuy} at ${(yieldShown * 100).toFixed(1)}% return`, () => {
    X._els["use-focus"].checked = focusOn;
    try {
      const { row } = cropRow();
      assert.ok(Math.abs(row.seedYieldShown - yieldShown) < 1e-9, `yield ${row.seedYieldShown}`);
      assert.strictEqual(row.seedsToBuyPer10kFocus, toBuy);
    } finally {
      X._els["use-focus"].checked = true;
    }
  });
});

test("Profit / 10k Focus still ignores the checkbox", () => {
  const on = cropRow().row;
  X._els["use-focus"].checked = false;
  try {
    assert.strictEqual(cropRow().row.profitPer10kFocus, on.profitPer10kFocus);
  } finally {
    X._els["use-focus"].checked = true;
  }
});

test("a pasture row has no focus play, so it publishes no figure", () => {
  const { row } = pastureRow();
  assert.strictEqual(row.focusCost, 0);
  assert.strictEqual(row.seedsPer10kFocus, 0);
  assert.strictEqual(row.focusMats, 0);
});

console.log("\n=== the rendered cell ===");

test("the cell is width-capped by the shared focus-mats class", () => {
  const { html } = cropRow();
  assert.ok(/<td class="cell-focus-mats"/.test(html),
    "no cell-focus-mats cell in the row: " + html);
});

test("the seed count leads, named after the row's own seed", () => {
  const { html } = cropRow();
  assert.ok(/72x Potato \[T6\]/.test(html), "no planted-seed line: " + html);
});

test("the action line names cycles, plots and the per-cycle charge", () => {
  const { html } = cropRow();
  assert.ok(/\d[\d,]*x cycles · \d[\d,]* plots @ [\d.,]+ focus ea/.test(html),
    "no cycles/plots/focus subline: " + html);
  assert.ok(html.includes("8x cycles · 72 plots @ 1,125 focus ea"),
    "the subline does not read the whole plot charge: " + html);
});

test("a self-seeding plot says so instead of printing a bare 0", () => {
  const { html } = cropRow();
  assert.ok(/self-seeding/.test(html), "no self-seeding note: " + html);
  // 86.67% base + 26.67% watering. The farm city's +10% is a product yield
  // bonus and stays out of this number.
  assert.ok(/113\.3%/.test(html), "the seed return is not quoted: " + html);
});

test("a plot that must buy seeds prints the count instead of the note", () => {
  // Below-100% yield is unreachable for a WATERED crop in the shipped catalog,
  // so drive the branch through calcFarmingEconomics directly and pin what the
  // renderer would be handed.
  const e = X.calcFarmingEconomics({ ...CROP_ECON, focusPerCycle: 1125, useWater: true });
  const toBuy = X.matsNeededFor10kFocus(1125, e.seedsBoughtPerOutputFocusOn * e.outputsPerCycle);
  assert.strictEqual(toBuy, CYCLES * 9 * 0.25); // 18 of the 72 planted
});

test("with Use Focus off the cell quotes the dry return and the seeds to buy", () => {
  X._els["use-focus"].checked = false;
  try {
    const { html } = cropRow();
    assert.ok(!/self-seeding/.test(html), "a dry T6 plot is not self-seeding: " + html);
    assert.ok(/10x to buy/.test(html), "no seeds-to-buy count: " + html);
    assert.ok(/86\.7% seed return/.test(html), "the dry return is not quoted: " + html);
    assert.ok(html.includes("8x cycles · 72 plots @ 1,125 focus ea"),
      "the action line must not move with the checkbox: " + html);
  } finally {
    X._els["use-focus"].checked = true;
  }
});

test("a pasture row renders the em-dash, not a phantom seed count", () => {
  const { html } = pastureRow();
  const cells = html.match(/<td[^>]*>—<\/td>/g) || [];
  assert.ok(cells.length >= 2,
    "a byproduct row must dash BOTH Profit / 10k Focus and the seed column: " + html);
  assert.ok(!/cell-focus-mats/.test(html) || /class="cell-focus-mats"[^>]*>—/.test(html),
    "the seed cell claims a figure a pasture row cannot have: " + html);
});

console.log("\n=== index.html wiring ===");

const html = readIndexHtml();
const farmingSection = (() => {
  const i = html.indexOf('<table id="farming-table"');
  assert.ok(i > 0, "no farming table in index.html");
  return html.slice(i, html.indexOf("</table>", i));
})();

test("the Farming table has the new header on the shared focusMats sort key", () => {
  assert.ok(/data-sort="focusMats"/.test(farmingSection), "no focusMats header");
  assert.ok(/Seeds to Plant \(10k Focus\)/.test(farmingSection), "header text missing");
});

test("it sits between Profit / 10k Focus and Silver / Focus", () => {
  const p10k = farmingSection.indexOf('data-sort="profitPer10kFocus"');
  const mats = farmingSection.indexOf('data-sort="focusMats"');
  const ppf = farmingSection.indexOf('data-sort="profitPerFocus"');
  assert.ok(p10k < mats && mats < ppf, "the new column is out of order");
});

test("the awaiting-scan colspan still matches the header count", () => {
  const thCount = (farmingSection.match(/<th /g) || []).length;
  assert.strictEqual(Number((farmingSection.match(/colspan="(\d+)"/) || [])[1]), thCount);
});

test("a rendered row has exactly one cell per header", () => {
  const thCount = (farmingSection.match(/<th /g) || []).length;
  [cropRow(), pastureRow()].forEach(({ html }) => {
    const tdCount = (html.match(/<td[ >]/g) || []).length;
    assert.strictEqual(tdCount, thCount, "row/header column count drifted: " + html);
  });
});

test("the header is translatable like every other column", () => {
  const th = (farmingSection.match(/<th[^>]*data-sort="focusMats"[^>]*>/) || [""])[0];
  assert.ok(/data-i18n="/.test(th), "no data-i18n key on the new header");
  assert.ok(/data-i18n-title="/.test(th), "no data-i18n-title key on the new header");
});

console.log("\n=== the renderer keeps the single bar division ===");

const renderSrc = J("render-farming.js");

test("no second Math.floor(10000 / …) was added — the helper does the flooring", () => {
  const localFloors = renderSrc.match(/Math\.floor\(\s*10000\s*\/[^)]*\)/g) || [];
  assert.deepStrictEqual(localFloors, ["Math.floor(10000 / row.focusCost)"],
    "the only local bar division may be the tooltip's cycle count");
});

test("the seed counts come from the shared matsNeededFor10kFocus helper", () => {
  assert.ok(/matsNeededFor10kFocus\(/.test(renderSrc),
    "js/render-farming.js re-derives the bar count instead of reusing js/utils.js");
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
