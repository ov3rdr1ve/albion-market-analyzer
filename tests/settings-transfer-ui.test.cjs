/**
 * Test: the override maps the Import handler builds before they hit storage.
 *
 * Only the pure map-walking half of js/settings-transfer-ui.js is exercised —
 * per-entry price normalization (normalizeOverrideEntry) has its own tests, so
 * it's stubbed here to keep this about "which cells survive an import".
 *
 * Run: node tests/settings-transfer-ui.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "js", "settings-transfer-ui.js"), "utf-8");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// Stand-in for js/utils.js: keeps numeric buy/sell fields, drops everything else.
function normalizeOverrideEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const out = {};
  if (typeof entry.buyOrder === "number") out.buyOrder = entry.buyOrder;
  if (typeof entry.sellOrder === "number") out.sellOrder = entry.sellOrder;
  return Object.keys(out).length ? out : null;
}

const module_ = { exports: {} };
new Function("normalizeOverrideEntry", "module", SRC)(normalizeOverrideEntry, module_);
const {
  normalizePriceOverrideMap,
  normalizeVolumeOverrideMap,
  normalizeCityForceMap,
} = module_.exports;

console.log("Settings Transfer UI Tests\n");

const PRICE_CASES = [
  { name: "keeps a well-formed cell", input: { T5_METALBAR: { Martlock: { buyOrder: 100 } } }, expected: { T5_METALBAR: { Martlock: { buyOrder: 100 } } } },
  { name: "drops an unusable cell", input: { T5_METALBAR: { Martlock: { note: "x" } } }, expected: {} },
  { name: "drops a non-object city block", input: { T5_METALBAR: 7 }, expected: {} },
  { name: "empty input yields empty output", input: {}, expected: {} },
  { name: "undefined input yields empty output", input: undefined, expected: {} },
];

PRICE_CASES.forEach((c) => {
  test(`prices: ${c.name}`, () => {
    assert.deepStrictEqual(normalizePriceOverrideMap(c.input), c.expected);
  });
});

const VOLUME_CASES = [
  { name: "keeps { volume: N }", input: { T5_METALBAR: { Martlock: { volume: 40 } } }, expected: { T5_METALBAR: { Martlock: { volume: 40 } } } },
  { name: "accepts a bare number cell", input: { T5_METALBAR: { Martlock: 40 } }, expected: { T5_METALBAR: { Martlock: { volume: 40 } } } },
  { name: "drops a non-numeric volume", input: { T5_METALBAR: { Martlock: { volume: "lots" } } }, expected: {} },
  { name: "drops NaN / Infinity", input: { T5_METALBAR: { Martlock: { volume: Infinity } } }, expected: {} },
  { name: "zero is a real volume", input: { T5_METALBAR: { Martlock: { volume: 0 } } }, expected: { T5_METALBAR: { Martlock: { volume: 0 } } } },
];

VOLUME_CASES.forEach((c) => {
  test(`volumes: ${c.name}`, () => {
    assert.deepStrictEqual(normalizeVolumeOverrideMap(c.input), c.expected);
  });
});

const CITY_CASES = [
  { name: "keeps a pinned buy city", input: { T5_METALBAR: { buy: "Thetford" } }, expected: { T5_METALBAR: { buy: "Thetford" } } },
  { name: "keeps both sides", input: { T5_METALBAR: { buy: "Thetford", sell: "Martlock" } }, expected: { T5_METALBAR: { buy: "Thetford", sell: "Martlock" } } },
  { name: "ignores unknown side keys", input: { T5_METALBAR: { buy: "Thetford", craft: "Lymhurst" } }, expected: { T5_METALBAR: { buy: "Thetford" } } },
  { name: "drops an empty city string", input: { T5_METALBAR: { buy: "" } }, expected: {} },
  { name: "drops a non-string city", input: { T5_METALBAR: { buy: 3 } }, expected: {} },
];

CITY_CASES.forEach((c) => {
  test(`cities: ${c.name}`, () => {
    assert.deepStrictEqual(normalizeCityForceMap(c.input), c.expected);
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
