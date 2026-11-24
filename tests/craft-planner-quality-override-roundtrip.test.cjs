/**
 * Round trip: a price saved from a QUALITY-keyed editor (data-quality="q" on
 * the planner's Sell cell) must change the Crafting Planner's sell price on the
 * next calculation.
 *
 * The editor stores a quality cell's override under qualityOverrideKey(id, q)
 * = "<id>#Q<q>" (js/app.js, js/utils.js). The planner's quality fallback
 * (js/craft-planner-quality.js _cpQualityAskFor / _cpSelectSell) read only the
 * raw quality book, so an edit made from the Excellent-ask cell was saved and
 * then ignored — the cell would keep printing the captured ask.
 *
 * Contract:
 *   - an active override at "<id>#Q<q>" for a city IS that city's quality-q
 *     ask for the fallback: it replaces the book's ask there, and it creates
 *     a candidate in a city whose book has no quality-q ask;
 *   - the tier rule is unchanged (lowest quality with an ask wins, then best
 *     net margin within it), so a quality-3 override outranks a quality-4 book;
 *   - a zero / absent override is no override; clearing it restores the book;
 *   - a Normal (plain id) override still prices tier 1, quality-less.
 *
 * Black-box over computeCraftPlannerRow via the shared pricing harness
 * (overrides keyed "<id>:<city>", exactly the editor's key + city).
 *
 * Run: node tests/craft-planner-quality-override-roundtrip.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");
const H = require("./helpers/craft-planner-pricing-harness.cjs");
const { computeCraftPlannerRow, __setOverrides, __setQualityMarketData, __reset } = H;

// The editor's key derivation (resolveEditSource, js/price-edit-dropdown.js)
// needs the REAL qualityOverrideKey, sliced out of js/utils.js.
const utilsSrc = ["utils", "utils-item-ids", "utils-overrides", "utils-focus-fees"].map((n) => fs.readFileSync(path.join(__dirname, "..", "js", n + ".js"), "utf8")).join("\n").replace(/\r\n/g, "\n");
const keySrc = utilsSrc.match(/function qualityOverrideKey\([\s\S]*?\n}\n/);
assert.ok(keySrc, "could not locate qualityOverrideKey in js/utils.js");
const keyMod = new Module("quality-override-key");
keyMod._compile(keySrc[0] + "\nmodule.exports = qualityOverrideKey;", "utils.js");
globalThis.qualityOverrideKey = keyMod.exports;
const { resolveEditSource } = require("../js/price-edit-dropdown.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { __reset(); fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const FS = "Fort Sterling";
const ITEM = "T8_FURNITUREITEM_TABLE";
const TABLE = { id: ITEM, name: "Elder's Table", craftType: null };
const TABLE_MATS = [{ matId: "T8_PLANKS", count: 30 }];

// Materials priced; the product has NO Normal ask (a bid only, as reported).
function flatMarket() {
  return {
    T8_PLANKS: { [FS]: { buy_price: 1000, sell_price: 0, volume_24h: 9999 } },
    [ITEM]: { [FS]: { buy_price: 3999999, sell_price: 0, volume_24h: 9999 } },
  };
}
// The captured quality book: asks at q4 in Fort Sterling only.
const QMAP = {
  [ITEM]: {
    1: { [FS]: { buy_price: 3999999, sell_price: 0 } },
    4: { [FS]: { buy_price: 5000000, sell_price: 29999980 } },
  },
};

function row() {
  __setQualityMarketData(QMAP);
  return computeCraftPlannerRow(TABLE, TABLE_MATS, flatMarket(), FS);
}

console.log("Craft Planner — quality-keyed price edit round trip\n");

test("baseline: no override → the q4 book ask prices the row", () => {
  const r = row();
  assert.ok(!r.noData, "the q4 ask prices the row");
  assert.strictEqual(r.sellCity, FS);
  assert.strictEqual(r.sellPrice, 29999980);
  assert.strictEqual(r.sellQuality, 4);
});

test("an edit saved from the q4 Sell cell's editor reprices the row", () => {
  assert.strictEqual(typeof resolveEditSource, "function",
    "js/price-edit-dropdown.js must export resolveEditSource");
  // The cell the planner renders for this row carries data-quality="4"; the
  // editor resolves its override key from it and saves at the clicked city.
  const before = row();
  const { itemId: key } = resolveEditSource(ITEM, String(before.sellQuality), flatMarket(), QMAP);
  __setOverrides({ [`${key}:${FS}`]: 25000000 });
  const after = row();
  assert.strictEqual(after.sellPrice, 25000000, "the saved q4 price is what the planner sells at");
  assert.strictEqual(after.sellCity, FS);
  assert.strictEqual(after.sellQuality, 4);
});

[
  {
    name: "q4 override at Fort Sterling replaces the book ask",
    overrides: { [`${ITEM}#Q4:${FS}`]: 25000000 },
    want: { sellCity: FS, sellPrice: 25000000, sellQuality: 4 },
  },
  {
    name: "q4 override in a city with no q4 book (Lymhurst) becomes a candidate and wins on margin",
    overrides: { [`${ITEM}#Q4:Lymhurst`]: 31000000 },
    want: { sellCity: "Lymhurst", sellPrice: 31000000, sellQuality: 4 },
  },
  {
    name: "q3 override outranks the q4 book (lowest quality tier wins)",
    overrides: { [`${ITEM}#Q3:${FS}`]: 20000000 },
    want: { sellCity: FS, sellPrice: 20000000, sellQuality: 3 },
  },
  {
    name: "q5 override does not displace the q4 tier",
    overrides: { [`${ITEM}#Q5:${FS}`]: 99000000 },
    want: { sellCity: FS, sellPrice: 29999980, sellQuality: 4 },
  },
  {
    name: "a zero q4 override is no override",
    overrides: { [`${ITEM}#Q4:${FS}`]: 0 },
    want: { sellCity: FS, sellPrice: 29999980, sellQuality: 4 },
  },
  {
    name: "a Normal (plain id) override still prices tier 1, quality-less",
    overrides: { [`${ITEM}:${FS}`]: 10000000 },
    want: { sellCity: FS, sellPrice: 10000000, sellQuality: null },
  },
].forEach(({ name, overrides, want }) => {
  test(name, () => {
    __setOverrides(overrides);
    const r = row();
    assert.ok(!r.noData, "row should be priced");
    assert.strictEqual(r.sellCity, want.sellCity, "sellCity");
    assert.strictEqual(r.sellPrice, want.sellPrice, "sellPrice");
    assert.strictEqual(r.sellQuality == null ? null : r.sellQuality, want.sellQuality, "sellQuality");
  });
});

test("clearing the q4 override restores the book ask", () => {
  __setOverrides({ [`${ITEM}#Q4:${FS}`]: 25000000 });
  row();
  __setOverrides({});
  const r = row();
  assert.strictEqual(r.sellPrice, 29999980);
  assert.strictEqual(r.sellQuality, 4);
});

test("a q4 override with no quality book at all still prices the row", () => {
  __setOverrides({ [`${ITEM}#Q4:${FS}`]: 25000000 });
  __setQualityMarketData({});
  const r = computeCraftPlannerRow(TABLE, TABLE_MATS, flatMarket(), FS);
  assert.ok(!r.noData, "the saved q4 price is a sale even without a captured book");
  assert.strictEqual(r.sellPrice, 25000000);
  assert.strictEqual(r.sellQuality, 4);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
