/**
 * Test: an OPEN table never keeps stale numbers.
 *
 * Reported: "tables don't show recomputed prices until I close and reopen the
 * table", after editing a price.
 *
 * `deferredTables` (js/render-gating.js) is the app's "this table is owed a
 * render" ledger, and it used to be drained in exactly one place: the
 * collapse -> expand transition (js/app.js setCollapsed, js/section-groups.js).
 * A table that is ALREADY OPEN and gets marked deferred therefore stays stale
 * for ever. That happens routinely, because a re-render pass is cut short
 * whenever the user opens the next price editor, and everything the pass never
 * reached is marked deferred (js/render-async.js).
 *
 * Three things are pinned here:
 *
 *   1. drainVisibleDeferredTables() catches up every table that is deferred AND
 *      on screen — and leaves the hidden ones alone, so the gating that makes
 *      collapsed tables free is untouched.
 *   2. A scheduler request made while a price editor is open is RE-ARMED, not
 *      dropped. It used to return silently, losing the redraw entirely.
 *   3. A chunked renderer that reports it never painted leaves its table
 *      deferred, instead of being marked clean while showing old rows.
 *
 * Black box: fake document, fake timers, no browser and no real renderers.
 *
 * Run: node tests/render-deferred-drain.test.cjs
 */

const assert = require("assert");
const path = require("path");

const gating = require(path.join(__dirname, "..", "js", "render-gating.js"));
const {
  markTableDeferred,
  clearTableDeferred,
  isTableDeferred,
  deferredTableIds,
  drainVisibleDeferredTables,
} = gating;

