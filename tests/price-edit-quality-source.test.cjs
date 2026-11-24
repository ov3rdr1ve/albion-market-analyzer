/**
 * Which order book the inline price editor opens, and what its two fields
 * prefill with — the data half of the js/app.js price-editable click handler,
 * extracted so it can be tested without a DOM:
 *
 *   resolveEditSource(realItemId, qualityAttr, flatMap, qualityMap)
 *     → { itemId, quality, marketSource }
 *     qualityAttr is the cell's raw data-quality attribute (string or null).
 *     No attribute → the plain id and the flat (Normal) map. An attribute →
 *     the per-quality override key (qualityOverrideKey, js/utils.js) and that
 *     quality's book, flattened into { [key]: { [city]: cell } }.
 *
 *   editorFieldValue(eid, city, side, marketSource) → number
 *     The SELL ORDER / BUY ORDER input prefill: a stored override field wins,
 *     else the market field, else 0 (an empty input).
 *
 * Both exported from js/price-edit-dropdown.js.
 *
 * Reported: the planner's Elder's Shadowcaller Sell cell (priced from a
 * quality-4 ask, 29,999,980) opened the Normal book: an empty SELL ORDER field
 * beside a 3,999,999 bid. Once the cell carries data-quality="4"
 * (tests/craft-planner-sell-quality-cell.test.cjs) the editor must open the q4
 * book. A Normal cell keeps an EMPTY sell field even when a Good+ ask exists —
 * the dropdown's quality hint is display only and must never be prefilled into
 * the Normal cell (tests/price-edit-dropdown-quality-hint.test.cjs).
 *
 * Run: node tests/price-edit-quality-source.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

// The REAL qualityOverrideKey, sliced out of js/utils.js (no copy).
const utilsSrc = ["utils", "utils-item-ids", "utils-overrides", "utils-focus-fees"].map((n) => fs.readFileSync(path.join(__dirname, "..", "js", n + ".js"), "utf8")).join("\n").replace(/\r\n/g, "\n");
const keySrc = utilsSrc.match(/function qualityOverrideKey\([\s\S]*?\n}\n/);
assert.ok(keySrc, "could not locate qualityOverrideKey in js/utils.js");
const keyMod = new Module("quality-override-key");
keyMod._compile(keySrc[0] + "\nmodule.exports = qualityOverrideKey;", "utils.js");
globalThis.qualityOverrideKey = keyMod.exports;

let _priceOverrides = {};
globalThis.CITIES = ["Caerleon", "Lymhurst", "Fort Sterling", "Martlock"];
globalThis.SELL_CITIES = [...globalThis.CITIES, "Black Market"];
globalThis.FOOD_ITEMS = { meat: [], plants: [], chocolate: [] };
globalThis.getOverridePrice = (itemId, city) => {
  const e = _priceOverrides[itemId]?.[city];
  if (e == null || !e.use) return null;
  const v = e.use === "buy" ? e.buyOrder : e.sellOrder;
  return typeof v === "number" ? v : null;
};
globalThis.getOverrideField = (itemId, city, side) => {
  const e = _priceOverrides[itemId]?.[city];
  if (!e) return null;
  return (side === "buy" ? e.buyOrder : e.sellOrder) ?? null;
};
globalThis.getOrderType = () => "market";
globalThis.getItemDisplayName = (id) => id;

const dropdown = require("../js/price-edit-dropdown.js");
const { buildCityOptions, resolveEditSource, editorFieldValue } = dropdown;

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    assert.strictEqual(typeof resolveEditSource, "function",
      "js/price-edit-dropdown.js must export resolveEditSource");
    assert.strictEqual(typeof editorFieldValue, "function",
      "js/price-edit-dropdown.js must export editorFieldValue");
    fn(); console.log(`  PASS: ${name}`); passed++;
  } catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
  finally { _priceOverrides = {}; globalThis.lastQualityMarketData = {}; }
}

const FS = "Fort Sterling";
const ITEM = "T8_MAIN_CURSEDSTAFF_AVALON@4";

// The captured state from the report: Normal book bid-only, asks at q4.
const FLAT = { [ITEM]: { [FS]: { buy_price: 3999999, sell_price: 0, sell_seen: "2026-10-01T10:00:00Z" } } };
const QMAP = {
  [ITEM]: {
    1: { [FS]: { buy_price: 3999999, sell_price: 0 } },
    4: { [FS]: { buy_price: 5000000, sell_price: 29999980 }, Lymhurst: { buy_price: 0, sell_price: 31000000 } },
    5: { [FS]: { buy_price: 0, sell_price: 45000000 } },
  },
};

/** The two prefilled inputs of an editor opened on (item, data-quality) at `city`. */
function openEditor(qualityAttr, city = FS, flat = FLAT, qmap = QMAP) {
  globalThis.lastQualityMarketData = qmap;
  const src = resolveEditSource(ITEM, qualityAttr, flat, qmap);
  return {
    src,
    sell: editorFieldValue(src.itemId, city, "sell", src.marketSource),
    buy: editorFieldValue(src.itemId, city, "buy", src.marketSource),
  };
}

