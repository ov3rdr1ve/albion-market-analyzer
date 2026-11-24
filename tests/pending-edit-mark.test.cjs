/**
 * Tests for the pending-edit mark (js/pending-edit-mark.js).
 *
 * Committing a price closes the editor and starts an asynchronous redraw that
 * takes a second or two. js/recalc-cell-mark.js reports that across every number
 * the pass will replace; this marks the ONE cell the user actually typed into,
 * which is the one they are watching.
 *
 * The behaviour that matters, and the only reason this is a module rather than
 * two classList calls: the edited table is redrawn FIRST, so the marked <td> is
 * replaced within a few hundred milliseconds while the rest of the app is still
 * computing. The mark therefore has to be re-applicable by row identity, not
 * held on a node.
 *
 * Black-box: a tiny fake document, no DOM, no browser.
 *
 * Run: node tests/pending-edit-mark.test.cjs
 */

const assert = require("assert");
const { appSource } = require("./helpers/app-source.cjs");
const { readIndexHtml, readStyles } = require("./helpers/page-source.cjs");
const {
  PENDING_CELL_CLASS,
  PENDING_ROW_CLASS,
  createPendingEditMark,
} = require("../js/pending-edit-mark.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

// ── the fake document ──────────────────────────────────────────────────────
// One table, rows keyed by data-row-key, cells by position. Enough for
// closest(), querySelector("#table tr[data-row-key=…]") and querySelectorAll.

function makeEl(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    id: "",
    dataset: {},
    children: [],
    parent: null,
    classes: new Set(),
  };
  el.classList = {
    add: (c) => el.classes.add(c),
    remove: (c) => el.classes.delete(c),
    contains: (c) => el.classes.has(c),
  };
  el.append = (child) => { child.parent = el; el.children.push(child); return child; };
  el.closest = (sel) => {
    const want = sel.toUpperCase();
    let node = el;
    while (node) {
      if (node.tagName === want) return node;
      node = node.parent;
    }
    return null;
  };
  return el;
}

/** A table of rows: [{key, cells}] → {doc, table, rowByKey}. */
function makeDoc(tableId, rows) {
  const table = makeEl("table");
  table.id = tableId;
  const rowByKey = new Map();
  rows.forEach(({ key, cells = 3 }) => {
    const tr = makeEl("tr");
    if (key !== null) tr.dataset.rowKey = key;
    for (let i = 0; i < cells; i++) tr.append(makeEl("td"));
    tr.cells = tr.children;
    table.append(tr);
    if (key !== null) rowByKey.set(key, tr);
  });

  const walk = (node, out) => {
    out.push(node);
    node.children.forEach((c) => walk(c, out));
    return out;
  };

  const doc = {
    table,
    querySelectorAll(sel) {
      const want = sel.replace(".", "");
      return walk(table, []).filter((n) => n.classes.has(want));
    },
    querySelector(sel) {
      // Only the one shape the module builds: #<id> tr[data-row-key="<key>"]
      const m = /^#([\w-]+) tr\[data-row-key="(.*)"\]$/.exec(sel);
      if (!m) return null;
      if (m[1] !== table.id) return null;
      return rowByKey.get(m[2]) || null;
    },
  };
  return { doc, table, rowByKey };
}

/** Replace a row's cells with fresh nodes — what a redraw does to the tbody. */
function redraw(tr) {
  tr.children = tr.children.map(() => {
    const td = makeEl("td");
    td.parent = tr;
    return td;
  });
  tr.cells = tr.children;
  tr.classes.clear();
  return tr;
}

const marked = (el) => el.classes.has(PENDING_CELL_CLASS);
const rowMarked = (tr) => tr.classes.has(PENDING_ROW_CLASS);

// ── marking ────────────────────────────────────────────────────────────────

test("the edited cell and its row are marked at once", () => {
  const { doc, rowByKey } = makeDoc("crafting-table", [{ key: "T4_BAG" }]);
  const mark = createPendingEditMark({ doc });
  const tr = rowByKey.get("T4_BAG");
  mark.mark(tr.children[1]);
  assert.strictEqual(marked(tr.children[1]), true, "cell");
  assert.strictEqual(rowMarked(tr), true, "row");
  assert.strictEqual(marked(tr.children[0]), false, "only the edited cell");
});

