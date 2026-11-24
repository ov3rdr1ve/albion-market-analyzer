/**
 * Tests for where the inline price editor is placed (UI — written after the
 * behaviour, per the front-end convention in CLAUDE.md).
 *
 * The editor is centred on the cell it edits. That is right everywhere except
 * the edges: the last column, Price (Top City), sits hard against the window
 * edge, and a box centred there hangs half off the screen where nothing can
 * scroll to it — which is how the ✗ button disappeared.
 *
 * Black-box: rectangles in, coordinates out.
 *
 * Run: node tests/price-edit-position.test.cjs
 */

const assert = require("assert");
const { clampEditorPosition } = require("../js/price-edit-position.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

const VIEW = { width: 1900, height: 900 };
const EDITOR = { width: 560, height: 60 };
const cell = (left, top, width = 200, height = 28) => ({ left, top, width, height });
const place = (c, editor = EDITOR, view = VIEW) => clampEditorPosition(c, editor, view);

// ── the ordinary case ──────────────────────────────────────────────────────
test("an editor with room on both sides is centred on its cell", () => {
  const { left } = place(cell(800, 400));
  assert.strictEqual(left, 800 + 100 - 280);
});

test("it is centred vertically on the cell too", () => {
  const { top } = place(cell(800, 400));
  assert.strictEqual(top, 400 + 14 - 30);
});

// ── the edges ──────────────────────────────────────────────────────────────
const EDGE_CASES = [
  ["the last column keeps the whole editor on screen", cell(1700, 400), { left: 1900 - 8 - 560 }],
  ["the first column does not hang off the left", cell(0, 400), { left: 8 }],
  ["a cell at the bottom keeps the editor on screen", cell(800, 880), { top: 900 - 8 - 60 }],
  ["a cell at the very top keeps its margin", cell(800, 0), { top: 8 }],
];
EDGE_CASES.forEach(([label, c, expected]) => {
  test(label, () => {
    const got = place(c);
    Object.keys(expected).forEach((k) => assert.strictEqual(got[k], expected[k], k));
  });
});

test("the right edge wins over centring, but never at the cost of the left", () => {
  const { left } = place(cell(1890, 400));
  assert.ok(left >= 8 && left + 560 <= 1900 - 8, `left ${left} is inside the window`);
});

// ── degenerate sizes ───────────────────────────────────────────────────────
// A window narrower than the editor has no good answer; pinning it to the left
// keeps the dropdown and both price fields reachable, which is the part that
// matters. Clamping the far edge first would push those off instead.
test("an editor wider than the window is pinned to the left edge", () => {
  const { left } = place(cell(100, 400), { width: 2000, height: 60 }, VIEW);
  assert.strictEqual(left, 8);
});

test("an editor taller than the window is pinned to the top", () => {
  const { top } = place(cell(100, 400), { width: 200, height: 1000 }, VIEW);
  assert.strictEqual(top, 8);
});

test("the margin is honoured on request", () => {
  const { left } = clampEditorPosition(cell(1700, 400), EDITOR, VIEW, 20);
  assert.strictEqual(left, 1900 - 20 - 560);
});

test("coordinates come back rounded, not fractional", () => {
  const { left, top } = place(cell(801, 401, 55, 33), { width: 100, height: 41 });
  assert.strictEqual(left, Math.round(left));
  assert.strictEqual(top, Math.round(top));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
