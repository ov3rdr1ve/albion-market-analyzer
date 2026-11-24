/**
 * Test: Sell price override is found even when no market data exists.
 *
 * Verifies the fix where the else branch of the sell price lookup in
 * renderRollingTable() checks overrides before skipping cities with
 * no market data.
 *
 * The artifact sale is priced through getSellPrice, so it follows the Pricing
 * Model like every other leg: the bid under Instant, your own sell order under
 * Market Orders. It used to read `d.sell_price || d.buy_price`, which silently
 * quoted whichever side of the book happened to exist. A missing field is now 0
 * — the row reads "no data" and can be hand-priced. The rule itself is pinned
 * against the real js/utils.js in tests/black-market-order-type.test.cjs.
 *
 * Run: node tests/rolling-override-no-market-data.test.cjs
 */

const assert = require("assert");
const { test } = require("node:test");

// ── Price override system (mirrors utils.js) ────────────────────────────────
let _priceOverrides = {};
function setOverridePrice(itemId, city, price) {
  if (!_priceOverrides[itemId]) _priceOverrides[itemId] = {};
  _priceOverrides[itemId][city] = { price };
}
function getOverridePrice(itemId, city) {
  const entry = _priceOverrides[itemId]?.[city];
  return entry ? entry.price : null;
}

// ── Extract the fixed sell city selection logic from renderRollingTable ──────
let _mode = "market";
function setMode(m) { _mode = m; }
function getSellPrice(itemData, city, bounds, itemId) {
  const ov = getOverridePrice(itemId, city);
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return (_mode === "instant" ? itemData[city].buy_price : itemData[city].sell_price) || 0;
}
function findBestSellCity(marketData, artId, sellCities) {
  let bestSellCity = null;
  let bestSellPrice = 0;
  sellCities.forEach((city) => {
    const ov = getOverridePrice(artId, city);
    const d = marketData[artId]?.[city];
    if (!d && ov === null) return;
    const p = getSellPrice(marketData[artId], city, null, artId);
    if (p > bestSellPrice) {
      bestSellPrice = p;
      bestSellCity = city;
    }
  });
  return { city: bestSellCity, price: bestSellPrice };
}

const SELL_CITIES = ["Bridgewatch", "Fort Sterling", "Lymhurst", "Martlock", "Thetford", "Caerleon", "Black Market"];

// ── Tests ───────────────────────────────────────────────────────────────────

test("override is found when no market data exists for the artifact", () => {
  _priceOverrides = {};
  setOverridePrice("T6_ARTEFACT_HEAD_PLATE_FEY", "Lymhurst", 150000);
  const marketData = {}; // no market data at all
  const result = findBestSellCity(marketData, "T6_ARTEFACT_HEAD_PLATE_FEY", SELL_CITIES);
  assert.strictEqual(result.city, "Lymhurst");
  assert.strictEqual(result.price, 150000);
});

test("override wins over market data when both exist", () => {
  _priceOverrides = {};
  setOverridePrice("T6_ARTEFACT_ARMOR_PLATE_FEY", "Bridgewatch", 200000);
  const marketData = {
    T6_ARTEFACT_ARMOR_PLATE_FEY: {
      Bridgewatch: { sell_price: 100000, buy_price: 90000 },
    },
  };
  const result = findBestSellCity(marketData, "T6_ARTEFACT_ARMOR_PLATE_FEY", SELL_CITIES);
  assert.strictEqual(result.city, "Bridgewatch");
  assert.strictEqual(result.price, 200000);
});

test("city with no market data and no override is skipped", () => {
  _priceOverrides = {};
  const marketData = {
    T6_ARTEFACT_HEAD_PLATE_UNDEAD: {
      "Fort Sterling": { sell_price: 80000, buy_price: 70000 },
    },
  };
  const result = findBestSellCity(marketData, "T6_ARTEFACT_HEAD_PLATE_UNDEAD", SELL_CITIES);
  assert.strictEqual(result.city, "Fort Sterling");
  assert.strictEqual(result.price, 80000);
});

