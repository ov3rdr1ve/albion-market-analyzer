/**
 * Test: render gating — a table nobody can see is not computed.
 *
 * renderAllTables used to run all 20 table renderers on every captured price
 * patch. Measured with a real price map and only Artifact Rolling expanded,
 * that was 1306 ms per pass of which 1063 ms went into tables the user had
 * collapsed. Every captured order scheduled one, so the renderer sat at ~1 core
 * for as long as the monitor kept feeding it.
 *
 * This covers the decision layer only — "is this table visible" and "what was
 * skipped, so it can be caught up on expand". Black box: a fake document is
 * injected, no browser and no real renderers.
 *
 * Run: node tests/render-gating-hidden-tables.test.cjs
 */

const assert = require("assert");
const path = require("path");

const gating = require(path.join(__dirname, "..", "js", "render-gating.js"));
const {
  isTableHidden,
  markTableDeferred,
  clearTableDeferred,
  isTableDeferred,
  deferredTableIds,
  renderDeferredTable,
  TABLE_RENDERERS,
  JOINED_SUMMARY_SOURCES,
} = gating;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

/* ---------------------------------------------------------------- fake DOM */

function element({ id = "", cls = [], display = "", parent = null } = {}) {
  const el = {
    id,
    style: { display },
    parentElement: parent,
    classList: {
      contains: (c) => cls.includes(c),
    },
  };
  el.closest = (selector) => {
    const want = selector.replace(".", "");
    let node = el;
    while (node) {
      if (node.classList && node.classList.contains(want)) return node;
      node = node.parentElement;
    }
    return null;
  };
  return el;
}

/**
 * The page's real shape: <section.tgroup> > .tgroup-body > .table-wrap > table.
 * Per-table collapse hides the WRAP, group collapse adds .collapsed to the
 * section — the table element's own display stays untouched in both cases.
 */
function page({ tableDisplay = "", wrapDisplay = "", groupCollapsed = false, withTable = true } = {}) {
  const group = element({ cls: groupCollapsed ? ["tgroup", "collapsed"] : ["tgroup"] });
  const body = element({ cls: ["tgroup-body"], parent: group });
  const wrap = element({ cls: ["table-wrap"], display: wrapDisplay, parent: body });
  const table = element({ id: "rolling-table", cls: ["data-table"], display: tableDisplay, parent: wrap });
  return {
    getElementById: (id) => (withTable && id === "rolling-table" ? table : null),
  };
}

console.log("\n=== isTableHidden ===");

const visibilityCases = [
  { name: "fully visible table is not hidden", dom: {}, hidden: false },
  { name: "table with display:none is hidden", dom: { tableDisplay: "none" }, hidden: true },
  { name: "collapsed wrap hides the table", dom: { wrapDisplay: "none" }, hidden: true },
  { name: "collapsed group hides the table", dom: { groupCollapsed: true }, hidden: true },
  { name: "collapsed wrap inside collapsed group is hidden", dom: { wrapDisplay: "none", groupCollapsed: true }, hidden: true },
  { name: "a table that is not on the page counts as hidden", dom: { withTable: false }, hidden: true },
];

for (const c of visibilityCases) {
  test(c.name, () => {
    assert.strictEqual(isTableHidden("rolling-table", page(c.dom)), c.hidden);
  });
}

test("a missing document does not throw", () => {
  assert.strictEqual(isTableHidden("rolling-table", null), true);
});

console.log("\n=== deferred set ===");

test("a table is not deferred until it is marked", () => {
  clearTableDeferred("crafting-table");
  assert.strictEqual(isTableDeferred("crafting-table"), false);
});

test("marking then clearing round-trips", () => {
  markTableDeferred("crafting-table");
  assert.strictEqual(isTableDeferred("crafting-table"), true);
  clearTableDeferred("crafting-table");
  assert.strictEqual(isTableDeferred("crafting-table"), false);
});

test("marking twice keeps one entry", () => {
  markTableDeferred("volume-table");
  markTableDeferred("volume-table");
  assert.deepStrictEqual(deferredTableIds().filter((id) => id === "volume-table"), ["volume-table"]);
  clearTableDeferred("volume-table");
});

