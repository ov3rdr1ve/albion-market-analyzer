/**
 * Coverage test for the recalculation mark: an empty `plannedIds` ([] is truthy)
 * must not hide the planned tables from the mark. The scheduler falls back to
 * the step ids, so onPassStart always names the tables the pass will redraw.
 *
 * (The cap, item-scope and data-recalc-cell scenarios are gone with the
 * per-cell rings; see tests/recalc-overlay.test.cjs.)
 *
 * Black-box: stubbed scheduler dependencies. No DOM/network.
 *
 * Run: node tests/recalc-cell-mark-coverage.test.cjs
 */

const assert = require("assert");
const { createRenderScheduler } = require("../js/render-async.js");
const { runRenderSteps } = require("../js/render-schedule.js");

let passed = 0, failed = 0;
const pendingTests = [];
function test(name, fn) {
  const done = (e) => {
    if (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
    else { console.log(`  PASS: ${name}`); passed++; }
  };
  try {
    const r = fn();
    if (r && typeof r.then === "function") { pendingTests.push(r.then(() => done(), done)); return; }
    done();
  } catch (e) { done(e); }
}

function runScheduler(planned) {
  const starts = [];
  const timers = [];
  let seq = 0;
  const scheduler = createRenderScheduler({
    planPass: () => ({
      steps: [{ id: "rerolling-table", phase: "visible" }, { id: "joined-table", phase: "visible" }],
      plannedIds: planned,
      render: () => {},
    }),
    runSteps: runRenderSteps,
    yieldTo: async () => {},
    beginPass: () => ++seq,
    isCurrentPass: (t) => t === seq,
    isEditorOpen: () => false,
    markDeferred: () => {},
    onPassStart: (info) => starts.push(info),
    onPassEnd: () => {},
    setTimer: (fn) => { timers.push(fn); return timers.length; },
    clearTimer: () => {},
  });
  scheduler.schedule("quality-only");
  timers.splice(0).forEach((fn) => fn());
  return scheduler.whenIdle().then(() => starts);
}

[
  ["empty plannedIds ([])", [], ["rerolling-table", "joined-table"]],
  ["plannedIds absent", undefined, ["rerolling-table", "joined-table"]],
  ["non-empty plannedIds wins", ["only-table"], ["only-table"]],
].forEach(([label, planned, expected]) => {
  test(`onPassStart tableIds with ${label}`, async () => {
    const starts = await runScheduler(planned);
    assert.strictEqual(starts.length, 1, "pass started once");
    assert.deepStrictEqual(starts[0].tableIds, expected);
  });
});

Promise.all(pendingTests).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
