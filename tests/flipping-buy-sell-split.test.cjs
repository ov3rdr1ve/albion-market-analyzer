/**
 * Test: the Flipping table reads buy and sell overrides SIDE-SPECIFICALLY.
 *
 * Flipping is the one table where a single (itemId, city) is both bought AND
 * sold in the same row — e.g. "Buy: Fort Sterling -> Sell: Fort Sterling". The
 * generic override store keeps ONE active pick (`use`) per (itemId, city), and
 * every other table reads that single active value (getOverridePrice). For
 * flipping that collapses the two cells onto one number: set the buy price and
 * the sell cell showed the same value (the reported bug).
 *
 * The fix: in "side mode", the buy cell reads the stored buyOrder field and the
 * sell cell reads the stored sellOrder field, ignoring `use`. A missing field
 * falls through to the market (NOT to the other side's order). All other tables
 * omit side mode and keep the active-pick behaviour.
 *
 * Black-box over a faithful in-file replica of js/utils.js (same pattern as
 * tests/order-type-pricing.test.cjs and price-override-buy-sell-split.test.cjs
 * — no DOM, no live API).
 *
 * Run: node tests/flipping-buy-sell-split.test.cjs
 */

const assert = require("assert");

// ── order-type mock ──────────────────────────────────────────────────────
let _instantChecked = false; // default: market
function getOrderType() {
  return _instantChecked ? "instant" : "market";
}
function setMode(mode) {
  _instantChecked = mode === "instant";
}

// ── Replica of the override store (mirrors js/utils.js) ──────────────────
let priceOverrides = {};

function setOverrideEntry(itemId, city, { buyOrder, sellOrder, use }) {
  if (!priceOverrides[itemId]) priceOverrides[itemId] = {};
  const e = {};
  if (typeof buyOrder === "number" && buyOrder > 0) e.buyOrder = buyOrder;
  if (typeof sellOrder === "number" && sellOrder > 0) e.sellOrder = sellOrder;
  if (use === "buy" || use === "sell") e.use = use;
  const activePresent = e.use === "buy" ? e.buyOrder !== undefined
    : e.use === "sell" ? e.sellOrder !== undefined : false;
  if (activePresent) priceOverrides[itemId][city] = e;
  else delete priceOverrides[itemId][city];
}

function getOverrideField(itemId, city, side) {
  const e = priceOverrides[itemId]?.[city];
  if (!e) return null;
  return (side === "buy" ? e.buyOrder : e.sellOrder) ?? null;
}
function getOverridePrice(itemId, city) {
  const e = priceOverrides[itemId]?.[city];
  if (!e || !e.use) return null;
  const v = e.use === "buy" ? e.buyOrder : e.sellOrder;
  return typeof v === "number" ? v : null;
}

// ── Replica of getBuyPrice / getSellPrice WITH the sideMode flag ─────────
function getBuyPrice(itemData, city, bounds, itemId, sideMode) {
  const ov = itemId
    ? (sideMode ? getOverrideField(itemId, city, "buy") : getOverridePrice(itemId, city))
    : null;
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return (getOrderType() === "instant" ? itemData[city].sell_price : itemData[city].buy_price) || 0;
}
function getSellPrice(itemData, city, bounds, itemId, sideMode) {
  const ov = itemId
    ? (sideMode ? getOverrideField(itemId, city, "sell") : getOverridePrice(itemId, city))
    : null;
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  const isBm = city === "Black Market";
  return ((isBm || getOrderType() === "instant") ? itemData[city].buy_price : itemData[city].sell_price) || 0;
}

// ── Mini findBest*City honouring sideMode for the volume bypass ──────────
function findBestBuyCity(marketData, itemId, cities, minVolume, sideMode) {
  let bestPrice = 0, bestCity = null, bestEff = Infinity;
  cities.forEach((c) => {
    const p = getBuyPrice(marketData[itemId], c, null, itemId, sideMode);
    const v = marketData[itemId]?.[c]?.volume_24h || 0;
    const hasOv = sideMode
      ? getOverrideField(itemId, c, "buy") !== null
      : getOverridePrice(itemId, c) !== null;
    if (p > 0 && (v >= minVolume || hasOv)) {
      if (p < bestEff) { bestEff = p; bestCity = c; bestPrice = p; }
    }
  });
  return { city: bestCity, price: bestCity ? bestPrice : 0 };
}
function findBestSellCity(marketData, itemId, cities, minVolume, sideMode) {
  let bestPrice = 0, bestCity = null, bestNet = -Infinity;
  cities.forEach((c) => {
    const p = getSellPrice(marketData[itemId], c, null, itemId, sideMode);
    const v = marketData[itemId]?.[c]?.volume_24h || 0;
    const hasOv = sideMode
      ? getOverrideField(itemId, c, "sell") !== null
      : getOverridePrice(itemId, c) !== null;
    if (p > 0 && (v >= minVolume || hasOv)) {
      if (p > bestNet) { bestNet = p; bestCity = c; bestPrice = p; }
    }
  });
  return { city: bestCity, price: bestPrice };
}