console.log("price editor — the book a quality cell opens\n");

// ── Which book ───────────────────────────────────────────────────────────────

[
  { attr: null, itemId: ITEM, quality: null },
  { attr: undefined, itemId: ITEM, quality: null },
  { attr: "2", itemId: `${ITEM}#Q2`, quality: 2 },
  { attr: "4", itemId: `${ITEM}#Q4`, quality: 4 },
  { attr: "5", itemId: `${ITEM}#Q5`, quality: 5 },
].forEach(({ attr, itemId, quality }) => {
  test(`data-quality=${JSON.stringify(attr)} → key ${itemId}, quality ${quality}`, () => {
    const { src } = openEditor(attr);
    assert.strictEqual(src.itemId, itemId);
    assert.strictEqual(src.quality, quality);
  });
});

test("no data-quality → the flat Normal map itself", () => {
  const { src } = openEditor(null);
  assert.strictEqual(src.marketSource, FLAT);
});

test("data-quality=4 → that quality's book, flattened under the quality key", () => {
  const { src } = openEditor("4");
  assert.deepStrictEqual(src.marketSource, { [`${ITEM}#Q4`]: QMAP[ITEM][4] });
});

// ── What the fields prefill with ─────────────────────────────────────────────

[
  { name: "q4 cell at Fort Sterling", attr: "4", city: FS, sell: 29999980, buy: 5000000 },
  { name: "q4 cell, Lymhurst picked in the dropdown", attr: "4", city: "Lymhurst", sell: 31000000, buy: 0 },
  { name: "q5 cell at Fort Sterling", attr: "5", city: FS, sell: 45000000, buy: 0 },
  { name: "Normal cell (reported) — sell stays EMPTY despite the q4 ask", attr: null, city: FS, sell: 0, buy: 3999999 },
  { name: "q2 cell with no q2 book → both empty", attr: "2", city: FS, sell: 0, buy: 0 },
].forEach(({ name, attr, city, sell, buy }) => {
  test(`fields: ${name} → SELL ${sell} / BUY ${buy}`, () => {
    const f = openEditor(attr, city);
    assert.strictEqual(f.sell, sell, "SELL ORDER prefill");
    assert.strictEqual(f.buy, buy, "BUY ORDER prefill");
  });
});

test("the q4 popup's dropdown lists the q4 ask and bid at Fort Sterling", () => {
  const { src } = openEditor("4");
  const built = buildCityOptions(src.itemId, "sell", src.marketSource, { preferCity: FS });
  const opt = built.options[built.defaultIndex];
  assert.strictEqual(opt.city, FS, "preferCity pins the clicked city");
  assert.strictEqual(opt.sell, 29999980);
  assert.strictEqual(opt.buy, 5000000);
  assert.ok(opt.label.startsWith("Fort Sterling — 29,999,980 · 5,000,000"), "label: " + opt.label);
});

// ── Overrides stay per quality ───────────────────────────────────────────────

test("a q4 override prefills the q4 popup, not the Normal one", () => {
  _priceOverrides = { [`${ITEM}#Q4`]: { [FS]: { sellOrder: 25000000, use: "sell" } } };
  const q4 = openEditor("4");
  _priceOverrides = { [`${ITEM}#Q4`]: { [FS]: { sellOrder: 25000000, use: "sell" } } };
  const normal = openEditor(null);
  assert.strictEqual(q4.sell, 25000000, "q4 field shows the q4 override");
  assert.strictEqual(normal.sell, 0, "the Normal field does not see a q4 override");
});

test("a Normal override never prefills the q4 popup", () => {
  _priceOverrides = { [ITEM]: { [FS]: { sellOrder: 12345, use: "sell" } } };
  const q4 = openEditor("4");
  assert.strictEqual(q4.sell, 29999980, "q4 field still reads the q4 book");
});

// ── Edges ────────────────────────────────────────────────────────────────────

[
  { name: "quality map null", qmap: null },
  { name: "quality map without the item", qmap: { T4_OTHER: { 4: { [FS]: { sell_price: 1 } } } } },
  { name: "quality map without that quality", qmap: { [ITEM]: { 2: { [FS]: { sell_price: 1 } } } } },
].forEach(({ name, qmap }) => {
  test(`q4 cell, ${name} → empty fields, no throw`, () => {
    const f = openEditor("4", FS, FLAT, qmap);
    assert.strictEqual(f.src.itemId, `${ITEM}#Q4`, "the key stays per quality");
    assert.strictEqual(f.sell, 0);
    assert.strictEqual(f.buy, 0);
  });
});

test("negative / zero market fields prefill as 0", () => {
  const f = openEditor("4", FS, FLAT, { [ITEM]: { 4: { [FS]: { buy_price: -3, sell_price: 0 } } } });
  assert.ok(!(f.sell > 0), "sell: " + f.sell);
  assert.ok(!(f.buy > 0), "buy: " + f.buy);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
