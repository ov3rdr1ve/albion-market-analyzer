/**
 * Test: EU / Asia server switcher.
 *
 * Albion Online Data Project runs three independent regional servers, each
 * with its own market data:
 *   - west   → https://west.albion-online-data.com   (Americas)
 *   - europe → https://europe.albion-online-data.com (Europe)
 *   - east   → https://east.albion-online-data.com   (Asia)
 *
 * The app used to be hardcoded to `west`. This suite black-box tests the
 * region-selection helpers exported by js/api.js:
 *   - resolveApiServer(key)          → valid key or default fallback
 *   - apiHostFor(key)                → base host URL for a key
 *   - getApiServerKey() / getApiHost / setApiServer(key) → localStorage-backed
 *   - buildPricesUrl / buildHistoryUrl → exact request URLs per host
 *
 * Behavior focus (input → output), not internals. localStorage is stubbed so
 * no real storage and no live API are touched.
 *
 * Run: node tests/server-switcher.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

// ── Controllable localStorage stub (reset between tests) ─────────────────────
let _localStorage = {};
global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(_localStorage, k) ? _localStorage[k] : null; },
  setItem(k, v) { _localStorage[k] = String(v); },
  removeItem(k) { delete _localStorage[k]; },
};
// api.js references these at runtime only; stub so nothing real is touched.
global.fetch = () => Promise.resolve({ ok: false, status: 0 });
global.document = { getElementById: () => null, querySelector: () => null };

// ── Load api.js as a CommonJS module ─────────────────────────────────────────
const apiSrc = fs.readFileSync(path.join(__dirname, "..", "js", "api.js"), "utf8");
const mod = new Module("server-switcher-test");
mod.paths = Module._nodeModulePaths(path.join(__dirname, ".."));
mod._compile(apiSrc, "api.js");
const {
  API_SERVERS,
  DEFAULT_SERVER,
  resolveApiServer,
  apiHostFor,
  getApiServerKey,
  getApiHost,
  setApiServer,
  buildPricesUrl,
  buildHistoryUrl,
} = mod.exports;

const HOSTS = {
  west: "https://west.albion-online-data.com",
  europe: "https://europe.albion-online-data.com",
  east: "https://east.albion-online-data.com",
};

// ── Tiny runner (mirrors the repo's other .cjs tests) ────────────────────────
let passed = 0, failed = 0;
function test(name, fn) {
  _localStorage = {}; // fresh storage per test
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// ── Exports / metadata ───────────────────────────────────────────────────────
console.log("\n=== Exports & server catalog ===");

test("api.js exports the server-switcher helpers", () => {
  ["resolveApiServer", "apiHostFor", "getApiServerKey", "getApiHost",
   "setApiServer", "buildPricesUrl", "buildHistoryUrl"].forEach((fn) => {
    assert.strictEqual(typeof mod.exports[fn], "function", `${fn} must be exported`);
  });
  assert.strictEqual(typeof API_SERVERS, "object", "API_SERVERS exported");
  assert.strictEqual(DEFAULT_SERVER, "west", "default server is Americas/West");
});

test("API_SERVERS catalogs exactly west/europe/east with official hosts", () => {
  assert.deepStrictEqual(Object.keys(API_SERVERS).sort(), ["east", "europe", "west"]);
  for (const key of Object.keys(HOSTS)) {
    assert.strictEqual(API_SERVERS[key].host, HOSTS[key], `${key} host`);
    assert.ok(API_SERVERS[key].label && API_SERVERS[key].label.length > 0, `${key} has a label`);
  }
});

test("labels name their region (Americas / Europe / Asia)", () => {
  assert.match(API_SERVERS.west.label, /Americas|West/i);
  assert.match(API_SERVERS.europe.label, /Europe/i);
  assert.match(API_SERVERS.east.label, /Asia|East/i);
});

// ── resolveApiServer (pure) ──────────────────────────────────────────────────
console.log("\n=== resolveApiServer (key normalization) ===");

[
  ["west", "west"],
  ["europe", "europe"],
  ["east", "east"],
  [null, "west"],
  [undefined, "west"],
  ["", "west"],
  ["garbage", "west"],
  ["WeSt", "west"],          // case-sensitive: unknown key → default
  ["  east", "west"],        // not trimmed: unknown key → default
].forEach(([input, expected]) => {
  test(`resolveApiServer(${JSON.stringify(input)}) → ${expected}`, () => {
    assert.strictEqual(resolveApiServer(input), expected);
  });
});

// ── apiHostFor (pure) ────────────────────────────────────────────────────────
console.log("\n=== apiHostFor (key → host) ===");

["west", "europe", "east"].forEach((key) => {
  test(`apiHostFor(${key}) → ${HOSTS[key]}`, () => {
    assert.strictEqual(apiHostFor(key), HOSTS[key]);
  });
});

test("apiHostFor(invalid) falls back to the default (west) host", () => {
  assert.strictEqual(apiHostFor("garbage"), HOSTS.west);
  assert.strictEqual(apiHostFor(undefined), HOSTS.west);
});

// ── URL builders (pure, exact strings) ───────────────────────────────────────
console.log("\n=== buildPricesUrl / buildHistoryUrl (exact request URLs) ===");

const LOC = "Caerleon,Black Market,Lymhurst";

["west", "europe", "east"].forEach((key) => {
  const host = HOSTS[key];
  test(`buildPricesUrl on ${key} — single item, quality 1`, () => {
    assert.strictEqual(
      buildPricesUrl(host, "T4_BAG", LOC, 1),
      `${host}/api/v2/stats/prices/T4_BAG.json?locations=${LOC}&qualities=1`,
    );
  });
  test(`buildHistoryUrl on ${key} — time-scale 24, quality 1`, () => {
    assert.strictEqual(
      buildHistoryUrl(host, "T4_BAG", LOC, 24, 1),
      `${host}/api/v2/stats/history/T4_BAG.json?locations=${LOC}&time-scale=24&qualities=1`,
    );
  });
});

test("buildPricesUrl — multiple items and multiple qualities", () => {
  const host = HOSTS.europe;
  assert.strictEqual(
    buildPricesUrl(host, "T4_BAG,T5_BAG", LOC, "1,2,3,4,5"),
    `${host}/api/v2/stats/prices/T4_BAG,T5_BAG.json?locations=${LOC}&qualities=1,2,3,4,5`,
  );
});

test("switching host changes only the origin, not the path/query", () => {
  const a = buildPricesUrl(HOSTS.west, "T4_BAG", LOC, 1);
  const b = buildPricesUrl(HOSTS.east, "T4_BAG", LOC, 1);
  assert.strictEqual(a.replace(HOSTS.west, "X"), b.replace(HOSTS.east, "X"));
});

// ── localStorage-backed selection ────────────────────────────────────────────
console.log("\n=== getApiServerKey / getApiHost / setApiServer (persistence) ===");

test("default with empty storage → west / Americas host", () => {
  assert.strictEqual(getApiServerKey(), "west");
  assert.strictEqual(getApiHost(), HOSTS.west);
});

test("setApiServer('europe') persists and is reflected by getters", () => {
  assert.strictEqual(setApiServer("europe"), true);
  assert.strictEqual(_localStorage.apiServer, "europe", "written to localStorage");
  assert.strictEqual(getApiServerKey(), "europe");
  assert.strictEqual(getApiHost(), HOSTS.europe);
});

test("setApiServer('east') switches the host to Asia", () => {
  setApiServer("east");
  assert.strictEqual(getApiServerKey(), "east");
  assert.strictEqual(getApiHost(), HOSTS.east);
});

test("setApiServer(invalid) returns false and does not change selection", () => {
  setApiServer("europe");
  assert.strictEqual(setApiServer("mars"), false);
  assert.strictEqual(getApiServerKey(), "europe", "selection unchanged");
  assert.strictEqual(_localStorage.apiServer, "europe", "garbage not persisted");
});

test("setApiServer(invalid) on a fresh app leaves the default in place", () => {
  assert.strictEqual(setApiServer(""), false);
  assert.strictEqual(getApiServerKey(), "west");
});

test("selection survives a 'reload' (re-read of the same storage)", () => {
  setApiServer("europe");
  // getApiServerKey re-reads localStorage every call — simulates a page reload.
  assert.strictEqual(getApiServerKey(), "europe");
  assert.strictEqual(getApiServerKey(), "europe");
});

test("garbage already in storage → getters fall back to west", () => {
  _localStorage.apiServer = "garbage";
  assert.strictEqual(getApiServerKey(), "west");
  assert.strictEqual(getApiHost(), HOSTS.west);
});

test("round-trip through all three servers", () => {
  for (const key of ["europe", "east", "west"]) {
    assert.strictEqual(setApiServer(key), true);
    assert.strictEqual(getApiServerKey(), key);
    assert.strictEqual(getApiHost(), HOSTS[key]);
  }
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
