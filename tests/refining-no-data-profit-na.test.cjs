/**
 * Test: refining routes with missing market data must show profit as n/a,
 * not a number invented from partial data.
 *
 * Repro (the reported bug): a refined row whose RAW resource has no market
 * data ("5x 8.4 logs @ no data") but whose secondary IS priced ("1x 7.4
 * planks @ 949,999") was still printing a profit — the fallback computed a
 * margin from the secondary cost alone, treating the unpriced raw as free.
 *
 * The gate is the pure helper `isRefineRouteFullyPriced(rawPrice, hasSecondary,
 * secPrice, secChain, sellPrice)` in render-transport.js. A route is fully
 * priced — and may show a real margin — only when the raw, the secondary (when
 * the recipe needs one and it isn't chain-sourced) and the sell price are all
 * present. Otherwise render-transport marks the row margin -1 (n/a).
 *
 * Black-box: exercises input prices -> fully-priced boolean. No DOM, no live
 * data. render-transport.js compiles standalone (only function declarations at
 * top level); the test appends a module.exports for the helper under test.
 *
 * Run: node tests/refining-no-data-profit-na.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

function loadFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const mod = new Module("refining-no-data-profit-na-test");
mod._compile(
  loadFile("js/refining-route.js") + loadFile("js/render-transport.js") +
    "\nmodule.exports = { isRefineRouteFullyPriced };",
  "render-transport.js",
);
const { isRefineRouteFullyPriced } = mod.exports;

let passed = 0,
  failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

console.log("Refining — no-data profit is n/a\n");

test("helper is exported as a function", () => {
  assert.strictEqual(typeof isRefineRouteFullyPriced, "function");
});

// args: (rawPrice, hasSecondary, secPrice, secChain, sellPrice) -> expected
const CASES = [
  // The reported bug: raw unpriced, secondary + sell priced -> NOT fully priced.
  ["raw missing, secondary+sell priced (the repro)", [0, true, 949999, null, 5000], false],
  // Symmetric: secondary unpriced (and no chain) while raw + sell priced.
  ["secondary missing (no chain), raw+sell priced", [1500, true, 0, null, 5000], false],
  // A chain supplies the secondary price even when its market price is 0.
  ["secondary 0 but chain-sourced -> priced", [1500, true, 0, { costPerOutput: 800 }, 5000], true],
  // Sell side unpriced -> can't value the output.
  ["sell missing, inputs priced", [1500, true, 800, null, 0], false],
  // Recipe with no secondary (rare/none): raw + sell is enough.
  ["no secondary, raw+sell priced", [1500, false, 0, null, 5000], true],
  // The normal/thin-volume happy path: everything priced.
  ["all priced", [1500, true, 800, null, 5000], true],
  // Nothing priced at all.
  ["everything missing", [0, false, 0, null, 0], false],
  // Negative/garbage prices are treated as missing.
  ["negative raw price treated as missing", [-1, false, 0, null, 5000], false],
];

for (const [name, args, expected] of CASES) {
  test(name, () => {
    assert.strictEqual(isRefineRouteFullyPriced(...args), expected);
  });
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