test("it remembers WHICH cell, by table, row key and column", () => {
  const { doc, rowByKey } = makeDoc("flipping-table", [{ key: "T5_ORE@2" }]);
  const mark = createPendingEditMark({ doc });
  mark.mark(rowByKey.get("T5_ORE@2").children[2]);
  assert.deepStrictEqual(mark.state(), {
    tableId: "flipping-table",
    key: "T5_ORE@2",
    cellIndex: 2,
  });
});

// ── surviving the redraw, which is the whole point ─────────────────────────

test("the mark comes back after the row's cells are replaced", () => {
  const { doc, rowByKey } = makeDoc("crafting-table", [{ key: "T6_SWORD" }]);
  const mark = createPendingEditMark({ doc });
  const tr = rowByKey.get("T6_SWORD");
  mark.mark(tr.children[1]);

  redraw(tr); // the `edited` phase draws this table first
  assert.strictEqual(rowMarked(tr), false, "the redraw took the mark with it");

  assert.strictEqual(mark.reapply(), true);
  assert.strictEqual(marked(tr.children[1]), true, "same column");
  assert.strictEqual(rowMarked(tr), true);
});

test("re-applying is idempotent — it runs after EVERY phase", () => {
  const { doc, rowByKey } = makeDoc("crafting-table", [{ key: "T6_SWORD" }]);
  const mark = createPendingEditMark({ doc });
  const tr = rowByKey.get("T6_SWORD");
  mark.mark(tr.children[0]);
  mark.reapply();
  mark.reapply();
  mark.reapply();
  assert.strictEqual(doc.querySelectorAll(`.${PENDING_CELL_CLASS}`).length, 1);
  assert.strictEqual(doc.querySelectorAll(`.${PENDING_ROW_CLASS}`).length, 1);
});

test("a row the redraw dropped is not marked, and does not throw", () => {
  const { doc, rowByKey } = makeDoc("crafting-table", [{ key: "T4_BAG" }]);
  const mark = createPendingEditMark({ doc });
  mark.mark(rowByKey.get("T4_BAG").children[1]);
  rowByKey.delete("T4_BAG"); // filtered out, no longer profitable
  assert.strictEqual(mark.reapply(), false);
});

test("re-applying before anything was marked does nothing", () => {
  const { doc } = makeDoc("crafting-table", [{ key: "T4_BAG" }]);
  const mark = createPendingEditMark({ doc });
  assert.strictEqual(mark.reapply(), false);
  assert.strictEqual(doc.querySelectorAll(`.${PENDING_ROW_CLASS}`).length, 0);
});

// ── one edit at a time ─────────────────────────────────────────────────────

test("a second edit moves the mark instead of adding one", () => {
  const { doc, rowByKey } = makeDoc("crafting-table", [
    { key: "T4_BAG" },
    { key: "T5_BAG" },
  ]);
  const mark = createPendingEditMark({ doc });
  mark.mark(rowByKey.get("T4_BAG").children[1]);
  mark.mark(rowByKey.get("T5_BAG").children[2]);

  assert.strictEqual(rowMarked(rowByKey.get("T4_BAG")), false, "the first row let go");
  assert.strictEqual(rowMarked(rowByKey.get("T5_BAG")), true);
  assert.strictEqual(mark.state().key, "T5_BAG");
  assert.strictEqual(doc.querySelectorAll(`.${PENDING_CELL_CLASS}`).length, 1);
});

// ── clearing ───────────────────────────────────────────────────────────────

test("clearing removes both classes and forgets the row", () => {
  const { doc, rowByKey } = makeDoc("crafting-table", [{ key: "T4_BAG" }]);
  const mark = createPendingEditMark({ doc });
  mark.mark(rowByKey.get("T4_BAG").children[1]);
  mark.clear();
  assert.strictEqual(mark.state(), null);
  assert.strictEqual(doc.querySelectorAll(`.${PENDING_CELL_CLASS}`).length, 0);
  assert.strictEqual(doc.querySelectorAll(`.${PENDING_ROW_CLASS}`).length, 0);
  assert.strictEqual(mark.reapply(), false, "and does not come back");
});

