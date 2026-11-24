/**
 * Tests for quality-aware price overrides in the Quality Rerolling table.
 *
 * Bug being guarded: price overrides were keyed (itemId, city) only — no
 * quality. The same item at Normal/Good/Outstanding/Excellent shares one
 * itemId, so an override on one quality bled onto all the others, and a buy
 * override bled onto the sell side (qualities 2/3/4 appear as BOTH `from` and
 * `to` in QUALITY_TRANSITIONS). The fix routes rerolling overrides through a
 * per-quality synthetic key (`qualityOverrideKey`) and reads them side-
 * specifically inside getQualityBuyPrice / getQualitySellPrice.
 *
 * Black-box: compile js/utils.js in a sandbox (stub document + localStorage),
 * then exercise the real override + quality-price functions.
 *
 * Run: node tests/rerolling-quality-overrides.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const utilsSrc = ["utils", "utils-item-ids", "utils-overrides", "utils-focus-fees"].map((n) => fs.readFileSync(path.join(__dirname, "..", "js", n + ".js"), "utf8")).join("\n");
const mod = new Module("rerolling-quality-overrides-test");
// Minimal browser shims: getOrderType reads a radio (absent ⇒ "market");
// the override store persists to localStorage on every write.
const sandbox = `
const _ls = {};
const localStorage = {
  getItem: (k) => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: (k) => { delete _ls[k]; },
};
const document = { getElementById: () => null };
`;
const exportLine =
  "\nmodule.exports = { qualityOverrideKey, getQualityBuyPrice, getQualitySellPrice, setOverrideEntry, getOverrideField, clearOverridePrice };";
mod._compile(sandbox + utilsSrc + exportLine, "utils.js");
const {
  qualityOverrideKey,
  getQualityBuyPrice,
  getQualitySellPrice,
  setOverrideEntry,
  clearOverridePrice,
} = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const ITEM = "T8_SHOES_PLATE_SET3";
// qualityData shape: [itemId][quality][city]
const qd = {
  [ITEM]: {
    1: { Lymhurst: { buy_price: 50, sell_price: 60 } },   // Normal
    2: { Lymhurst: { buy_price: 500, sell_price: 600 } }, // Good (from AND to)
    4: { Thetford: { buy_price: 90000, sell_price: 100000 } }, // Excellent
  },
};

// Store a buy/sell override at a per-quality key.
function setQualityOverride(quality, city, { buyOrder, sellOrder, use }) {
  setOverrideEntry(qualityOverrideKey(ITEM, quality), city, { buyOrder, sellOrder, use });
}
function clearAll() {
  [1, 2, 4].forEach((q) => {
    ["Lymhurst", "Thetford"].forEach((c) => clearOverridePrice(qualityOverrideKey(ITEM, q), c));
  });
}

console.log("\n=== Quality rerolling overrides ===");

test("qualityOverrideKey encodes quality and round-trips null", () => {
  assert.strictEqual(qualityOverrideKey(ITEM, 4), `${ITEM}#Q4`);
  assert.strictEqual(qualityOverrideKey(ITEM, 1), `${ITEM}#Q1`);
  assert.strictEqual(qualityOverrideKey(ITEM, null), ITEM);
  assert.strictEqual(qualityOverrideKey(ITEM, undefined), ITEM);
});

test("no override → market price (buy reads buy_price, sell reads sell_price)", () => {
  clearAll();
  assert.strictEqual(getQualityBuyPrice(qd, ITEM, 1, "Lymhurst"), 50);
  assert.strictEqual(getQualitySellPrice(qd, ITEM, 4, "Thetford"), 100000);
});

test("buy override wins for its quality+city", () => {
  clearAll();
  setQualityOverride(1, "Lymhurst", { buyOrder: 42, use: "buy" });
  assert.strictEqual(getQualityBuyPrice(qd, ITEM, 1, "Lymhurst"), 42);
});

test("sell override wins for its quality+city", () => {
  clearAll();
  setQualityOverride(4, "Thetford", { sellOrder: 125110, use: "sell" });
  assert.strictEqual(getQualitySellPrice(qd, ITEM, 4, "Thetford"), 125110);
});

test("override on one quality does NOT bleed onto another quality", () => {
  clearAll();
  setQualityOverride(1, "Lymhurst", { buyOrder: 42, use: "buy" }); // Normal only
  // Good (quality 2) at the same city must keep its market price.
  assert.strictEqual(getQualityBuyPrice(qd, ITEM, 2, "Lymhurst"), 500);
});

test("active override is the single effective price for a quality+city (app convention)", () => {
  clearAll();
  // Matches getBuyPrice/getSellPrice: the ACTIVE order is THE price for an
  // item+city in every context. With the quality key, that scoping is
  // per-quality — but within one quality+city the active value drives both
  // the buy and the sell read (one override entry, one effective price).
  setQualityOverride(2, "Lymhurst", { buyOrder: 444, use: "buy" });
  assert.strictEqual(getQualityBuyPrice(qd, ITEM, 2, "Lymhurst"), 444);
  assert.strictEqual(getQualitySellPrice(qd, ITEM, 2, "Lymhurst"), 444);
});

test("Instant-mode buy edit (use=sell) is honored — regression: no reset to default", () => {
  clearAll();
  // The reported bug: editing a buy cell in Instant mode marks the SELL order
  // active (instant-buy-at-ask), so the typed value lands in sellOrder. A
  // side-specific buy read returned the prefilled market buyOrder instead and
  // the row "reset to default". The active read must return the user's value.
  setQualityOverride(1, "Lymhurst", { buyOrder: 50 /* prefilled market */, sellOrder: 777, use: "sell" });
  assert.strictEqual(getQualityBuyPrice(qd, ITEM, 1, "Lymhurst"), 777, "honors the active (sell) order, not the stale buy field");
});

test("override applies even when that quality has no market data at the city", () => {
  clearAll();
  // Quality 4 was never scanned at Lymhurst — override still surfaces.
  setQualityOverride(4, "Lymhurst", { sellOrder: 88000, use: "sell" });
  assert.strictEqual(getQualitySellPrice(qd, ITEM, 4, "Lymhurst"), 88000);
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
