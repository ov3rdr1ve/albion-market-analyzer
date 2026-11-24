/**
 * My Crafting List: a Sell/Buy City change must not freeze the window.
 *
 * Reported: picking a City on the list ran the whole re-price inline.
 * applyCraftListFilter called renderCraftListTable() synchronously, which
 * re-prices every source table through _clRepricedState (seconds for the Craft
 * Planner), with no loading animation and no yielding. Every other table goes
 * through repriceOnCityChange -> requestTableRender -> scheduleRerender
 * ("city-pick"), the async pass of js/render-async.js.
 *
 * Contract pinned here (black-box; stubs stand in for the scheduler and the
 * renderers, nothing is read from the DOM):
 *
 *   A. HANDLER. A City change that MOVES the pick returns without calling
 *      renderCraftListTable; it asks for a "city-pick" pass prioritising
 *      craft-list-table. A pick that did not move asks for nothing and renders
 *      nothing ("a re-render must be earned"). When no scheduler is coming
 *      (scheduleRerender returns false) the direct render is still the fallback.
 *   B. PASS. With a list pick active, the heavy re-price of each source runs in
 *      that source's OWN step, before the list step, so the list step itself is
 *      a cache hit; the browser gets a frame before the first heavy step and
 *      between steps; craft-list-table is marked computing before any of it.
 *   C. RESULT. The list reads the same re-priced rows it reads today.
 *
 * Run: node tests/craft-list-city-pick-async.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const loadFile = (rel) =>
  fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n").replace(/if \(typeof module[\s\S]*$/, "");

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name + " - " + e.message); failed++; }
}

// ════════════════════════════════════════════════════════════════════════════
// A. the filter handler
// ════════════════════════════════════════════════════════════════════════════

const handlerCalls = { render: 0, schedule: [] };
let moved = { sell: false, buy: false };
let schedulerAccepts = true;

const pickerEls = new Map();
globalThis.document = {
  readyState: "complete",
  getElementById: (id) => pickerEls.get(id) || null,
  addEventListener: () => {},
  querySelectorAll: () => [],
};
globalThis.window = undefined;
globalThis.getItemDisplayName = (id) => id;
globalThis.getMarketCategory = () => null;
globalThis.MARKET_CATEGORY_TREE = [];
globalThis.sellCityFilterChanged = () => moved.sell;
globalThis.buyCityFilterChanged = () => moved.buy;
globalThis.renderCraftListTable = () => { handlerCalls.render++; };
globalThis.scheduleRerender = (reason, options) => {
  handlerCalls.schedule.push({ reason, options });
  return schedulerAccepts;
};

const CLF = require(path.join(ROOT, "js", "craft-list-filter.js"));

function runHandler({ sell = false, buy = false, accepts = true }) {
  moved = { sell, buy };
  schedulerAccepts = accepts;
  handlerCalls.render = 0;
  handlerCalls.schedule = [];
  pickerEls.clear();
  pickerEls.set(CLF.INPUT_ID, { value: "", addEventListener: () => {} });
  CLF.applyCraftListFilter();
  return handlerCalls;
}

const HANDLER_CASES = [
  { name: "Sell City pick moved", opts: { sell: true } },
  { name: "Buy City pick moved", opts: { buy: true } },
  { name: "both picks moved", opts: { sell: true, buy: true } },
];

const run = async () => {
  console.log("My Crafting List - City pick is asynchronous\n");
  console.log("=== A. handler ===");

  for (const c of HANDLER_CASES) {
    await test(c.name + ": no synchronous renderCraftListTable", () => {
      const r = runHandler(c.opts);
      assert.strictEqual(r.render, 0, "the handler re-priced the whole list inline (" + r.render + " render call)");
    });
    await test(c.name + ": asks for a city-pick pass prioritising the list", () => {
      const r = runHandler(c.opts);
      assert.strictEqual(r.schedule.length, 1, "expected exactly one scheduled pass, got " + r.schedule.length);
      assert.strictEqual(r.schedule[0].reason, "city-pick");
      assert.strictEqual(r.schedule[0].options && r.schedule[0].options.priorityTableId, "craft-list-table");
    });
    await test(c.name + ": with no scheduler coming the direct render is the fallback", () => {
      const r = runHandler({ ...c.opts, accepts: false });
      assert.strictEqual(r.render, 1, "no pass is coming and nothing re-priced the list");
    });
  }

  await test("a pick that did not move schedules nothing and renders nothing", () => {
    const r = runHandler({});
    assert.strictEqual(r.render, 0);
    assert.deepStrictEqual(r.schedule, []);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // B + C. the pass, through the real planner / scheduler / re-price code
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n=== B. the pass ===");

  const sandbox = `
const SELL_CITIES = ["Martlock", "Lymhurst", "Caerleon", "Black Market"];
const CITIES = ["Martlock", "Lymhurst", "Caerleon"];
function isInvalidCrossRoute() { return false; }
const document = undefined;
function getRowKey(row) { return row.item.id + "|" + row.craftCity; }
function craftListIdentity(tableId, key) { return tableId + "::" + key; }
let lastMarketData = { seeded: true };
const lastQualityMarketData = null;
let _suppressSort = false;

const _log = [];                 // every event, in order
let _currentStep = null;         // which plan step is running
const SOURCES = ["crafting-table", "transport-table"];
const tableState = {};
SOURCES.forEach((id) => { tableState[id] = { data: [], formatter: null, sortCol: "profit" }; });

// A source renderer: new rows every call, priced at its City pick when it has one.
function _renderSource(id) {
  const pick = getTableSellCity(id);
  _log.push({ ev: "render", id, step: _currentStep, reprice: isTableShadowRender(id), pick });
  tableState[id].data = [{ item: { id: "T5_BAG" }, craftCity: "Martlock", sellCity: pick || "Martlock" }];
}
const window = { tableRenderers: () => ({
  "crafting-table": () => _renderSource("crafting-table"),
  "transport-table": () => _renderSource("transport-table"),
}) };

// The deps the pipeline reads (js/render-gating.js, js/render-craft-list.js).
const _deferred = new Set();
function isTableHidden(id) { return id !== "craft-list-table"; }
function markTableDeferred(id) { _deferred.add(id); }
function clearTableDeferred(id) { _deferred.delete(id); }
function isTableDeferred(id) { return _deferred.has(id); }
const JOINED_SUMMARY_SOURCES = new Set();
function getCraftList() { return SOURCES.map((tableId) => ({ tableId, rowKey: "T5_BAG|Martlock" })); }
function renderCraftingTable() { _renderSource("crafting-table"); }
async function renderCraftingTableChunked() { _renderSource("crafting-table"); return true; }
function renderTransportTable() { _renderSource("transport-table"); }
// What the real list renderer does with its sources: read them through _clListState.
function renderCraftListTable() {
  SOURCES.forEach((id) => { _lastListState[id] = _clListState(id); });
}
const _lastListState = {};
`;
  const src = sandbox
    + loadFile("js/table-sell-city.js")
    + loadFile("js/render-craft-list-source.js")
    + loadFile("js/render-schedule.js")
    + loadFile("js/render-async.js")
    + loadFile("js/render-pipeline.js")
    + `
module.exports = {
  planRerenderPass, createRenderScheduler, runRenderSteps, RERENDER_BUDGET_MS,
  sellCityFilterChanged, setTableSellCity, clearTableSellCities, _clListState, _clRepricedCache,
  _log, _lastListState, tableState, setStep: (s) => { _currentStep = s; },
};`;
  const mod = new Module("craft-list-city-pick-async-test");
  mod._compile(src, path.join(ROOT, "js", "craft-list-city-pick-async-sandbox.js"));
  const api = mod.exports;

  const LIST = "craft-list-table";

  /** A fake clock: every call advances it, so each step overruns the budget. */
  function fakeClock(stepMs) {
    let t = 0;
    return { now: () => (t += stepMs) };
  }

  /** Drive one "city-pick" pass through the real scheduler, logging marks and yields. */
  async function runPass({ pick }) {
    api._log.length = 0;
    api._clRepricedCache.clear();
    api.clearTableSellCities();
    Object.keys(api._lastListState).forEach((k) => delete api._lastListState[k]);
    ["crafting-table", "transport-table"].forEach((id) => { api.tableState[id].data = []; });
    // Both sources already hold their own rows, as after any earlier pass.
    api.planRerenderPass(null).render("crafting-table", () => false);
    api.planRerenderPass(null).render("transport-table", () => false);
    api.sellCityFilterChanged(LIST, pick);
    api._log.length = 0;

    const timers = [];
    const clock = fakeClock(1000);
    const events = api._log;
    const scheduler = api.createRenderScheduler({
      planPass: ({ priorityTableId, itemIds }) => {
        const plan = api.planRerenderPass(priorityTableId, itemIds);
        events.push({ ev: "plan", steps: plan.steps.map((s) => s.id) });
        return {
          ...plan,
          render: (id, cancelled) => {
            api.setStep(id);
            events.push({ ev: "step", id });
            try { return plan.render(id, cancelled); } finally { api.setStep(null); }
          },
        };
      },
      runSteps: (steps, opts) => api.runRenderSteps(steps, { ...opts, now: clock.now }),
      yieldTo: async () => { events.push({ ev: "yield" }); },
      markComputing: (id) => events.push({ ev: "mark", id }),
      onPassStart: ({ tableIds }) => events.push({ ev: "passStart", tableIds }),
      setTimer: (fn) => { timers.push(fn); return timers.length; },
      clearTimer: () => {},
    });
    assert.strictEqual(scheduler.schedule("city-pick", { priorityTableId: LIST }), true);
    while (timers.length) timers.shift()();
    await scheduler.whenIdle();
    return events;
  }

  const reprices = (events) => events.filter((e) => e.ev === "render" && e.reprice);
  const idxOf = (events, pred) => events.findIndex(pred);

  await test("the list is the last step, preceded by both sources", async () => {
    const events = await runPass({ pick: "Lymhurst" });
    const plan = events.find((e) => e.ev === "plan");
    assert.deepStrictEqual(plan.steps, ["crafting-table", "transport-table", LIST]);
  });

  await test("each source is re-priced at the pick, and once only", async () => {
    const events = await runPass({ pick: "Lymhurst" });
    const byId = {};
    reprices(events).forEach((e) => { byId[e.id] = (byId[e.id] || 0) + 1; });
    assert.deepStrictEqual(byId, { "crafting-table": 1, "transport-table": 1 });
    reprices(events).forEach((e) => assert.strictEqual(e.pick, "Lymhurst"));
  });

  await test("the heavy re-price runs in the source's own step, not inside the list step", async () => {
    const events = await runPass({ pick: "Lymhurst" });
    const inList = reprices(events).filter((e) => e.step === LIST);
    assert.strictEqual(inList.length, 0,
      inList.length + " source re-price(s) ran inside the list step, as one unbroken block");
    reprices(events).forEach((e) => assert.strictEqual(e.step, e.id,
      e.id + " was re-priced from step " + e.step));
  });

  await test("the list is marked computing before the first heavy step", async () => {
    const events = await runPass({ pick: "Lymhurst" });
    const mark = idxOf(events, (e) => e.ev === "mark" && e.id === LIST);
    const start = idxOf(events, (e) => e.ev === "passStart" && e.tableIds.includes(LIST));
    const first = idxOf(events, (e) => e.ev === "render" && e.reprice);
    assert.ok(mark >= 0 || start >= 0, "the pass never marked craft-list-table");
    assert.ok(first >= 0, "no re-price happened at all");
    assert.ok(Math.max(mark, start) < first || (mark >= 0 && mark < first),
      "the first re-price ran before the list was marked");
  });

  await test("the browser gets a frame before the first heavy step", async () => {
    const events = await runPass({ pick: "Lymhurst" });
    const y = idxOf(events, (e) => e.ev === "yield");
    const first = idxOf(events, (e) => e.ev === "render" && e.reprice);
    assert.ok(y >= 0 && y < first, "no yield before the first re-price");
  });

  await test("the browser gets a frame between the two re-prices", async () => {
    const events = await runPass({ pick: "Lymhurst" });
    const a = idxOf(events, (e) => e.ev === "render" && e.reprice && e.id === "crafting-table");
    const b = idxOf(events, (e) => e.ev === "render" && e.reprice && e.id === "transport-table");
    assert.ok(a >= 0 && b > a, "both sources should be re-priced, in plan order");
    assert.ok(events.slice(a, b).some((e) => e.ev === "yield"), "no yield between the two re-prices");
  });

  await test("no pick: nothing is re-priced in any step", async () => {
    const events = await runPass({ pick: "" });
    assert.strictEqual(reprices(events).length, 0);
  });

  console.log("\n=== C. result ===");

  await test("the list reads the re-priced rows for every source", async () => {
    await runPass({ pick: "Lymhurst" });
    ["crafting-table", "transport-table"].forEach((id) => {
      const state = api._lastListState[id];
      assert.ok(state && state._clRepriced, id + " was not re-priced");
      assert.strictEqual(state.data[0].sellCity, "Lymhurst");
    });
  });

  await test("a source's own rows are left as the source renderer drew them", async () => {
    await runPass({ pick: "Lymhurst" });
    ["crafting-table", "transport-table"].forEach((id) => {
      assert.strictEqual(api.tableState[id].data[0].sellCity, "Martlock", id + " took on the list's pick");
    });
  });

  console.log("\n" + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
};

run().catch((e) => { console.error("harness error:", e); process.exit(2); });
