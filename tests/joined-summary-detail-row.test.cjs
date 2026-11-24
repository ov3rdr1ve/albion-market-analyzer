/**
 * Top-10 boards — the expandable detail row.
 *
 * Input Cost on the boards is a SUM for ten of the twelve feeders, so it cannot
 * be a click-to-edit cell (js/app.js aggregateCostTd). The per-unit prices it is
 * built from live in the feeder's own row — its Materials cell, its chain
 * breakdown, its own priceTd cells. So a board row can expand to show that row
 * verbatim, exactly the way My Crafting List does it (js/render-craft-list.js
 * grafts `tableState[id].formatter(row, idx)` rather than re-implementing).
 *
 * The mechanism is the Crafting Planner "paths" panel's, which is already
 * proven: open state in a module-level Set (so it survives the tbody wipe every
 * renderAllTables performs), a second <tr> appended by the formatter, and NO
 * data-row-key on that <tr> — sort anchoring, the table filters and the Craft
 * List cloner all key on that attribute.
 *
 * Run: node tests/joined-summary-detail-row.test.cjs
 */

const assert = require("assert");
const path = require("path");

globalThis.getRowKey = (row, tableId) => `${tableId}|${row?.item?.id || "?"}`;
globalThis.tx = globalThis.tx || ((en) => en);
globalThis.dispName = globalThis.dispName || ((id, fallback) => fallback);
globalThis.formatSilver = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");
globalThis.formatFocusCost = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");
globalThis.getProfitClass = (m) => (m >= 20 ? "profit-high" : "profit-low");
globalThis.priceTd = (price, itemId, city, side = "sell") =>
  `<td class="silver-val cell-num price-editable" data-item-id="${itemId}" data-city="${city}" data-city-list="${side}">${globalThis.formatSilver(price)}</td>`;
globalThis.aggregateCostTd = (cost) =>
  `<td class="silver-val cell-num" title="Materials column">${globalThis.formatSilver(cost)}</td>`;

// ── the feeder cache the graft reads out of ─────────────────────────────────
// A source formatter that renders its own editable material price, so we can
// assert those cells survive the graft.
let formatterCalls = [];
function sourceFormatter(row, idx) {
  formatterCalls.push({ row, idx });
  return `<tr data-row-key="crafting-table|${row.item.id}">`
    + `<td>${row.item.id}</td>`
    + `<span class="price-editable mat-price-inline" data-item-id="T6_PLANKS" data-city="Martlock" data-city-list="buy">@ 1,240 ea</span>`
    + `</tr>`;
}

const SOURCE_ROWS = [
  { item: { id: "T6_BAG" }, sellGear: { city: "Martlock", price: 5000 }, totalInputCost: 3000, marginInfo: { profit: 1500, margin: 30 } },
  { item: { id: "T7_BAG" }, sellGear: { city: "Martlock", price: 9000 }, totalInputCost: 6000, marginInfo: { profit: 2000, margin: 25 } },
];

let renderCount = 0;
function installState({ populated = true, deferred = false } = {}) {
  globalThis.tableState = {
    "crafting-table": {
      data: populated ? SOURCE_ROWS.slice() : [],
      formatter: sourceFormatter,
    },
    "joined-summary-table": {},
    "joined-focus-table": {},
  };
  globalThis.isTableDeferred = (id) => deferred && id === "crafting-table";
  globalThis.clearTableDeferred = () => { deferred = false; };
  globalThis.lastMarketData = { T6_BAG: {} };
  renderCount = 0;
  globalThis.window = globalThis.window || {};
  globalThis.window.tableRenderers = () => ({
    "crafting-table": () => {
      renderCount++;
      globalThis.tableState["crafting-table"].data = SOURCE_ROWS.slice();
    },
  });
}
installState();

