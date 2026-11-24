/**
 * Renderers that compute in slices (js/render-crafting-chunked.js, and the
 * chunked path in js/render-craft-planner.js).
 *
 * A step in the render schedule is one whole renderer, so the async pass can
 * only ever be as smooth as its slowest single table. Measured on a real price
 * map, two of them dominate everything else:
 *
 *   craft-planner-table  7.1 s — and My Crafting List pulls it in on EVERY
 *                        price edit, even while the planner is collapsed,
 *                        because a list entry has to show the current number.
 *   crafting-table       1.7 s
 *
 * Both are a pure map over a catalog, so they are split over time instead. Two
 * properties make that safe, and both are pinned here:
 *
 *   - the DOM is written ONCE, at the end. A cancelled pass must leave the
 *     previous table on screen, never half of a new one.
 *   - the rows are identical to what the synchronous renderer produces. The
 *     two paths share their per-item helper precisely so they cannot drift.
 *
 * Black-box: the renderer's collaborators are injected as globals, so no
 * catalogs, no DOM, no market data.
 *
 * Run: node tests/chunked-renderers.test.cjs
 */

const assert = require("assert");
const { appSource } = require("./helpers/app-source.cjs");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { readIndexHtml } = require("./helpers/page-source.cjs");

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

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

/** Arrays built inside the vm have that realm's prototype — compare by value. */
const plain = (arr) => (arr === null ? null : [...arr]);

/**
 * Load the chunked crafting renderer with fake collaborators.
 *
 * `items` are the catalog entries; each contributes `rowsPerItem` rows and
 * costs `costPerItem` fake milliseconds.
 */
function loadCrafting({ items, rowsPerItem = 1, costPerItem = 10 } = {}) {
  const calls = { built: 0, perItem: [], painted: null, paintWrapped: 0 };
  let clock = 0;
  const sandbox = {
    module: { exports: {} },
    buildCraftingTableItems: () => { calls.built++; return items; },
    craftingRowsForItem: (item) => {
      clock += costPerItem;
      calls.perItem.push(item);
      return Array.from({ length: rowsPerItem }, (_, i) => `${item}#${i}`);
    },
    dedupeCraftingRows: (rows) => rows,
    paintCraftingRows: (rows) => { calls.painted = rows; },
    performance: { now: () => clock },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read("js/render-crafting-chunked.js"), sandbox);
  return {
    calls,
    now: () => clock,
    render: (opts) => sandbox.renderCraftingTableChunked({}, {
      now: () => clock,
      paint: (write) => { calls.paintWrapped++; write(); },
      ...opts,
    }),
  };
}

