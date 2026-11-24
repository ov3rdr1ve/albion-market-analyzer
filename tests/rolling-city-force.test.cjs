/**
 * Test: Rolling table respects city force overrides.
 *
 * Verifies that when a user forces a buy/sell city via setCityForce(),
 * renderRollingTable() uses that city instead of recalculating the cheapest.
 *
 * Run: node tests/rolling-city-force.test.cjs
 */

const assert = require("assert");

// ── Minimal stubs ───────────────────────────────────────────────────────────
global.document = {
  getElementById() { return null; },
  querySelector() { return null; },
};
global.localStorage = { getItem() { return null; }, setItem() {} };

// ── City force override system (mirrors utils.js) ───────────────────────────
let _cityForces = {};
function setCityForce(itemId, side, city) {
  _cityForces[`${itemId}:${side}`] = city;
}
function getCityForce(itemId, side) {
  return _cityForces[`${itemId}:${side}`] || null;
}
function clearAllCityForces() {
  _cityForces = {};
}

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

// ── Price functions (simplified from utils.js) ──────────────────────────────
function getBuyPrice(itemData, city, bounds, itemId) {
  const ov = itemId ? getOverridePrice(itemId, city) : null;
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].sell_price || 0; // instant buy
}

function getSellPrice(itemData, city, bounds, itemId) {
  const ov = itemId ? getOverridePrice(itemId, city) : null;
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].buy_price || 0; // instant sell
}

function getIQRBounds() { return null; }

const CITIES = ["Bridgewatch", "Fort Sterling", "Lymhurst", "Martlock", "Thetford", "Caerleon"];
const SELL_CITIES = [...CITIES, "Black Market"];

// ── Extract rolling table city selection logic ──────────────────────────────
// This mirrors the core logic from renderRollingTable() that picks buy/sell cities
function findFragBuyCity(marketData, fragmentId, buyCities) {
  let fragBuyCity = null;
  let fragBuyPrice = Infinity;
  const forcedFragBuyCity = getCityForce(fragmentId, "buy");
  if (forcedFragBuyCity) {
    const bounds = getIQRBounds(marketData[fragmentId] || {});
    const p = getBuyPrice(marketData[fragmentId], forcedFragBuyCity, bounds, fragmentId);
    fragBuyCity = forcedFragBuyCity;
    fragBuyPrice = p > 0 ? p : 0;
  } else {
    buyCities.forEach((city) => {
      const bounds = getIQRBounds(marketData[fragmentId] || {});
      const p = getBuyPrice(marketData[fragmentId], city, bounds, fragmentId);
      if (p > 0 && p < fragBuyPrice) {
        fragBuyPrice = p;
        fragBuyCity = city;
      }
    });
  }
  if (!fragBuyCity) fragBuyPrice = 0;
  return { city: fragBuyCity, price: fragBuyPrice };
}

function findArtSellCity(marketData, artId, sellCities) {
  let bestSellCity = null;
  let bestSellPrice = 0;
  const forcedArtSellCity = getCityForce(artId, "sell");
  if (forcedArtSellCity) {
    const bounds = getIQRBounds(marketData[artId] || {});
    const p = getSellPrice(marketData[artId], forcedArtSellCity, bounds, artId);
    bestSellCity = forcedArtSellCity;
    bestSellPrice = p > 0 ? p : 0;
  } else {
    sellCities.forEach((city) => {
      const bounds = getIQRBounds(marketData[artId] || {});
      const p = getSellPrice(marketData[artId], city, bounds, artId);
      if (p > bestSellPrice) {
        bestSellPrice = p;
        bestSellCity = city;
      }
    });
  }
  return { city: bestSellCity, price: bestSellPrice };
}

// ── Test data ───────────────────────────────────────────────────────────────
const FRAG_ID = "T8_SHARD_AVALONIAN";
const ART_ID = "T8_ARTEFACT_HEAD_CLOTH_AVALON";