// ── Test harness ─────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function test(name, fn) {
  try {
    priceOverrides = {};
    setMode("market");
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

const FS = "Fort Sterling";
const MD = {
  BAG: { [FS]: { buy_price: 100, sell_price: 150, volume_24h: 100 } },
};

console.log("Flipping Buy/Sell Split Tests\n");

// ── the reported bug: same city, split prices ─────────────────────────────
test("same city: buy cell shows buyOrder, sell cell shows sellOrder", () => {
  // User sets the buy order to 124,984 and the sell order to 130,000 at Fort
  // Sterling — both inputs are stored, use=buy is the active pick.
  setOverrideEntry("BAG", FS, { buyOrder: 124984, sellOrder: 130000, use: "buy" });
  const buy = getBuyPrice(MD.BAG, FS, null, "BAG", true);
  const sell = getSellPrice(MD.BAG, FS, null, "BAG", true);
  assert.strictEqual(buy, 124984, "buy reads buyOrder");
  assert.strictEqual(sell, 130000, "sell reads sellOrder, NOT the active buyOrder");
  assert.notStrictEqual(buy, sell, "the two cells are independent");
});

test("active pick (use) does not leak into the flipping sell cell", () => {
  // Even with use=buy, the sell side must surface its own order.
  setOverrideEntry("BAG", FS, { buyOrder: 200, sellOrder: 305000, use: "buy" });
  assert.strictEqual(getSellPrice(MD.BAG, FS, null, "BAG", true), 305000);
  // And with use=sell, the buy side still surfaces its own order.
  setOverrideEntry("BAG", FS, { buyOrder: 200, sellOrder: 305000, use: "sell" });
  assert.strictEqual(getBuyPrice(MD.BAG, FS, null, "BAG", true), 200);
});

test("buy-only override: sell cell falls through to the market sell price", () => {
  setOverrideEntry("BAG", FS, { buyOrder: 90, use: "buy" });
  assert.strictEqual(getBuyPrice(MD.BAG, FS, null, "BAG", true), 90, "buy override");
  assert.strictEqual(getSellPrice(MD.BAG, FS, null, "BAG", true), 150, "sell = market sell_price");
});

test("sell-only override: buy cell falls through to the market buy price", () => {
  setOverrideEntry("BAG", FS, { sellOrder: 175, use: "sell" });
  assert.strictEqual(getSellPrice(MD.BAG, FS, null, "BAG", true), 175, "sell override");
  assert.strictEqual(getBuyPrice(MD.BAG, FS, null, "BAG", true), 100, "buy = market buy_price");
});

test("no override: both sides read the market", () => {
  assert.strictEqual(getBuyPrice(MD.BAG, FS, null, "BAG", true), 100);
  assert.strictEqual(getSellPrice(MD.BAG, FS, null, "BAG", true), 150);
});

// ── side mode must NOT change non-flipping (active-pick) reads ────────────
test("without sideMode, both sides still return the single active value", () => {
  setOverrideEntry("BAG", FS, { buyOrder: 124984, sellOrder: 130000, use: "buy" });
  assert.strictEqual(getBuyPrice(MD.BAG, FS, null, "BAG"), 124984, "active wins");
  assert.strictEqual(getSellPrice(MD.BAG, FS, null, "BAG"), 124984, "active wins (toggle-agnostic)");
});

// ── city pickers honour the side-specific bypass ──────────────────────────
test("findBest*City: a side override keeps a zero-volume city in the running", () => {
  const md = { BAG: { [FS]: { buy_price: 0, sell_price: 0, volume_24h: 0 } } };
  setOverrideEntry("BAG", FS, { buyOrder: 124984, sellOrder: 130000, use: "buy" });
  const buy = findBestBuyCity(md, "BAG", [FS], 25, true);
  const sell = findBestSellCity(md, "BAG", [FS], 25, true);
  assert.strictEqual(buy.price, 124984, "buy override bypasses volume gate");
  assert.strictEqual(sell.price, 130000, "sell override bypasses volume gate independently");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