(async () => {

// ── slicing ────────────────────────────────────────────────────────────────

await test("a catalog that fits in one budget is never interrupted", async () => {
  let yields = 0;
  const h = loadCrafting({ items: ["a", "b", "c"], costPerItem: 10 });
  await h.render({ budgetMs: 100, yieldTo: async () => { yields++; } });
  assert.strictEqual(yields, 0);
  assert.deepStrictEqual(plain(h.calls.painted), ["a#0", "b#0", "c#0"]);
});

await test("the thread is handed back once a slice overruns its budget", async () => {
  let yields = 0;
  // 8 items × 40ms = 320ms of work against a 100ms budget: the budget is
  // checked after each item, so a slice runs to the first item PAST it.
  const h = loadCrafting({ items: ["a", "b", "c", "d", "e", "f", "g", "h"], costPerItem: 40 });
  await h.render({ budgetMs: 100, yieldTo: async () => { yields++; } });
  assert.strictEqual(yields, 2, "one yield per overrun, not one per item");
  assert.strictEqual(h.calls.perItem.length, 8, "every item still computed");
});

await test("the last item never buys a yield nobody waits behind", async () => {
  let yields = 0;
  const h = loadCrafting({ items: ["a", "b"], costPerItem: 500 });
  await h.render({ budgetMs: 100, yieldTo: async () => { yields++; } });
  assert.strictEqual(yields, 1, "after a, not after b");
});

await test("every row of every item survives the slicing", async () => {
  const h = loadCrafting({ items: ["a", "b", "c"], rowsPerItem: 3, costPerItem: 200 });
  await h.render({ budgetMs: 50, yieldTo: async () => {} });
  assert.strictEqual(h.calls.painted.length, 9);
  assert.deepStrictEqual(plain(h.calls.painted).slice(0, 3), ["a#0", "a#1", "a#2"]);
});

// ── the DOM is written once ────────────────────────────────────────────────

await test("nothing is drawn until every item is computed", async () => {
  const seen = [];
  const h = loadCrafting({ items: ["a", "b", "c"], costPerItem: 200 });
  await h.render({
    budgetMs: 50,
    yieldTo: async () => seen.push(`yield:painted=${h.calls.painted !== null}`),
  });
  assert.deepStrictEqual(seen, ["yield:painted=false", "yield:painted=false"]);
  assert.ok(h.calls.painted, "painted at the end");
});

await test("the paint goes through the caller's wrapper — that is where sorting is suppressed", async () => {
  const h = loadCrafting({ items: ["a"], costPerItem: 10 });
  await h.render({ budgetMs: 100, yieldTo: async () => {} });
  assert.strictEqual(h.calls.paintWrapped, 1);
});

// ── cancellation ───────────────────────────────────────────────────────────

await test("a cancelled pass leaves the old table on screen, not half a new one", async () => {
  const h = loadCrafting({ items: ["a", "b", "c", "d"], costPerItem: 200 });
  const ok = await h.render({
    budgetMs: 50,
    yieldTo: async () => {},
    cancelled: () => true,
  });
  assert.strictEqual(ok, false, "reports that it did not finish");
  assert.strictEqual(h.calls.painted, null, "nothing was drawn");
  assert.strictEqual(h.calls.paintWrapped, 0);
});

await test("a pass that finishes says so", async () => {
  const h = loadCrafting({ items: ["a"], costPerItem: 10 });
  assert.strictEqual(await h.render({ yieldTo: async () => {} }), true);
});

await test("cancellation is only checked where it is safe — at a yield", async () => {
  let checks = 0;
  const h = loadCrafting({ items: ["a", "b"], costPerItem: 10 });
  await h.render({ budgetMs: 1000, yieldTo: async () => {}, cancelled: () => { checks++; return false; } });
  assert.strictEqual(checks, 0, "no yields, so nothing to check");
});

// ── both paths compute the same rows ───────────────────────────────────────

await test("the sync and chunked crafting paths share their per-item helper", () => {
  const sync = read("js/render-crafting.js");
  const chunked = read("js/render-crafting-chunked.js");
  assert.match(sync, /function buildCraftingTableItems\(\)/);
  assert.match(sync, /function craftingRowsForItem\(item, marketData\)/);
  assert.match(sync, /function paintCraftingRows\(dedupedRowData, marketData\)/);
  ["buildCraftingTableItems", "craftingRowsForItem", "paintCraftingRows", "dedupeCraftingRows"]
    .forEach((fn) => assert.ok(chunked.includes(fn), `chunked path uses ${fn}`));
  // The sync renderer must be the thin wrapper, not a second copy of the loop.
  const body = sync.slice(sync.indexOf("function renderCraftingTable(marketData) {"));
  assert.ok(body.slice(0, body.indexOf("\n}")).split("\n").length < 8, "renderCraftingTable is a wrapper");
});

await test("the sync and chunked planner paths share theirs too", () => {
  const src = read("js/render-craft-planner.js");
  assert.match(src, /function _cpRowsForItem\(item, marketData, bmrOn\)/);
  assert.match(src, /function _cpPaintRows\(rows, marketData\)/);
  const chunked = src.slice(src.indexOf("async function renderCraftPlannerTableChunked"));
  ["_cpRowsForItem", "_cpPaintRows", "dedupeCraftPlannerRows"]
    .forEach((fn) => assert.ok(chunked.includes(fn), `chunked path uses ${fn}`));
});

await test("both chunked renderers are wired into the app and loaded by the page", () => {
  const app = appSource();
  const wiring = app.slice(app.indexOf("const CHUNKED_RENDERERS = {"));
  assert.match(wiring, /"crafting-table": .*renderCraftingTableChunked/);
  assert.match(wiring, /"craft-planner-table": .*renderCraftPlannerTableChunked/);
  const html = readIndexHtml();
  assert.ok(html.includes('src="js/render-crafting-chunked.js"'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
})();