test("clearing a table that was never marked is a no-op", () => {
  assert.doesNotThrow(() => clearTableDeferred("never-seen-table"));
});

console.log("\n=== renderer registry ===");

test("every gated table names a renderer", () => {
  for (const [tableId, fnName] of Object.entries(TABLE_RENDERERS)) {
    assert.ok(/^[a-z]/.test(tableId) && tableId.endsWith("-table"), `bad table id ${tableId}`);
    assert.ok(/^render[A-Z]/.test(fnName), `bad renderer name ${fnName} for ${tableId}`);
  }
});

test("the Top-10 boards' sources are all gated tables themselves", () => {
  for (const id of JOINED_SUMMARY_SOURCES) {
    assert.ok(TABLE_RENDERERS[id], `${id} feeds the Top-10 boards but has no renderer entry`);
  }
});

test("neither board is its own source", () => {
  assert.ok(!JOINED_SUMMARY_SOURCES.has("joined-summary-table"));
  assert.ok(!JOINED_SUMMARY_SOURCES.has("joined-focus-table"));
});

// Both boards read the same caches, so both must be catchable up on expand.
test("the focus board has a renderer entry of its own", () => {
  assert.strictEqual(TABLE_RENDERERS["joined-focus-table"], "renderJoinedFocusTable");
});

console.log("\n=== renderDeferredTable ===");

test("a deferred table is rendered with the flat price map and un-deferred", () => {
  const calls = [];
  const scope = { renderCraftingTable: (d) => calls.push(["crafting", d]) };
  markTableDeferred("crafting-table");
  const ok = renderDeferredTable("crafting-table", { scope, data: { A: 1 } });
  assert.strictEqual(ok, true);
  assert.deepStrictEqual(calls, [["crafting", { A: 1 }]]);
  assert.strictEqual(isTableDeferred("crafting-table"), false);
});

test("the rerolling table gets the QUALITY map, not the flat one", () => {
  const calls = [];
  const scope = { renderRerollingTable: (d) => calls.push(d) };
  markTableDeferred("rerolling-table");
  renderDeferredTable("rerolling-table", { scope, data: { flat: true }, qualityData: { quality: true } });
  assert.deepStrictEqual(calls, [{ quality: true }]);
});

test("the joined summary renderer takes no argument", () => {
  const seen = [];
  const scope = { renderJoinedSummaryTable: (...args) => seen.push(args) };
  markTableDeferred("joined-summary-table");
  renderDeferredTable("joined-summary-table", { scope, data: { A: 1 } });
  assert.deepStrictEqual(seen, [[]]);
});

test("the focus board renderer takes no argument either", () => {
  const seen = [];
  const scope = { renderJoinedFocusTable: (...args) => seen.push(args) };
  markTableDeferred("joined-focus-table");
  renderDeferredTable("joined-focus-table", { scope, data: { A: 1 } });
  assert.deepStrictEqual(seen, [[]]);
});

// Reported: after a restart the Black Market board and both Top-10s opened
// EMPTY and stayed empty until a full scan, even though every price had been
// restored from disk. Boot draws what is on screen and defers the rest, so the
// twelve feeder tables the boards project over
// (tableState[feeder].data — js/render-joined-summary.js) were still empty
// caches. Expanding a board rendered it over nothing. So a board pays off its
// SOURCES' deferrals before its own.
test("expanding a board catches its deferred sources up first", () => {
  const order = [];
  const scope = {
    renderFlippingTable: () => order.push("flipping"),
    renderCraftingTable: () => order.push("crafting"),
    renderBlackMarketBoard: () => order.push("board"),
  };
  deferredTableIds().forEach(clearTableDeferred);
  ["flipping-table", "crafting-table", "bm-board-table"].forEach(markTableDeferred);

  assert.strictEqual(renderDeferredTable("bm-board-table", { scope, data: { A: 1 } }), true);
  assert.deepStrictEqual(order, ["flipping", "crafting", "board"]);
  assert.deepStrictEqual(deferredTableIds(), []);
});

