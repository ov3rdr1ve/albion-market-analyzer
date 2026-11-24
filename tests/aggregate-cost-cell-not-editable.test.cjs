/**
 * The aggregate cost columns are NOT price cells.
 *
 * Crafting "Input Cost", Craft Planner "Cost", Transport "Raw Cost" and
 * Transmute "Input Cost" all used to be priceTd — click-to-override cells. But
 * the number is a SUM: every material's count × unit price, plus the setup fee,
 * the station fee, the Brecilien haul and the recipe silver. No single per-unit
 * price inverts it, so anything typed there was wrong in one of two ways:
 *
 *   - a full-recipe item has no `item.matId`, so the key fell back to
 *     `<itemId>_mat` — a key nothing in the app ever reads. A silently dead edit.
 *   - an item that DOES carry a matId stored the per-craft TOTAL as that
 *     material's per-unit buy price, off by the recipe count (~30× on furniture).
 *
 * Two kinds of assertion here: the behaviour of aggregateCostTd (js/app.js),
 * compiled on its own so no DOM is needed; and a source guard over the four
 * renderers, because the regression is re-introduced by editing a template
 * string, not by breaking a function.
 *
 * Run: node tests/aggregate-cost-cell-not-editable.test.cjs
 */
const assert = require("assert");
const { appSource } = require("./helpers/app-source.cjs");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
// Normalized to \n: the repo is checked out with CRLF on Windows, and the
// source guards below anchor on line shape.
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

// ── compile aggregateCostTd on its own ──────────────────────────────────────

const appSrc = appSource();
const fnMatch = /\nfunction aggregateCostTd\([\s\S]*?\n}\n/.exec(appSrc);
assert.ok(fnMatch, "aggregateCostTd is missing from js/app.js");

const m = new Module("aggregate-cost-cell-test");
m._compile(
  `function tx(en) { return en; }
   function formatSilver(n) { return Math.round(Number(n) || 0).toLocaleString("en-US"); }
   ${fnMatch[0]}
   module.exports = { aggregateCostTd };`,
  path.join(ROOT, "js", "aggregate-cost-cell-test.js"),
);
const { aggregateCostTd } = m.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

// ── 1. the cell itself ──────────────────────────────────────────────────────

console.log("\n=== aggregateCostTd renders a plain cell ===");

test("it carries no data-item-id — there is no key to override", () => {
  assert.doesNotMatch(aggregateCostTd(12345), /data-item-id/);
});

test("it is not marked price-editable", () => {
  assert.doesNotMatch(aggregateCostTd(12345), /price-editable/);
});

test("it keeps the silver-val and cell-num classes the column CSS needs", () => {
  const html = aggregateCostTd(12345);
  assert.match(html, /class="[^"]*silver-val[^"]*"/);
  assert.match(html, /class="[^"]*cell-num[^"]*"/);
});

test("it shows the formatted figure", () => {
  assert.match(aggregateCostTd(1234567), />1,234,567</);
});

test("it points the user at the column where a price IS editable", () => {
  assert.match(aggregateCostTd(500), /title="[^"]*Materials column/);
});

for (const [label, value] of [["zero", 0], ["negative", -5], ["null", null],
  ["undefined", undefined], ["NaN", NaN]]) {
  test(`a ${label} cost renders the em-dash, not a number`, () => {
    const html = aggregateCostTd(value);
    // The cell TEXT — attribute values (the grey hex) are not what is displayed.
    const text = /<td[^>]*>([\s\S]*)<\/td>/.exec(html)[1];
    assert.strictEqual(text, "—");
  });
}

test("a caller-supplied class list is honoured", () => {
  assert.match(aggregateCostTd(10, "silver-val cell-note"), /class="silver-val cell-note"/);
});

// ── 2. the four renderers ───────────────────────────────────────────────────

console.log("\n=== the four cost columns use it ===");

const RENDERERS = [
  ["Crafting", "js/render-crafting.js", "totalInputCost"],
  ["Craft Planner", "js/render-craft-planner.js", "row.refineCraftCost"],
  ["Transport", "js/render-transport.js", "totalRawCost"],
  ["Transmute", "js/render-transmute.js", "row.totalInputCost"],
];

for (const [name, file, expr] of RENDERERS) {
  test(`${name} renders its cost cell with aggregateCostTd(${expr})`, () => {
    const src = read(file);
    assert.ok(
      src.includes(`aggregateCostTd(${expr})`),
      `${file} should call aggregateCostTd(${expr})`,
    );
  });

  test(`${name} no longer routes that cost through priceTd`, () => {
    const src = read(file);
    // priceTd's first argument is the displayed number; an aggregate there is
    // the bug. Sell-price cells (unit prices) may and must keep using priceTd.
    const bad = new RegExp(`priceTd\\(\\s*${expr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
    assert.doesNotMatch(src, bad);
  });
}

test("the dead `<itemId>_mat` override key is gone from every renderer", () => {
  for (const [, file] of RENDERERS) {
    assert.doesNotMatch(read(file), /\+ "_mat"/, `${file} still builds a _mat key`);
  }
});

test("no renderer anywhere still builds a _mat override key", () => {
  const offenders = fs.readdirSync(path.join(ROOT, "js"))
    .filter((f) => f.endsWith(".js"))
    .filter((f) => /\+ "_mat"/.test(read(`js/${f}`)));
  assert.deepStrictEqual(offenders, [], `these files still key an override on _mat: ${offenders}`);
});

test("the `_refined` sell key is untouched — it is a real, read-back id fallback", () => {
  assert.match(read("js/render-transport.js"), /_refined/);
});

// ── 3. the per-unit editors are still there ─────────────────────────────────

console.log("\n=== the editable per-unit cells survive ===");

for (const [name, file] of [
  ["Crafting", "js/render-crafting.js"],
  ["Craft Planner", "js/render-craft-planner.js"],
  ["Transport", "js/render-transport.js"],
  ["Transmute", "js/render-transmute.js"],
]) {
  test(`${name} still renders editable per-unit material prices`, () => {
    assert.match(read(file), /matPriceSpan\(/, "the Materials column is where a price is pinned");
  });
}

test("matId/matCount stay on the catalog — they are the cold-cache recipe fallback", () => {
  assert.match(read("js/recipe-resolver.js"), /if \(item\.matId\) return \[\{ matId: item\.matId, count: item\.matCount \}\]/);
});

console.log(`\n${passed + failed} run | ${passed} passed | ${failed} failed`);
if (failed > 0) process.exit(1);
