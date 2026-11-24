/**
 * My Crafting List — column header tooltips (js/render-craft-list-header.js).
 *
 * A list column is CLONED from its source table's <thead>, so it must explain
 * itself the way that table does: the source <th>'s tooltip comes across with
 * the label and the sort key. Two exceptions are asserted here — the list's own
 * Qty / Total Buy Cost / Total Profit columns carry their own text, and
 * "Profit / 10k Focus" carries an OVERRIDE, because in the list that cell means
 * something the source column does not (js/craft-list-per10k.js).
 *
 * Black box: build a fake <thead>, read the emitted header row.
 *
 * Run: node tests/craft-list-header-tips.test.cjs
 */
const assert = require("assert");
const path = require("path");

const HEADER = path.join(__dirname, "..", "js", "render-craft-list-header.js");

// ── the globals the header builder reads at call time ───────────────────────
globalThis._clEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));
globalThis.tx = (en) => en;
globalThis.craftListSortFor = () => ({ sortCol: null, sortDir: "desc" });

/** One fake source header cell. `attrs` is what getAttribute answers with. */
function th(label, attrs) {
  const a = attrs || {};
  return { textContent: label, getAttribute: (name) => (name in a ? a[name] : null) };
}

/** Install a fake document whose #<id> thead th returns `cells`. */
function withHead(cells) {
  globalThis.document = {
    querySelectorAll(sel) {
      return /^#[\w-]+ thead th$/.test(sel) ? cells : [];
    },
  };
}

const { _clHeaderRow } = require(HEADER);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

/** The <th> in `html` whose data-sort is `sort` (or the Nth when sort is a number). */
function thFor(html, sort) {
  const m = new RegExp(`<th[^>]*data-sort="${sort}"[^>]*>`).exec(html);
  return m ? m[0] : "";
}
function titleOf(tag) {
  const m = /title="([^"]*)"/.exec(tag);
  return m ? m[1] : null;
}

// ── cloned columns ──────────────────────────────────────────────────────────

const CLONED = [
  {
    name: "a source title comes across with the column",
    cell: th("Cost", { "data-sort": "cost", title: "What one craft costs" }),
    expect: "What one craft costs",
  },
  {
    name: "a source with no tooltip stays untitled",
    cell: th("Cost", { "data-sort": "cost" }),
    expect: null,
  },
  {
    // js/tooltips.js MIGRATES title -> data-tip on first hover, so a header the
    // user already hovered has no title left to read.
    name: "a migrated data-tip is read when the title is gone",
    cell: th("Cost", { "data-sort": "cost", "data-tip": "What one craft costs" }),
    expect: "What one craft costs",
  },
  {
    name: "title wins when both are present",
    cell: th("Cost", { "data-sort": "cost", title: "live", "data-tip": "cached" }),
    expect: "live",
  },
  {
    name: "an empty source title is not emitted",
    cell: th("Cost", { "data-sort": "cost", title: "" }),
    expect: null,
  },
];

CLONED.forEach((c) => test(c.name, () => {
  withHead([th("+", {}), c.cell]);
  const html = _clHeaderRow("crafting-table");
  assert.strictEqual(titleOf(thFor(html, "cost")), c.expect);
}));

test("a quote in the source tooltip is escaped, not broken out of", () => {
  withHead([th("+", {}), th("Cost", { "data-sort": "cost", title: 'the "cheap" city' })]);
  const html = _clHeaderRow("crafting-table");
  assert.match(html, /title="the &quot;cheap&quot; city"/);
});

// ── the list's own columns ──────────────────────────────────────────────────

[
  ["qty", "Qty"],
  ["clCost", "Total Buy Cost"],
  ["clTotal", "Total Profit"],
].forEach(([sort, label]) => test(`${label} carries its own tooltip`, () => {
  withHead([th("+", {}), th("Cost", { "data-sort": "cost" })]);
  const html = _clHeaderRow("crafting-table");
  const tip = titleOf(thFor(html, sort));
  assert.ok(tip && tip.length > 10, `${label} has no tooltip`);
  assert.match(html, new RegExp(`data-sort="${sort}"[^>]*>${label}</th>`));
}));

// ── the Profit / 10k Focus override ─────────────────────────────────────────

test("Profit / 10k Focus does NOT inherit the source tooltip", () => {
  withHead([
    th("+", {}),
    th("Profit / 10k Focus", {
      "data-sort": "profitPer10kFocus",
      title: "Profit per play x the plays one 10,000-focus bar buys",
    }),
  ]);
  const html = _clHeaderRow("mounts-table");
  const tip = titleOf(thFor(html, "profitPer10kFocus"));
  assert.ok(tip, "no tooltip at all");
  assert.ok(!/Profit per play/.test(tip), "inherited the source tooltip");
  assert.match(tip, /Total Profit/);
});

test("the override is emitted even when the source header has no tooltip", () => {
  withHead([th("+", {}), th("Profit / 10k Focus", { "data-sort": "profitPer10kFocus" })]);
  const tip = titleOf(thFor(_clHeaderRow("mounts-table"), "profitPer10kFocus"));
  assert.match(tip, /10,000-focus bar/);
});

test("a neighbouring focus column keeps ITS own tooltip", () => {
  withHead([
    th("+", {}),
    th("Profit Gathered / 10k Focus", {
      "data-sort": "profitGatheredPer10kFocus",
      title: "Same bar, raws self-gathered",
    }),
  ]);
  const tip = titleOf(thFor(_clHeaderRow("transport-table"), "profitGatheredPer10kFocus"));
  assert.strictEqual(tip, "Same bar, raws self-gathered");
});

test("the source's leading + column is dropped, not titled", () => {
  withHead([th("+", { title: "Add to My Crafting List" }), th("Cost", { "data-sort": "cost" })]);
  const html = _clHeaderRow("crafting-table");
  assert.ok(!/Add to My Crafting List/.test(html), "the + tooltip leaked into the header");
  assert.match(html, /^<tr class="cl-colhead"><th><\/th>/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
