/**
 * My Crafting List — "Profit / 10k Focus" re-based on the planned quantity
 * (js/craft-list-per10k.js).
 *
 * In its own table that column is marginal: one full focus bar, nothing else.
 * In the list the row also has a quantity, so the cell reads
 *
 *     Total Profit (qty × unit profit)  +  one full 10,000-focus bar
 *
 * Black box: feed a fake <thead> and a fake <tr>, read the cell back. No market
 * data, no source table, no browser.
 *
 * Run: node tests/craft-list-per10k-total.test.cjs
 */
const assert = require("assert");
const path = require("path");

const MOD = path.join(__dirname, "..", "js", "craft-list-per10k.js");

globalThis.tx = (en) => en;
globalThis.formatSilver = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");

/** A fake <td> with the handful of methods the patcher touches. */
function td(text) {
  return {
    textContent: text || "",
    className: "silver-val",
    attrs: {},
    classList: { add(c) { this.owner.className += ` ${c}`; } },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
  };
}
function row(cells) {
  cells.forEach((c) => { c.classList.owner = c; });
  return {
    cells,
    querySelectorAll(sel) { return sel === "td" ? cells : []; },
    querySelector(sel) {
      const want = sel.replace(/^\./, "");
      return cells.find((c) => String(c.className).split(/\s+/).includes(want)) || null;
    },
  };
}
/** `sorts` is the source thead's data-sort values, in order. */
function withHead(sorts) {
  globalThis.document = {
    querySelectorAll(sel) {
      if (!/^#[\w-]+ thead th$/.test(sel)) return [];
      return sorts.map((s) => ({ getAttribute: (a) => (a === "data-sort" ? s : null) }));
    },
  };
}

const {
  combinedPer10k, per10kColumnIndex, patchPer10kCell, refreshPer10kCell, CL_PER10K_ATTR,
} = require(MOD);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

// ── the pure sum ────────────────────────────────────────────────────────────

const SUMS = [
  { name: "the screenshot row", base: 4192063, profit: 12927886, parked: false, want: 17119949 },
  { name: "a parked row adds nothing", base: 4192063, profit: 12927886, parked: true, want: 4192063 },
  { name: "a loss-making plan subtracts", base: 1000, profit: -4000, parked: false, want: -3000 },
  { name: "no planned profit is just the bar", base: 4192063, profit: 0, parked: false, want: 4192063 },
  { name: "a missing profit is treated as none", base: 500, profit: null, parked: false, want: 500 },
  { name: "no base at all means no number", base: null, profit: 900, parked: false, want: null },
  { name: "an undefined base means no number", base: undefined, profit: 900, parked: false, want: null },
  { name: "a non-numeric base means no number", base: "—", profit: 900, parked: false, want: null },
  { name: "a zero base is still a number", base: 0, profit: 900, parked: false, want: 900 },
];
SUMS.forEach((c) => test(`combinedPer10k: ${c.name}`, () => {
  assert.strictEqual(combinedPer10k(c.base, c.profit, c.parked), c.want);
}));

// ── locating the column ─────────────────────────────────────────────────────

const COLS = [
  { name: "found among the source columns", sorts: ["", "name", "profit", "profitPer10kFocus"], want: 3 },
  { name: "absent from a table without it", sorts: ["", "name", "profit"], want: -1 },
  { name: "the gathered variant is NOT this column", sorts: ["", "profitGatheredPer10kFocus"], want: -1 },
  { name: "the faction FP variant is NOT this column", sorts: ["", "fpFocusPer10k"], want: -1 },
];
COLS.forEach((c) => test(`per10kColumnIndex: ${c.name}`, () => {
  withHead(c.sorts);
  assert.strictEqual(per10kColumnIndex("any-table"), c.want);
}));

test("per10kColumnIndex is -1 with no document at all", () => {
  const saved = globalThis.document;
  delete globalThis.document;
  assert.strictEqual(per10kColumnIndex("any-table"), -1);
  globalThis.document = saved;
});

// ── patching the cell ───────────────────────────────────────────────────────

function plannedRow() {
  withHead(["", "name", "profit", "profitPer10kFocus", "focusMats"]);
  return row([td("+"), td("Moose [T6]"), td("209,603"), td("4,192,063"), td("20x Baby Moose")]);
}

test("the cell reads Total Profit + one focus bar", () => {
  const tr = plannedRow();
  assert.strictEqual(patchPer10kCell(tr, "mounts-table", 4192063, 12927886, false), true);
  assert.strictEqual(tr.cells[3].textContent, "17,119,949");
});

test("a parked row keeps the bare focus-bar number", () => {
  const tr = plannedRow();
  patchPer10kCell(tr, "mounts-table", 4192063, 12927886, true);
  assert.strictEqual(tr.cells[3].textContent, "4,192,063");
});

test("the base is stashed on the cell for the live qty path", () => {
  const tr = plannedRow();
  patchPer10kCell(tr, "mounts-table", 4192063, 12927886, false);
  assert.strictEqual(tr.cells[3].getAttribute(CL_PER10K_ATTR), "4192063");
  assert.ok(String(tr.cells[3].className).includes("cl-p10k"));
});

test("the cell tooltip names both addends", () => {
  const tr = plannedRow();
  patchPer10kCell(tr, "mounts-table", 4192063, 12927886, false);
  const tip = tr.cells[3].getAttribute("title");
  assert.ok(tip.includes("12,927,886"), tip);
  assert.ok(tip.includes("4,192,063"), tip);
});

test("a cached data-tip is dropped so the new tooltip wins", () => {
  const tr = plannedRow();
  tr.cells[3].setAttribute("data-tip", "the old marginal explanation");
  patchPer10kCell(tr, "mounts-table", 4192063, 12927886, false);
  assert.strictEqual(tr.cells[3].getAttribute("data-tip"), null);
});

test("neighbouring cells are left alone", () => {
  const tr = plannedRow();
  patchPer10kCell(tr, "mounts-table", 4192063, 12927886, false);
  assert.strictEqual(tr.cells[2].textContent, "209,603");
  assert.strictEqual(tr.cells[4].textContent, "20x Baby Moose");
});

const NOOPS = [
  {
    name: "a table without the column",
    sorts: ["", "name", "profit"],
    cells: 3, base: 4192063,
  },
  {
    name: "a row whose source has no per-10k number",
    sorts: ["", "name", "profit", "profitPer10kFocus"],
    cells: 4, base: null,
  },
  {
    name: "a formatter that emitted fewer cells than headers",
    sorts: ["", "name", "profit", "profitPer10kFocus"],
    cells: 2, base: 4192063,
  },
];
NOOPS.forEach((c) => test(`no-op: ${c.name}`, () => {
  withHead(c.sorts);
  const cells = Array.from({ length: c.cells }, (_, i) => td(`cell${i}`));
  const tr = row(cells);
  assert.strictEqual(patchPer10kCell(tr, "t", c.base, 12927886, false), false);
  cells.forEach((cell, i) => assert.strictEqual(cell.textContent, `cell${i}`));
}));

// ── the live quantity path ──────────────────────────────────────────────────

test("refresh recomputes from the stashed base", () => {
  const tr = plannedRow();
  patchPer10kCell(tr, "mounts-table", 4192063, 12927886, false);
  assert.strictEqual(refreshPer10kCell(tr, 209603, false), true);
  assert.strictEqual(tr.cells[3].textContent, "4,401,666");
});

test("refresh back to a parked row drops the planned half", () => {
  const tr = plannedRow();
  patchPer10kCell(tr, "mounts-table", 4192063, 12927886, false);
  refreshPer10kCell(tr, 0, true);
  assert.strictEqual(tr.cells[3].textContent, "4,192,063");
});

test("refresh is a no-op on a row that was never patched", () => {
  withHead(["", "name", "profit"]);
  const tr = row([td("+"), td("Moose"), td("209,603")]);
  assert.strictEqual(refreshPer10kCell(tr, 12927886, false), false);
  assert.strictEqual(tr.cells[2].textContent, "209,603");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
