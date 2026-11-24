/**
 * Unit test for js/app.js priceTd(): the 24h VOLUME must render independently
 * of the price AGE.
 *
 * Reported bug: a refined-good sell cell showed no "· N vol" even though the
 * order book carried a live 24h volume. Cause: the volume string was nested
 * inside the age badge, which only rendered when formatPriceAge(sell_date) was
 * truthy. AODP frequently returns a stale/absent sell_date ("0001-01-01" →
 * age null) alongside a real volume, so the volume was silently hidden.
 *
 * Extracts the REAL formatPriceAge + priceTd from js/app.js (no copy) and drives
 * them with a stubbed lastMarketData. Run:
 *   node tests/pricetd-volume-independent-of-age.test.cjs
 */

const assert = require("assert");
const { appSource } = require("./helpers/app-source.cjs");
const Module = require("module");
// Cell text runs through tx(english, slug); en-mode identity keeps assertions in English.
globalThis.tx = globalThis.tx || ((en) => en);

const src = appSource();
// Slice the two functions we need (formatPriceAge … end of priceTd, i.e. the
// text just before pureProfitTd). matPriceSpan sits between them — harmless.
const start = src.indexOf("function formatPriceAge");
const end = src.indexOf("function pureProfitTd");
assert.ok(start >= 0 && end > start, "could not locate priceTd slice in app.js");
const slice = src.slice(start, end);

const sandbox = `
let lastMarketData = null;
function getOverridePrice() { return null; }
function getOverrideField() { return null; }
function qualityOverrideKey(id, q) { return id + "|q" + q; }
function formatSilver(n) { return Math.round(n).toLocaleString(); }
function __setMarket(md) { lastMarketData = md; }
`;

const mod = new Module("pricetd-test");
mod._compile(
  sandbox + slice + "\nmodule.exports = { priceTd, formatPriceAge, __setMarket };",
  "app.js",
);
const { priceTd, __setMarket } = mod.exports;

// A recent date (relative to now, without hard-coding a year) so age is valid.
const recentIso = new Date(Date.now() - 3 * 3600000).toISOString(); // 3h ago

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); console.log(`  PASS: ${name}`); passed++; } catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; } }

console.log("priceTd × volume independent of age\n");

test("stale sell_date (age null) still shows the volume", () => {
  __setMarket({ T8_LEATHER: { "Fort Sterling": { sell_price: 42094, volume_24h: 60451, sell_date: "0001-01-01T00:00:00" } } });
  const html = priceTd(42094, "T8_LEATHER", "Fort Sterling");
  assert.ok(html.includes("60,451 vol"), `expected volume in cell, got: ${html}`);
  assert.ok(!html.includes("ago"), "no age label expected for a year<2015 date");
});

test("valid recent date shows BOTH age and volume", () => {
  __setMarket({ T8_LEATHER: { "Fort Sterling": { sell_price: 42094, volume_24h: 60451, sell_date: recentIso } } });
  const html = priceTd(42094, "T8_LEATHER", "Fort Sterling");
  assert.ok(html.includes("ago"), "expected an age label");
  assert.ok(html.includes("· 60,451 vol"), `expected '· 60,451 vol', got: ${html}`);
});

test("zero volume renders no vol string (age still shows)", () => {
  __setMarket({ T8_LEATHER: { "Fort Sterling": { sell_price: 42094, volume_24h: 0, sell_date: recentIso } } });
  const html = priceTd(42094, "T8_LEATHER", "Fort Sterling");
  assert.ok(!html.includes("vol"), `no vol string expected, got: ${html}`);
  assert.ok(html.includes("ago"), "age still shows");
});

test("no price → no age/vol badge at all", () => {
  __setMarket({ T8_LEATHER: { "Fort Sterling": { sell_price: 0, volume_24h: 60451, sell_date: recentIso } } });
  const html = priceTd(0, "T8_LEATHER", "Fort Sterling");
  assert.ok(!html.includes("vol"), "no-data cell must not show volume");
  assert.ok(html.includes("no data"), "no-data cell shows the click-to-set hint");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