const { createRenderScheduler } = require(path.join(__dirname, "..", "js", "render-async.js"));
const { RERENDER_PHASES, runRenderSteps } = require(path.join(__dirname, "..", "js", "render-schedule.js"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}
// Async cases are queued and run in order at the end: they share the module-level
// `deferredTables` set, so overlapping them would make them fight over it.
const asyncQueue = [];
function atest(name, fn) {
  asyncQueue.push(async () => {
    try { await fn(); console.log(`  PASS: ${name}`); passed++; }
    catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
  });
}

/* ---------------------------------------------------------------- fake DOM */

/**
 * A page of tables, each either visible or hidden by its wrapping .table-wrap —
 * the real shape per-table collapse produces (js/app.js setCollapsed).
 */
function page(visibility) {
  const tables = {};
  Object.entries(visibility).forEach(([id, visible]) => {
    const wrap = {
      classList: { contains: (c) => c === "table-wrap" },
      style: { display: visible ? "" : "none" },
      parentElement: null,
    };
    tables[id] = {
      id,
      style: { display: "" },
      parentElement: wrap,
      classList: { contains: () => false },
      closest: () => null,
    };
  });
  return { getElementById: (id) => tables[id] || null };
}

function resetDeferred() {
  deferredTableIds().forEach(clearTableDeferred);
}

console.log("\n=== drainVisibleDeferredTables ===");

test("a deferred table that is on screen is caught up and un-deferred", () => {
  resetDeferred();
  const drawn = [];
  const scope = { renderCraftingTable: (d) => drawn.push(["crafting-table", d]) };
  markTableDeferred("crafting-table");
  const n = drainVisibleDeferredTables({
    scope,
    doc: page({ "crafting-table": true }),
    data: { A: 1 },
  });
  assert.strictEqual(n, 1);
  assert.deepStrictEqual(drawn, [["crafting-table", { A: 1 }]]);
  assert.strictEqual(isTableDeferred("crafting-table"), false);
});

test("a deferred table that is collapsed is left alone (gating survives)", () => {
  resetDeferred();
  let calls = 0;
  const scope = { renderCraftingTable: () => { calls++; } };
  markTableDeferred("crafting-table");
  const n = drainVisibleDeferredTables({
    scope,
    doc: page({ "crafting-table": false }),
    data: {},
  });
  assert.strictEqual(n, 0);
  assert.strictEqual(calls, 0);
  assert.strictEqual(isTableDeferred("crafting-table"), true, "still owed a render when it is expanded");
  resetDeferred();
});

test("only the visible half of a mixed ledger is drawn", () => {
  resetDeferred();
  const drawn = [];
  const scope = {
    renderCraftingTable: () => drawn.push("crafting-table"),
    renderTransportTable: () => drawn.push("transport-table"),
    renderVolumeTable: () => drawn.push("volume-table"),
  };
  ["crafting-table", "transport-table", "volume-table"].forEach(markTableDeferred);
  const n = drainVisibleDeferredTables({
    scope,
    doc: page({ "crafting-table": true, "transport-table": false, "volume-table": true }),
    data: {},
  });
  assert.strictEqual(n, 2);
  assert.deepStrictEqual(drawn.sort(), ["crafting-table", "volume-table"]);
  assert.strictEqual(isTableDeferred("transport-table"), true);
  resetDeferred();
});

test("nothing deferred means nothing drawn", () => {
  resetDeferred();
  let calls = 0;
  const scope = { renderCraftingTable: () => { calls++; } };
  assert.strictEqual(drainVisibleDeferredTables({ scope, doc: page({ "crafting-table": true }), data: {} }), 0);
  assert.strictEqual(calls, 0);
});

test("a renderer that throws leaves its table deferred and does not stop the others", () => {
  resetDeferred();
  const drawn = [];
  const scope = {
    renderCraftingTable: () => { throw new Error("boom"); },
    renderVolumeTable: () => drawn.push("volume-table"),
  };
  ["crafting-table", "volume-table"].forEach(markTableDeferred);
  // renderDeferredTable logs the failure itself; the throw here is deliberate,
  // so keep its stack out of the test output.
  const realError = console.error;
  console.error = () => {};
  let n;
  try {
    n = drainVisibleDeferredTables({
      scope,
      doc: page({ "crafting-table": true, "volume-table": true }),
      data: {},
    });
  } finally {
    console.error = realError;
  }
  assert.strictEqual(n, 1);
  assert.deepStrictEqual(drawn, ["volume-table"]);
  assert.strictEqual(isTableDeferred("crafting-table"), true, "a failed catch-up must be retried");
  resetDeferred();
});

test("a missing document is survivable", () => {
  resetDeferred();
  markTableDeferred("crafting-table");
  assert.strictEqual(drainVisibleDeferredTables({ scope: {}, doc: null, data: {} }), 0);
  resetDeferred();
});

/** Print a section header in the async queue's own order, not at load time. */
function asection(title) {
  asyncQueue.push(async () => console.log(`\n=== ${title} ===`));
}

asection("a request made under an open editor is re-armed, not dropped");

/** A scheduler wired to controllable timers and a controllable editor flag. */
function harness({ editorOpen = () => false } = {}) {
  const timers = [];
  let token = 0;
  const drawn = [];
  const scheduler = createRenderScheduler({
    planPass: () => ({
      steps: [{ id: "crafting-table", phase: "visible" }],
      plannedIds: ["crafting-table"],
      render: (id) => drawn.push(id),
    }),
    runSteps: runRenderSteps,
    yieldTo: async () => {},
    beginPass: () => ++token,
    isCurrentPass: (t) => t === token,
    isEditorOpen: editorOpen,
    phases: RERENDER_PHASES,
    setTimer: (fn) => { timers.push(fn); return timers.length; },
    clearTimer: (handle) => { if (handle) timers[handle - 1] = null; },
  });
  /** Fire every armed timer once, in order. */
  const tick = () => {
    const armed = timers.slice();
    timers.length = 0;
    armed.forEach((fn) => { if (fn) fn(); });
    return armed.filter(Boolean).length;
  };
  return { scheduler, tick, drawn, timers };
}

atest("with no editor open the pass runs on the first tick", async () => {
  const h = harness();
  h.scheduler.schedule("price-edit");
  h.tick();
  await h.scheduler.whenIdle();
  assert.deepStrictEqual(h.drawn, ["crafting-table"]);
});

atest("with an editor open the request survives and runs once it closes", async () => {
  let open = true;
  const h = harness({ editorOpen: () => open });
  h.scheduler.schedule("price-edit");

  h.tick();                       // fires while the editor is still open
  await h.scheduler.whenIdle();
  assert.deepStrictEqual(h.drawn, [], "nothing may be drawn under an open editor");
  assert.ok(h.timers.length > 0, "the request must be re-armed, not dropped");

  open = false;
  h.tick();                       // the editor has closed
  await h.scheduler.whenIdle();
  assert.deepStrictEqual(h.drawn, ["crafting-table"], "the redraw must arrive after the editor closes");
});

atest("a re-armed request still reports the scheduler as busy", async () => {
  const h = harness({ editorOpen: () => true });
  h.scheduler.schedule("price-edit");
  h.tick();
  await h.scheduler.whenIdle();
  assert.strictEqual(h.scheduler.isBusy(), true, "a held request is outstanding work, not idle");
});

atest("cancel() drops a request that is being held for an editor", async () => {
  let open = true;
  const h = harness({ editorOpen: () => open });
  h.scheduler.schedule("price-edit");
  h.tick();
  h.scheduler.cancel();
  open = false;
  h.tick();
  await h.scheduler.whenIdle();
  assert.deepStrictEqual(h.drawn, []);
});

asection("a chunked renderer that never painted stays deferred");

/**
 * Mirrors js/app.js drawOneTableChunked: it must believe the renderer's own
 * report (false = cancelled before painting) rather than assume a paint.
 */
async function drawChunked(tableId, chunked, { cancelled = () => false } = {}) {
  let painted;
  try {
    painted = (await chunked({ yieldTo: async () => {}, cancelled, paint: (w) => w() })) !== false;
  } catch (e) {
    painted = false;
  }
  if (painted) clearTableDeferred(tableId);
  else markTableDeferred(tableId);
  return painted;
}

atest("a chunked renderer returning false leaves the table deferred", async () => {
  resetDeferred();
  markTableDeferred("craft-planner-table");
  const ok = await drawChunked("craft-planner-table", async () => false);
  assert.strictEqual(ok, false);
  assert.strictEqual(isTableDeferred("craft-planner-table"), true);
  resetDeferred();
});

atest("a chunked renderer that paints clears the deferral", async () => {
  resetDeferred();
  markTableDeferred("craft-planner-table");
  const ok = await drawChunked("craft-planner-table", async () => true);
  assert.strictEqual(ok, true);
  assert.strictEqual(isTableDeferred("craft-planner-table"), false);
});

atest("a chunked renderer that throws leaves the table deferred", async () => {
  resetDeferred();
  const ok = await drawChunked("craft-planner-table", async () => { throw new Error("boom"); });
  assert.strictEqual(ok, false);
  assert.strictEqual(isTableDeferred("craft-planner-table"), true);
  resetDeferred();
});

atest("the cancelled probe reaches the chunked renderer", async () => {
  resetDeferred();
  let sawCancelled = null;
  await drawChunked(
    "crafting-table",
    async ({ cancelled }) => { sawCancelled = cancelled(); return !sawCancelled; },
    { cancelled: () => true },
  );
  assert.strictEqual(sawCancelled, true, "drawOneTableChunked must pass `cancelled` through");
  assert.strictEqual(isTableDeferred("crafting-table"), true);
  resetDeferred();
});

/* ------------------------------------------------------------------- run */

(async () => {
  for (const run of asyncQueue) await run();
  console.log(`\n--- ${passed} passed, ${failed} failed ---`);
  process.exit(failed > 0 ? 1 : 0);
})();
