/**
 * Tests for the centered recalculation overlay (js/recalc-cell-mark.js).
 *
 * One spinner replaces the old per-cell rings while a re-render pass runs.
 *
 * ── CONTRACT FOR THE IMPLEMENTER ───────────────────────────────────────────
 *   • Element: `#recalc-overlay`, created lazily by JS (never in index.html),
 *     appended ONCE to `document.body`; repeated begin/clear reuses it.
 *   • Created via doc.createElement(...) and appended with body.appendChild(el)
 *     (or body.append(el)); looked up with doc.getElementById("recalc-overlay").
 *   • VISIBILITY = the CSS class `is-visible` on the element.
 *       shown  -> el.classList.contains("is-visible") === true
 *       hidden -> class absent (the default state; also what a freshly built
 *                 element has). The `hidden` attribute is NOT used, so the CSS
 *                 can fade in/out.
 *   • a11y: attribute role="status" and aria-live="polite" (via setAttribute).
 *   • Factory: createRecalcCellMark({ doc, setTimer, clearTimer }) keeps its
 *     shape and returns { begin, tableDone, clear, state }.
 *       begin({tableIds, itemIds, delayMs}) — >=1 table id: after delayMs
 *         (default RECALC_MARK_DELAY_MS = 100) add `is-visible`. No table ids:
 *         same as clear(). A begin while visible keeps it visible (no
 *         remove/add of the class, no new timer).
 *       tableDone(id) — bookkeeping only, never hides the overlay.
 *       clear() — cancel the timer, drop `is-visible`. Idempotent.
 *       state() — { visible: boolean, waiting: boolean }.
 *   • css/styles.css: `#recalc-overlay` rule has `position: fixed` and
 *     `pointer-events: none`; `#recalc-overlay.is-visible` rule exists.
 *   • No table cell/row ever receives a class or attribute.
 *
 * Black-box: fake document/body, injected timers. No DOM, no browser.
 *
 * Run: node tests/recalc-overlay.test.cjs
 */

const assert = require("assert");
const { readIndexHtml, readStyles } = require("./helpers/page-source.cjs");
const {
  RECALC_MARK_DELAY_MS,
  createRecalcCellMark,
} = require("../js/recalc-cell-mark.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

const VISIBLE = "is-visible";
const OVERLAY_ID = "recalc-overlay";

// ── fake document ──────────────────────────────────────────────────────────

function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    id: "",
    children: [],
    parent: null,
    attrs: {},
    classes: new Set(),
    classLog: [], // every class mutation, in order: "+name" / "-name"
    textContent: "",
    innerHTML: "",
  };
  el.classList = {
    add: (...cs) => cs.forEach((c) => { el.classes.add(c); el.classLog.push("+" + c); }),
    remove: (...cs) => cs.forEach((c) => { el.classes.delete(c); el.classLog.push("-" + c); }),
    contains: (c) => el.classes.has(c),
    toggle: (c, force) => {
      const on = force === undefined ? !el.classes.has(c) : !!force;
      if (on) el.classList.add(c); else el.classList.remove(c);
      return on;
    },
  };
  el.setAttribute = (n, v) => { el.attrs[n] = String(v); };
  el.getAttribute = (n) => (n in el.attrs ? el.attrs[n] : null);
  el.hasAttribute = (n) => n in el.attrs;
  el.removeAttribute = (n) => { delete el.attrs[n]; };
  el.append = (c) => { c.parent = el; el.children.push(c); return c; };
  el.appendChild = el.append;
  el.getBoundingClientRect = () => ({ top: 0, bottom: 10, width: 10, height: 10 });
  return el;
}

function makeDoc() {
  const doc = {
    body: makeEl("body"),
    created: [],
    createElement: (tag) => { const e = makeEl(tag); doc.created.push(e); return e; },
    getElementById: (id) => {
      const walk = (n) => {
        for (const c of n.children) {
          if (c.id === id) return c;
          const hit = walk(c);
          if (hit) return hit;
        }
        return null;
      };
      return walk(doc.body);
    },
    querySelectorAll: () => [],
  };
  return doc;
}

