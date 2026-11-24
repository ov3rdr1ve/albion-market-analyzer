/**
 * Tests for the Global Discount strip on the Gold Chart panel
 * (js/render-global-discount.js).
 *
 * The whole point of the strip is that at gold above the 5,000 pivot the
 * discount is 0% and NOTHING in the tables moves — without a readout there is
 * no on-screen evidence the live gold price is wired in at all. So the three
 * states it has to distinguish are:
 *
 *   - gold unknown  → say so, and say costs are billed at full price
 *   - gold >= 5000  → "Global Discount 0%", grey, multiplier stated as 1.000
 *   - gold <  5000  → the real percentage, green, multiplier and the affected
 *                     silver sinks named
 *
 * Black-box: buildGlobalDiscountReadout is driven directly for the view model,
 * then renderGlobalDiscountReadout is run against a minimal document stub to
 * confirm it paints the element (and paints text, not markup).
 *
 * Run: node tests/global-discount-readout.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

// Minimal DOM: one element, children collected so textContent can be rebuilt.
const domStub = `
function _mkEl(tag) {
  return {
    tagName: tag,
    style: {},
    children: [],
    _text: "",
    set textContent(v) { this._text = String(v); this.children = []; },
    get textContent() {
      return this.children.length
        ? this.children.map((c) => c.textContent).join("")
        : this._text;
    },
    appendChild(c) { this.children.push(c); return c; },
  };
}
const _readoutEl = _mkEl("div");
const document = {
  getElementById: (id) => (id === "global-discount-readout" ? _readoutEl : null),
  createElement: (tag) => _mkEl(tag),
};
`;

const mod = new Module("global-discount-readout-test");
mod._compile(
  "const localStorage = undefined;\n" +
    domStub +
    read("global-discount.js") +
    read("render-global-discount.js") +
    "\nmodule.exports = { buildGlobalDiscountReadout, renderGlobalDiscountReadout," +
    " setGoldPrice, getGlobalDiscountFactor, getGlobalDiscountPercent, _readoutEl };",
  "render-global-discount.js",
);
const {
  buildGlobalDiscountReadout,
  renderGlobalDiscountReadout,
  setGoldPrice,
  getGlobalDiscountFactor,
  getGlobalDiscountPercent,
  _readoutEl,
} = mod.exports;

let passed = 0,
  failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL: ${name} — ${err.message}`);
    failed++;
  }
}

console.log("\n=== Global Discount readout — view model ===");

test("gold unknown: says so and warns costs are at full price", () => {
  const v = buildGlobalDiscountReadout(null, 1, 0);
  assert.strictEqual(v.tone, "unknown");
  assert.match(v.headline, /unavailable/i);
  assert.match(v.detail, /full price/i);
});

[
  [5000, "exactly at the pivot"],
  [7872, "today's live gold"],
  [8700, "well above the pivot"],
].forEach(([gold, why]) => {
  test(`gold ${gold} (${why}): 0% and an explicit ×1.000`, () => {
    const v = buildGlobalDiscountReadout(gold, 1, 0);
    assert.strictEqual(v.tone, "none");
    assert.match(v.headline, /Global Discount 0%/);
    assert.match(v.detail, /×1\.000/);
    assert.match(v.detail, /5,000 pivot/);
  });
});

// [gold, factor, percent, expected % text, expected multiplier text]
[
  [2500, 0.5, 50, "50.0%", "×0.500"],
  [4000, 0.8, 20, "20.0%", "×0.800"],
  [4763, 0.9526, 4.74, "4.7%", "×0.953"],
  [0, 0, 100, "100.0%", "×0.000"],
].forEach(([gold, factor, percent, pctText, multText]) => {
  test(`gold ${gold}: ${pctText} off, ${multText}`, () => {
    const v = buildGlobalDiscountReadout(gold, factor, percent);
    assert.strictEqual(v.tone, "active");
    assert.ok(v.headline.includes(pctText), `headline was "${v.headline}"`);
    assert.ok(v.detail.includes(multText), `detail was "${v.detail}"`);
  });
});

test("an active discount names the silver sinks it applies to", () => {
  const v = buildGlobalDiscountReadout(2500, 0.5, 50);
  ["station fees", "quality rerolls", "transmutes", "recipe silver", "travel"].forEach((sink) => {
    assert.ok(v.detail.includes(sink), `"${sink}" missing from "${v.detail}"`);
  });
});

test("the gold price is thousands-separated for readability", () => {
  assert.ok(buildGlobalDiscountReadout(7872, 1, 0).detail.includes("7,872"));
});

console.log("\n=== Global Discount readout — painting ===");

test("renders the live factor into the panel element", () => {
  setGoldPrice(2500);
  renderGlobalDiscountReadout();
  assert.match(_readoutEl.textContent, /Global Discount 50\.0%/);
  assert.match(_readoutEl.textContent, /×0\.500/);
});

test("repainting replaces the previous state instead of appending", () => {
  setGoldPrice(2500);
  renderGlobalDiscountReadout();
  setGoldPrice(7872);
  renderGlobalDiscountReadout();
  assert.strictEqual(_readoutEl.children.length, 2, "headline + detail only");
  assert.ok(!/50\.0%/.test(_readoutEl.textContent), "stale discount still shown");
  assert.match(_readoutEl.textContent, /Global Discount 0%/);
});

test("the strip tracks the same factor the tables are billed at", () => {
  setGoldPrice(4000);
  renderGlobalDiscountReadout();
  const pct = getGlobalDiscountPercent().toFixed(1);
  assert.ok(_readoutEl.textContent.includes(`${pct}%`), `strip vs factor drift`);
  assert.ok(
    _readoutEl.textContent.includes(`×${getGlobalDiscountFactor().toFixed(3)}`),
    "multiplier drift",
  );
});

test("paints text nodes, never markup", () => {
  setGoldPrice(2500);
  renderGlobalDiscountReadout();
  assert.ok(!/[<>]/.test(_readoutEl.textContent), "markup leaked into the strip");
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
