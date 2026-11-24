/**
 * My Crafting List — when a typed quantity is COMMITTED
 * (js/render-craft-list-events.js).
 *
 * Three rules, and they only make sense together:
 *
 *   a plain number commits on every keystroke, which is what makes the totals
 *   track a typed digit;
 *
 *   arithmetic does not — `96+96` passes through `96+` on its way in, and
 *   committing the `96` before it would drop the second stack the moment the
 *   field lost focus. It waits for Enter or blur;
 *
 *   an UNFINISHED expression is refused outright. `96+` reaches the store as an
 *   unreadable quantity, which the store reads as "one of these" — so an Enter
 *   one character early would replace the plan with a 1.
 *
 * Black-box over the module's delegated listeners: the fake document hands the
 * registered handlers back, and the test dispatches the events a browser would.
 *
 * Run: node tests/craft-list-qty-commit.test.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const loadFile = (rel) =>
  fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/if \(typeof module[\s\S]*$/, "");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

// ── the fake page ───────────────────────────────────────────────────────────
//
// Only what the wiring touches: a handler registry, one element lookup, and the
// counters the assertions read.

const sandbox = `
const _handlers = {};
let _refreshes = 0;
const document = {
  readyState: "complete",
  _craftListInit: false,
  addEventListener(type, fn) { (_handlers[type] = _handlers[type] || []).push(fn); },
  getElementById() { return null; },
  querySelectorAll() { return []; },
};
function renderCraftListTable() {}
function _clRefreshTotalsOnly() { _refreshes++; }
function tx(en) { return en; }
`;

const src = sandbox
  + loadFile("js/craft-list-qty-expr.js")
  + loadFile("js/craft-list-store.js")
  + loadFile("js/render-craft-list-events.js")
  + `
module.exports = {
  fire(type, event) { (_handlers[type] || []).forEach((fn) => fn(event)); },
  refreshes() { return _refreshes; },
  setCraftListStorage, clearCraftList, addCraftListEntry, getCraftList,
};
`;

const m = new Module("craft-list-events-test", null);
m.paths = Module._nodeModulePaths(ROOT);
m._compile(src, path.join(ROOT, "js", "craft-list-events-test.js"));
const api = m.exports;

const TABLE = "flipping-table";
const ROW = "T8_SOUL|Martlock";

/** One quantity box, plus the event objects the listeners expect. */
function box(startValue) {
  // `value` stringifies on write, the way a real <input> does — the panel
  // assigns the stored number straight into it.
  let _value = String(startValue);
  const input = {
    get value() { return _value; },
    set value(v) { _value = String(v); },
    getAttribute: (a) => (a === "data-table-id" ? TABLE : a === "data-row-key" ? ROW : null),
  };
  const target = { closest: (sel) => (sel === "[data-cl-qty]" ? input : null) };
  return {
    input,
    type(text) {
      input.value = text;
      api.fire("input", { target });
    },
    enter() {
      let prevented = false;
      api.fire("keydown", { key: "Enter", target, preventDefault() { prevented = true; } });
      return prevented;
    },
    blur() { api.fire("change", { target }); },
    other(key) {
      api.fire("keydown", { key, target, preventDefault() {} });
    },
  };
}

function reset(qty) {
  api.setCraftListStorage(null);
  api.clearCraftList();
  api.addCraftListEntry({ tableId: TABLE, rowKey: ROW, itemId: "T8_SOUL", qty });
}
const stored = () => api.getCraftList()[0].qty;

// ── a plain number is still live ────────────────────────────────────────────

test("a plain number commits on every keystroke", () => {
  reset(1);
  const b = box(1);
  ["4", "48", "480"].forEach((v) => {
    b.type(v);
    assert.strictEqual(stored(), Number(v), `${v} commits as it is typed`);
  });
});

test("a cleared box still parks the row on the keystroke", () => {
  reset(5);
  const b = box(5);
  b.type("");
  assert.strictEqual(stored(), 0);
});

// ── arithmetic waits ────────────────────────────────────────────────────────

test("a half-typed sum is held back, keystroke by keystroke", () => {
  reset(1);
  const b = box(1);
  b.type("9");
  assert.strictEqual(stored(), 9, "the first digits are still a plain number");
  ["96+", "96+9", "96+96"].forEach((v) => {
    b.type(v);
    assert.strictEqual(stored(), 9, `${v} must not commit while it is being typed`);
  });
});

test("Enter commits the sum and shows the total back", () => {
  reset(1);
  const b = box(1);
  b.type("96+96");
  const prevented = b.enter();
  assert.strictEqual(stored(), 192);
  assert.strictEqual(b.input.value, "192", "the field shows what was stored");
  assert.strictEqual(prevented, true, "Enter is consumed by the panel");
});

test("blur commits the sum too", () => {
  reset(1);
  const b = box(1);
  b.type("(96+96)/2");
  assert.strictEqual(stored(), 1, "still held while the field has focus");
  b.blur();
  assert.strictEqual(stored(), 96);
  assert.strictEqual(b.input.value, "96");
});

test("every commit refreshes the totals", () => {
  reset(1);
  const before = api.refreshes();
  const b = box(1);
  b.type("96+96");
  assert.strictEqual(api.refreshes(), before, "a held keystroke repaints nothing");
  b.enter();
  assert.ok(api.refreshes() > before, "the commit does");
});

// ── an unfinished expression is refused, never guessed at ───────────────────

test("Enter on a half-typed sum keeps the quantity that was already stored", () => {
  reset(192);
  const b = box(192);
  b.type("96+");
  b.enter();
  assert.strictEqual(stored(), 192, "the plan survives an early Enter");
  assert.strictEqual(b.input.value, "192", "and the field is put back");
});

test("blurring out of a half-typed sum keeps it too", () => {
  reset(192);
  const b = box(192);
  b.type("2*");
  b.blur();
  assert.strictEqual(stored(), 192);
  assert.strictEqual(b.input.value, "192");
});

test("an unparseable sum is refused whatever shape it is in", () => {
  ["96+", "96++96", "(96+96", "1/0", "96+abc"].forEach((text) => {
    reset(50);
    const b = box(50);
    b.type(text);
    b.enter();
    assert.strictEqual(stored(), 50, `${text} must not overwrite the plan`);
  });
});

// Plain garbage is NOT arithmetic, so it keeps the store's own old meaning:
// unreadable means "one of these".
test("text that is not arithmetic keeps the store's existing fallback", () => {
  reset(50);
  const b = box(50);
  b.type("abc");
  assert.strictEqual(stored(), 1, "committed live, as it always was");
});

// ── nothing else moves ──────────────────────────────────────────────────────

test("a key that is not Enter commits nothing", () => {
  reset(7);
  const b = box(7);
  b.input.value = "96+96";
  b.other("a");
  b.other("Escape");
  assert.strictEqual(stored(), 7);
});

test("an event outside a quantity box is ignored", () => {
  reset(7);
  const elsewhere = { target: { closest: () => null } };
  api.fire("input", elsewhere);
  api.fire("change", elsewhere);
  api.fire("keydown", { key: "Enter", target: { closest: () => null } });
  assert.strictEqual(stored(), 7);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
