/**
 * Tests for the boot render schedule (js/render-schedule.js).
 *
 * Measured cold boot before this existed: 19.3 s of "Computing tables" in one
 * unbroken synchronous pass — the window was up, the splash frozen, nothing
 * clickable. The pass itself is not wasteful so much as monolithic: the tables
 * the user can actually see cost a fraction of it, and everything else is work
 * for tables that are collapsed (the Top-10 boards' feeders) or off the visible
 * page entirely (the craft list catching up its sources).
 *
 * So boot splits the same work into phases and yields to the browser between
 * every table:
 *
 *   visible → the tables on screen. The app is usable once these land.
 *   sources → collapsed feeders, computed only because a Top-10 board is open.
 *   boards  → the Top-10s, after the feeders they read.
 *   list    → My Crafting List, which renders through the sources above.
 *
 * Black-box: pure functions, injected renderers and yield, no DOM, no timers.
 *
 * Run: node tests/render-schedule.test.cjs
 */

const assert = require("assert");
const {
  bootRenderSteps,
  runRenderSteps,
  BOARD_TABLES,
  CRAFT_LIST_TABLE,
  BOOT_PHASES,
  RERENDER_PHASES,
} = require("../js/render-schedule.js");

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

const ORDER = [
  "rolling-table",
  "crafting-table",
  "craft-planner-table",
  "flipping-table",
  "transport-table",
  "rerolling-table",
  "volume-table",
];
const SOURCES = new Set(["rolling-table", "crafting-table", "flipping-table", "transport-table"]);

/** Everything hidden except the ids listed. */
const visibleOnly = (...ids) => (id) => !ids.includes(id);

const plan = (opts) =>
  bootRenderSteps({ order: ORDER, summarySources: SOURCES, ...opts });

const idsOf = (steps, phase) =>
  steps.filter((s) => s.phase === phase).map((s) => s.id);

// ── what goes in the plan ──────────────────────────────────────────────────

