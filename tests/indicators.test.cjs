/**
 * Test: technical-indicator math for the Gold Price chart (js/indicators.js).
 *
 * Pure black-box checks on the indicator functions the Gold chart feeds into
 * TradingView Lightweight Charts. No DOM, no network — the functions take a
 * plain close-price array (or {time,price} points) and return aligned arrays.
 *
 * Alignment convention: every indicator returns an array the SAME length as
 * its input, with `null` for the warm-up region where the value is undefined,
 * so a caller can zip it against timestamps by index.
 *
 * Bollinger uses POPULATION stdev (÷N), matching TradingView.
 * EMA is SMA-seeded. RSI uses Wilder smoothing.
 *
 * Run: node tests/indicators.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const src = fs.readFileSync(path.join(__dirname, "..", "js", "indicators.js"), "utf8");
const mod = new Module("indicators-test");
mod._compile(src, "indicators.js");
const {
  sma, ema, macd, rsi, bollinger, bucketToOHLC,
} = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name}\n    ${e.message}`); }
}
// approx-equal for a whole array (null-aware)
function assertArrayClose(actual, expected, eps = 1e-6, msg = "") {
  assert.strictEqual(actual.length, expected.length, `${msg} length ${actual.length} != ${expected.length}`);
  actual.forEach((v, i) => {
    const e = expected[i];
    if (e === null) { assert.strictEqual(v, null, `${msg} idx ${i}: expected null, got ${v}`); return; }
    assert.ok(v !== null && Math.abs(v - e) <= eps, `${msg} idx ${i}: ${v} != ${e}`);
  });
}

console.log("Technical indicators\n");

// ── SMA ──────────────────────────────────────────────────────────────────────
test("sma: aligned, null warm-up", () =>
  assertArrayClose(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]));

test("sma: period 1 is identity", () =>
  assertArrayClose(sma([4, 8, 2], 1), [4, 8, 2]));

test("sma: period longer than data is all null", () =>
  assertArrayClose(sma([1, 2], 5), [null, null]));

// ── EMA (SMA-seeded) ──────────────────────────────────────────────────────────
test("ema: SMA-seeded, k=2/(p+1)", () =>
  // seed EMA[2]=avg(1,2,3)=2; k=0.5; EMA[3]=4*.5+2*.5=3; EMA[4]=5*.5+3*.5=4
  assertArrayClose(ema([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]));

test("ema: flat series stays flat", () =>
  assertArrayClose(ema([7, 7, 7, 7], 2), [null, 7, 7, 7]));

// ── MACD ──────────────────────────────────────────────────────────────────────
test("macd: fast==slow → macd line all zero", () => {
  const out = macd([1, 3, 2, 5, 4, 6, 7, 8], 3, 3, 2);
  out.macd.forEach((v, i) => {
    if (v !== null) assert.ok(Math.abs(v) < 1e-9, `macd[${i}]=${v} not ~0`);
  });
});

test("macd: shape {macd,signal,histogram} all input length", () => {
  const vals = Array.from({ length: 40 }, (_, i) => i + 1);
  const out = macd(vals, 12, 26, 9);
  assert.strictEqual(out.macd.length, 40);
  assert.strictEqual(out.signal.length, 40);
  assert.strictEqual(out.histogram.length, 40);
  // histogram = macd - signal wherever both defined
  out.histogram.forEach((h, i) => {
    if (h !== null) assert.ok(Math.abs(h - (out.macd[i] - out.signal[i])) < 1e-9, `hist[${i}] mismatch`);
  });
});

// ── RSI (Wilder) ──────────────────────────────────────────────────────────────
test("rsi: strictly rising series → 100", () => {
  const out = rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 14);
  const last = out[out.length - 1];
  assert.ok(last !== null && Math.abs(last - 100) < 1e-6, `expected 100, got ${last}`);
});

test("rsi: strictly falling series → 0", () => {
  const out = rsi([16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], 14);
  const last = out[out.length - 1];
  assert.ok(last !== null && Math.abs(last - 0) < 1e-6, `expected 0, got ${last}`);
});

test("rsi: warm-up region is null (first `period` entries)", () => {
  const out = rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 14);
  for (let i = 0; i < 14; i++) assert.strictEqual(out[i], null, `idx ${i} should be null`);
  assert.ok(out[14] !== null, "idx 14 should be defined");
});

// ── Bollinger (population stdev, TradingView-style) ────────────────────────────
test("bollinger: flat series → zero-width band", () =>
  assertArrayClose(bollinger([5, 5, 5, 5, 5], 3, 2).upper, [null, null, 5, 5, 5]));

test("bollinger: known population stdev", () => {
  // window [2,4,6]: mean 4, popStdev=sqrt(((-2)^2+0+2^2)/3)=sqrt(8/3)=1.632993...
  const out = bollinger([2, 4, 6], 3, 2);
  const sd = Math.sqrt(8 / 3);
  assert.ok(Math.abs(out.middle[2] - 4) < 1e-9, "middle");
  assert.ok(Math.abs(out.upper[2] - (4 + 2 * sd)) < 1e-9, `upper ${out.upper[2]}`);
  assert.ok(Math.abs(out.lower[2] - (4 - 2 * sd)) < 1e-9, `lower ${out.lower[2]}`);
});

// ── OHLC bucketing (hourly close → candles) ───────────────────────────────────
test("bucketToOHLC: 2-hour buckets from hourly points", () => {
  const pts = [
    { time: 0,     price: 10 },
    { time: 3600,  price: 12 },
    { time: 7200,  price: 8 },
    { time: 10800, price: 11 },
  ];
  const out = bucketToOHLC(pts, 7200);
  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual(out[0], { time: 0,    open: 10, high: 12, low: 10, close: 12 });
  assert.deepStrictEqual(out[1], { time: 7200, open: 8,  high: 11, low: 8,  close: 11 });
});

test("bucketToOHLC: single point → single candle O=H=L=C", () => {
  const out = bucketToOHLC([{ time: 5000, price: 42 }], 3600);
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0], { time: 3600, open: 42, high: 42, low: 42, close: 42 });
});

test("bucketToOHLC: unsorted input is ordered by bucket", () => {
  const pts = [
    { time: 10800, price: 11 },
    { time: 0,     price: 10 },
    { time: 3600,  price: 12 },
  ];
  const out = bucketToOHLC(pts, 3600);
  assert.deepStrictEqual(out.map((c) => c.time), [0, 3600, 10800]);
  assert.strictEqual(out[0].open, 10);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
