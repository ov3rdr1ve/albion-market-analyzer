/**
 * Test: Profit / Day in My Crafting List's "Total Profit" cell.
 *
 * No separate column. A breeding row's Total Profit cell (per-animal profit x
 * Qty) gains a dimmed second line "<Total Profit / (grow hours / 24)> /day".
 * Grow hours come from getBreedingGrowHours(meta), so the figure follows the
 * Premium Account toggle (T8 horse 142 h with Premium, 284 h without). An
 * existing sub-line stays; non-breeding / no-grow-time / parked / no-total rows
 * get none.
 *
 * Black-box: sandboxed copies of js/render-mounts.js (helpers),
 * js/render-mounts-breeding-row.js, js/breeding-profit-per-day.js and
 * js/craft-list-per-day.js, stubbed dependencies, synthetic prices, no live API.
 *
 * Run: node tests/breeding-profit-per-day.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { readIndexHtml } = require("./helpers/page-source.cjs");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, "js", f), "utf8");
const mountsSrc = read("render-mounts.js");
const helperSource = mountsSrc.slice(0, mountsSrc.indexOf("function renderMountsTable"));

// premium: true | false | "absent" (isPremiumEnabled not defined at all)
function makeSandbox(premium) {
  const stubs = {
    tx: (en) => en,
    txFood: (s) => s,
    ITEM_NAMES_MAP: {},
    getItemDisplayName: (id) => id,
    getTierFromId: (id) => parseInt(String(id).match(/^T(\d+)/)?.[1] || "4", 10),
    getIQRBounds: () => null,
    getOverridePrice: () => null,
    getCityForce: () => null,
    getBuyPrice: () => 0,
    matPriceSpan: () => "",
    formatSilver: (n) => String(Math.round(n || 0)),
    formatFocusCost: (n) => String(n),
    priceTd: () => "",
    profitTd: () => "<td>MARGIN</td>",
    pureProfitTd: () => "<td>PROFIT</td>",
    addTdForKey: () => "",
    dispName: (id, name) => name || id,
    focusPlayCell: () => "",
    getProfitClass: () => "",
    brecilienFeeBadge: () => "",
    isFocusEnabled: () => false,
    _clFmt: (n) => String(Math.round(n)),
    _clEsc: (x) => String(x),
  };
  if (premium !== "absent") stubs.isPremiumEnabled = () => premium;
  const ctx = vm.createContext({ ...stubs, module: { exports: {} }, console });
  vm.runInContext(read("rrr-eligible.js") + read("data-mounts.js") + helperSource
    + read("render-mounts-breeding-row.js") + read("breeding-profit-per-day.js")
    + read("craft-list-per-day.js"), ctx);
  return ctx;
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

function rowFor(ctx, babyId, profit, extra) {
  const item = { id: "X", name: "X", babyId, grownId: "G", babyName: "Baby" };
  const zero = { price: 0, city: "Martlock" };
  return {
    item, meta: ctx.getBreedingMeta(item), feed: null, recipe: null, isBreeding: true,
    buyMat: zero, sellPot: zero,
    marginInfo: { profit, margin: 0 },
    ...extra,
  };
}

console.log("\n=== Profit / Day: math ===");

// [babyId, non-Premium hours, Premium hours]
const GROW = [
  ["T3_FARM_HORSE_BABY", 44, 22],
  ["T4_FARM_HORSE_BABY", 92, 46],
  ["T5_FARM_HORSE_BABY", 140, 70],
  ["T6_FARM_HORSE_BABY", 188, 94],
  ["T7_FARM_HORSE_BABY", 236, 118],
  ["T8_FARM_HORSE_BABY", 284, 142],
  ["T3_FARM_CHICKEN_BABY", 44, 22],
  ["T8_FARM_COW_BABY", 44, 22],
  ["T8_FARM_DRAKE_BABY", 668, 334],
];
const TOTAL = 100000;

for (const [babyId, off, on] of GROW) {
  for (const [premium, hours] of [[true, on], [false, off]]) {
    test(`${babyId} Premium ${premium ? "ON" : "OFF"}: ${hours}h, ${TOTAL} / (${hours}h / 24)`, () => {
      const c = makeSandbox(premium);
      const row = rowFor(c, babyId, 1);
      assert.strictEqual(c.breedingRowGrowHours(row), hours);
      near(c.breedingProfitPerDay(TOTAL, c.breedingRowGrowHours(row)), TOTAL / (hours / 24));
    });
  }
}

test("isPremiumEnabled absent -> treated as Premium ON", () => {
  const c = makeSandbox("absent");
  assert.strictEqual(c.breedingRowGrowHours(rowFor(c, "T8_FARM_HORSE_BABY", 1)), 142);
});

// [label, profit, hours, expected]
const PURE = [
  ["positive", 2400, 24, 2400],
  ["fractional days", 100, 12, 200],
  ["negative stays negative", -2400, 48, -1200],
  ["zero profit is 0, not a dash", 0, 24, 0],
  ["zero hours -> null", 100, 0, null],
  ["negative hours -> null", 100, -5, null],
  ["absent hours -> null", 100, undefined, null],
  ["null hours -> null", 100, null, null],
  ["NaN hours -> null", 100, NaN, null],
  ["null profit -> null", null, 24, null],
  ["absent profit -> null", undefined, 24, null],
  ["NaN profit -> null", NaN, 24, null],
  ["Infinity profit -> null", Infinity, 24, null],
];
for (const [label, profit, hours, expected] of PURE) {
  test(`breedingProfitPerDay(${label})`, () => {
    const c = makeSandbox(true);
    const v = c.breedingProfitPerDay(profit, hours);
    if (expected === null) assert.strictEqual(v, null);
    else near(v, expected);
  });
}

test("craft-only mount row (not breeding) has no grow hours", () => {
  const c = makeSandbox(true);
  assert.strictEqual(c.breedingRowGrowHours(rowFor(c, "T8_FARM_HORSE_BABY", 5000, { isBreeding: false, meta: undefined })), null);
  assert.strictEqual(c.breedingRowGrowHours(null), null);
});

console.log("\n=== Crafting List: /day line under Total Profit ===");

const PERDAY = /<small class="cl-row-perday"[^>]*>([^<]*)<\/small>/;
const titleOf = (h) => (h.match(/title="([^"]*)"/) || [])[1] || "";

// [premium, hours, qty, per-animal profit]
const CASES = [
  [true, 142, 1, 100000],
  [true, 142, 24, 100000],
  [false, 284, 1, 100000],
  [false, 284, 24, 100000],
  [true, 142, 24, -50000],
  [false, 284, 24, -50000],
];
for (const [premium, hours, qty, unit] of CASES) {
  test(`T8 horse Qty ${qty}, unit ${unit}, Premium ${premium ? "ON" : "OFF"}: Total ${unit * qty} over ${hours}h`, () => {
    const c = makeSandbox(premium);
    const total = unit * qty;
    const html = c.clPerDayLine(rowFor(c, "T8_FARM_HORSE_BABY", unit), total, false);
    const m = html.match(PERDAY);
    assert.ok(m, `no /day line: ${html}`);
    assert.strictEqual(m[1], `${Math.round(total / (hours / 24))} /day`);
    assert.ok(/display:block/.test(html) && /#9ca3af/.test(html), "must be the dimmed block style");
    const tip = titleOf(html);
    assert.ok(tip.includes(`${hours}h / 24`) && tip.includes(String(total)), tip);
    assert.ok(tip.length <= 160, `tooltip too long: ${tip.length}`);
    if (unit < 0) assert.ok(m[1].startsWith("-"), "a loss stays negative");
  });
}

// [label, row mutator, total, parked]
const NONE = [
  ["parked (Qty 0)", (r) => r, 100000, true],
  ["non-breeding row", (r) => ({ ...r, isBreeding: false, meta: undefined }), 100000, false],
  ["no row", () => null, 100000, false],
  ["no Total Profit (null)", (r) => r, null, false],
  ["no Total Profit (undefined)", (r) => r, undefined, false],
  ["non-finite Total Profit", (r) => r, NaN, false],
  ["no grow time", (r) => ({ ...r, meta: { ...r.meta, growHours: 0 } }), 100000, false],
];
for (const [label, mut, total, parked] of NONE) {
  test(`no /day line: ${label}`, () => {
    const c = makeSandbox(true);
    assert.strictEqual(c.clPerDayLine(mut(rowFor(c, "T8_FARM_HORSE_BABY", 1)), total, parked), "");
  });
}

test("existing sub-line is kept: /day is appended after it", () => {
  const c = makeSandbox(true);
  const selfLine = '<small style="color:#9ca3af;display:block;font-size:0.7rem">self-gathered 12790876</small>';
  const cell = `5000${selfLine}` + c.clPerDayLine(rowFor(c, "T8_FARM_HORSE_BABY", 1), 5000, false);
  assert.ok(cell.includes("self-gathered 12790876"));
  assert.ok(cell.indexOf("self-gathered") < cell.indexOf("/day"));
  assert.ok(cell.startsWith("5000<small"), "first number still leads the cell");
});

console.log("\n=== Wiring: no column, line reaches both Crafting List paths ===");

const html = readIndexHtml();
const mountsTable = html.slice(html.indexOf('<table id="mounts-table"'));
const thead = mountsTable.slice(0, mountsTable.indexOf("</thead>"));
const ths = [...thead.matchAll(/<th\b[^>]*>[\s\S]*?<\/th>/g)].map((m) => m[0]);

test("no 'Profit / Day' header in the Breeding & Mounts table, no breedProfitPerDay key", () => {
  assert.ok(!ths.some((t) => /breedProfitPerDay/.test(t) || />\s*Profit \/ Day\s*</.test(t)), "column header still present");
  assert.ok(!/breedProfitPerDay/.test(html));
  assert.ok(!/breedProfitPerDay|breedingProfitPerDaySortValue/.test(read("sorting.js")));
});

test("mounts header has 15 columns and the placeholder colspan matches", () => {
  assert.strictEqual(ths.length, 15);
  assert.strictEqual(Number(mountsTable.match(/<td colspan="(\d+)"/)[1]), ths.length);
});

test("no column cell left in either mounts row renderer", () => {
  assert.ok(!/breedingProfitPerDayCell|Profit \/ Day/.test(read("render-mounts-breeding-row.js")));
  assert.ok(!/breedingProfitPerDayCell|Profit \/ Day/.test(read("render-mounts-craft-row.js")));
});

test("Crafting List calls clPerDayLine on the full render and the live qty refresh", () => {
  const src = read("render-craft-list.js");
  assert.strictEqual((src.match(/clPerDayLine\(/g) || []).length, 2);
  // Guarded: harnesses that load render-craft-list.js alone do not define it.
  assert.ok(/_clSelfFoundTotalLine\(extracted, entry\.qty, parked\) \+ \(typeof clPerDayLine === "function" \? clPerDayLine\(found\.row, rowProfit, parked\)/.test(src));
  assert.ok(/_clSelfFoundTotalLine\(extracted, entry\.qty, parked\) \+ \(typeof clPerDayLine === "function" \? clPerDayLine\(found\.row, profit, parked\)/.test(src));
});

test("new files registered in index.html next to their siblings", () => {
  const at = (f) => html.indexOf(`js/${f}`);
  assert.ok(at("breeding-profit-per-day.js") > at("render-mounts-breeding-row.js") && at("render-mounts-breeding-row.js") > 0);
  assert.ok(at("craft-list-per-day.js") > at("craft-list-per10k.js") && at("craft-list-per10k.js") > 0);
});

test("ES strings exist for the /day label and tooltip, placeholders intact", () => {
  const es = require(path.join(ROOT, "js", "i18n-strings-es.js")).UI_STRINGS_ES;
  assert.strictEqual(typeof es.r_cl_perday, "string");
  assert.ok(es.r_cl_perday_tip.includes("{total}") && es.r_cl_perday_tip.includes("{hours}"));
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
