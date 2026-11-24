/**
 * Test: captured prices never starve a long table of its redraw.
 *
 * Reported: a price the sniffer captured did not show in the Crafting Planner
 * until the table was updated by hand. The capture path asks the scheduler
 * (js/render-async.js) for a pass, and every request used to supersede the pass
 * in flight at once. The planner is a multi-second chunked renderer, so a
 * market browse — one patch after another — kept cancelling it before it could
 * paint, and a superseded pass never drains what it left owed.
 *
 * Rules pinned here, black box over createRenderScheduler:
 *   1. A "captured-prices" request arriving while a pass is drawing does NOT
 *      cancel it; it waits and runs as the next pass.
 *   2. Gestures (a price edit, a toggle) still supersede immediately.
 *   3. Captures that queue up behind one pass merge into ONE follow-up pass,
 *      their item scopes merged ("everything moved" wins).
 *   4. The planner is told which items moved (planPass receives itemIds) on a
 *      capture pass, and is told nothing on a gesture pass.
 *
 * Fake timers, fake steps. No DOM.
 *
 * Run: node tests/render-async-capture-no-starve.test.cjs
 */

const assert = require("assert");
const { createRenderScheduler } = require("../js/render-async.js");
const { runRenderSteps } = require("../js/render-schedule.js");

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

function fakeTimers() {
  let next = 1;
  const pending = new Map();
  return {
    setTimer: (fn) => { pending.set(next, fn); return next++; },
    clearTimer: (id) => { pending.delete(id); },
    flush() { const due = [...pending.values()]; pending.clear(); due.forEach((f) => f()); return due.length; },
    get size() { return pending.size; },
  };
}

/**
 * A scheduler whose one table draws in two awaited slices, so a request can
 * land while it is mid-draw. `gate` releases the slice.
 */
function harness() {
  const timers = fakeTimers();
  let seq = 0;
  const log = [];
  const plans = [];
  let release = null;
  const gate = () => new Promise((r) => { release = r; });
  const scheduler = createRenderScheduler({
    planPass: (req) => {
      plans.push(req);
      return {
        steps: [{ id: "craft-planner-table", phase: "visible" }],
        plannedIds: ["craft-planner-table"],
        render: async (id, cancelled) => {
          log.push("slice1");
          await gate();
          if (cancelled()) { log.push("cancelled"); return false; }
          log.push("painted");
          return true;
        },
      };
    },
    runSteps: runRenderSteps,
    yieldTo: async () => {},
    beginPass: () => ++seq,
    isCurrentPass: (t) => t === seq,
    onPassEnd: (info) => log.push(`end:${info.reason}${info.superseded ? ":superseded" : ""}`),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  const tick = () => new Promise((r) => setImmediate(r));
  return { scheduler, timers, log, plans, releaseSlice: () => release && release(), tick };
}

(async () => {

await test("1. a capture landing mid-draw does not cancel the pass", async () => {
  const h = harness();
  h.scheduler.schedule("captured-prices", { itemIds: ["T8_PLANKS"] });
  h.timers.flush();
  await h.tick();
  assert.deepStrictEqual(h.log, ["slice1"]);
  h.scheduler.schedule("captured-prices", { itemIds: ["T8_METALBAR"] });
  h.releaseSlice();
  await h.scheduler.whenIdle();
  await h.tick();
  assert.ok(h.log.includes("painted"), `the first pass must paint: ${h.log}`);
  assert.ok(!h.log.includes("cancelled"), `nothing cancelled: ${h.log}`);
});

await test("1b. the queued capture runs as the next pass once the first ends", async () => {
  const h = harness();
  h.scheduler.schedule("captured-prices", { itemIds: ["A"] });
  h.timers.flush();
  await h.tick();
  h.scheduler.schedule("captured-prices", { itemIds: ["B"] });
  h.releaseSlice();
  await h.scheduler.whenIdle();
  await h.tick();
  assert.strictEqual(h.timers.size, 1, "a follow-up pass is armed");
  h.timers.flush();
  await h.tick();
  h.releaseSlice();
  await h.scheduler.whenIdle();
  await h.tick();
  assert.strictEqual(h.plans.length, 2);
  assert.deepStrictEqual(h.plans[1].itemIds, ["B"]);
  assert.strictEqual(h.log.filter((l) => l === "painted").length, 2);
});

await test("2. a gesture still supersedes the pass in flight", async () => {
  const h = harness();
  h.scheduler.schedule("captured-prices", { itemIds: ["A"] });
  h.timers.flush();
  await h.tick();
  h.scheduler.schedule("price-edit");
  h.releaseSlice();
  await h.scheduler.whenIdle();
  await h.tick();
  assert.ok(h.log.includes("cancelled"), `the gesture must cancel: ${h.log}`);
});

await test("3. several captures queued behind one pass merge into one follow-up", async () => {
  const h = harness();
  h.scheduler.schedule("captured-prices", { itemIds: ["A"] });
  h.timers.flush();
  await h.tick();
  h.scheduler.schedule("captured-prices", { itemIds: ["B"] });
  h.scheduler.schedule("captured-prices", { itemIds: ["C", "B"] });
  h.releaseSlice();
  await h.scheduler.whenIdle();
  await h.tick();
  h.timers.flush();
  await h.tick();
  h.releaseSlice();
  await h.scheduler.whenIdle();
  await h.tick();
  assert.strictEqual(h.plans.length, 2, "one follow-up, not two");
  assert.deepStrictEqual([...h.plans[1].itemIds].sort(), ["B", "C"]);
});

await test("3b. a queued capture merged with a gesture scope becomes 'everything moved'", async () => {
  const h = harness();
  h.scheduler.schedule("captured-prices", { itemIds: ["A"] });
  h.timers.flush();
  await h.tick();
  h.scheduler.schedule("captured-prices", { itemIds: ["B"] });
  h.scheduler.schedule("premium");
  h.releaseSlice();
  await h.scheduler.whenIdle();
  await h.tick();
  h.timers.flush();
  await h.tick();
  h.releaseSlice();
  await h.scheduler.whenIdle();
  await h.tick();
  const last = h.plans[h.plans.length - 1];
  assert.strictEqual(last.itemIds, null);
});

await test("4. planPass hears the moved items on a capture pass only", async () => {
  const h = harness();
  h.scheduler.schedule("captured-prices", { itemIds: ["A"] });
  h.timers.flush();
  await h.tick();
  h.releaseSlice();
  await h.scheduler.whenIdle();
  h.scheduler.schedule("price-edit", { itemIds: ["A"] });
  h.timers.flush();
  await h.tick();
  h.releaseSlice();
  await h.scheduler.whenIdle();
  assert.deepStrictEqual(h.plans[0].itemIds, ["A"]);
  assert.strictEqual(h.plans[0].refreshOnly, true);
  assert.strictEqual(h.plans[1].refreshOnly, false, "a price edit is not a data refresh");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
})();
