/**
 * Tests for the asynchronous re-render scheduler (js/render-async.js).
 *
 * Editing a price used to call renderAllTables() synchronously: one unbroken
 * block that measured 1306 ms with a single section open and 19.3 s cold, with
 * the window frozen for all of it. The scheduler runs the same work through
 * js/render-schedule.js instead — phased, yielding, cancellable — so the app
 * stays usable and a spinner can actually spin.
 *
 * What it owes the caller:
 *   - a burst of edits is ONE pass, not five;
 *   - a new request supersedes the one in flight instead of racing it;
 *   - a pass stops as soon as the user opens another editor, and everything it
 *     did not draw is left marked as owed;
 *   - it never throws out of a listener, and never leaves a cell spinning;
 *   - it tells the caller WHAT the pass will replace: the tables it planned and
 *     the items whose prices moved, which is what the pending marks need.
 *
 * Black-box: fake timers, fake runSteps, injected everything. No DOM.
 *
 * Run: node tests/render-async-scheduler.test.cjs
 */

const assert = require("assert");
const { createRenderScheduler } = require("../js/render-async.js");
const { runRenderSteps, RERENDER_PHASES } = require("../js/render-schedule.js");

let passed = 0, failed = 0;
function test(name, fn) {
  const done = (e) => {
    if (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
    else { console.log(`  PASS: ${name}`); passed++; }
  };
  try {
    const r = fn();
    if (r && typeof r.then === "function") return r.then(() => done(), done);
    done();
  } catch (e) { done(e); }
  return Promise.resolve();
}

// ── fakes ──────────────────────────────────────────────────────────────────

/** setTimeout/clearTimeout the test drives by hand. */
function fakeTimers() {
  let next = 1;
  const pending = new Map();
  return {
    setTimer: (fn, ms) => { pending.set(next, { fn, ms }); return next++; },
    clearTimer: (id) => { pending.delete(id); },
    /** Fire every timer that is due, in the order they were set. */
    flush() {
      const due = [...pending.entries()];
      pending.clear();
      due.forEach(([, t]) => t.fn());
      return due.length;
    },
    get size() { return pending.size; },
  };
}

/** A monotonic pass token, exactly as js/app.js keeps one. */
function passTokens() {
  let seq = 0;
  return {
    beginPass: () => ++seq,
    isCurrentPass: (token) => token === seq,
  };
}

/** Wire a scheduler over recorded plans. Returns the scheduler + the log. */
function makeScheduler(overrides = {}) {
  const timers = fakeTimers();
  const tokens = passTokens();
  const log = [];
  const deferred = [];
  const passes = [];

  const scheduler = createRenderScheduler({
    planPass: ({ priorityTableId }) => {
      passes.push(priorityTableId ?? null);
      return {
        steps: [
          { id: "a", phase: "edited" },
          { id: "b", phase: "visible" },
          { id: "c", phase: "visible" },
        ],
        plannedIds: ["a", "b", "c"],
        render: (id) => log.push(`render:${id}`),
      };
    },
    runSteps: runRenderSteps,
    yieldTo: async () => { log.push("yield"); },
    beginPass: tokens.beginPass,
    isCurrentPass: tokens.isCurrentPass,
    isEditorOpen: () => false,
    markDeferred: (id) => deferred.push(id),
    onPassStart: (info) => log.push(`start:${info.reason}:${info.total}`),
    onPassEnd: (info) => log.push(`end:${info.reason}${info.superseded ? ":superseded" : ""}`),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    ...overrides,
  });

  return { scheduler, timers, tokens, log, deferred, passes };
}

(async () => {

// ── coalescing ─────────────────────────────────────────────────────────────

await test("a burst of edits inside the debounce window runs one pass", async () => {
  const s = makeScheduler();
  s.scheduler.schedule("price-edit");
  s.scheduler.schedule("price-edit");
  s.scheduler.schedule("price-edit");
  assert.strictEqual(s.timers.size, 1, "one pending timer, not three");
  s.timers.flush();
  await s.scheduler.whenIdle();
  assert.deepStrictEqual(s.passes, [null], "planned once");
  assert.deepStrictEqual(s.log.filter((l) => l.startsWith("render:")),
    ["render:a", "render:b", "render:c"]);
});

await test("the newest request's edited table is the one that gets hoisted", async () => {
  const s = makeScheduler();
  s.scheduler.schedule("price-edit", { priorityTableId: "crafting-table" });
  s.scheduler.schedule("price-edit", { priorityTableId: "flipping-table" });
  s.timers.flush();
  await s.scheduler.whenIdle();
  assert.deepStrictEqual(s.passes, ["flipping-table"]);
});

await test("scheduling returns true when a pass is coming, false with no prices at all", async () => {
  const s = makeScheduler();
  assert.strictEqual(s.scheduler.schedule("price-edit"), true);
  s.timers.flush();
  await s.scheduler.whenIdle();

  // Before the first scan there is no price map, so there is nothing to draw
  // and the caller must not dim the cell waiting for a redraw that never comes.
  const empty = makeScheduler({ canSchedule: () => false });
  assert.strictEqual(empty.scheduler.schedule("price-edit"), false);
  assert.strictEqual(empty.timers.size, 0, "no timer was even set");
  await empty.scheduler.whenIdle();
  assert.deepStrictEqual(empty.log, [], "nothing ran");
});

await test("a plan that comes back empty ends the pass quietly", async () => {
  const s = makeScheduler({ planPass: () => null });
  assert.strictEqual(s.scheduler.schedule("price-edit"), true);
  s.timers.flush();
  await s.scheduler.whenIdle();
  assert.deepStrictEqual(s.log.filter((l) => l.startsWith("render:")), []);
  assert.strictEqual(s.scheduler.isBusy(), false);
});

// ── superseding ────────────────────────────────────────────────────────────

await test("a request made mid-pass stops the running one at the next step", async () => {
  let s;
  const log = [];
  s = makeScheduler({
    planPass: () => ({
      steps: ["a", "b", "c"].map((id) => ({ id, phase: "visible" })),
      plannedIds: ["a", "b", "c"],
      render: (id) => {
        log.push(id);
        // Mid-pass the user commits another edit.
        if (id === "a" && log.filter((x) => x === "a").length === 1) {
          s.scheduler.schedule("price-edit");
        }
      },
    }),
  });
  s.scheduler.schedule("price-edit");
  s.timers.flush();      // first pass starts
  await s.scheduler.whenIdle();
  s.timers.flush();      // the debounced second request
  await s.scheduler.whenIdle();
  // First pass drew only "a" before being superseded; the second drew all three.
  assert.deepStrictEqual(log, ["a", "a", "b", "c"]);
});

await test("a superseded pass says so, and does not report itself finished", async () => {
  let s;
  let interrupted = false;
  s = makeScheduler({
    planPass: () => ({
      steps: ["a", "b"].map((id) => ({ id, phase: "visible" })),
      plannedIds: ["a", "b"],
      render: (id) => {
        if (id !== "a" || interrupted) return;
        interrupted = true;
        s.scheduler.schedule("toggle");
      },
    }),
  });
  s.scheduler.schedule("price-edit");
  s.timers.flush();
  await s.scheduler.whenIdle();
  assert.ok(s.log.includes("end:price-edit:superseded"), s.log.join(","));
  s.timers.flush();
  await s.scheduler.whenIdle();
  assert.ok(s.log.includes("end:toggle"), s.log.join(","));
});

await test("what a stopped pass never drew is marked as owed", async () => {
  let s;
  s = makeScheduler({
    planPass: () => ({
      steps: ["a", "b", "c"].map((id) => ({ id, phase: "visible" })),
      plannedIds: ["a", "b", "c"],
      render: (id) => { if (id === "a") s.scheduler.cancel(); },
    }),
  });
  s.scheduler.schedule("price-edit");
  s.timers.flush();
  await s.scheduler.whenIdle();
  assert.deepStrictEqual(s.deferred, ["b", "c"], "a was drawn, b and c were not");
});

await test("a pass that finishes owes nothing", async () => {
  const s = makeScheduler();
  s.scheduler.schedule("price-edit");
  s.timers.flush();
  await s.scheduler.whenIdle();
  assert.deepStrictEqual(s.deferred, []);
});

// ── the editor ─────────────────────────────────────────────────────────────

await test("a pass stops when the user opens another editor", async () => {
  let editing = false;
  const drawn = [];
  const s = makeScheduler({
    isEditorOpen: () => editing,
    planPass: () => ({
      steps: ["a", "b", "c"].map((id) => ({ id, phase: "visible" })),
      plannedIds: ["a", "b", "c"],
      render: (id) => { drawn.push(id); if (id === "a") editing = true; },
    }),
  });
  s.scheduler.schedule("price-edit");
  s.timers.flush();
  await s.scheduler.whenIdle();
  assert.deepStrictEqual(drawn, ["a"]);
  assert.deepStrictEqual(s.deferred, ["b", "c"]);
});

await test("a pass is not even started while an editor is open", async () => {
  const s = makeScheduler({ isEditorOpen: () => true });
  s.scheduler.schedule("price-edit");
  s.timers.flush();
  await s.scheduler.whenIdle();
  assert.deepStrictEqual(s.log.filter((l) => l.startsWith("render:")), []);
});

// A held request is not a pass. The indicator has to hear about it: the pass it
// replaced ends `superseded`, which deliberately leaves the pill up, so without
// this signal the pill claims work is happening for as long as the editor is
// open — and the editor is open for exactly as long as the user is looking at
// it.
await test("a request held behind an editor says so and never starts a pass", async () => {
  const held = [];
  const s = makeScheduler({ isEditorOpen: () => true, onHeld: (info) => held.push(info.reason) });
  s.scheduler.schedule("price-edit");
  s.timers.flush();
  await s.scheduler.whenIdle();
  assert.deepStrictEqual(held, ["price-edit"]);
  assert.deepStrictEqual(s.log.filter((l) => l.startsWith("start:")), []);
});

await test("the same request runs, and reports no hold, once the editor closes", async () => {
  let editing = true;
  const held = [];
  const s = makeScheduler({ isEditorOpen: () => editing, onHeld: (info) => held.push(info.reason) });
  s.scheduler.schedule("price-edit");
  s.timers.flush();
  await s.scheduler.whenIdle();
  assert.deepStrictEqual(held, ["price-edit"]);
  editing = false;
  s.timers.flush();
  await s.scheduler.whenIdle();
  assert.deepStrictEqual(held, ["price-edit"], "no second hold");
  assert.ok(s.log.some((l) => l.startsWith("start:price-edit")), "the held pass runs: " + s.log.join(","));
});

// ── progress reporting ─────────────────────────────────────────────────────

await test("progress counts every table in the pass", async () => {
  const seen = [];
  const s = makeScheduler({ onProgress: (p) => seen.push(`${p.done}/${p.total}:${p.phase}`) });
  s.scheduler.schedule("price-edit");
  s.timers.flush();
  await s.scheduler.whenIdle();
  assert.deepStrictEqual(seen, ["0/3:edited", "1/3:visible", "2/3:visible"]);
});

await test("the start is announced once, with the size of the pass", async () => {
  const s = makeScheduler();
  s.scheduler.schedule("price-edit");
  s.timers.flush();
  await s.scheduler.whenIdle();
  assert.deepStrictEqual(s.log.filter((l) => l.startsWith("start:")), ["start:price-edit:3"]);
});

await test("a throwing listener does not stop the pass", async () => {
  const s = makeScheduler({
    onPassStart: () => { throw new Error("boom"); },
    onProgress: () => { throw new Error("boom"); },
    onPassEnd: () => { throw new Error("boom"); },
  });
  s.scheduler.schedule("price-edit");
  s.timers.flush();
  await s.scheduler.whenIdle();
  assert.deepStrictEqual(s.log.filter((l) => l.startsWith("render:")),
    ["render:a", "render:b", "render:c"]);
});

await test("a phase is reported as it lands, so the anchor can be re-applied", async () => {
  const phases = [];
  const s = makeScheduler();
  s.scheduler.schedule("price-edit", { onPhase: (p) => phases.push(p) });
  s.timers.flush();
  await s.scheduler.whenIdle();
  assert.deepStrictEqual(phases.slice(0, 2), ["edited", "visible"]);
  assert.deepStrictEqual([...phases].sort(), [...RERENDER_PHASES].sort());
});

// ── idle ───────────────────────────────────────────────────────────────────

await test("busy while a pass is pending or running, idle after", async () => {
  const s = makeScheduler();
  assert.strictEqual(s.scheduler.isBusy(), false);
  s.scheduler.schedule("price-edit");
  assert.strictEqual(s.scheduler.isBusy(), true, "a debounced request counts as busy");
  s.timers.flush();
  await s.scheduler.whenIdle();
  assert.strictEqual(s.scheduler.isBusy(), false);
});

await test("whenIdle resolves immediately when there is nothing running", async () => {
  const s = makeScheduler();
  await s.scheduler.whenIdle();
  assert.ok(true);
});

// ── what the pass is about to replace ──────────────────────────

await test("the pass start names the tables it planned and the items that moved", async () => {
  const starts = [];
  const s = makeScheduler({ onPassStart: (info) => starts.push(info) });
  s.scheduler.schedule("price-edit", { itemIds: ["T4_BAG"] });
  s.timers.flush();
  await s.scheduler.whenIdle();
  assert.strictEqual(starts.length, 1);
  assert.deepStrictEqual(starts[0].tableIds, ["a", "b", "c"]);
  assert.deepStrictEqual(starts[0].itemIds, ["T4_BAG"]);
  assert.strictEqual(starts[0].total, 3, "the step count is still reported");
});

await test("a request that names no items means everything moved", async () => {
  const starts = [];
  const s = makeScheduler({ onPassStart: (info) => starts.push(info) });
  s.scheduler.schedule("premium");
  s.timers.flush();
  await s.scheduler.whenIdle();
  assert.strictEqual(starts[0].itemIds, null);
});

await test("two coalesced requests union their item scopes", async () => {
  const starts = [];
  const s = makeScheduler({ onPassStart: (info) => starts.push(info) });
  s.scheduler.schedule("captured-prices", { itemIds: ["T4_BAG"] });
  s.scheduler.schedule("captured-prices", { itemIds: ["T5_CAPE", "T4_BAG"] });
  s.timers.flush();
  await s.scheduler.whenIdle();
  assert.deepStrictEqual(starts[0].itemIds, ["T4_BAG", "T5_CAPE"], "each id once");
});

await test("an unscoped request widens a coalesced pass to everything", async () => {
  // A Premium toggle landing in the same debounce window as a capture really
  // does move every number; narrowing to the captured item would leave the rest
  // of the app changing with nothing to say it was going to.
  const starts = [];
  const s = makeScheduler({ onPassStart: (info) => starts.push(info) });
  s.scheduler.schedule("captured-prices", { itemIds: ["T4_BAG"] });
  s.scheduler.schedule("premium");
  s.timers.flush();
  await s.scheduler.whenIdle();
  assert.strictEqual(starts[0].itemIds, null);
});

await test("a scope does not leak from one pass into the next", async () => {
  const starts = [];
  const s = makeScheduler({ onPassStart: (info) => starts.push(info) });
  s.scheduler.schedule("captured-prices", { itemIds: ["T4_BAG"] });
  s.timers.flush();
  await s.scheduler.whenIdle();
  s.scheduler.schedule("premium");
  s.timers.flush();
  await s.scheduler.whenIdle();
  assert.deepStrictEqual(starts.map((i) => i.itemIds), [["T4_BAG"], null]);
});

await test("each table is reported drawn AFTER its renderer returns", async () => {
  const order = [];
  const s = makeScheduler({
    planPass: () => ({
      steps: [{ id: "a", phase: "edited" }, { id: "b", phase: "visible" }],
      plannedIds: ["a", "b"],
      render: (id) => { order.push(`render:${id}`); },
    }),
    onTableDrawn: (id) => order.push(`drawn:${id}`),
  });
  s.scheduler.schedule("price-edit");
  s.timers.flush();
  await s.scheduler.whenIdle();
  assert.deepStrictEqual(order, ["render:a", "drawn:a", "render:b", "drawn:b"]);
});

await test("a chunked renderer is reported drawn only once its promise settles", async () => {
  const order = [];
  let release;
  const s = makeScheduler({
    planPass: () => ({
      steps: [{ id: "a", phase: "edited" }],
      plannedIds: ["a"],
      render: () => new Promise((resolve) => {
        release = () => { order.push("finished"); resolve(); };
      }),
    }),
    onTableDrawn: (id) => order.push(`drawn:${id}`),
  });
  s.scheduler.schedule("price-edit");
  s.timers.flush();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepStrictEqual(order, [], "nothing drawn while the renderer is still working");
  release();
  await s.scheduler.whenIdle();
  assert.deepStrictEqual(order, ["finished", "drawn:a"]);
});

await test("the step report names the table it is about to draw", async () => {
  const steps = [];
  const s = makeScheduler({ onProgress: (info) => steps.push(`${info.done}/${info.total}:${info.id}`) });
  s.scheduler.schedule("price-edit");
  s.timers.flush();
  await s.scheduler.whenIdle();
  assert.deepStrictEqual(steps, ["0/3:a", "1/3:b", "2/3:c"]);
});

await test("cancel drops a request that has not started yet", async () => {
  const s = makeScheduler();
  s.scheduler.schedule("price-edit");
  s.scheduler.cancel();
  assert.strictEqual(s.timers.size, 0);
  await s.scheduler.whenIdle();
  assert.deepStrictEqual(s.log, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
})();
