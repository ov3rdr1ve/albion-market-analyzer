/**
 * Test: computeTooltipPosition — the pure placement math behind the instant
 * hover tooltip (js/tooltips.js).
 *
 * The tooltip box prefers to sit centered ABOVE its anchor, flips BELOW when
 * there isn't room above, and is always clamped fully inside the viewport (with
 * an 8px default margin). This is the only part of the tooltip system that is
 * pure (no DOM), so it's the part we unit-test; the hover/focus wiring is DOM
 * behaviour verified in-browser.
 *
 * Black-box: feed plain rect/size/viewport objects, assert the returned
 * {left, top, placement}. No DOM, no live API.
 *
 * Run: node tests/tooltip-position.test.cjs
 */

const assert = require("assert");
const { computeTooltipPosition } = require("../js/tooltips.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const tip = { width: 200, height: 40 };
const vp = { width: 1000, height: 768 };
const anchorAt = (left, top, width = 60, height = 20) => ({
  left, top, width, height, right: left + width, bottom: top + height,
});

console.log("\n=== computeTooltipPosition — placement ===");

test("centered above the anchor when there is room above", () => {
  const pos = computeTooltipPosition(anchorAt(500, 300), tip, vp);
  // centeredLeft = 500 + 30 − 100 = 430 ; aboveTop = 300 − 40 − 8 = 252
  assert.deepStrictEqual(pos, { left: 430, top: 252, placement: "top" });
});

test("flips below the anchor when it would clip the top edge", () => {
  const pos = computeTooltipPosition(anchorAt(500, 10), tip, vp);
  // aboveTop = 10 − 40 − 8 = −38 < margin → below at bottom+8 = 30+8 = 38
  assert.strictEqual(pos.placement, "bottom");
  assert.strictEqual(pos.top, 38);
  assert.strictEqual(pos.left, 430);
});

console.log("\n=== computeTooltipPosition — horizontal clamping ===");

test("clamps to the left margin near the left edge", () => {
  const pos = computeTooltipPosition(anchorAt(5, 300), tip, vp);
  // centeredLeft = 5 + 30 − 100 = −65 → clamped to margin 8
  assert.strictEqual(pos.left, 8);
});

test("clamps to the right margin near the right edge", () => {
  const pos = computeTooltipPosition(anchorAt(950, 300, 40), tip, vp);
  // centeredLeft = 950 + 20 − 100 = 870 ; maxLeft = 1000 − 200 − 8 = 792
  assert.strictEqual(pos.left, 792);
});

test("a tooltip wider than the viewport still lands at the left margin (never negative)", () => {
  const pos = computeTooltipPosition(anchorAt(40, 300), { width: 1200, height: 40 }, vp);
  assert.strictEqual(pos.left, 8, "maxLeft floors at margin, so left stays = margin");
});

console.log("\n=== computeTooltipPosition — vertical clamping ===");

test("when neither above nor fully below fits, below is clamped inside the viewport", () => {
  const pos = computeTooltipPosition(anchorAt(500, 5), { width: 200, height: 40 }, { width: 1000, height: 50 });
  // aboveTop < margin → below ; belowTop = 25 + 8 = 33 ; maxTop = max(8, 50−40−8=2) = 8
  assert.strictEqual(pos.placement, "bottom");
  assert.strictEqual(pos.top, 8);
});

console.log("\n=== computeTooltipPosition — options & output shape ===");

test("honours a custom margin", () => {
  const pos = computeTooltipPosition(anchorAt(500, 300), tip, vp, 4);
  // aboveTop = 300 − 40 − 4 = 256 ; centeredLeft unchanged = 430
  assert.deepStrictEqual(pos, { left: 430, top: 256, placement: "top" });
});

test("left/top are integers (rounded for crisp positioning)", () => {
  const pos = computeTooltipPosition(anchorAt(501, 301, 61, 21), { width: 199, height: 41 }, vp);
  assert.ok(Number.isInteger(pos.left), `left ${pos.left} should be an integer`);
  assert.ok(Number.isInteger(pos.top), `top ${pos.top} should be an integer`);
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
