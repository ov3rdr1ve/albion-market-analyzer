/**
 * Tests for the edited-row scroll anchor (js/scroll-anchor.js).
 *
 * Committing a price redraws the tables, and a redraw changes how tall the rows
 * above the edited one are — so the row the user was looking at slides up or
 * down under the cursor. The anchor records where that row sat in the viewport
 * before the redraw and scrolls the difference back afterwards.
 *
 * The re-render is asynchronous now (js/render-async.js), which adds two
 * requirements the old inline version did not have:
 *
 *   - it is re-applied after EVERY phase, because each later phase can change
 *     the height of the page above the row again, so the correction has to be
 *     idempotent rather than a single shot;
 *   - it disarms the moment the user scrolls themselves. Yanking someone back
 *     to a row they deliberately scrolled away from is worse than the drift.
 *
 * Black-box: fake document and window, no DOM, no timers.
 *
 * Run: node tests/scroll-anchor.test.cjs
 */

const assert = require("assert");
const {
  captureRowAnchor,
  createAnchorRestorer,
} = require("../js/scroll-anchor.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

// ── fakes ──────────────────────────────────────────────────────────────────

/** A <td> inside a row with `key` inside a table with `tableId`, at `top`. */
function fakeCell({ key = "row-1", tableId = "crafting-table", top = 300 } = {}) {
  const tr = {
    dataset: key === null ? {} : { rowKey: key },
    getBoundingClientRect: () => ({ top }),
    closest: (sel) => (sel === "table" ? (tableId === null ? null : { id: tableId }) : null),
  };
  return { closest: (sel) => (sel === "tr" ? tr : null) };
}

/**
 * A page where the anchored row can be moved between re-applies, and every
 * scrollBy shifts the whole page — which is what makes the correction converge.
 */
function fakePage({ rowTop = 300, scrollY = 0, hasRow = true } = {}) {
  const state = { rowTop, scrollY, scrolls: [] };
  const win = {
    get scrollY() { return state.scrollY; },
    scrollBy: (x, dy) => {
      state.scrolls.push(dy);
      state.scrollY += dy;
      state.rowTop -= dy; // scrolling down moves the row up the viewport
    },
  };
  const doc = {
    querySelector: () => (hasRow ? { getBoundingClientRect: () => ({ top: state.rowTop }) } : null),
  };
  return { state, win, doc };
}

// ── capture ────────────────────────────────────────────────────────────────

test("the anchor records the row key, its table and its viewport top", () => {
  const a = captureRowAnchor(fakeCell({ key: "T4_BAG|Martlock", tableId: "crafting-table", top: 412 }));
  assert.deepStrictEqual(a, { key: "T4_BAG|Martlock", tableId: "crafting-table", top: 412 });
});

test("a row with no key cannot be found again, so there is no anchor", () => {
  assert.strictEqual(captureRowAnchor(fakeCell({ key: null })), null);
});

test("a cell outside a table has no anchor", () => {
  assert.strictEqual(captureRowAnchor(fakeCell({ tableId: null })), null);
});

test("a cell outside a row has no anchor", () => {
  assert.strictEqual(captureRowAnchor({ closest: () => null }), null);
  assert.strictEqual(captureRowAnchor(null), null);
});

// ── restore ────────────────────────────────────────────────────────────────

test("the row is put back exactly where it was", () => {
  const anchor = captureRowAnchor(fakeCell({ top: 300 }));
  const page = fakePage({ rowTop: 380 }); // the redraw pushed it 80px down
  createAnchorRestorer(anchor, page)();
  assert.deepStrictEqual(page.state.scrolls, [80]);
  assert.strictEqual(page.state.rowTop, 300);
});

test("re-applying after every phase converges and then costs nothing", () => {
  const anchor = captureRowAnchor(fakeCell({ top: 300 }));
  const page = fakePage({ rowTop: 340 });
  const reapply = createAnchorRestorer(anchor, page);
  reapply();
  reapply();
  reapply();
  // Only the first one moved anything: after it the row is already at 300.
  assert.deepStrictEqual(page.state.scrolls, [40]);
});

test("a later phase that shifts the row again is corrected too", () => {
  const anchor = captureRowAnchor(fakeCell({ top: 300 }));
  const page = fakePage({ rowTop: 340 });
  const reapply = createAnchorRestorer(anchor, page);
  reapply();
  page.state.rowTop = 275; // the boards phase drew above it and pulled it up
  reapply();
  assert.deepStrictEqual(page.state.scrolls, [40, -25]);
  assert.strictEqual(page.state.rowTop, 300);
});

test("once the user scrolls, the anchor gives up for good", () => {
  const anchor = captureRowAnchor(fakeCell({ top: 300 }));
  const page = fakePage({ rowTop: 340 });
  const reapply = createAnchorRestorer(anchor, page);
  assert.strictEqual(reapply(), true);

  page.state.scrollY += 900; // the user scrolled away mid-pass
  page.state.rowTop = 1200;
  assert.strictEqual(reapply(), false);
  page.state.rowTop = 90;
  assert.strictEqual(reapply(), false);
  assert.deepStrictEqual(page.state.scrolls, [40]);
});

test("a row the redraw dropped is left alone", () => {
  const anchor = captureRowAnchor(fakeCell({ top: 300 }));
  const page = fakePage({ hasRow: false });
  const reapply = createAnchorRestorer(anchor, page);
  assert.strictEqual(reapply(), false);
  assert.deepStrictEqual(page.state.scrolls, []);
});

test("no anchor means no scrolling, and no throwing", () => {
  const page = fakePage();
  const reapply = createAnchorRestorer(null, page);
  assert.strictEqual(reapply(), false);
  assert.deepStrictEqual(page.state.scrolls, []);
});

test("a row key with quotes or dots is still found", () => {
  const seen = [];
  const anchor = captureRowAnchor(fakeCell({ key: 'T4_BAG@1|"x".y', tableId: "crafting-table" }));
  const doc = { querySelector: (sel) => { seen.push(sel); return null; } };
  createAnchorRestorer(anchor, { doc, win: { scrollY: 0, scrollBy: () => {} } })();
  assert.strictEqual(seen.length, 1);
  assert.ok(seen[0].startsWith("#crafting-table tr[data-row-key="), seen[0]);
  assert.ok(!seen[0].includes('|"x".y'), "the key is escaped, not pasted raw");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
