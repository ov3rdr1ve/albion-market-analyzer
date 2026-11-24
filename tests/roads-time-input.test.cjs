"use strict";

/**
 * Black-box tests for RoadsTimeInput (js/roads-time-input.js) — the one shared
 * parser behind both portal-timer entry points, per the plan
 * "2026-09-16 — AVA portal timer input in h:m" (TDD step 1: tests first).
 *
 * A portal's lifetime is read off the game UI as "23h", "4h", "30m" or a clock
 * read "2:30" — never as the decimal hours the boxes take today ("30m" had to
 * be typed as 0.5). parse() turns any accepted spelling into integer seconds,
 * formatForEdit() renders what is left back into the H:MM the editor prefills.
 *
 * Accepted syntax (everything else → null):
 *   H:M / H:MM   "2:30" → 9000, minutes must stay 0–59
 *   Nm / Nh      "30m" → 1800, "23h" → 82800 (case-insensitive)
 *   plain number legacy decimal hours — "1.5" → 5400
 * Whitespace is trimmed; nothing over the 24 h ceiling the store already kept.
 *
 * The module is a plain browser-global (window.RoadsTimeInput, the sibling
 * roads-module pattern), so each test evaluates the source in a sandbox with
 * a stubbed window. The load happens INSIDE every test on purpose: until the
 * module is implemented the suite must fail per test, not crash at load.
 *
 * Run: node --test tests/roads-time-input.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { test } = require("node:test");

const MODULE_PATH = path.join(__dirname, "..", "js", "roads-time-input.js");

/**
 * Evaluate the module source and hand back its RoadsTimeInput namespace.
 * CRLF/BOM are normalised so the eval never trips over Windows line endings;
 * a `module` shim is provided in case the file keeps the Node-export guard
 * its siblings carry. Throws (→ that one test fails) until the module exists
 * and exposes parse()/formatForEdit() on window.
 */
function loadTimeInput() {
  let source;
  try {
    source = fs.readFileSync(MODULE_PATH, "utf8");
  } catch (err) {
    throw new Error(
      `js/roads-time-input.js does not exist yet — implement it (plan step 2) to turn these red tests green (${err.message})`,
      { cause: err },
    );
  }
  const sandbox = { window: {}, console, module: { exports: {} } };
  vm.createContext(sandbox);
  vm.runInContext(source.replace(/\r\n/g, "\n").replace(/^\uFEFF/, ""), sandbox, {
    filename: "js/roads-time-input.js",
  });
  const mod = sandbox.window.RoadsTimeInput || sandbox.RoadsTimeInput || sandbox.module.exports.RoadsTimeInput;
  if (!mod || typeof mod.parse !== "function" || typeof mod.formatForEdit !== "function") {
    throw new Error("js/roads-time-input.js must expose window.RoadsTimeInput with parse() and formatForEdit()");
  }
  return mod;
}

// ── parse() ────────────────────────────────────────────────────────────────
// [input, expected seconds | null]. null rows are the rejects: garbage,
// negatives, minutes ≥ 60, anything past the 24 h ceiling, and spellings
// outside the three accepted forms (no "2 h", no "2h30", no "1,5").

const PARSE_CASES = [
  // H:M / H:MM
  ["2:30", 9000],
  ["0:05", 300],
  ["23:59", 86340],
  ["0:0", 0],
  ["24:00", 86400], // the ceiling is inclusive
  ["  2:30  ", 9000], // whitespace trimmed
  // minutes / hours suffix, case-insensitive
  ["30m", 1800],
  ["45M", 2700],
  ["23h", 82800],
  ["4H", 14400],
  ["1h", 3600],
  ["24h", 86400],
  // plain number = legacy decimal hours
  ["1.5", 5400],
  ["0.25", 900],
  ["2", 7200],
  ["0", 0],
  ["24", 86400],
  // rejects
  ["", null],
  ["   ", null],
  ["abc", null],
  ["-1", null],
  ["-0:30", null],
  ["2:75", null],
  ["0:60", null],
  ["25h", null],
  ["24:01", null],
  ["25.5", null],
  ["1,5", null],
  ["m30", null],
  ["2 h", null],
  ["2h30", null],
  ["2:3:4", null],
  [":", null],
  ["h", null],
  ["1:", null],
  [":30", null],
];

for (const [input, want] of PARSE_CASES) {
  test(`parse(${JSON.stringify(input)}) -> ${want === null ? "null" : want}`, () => {
    assert.strictEqual(loadTimeInput().parse(input), want);
  });
}

// ── formatForEdit() ────────────────────────────────────────────────────────
// The editor prefill: H:MM with zero-padded minutes. Sub-minute leftovers
// clamp UP to one minute — a portal with 30 s left must not offer a prefill
// that commits 0 ("0:00" is reserved for genuinely nothing left).

const FORMAT_CASES = [
  [9000, "2:30"],
  [2520, "0:42"],
  [82800, "23:00"],
  [7500, "2:05"], // zero-padded minutes
  [60, "0:01"],
  [30, "0:01"], // min clamp: never "0:00" while something is left
  [0, "0:00"],
];

for (const [seconds, want] of FORMAT_CASES) {
  test(`formatForEdit(${seconds}) -> "${want}"`, () => {
    assert.strictEqual(loadTimeInput().formatForEdit(seconds), want);
  });
}
