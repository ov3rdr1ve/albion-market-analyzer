/**
 * Test: Sell-price override is honored on the consumables craft row.
 *
 * Bug: render-consumables.js called `getSellPrice(marketData[item.id], sc,
 * potBounds)` without the `itemId` arg, so `getSellPrice`'s override branch
 * was never consulted. The displayed sell price stayed pinned to the live
 * market sell, ignoring whatever the user typed into the price-edit cell.
 *
 * Also verifies the parity rule from render-crafting.js: a low-volume sell
 * city must still be considered when the user has set an explicit override
 * for it (otherwise typing a price into a thinly-traded city silently does
 * nothing).
 *
 * Run: node tests/consumables-sell-override.test.cjs
 */

const assert = require("assert");

let _priceOverrides = {};
function setOverridePrice(itemId, city, price) {
  if (!_priceOverrides[itemId]) _priceOverrides[itemId] = {};
  _priceOverrides[itemId][city] = { price };
}
function getOverridePrice(itemId, city) {
  const entry = _priceOverrides[itemId]?.[city];
  return entry ? entry.price : null;
}

// Mirrors js/utils.js getSellPrice — the relevant override branch.
function getSellPrice(itemData, city, _bounds, itemId) {
  const ov = itemId ? getOverridePrice(itemId, city) : null;
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].sell_price || 0;
}

// Mirrors the consumable craft inner loop in render-consumables.js.
// MIN_VOLUME default for "market" order type is 25 in the real renderer;
// override-bypass must keep the city in play below that threshold.
function pickBestSell(itemId, marketData, sellCities, MIN_VOLUME) {
  let best = { city: null, price: 0 };
  sellCities.forEach((sc) => {
    const sPrice = getSellPrice(marketData[itemId], sc, null, itemId);
    const sVol = marketData[itemId]?.[sc]?.volume_24h || 0;
    if (sPrice > 0 && (sVol >= MIN_VOLUME || getOverridePrice(itemId, sc) !== null)) {
      if (sPrice > best.price) best = { city: sc, price: sPrice };
    }
  });
  return best;
}

const ITEM = "T8_MEAL_STEW_FISH";
const SELL_CITIES = ["Bridgewatch", "Fort Sterling", "Lymhurst", "Martlock", "Thetford", "Caerleon", "Black Market"];
const ROYAL_CITIES = ["Bridgewatch", "Fort Sterling", "Lymhurst", "Martlock", "Thetford"];

// Mirrors js/utils.js isInvalidCrossRoute with Black/Red-Zone routes OFF.
function isInvalidCrossRoute(buyCity, sellCity) {
  if (!buyCity || !sellCity) return true;
  if (sellCity === "Black Market" && buyCity !== "Caerleon") return true;
  const buyIsRoyal = ROYAL_CITIES.includes(buyCity);
  const sellIsRoyal = ROYAL_CITIES.includes(sellCity);
  if (buyIsRoyal && sellCity === "Caerleon") return true;
  if (buyCity === "Caerleon" && sellIsRoyal) return true;
  return false;
}