function makeClock() {
  let queue = [];
  let seq = 0;
  const clock = {
    timers: [],
    setTimer: (fn, ms) => { const id = ++seq; queue.push({ id, fn, ms }); clock.timers.push(ms); return id; },
    clearTimer: (id) => { queue = queue.filter((t) => t.id !== id); },
    fire: () => { const due = queue; queue = []; due.forEach((t) => t.fn()); },
    pendingCount: () => queue.length,
  };
  return clock;
}

/** Fake page: a few table cells that must never be touched. */
function setup(tableIds = ["flipping-table", "crafting-table"]) {
  const doc = makeDoc();
  const clock = makeClock();
  const cells = [];
  tableIds.forEach((id) => {
    const table = makeEl("table");
    table.id = id;
    const tr = makeEl("tr");
    const td = makeEl("td");
    td.classes.add("silver-val");
    tr.append(td);
    table.append(tr);
    doc.body.append(table);
    cells.push(table, tr, td);
  });
  const mark = createRecalcCellMark({ doc, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  const overlay = () => doc.getElementById(OVERLAY_ID);
  const shown = () => { const o = overlay(); return !!o && o.classList.contains(VISIBLE); };
  const overlayCount = () => doc.body.children.filter((c) => c.id === OVERLAY_ID).length;
  return { doc, clock, mark, cells, overlay, shown, overlayCount };
}

// ── delay: shown after, not before ─────────────────────────────────────────

[
  ["delay 100", 100],
  ["delay 0 (scans)", 0],
  ["delay 250", 250],
].forEach(([label, delayMs]) => {
  test(`${label}: shown only after the timer fires`, () => {
    const { clock, mark, shown } = setup();
    mark.begin({ tableIds: ["flipping-table"], delayMs });
    if (delayMs > 0) {
      assert.strictEqual(shown(), false, "hidden before the delay");
      assert.strictEqual(mark.state().visible, false);
      assert.strictEqual(mark.state().waiting, true);
    }
    assert.ok(clock.timers.includes(delayMs), `timer armed with ${delayMs}ms`);
    clock.fire();
    assert.strictEqual(shown(), true, "visible after the delay");
    assert.strictEqual(mark.state().visible, true);
    assert.strictEqual(mark.state().waiting, false);
  });
});

test("default delay is the 100 ms anti-flash window", () => {
  assert.strictEqual(RECALC_MARK_DELAY_MS, 100);
  const { clock, mark } = setup();
  mark.begin({ tableIds: ["flipping-table"] });
  assert.ok(clock.timers.includes(RECALC_MARK_DELAY_MS));
});

test("a pass that ends inside the delay never shows anything", () => {
  const { clock, mark, shown, overlay } = setup();
  mark.begin({ tableIds: ["flipping-table"], delayMs: 100 });
  mark.clear();
  clock.fire();
  assert.strictEqual(shown(), false);
  assert.strictEqual(clock.pendingCount(), 0, "timer cancelled, not left to fire");
  const o = overlay();
  assert.ok(!o || !o.classLog.includes("+" + VISIBLE), "is-visible was never added");
});

test("nothing is in the document before any pass (boot shows no overlay)", () => {
  const { overlay, overlayCount } = setup();
  assert.strictEqual(overlay(), null);
  assert.strictEqual(overlayCount(), 0);
});

test("the overlay is never declared in index.html", () => {
  const html = readIndexHtml();
  assert.ok(!html.includes(OVERLAY_ID), "created lazily by JS only");
});

// ── clear / idempotence ────────────────────────────────────────────────────

test("clear hides a visible overlay and cancels any timer", () => {
  const { clock, mark, shown } = setup();
  mark.begin({ tableIds: ["flipping-table"], delayMs: 0 });
  clock.fire();
  assert.strictEqual(shown(), true);
  mark.clear();
  assert.strictEqual(shown(), false);
  assert.strictEqual(mark.state().visible, false);
  assert.strictEqual(mark.state().waiting, false);
  assert.strictEqual(clock.pendingCount(), 0);
});

test("clear is idempotent, also when nothing was ever begun", () => {
  const { mark, shown } = setup();
  mark.clear();
  mark.clear();
  assert.strictEqual(shown(), false);
  assert.strictEqual(mark.state().visible, false);
});

// ── tableDone is bookkeeping only ──────────────────────────────────────────

[
  ["one of two tables done", ["flipping-table"]],
  ["every table done", ["flipping-table", "crafting-table"]],
  ["a table the pass never planned", ["not-a-table"]],
].forEach(([label, done]) => {
  test(`tableDone (${label}): overlay stays until clear`, () => {
    const { clock, mark, shown } = setup();
    mark.begin({ tableIds: ["flipping-table", "crafting-table"], delayMs: 0 });
    clock.fire();
    done.forEach((id) => mark.tableDone(id));
    assert.strictEqual(shown(), true, "still shown after tableDone");
    mark.clear();
    assert.strictEqual(shown(), false, "gone after clear");
  });
});

test("tableDone before the delay does not cancel the pending show", () => {
  const { clock, mark, shown } = setup();
  mark.begin({ tableIds: ["flipping-table", "crafting-table"], delayMs: 100 });
  mark.tableDone("flipping-table");
  mark.tableDone("crafting-table");
  clock.fire();
  assert.strictEqual(shown(), true, "pass not over: clear was not called");
});

// ── supersede ──────────────────────────────────────────────────────────────

[
  ["same tables", ["flipping-table"]],
  ["wider tables", ["flipping-table", "crafting-table"]],
  ["narrower tables", ["crafting-table"]],
].forEach(([label, ids]) => {
  test(`supersede while shown (${label}): stays shown, no hide/show flicker`, () => {
    const { clock, mark, shown, overlay } = setup();
    mark.begin({ tableIds: ["flipping-table", "crafting-table"], delayMs: 100 });
    clock.fire();
    const before = overlay().classLog.slice();
    mark.begin({ tableIds: ids, delayMs: 100 });
    assert.strictEqual(shown(), true, "visible immediately after supersede");
    assert.strictEqual(clock.pendingCount(), 0, "no second countdown");
    assert.deepStrictEqual(overlay().classLog, before, "no class removed or re-added");
    assert.strictEqual(mark.state().visible, true);
  });
});

test("supersede while still waiting: one timer, shown once", () => {
  const { clock, mark, shown } = setup();
  mark.begin({ tableIds: ["flipping-table"], delayMs: 100 });
  mark.begin({ tableIds: ["crafting-table"], delayMs: 100 });
  assert.strictEqual(clock.pendingCount(), 1, "the first timer was replaced");
  assert.strictEqual(shown(), false);
  clock.fire();
  assert.strictEqual(shown(), true);
});

// ── empty tableIds ─────────────────────────────────────────────────────────

[
  ["empty tableIds from idle", false],
  ["empty tableIds while shown", true],
].forEach(([label, startShown]) => {
  test(`${label}: hidden and no timer`, () => {
    const { clock, mark, shown } = setup();
    if (startShown) { mark.begin({ tableIds: ["flipping-table"], delayMs: 0 }); clock.fire(); }
    mark.begin({ tableIds: [] });
    clock.fire();
    assert.strictEqual(shown(), false);
    assert.strictEqual(mark.state().waiting, false);
    assert.strictEqual(mark.state().visible, false);
    assert.strictEqual(clock.pendingCount(), 0);
  });
});

test("begin with no options at all behaves as clear", () => {
  const { clock, mark, shown } = setup();
  mark.begin({ tableIds: ["flipping-table"], delayMs: 0 });
  clock.fire();
  mark.begin();
  assert.strictEqual(shown(), false);
});

// ── element shape ──────────────────────────────────────────────────────────

test("overlay is #recalc-overlay directly under body, with role=status", () => {
  const { doc, clock, mark, overlay } = setup();
  mark.begin({ tableIds: ["flipping-table"], delayMs: 0 });
  clock.fire();
  const o = overlay();
  assert.ok(o, "element exists");
  assert.strictEqual(o.id, OVERLAY_ID);
  assert.strictEqual(o.parent, doc.body, "child of document.body");
  assert.strictEqual(o.getAttribute("role"), "status");
  assert.strictEqual(o.getAttribute("aria-live"), "polite");
});

test("the overlay does not use the hidden attribute for visibility", () => {
  const { clock, mark, overlay } = setup();
  mark.begin({ tableIds: ["flipping-table"], delayMs: 0 });
  clock.fire();
  assert.strictEqual(overlay().hasAttribute("hidden"), false);
  mark.clear();
  assert.strictEqual(overlay().hasAttribute("hidden"), false);
});

[1, 2, 5, 20].forEach((n) => {
  test(`${n}x begin/clear cycles keep exactly ONE overlay element`, () => {
    const { clock, mark, overlayCount, doc } = setup();
    for (let i = 0; i < n; i++) {
      mark.begin({ tableIds: ["flipping-table"], delayMs: 0 });
      clock.fire();
      mark.clear();
    }
    mark.begin({ tableIds: ["flipping-table"], delayMs: 0 });
    clock.fire();
    assert.strictEqual(overlayCount(), 1);
    assert.strictEqual(doc.created.filter((e) => e.id === OVERLAY_ID).length, 1, "created once, reused");
  });
});

// ── no per-cell marking ────────────────────────────────────────────────────

[
  ["unscoped pass", {}],
  ["item-scoped pass", { itemIds: ["T4_BAG"] }],
  ["craft list pass", { tableIds: ["craft-list-table"] }],
].forEach(([label, extra]) => {
  test(`${label}: no table, row or cell is ever touched`, () => {
    const { clock, mark, cells } = setup(["flipping-table", "crafting-table", "craft-list-table"]);
    mark.begin({ tableIds: ["flipping-table", "crafting-table"], delayMs: 0, ...extra });
    clock.fire();
    mark.tableDone("flipping-table");
    mark.clear();
    cells.forEach((el) => {
      const cls = el.tagName === "TD" ? ["silver-val"] : [];
      assert.deepStrictEqual(el.classLog, [], `${el.tagName} classList never mutated`);
      assert.deepStrictEqual([...el.classes], cls, `${el.tagName} classes unchanged`);
      assert.deepStrictEqual(el.attrs, {}, `${el.tagName} attributes unchanged`);
    });
  });
});

// ── stylesheet contract ────────────────────────────────────────────────────

function ruleBlocks(css, selector) {
  const out = [];
  const esc = selector.replace(/[.#]/g, "\\$&");
  const re = new RegExp(`(^|[},\\s])${esc}\\s*(?:[,{])`, "g");
  let m;
  while ((m = re.exec(css))) {
    const open = css.indexOf("{", m.index);
    const close = css.indexOf("}", open);
    if (open > -1 && close > open) out.push(css.slice(open + 1, close));
  }
  return out;
}

test("css: #recalc-overlay is position:fixed and pointer-events:none", () => {
  const css = readStyles();
  const body = ruleBlocks(css, "#recalc-overlay").join("\n");
  assert.ok(body, "a #recalc-overlay rule exists");
  assert.match(body, /position:\s*fixed\s*;/);
  assert.match(body, /pointer-events:\s*none\s*;/);
});

test("css: overlay is shown by an .is-visible rule", () => {
  const css = readStyles();
  assert.ok(/#recalc-overlay\.is-visible/.test(css), "an is-visible rule exists");
});

test("css: the old per-cell ring is gone", () => {
  const css = readStyles();
  assert.ok(!css.includes(".recalc-pending"), "no .recalc-pending rules left");
});

test("page loads the module", () => {
  const html = readIndexHtml();
  assert.ok(html.includes('src="js/recalc-cell-mark.js"'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
