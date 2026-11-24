/**
 * Tests for the per-table loading animation (js/table-loading-mark.js).
 *
 * The app used to start behind a splash window and a full-screen #app-loader
 * overlay held until the LAST table was filled — ~19 s of a screen nobody could
 * read or touch. Both are gone: the window opens on the real page and each table
 * boot is computing wears its own spinner row until its rows land.
 *
 * Contract:
 *   mark(id)   puts one spinner row in — but ONLY over an empty tbody or a
 *              placeholder (index.html's "Awaiting Scan..." row, or a mark this
 *              module already put there). A table showing real rows keeps them.
 *              The row is one colspan cell spanning every <th>, and its content
 *              is wrapped in .row-fluid so it cannot size the columns.
 *   done(id)   takes OUR row away, and only ours: a render that already replaced
 *              the tbody must not be blanked.
 *   clear()    the same for every table still marked. Both are idempotent and
 *              safe on an id that is not there.
 *
 * Black-box: a hand-rolled fake document, no jsdom, no DOM library, no app boot.
 * Parameterized where the cases differ only in the tbody they start from.
 *
 * Run: node tests/table-loading-mark.test.cjs
 */

const assert = require("assert");
const {
  TABLE_LOADING_CLASS,
  AWAITING_SCAN_SLUG,
  createTableLoadingMark,
} = require("../js/table-loading-mark.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

// ── fake DOM ──────────────────────────────────────────────────────────────
//
// Just enough of an element for the module's node walk: children, tagName,
// attributes, and an innerHTML setter that records what was written and reduces
// the tbody to whatever rows that HTML declares.

function el(tagName, { attrs = {}, children = [], classes = [] } = {}) {
  const node = {
    tagName,
    attrs,
    children,
    classes: new Set(classes),
    written: null,
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
  };
  node.classList = {
    contains: (c) => node.classes.has(c),
    add: (c) => node.classes.add(c),
    remove: (c) => node.classes.delete(c),
  };
  Object.defineProperty(node, "innerHTML", {
    get: () => node.written || "",
    set: (html) => {
      node.written = html;
      // One row per <tr> in the written HTML, carrying its class attribute.
      node.children = (html.match(/<tr[^>]*>/g) || []).map((tag) => {
        const cls = /class="([^"]*)"/.exec(tag);
        return el("TR", { classes: cls ? cls[1].split(/\s+/) : [] });
      });
    },
  });
  return node;
}

const th = () => el("TH");
const awaitingScanRow = () =>
  el("TR", { children: [el("TD", { attrs: { "data-i18n": AWAITING_SCAN_SLUG } })] });
const dataRow = (id) =>
  el("TR", { attrs: { "data-item-id": id }, children: [el("TD"), el("TD")] });

/** A table with `cols` headers and the given body rows, in a fake document. */
function fakeDoc(tables) {
  const nodes = {};
  Object.entries(tables).forEach(([id, { cols = 3, rows = [] }]) => {
    const tbody = el("TBODY", { children: rows });
    const thead = el("THEAD", {
      children: [el("TR", { children: Array.from({ length: cols }, th) })],
    });
    const table = el("TABLE", { children: [thead, tbody] });
    table.tbody = tbody;
    nodes[id] = table;
  });
  return { nodes, getElementById: (id) => nodes[id] || null };
}

const rowsOf = (doc, id) => doc.nodes[id].tbody.children;
const isMarked = (doc, id) =>
  rowsOf(doc, id).length === 1 && rowsOf(doc, id)[0].classes.has(TABLE_LOADING_CLASS);

// ── what may be marked over ───────────────────────────────────────────────

[
  ["an empty tbody", [], true],
  ["the static Awaiting Scan placeholder", [awaitingScanRow()], true],
  ["a table showing one real row", [dataRow("T4_BAG")], false],
  ["a table showing many real rows", [dataRow("A"), dataRow("B"), dataRow("C")], false],
  ["two placeholder rows (not a shape we ship)", [awaitingScanRow(), awaitingScanRow()], false],
  ["a real row beside a placeholder", [awaitingScanRow(), dataRow("A")], false],
].forEach(([label, rows, expected]) => {
  test(`mark ${expected ? "replaces" : "refuses"} ${label}`, () => {
    const doc = fakeDoc({ "crafting-table": { rows } });
    const mark = createTableLoadingMark({ doc });
    assert.strictEqual(mark.mark("crafting-table"), expected);
    assert.strictEqual(isMarked(doc, "crafting-table"), expected);
    if (!expected) {
      assert.strictEqual(rowsOf(doc, "crafting-table").length, rows.length,
        "the rows that were there are still there");
    }
  });
});

test("marking twice is idempotent — the second goes over the first", () => {
  const doc = fakeDoc({ "crafting-table": { rows: [awaitingScanRow()] } });
  const mark = createTableLoadingMark({ doc });
  assert.strictEqual(mark.mark("crafting-table"), true);
  assert.strictEqual(mark.mark("crafting-table"), true);
  assert.strictEqual(rowsOf(doc, "crafting-table").length, 1);
  assert.deepStrictEqual(mark.state().marked, ["crafting-table"]);
});

test("an unknown table id is a no-op, not a throw", () => {
  const doc = fakeDoc({ "crafting-table": { rows: [] } });
  const mark = createTableLoadingMark({ doc });
  assert.strictEqual(mark.mark("no-such-table"), false);
  mark.done("no-such-table");
  mark.clear();
  assert.deepStrictEqual(mark.state().marked, []);
});

// ── the row itself ────────────────────────────────────────────────────────