test("no override, no market data returns null city and 0 price", () => {
  _priceOverrides = {};
  const marketData = {};
  const result = findBestSellCity(marketData, "T4_ARTEFACT_SHOES_PLATE_FEY", SELL_CITIES);
  assert.strictEqual(result.city, null);
  assert.strictEqual(result.price, 0);
});

test("imported override without city force is found via else branch", () => {
  // Simulates importing overrides (setOverridePrice called, but no setCityForce)
  _priceOverrides = {};
  setOverridePrice("T7_ARTEFACT_HEAD_CLOTH_FEY", "Caerleon", 500000);
  setOverridePrice("T7_ARTEFACT_HEAD_CLOTH_FEY", "Martlock", 450000);
  const marketData = {}; // no market data
  const result = findBestSellCity(marketData, "T7_ARTEFACT_HEAD_CLOTH_FEY", SELL_CITIES);
  assert.strictEqual(result.city, "Caerleon");
  assert.strictEqual(result.price, 500000);
});

test("override on one city, market data on another — picks highest", () => {
  _priceOverrides = {};
  setOverridePrice("T5_ARTEFACT_ARMOR_CLOTH_FEY", "Thetford", 120000);
  const marketData = {
    T5_ARTEFACT_ARMOR_CLOTH_FEY: {
      Bridgewatch: { sell_price: 130000, buy_price: 110000 },
    },
  };
  const result = findBestSellCity(marketData, "T5_ARTEFACT_ARMOR_CLOTH_FEY", SELL_CITIES);
  assert.strictEqual(result.city, "Bridgewatch");
  assert.strictEqual(result.price, 130000);
});

test("Instant sells the artifact into the bid, Market Orders lists it", () => {
  _priceOverrides = {};
  const marketData = {
    T6_ARTEFACT_ARMOR_PLATE_UNDEAD: {
      Bridgewatch: { sell_price: 130000, buy_price: 110000 },
    },
  };
  setMode("market");
  assert.strictEqual(
    findBestSellCity(marketData, "T6_ARTEFACT_ARMOR_PLATE_UNDEAD", SELL_CITIES).price, 130000);
  setMode("instant");
  assert.strictEqual(
    findBestSellCity(marketData, "T6_ARTEFACT_ARMOR_PLATE_UNDEAD", SELL_CITIES).price, 110000);
  setMode("market");
});

test("a one-sided book drops the leg — no fallback to the other field", () => {
  _priceOverrides = {};
  const marketData = {
    T5_ARTEFACT_SHOES_LEATHER_UNDEAD: {
      Martlock: { sell_price: 0, buy_price: 90000 },
    },
  };
  setMode("market");
  const r = findBestSellCity(marketData, "T5_ARTEFACT_SHOES_LEATHER_UNDEAD", SELL_CITIES);
  assert.strictEqual(r.city, null, "no ask to list against");
  assert.strictEqual(r.price, 0, "0 renders as no-data and can be hand-priced");
  setMode("instant");
  assert.strictEqual(
    findBestSellCity(marketData, "T5_ARTEFACT_SHOES_LEATHER_UNDEAD", SELL_CITIES).price, 90000);
  setMode("market");
});

test("an override still wins in either pricing model", () => {
  _priceOverrides = {};
  setOverridePrice("T8_ARTEFACT_2H_ARCANE_UNDEAD", "Caerleon", 777000);
  const marketData = {
    T8_ARTEFACT_2H_ARCANE_UNDEAD: {
      Caerleon: { sell_price: 130000, buy_price: 110000 },
    },
  };
  ["market", "instant"].forEach((m) => {
    setMode(m);
    const r = findBestSellCity(marketData, "T8_ARTEFACT_2H_ARCANE_UNDEAD", SELL_CITIES);
    assert.strictEqual(r.price, 777000, m);
  });
  setMode("market");
});
