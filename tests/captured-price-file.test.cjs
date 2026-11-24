/**
 * Test: the captured-price map on disk (js/captured-price-file.js).
 *
 * Captures moved out of localStorage because a week of them is megabytes and a
 * quota error there took the crafting list and the price overrides down with
 * them. This module is the main-process pipe — the only contract is that it
 * never throws and never returns half a map.
 *
 * Black-box: readFile / writeFile are injected. No real filesystem.
 *
 * Run: node tests/captured-price-file.test.cjs
 */

const assert = require("assert");
const path = require("path");

const F = require(path.join(__dirname, "..", "js", "captured-price-file.js"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Captured price file tests\n");

const MAP = { T6_ENERGY: { 1: { Lymhurst: { sell_price: 4000, buy_price: 3510 } } } };

test("the filename is stable — a rename would orphan every user's captures", () => {
  assert.strictEqual(F.CAPTURED_PRICES_FILENAME, "captured-prices.json");
});

// ── load ────────────────────────────────────────────────────────────────────

test("a written map reads back identical", () => {
  let written = null;
  F.saveCapturedPricesFile({ file: "x.json", map: MAP, writeFile: (f, d) => { written = d; } });
  const back = F.loadCapturedPricesFile({ file: "x.json", readFile: () => written });
  assert.deepStrictEqual(back, MAP);
});

test("a missing file loads as null, not a throw", () => {
  const back = F.loadCapturedPricesFile({
    file: "nope.json",
    readFile: () => { throw new Error("ENOENT"); },
  });
  assert.strictEqual(back, null);
});

[
  ["corrupt JSON", "{not json"],
  ["a truncated write", '{"T6_ENERGY":{"1":{"Lym'],
  ["an empty file", ""],
  ["a JSON array", "[1,2,3]"],
  ["a JSON scalar", "42"],
  ["JSON null", "null"],
].forEach(([name, text]) => {
  test(`load tolerates ${name}`, () => {
    assert.strictEqual(F.loadCapturedPricesFile({ file: "x.json", readFile: () => text }), null);
  });
});

// ── save ────────────────────────────────────────────────────────────────────

test("a successful write reports true", () => {
  assert.strictEqual(
    F.saveCapturedPricesFile({ file: "x.json", map: MAP, writeFile: () => {} }),
    true,
  );
});

test("a read-only profile reports false instead of throwing", () => {
  assert.strictEqual(
    F.saveCapturedPricesFile({
      file: "x.json", map: MAP, writeFile: () => { throw new Error("EACCES"); },
    }),
    false,
  );
});

[
  ["null", null],
  ["undefined", undefined],
  ["an array", [1, 2]],
  ["a string", "nope"],
].forEach(([name, map]) => {
  test(`save refuses ${name}`, () => {
    let called = false;
    const ok = F.saveCapturedPricesFile({ file: "x.json", map, writeFile: () => { called = true; } });
    assert.strictEqual(ok, false);
    assert.strictEqual(called, false, "and never touches the file");
  });
});

test("an empty map is still a legitimate write — it clears the file", () => {
  let written = null;
  const ok = F.saveCapturedPricesFile({ file: "x.json", map: {}, writeFile: (f, d) => { written = d; } });
  assert.strictEqual(ok, true);
  assert.strictEqual(written, "{}");
});

test("the payload is not pretty-printed", () => {
  let written = null;
  F.saveCapturedPricesFile({ file: "x.json", map: MAP, writeFile: (f, d) => { written = d; } });
  assert.ok(!/\n/.test(written), "a multi-megabyte file must not carry indentation");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
