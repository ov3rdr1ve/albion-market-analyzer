/**
 * Test: renderAllTables() must draw both Top-10 boards LAST.
 *
 * They project over every source table's tableState[X].data cache, so their
 * renderers must run after every other renderer has populated its cache. Also
 * asserts the supporting wiring exists (both HTML containers in index.html,
 * sorting.js state + getSortValue branch).
 *
 * Run: node tests/render-all-tables-includes-joined-summary.test.cjs
 */

const assert = require("assert");
const { appSource } = require("./helpers/app-source.cjs");
const fs = require("fs");
const path = require("path");
const { readIndexHtml } = require("./helpers/page-source.cjs");

const appSrc      = appSource();
const htmlSrc     = readIndexHtml();
const sortingSrc  = fs.readFileSync(path.join(__dirname, "..", "js", "sorting.js"), "utf8");

function extractFnBody(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `${signature} must be defined`);
  // The signature already includes the opening "{"; start the walk with depth=1
  // so the first balanced "}" is the function's own close, not the first
  // nested block's close.
  let depth = 1;
  let end = -1;
  for (let i = start + signature.length; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.ok(end > start, `${signature} braces did not close`);
  return src.slice(start, end);
}

const renderAllBody = extractFnBody(appSrc, "function renderAllTables(data) {");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("\n=== renderAllTables wiring ===");

// The call list moved out of renderAllTables into renderCalls(), shared with
// the chunked boot pass (js/render-schedule.js) so both draw the same tables the
// same way. The guarantees below are unchanged; only where they live moved.
const renderCallsBody = extractFnBody(appSrc, "function renderCalls(data) {");
const timedRenderBody = extractFnBody(
  appSrc,
  "function timedRender(tableId, name, render) {",
);

test("every renderer runs inside a try/catch", () => {
  assert.match(
    timedRenderBody,
    /try\s*\{\s*render\(\)\s*;\s*\}\s*catch/,
    "timedRender must wrap each renderer — one broken table cannot empty the page",
  );
});

test("both boards are wired to their renderers", () => {
  assert.match(renderCallsBody, /"joined-summary-table":\s*\(\)\s*=>\s*renderJoinedSummaryTable\(\)/);
  assert.match(renderCallsBody, /"joined-focus-table":\s*\(\)\s*=>\s*renderJoinedFocusTable\(\)/);
});

test("the boards are drawn after every source, and the craft list after them", () => {
  const sourcesIdx = renderAllBody.indexOf("RENDER_ORDER.forEach");
  const boardsIdx = renderAllBody.indexOf("BOARD_TABLES.forEach");
  const listIdx = renderAllBody.indexOf("CRAFT_LIST_TABLE");
  assert.ok(sourcesIdx > 0, "the source tables must be drawn from RENDER_ORDER");
  assert.ok(boardsIdx > sourcesIdx, "the boards must come AFTER every source");
  assert.ok(listIdx > boardsIdx, "the craft list reads the boards' sources, so it comes last");
});

test("neither board is in the source draw order — they would run too early", () => {
  const from = appSrc.indexOf("const RENDER_ORDER = [");
  assert.ok(from >= 0, "RENDER_ORDER must be declared in app.js");
  const order = appSrc.slice(from, appSrc.indexOf("];", from));
  assert.ok(!order.includes("joined-summary-table"), "profit board not in RENDER_ORDER");
  assert.ok(!order.includes("joined-focus-table"), "focus board not in RENDER_ORDER");
});

console.log("\n=== index.html wiring ===");

test("index.html contains both board tables", () => {
  assert.ok(htmlSrc.includes('id="joined-summary-table"'), "profit board id missing");
  assert.ok(htmlSrc.includes('id="joined-focus-table"'), "focus board id missing");
});

test("index.html gives the profit board a Pure Profit sort header", () => {
  assert.match(
    htmlSrc,
    /<th[^>]*data-sort="profit"[^>]*class="sortable"/,
    "pure-profit sort header missing or not sortable",
  );
});

test("index.html gives the focus board its two focus columns", () => {
  assert.match(htmlSrc, /<th[^>]*data-sort="focusCost"[^>]*class="sortable"/,
    "focus-cost sort header missing or not sortable");
  assert.match(htmlSrc, /<th[^>]*data-sort="profitPer10kFocus"[^>]*class="sortable"/,
    "profit-per-10k-focus sort header missing or not sortable");
});

