/**
 * Tests for the switchable quality-transition selector in the Quality
 * Rerolling table (#rerolling-quality-filter dropdown).
 *
 * Behavior under test:
 *   - The dropdown is populated with one option per QUALITY_TRANSITIONS entry
 *     plus the pre-existing "All transitions" default (value "").
 *   - getSelectedRerollTransition() parses the selected "from-to" value into
 *     { from, to }, and returns null for the "All" default / malformed values.
 *   - Picking a single transition narrows QUALITY_TRANSITIONS to just that one
 *     so items can be compared at a fixed quality jump.
 *
 * Black-box: compile data-rerolling.js (for QUALITY_TRANSITIONS / QUALITY_NAMES)
 * and render-rerolling.js in a sandbox with a settable <select> stub, then drive
 * the real getSelectedRerollTransition() through each option value.
 *
 * Run: node tests/rerolling-transition-filter.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const read = (f) =>
  fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

// One settable select stub shared with the sandbox; tests mutate _selectValue.
const sandbox = `
const _select = {
  value: "",
  children: [],
  appendChild(o) { this.children.push(o); },
  addEventListener() {},
};
const document = {
  getElementById: (id) => (id === "rerolling-quality-filter" ? _select : null),
  createElement: () => ({ value: "", textContent: "" }),
};
function _setSelect(v) { _select.value = v; }
`;

const mod = new Module("rerolling-transition-filter-test");
const exportLine =
  "\nmodule.exports = { getSelectedRerollTransition, QUALITY_TRANSITIONS, QUALITY_NAMES, _select, _setSelect };";
mod._compile(
  sandbox + read("data-rerolling.js") + read("render-rerolling.js") + exportLine,
  "render-rerolling.js",
);
const {
  getSelectedRerollTransition,
  QUALITY_TRANSITIONS,
  QUALITY_NAMES,
  _select,
  _setSelect,
} = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("\n=== Quality rerolling transition filter ===");

test("dropdown is populated with one option per transition", () => {
  // The IIFE appends QUALITY_TRANSITIONS.length options (the "All" default is
  // the pre-existing static <option> in HTML, not appended here).
  assert.strictEqual(_select.children.length, QUALITY_TRANSITIONS.length);
  const first = QUALITY_TRANSITIONS[0];
  assert.strictEqual(_select.children[0].value, `${first.from}-${first.to}`);
  assert.strictEqual(
    _select.children[0].textContent,
    `${QUALITY_NAMES[first.from]} → ${QUALITY_NAMES[first.to]}`,
  );
});

test("empty value (All transitions) → null", () => {
  _setSelect("");
  assert.strictEqual(getSelectedRerollTransition(), null);
});

test("each transition value parses to its { from, to }", () => {
  QUALITY_TRANSITIONS.forEach((t) => {
    _setSelect(`${t.from}-${t.to}`);
    assert.deepStrictEqual(getSelectedRerollTransition(), {
      from: t.from,
      to: t.to,
    });
  });
});

test("selecting a transition narrows QUALITY_TRANSITIONS to exactly one", () => {
  _setSelect("1-4");
  const sel = getSelectedRerollTransition();
  const filtered = QUALITY_TRANSITIONS.filter(
    (t) => t.from === sel.from && t.to === sel.to,
  );
  assert.strictEqual(filtered.length, 1);
  assert.deepStrictEqual(filtered[0], { from: 1, to: 4 });
});

test("malformed values fall back to null (treated as All)", () => {
  ["garbage", "1-", "-3", "x-y", "0-0"].forEach((v) => {
    _setSelect(v);
    assert.strictEqual(getSelectedRerollTransition(), null, `value=${v}`);
  });
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
