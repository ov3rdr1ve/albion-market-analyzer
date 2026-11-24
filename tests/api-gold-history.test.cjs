/**
 * Test: gold-price history fetching (js/api.js buildGoldUrl + fetchGoldHistory).
 *
 * buildGoldUrl is pure. fetchGoldHistory is exercised with a mocked fetch (no
 * network): it must parse AODP's zone-less UTC timestamps as UTC, map to
 * { time(sec), price }, drop malformed rows, sort oldest→newest, and return []
 * on any failure. Black-box on input/output only.
 *
 * Run: node tests/api-gold-history.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const apiSrc = fs.readFileSync(path.join(__dirname, "..", "js", "api.js"), "utf8");

// Compile api.js with a configurable fetch mock injected ahead of it.
function loadApi(fetchImpl) {
  const mod = new Module("api-gold-test");
  const sandbox = `
    const localStorage = { getItem: () => null, setItem: () => {} };
    const document = { getElementById: () => null };
    let __fetch = null;
    globalThis.__setFetch = (f) => { __fetch = f; };
    const fetch = (...a) => __fetch(...a);
  `;
  mod._compile(sandbox + apiSrc, "api.js");
  mod.exports.__setFetch = globalThis.__setFetch;
  globalThis.__setFetch(fetchImpl);
  return mod.exports;
}

let passed = 0, failed = 0;
function test(name, fn) {
  const run = (done) => {
    Promise.resolve()
      .then(fn)
      .then(() => { passed++; console.log(`  PASS: ${name}`); })
      .catch((e) => { failed++; console.log(`  FAIL: ${name}\n    ${e.message}`); })
      .then(done);
  };
  queue.push(run);
}
const queue = [];

console.log("Gold price history\n");

test("buildGoldUrl targets /stats/gold with count", () => {
  const api = loadApi(() => Promise.resolve({ ok: false, status: 0 }));
  assert.strictEqual(
    api.buildGoldUrl("https://west.albion-online-data.com", 720),
    "https://west.albion-online-data.com/api/v2/stats/gold?count=720"
  );
});

test("fetchGoldHistory maps, UTC-parses, sorts oldest→newest", async () => {
  const raw = [
    { price: 7828, timestamp: "2026-07-06T15:00:00" },
    { price: 7805, timestamp: "2026-07-06T16:00:00" },
    { price: 7835, timestamp: "2026-07-06T14:00:00" },
  ];
  const api = loadApi(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(raw) }));
  const out = await api.fetchGoldHistory(720);
  assert.strictEqual(out.length, 3);
  // sorted ascending by time
  assert.ok(out[0].time < out[1].time && out[1].time < out[2].time, "not sorted ascending");
  // 14:00 UTC first, price 7835
  assert.strictEqual(out[0].price, 7835);
  // UTC parse: 2026-07-06T14:00:00Z
  assert.strictEqual(out[0].time, Math.floor(Date.UTC(2026, 6, 6, 14, 0, 0) / 1000));
});

test("fetchGoldHistory drops malformed rows", async () => {
  const raw = [
    { price: 7805, timestamp: "2026-07-06T16:00:00" },
    { price: "oops", timestamp: "2026-07-06T15:00:00" }, // NaN price
    { timestamp: "2026-07-06T14:00:00" },                 // missing price
    { price: 7810, timestamp: "not-a-date" },             // NaN time
  ];
  const api = loadApi(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(raw) }));
  const out = await api.fetchGoldHistory(720);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].price, 7805);
});

test("fetchGoldHistory returns [] on non-ok response", async () => {
  const api = loadApi(() => Promise.resolve({ ok: false, status: 404 }));
  const out = await api.fetchGoldHistory(720);
  assert.deepStrictEqual(out, []);
});

test("fetchGoldHistory returns [] when body isn't an array", async () => {
  const api = loadApi(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ error: "x" }) }));
  const out = await api.fetchGoldHistory(720);
  assert.deepStrictEqual(out, []);
});

// Drain the async queue sequentially, then report.
(function next() {
  const job = queue.shift();
  if (!job) {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
    return;
  }
  job(next);
})();
