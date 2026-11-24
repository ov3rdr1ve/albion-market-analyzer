/**
 * Test: a BUY leg reads the cheapest captured quality when quality 1 has no
 * price on that side. Sell legs stay quality 1.
 *
 * Reported (sniffer "no prices"): the flat price map every table reads is
 * projected from quality 1 alone (flattenCaptured(map, 1)), so a book holding
 * only Good / Outstanding asks left the row blank. Any quality works as a craft
 * input, so the buy leg may take them. Decision (2026-09-10): "Buy legs:
 * cheapest any quality". A crafted output is Normal, so the sell leg does not.
 *
 * The per-quality book is the app's capture-merged quality map
 * (lastQualityMarketData). It is consulted only for the LIVE flat cell of that
 * item — a synthetic view (the ITEM#Q2 quality views, a test's own map) is left
 * alone.
 *
 * Black box over the REAL js/utils.js + js/price-book-fallback.js.
 *
 * Run: node tests/captured-buy-any-quality.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const _radios = { "buy-instant": { checked: false }, "sell-instant": { checked: false } };
const sandbox = {};
sandbox.window = sandbox;
sandbox.console = console;
sandbox.document = { getElementById: (id) => _radios[id] || null, querySelector: () => null };
sandbox.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const read = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");
vm.runInContext(
  "var lastMarketData = null; var lastQualityMarketData = null;\n"
    + read("price-book-fallback.js") + "\n" + (read("utils.js") + read("utils-item-ids.js") + read("utils-overrides.js") + read("utils-focus-fees.js"))
    + `
;globalThis.__exp = { getBuyPrice, getSellPrice,
  setMaps(flat, quality) { lastMarketData = flat; lastQualityMarketData = quality; } };`,
  vm.createContext(sandbox),
  { filename: "utils.js" },
);
const { getBuyPrice, getSellPrice, setMaps } = sandbox.__exp;

function setMode(mode) {
  _radios["buy-instant"].checked = mode === "instant";
  _radios["sell-instant"].checked = mode === "instant";
}

let passed = 0, failed = 0;
function test(name, fn) {
  setMode("market");
  setMaps(null, null);
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const ID = "T6_2H_ROOTBOUND";
const cell = (buy, sell) => ({ buy_price: buy, sell_price: sell, volume_24h: 0 });

/** A live flat map whose Lymhurst q1 cell is `q1`, plus the quality map. */
function live(q1, byQuality) {
  const flat = { [ID]: { Lymhurst: q1 } };
  const quality = { [ID]: {} };
  Object.entries(byQuality).forEach(([q, c]) => { quality[ID][q] = { Lymhurst: c }; });
  quality[ID][1] = { Lymhurst: q1 };
  setMaps(flat, quality);
  return flat[ID];
}

console.log("Buy legs read any captured quality when quality 1 is empty\n");

test("instant buy, no Normal ask: the cheapest Good/Outstanding ask", () => {
  setMode("instant");
  const itemData = live(cell(0, 0), { 2: cell(0, 698874), 3: cell(0, 698941) });
  assert.strictEqual(getBuyPrice(itemData, "Lymhurst", null, ID), 698874);
});

test("an item with only Good captures (no flat entry at all) still prices its buy leg", () => {
  setMode("instant");
  // flattenCaptured(map, 1) projects nothing for it, so the flat map has no entry.
  setMaps({}, { [ID]: { 2: { Lymhurst: cell(0, 698874) } } });
  assert.strictEqual(getBuyPrice(undefined, "Lymhurst", null, ID), 698874);
  assert.strictEqual(getSellPrice(undefined, "Lymhurst", null, ID), 0, "sell leg stays quality 1");
});

test("instant buy prefers any-quality ask over the other-side bid", () => {
  setMode("instant");
  const itemData = live(cell(500000, 0), { 2: cell(0, 698874) });
  assert.strictEqual(getBuyPrice(itemData, "Lymhurst", null, ID), 698874,
    "an ask at some quality is a real instant fill; a bid never is");
});

test("a Normal ask still wins over a cheaper higher-quality one", () => {
  setMode("instant");
  const itemData = live(cell(0, 700000), { 3: cell(0, 650000) });
  assert.strictEqual(getBuyPrice(itemData, "Lymhurst", null, ID), 700000);
});

test("market buy, no Normal bid: the fattest bid at any quality", () => {
  setMode("market");
  const itemData = live(cell(0, 0), { 2: cell(610000, 0), 4: cell(640000, 0) });
  assert.strictEqual(getBuyPrice(itemData, "Lymhurst", null, ID), 640000);
});

test("sell legs stay quality 1 — a Good ask is not a Normal sale", () => {
  setMode("market");
  const itemData = live(cell(0, 0), { 2: cell(610000, 698874) });
  assert.strictEqual(getSellPrice(itemData, "Lymhurst", null, ID), 0);
  setMode("instant");
  assert.strictEqual(getSellPrice(itemData, "Lymhurst", null, ID), 0);
});

test("a synthetic map (not the live cell) never reads the quality map", () => {
  setMode("instant");
  live(cell(0, 0), { 2: cell(0, 698874) });
  const view = { Lymhurst: cell(0, 0) };
  assert.strictEqual(getBuyPrice(view, "Lymhurst", null, ID), 0);
});

test("no quality map loaded: unchanged", () => {
  setMode("instant");
  const flat = { [ID]: { Lymhurst: cell(0, 0) } };
  setMaps(flat, null);
  assert.strictEqual(getBuyPrice(flat[ID], "Lymhurst", null, ID), 0);
});

test("another city's quality cells are never borrowed", () => {
  setMode("instant");
  const flat = { [ID]: { Lymhurst: cell(0, 0) } };
  setMaps(flat, { [ID]: { 2: { Martlock: cell(0, 698874) } } });
  assert.strictEqual(getBuyPrice(flat[ID], "Lymhurst", null, ID), 0);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
