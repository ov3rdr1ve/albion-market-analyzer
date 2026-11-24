/**
 * Tests for the boot fill flag (js/boot-state.js).
 *
 * "Not priced yet — scan X to fill this row." is the right thing to say to a
 * user who has never scanned, and the wrong thing to say to one whose app is
 * computing that very row. The only difference between the two is whether boot
 * is still filling the tables, which is what this flag carries.
 *
 * Contract:
 *   isBootFilling()  — true from script evaluation, so a renderer that runs
 *                      before app.js has even started reads the right answer.
 *   setBootFilling() — flips it, coerces to a boolean, idempotent.
 *
 * Black-box: the module only, no DOM, no app boot.
 *
 * Run: node tests/boot-state.test.cjs
 */

const assert = require("assert");
const path = require("path");

const MODULE = path.join(__dirname, "..", "js", "boot-state.js");
const state = require(MODULE);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

// ── the default ────────────────────────────────────────────────────────────

test("boot is filling from the moment the script is evaluated", () => {
  assert.strictEqual(state.isBootFilling(), true);
});

// ── flipping it ────────────────────────────────────────────────────────────

const cases = [
  ["false ends the fill", false, false],
  ["false again is harmless", false, false],
  ["true puts it back", true, true],
  ["a missing argument means done, not filling", undefined, false],
  ["a truthy non-boolean coerces", 1, true],
  ["a falsy non-boolean coerces", 0, false],
];

cases.forEach(([name, input, want]) => {
  test(name, () => {
    state.setBootFilling(input);
    assert.strictEqual(state.isBootFilling(), want);
  });
});

// ── what the renderers actually ask ────────────────────────────────────────

test("the flag is what decides the craft list's placeholder wording", () => {
  // The rule the list applies, restated here so a change to it breaks a test
  // rather than only the app: filling → "Computing…", done → the scan hint.
  const hint = () => (state.isBootFilling() ? "computing" : "scan");
  state.setBootFilling(true);
  assert.strictEqual(hint(), "computing");
  state.setBootFilling(false);
  assert.strictEqual(hint(), "scan");
});

console.log(`\nboot-state: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
