/**
 * A scan reports itself on the numbers, not just on its button.
 *
 * Every other price change in the app goes through the re-render scheduler,
 * which dims and spins the value cells the pass is about to replace
 * (js/recalc-cell-mark.js). The scan paths do not: a per-table button calls its
 * renderer directly (js/scan-handlers.js wrapScanButton) and "Scan Market Now"
 * calls renderAllTables() directly (js/app.js runScan). Both used to report
 * only through the button's own .scanning pulse, which sits in the table header
 * while the user is looking at the profit column — and neither said anything at
 * all during the FETCH, which is the longest part of a scan.
 *
 * These are source assertions, like tests/price-edit-async-rerender.test.cjs's
 * wiring checks: the handlers are built inside a DOMContentLoaded closure over a
 * live document, so there is nothing to import. What is pinned is the ORDER —
 * mark before the fetch, clear when the rows are drawn — because getting either
 * end wrong is invisible in review and obvious on screen.
 *
 * Run: node tests/scan-recalc-mark.test.cjs
 */

const assert = require("assert");
const { appSource } = require("./helpers/app-source.cjs");
const fs = require("fs");
const path = require("path");
const { readIndexHtml } = require("./helpers/page-source.cjs");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const scanHandlers = read("js/scan-handlers.js");
const app = appSource();
const indexHtml = readIndexHtml();

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

/**
 * The source between two anchors, so an assertion cannot match a distant file.
 * A missing end anchor means "to the end" — the last scan button in the file has
 * no blank line after it.
 */
function block(src, from, to) {
  const start = src.indexOf(from);
  assert.ok(start >= 0, `missing anchor: ${from}`);
  const end = src.indexOf(to, start);
  return src.slice(start, end > start ? end : undefined);
}

// ── per-table scan buttons ─────────────────────────────────────────────────

const wrapper = block(scanHandlers, "function wrapScanButton(", "function setupPerTableScanButtons(");

test("the mark goes up before the fetch, not after it", () => {
  const mark = wrapper.indexOf("beginScanMark(tableIds)");
  const fetchCall = wrapper.indexOf("await fetchFn()");
  assert.ok(mark > 0, "the scan marks its table");
  assert.ok(mark < fetchCall, "and does it before the wait it is reporting");
});

test("the mark comes down where the rows are drawn", () => {
  const render = wrapper.indexOf("renderFn();");
  const clear = wrapper.indexOf("endScanMark();", render);
  const hold = wrapper.indexOf("SCAN_MIN_VISIBLE_MS - elapsed");
  assert.ok(clear > render, "cleared after the draw");
  assert.ok(clear < hold,
    "and BEFORE the 700ms min-visible hold — a finally would spin over fresh numbers");
});

test("a failed scan does not leave the table spinning", () => {
  const caught = wrapper.slice(wrapper.indexOf("} catch (e) {"));
  assert.ok(caught.indexOf("endScanMark();") < caught.indexOf("showFetchError"),
    "the catch clears too");
});

test("the delay is skipped: a scan is never the sub-100ms pass it guards against", () => {
  assert.match(scanHandlers, /beginRecalcCellMark\(\{ tableIds, delayMs: 0 \}\)/);
});

test("a scheduler pass that started during the fetch keeps its own marks", () => {
  const end = block(scanHandlers, "function endScanMark(", "function wrapScanButton(");
  assert.match(end, /isRerenderBusy\(\)/, "the scan does not clear another pass's report");
});

