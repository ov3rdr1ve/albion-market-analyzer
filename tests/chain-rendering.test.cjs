/**
 * Test: chain breakdown rendering for the consumables table.
 *
 * Locks in the shape of the chain tree itself: station header, batch scaling,
 * one fixed indent per DOM level, and an editable price span on every market
 * leaf (including a zero-price one — that is the cell the user has to type
 * into).
 *
 * The tree is no longer inlined in the Ingredients cell whenever the chain
 * undercuts the market; the consumables row buys its ingredients at market and
 * offers the chain in the "alternative routes" panel instead
 * (tests/consumable-alt-routes.test.cjs). Both callers render it through this
 * same function, so these assertions cover it wherever it is drawn.
 *
 * Run: node tests/chain-rendering.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

// Row text runs through tx(english, slug); en-mode identity keeps assertions in English.
globalThis.tx = globalThis.tx || ((en) => en);

function load(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

// Stubs: just enough scaffolding for renderChainBreakdown to produce HTML.
// matPriceSpan mirrors the real helper in app.js so we can assert that
// market leaves render as click-to-edit spans (the user has to be able to
// type in a grown-animal price when the live market has no listing).
const stubs = `
const ITEM_NAMES_MAP = {
  T4_FARM_GOAT_GROWN: "Grown Goat [T4]",
  T6_FARM_SHEEP_GROWN: "Grown Sheep [T6]",
  T3_WHEAT: "Wheat [T3]",
  T3_FLOUR: "Flour [T3]",
};
function getItemDisplayName() { return null; }
function formatSilver(n) { return Math.round(n).toLocaleString(); }
function matPriceSpan(matId, city, price) {
  const display = price > 0 ? formatSilver(price) : "no data";
  return '<span class="price-editable mat-price-inline" data-item-id="' + matId +
         '" data-city="' + (city || "") + '" data-raw-price="' + price +
         '">@ ' + display + ' ea</span>';
}
`;

// renderChainBreakdown lives in its own file (extracted from render-consumables.js
// to stay under the 800-line cap). Load that helper directly.
const helperBlock = load("js/render-chain-breakdown.js");

const mod = new Module("chain-rendering-test");
mod._compile(
  stubs + helperBlock + "\nmodule.exports = { renderChainBreakdown };",
  "render-chain-breakdown.js"
);
const { renderChainBreakdown } = mod.exports;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("\n=== Butcher chain HTML ===");
test("renders grown animal indented under butcher header", () => {
  const chain = {
    produces: "T4_MEAT",
    output: 18,
    station: "butcher",
    inputs: [
      { matId: "T4_FARM_GOAT_GROWN", count: 1, noReturn: true,
        sourcing: { perUnit: 2000, source: "market", city: "Lymhurst" } },
    ],
    costPerOutput: 100,
  };
  const html = renderChainBreakdown(chain, 27); // need 27 meats → 1.5 batches
  assert.ok(html.includes("butcher batches"), "should mention station label");
  assert.ok(html.includes("Grown Goat"), "should list grown animal");
  assert.ok(html.includes("(from Lymhurst)"), "leaf should show source city");
  // 27/18 = 1.50 batches → 1.5 grown
  assert.ok(/1\.50x butcher batches/.test(html), `expected '1.50x batches' in ${html.slice(0,200)}`);
  assert.ok(/1\.50x Grown Goat/.test(html), "should scale grown count");
});

console.log("\n=== Recursive chain HTML ===");
test("renders nested mill leaf under bakery", () => {
  const chain = {
    produces: "T4_BREAD",
    output: 1,
    station: "cook",
    inputs: [
      { matId: "T3_FLOUR", count: 1,
        sourcing: { perUnit: 35, source: "chain", chain: {
          produces: "T3_FLOUR", output: 1, station: "mill",
          inputs: [
            { matId: "T3_WHEAT", count: 1,
              sourcing: { perUnit: 35, source: "market", city: "Bridgewatch" } },
          ],
          costPerOutput: 35,
        } },
      },
    ],
    costPerOutput: 35,
  };
  const html = renderChainBreakdown(chain, 12);
  assert.ok(html.includes("cook batches"), "outer batch tag");
  assert.ok(html.includes("mill batches"), "inner batch tag");
  assert.ok(html.includes("Flour"), "flour leaf");
  assert.ok(html.includes("Wheat"), "wheat leaf");
  assert.ok(html.includes("(from Bridgewatch)"), "deep leaf city");
  // Indent is one fixed class per level; depth comes from the DOM nesting, so
  // the inner block must open AFTER the outer one and neither may carry an
  // inline margin (that scheme double-counted depth and grew quadratically).
  const outerIdx = html.indexOf('class="chain-indent"');
  const innerIdx = html.indexOf('class="chain-indent"', outerIdx + 1);
  assert.ok(outerIdx >= 0 && innerIdx > outerIdx, "inner block must nest inside the outer");
  assert.ok(!html.includes("margin-left"), "no inline margin-left on chain levels");
});

console.log("\n=== Editable price spans ===");
test("market leaf renders as click-to-edit price span", () => {
  // When the user has no live market price for the grown animal (the
  // bug repro scenario), the chain still has to surface an editable span
  // so they can type in their cost.
  const chainPriced = {
    produces: "T4_MEAT", output: 18, station: "butcher",
    inputs: [
      { matId: "T4_FARM_GOAT_GROWN", count: 1, noReturn: true,
        sourcing: { perUnit: 2000, source: "market", city: "Lymhurst" } },
    ],
    costPerOutput: 100,
  };
  const html = renderChainBreakdown(chainPriced, 18);
  assert.ok(html.includes('class="price-editable mat-price-inline"'),
    "the grown-animal leaf must render a price-editable span");
  assert.ok(html.includes('data-item-id="T4_FARM_GOAT_GROWN"'),
    "span must carry the grown matId so click-to-edit hits the right override key");
  assert.ok(html.includes('data-city="Lymhurst"'),
    "span must carry the source city so the override binds to the right (matId, city) pair");
});

test("zero-price market leaf still renders editable span (no-data case)", () => {
  const chainEmpty = {
    produces: "T4_MEAT", output: 18, station: "butcher",
    inputs: [
      { matId: "T4_FARM_GOAT_GROWN", count: 1, noReturn: true,
        sourcing: { perUnit: 0, source: "market", city: "Lymhurst" } },
    ],
    costPerOutput: 0,
  };
  const html = renderChainBreakdown(chainEmpty, 18);
  // The edit affordance must show even when price is 0 — that's the very
  // case the user complained about (couldn't edit prices when chain had
  // no market data).
  assert.ok(html.includes('class="price-editable mat-price-inline"'));
  assert.ok(html.includes('data-raw-price="0"'));
  assert.ok(html.includes("no data"), "no-data label must be present so the user knows to click");
});

console.log("\n=== Empty chain ===");
test("returns empty string for null chain", () => {
  assert.strictEqual(renderChainBreakdown(null, 1), "");
  assert.strictEqual(renderChainBreakdown(undefined, 1), "");
});

console.log("\n=== Standalone chain craft row uses chain breakdown ===");
test("raw meat row shows full batch breakdown (1 grown → 18 meat)", () => {
  const chain = {
    produces: "T4_MEAT",
    output: 18,
    station: "butcher",
    inputs: [
      { matId: "T4_FARM_GOAT_GROWN", count: 1, noReturn: true,
        sourcing: { perUnit: 2000, source: "market", city: "Lymhurst" } },
    ],
    costPerOutput: 100,
  };
  // Standalone meat row passes consumedCount = chain.output, so the breakdown
  // shows the natural batch (1 grown × 1 batch → 18 meat).
  const html = renderChainBreakdown(chain, chain.output);
  assert.ok(/1\.00x butcher batches/.test(html));
  assert.ok(/1\.00x Grown Goat/.test(html));
});

// ── Summary ──
console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
