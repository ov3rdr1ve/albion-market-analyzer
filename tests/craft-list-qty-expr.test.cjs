/**
 * My Crafting List — arithmetic in the Qty box (js/craft-list-qty-expr.js).
 *
 * The quantity field is a plan the user does arithmetic on: "two runs of 96" is
 * typed as `96+96`, not as `192`. This module is the whole of that: a small
 * calculator over `+ - * / ( )` that returns a number, or null when the text is
 * not a complete expression.
 *
 * null is the important half of the contract. A half-typed `96+` must not
 * commit as anything, and anything the grammar does not cover must fall back to
 * the store's existing handling (js/craft-list-store.js) rather than be guessed
 * at. Parsing is hand-written on purpose — no eval, no new Function.
 *
 * Black-box over the two exported functions.
 *
 * Run: node tests/craft-list-qty-expr.test.cjs
 */
const assert = require("assert");
const path = require("path");

const {
  parseQtyExpression,
  isQtyExpression,
  QTY_EXPR_MAX_LENGTH,
} = require(path.join(__dirname, "..", "js", "craft-list-qty-expr.js"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

// ── what the field is actually for ──────────────────────────────────────────

test("adds the two stacks the user typed", () => {
  const cases = [
    ["96+96", 192],
    ["96 + 96", 192],
    ["  96+96  ", 192],
    ["96+96+96", 288],
  ];
  cases.forEach(([input, want]) => {
    assert.strictEqual(parseQtyExpression(input), want, `${input} → ${want}`);
  });
});

test("a plain number parses as itself", () => {
  [["96", 96], ["0", 0], ["7", 7], ["2.5", 2.5], ["1000000", 1000000]]
    .forEach(([input, want]) => {
      assert.strictEqual(parseQtyExpression(input), want, `${input} → ${want}`);
    });
});

test("the four operators and parentheses", () => {
  const cases = [
    ["96-6", 90],
    ["3*4", 12],
    ["12/4", 3],
    ["(96+96)/2", 96],
    ["2*(3+4)", 14],
    ["((5))", 5],
    ["2.5*4", 10],
    ["96/7", 96 / 7],
  ];
  cases.forEach(([input, want]) => {
    assert.strictEqual(parseQtyExpression(input), want, `${input} → ${want}`);
  });
});

test("precedence is multiplicative before additive", () => {
  [["2+3*4", 14], ["2*3+4", 10], ["10-2*3", 4], ["8/2+2", 6]]
    .forEach(([input, want]) => {
      assert.strictEqual(parseQtyExpression(input), want, `${input} → ${want}`);
    });
});

test("subtraction is left-associative", () => {
  assert.strictEqual(parseQtyExpression("10-3-2"), 5);
  assert.strictEqual(parseQtyExpression("100/5/2"), 10);
});

test("a leading sign is a sign, not a dangling operator", () => {
  [["-5", -5], ["+5", 5], ["-(2+3)", -5], ["2*-3", -6], ["96-200", -104]]
    .forEach(([input, want]) => {
      assert.strictEqual(parseQtyExpression(input), want, `${input} → ${want}`);
    });
});

// Clamping is the STORE's job (0 parks a row, negatives clamp to 0): the parser
// reports what the text says, so a `-104` here is a correct answer.
test("the parser does not clamp, floor or cap", () => {
  assert.strictEqual(parseQtyExpression("96-200"), -104);
  assert.strictEqual(parseQtyExpression("5/2"), 2.5);
  assert.strictEqual(parseQtyExpression("999999*999999"), 999999 * 999999);
});

// ── null: not a complete expression ─────────────────────────────────────────

test("null for anything that is not a finished expression", () => {
  const cases = [
    "", "   ", "\t\n",
    "abc", "96abc", "abc+96",
    "96+", "96-", "96*", "96/", "+", "-", "*", "/",
    "96++96", "96+*96", "96**96",
    "(96+96", "96+96)", "()", "(", ")",
    "96 96",
    "1e3", "1E3", "0x10",
    "96;alert(1)", "96,96", "96%2", "96^2",
    ".", "..", "96..5", "1.2.3",
  ];
  cases.forEach((input) => {
    assert.strictEqual(parseQtyExpression(input), null, `${JSON.stringify(input)} → null`);
  });
});

test("null for a non-finite result", () => {
  assert.strictEqual(parseQtyExpression("1/0"), null);
  assert.strictEqual(parseQtyExpression("-1/0"), null);
  assert.strictEqual(parseQtyExpression("0/0"), null);
});

test("null for a non-string, so the store's own coercion stays in charge", () => {
  [null, undefined, 96, {}, [], true, NaN].forEach((input) => {
    assert.strictEqual(parseQtyExpression(input), null, `${String(input)} → null`);
  });
});

test("null past the length cap", () => {
  const long = new Array(200).fill("1").join("+");
  assert.ok(long.length > QTY_EXPR_MAX_LENGTH, "the fixture must exceed the cap");
  assert.strictEqual(parseQtyExpression(long), null);
  // Right at the cap it still parses — the cap is a guard, not a shorter grammar.
  const atCap = "1+".repeat(Math.floor((QTY_EXPR_MAX_LENGTH - 1) / 2)) + "1";
  assert.ok(atCap.length <= QTY_EXPR_MAX_LENGTH);
  assert.strictEqual(parseQtyExpression(atCap), (atCap.length + 1) / 2);
});

// ── isQtyExpression: "hold off, the user is still typing" ───────────────────

test("isQtyExpression flags text that is mid-arithmetic", () => {
  const cases = [
    ["96+96", true], ["96+", true], ["96 + ", true],
    ["(96", true], ["96)", true], ["3*4", true], ["12/4", true],
    ["96-6", true],
    ["96", false], ["", false], ["   ", false], ["0", false], ["2.5", false],
    ["abc", false],
    // A leading sign is a whole number, not a pending expression: committing
    // "-5" live is the same park a typed "0" is.
    ["-5", false], ["+5", false], [" -5", false],
  ];
  cases.forEach(([input, want]) => {
    assert.strictEqual(isQtyExpression(input), want, `${JSON.stringify(input)} → ${want}`);
  });
});

test("isQtyExpression is false for a non-string", () => {
  [null, undefined, 96, {}].forEach((input) => {
    assert.strictEqual(isQtyExpression(input), false, `${String(input)} → false`);
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