test("clearing twice, and clearing nothing, are both safe", () => {
  const { doc } = makeDoc("crafting-table", [{ key: "T4_BAG" }]);
  const mark = createPendingEditMark({ doc });
  mark.clear();
  mark.clear();
  assert.strictEqual(mark.state(), null);
});

// ── cells that cannot be identified still get feedback ─────────────────────

test("a row with no data-row-key is still marked, just not re-applicable", () => {
  const { doc, table } = makeDoc("reference-table", [{ key: null }]);
  const mark = createPendingEditMark({ doc });
  const tr = table.children[0];
  mark.mark(tr.children[0]);
  assert.strictEqual(marked(tr.children[0]), true, "feedback now beats none");
  assert.strictEqual(rowMarked(tr), true);
  assert.strictEqual(mark.state(), null, "nothing to find again");
  assert.strictEqual(mark.reapply(), false);
});

test("marking a null cell is a no-op, not a crash", () => {
  const { doc } = makeDoc("crafting-table", [{ key: "T4_BAG" }]);
  const mark = createPendingEditMark({ doc });
  mark.mark(null);
  mark.mark(undefined);
  assert.strictEqual(mark.state(), null);
});

test("a row key with a quote cannot break the selector", () => {
  const { doc, rowByKey } = makeDoc("crafting-table", [{ key: 'T4_BAG"odd' }]);
  const mark = createPendingEditMark({ doc });
  mark.mark(rowByKey.get('T4_BAG"odd').children[1]);
  // Escaped, so the selector is either matched or safely unmatched — never a
  // thrown SyntaxError that would take the whole phase callback down.
  assert.doesNotThrow(() => mark.reapply());
});

// ── the parts that live outside JavaScript ─────────────────────────────────


test("both classes are styled, and the cell spins", () => {
  const css = readStyles();
  assert.ok(css.includes(`.${PENDING_CELL_CLASS}::after`), "the cell has a spinner");
  assert.ok(css.includes(`.${PENDING_ROW_CLASS}`), "the row is accented");
  assert.ok(/app-loader-spin/.test(css.slice(css.indexOf(`.${PENDING_CELL_CLASS}::after`))),
    "reusing the existing keyframe");
});

test("reduced motion stops the cell spinner too", () => {
  const css = readStyles();
  const rm = css.lastIndexOf("prefers-reduced-motion");
  assert.ok(css.slice(rm, rm + 400).includes(`.${PENDING_CELL_CLASS}::after`));
});

test("the row accent is not opacity — the old number stays readable", () => {
  const css = readStyles();
  const block = css.slice(css.indexOf(`.${PENDING_ROW_CLASS} > td`));
  assert.ok(!/^[^}]*opacity/.test(block), "no opacity on the row");
});

test("the page loads the module", () => {
  assert.ok(readIndexHtml().includes('src="js/pending-edit-mark.js"'));
});

test("the edit commit marks, every phase re-marks, and the pass end clears", () => {
  const app = appSource();
  assert.ok(app.includes("markPendingEdit(td)"), "restoreCell marks the cell");
  assert.ok(app.includes("reapplyPendingEditMark()"), "the onPhase hook re-marks");
  assert.ok(app.includes("clearPendingEditMark()"), "the pass end clears");
});

test("the mark and the broad recalc marks are cleared a frame LATE, after the paint", () => {
  // Clearing them the instant the last tbody is written takes the feedback away
  // during the layout+paint of ~80 000 nodes — i.e. exactly the stall it exists
  // to report, which is what "it flashes for half a second" was.
  const app = appSource();
  const end = app.indexOf("onPassEnd:");
  // Generous window: the handler also drains the deferred-table ledger, and the
  // ordering asserted below has to stay readable as that block grows.
  const body = app.slice(end, end + 2600);
  assert.ok(/yieldToBrowser\(\)\.then\(/.test(body), "hidden after a real frame");
  assert.ok(body.indexOf("yieldToBrowser") < body.indexOf("clearRecalcCellMark"),
    "the frame comes first");
  assert.ok(body.includes("isRerenderBusy()"), "a pass that started meanwhile keeps them");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
