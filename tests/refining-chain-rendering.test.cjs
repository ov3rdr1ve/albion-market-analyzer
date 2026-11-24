/**
 * Test: refining chain HTML rendering. Locks in the "(via chain)" tag
 * and indented breakdown when secondaryChain is present, plus the
 * [Focus@T{N}] label when the picker selects a non-root tier.
 *
 * Uses renderChainBreakdown from js/render-chain-breakdown.js (shared
 * chain HTML helper) — same one consumables uses, so the tag color and
 * indentation are identical.
 *
 * Run: node tests/refining-chain-rendering.test.cjs
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

const stubs = `
const ITEM_NAMES_MAP = {};
function getItemDisplayName(id) { return id; }
function formatSilver(n) { return Math.round(n).toLocaleString(); }
function matPriceSpan(matId, city, price) {
  const display = price > 0 ? formatSilver(price) : "no data";
  return '<span class="price-editable mat-price-inline" data-item-id="' + matId +
         '" data-city="' + (city || "") + '" data-raw-price="' + price +
         '">@ ' + display + ' ea</span>';
}
`;

const helperBlock = load("js/render-chain-breakdown.js");

const mod = new Module("refining-chain-rendering-test");
mod._compile(
  stubs + helperBlock + "\nmodule.exports = { renderChainBreakdown };",
  "render-chain-breakdown.js"
);
const { renderChainBreakdown } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// Build a minimal refining chain ChainNode for rendering.
function makeChain({ produces, station, inputs }) {
  return {
    produces,
    output: 1,
    station,
    refineCity: "Fort Sterling",
    rrr: 0.367,
    focusCost: 60,
    tier: parseInt(produces.match(/^T(\d)/)[1], 10),
    resourceType: "wood",
    inputs,
    costPerOutput: 100,
  };
}

console.log("\n=== Single-step refining chain (T5 plank, T4 secondary from market) ===");
test("renders raw and secondary lines with refining station header", () => {
  const chain = makeChain({
    produces: "T5_PLANKS",
    station: "Refine wood at Fort Sterling",
    inputs: [
      { matId: "T5_WOOD",   count: 3, sourcing: { perUnit: 100, source: "market", city: "Fort Sterling" } },
      { matId: "T4_PLANKS", count: 1, sourcing: { perUnit: 200, source: "market", city: "Fort Sterling" } },
    ],
  });
  const html = renderChainBreakdown(chain, 1);
  assert.ok(html.includes("Refine wood at Fort Sterling"),
    "header should include refining station label");
  assert.ok(!html.includes(" batches"),
    "refining headers should not say 'batches' (grammar fix)");
  assert.ok(html.includes("T5_WOOD"), "raw input should appear");
  assert.ok(html.includes("T4_PLANKS"), "secondary input should appear");
  assert.ok(html.includes("(from Fort Sterling)"), "leaf city tag should be present");
  assert.ok(html.includes("price-editable"), "market leaves render as editable spans");
});

console.log("\n=== Recursive refining chain (T6 plank → T5 plank) ===");
test("nested chain renders with deeper indent", () => {
  const innerT5 = makeChain({
    produces: "T5_PLANKS",
    station: "Refine wood at Fort Sterling",
    inputs: [
      { matId: "T5_WOOD",   count: 3, sourcing: { perUnit: 50, source: "market", city: "Fort Sterling" } },
      { matId: "T4_PLANKS", count: 1, sourcing: { perUnit: 30, source: "market", city: "Fort Sterling" } },
    ],
  });
  const outerT6 = makeChain({
    produces: "T6_PLANKS",
    station: "Refine wood at Fort Sterling",
    inputs: [
      { matId: "T6_WOOD",   count: 4, sourcing: { perUnit: 80, source: "market", city: "Fort Sterling" } },
      { matId: "T5_PLANKS", count: 1, sourcing: { perUnit: innerT5.costPerOutput, source: "chain", chain: innerT5, city: null } },
    ],
  });
  const html = renderChainBreakdown(outerT6, 1);
  // Outer has T6_WOOD market leaf; inner appears nested via recursion
  assert.ok(html.includes("T6_WOOD"));
  assert.ok(html.includes("T5_WOOD"), "inner chain's raw should be in the html");
  assert.ok(html.includes("T4_PLANKS"));
  // Two nested <div>s, each carrying the fixed indent class — the depth comes
  // from the nesting, never from a depth-scaled inline margin.
  assert.strictEqual((html.match(/class="chain-indent"/g) || []).length, 2);
  assert.ok(!html.includes("margin-left"), "no inline margin-left on chain levels");
});

console.log("\n=== Override-aware market leaves ===");
test("market leaves carry data-item-id and data-city for override clicks", () => {
  const chain = makeChain({
    produces: "T5_PLANKS",
    station: "Refine wood at Fort Sterling",
    inputs: [
      { matId: "T5_WOOD",   count: 3, sourcing: { perUnit: 100, source: "market", city: "Fort Sterling" } },
      { matId: "T4_PLANKS", count: 1, sourcing: { perUnit: 0, source: "market", city: "Fort Sterling" } },
    ],
  });
  const html = renderChainBreakdown(chain, 1);
  assert.ok(html.includes('data-item-id="T5_WOOD"'));
  assert.ok(html.includes('data-item-id="T4_PLANKS"'));
  // Zero-price leaf still renders an editable span (override path) — same
  // behavior consumables uses for missing market data.
  assert.ok(html.includes("no data") || html.includes("@ 0 ea"),
    "zero-price leaf should display 'no data' or '@ 0 ea' so user can override");
});

console.log("\n=== Faction heart leg ===");
// The Crafting Planner's chain opts into heart substitution (CP_CHAIN_OPTS), so
// the shared tree has to print the heart. It is bought at market like any leaf —
// editable price + city — and carries a tag naming the raw it stands in for.
const heartChain = () => makeChain({
  produces: "T5_PLANKS",
  station: "Refine wood at Fort Sterling",
  inputs: [
    { matId: "T5_WOOD", count: 2,
      sourcing: { perUnit: 200, source: "market", city: "Fort Sterling" } },
    { matId: "T4_PLANKS", count: 1,
      sourcing: { perUnit: 500, source: "market", city: "Fort Sterling" } },
    { matId: "T1_FACTION_FOREST_TOKEN_1", count: 1, noReturn: true,
      replacesMatId: "T5_WOOD",
      sourcing: { perUnit: 60, source: "heart", city: "Martlock", travelFeePerUnit: 0 } },
  ],
});

test("heart leg renders with an editable price span and its buy city", () => {
  const html = renderChainBreakdown(heartChain(), 1);
  assert.ok(html.includes('data-item-id="T1_FACTION_FOREST_TOKEN_1"'),
    "heart price must be click-to-edit like any other bought leaf");
  assert.ok(html.includes("(from Martlock)"), "heart names the city it is bought in");
});

test("heart leg is tagged as a substitution for the raw it replaces", () => {
  const html = renderChainBreakdown(heartChain(), 1);
  assert.ok(html.includes("(substitute — cheaper than T5_WOOD)"));
});

test("the raw line shows the REDUCED count beside the heart", () => {
  const html = renderChainBreakdown(heartChain(), 1);
  // rawRatio 3 minus the one unit the heart stands in for.
  assert.ok(html.includes("2.00x T5_WOOD"), "raw count must already be net of the heart");
});

test("a heart-free chain renders no substitute tag", () => {
  const html = renderChainBreakdown(makeChain({
    produces: "T5_PLANKS",
    station: "Refine wood at Fort Sterling",
    inputs: [
      { matId: "T5_WOOD", count: 3, sourcing: { perUnit: 200, source: "market", city: "Fort Sterling" } },
      { matId: "T4_PLANKS", count: 1, sourcing: { perUnit: 500, source: "market", city: "Fort Sterling" } },
    ],
  }), 1);
  assert.ok(!html.includes("substitute"));
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