[1, 3, 7, 14].forEach((cols) => {
  test(`the row spans all ${cols} columns`, () => {
    const doc = fakeDoc({ "crafting-table": { cols, rows: [] } });
    createTableLoadingMark({ doc }).mark("crafting-table");
    assert.ok(
      doc.nodes["crafting-table"].tbody.written.includes(`colspan="${cols}"`),
      `expected colspan="${cols}"`,
    );
  });
});

test("a table with no thead still gets a valid row", () => {
  const doc = { nodes: {}, getElementById: (id) => doc.nodes[id] || null };
  const tbody = el("TBODY");
  doc.nodes["odd-table"] = el("TABLE", { children: [tbody] });
  doc.nodes["odd-table"].tbody = tbody;
  assert.strictEqual(createTableLoadingMark({ doc }).mark("odd-table"), true);
  assert.ok(tbody.written.includes('colspan="1"'));
});

test("the content cannot size the columns", () => {
  // Every data table is `width: max-content`; anything with an intrinsic width
  // in a colspan cell sizes the REAL columns and they jump back when the rows
  // land.
  const doc = fakeDoc({ "crafting-table": { rows: [] } });
  createTableLoadingMark({ doc }).mark("crafting-table");
  const html = doc.nodes["crafting-table"].tbody.written;
  assert.ok(/<span class="[^"]*row-fluid/.test(html), "content is wrapped in .row-fluid");
  assert.ok(html.includes("row-computing"), "and carries the spinner class");
});

test("the ring is the whole message — no word is printed", () => {
  // The spinner alone is the report; a label was one more string to translate,
  // to re-measure, and to make the row taller than the animation needs.
  const doc = fakeDoc({ "crafting-table": { rows: [] } });
  createTableLoadingMark({ doc }).mark("crafting-table");
  const html = doc.nodes["crafting-table"].tbody.written;
  assert.ok(/<span[^>]*><\/span>/.test(html), `the span is empty: ${html}`);
  assert.ok(!/Computing…</.test(html), "nothing is printed between the tags");
});

test("a screen reader is still told what is happening", () => {
  const doc = fakeDoc({ "crafting-table": { rows: [] } });
  createTableLoadingMark({ doc }).mark("crafting-table");
  const html = doc.nodes["crafting-table"].tbody.written;
  assert.ok(/role="status"/.test(html), "the row is a live region");
  assert.ok(/aria-label="Computing…"/.test(html), "and names itself");
});

// ── taking it away ────────────────────────────────────────────────────────

test("done removes our row", () => {
  const doc = fakeDoc({ "crafting-table": { rows: [] } });
  const mark = createTableLoadingMark({ doc });
  mark.mark("crafting-table");
  mark.done("crafting-table");
  assert.strictEqual(rowsOf(doc, "crafting-table").length, 0);
  assert.deepStrictEqual(mark.state().marked, []);
});

test("done leaves a table the renderer already drew alone", () => {
  const doc = fakeDoc({ "crafting-table": { rows: [] } });
  const mark = createTableLoadingMark({ doc });
  mark.mark("crafting-table");
  // What a render does: replace the tbody with real rows.
  doc.nodes["crafting-table"].tbody.children = [dataRow("A"), dataRow("B")];
  mark.done("crafting-table");
  assert.strictEqual(rowsOf(doc, "crafting-table").length, 2, "the render survives");
});

test("done on an unmarked table does nothing", () => {
  const doc = fakeDoc({ "crafting-table": { rows: [dataRow("A")] } });
  const mark = createTableLoadingMark({ doc });
  mark.done("crafting-table");
  assert.strictEqual(rowsOf(doc, "crafting-table").length, 1);
});

test("done twice is harmless", () => {
  const doc = fakeDoc({ "crafting-table": { rows: [] } });
  const mark = createTableLoadingMark({ doc });
  mark.mark("crafting-table");
  mark.done("crafting-table");
  mark.done("crafting-table");
  assert.strictEqual(rowsOf(doc, "crafting-table").length, 0);
});

test("clear sweeps every table a cut-short pass never reached", () => {
  const doc = fakeDoc({
    "crafting-table": { rows: [] },
    "craft-planner-table": { rows: [awaitingScanRow()] },
    "flipping-table": { rows: [dataRow("A")] }, // refused, so never marked
  });
  const mark = createTableLoadingMark({ doc });
  ["crafting-table", "craft-planner-table", "flipping-table"].forEach(mark.mark);
  assert.deepStrictEqual(mark.state().marked, ["crafting-table", "craft-planner-table"]);
  mark.clear();
  assert.deepStrictEqual(mark.state().marked, []);
  assert.strictEqual(rowsOf(doc, "crafting-table").length, 0);
  assert.strictEqual(rowsOf(doc, "craft-planner-table").length, 0);
  assert.strictEqual(rowsOf(doc, "flipping-table").length, 1, "never ours to clear");
});

test("clear on a fresh mark is a no-op", () => {
  const doc = fakeDoc({ "crafting-table": { rows: [awaitingScanRow()] } });
  const mark = createTableLoadingMark({ doc });
  mark.clear();
  assert.strictEqual(rowsOf(doc, "crafting-table").length, 1);
});

// ── no document at all (Node, a torn-down page) ───────────────────────────

test("a missing document is survivable", () => {
  const mark = createTableLoadingMark({ doc: null });
  assert.strictEqual(mark.mark("crafting-table"), false);
  mark.done("crafting-table");
  mark.clear();
  assert.deepStrictEqual(mark.state().marked, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