// Mirrors the per-craft-city sell pool in render-consumables.js (the FIX):
// a sell-city force is honored ONLY when this craft city can legitimately
// reach it; otherwise the section falls back to the full sell list. The
// section's best sell is the highest reachable price.
function pickSectionSell(itemId, marketData, craftCity, forcedSellCity, MIN_VOLUME) {
  const effectiveSellCities =
    forcedSellCity && !isInvalidCrossRoute(craftCity, forcedSellCity)
      ? [forcedSellCity]
      : SELL_CITIES;
  let best = { city: null, price: 0 };
  effectiveSellCities.forEach((sc) => {
    if (isInvalidCrossRoute(craftCity, sc)) return;
    const sPrice = getSellPrice(marketData[itemId], sc, null, itemId);
    const sVol = marketData[itemId]?.[sc]?.volume_24h || 0;
    if (sPrice > 0 && (sVol >= MIN_VOLUME || getOverridePrice(itemId, sc) !== null)) {
      if (sPrice > best.price) best = { city: sc, price: sPrice };
    }
  });
  return best;
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("\n=== Consumable sell-price override ===");

test("override on a high-volume city replaces the market sell price", () => {
  _priceOverrides = {};
  const market = {
    [ITEM]: {
      Thetford: { sell_price: 54_334, buy_price: 50_000, volume_24h: 11_356 },
    },
  };
  setOverridePrice(ITEM, "Thetford", 60_000);
  const best = pickBestSell(ITEM, market, SELL_CITIES, 25);
  assert.strictEqual(best.city, "Thetford");
  assert.strictEqual(best.price, 60_000, `expected the typed override (60000), got ${best.price}`);
});

test("override on a low-volume city is honored (volume gate bypassed)", () => {
  _priceOverrides = {};
  const market = {
    [ITEM]: {
      Lymhurst: { sell_price: 55_000, buy_price: 53_000, volume_24h: 5 },
    },
  };
  setOverridePrice(ITEM, "Lymhurst", 75_000);
  const best = pickBestSell(ITEM, market, SELL_CITIES, 25);
  assert.strictEqual(best.city, "Lymhurst");
  assert.strictEqual(best.price, 75_000);
});

test("override wins over a higher-priced market sell in another city", () => {
  _priceOverrides = {};
  const market = {
    [ITEM]: {
      Thetford: { sell_price: 54_000, buy_price: 50_000, volume_24h: 11_356 },
      Caerleon: { sell_price: 70_000, buy_price: 65_000, volume_24h: 800 },
    },
  };
  setOverridePrice(ITEM, "Thetford", 80_000);
  const best = pickBestSell(ITEM, market, SELL_CITIES, 25);
  assert.strictEqual(best.city, "Thetford");
  assert.strictEqual(best.price, 80_000);
});

test("no override → market sell price still wins normally", () => {
  _priceOverrides = {};
  const market = {
    [ITEM]: {
      Thetford: { sell_price: 54_334, buy_price: 50_000, volume_24h: 11_356 },
      Caerleon: { sell_price: 60_000, buy_price: 55_000, volume_24h: 800 },
    },
  };
  const best = pickBestSell(ITEM, market, SELL_CITIES, 25);
  assert.strictEqual(best.city, "Caerleon");
  assert.strictEqual(best.price, 60_000);
});

test("low-volume city with no override is skipped (volume gate enforced)", () => {
  _priceOverrides = {};
  const market = {
    [ITEM]: {
      Lymhurst: { sell_price: 75_000, buy_price: 70_000, volume_24h: 5 },
      Thetford: { sell_price: 54_000, buy_price: 50_000, volume_24h: 11_356 },
    },
  };
  const best = pickBestSell(ITEM, market, SELL_CITIES, 25);
  assert.strictEqual(best.city, "Thetford");
  assert.strictEqual(best.price, 54_000);
});

test("regression: bug repro — calling getSellPrice without itemId ignores override", () => {
  // This reproduces the exact pre-fix behavior to make sure the test
  // would have failed on the old code path.
  _priceOverrides = {};
  setOverridePrice(ITEM, "Thetford", 60_000);
  const market = {
    [ITEM]: {
      Thetford: { sell_price: 54_334, buy_price: 50_000, volume_24h: 11_356 },
    },
  };
  // Call getSellPrice WITHOUT itemId — the bug condition.
  const sBuggy = getSellPrice(market[ITEM], "Thetford", null /* no itemId */);
  assert.strictEqual(sBuggy, 54_334, "without itemId, override is bypassed (this was the bug)");
  // Call WITH itemId — the fix.
  const sFixed = getSellPrice(market[ITEM], "Thetford", null, ITEM);
  assert.strictEqual(sFixed, 60_000, "with itemId, override wins (post-fix)");
});

console.log("\n=== Section-aware sell force (BMR off) ===");

test("regression: forcing a ROYAL sell city must NOT blank the Caerleon row", () => {
  // Repro of the reported bug: in BMR-off mode the craft table emits a royal
  // row AND a Caerleon row per item. Setting a sell override on the royal row
  // forces the sell city globally; the OLD code applied that force to the
  // Caerleon section too, so Caerleon-craft (which can't reach a royal city
  // with routes off) found no valid sell and the twin row showed "no data".
  _priceOverrides = {};
  const market = {
    [ITEM]: {
      Martlock: { sell_price: 54_000, buy_price: 50_000, volume_24h: 11_356 },
      Caerleon: { sell_price: 62_000, buy_price: 58_000, volume_24h: 900 },
    },
  };
  // User pins the royal row to Martlock at 80K.
  setOverridePrice(ITEM, "Martlock", 80_000);

  // Royal section (craft in a royal city) honors the pin.
  const royal = pickSectionSell(ITEM, market, "Lymhurst", "Martlock", 25);
  assert.strictEqual(royal.city, "Martlock");
  assert.strictEqual(royal.price, 80_000);

  // Caerleon section (craft in Caerleon) can't reach Martlock with routes off,
  // so it falls back to its own reachable sell (Caerleon) instead of blanking.
  const caer = pickSectionSell(ITEM, market, "Caerleon", "Martlock", 25);
  assert.strictEqual(caer.city, "Caerleon", "Caerleon row must still resolve a sell city");
  assert.strictEqual(caer.price, 62_000);
});

test("regression: forcing a CAERLEON sell city must NOT blank the royal row", () => {
  _priceOverrides = {};
  const market = {
    [ITEM]: {
      Martlock: { sell_price: 54_000, buy_price: 50_000, volume_24h: 11_356 },
      Caerleon: { sell_price: 62_000, buy_price: 58_000, volume_24h: 900 },
    },
  };
  setOverridePrice(ITEM, "Caerleon", 90_000);

  const caer = pickSectionSell(ITEM, market, "Caerleon", "Caerleon", 25);
  assert.strictEqual(caer.city, "Caerleon");
  assert.strictEqual(caer.price, 90_000);

  // Royal craft can't reach Caerleon with routes off → keeps its own market sell.
  const royal = pickSectionSell(ITEM, market, "Lymhurst", "Caerleon", 25);
  assert.strictEqual(royal.city, "Martlock", "royal row must still resolve a sell city");
  assert.strictEqual(royal.price, 54_000);
});

test("force pins the row even when another reachable city has a higher market sell", () => {
  _priceOverrides = {};
  const market = {
    [ITEM]: {
      Martlock: { sell_price: 54_000, buy_price: 50_000, volume_24h: 11_356 },
      Lymhurst: { sell_price: 70_000, buy_price: 65_000, volume_24h: 8_000 },
    },
  };
  // User deliberately pinned Martlock at 60K; Lymhurst's 70K market must NOT win.
  setOverridePrice(ITEM, "Martlock", 60_000);
  const royal = pickSectionSell(ITEM, market, "Fort Sterling", "Martlock", 25);
  assert.strictEqual(royal.city, "Martlock");
  assert.strictEqual(royal.price, 60_000);
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
