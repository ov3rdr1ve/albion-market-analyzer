/**
 * Tests for the recalculation mark's public API (js/recalc-cell-mark.js).
 *
 * The per-cell rings are gone; the mark is now ONE centered overlay (see
 * tests/recalc-overlay.test.cjs for the DOM/CSS contract: `#recalc-overlay`,
 * visible = class `is-visible`). This file covers the API shape, the delay,
 * supersede, clear and the callers' wiring, through the `state()` view only.
 *
 * Black-box: fake document with a body, injected timers.
 *
 * Run: node tests/recalc-cell-mark.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const mod = require("../js/recalc-cell-mark.js");
const { readIndexHtml } = require("./helpers/page-source.cjs");
const { RECALC_MARK_DELAY_MS, createRecalcCellMark } = mod;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

function makeEl(tag) {
  const el = { tagName: String(tag).toUpperCase(), id: "", children: [], parent: null,
    attrs: {}, classes: new Set(), textContent: "", innerHTML: "" };
  el.classList = {
    add: (...c) => c.forEach((x) => el.classes.add(x)),
    remove: (...c) => c.forEach((x) => el.classes.delete(x)),
    contains: (c) => el.classes.has(c),
    toggle: (c, f) => {
      const on = f === undefined ? !el.classes.has(c) : !!f;
      if (on) el.classes.add(c); else el.classes.delete(c);
      return on;
    },
  };
  el.setAttribute = (n, v) => { el.attrs[n] = String(v); };
  el.getAttribute = (n) => (n in el.attrs ? el.attrs[n] : null);
  el.hasAttribute = (n) => n in el.attrs;
  el.append = (c) => { c.parent = el; el.children.push(c); return c; };
  el.appendChild = el.append;
  return el;
}

function makeDoc() {
  const doc = {
    body: makeEl("body"),
    createElement: (t) => makeEl(t),
    getElementById: (id) => doc.body.children.find((c) => c.id === id) || null,
    querySelectorAll: () => [],
  };
  return doc;
}

function makeClock() {
  let queue = [];
  let seq = 0;
  return {
    setTimer: (fn, ms) => { const id = ++seq; queue.push({ id, fn, ms }); return id; },
    clearTimer: (id) => { queue = queue.filter((t) => t.id !== id); },
    fire: () => { const due = queue; queue = []; due.forEach((t) => t.fn()); },
    pendingCount: () => queue.length,
  };
}

function setup() {
  const doc = makeDoc();
  const clock = makeClock();
  const mark = createRecalcCellMark({ doc, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  return { doc, clock, mark };
}

// ── API shape ──────────────────────────────────────────────────────────────

test("the factory returns begin / tableDone / clear / state", () => {
  const { mark } = setup();
  ["begin", "tableDone", "clear", "state"].forEach((k) =>
    assert.strictEqual(typeof mark[k], "function", `${k} is a function`));
});

test("the module exports the delay and the factory", () => {
  assert.strictEqual(RECALC_MARK_DELAY_MS, 100);
  assert.strictEqual(typeof createRecalcCellMark, "function");
});

[
  "RECALC_CELL_CLASS", "RECALC_MAX_MARKS", "RECALC_VIEWPORT_MARGIN", "RECALC_NESTED_TABLE_DEPTH",
  "RECALC_VALUE_CLASSES", "RECALC_UNSCOPED_TABLES", "RECALC_COMPANION_TABLES",
].forEach((k) => {
  test(`the removed cell-mark export ${k} is gone`, () => {
    assert.ok(!(k in mod), `${k} must not be exported any more`);
  });
});

test("idle state: not visible, not waiting", () => {
  const { mark } = setup();
  const s = mark.state();
  assert.strictEqual(s.visible, false);
  assert.strictEqual(s.waiting, false);
});

// ── the delay ──────────────────────────────────────────────────────────────

test("begin waits out the delay, then the overlay is visible", () => {
  const { clock, mark } = setup();
  mark.begin({ tableIds: ["flipping-table"] });
  assert.deepStrictEqual([mark.state().visible, mark.state().waiting], [false, true]);
  clock.fire();
  assert.deepStrictEqual([mark.state().visible, mark.state().waiting], [true, false]);
});

test("a pass that ends inside the delay shows nothing and holds no timer", () => {
  const { clock, mark } = setup();
  mark.begin({ tableIds: ["flipping-table"] });
  mark.clear();
  clock.fire();
  assert.strictEqual(mark.state().visible, false);
  assert.strictEqual(clock.pendingCount(), 0);
});

// ── supersede, clear ───────────────────────────────────────────────────────

test("a superseding pass stays visible with no second countdown", () => {
  const { clock, mark } = setup();
  mark.begin({ tableIds: ["flipping-table"] });
  clock.fire();
  mark.begin({ tableIds: ["flipping-table", "crafting-table"] });
  assert.strictEqual(mark.state().visible, true);
  assert.strictEqual(mark.state().waiting, false);
});

test("a pass with no tables clears and holds no timer", () => {
  const { clock, mark } = setup();
  mark.begin({ tableIds: ["flipping-table"] });
  clock.fire();
  mark.begin({ tableIds: [] });
  assert.deepStrictEqual([mark.state().visible, mark.state().waiting], [false, false]);
});

test("tableDone never ends the pass, clear does", () => {
  const { clock, mark } = setup();
  mark.begin({ tableIds: ["flipping-table"] });
  clock.fire();
  mark.tableDone("flipping-table");
  assert.strictEqual(mark.state().visible, true);
  mark.clear();
  assert.strictEqual(mark.state().visible, false);
});

test("clear is safe twice and when nothing began", () => {
  const { mark } = setup();
  mark.clear();
  mark.clear();
  assert.strictEqual(mark.state().visible, false);
});

// ── wiring ─────────────────────────────────────────────────────────────────

test("the page loads the module, and the pill is gone", () => {
  const html = readIndexHtml();
  assert.ok(html.includes('src="js/recalc-cell-mark.js"'), "the module is in index.html");
  assert.ok(!html.includes("recalc-indicator.js"), "the old pill script is gone");
  assert.ok(!fs.existsSync(path.join(__dirname, "..", "js", "recalc-indicator.js")), "and so is its file");
});

test("the capture still names the items it brought in", () => {
  const monitor = fs.readFileSync(path.join(__dirname, "..", "js", "render-monitor.js"), "utf8");
  assert.match(monitor, /dirtyItemIds\.add\(itemId\)/, "ids accumulate across the burst");
  assert.match(monitor, /scheduleRerender\("captured-prices", \{ itemIds \}\)/);
  assert.match(monitor, /dirtyItemIds = new Set\(\);[\s\S]{0,200}try \{/,
    "and are emptied when the redraw takes them");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