(async () => {

await test("only the tables on screen are in the visible phase", () => {
  const steps = plan({ isHidden: visibleOnly("flipping-table", "volume-table") });
  assert.deepStrictEqual(idsOf(steps, "visible"), ["flipping-table", "volume-table"]);
});

await test("the visible phase keeps the app's draw order", () => {
  const steps = plan({ isHidden: () => false, hasQuality: true });
  assert.deepStrictEqual(idsOf(steps, "visible"), ORDER);
});

await test("a collapsed table nobody reads is left out entirely", () => {
  // volume-table is not a board feeder, so a collapsed one is simply skipped.
  const steps = plan({ isHidden: visibleOnly(...BOARD_TABLES) });
  assert.ok(!steps.some((s) => s.id === "volume-table"), "volume-table not scheduled");
});

await test("collapsed feeders are scheduled only when a board is open", () => {
  const open = plan({ isHidden: visibleOnly("joined-focus-table") });
  assert.deepStrictEqual(idsOf(open, "sources"), [...SOURCES]);

  const shut = plan({ isHidden: () => true });
  assert.deepStrictEqual(idsOf(shut, "sources"), []);
});

await test("a visible feeder is drawn once, in the visible phase", () => {
  const steps = plan({ isHidden: visibleOnly("crafting-table", "joined-summary-table") });
  const all = steps.map((s) => s.id);
  assert.strictEqual(all.filter((id) => id === "crafting-table").length, 1);
  assert.ok(idsOf(steps, "visible").includes("crafting-table"));
});

await test("only the boards that are open are scheduled", () => {
  const steps = plan({ isHidden: visibleOnly("joined-focus-table") });
  assert.deepStrictEqual(idsOf(steps, "boards"), ["joined-focus-table"]);
});

await test("boards come after the feeders they read", () => {
  const steps = plan({ isHidden: visibleOnly("joined-focus-table") });
  const lastSource = steps.map((s) => s.phase).lastIndexOf("sources");
  const firstBoard = steps.findIndex((s) => s.phase === "boards");
  assert.ok(lastSource < firstBoard, "every source precedes the boards");
});

await test("the craft list is last — it renders through the tables above it", () => {
  const steps = plan({ isHidden: () => false, hasQuality: true });
  assert.strictEqual(steps[steps.length - 1].id, CRAFT_LIST_TABLE);
  assert.strictEqual(steps[steps.length - 1].phase, "list");
});

await test("rerolling waits for a quality-aware scan", () => {
  const without = plan({ isHidden: () => false });
  assert.ok(!without.some((s) => s.id === "rerolling-table"), "not scheduled");
  const with_ = plan({ isHidden: () => false, hasQuality: true });
  assert.ok(with_.some((s) => s.id === "rerolling-table"), "scheduled");
});

await test("no table is scheduled twice", () => {
  const steps = plan({ isHidden: visibleOnly("crafting-table", "joined-focus-table"), hasQuality: true });
  const ids = steps.map((s) => s.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

// ── the edited table goes first (a re-render, not a boot) ──────────────────

await test("the edited table is hoisted into its own phase, ahead of everything", () => {
  const steps = plan({ isHidden: () => false, hasQuality: true, first: ["transport-table"] });
  assert.deepStrictEqual(idsOf(steps, "edited"), ["transport-table"]);
  assert.strictEqual(steps[0].id, "transport-table");
});

await test("a hoisted table is not drawn a second time in the visible phase", () => {
  const steps = plan({ isHidden: () => false, hasQuality: true, first: ["crafting-table"] });
  const ids = steps.map((s) => s.id);
  assert.strictEqual(ids.filter((id) => id === "crafting-table").length, 1);
  assert.strictEqual(new Set(ids).size, ids.length);
});

await test("boards are never hoisted — they read caches the feeders have not filled yet", () => {
  const steps = plan({ isHidden: visibleOnly("joined-focus-table"), first: ["joined-focus-table"] });
  assert.deepStrictEqual(idsOf(steps, "edited"), []);
  assert.deepStrictEqual(idsOf(steps, "boards"), ["joined-focus-table"]);
});

await test("the craft list is never hoisted either — it renders through the sources", () => {
  const steps = plan({ isHidden: () => false, first: [CRAFT_LIST_TABLE] });
  assert.deepStrictEqual(idsOf(steps, "edited"), []);
  assert.strictEqual(steps[steps.length - 1].id, CRAFT_LIST_TABLE);
});

await test("a hidden or unknown id is not hoisted", () => {
  const hidden = plan({ isHidden: visibleOnly("volume-table"), first: ["crafting-table"] });
  assert.deepStrictEqual(idsOf(hidden, "edited"), []);
  const unknown = plan({ isHidden: () => false, first: ["not-a-table"] });
  assert.deepStrictEqual(idsOf(unknown, "edited"), []);
});

await test("rerolling is only hoisted once a quality-aware scan has run", () => {
  const without = plan({ isHidden: () => false, first: ["rerolling-table"] });
  assert.ok(!without.some((s) => s.id === "rerolling-table"), "not scheduled at all");
  const with_ = plan({ isHidden: () => false, hasQuality: true, first: ["rerolling-table"] });
  assert.deepStrictEqual(idsOf(with_, "edited"), ["rerolling-table"]);
});

await test("no `first` reproduces the boot plan exactly", () => {
  const boot = plan({ isHidden: () => false, hasQuality: true });
  const same = plan({ isHidden: () => false, hasQuality: true, first: [] });
  assert.deepStrictEqual(same, boot);
});

await test("the re-render phase list wraps boot's with `edited` and `list-sources`", () => {
  assert.deepStrictEqual(RERENDER_PHASES,
    ["edited", "visible", "sources", "boards", "list-sources", "list"]);
  BOOT_PHASES.forEach((p) => assert.ok(RERENDER_PHASES.includes(p), `${p} kept`));
});

// ── the craft list's sources are steps, not one 8.7 s renderer ─────────────

await test("the list's sources are scheduled just before the list itself", () => {
  const steps = plan({
    isHidden: () => true,
    listSources: ["crafting-table", "transport-table"],
  });
  assert.deepStrictEqual(idsOf(steps, "list-sources"), ["crafting-table", "transport-table"]);
  const lastSource = steps.map((s) => s.phase).lastIndexOf("list-sources");
  const list = steps.findIndex((s) => s.id === CRAFT_LIST_TABLE);
  assert.ok(lastSource < list, "every source precedes the list that reads it");
});

await test("a collapsed source is scheduled anyway — the list renders it regardless", () => {
  // This is the whole point: renderCraftListTable force-renders a stale source
  // inline, so leaving it out of the plan does not save the work, it just moves
  // it into one unbroken block.
  const steps = plan({ isHidden: () => true, listSources: ["crafting-table"] });
  assert.deepStrictEqual(idsOf(steps, "list-sources"), ["crafting-table"]);
});

await test("a source already drawn earlier in the pass is not drawn twice", () => {
  const steps = plan({
    isHidden: visibleOnly("crafting-table"),
    listSources: ["crafting-table", "transport-table"],
  });
  assert.deepStrictEqual(idsOf(steps, "visible"), ["crafting-table"]);
  assert.deepStrictEqual(idsOf(steps, "list-sources"), ["transport-table"]);
  const ids = steps.map((s) => s.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

await test("the hoisted edited table also counts as already drawn", () => {
  const steps = plan({
    isHidden: () => false,
    first: ["crafting-table"],
    listSources: ["crafting-table"],
  });
  assert.deepStrictEqual(idsOf(steps, "list-sources"), []);
});

await test("a source that is not a real table is ignored", () => {
  const steps = plan({ isHidden: () => true, listSources: ["not-a-table", "rerolling-table"] });
  // rerolling needs a quality scan, and the unknown id is not in the draw order.
  assert.deepStrictEqual(idsOf(steps, "list-sources"), []);
});

await test("no listSources reproduces the plan without them", () => {
  const withOut = plan({ isHidden: () => false, hasQuality: true });
  const withEmpty = plan({ isHidden: () => false, hasQuality: true, listSources: [] });
  assert.deepStrictEqual(withEmpty, withOut);
});

// ── running the plan ───────────────────────────────────────────────────────

/** Records renders and yields in the order they happened. */
function recorder() {
  const log = [];
  return {
    log,
    render: (id) => log.push(`render:${id}`),
    yieldTo: async () => { log.push("yield"); },
  };
}

await test("tables in one phase run back to back — a paint each would cost more", async () => {
  const r = recorder();
  const steps = [{ id: "a", phase: "visible" }, { id: "b", phase: "visible" }];
  await runRenderSteps(steps, { render: r.render, yieldTo: r.yieldTo });
  assert.deepStrictEqual(r.log, ["yield", "render:a", "render:b"]);
});

await test("the browser gets a frame before each phase", async () => {
  const r = recorder();
  const steps = [
    { id: "a", phase: "visible" },
    { id: "b", phase: "sources" },
    { id: "c", phase: "sources" },
    { id: "d", phase: "boards" },
  ];
  await runRenderSteps(steps, { render: r.render, yieldTo: r.yieldTo });
  assert.deepStrictEqual(r.log, [
    "yield", "render:a",
    "yield", "render:b", "render:c",
    "yield", "render:d",
  ]);
});

await test("the phase is reported once its last table is drawn", async () => {
  const r = recorder();
  const phases = [];
  const steps = [
    { id: "a", phase: "visible" },
    { id: "b", phase: "sources" },
    { id: "c", phase: "sources" },
  ];
  await runRenderSteps(steps, {
    render: r.render,
    yieldTo: r.yieldTo,
    onPhase: (p) => phases.push(p),
  });
  // Reported in order as each one finishes, then the phases this plan had
  // nothing in — boot waits on every phase, so none may go unreported.
  assert.deepStrictEqual(phases.slice(0, 2), ["visible", "sources"]);
  assert.deepStrictEqual([...phases].sort(), [...BOOT_PHASES].sort());
});

await test("a phase with nothing in it is still reported, so boot can move on", async () => {
  const phases = [];
  await runRenderSteps([], {
    render: () => {},
    yieldTo: async () => {},
    onPhase: (p) => phases.push(p),
    phases: ["visible", "sources"],
  });
  assert.deepStrictEqual(phases, ["visible", "sources"]);
});

await test("one broken renderer does not stop the rest", async () => {
  const drawn = [];
  const steps = ["a", "b", "c"].map((id) => ({ id, phase: "visible" }));
  const result = await runRenderSteps(steps, {
    yieldTo: async () => {},
    render: (id) => {
      if (id === "b") throw new Error("boom");
      drawn.push(id);
    },
    onError: () => {},
  });
  assert.deepStrictEqual(drawn, ["a", "c"]);
  assert.strictEqual(result.rendered, 2);
  assert.strictEqual(result.failed, 1);
});

await test("the failure is reported, not swallowed silently", async () => {
  const seen = [];
  await runRenderSteps([{ id: "a", phase: "visible" }], {
    yieldTo: async () => {},
    render: () => { throw new Error("boom"); },
    onError: (id, e) => seen.push(`${id}:${e.message}`),
  });
  assert.deepStrictEqual(seen, ["a:boom"]);
});

// ── the time budget (re-render only; boot passes nothing and is unchanged) ──

/** A clock the test moves by hand: each render costs `costs[id]` ms. */
function fakeClock(costs) {
  let t = 0;
  return {
    now: () => t,
    spend: (id) => { t += costs[id] || 0; },
  };
}

await test("with no budget, a phase runs unbroken — today's boot behaviour", async () => {
  const r = recorder();
  const clock = fakeClock({ a: 500, b: 500, c: 500 });
  const steps = ["a", "b", "c"].map((id) => ({ id, phase: "visible" }));
  await runRenderSteps(steps, {
    render: (id) => { r.render(id); clock.spend(id); },
    yieldTo: r.yieldTo,
    now: clock.now,
  });
  assert.deepStrictEqual(r.log, ["yield", "render:a", "render:b", "render:c"]);
});

await test("a budget hands the thread back once a block of tables overruns it", async () => {
  const r = recorder();
  const clock = fakeClock({ a: 50, b: 90, c: 10, d: 10 });
  const steps = ["a", "b", "c", "d"].map((id) => ({ id, phase: "visible" }));
  await runRenderSteps(steps, {
    render: (id) => { r.render(id); clock.spend(id); },
    yieldTo: r.yieldTo,
    now: clock.now,
    budgetMs: 120,
  });
  // a+b = 140ms, over budget → yield, then the budget starts again at c.
  assert.deepStrictEqual(r.log, [
    "yield", "render:a", "render:b",
    "yield", "render:c", "render:d",
  ]);
});

await test("the budget restarts at each phase boundary, not across it", async () => {
  const r = recorder();
  const clock = fakeClock({ a: 200, b: 10 });
  const steps = [{ id: "a", phase: "visible" }, { id: "b", phase: "sources" }];
  await runRenderSteps(steps, {
    render: (id) => { r.render(id); clock.spend(id); },
    yieldTo: r.yieldTo,
    now: clock.now,
    budgetMs: 120,
  });
  // One yield per phase — the phase change already gave the browser its frame,
  // so the overrun on `a` must not buy a second one.
  assert.deepStrictEqual(r.log, ["yield", "render:a", "yield", "render:b"]);
});

await test("a pass cancelled at a mid-phase yield stops there", async () => {
  const drawn = [];
  const clock = fakeClock({ a: 200, b: 10, c: 10 });
  let stop = false;
  const steps = ["a", "b", "c"].map((id) => ({ id, phase: "visible" }));
  await runRenderSteps(steps, {
    yieldTo: async () => { stop = true; },
    render: (id) => { drawn.push(id); clock.spend(id); },
    now: clock.now,
    budgetMs: 120,
    cancelled: () => stop,
  });
  // The pre-phase yield sets stop, so nothing is drawn at all.
  assert.deepStrictEqual(drawn, []);
});

await test("each step is announced before it is drawn, with its place in the pass", async () => {
  const seen = [];
  const steps = [
    { id: "a", phase: "visible" },
    { id: "b", phase: "sources" },
  ];
  await runRenderSteps(steps, {
    render: () => {},
    yieldTo: async () => {},
    onStep: (step, index, total) => seen.push(`${step.id}:${index}/${total}`),
  });
  assert.deepStrictEqual(seen, ["a:0/2", "b:1/2"]);
});

await test("a throwing progress listener does not stop the pass", async () => {
  const drawn = [];
  const steps = ["a", "b"].map((id) => ({ id, phase: "visible" }));
  await runRenderSteps(steps, {
    render: (id) => drawn.push(id),
    yieldTo: async () => {},
    onStep: () => { throw new Error("listener boom"); },
  });
  assert.deepStrictEqual(drawn, ["a", "b"]);
});

await test("a cancelled pass stops where it is", async () => {
  const drawn = [];
  let stop = false;
  const steps = ["a", "b", "c"].map((id) => ({ id, phase: "visible" }));
  await runRenderSteps(steps, {
    yieldTo: async () => {},
    render: (id) => { drawn.push(id); if (id === "a") stop = true; },
    cancelled: () => stop,
  });
  assert.deepStrictEqual(drawn, ["a"]);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
})();