// Every button names the table(s) its renderer draws — an unnamed one marks
// nothing and silently goes back to reporting only through its own pulse.
[
  ["scan-rolling-btn", ["rolling-table"]],
  ["scan-crafting-btn", ["crafting-table"]],
  ["scan-craft-planner-btn", ["craft-planner-table"]],
  ["scan-flipping-btn", ["flipping-table"]],
  ["scan-skins-btn", ["skins-trading-table"]],
  ["scan-laborers-btn", ["laborers-table"]],
  ["scan-buildings-btn", ["buildings-table"]],
  ["scan-transport-btn", ["transport-table"]],
  ["scan-consumable-btn", ["consumable-table"]],
  ["scan-mounts-btn", ["mounts-table"]],
  // Two tables: this renderer redraws Mounts first so the breed lookup is fresh.
  ["scan-faction-spending-btn", ["mounts-table", "faction-spending-table"]],
  ["scan-farming-btn", ["farming-table"]],
  // Gathering redraws its Journal Filling companion in the same click.
  ["scan-gathering-btn", ["gathering-table", "journal-filling-table"]],
  ["scan-journals-btn", ["journal-filling-table"]],
  ["scan-transmute-btn", ["transmute-table"]],
  ["scan-enchanting-btn", ["enchanting-table"]],
  ["scan-rerolling-btn", ["rerolling-table"]],
  // The Black Market board owns no catalog: it redraws the feeders its targeted
  // scan touched and then itself. Only the board is MARKED — which feeders are
  // involved is not known until the fetch has run.
  ["scan-bm-board-btn", ["bm-board-table"]],
].forEach(([btnId, ids]) => {
  test(`${btnId} names the table it draws`, () => {
    const call = block(scanHandlers, `wrapScanButton("${btnId}"`, "\n\n");
    ids.forEach((id) => assert.ok(call.includes(`"${id}"`), `${btnId} should mark ${id}`));
  });
});

test("every scan button is wired, none left behind", () => {
  const calls = scanHandlers.match(/wrapScanButton\("/g) || [];
  assert.strictEqual(calls.length, 18, "18 per-table scan buttons");
});

test("Refresh Volume reports on the volume table", () => {
  const vol = block(scanHandlers, 'const volBtn = document.getElementById("scan-volume-btn")',
    "// Volume search box");
  assert.ok(vol.indexOf('beginScanMark(["volume-table"])') < vol.indexOf("await fetchPricesBatch(ids)"),
    "marked before the refetch");
  assert.ok(vol.indexOf("endScanMark();") > vol.indexOf("renderVolumeTable(lastMarketData);"),
    "cleared after the redraw");
});

// ── the full scan ──────────────────────────────────────────────────────────

const runScan = block(app, "const runScan = async () => {", 'scanBtn.addEventListener("click", runScan)');

test("Scan Market Now marks every table before the fetch", () => {
  const mark = runScan.indexOf("beginRecalcCellMark({");
  const fetchCall = runScan.indexOf("fetchPrices(itemsToFetch)");
  assert.ok(mark > 0 && mark < fetchCall, "the whole board is stale for the whole fetch");
  assert.match(runScan, /tableIds: \[\.\.\.RENDER_ORDER, \.\.\.BOARD_TABLES, CRAFT_LIST_TABLE\]/,
    "including the boards and My Crafting List");
  assert.match(runScan, /delayMs: 0/);
});

test("and clears them the moment the tables are drawn", () => {
  const render = runScan.indexOf("renderAllTables(data);");
  const clear = runScan.indexOf("clearRecalcCellMark();", render);
  assert.ok(clear > render && clear < runScan.indexOf("} finally {"),
    "cleared right after the draw, inside the try");
});

test("an empty result or a throw does not leave the app spinning", () => {
  assert.match(runScan, /if \(Object\.keys\(data\)\.length === 0\) \{[\s\S]{0,200}clearRecalcCellMark\(\)/,
    "the no-data early return clears");
  const fin = runScan.slice(runScan.indexOf("} finally {"));
  assert.match(fin, /clearRecalcCellMark\(\)/, "and so does the finally");
  assert.match(fin, /isRerenderBusy\(\)/, "without stealing a live pass's marks");
});

// ── the module is there to be called ───────────────────────────────────────

test("the page loads the mark module before the scripts that call it", () => {
  const markSrc = indexHtml.indexOf('src="js/recalc-cell-mark.js"');
  const scanSrc = indexHtml.indexOf('src="js/scan-handlers.js"');
  const appSrc = indexHtml.indexOf('src="js/app.js"');
  assert.ok(markSrc > 0 && scanSrc > 0 && appSrc > 0, "all three are on the page");
  assert.ok(markSrc < scanSrc && markSrc < appSrc, "and it comes first in document order");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