test("a source that is not deferred is not recomputed for the board", () => {
  const calls = [];
  const scope = {
    renderFlippingTable: () => calls.push("flipping"),
    renderJoinedSummaryTable: () => calls.push("board"),
  };
  deferredTableIds().forEach(clearTableDeferred);
  markTableDeferred("joined-summary-table");

  renderDeferredTable("joined-summary-table", { scope, data: {} });
  assert.deepStrictEqual(calls, ["board"], "an up-to-date cache is replayed, not rebuilt");
});

test("a source whose renderer is missing does not stop the board drawing", () => {
  const calls = [];
  const scope = { renderJoinedFocusTable: () => calls.push("board") };
  deferredTableIds().forEach(clearTableDeferred);
  ["flipping-table", "joined-focus-table"].forEach(markTableDeferred);

  assert.strictEqual(renderDeferredTable("joined-focus-table", { scope, data: {} }), true);
  assert.deepStrictEqual(calls, ["board"]);
  assert.strictEqual(isTableDeferred("flipping-table"), true, "the source stays owed");
});

// Rerolling contributes rows only once a quality-aware scan has run; without
// that map its renderer paints blanks, so it stays deferred either way.
test("a board does not force the quality-only source without a quality map", () => {
  const calls = [];
  const scope = {
    renderRerollingTable: () => calls.push("rerolling"),
    renderBlackMarketBoard: () => calls.push("board"),
  };
  deferredTableIds().forEach(clearTableDeferred);
  ["rerolling-table", "bm-board-table"].forEach(markTableDeferred);

  renderDeferredTable("bm-board-table", { scope, data: {} });
  assert.deepStrictEqual(calls, ["board"]);
  assert.strictEqual(isTableDeferred("rerolling-table"), true);

  deferredTableIds().forEach(clearTableDeferred);
  ["rerolling-table", "bm-board-table"].forEach(markTableDeferred);
  calls.length = 0;
  renderDeferredTable("bm-board-table", { scope, data: {}, qualityData: { Q: 1 } });
  assert.deepStrictEqual(calls, ["rerolling", "board"]);
});

// A feeder is a CACHE for the board, not something on screen: it is computed
// whether or not the user can see it — which is why the catch-up asks the
// deferred set and never the document. That is the whole reason boot skipped it.
test("a source is computed for the board without consulting the page", () => {
  const calls = [];
  const scope = {
    renderTransportTable: () => calls.push("transport"),
    renderBlackMarketBoard: () => calls.push("board"),
  };
  deferredTableIds().forEach(clearTableDeferred);
  ["transport-table", "bm-board-table"].forEach(markTableDeferred);

  // No `doc` passed at all: a hidden feeder is still the board's data.
  renderDeferredTable("bm-board-table", { scope, data: {} });
  assert.deepStrictEqual(calls, ["transport", "board"]);
});

test("an unknown table id renders nothing and reports false", () => {
  assert.strictEqual(renderDeferredTable("no-such-table", { scope: {}, data: {} }), false);
});

test("a registered table whose renderer is missing reports false", () => {
  markTableDeferred("farming-table");
  assert.strictEqual(renderDeferredTable("farming-table", { scope: {}, data: {} }), false);
});

test("a table that was never deferred is not rendered again", () => {
  let calls = 0;
  const scope = { renderVolumeTable: () => { calls++; } };
  clearTableDeferred("volume-table");
  assert.strictEqual(renderDeferredTable("volume-table", { scope, data: {} }), false);
  assert.strictEqual(calls, 0);
});

test("a renderer that throws is contained and the table stays deferred", () => {
  const scope = { renderTransportTable: () => { throw new Error("boom"); } };
  markTableDeferred("transport-table");
  assert.strictEqual(renderDeferredTable("transport-table", { scope, data: {} }), false);
  assert.strictEqual(isTableDeferred("transport-table"), true, "a failed catch-up must be retried on the next expand");
  clearTableDeferred("transport-table");
});

test("rerolling without a quality map is skipped, not rendered with the flat one", () => {
  const calls = [];
  const scope = { renderRerollingTable: (d) => calls.push(d) };
  markTableDeferred("rerolling-table");
  assert.strictEqual(renderDeferredTable("rerolling-table", { scope, data: { flat: true } }), false);
  assert.deepStrictEqual(calls, []);
  clearTableDeferred("rerolling-table");
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