const marketData = {
  [FRAG_ID]: {
    "Fort Sterling": { sell_price: 100, buy_price: 90 },
    "Bridgewatch":   { sell_price: 150, buy_price: 140 },
    "Lymhurst":      { sell_price: 120, buy_price: 110 },
    "Caerleon":      { sell_price: 200, buy_price: 180 },
  },
  [ART_ID]: {
    "Fort Sterling": { sell_price: 5000, buy_price: 4500 },
    "Bridgewatch":   { sell_price: 6000, buy_price: 5500 },
    "Black Market":  { sell_price: 8000, buy_price: 7000 },
    "Caerleon":      { sell_price: 4000, buy_price: 3500 },
  },
};

// ── Tests ───────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function test(name, fn) {
  clearAllCityForces();
  _priceOverrides = {};
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL: ${name}`);
    console.error(`    ${e.message}`);
  }
}

console.log("Rolling table city force override tests:");

// --- Fragment buy city tests ---

test("Without force: picks cheapest fragment buy city (Fort Sterling @ 100)", () => {
  const result = findFragBuyCity(marketData, FRAG_ID, CITIES);
  assert.strictEqual(result.city, "Fort Sterling");
  assert.strictEqual(result.price, 100);
});

test("With force: uses forced fragment buy city even if not cheapest", () => {
  setCityForce(FRAG_ID, "buy", "Caerleon");
  const result = findFragBuyCity(marketData, FRAG_ID, CITIES);
  assert.strictEqual(result.city, "Caerleon");
  assert.strictEqual(result.price, 200);
});

test("With force to Bridgewatch: uses Bridgewatch price", () => {
  setCityForce(FRAG_ID, "buy", "Bridgewatch");
  const result = findFragBuyCity(marketData, FRAG_ID, CITIES);
  assert.strictEqual(result.city, "Bridgewatch");
  assert.strictEqual(result.price, 150);
});

test("Force to city with no data: returns city with price 0", () => {
  setCityForce(FRAG_ID, "buy", "Martlock");
  const result = findFragBuyCity(marketData, FRAG_ID, CITIES);
  assert.strictEqual(result.city, "Martlock");
  assert.strictEqual(result.price, 0);
});

// --- Artifact sell city tests ---

test("Without force: picks best artifact sell city (Black Market @ 7000)", () => {
  const result = findArtSellCity(marketData, ART_ID, SELL_CITIES);
  assert.strictEqual(result.city, "Black Market");
  assert.strictEqual(result.price, 7000);
});

test("With force: uses forced artifact sell city even if not best", () => {
  setCityForce(ART_ID, "sell", "Caerleon");
  const result = findArtSellCity(marketData, ART_ID, SELL_CITIES);
  assert.strictEqual(result.city, "Caerleon");
  assert.strictEqual(result.price, 3500);
});

test("With force to Fort Sterling: uses Fort Sterling sell price", () => {
  setCityForce(ART_ID, "sell", "Fort Sterling");
  const result = findArtSellCity(marketData, ART_ID, SELL_CITIES);
  assert.strictEqual(result.city, "Fort Sterling");
  assert.strictEqual(result.price, 4500);
});

test("Force sell to city with no data: returns city with price 0", () => {
  setCityForce(ART_ID, "sell", "Thetford");
  const result = findArtSellCity(marketData, ART_ID, SELL_CITIES);
  assert.strictEqual(result.city, "Thetford");
  assert.strictEqual(result.price, 0);
});

// --- Combined: force + price override ---

test("Force buy city + price override: override price wins", () => {
  setCityForce(FRAG_ID, "buy", "Lymhurst");
  setOverridePrice(FRAG_ID, "Lymhurst", 999);
  const result = findFragBuyCity(marketData, FRAG_ID, CITIES);
  assert.strictEqual(result.city, "Lymhurst");
  assert.strictEqual(result.price, 999);
});

test("Force sell city + price override: override price wins", () => {
  setCityForce(ART_ID, "sell", "Fort Sterling");
  setOverridePrice(ART_ID, "Fort Sterling", 12345);
  const result = findArtSellCity(marketData, ART_ID, SELL_CITIES);
  assert.strictEqual(result.city, "Fort Sterling");
  assert.strictEqual(result.price, 12345);
});

// --- Summary ---
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
