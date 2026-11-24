/**
 * The search box's Enter-fetch reports itself on the numbers.
 *
 * Pressing Enter in a table's search box fetches only the matched items
 * (js/table-search-fetch.js searchFetchForTable) and then calls that table's
 * renderer DIRECTLY — it never goes through the re-render scheduler, so
 * onPassStart never fires and the recalculation overlay
 * (js/recalc-cell-mark.js) that every other price change raises were missing
 * here. The only report was the global #loading-overlay span, which lives in
 * the page header beside the Language select: invisible to anyone scrolled down
 * to the table they just searched. A press looked exactly like nothing
 * happening.
 *
 * Two of these are source assertions, like tests/scan-recalc-mark.test.cjs: the
 * handler closes over a live document and there is nothing to import. What is
 * pinned is the ORDER — mark before the fetch, clear where the rows are drawn —
 * because getting either end wrong is invisible in review and obvious on screen.
 * The table map is exported, so that half is tested as a function.
 *
 * Run: node tests/search-fetch-recalc-mark.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { readIndexHtml, readStyles } = require("./helpers/page-source.cjs");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const src = read("js/table-search-fetch.js");
const css = readStyles();
const indexHtml = readIndexHtml();

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

/** The source between two anchors, so an assertion cannot match a distant file. */
function block(s, from, to) {
  const start = s.indexOf(from);
  assert.ok(start >= 0, `missing anchor: ${from}`);
  const end = s.indexOf(to, start);
  return s.slice(start, end > start ? end : undefined);
}

const handler = block(src, "async function searchFetchForTable(", "\n  if (typeof window");

// ── the order, which is the whole feature ──────────────────────────────────

test("the mark goes up before the fetch, not after it", () => {
  const mark = handler.indexOf("beginSearchMark(tableId)");
  const fetchCall = handler.indexOf("await fetcher.fetch(");
  assert.ok(mark > 0, "the press marks its table");
  assert.ok(mark < fetchCall, "and does it before the wait it is reporting");
});

test("the mark comes down where the rows are drawn", () => {
  const render = handler.indexOf("render();");
  const clear = handler.indexOf("endSearchMark();", render);
  const notice = handler.indexOf("unpricedVisibleRows(");
  assert.ok(clear > render, "cleared after the draw");
  assert.ok(clear < notice,
    "and BEFORE the unpriced-rows count — fresh numbers must not spin while it runs");
});

test("a failed fetch does not leave the table spinning", () => {
  const caught = handler.slice(handler.indexOf("} catch (e) {"));
  assert.ok(caught.indexOf("endSearchMark();") < caught.indexOf("[search-fetch] failed"),
    "the catch clears too, before it reports");
});

test("the finally never clears: a superseding pass owns the marks by then", () => {
  const fin = handler.slice(handler.indexOf("} finally {"));
  assert.ok(!fin.includes("endSearchMark("), "no clear after the notice work");
  assert.match(fin, /searchFetching = false/, "it still releases the reentrancy flag");
});

test("the marks are the scan buttons' own, looked up at press time", () => {
  assert.match(src, /typeof beginScanMark === "function"/,
    "no script-order coupling, and Node sees no global");
  assert.match(src, /typeof endScanMark === "function"/);
});

// ── every table the press redraws is marked ────────────────────────────────

const { searchMarkTables, SEARCH_FETCH_MARK_TABLES } = (() => {
  // The module requires ./table-search.js and reads catalogs off globalThis; a
  // bare require is enough for the two pure exports this file needs.
  return require("../js/table-search-fetch.js");
})();

[
  ["crafting-table", ["crafting-table"]],
  ["craft-planner-table", ["craft-planner-table"]],
  ["volume-table", ["volume-table"]],
  // Two tables, matching tableRenderers(): Faction Spending redraws Mounts
  // first so the breed lookup is fresh, Gathering redraws Journal Filling.
  ["faction-spending-table", ["mounts-table", "faction-spending-table"]],
  ["gathering-table", ["gathering-table", "journal-filling-table"]],
].forEach(([tableId, expected]) => {
  test(`${tableId} marks every table its render draws`, () => {
    assert.deepStrictEqual(searchMarkTables(tableId), expected);
  });
});

test("an unknown table marks itself and nothing else", () => {
  assert.deepStrictEqual(searchMarkTables("no-such-table"), ["no-such-table"]);
  assert.ok(!("crafting-table" in SEARCH_FETCH_MARK_TABLES),
    "only the multi-table renderers need an entry");
});

test("the two-table entries match the renderers that draw two tables", () => {
  const renderers = block(src, "function tableRenderers()", "// tableId → the full id universe");
  Object.entries(SEARCH_FETCH_MARK_TABLES).forEach(([tableId, ids]) => {
    const entry = block(renderers, `"${tableId}": () => {`, "},");
    ids.forEach((id) => {
      const fn = id.replace(/-table$/, "").split("-")
        .map((w) => w[0].toUpperCase() + w.slice(1)).join("");
      assert.ok(entry.includes(`render${fn}Table(`),
        `${tableId}'s renderer should draw ${id}`);
    });
  });
});

// ── the status line the user can actually see ──────────────────────────────

test("the status span is per table and sits next to the search box", () => {
  const el = block(src, "function searchFetchStatusEl(", "\n  // Enter handler");
  assert.match(el, /search-fetch-status-\$\{tableId\}/, "one span per table");
  assert.match(el, /searchInputId\(tableId\)/, "found from the table's own input");
  assert.match(el, /insertBefore\(el, input\.nextSibling\)/, "placed right after it");
});

test("it says what is being fetched, and stops saying it afterwards", () => {
  assert.ok(handler.indexOf("status.textContent = fetchingText") <
    handler.indexOf("beginSearchMark(tableId)"), "set before the fetch starts");
  const fin = handler.slice(handler.indexOf("} finally {"));
  assert.match(fin, /status\.textContent = ""/, "and emptied on the way out");
});

test("the same text still reaches the header overlay", () => {
  assert.match(handler, /overlay\.textContent = fetchingText/,
    "#loading-overlay is kept: js/api.js uses it too");
  assert.ok(indexHtml.includes('id="loading-overlay"'));
});

test("the style is there, hides when empty, and respects reduced motion", () => {
  assert.match(css, /\.search-fetch-status \{/);
  assert.match(css, /\.search-fetch-status:empty \{\s*display: none;/);
  assert.match(css, /\.search-fetch-status::after \{[\s\S]*?animation: app-loader-spin/);
  const reduced = block(css, "@media (prefers-reduced-motion: reduce) {", "\n}");
  assert.ok(reduced.includes(".search-fetch-status::after"),
    "the ring stops with the other spinners");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