const detail = require(path.join(__dirname, "..", "js", "joined-summary-detail.js"));
const { jbOpenDetailRows, jbDetailRowHtml, jbDetailToggle, jbDetailKey } = detail;
const { formatJoinedRow, formatJoinedFocusRow, JOINED_PROFIT_COLS, JOINED_FOCUS_COLS } =
  require(path.join(__dirname, "..", "js", "render-joined-summary.js"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
  jbOpenDetailRows.clear();
}

const boardRow = {
  category: "Crafting", tableId: "crafting-table",
  itemName: "Grandmaster's Bag", buyCity: "Lymhurst", sellCity: "Martlock",
  routeLabel: "Craft: Lymhurst → Sell: Martlock",
  inputCost: 3000, sellPrice: 5000, marginPct: 30, pureProfit: 1500,
  dailyVol: 5, volIsUnknown: false, throughput: 7500, note: "",
  rowKey: "crafting-table|T6_BAG", hasOverride: false,
  sellItemId: "T6_BAG", sellQuality: null, sellSideOverride: false,
  focusCost: 500, profitPer10kFocus: 30000,
};

const tdCount = (html) => (html.match(/<td/gi) || []).length;
const trCount = (html) => (html.match(/<tr/gi) || []).length;

console.log("\n=== column counts are unchanged while collapsed ===");

test("the profit board still emits exactly 10 columns and one <tr>", () => {
  const html = formatJoinedRow(boardRow, 0);
  assert.strictEqual(tdCount(html), 10, `got ${tdCount(html)}`);
  assert.strictEqual(trCount(html), 1, "a collapsed row must not emit a panel row");
});

test("the focus board still emits exactly 11 columns and one <tr>", () => {
  const html = formatJoinedFocusRow(boardRow, 0);
  assert.strictEqual(tdCount(html), 11, `got ${tdCount(html)}`);
  assert.strictEqual(trCount(html), 1);
});

test("the column-count constants match the <thead> in index.html", () => {
  assert.strictEqual(JOINED_PROFIT_COLS, 10);
  assert.strictEqual(JOINED_FOCUS_COLS, 11);
});

console.log("\n=== the toggle ===");

test("every board row carries a detail toggle", () => {
  assert.ok(formatJoinedRow(boardRow, 0).includes("data-detail-toggle="));
  assert.ok(formatJoinedFocusRow(boardRow, 0).includes("data-detail-toggle="));
});

test("the toggle reads ▸ when closed and ▾ when open", () => {
  const key = jbDetailKey("joined-summary-table", boardRow);
  assert.ok(jbDetailToggle(key).includes("▸"));
  jbOpenDetailRows.add(key);
  assert.ok(jbDetailToggle(key).includes("▾"));
});

test("the two boards key their open state separately", () => {
  const a = jbDetailKey("joined-summary-table", boardRow);
  const b = jbDetailKey("joined-focus-table", boardRow);
  assert.notStrictEqual(a, b, "expanding a row on one board must not expand it on the other");
});

test("a row with no rowKey still gets a stable key", () => {
  const keyless = { ...boardRow, rowKey: "" };
  const key = jbDetailKey("joined-summary-table", keyless);
  assert.ok(key.includes(keyless.itemName) || key.includes(keyless.routeLabel),
    "faction-spending rows have an empty getRowKey — fall back to name+route");
});

console.log("\n=== the expanded panel row ===");

test("expanding appends a second <tr> with the board's full colspan", () => {
  jbOpenDetailRows.add(jbDetailKey("joined-summary-table", boardRow));
  const html = formatJoinedRow(boardRow, 0);
  // Three <tr> in total: the board row, the panel row, and — nested inside the
  // panel's own <table> — the grafted feeder row. Only ONE of them is the panel.
  assert.strictEqual(trCount(html), 3, "board row + panel row + the grafted source row");
  assert.strictEqual((html.match(/<tr class="jb-detail-row"/g) || []).length, 1);
  assert.ok(html.includes('colspan="10"'), "profit board spans 10");
});

test("the focus board's panel row spans 11", () => {
  jbOpenDetailRows.add(jbDetailKey("joined-focus-table", boardRow));
  const html = formatJoinedFocusRow(boardRow, 0);
  assert.ok(html.includes('colspan="11"'));
});

test("the panel row carries data-detail-for and NO data-row-key of its own", () => {
  const key = jbDetailKey("joined-summary-table", boardRow);
  jbOpenDetailRows.add(key);
  const html = jbDetailRowHtml(boardRow, key, 10);
  const panelTr = /<tr class="jb-detail-row"[^>]*>/.exec(html);
  assert.ok(panelTr, "expected the panel <tr>");
  assert.ok(panelTr[0].includes("data-detail-for="));
  assert.ok(!panelTr[0].includes("data-row-key"),
    "a duplicate row key would break sort anchoring and the table filters");
});

test("a closed row renders no panel at all", () => {
  const key = jbDetailKey("joined-summary-table", boardRow);
  assert.strictEqual(jbDetailRowHtml(boardRow, key, 10), "");
});

console.log("\n=== the graft ===");

test("the panel contains the SOURCE table's own rendered row", () => {
  formatterCalls = [];
  const key = jbDetailKey("joined-summary-table", boardRow);
  jbOpenDetailRows.add(key);
  const html = jbDetailRowHtml(boardRow, key, 10);
  assert.strictEqual(formatterCalls.length, 1, "the feeder's formatter must be the source of truth");
  assert.strictEqual(formatterCalls[0].row.item.id, "T6_BAG", "wrong source row grafted");
  assert.ok(html.includes("T6_BAG"));
});

test("the source row's editable material price survives the graft", () => {
  const key = jbDetailKey("joined-summary-table", boardRow);
  jbOpenDetailRows.add(key);
  const html = jbDetailRowHtml(boardRow, key, 10);
  assert.ok(html.includes('data-item-id="T6_PLANKS"'), "the per-unit editor must come along");
  assert.ok(html.includes("price-editable"));
});

test("the grafted row is nested in its own table, not spliced into the board", () => {
  const key = jbDetailKey("joined-summary-table", boardRow);
  jbOpenDetailRows.add(key);
  const html = jbDetailRowHtml(boardRow, key, 10);
  assert.ok(/<table[^>]*class="[^"]*jb-detail-inner/.test(html),
    "nesting is what keeps the grafted cells out of the board's own row iteration");
});