test("index.html loads both board scripts, sources first", () => {
  const sourcesIdx = htmlSrc.indexOf("joined-summary-sources.js");
  const renderIdx = htmlSrc.indexOf("render-joined-summary.js");
  assert.ok(sourcesIdx > 0, "<script src> for joined-summary-sources.js must be present");
  assert.ok(renderIdx > 0, "<script src> for render-joined-summary.js must be present");
  assert.ok(sourcesIdx < renderIdx, "JOINED_SOURCES must be declared before the renderer uses it");
});

console.log("\n=== sorting.js wiring ===");

test("sorting.js registers joined-summary-table in tableState", () => {
  assert.ok(
    /"joined-summary-table"\s*:\s*\{[\s\S]*?formatter:\s*null/.test(sortingSrc),
    "tableState entry for joined-summary-table missing",
  );
});

// The boards are ranked before they are rendered, so the default sort has to
// agree with the ranking or the table reads out of order on first paint.
test("sorting.js declares the profit board's default sort = profit desc", () => {
  assert.match(
    sortingSrc,
    /"joined-summary-table"\s*:\s*\{[^}]*sortCol:\s*"profit"[^}]*sortDir:\s*"desc"/,
    "default sort for joined-summary-table must be profit desc",
  );
});

test("sorting.js declares the focus board's default sort = profitPer10kFocus desc", () => {
  assert.match(
    sortingSrc,
    /"joined-focus-table"\s*:\s*\{[^}]*sortCol:\s*"profitPer10kFocus"[^}]*sortDir:\s*"desc"/,
    "default sort for joined-focus-table must be profitPer10kFocus desc",
  );
});

test("getSortValue has a branch covering both boards", () => {
  const valuesSrc = fs.readFileSync(
    path.join(__dirname, "..", "js", "sorting-values-tables.js"), "utf8",
  );
  assert.ok(/tableId\s*===\s*"joined-summary-table"/.test(valuesSrc),
    "getSortValue must handle joined-summary-table");
  assert.ok(/tableId\s*===\s*"joined-focus-table"/.test(valuesSrc),
    "getSortValue must handle joined-focus-table");
});

test("sorting.js saveCurrentSortState persists joined-summary-table", () => {
  // Behaviour, not shape: saveCurrentSortState walks tableState, so asserting a
  // literal "joined-summary-table": { … } block would only re-describe the
  // implementation. Load the module and check the key really lands in storage.
  const vm = require("vm");
  const store = new Map();
  const sandbox = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    console: { warn() {}, error() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(
    sortingSrc + "\n;globalThis.__api = { tableState, saveCurrentSortState };",
    sandbox,
  );
  assert.ok(
    sandbox.__api.tableState["joined-summary-table"],
    "joined-summary-table must have a tableState entry",
  );
  sandbox.__api.saveCurrentSortState();
  const saved = JSON.parse(store.get("albionMarketSortState"));
  assert.ok(saved["joined-summary-table"], "saveCurrentSortState must persist joined-summary-table sort");
  assert.ok("sortCol" in saved["joined-summary-table"]);
  assert.ok(saved["joined-focus-table"], "saveCurrentSortState must persist joined-focus-table sort");
});

// An existing install has "throughput" pinned from when the board WAS the
// throughput ranking. Left alone it would order a profit board by a column it
// is no longer built from — but only once: a later deliberate pick must stick.
test("an old throughput pin is migrated off the profit board, once", () => {
  const vm = require("vm");
  const store = new Map([[
    "albionMarketSortState",
    JSON.stringify({ "joined-summary-table": { sortCol: "throughput", sortDir: "desc" } }),
  ]]);
  const sandbox = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    console: { warn() {}, error() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(sortingSrc + "\n;globalThis.__api = { tableState };", sandbox);
  assert.strictEqual(sandbox.__api.tableState["joined-summary-table"].sortCol, "profit");

  // Second launch, user has since chosen Throughput on purpose: it survives.
  store.set("albionMarketSortState",
    JSON.stringify({ "joined-summary-table": { sortCol: "throughput", sortDir: "desc" } }));
  const again = { ...sandbox, __api: undefined };
  vm.createContext(again);
  vm.runInContext(sortingSrc + "\n;globalThis.__api = { tableState };", again);
  assert.strictEqual(again.__api.tableState["joined-summary-table"].sortCol, "throughput");
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
