/**
 * Test: the recursive chain breakdown indents by ONE fixed class per level, and
 * the depth comes from the DOM nesting alone.
 *
 * The old renderer wrote an inline `margin-left: depth * 16px` on a wrapper that
 * was ALSO nested inside its parent, so the two compounded: a 4-deep chain
 * reached 16+32+48+64 = 160px. The Refining / Transports table hid this behind a
 * `#transport-table` CSS override, but My Crafting List clones those rows into
 * #craft-list-table where an id-scoped rule no longer matches — so the same row
 * rendered fine in one table and squeezed into a ribbon in the other.
 *
 * Black-box: feeds chains of varying depth to renderChainBreakdown and asserts
 * on the emitted HTML only.
 *
 * Run: node tests/chain-indent-class.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

globalThis.tx = globalThis.tx || ((en) => en);

const stubs = `
const ITEM_NAMES_MAP = {};
function getItemDisplayName(id) { return id; }
function formatSilver(n) { return Math.round(n).toLocaleString(); }
function matPriceSpan(matId, city, price) {
  return '<span data-item-id="' + matId + '" data-city="' + (city || "") + '">@ ' +
         (price > 0 ? formatSilver(price) : "no data") + ' ea</span>';
}
`;

const helperBlock = fs.readFileSync(
  path.join(__dirname, "..", "js/render-chain-breakdown.js"), "utf8");

const mod = new Module("chain-indent-class-test");
mod._compile(
  stubs + helperBlock + "\nmodule.exports = { renderChainBreakdown, transmuteSubstituteLines };",
  "render-chain-breakdown.js"
);
const { renderChainBreakdown, transmuteSubstituteLines } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// A chain of `depth` refine steps: T{4+depth} down to T4, each step buying its
// raw at market and refining the tier below as its secondary.
function makeLadder(depth) {
  let node = null;
  for (let i = 0; i <= depth; i++) {
    const tier = 4 + i;
    const secSourcing = node
      ? { perUnit: node.costPerOutput, source: "chain", chain: node, city: null }
      : { perUnit: 50, source: "market", city: "Fort Sterling" };
    node = {
      produces: `T${tier}_PLANKS`,
      output: 1,
      station: `Refine wood at Fort Sterling`,
      refineCity: "Fort Sterling",
      rrr: 0.367,
      focusCost: 60,
      tier,
      resourceType: "wood",
      inputs: [
        { matId: `T${tier}_WOOD`, count: 2,
          sourcing: { perUnit: 100 * tier, source: "market", city: "Fort Sterling" } },
        { matId: `T${tier - 1}_PLANKS`, count: 1, sourcing: secSourcing },
      ],
      costPerOutput: 100 * tier,
    };
  }
  return node;
}

const countIndents = (html) => (html.match(/class="chain-indent"/g) || []).length;

console.log("\n=== One indent class per nesting level ===");
// depth 0 = a single refine step (1 wrapper); each extra level adds exactly one.
[[0, 1], [1, 2], [2, 3], [3, 4]].forEach(([depth, expected]) => {
  test(`ladder of depth ${depth} emits ${expected} chain-indent wrapper(s)`, () => {
    const html = renderChainBreakdown(makeLadder(depth), 1);
    assert.strictEqual(countIndents(html), expected);
  });
});

console.log("\n=== No inline margin anywhere ===");
[0, 1, 2, 3].forEach((depth) => {
  test(`ladder of depth ${depth} writes no inline margin-left`, () => {
    const html = renderChainBreakdown(makeLadder(depth), 1);
    assert.ok(!html.includes("margin-left"),
      "the depth must come from DOM nesting, not a scaled inline margin");
  });
});

console.log("\n=== Indent is independent of the caller's `indent` argument ===");
// The parameter survives for call-site compatibility but must not change spacing:
// two callers passing different values must produce identical HTML.
[[undefined, 1], [1, 3], [2, 5]].forEach(([a, b]) => {
  test(`indent=${a} and indent=${b} render identically`, () => {
    const chain = makeLadder(2);
    assert.strictEqual(
      renderChainBreakdown(chain, 1, a),
      renderChainBreakdown(chain, 1, b));
  });
});

console.log("\n=== Nesting order ===");
test("each deeper wrapper opens after the one above it", () => {
  const html = renderChainBreakdown(makeLadder(3), 1);
  const idx = [];
  let at = -1;
  while ((at = html.indexOf('class="chain-indent"', at + 1)) !== -1) idx.push(at);
  assert.strictEqual(idx.length, 4);
  for (let i = 1; i < idx.length; i++) {
    assert.ok(idx[i] > idx[i - 1], "deeper level must open later in the markup");
  }
});

console.log("\n=== Transmute substitution block uses the same class ===");
test("transmuteSubstituteLines emits chain-indent, not an inline margin", () => {
  const html = transmuteSubstituteLines({
    startId: "T7_HIDE",
    startCity: "Fort Sterling",
    startPrice: 3547,
    steps: [{ fromId: "T7_HIDE", toId: "T8_HIDE", fee: 5000, stationFee: 521 }],
  }, 5);
  assert.ok(html.includes('class="chain-indent"'));
  assert.ok(!html.includes("margin-left"));
});

test("transmuteSubstituteLines ignores its indent argument", () => {
  const t = {
    startId: "T7_HIDE", startCity: "Fort Sterling", startPrice: 3547,
    steps: [{ fromId: "T7_HIDE", toId: "T8_HIDE", fee: 5000, stationFee: 521 }],
  };
  assert.strictEqual(transmuteSubstituteLines(t, 5, 1), transmuteSubstituteLines(t, 5, 4));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