test("the right row is picked when the feeder holds several", () => {
  formatterCalls = [];
  const other = { ...boardRow, rowKey: "crafting-table|T7_BAG", sellItemId: "T7_BAG" };
  const key = jbDetailKey("joined-summary-table", other);
  jbOpenDetailRows.add(key);
  jbDetailRowHtml(other, key, 10);
  assert.strictEqual(formatterCalls[0].row.item.id, "T7_BAG");
  assert.strictEqual(formatterCalls[0].idx, 1, "the formatter needs the row's real index");
});

test("an unresolvable row key falls back to a message, and does not throw", () => {
  const gone = { ...boardRow, rowKey: "crafting-table|T8_VANISHED" };
  const key = jbDetailKey("joined-summary-table", gone);
  jbOpenDetailRows.add(key);
  const html = jbDetailRowHtml(gone, key, 10);
  assert.ok(html.includes("jb-detail-row"), "still emit the row so the toggle state reads true");
  assert.ok(/no longer/i.test(html), "expected an explicit fallback message");
});

test("a formatter that throws is contained", () => {
  const boom = { ...boardRow };
  globalThis.tableState["crafting-table"].formatter = () => { throw new Error("boom"); };
  const key = jbDetailKey("joined-summary-table", boom);
  jbOpenDetailRows.add(key);
  const html = jbDetailRowHtml(boom, key, 10);
  assert.ok(html.includes("jb-detail-row"));
  globalThis.tableState["crafting-table"].formatter = sourceFormatter;
});

console.log("\n=== stale / empty feeder cache ===");

test("an empty feeder cache is force-rendered before the graft", () => {
  installState({ populated: false });
  const key = jbDetailKey("joined-summary-table", boardRow);
  jbOpenDetailRows.add(key);
  jbDetailRowHtml(boardRow, key, 10);
  assert.strictEqual(renderCount, 1, "an expanded panel must not show an empty source");
  installState();
});

test("a deferred (stale) feeder cache is recomputed before the graft", () => {
  installState({ populated: true, deferred: true });
  const key = jbDetailKey("joined-summary-table", boardRow);
  jbOpenDetailRows.add(key);
  jbDetailRowHtml(boardRow, key, 10);
  assert.strictEqual(renderCount, 1, "a stale cache replays pre-edit numbers");
  installState();
});

test("a fresh, populated cache is NOT re-rendered", () => {
  installState();
  const key = jbDetailKey("joined-summary-table", boardRow);
  jbOpenDetailRows.add(key);
  jbDetailRowHtml(boardRow, key, 10);
  assert.strictEqual(renderCount, 0, "the boards already run after every feeder");
});

test("rerolling is left alone without a quality-aware scan", () => {
  installState({ populated: false });
  globalThis.tableState["rerolling-table"] = { data: [], formatter: sourceFormatter };
  globalThis.lastQualityMarketData = null;
  const rr = { ...boardRow, tableId: "rerolling-table" };
  const key = jbDetailKey("joined-summary-table", rr);
  jbOpenDetailRows.add(key);
  const html = jbDetailRowHtml(rr, key, 10);
  assert.ok(html.includes("jb-detail-row"), "still emits a row, just an empty one");
  installState();
});

console.log("\n=== open state survives a redraw ===");

test("open state lives in a Set, not the DOM", () => {
  const key = jbDetailKey("joined-summary-table", boardRow);
  jbOpenDetailRows.add(key);
  // A full renderAllTables wipes tbody.innerHTML; re-running the formatter is
  // all that happens, and the row must come back expanded.
  const first = formatJoinedRow(boardRow, 0);
  const second = formatJoinedRow(boardRow, 0);
  assert.ok(first.includes("jb-detail-row"));
  assert.ok(second.includes("jb-detail-row"), "the panel must survive the redraw");
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
