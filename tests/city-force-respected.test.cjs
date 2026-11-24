/**
 * Test: getCityForce() must be honoured by findBestBuyCity / findBestSellCity
 * AND by the inline city loops in render-mounts.js (mount craft rows).
 *
 * Bug: Previously, city force was only honoured when there was ALSO a price
 * override at that city. Result: users picking a city via the profit-cell
 * picker (which sets only the city force, no price) saw their pick silently
 * reverted on the next render.
 *
 * Run: node tests/city-force-respected.test.cjs
 */

const assert = require("assert");

// ── Stubs ───────────────────────────────────────────────────────────────────
const ROYAL_CITIES = ["Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];

let _priceOverrides = {};
let _cityForce = {};

function setOverridePrice(itemId, city, price) {
  if (!_priceOverrides[itemId]) _priceOverrides[itemId] = {};
  _priceOverrides[itemId][city] = { price };
}
function getOverridePrice(itemId, city) {
  const e = _priceOverrides[itemId]?.[city];
  return e ? e.price : null;
}
function setCityForce(itemId, side, city) {
  if (!_cityForce[itemId]) _cityForce[itemId] = {};
  _cityForce[itemId][side] = city;
}
function getCityForce(itemId, side) {
  return _cityForce[itemId]?.[side] ?? null;
}

function isInvalidCrossRoute(buyCity, sellCity) {
  // Mirror production: royal-vs-Caerleon and Caerleon-vs-royal are invalid
  // (Black Market is a sell-only city; doesn't matter for buy-loop tests.)
  if (buyCity === "Caerleon" && sellCity !== "Caerleon" && sellCity !== "Black Market") return true;
  if (buyCity !== "Caerleon" && sellCity === "Caerleon") return true;
  return false;
}
function isBlackRedZoneEnabled() { return false; }

// ── Mirror production getBuyPrice / getSellPrice (with override-first) ──────
function getBuyPrice(itemData, city, bounds, itemId) {
  const ov = itemId ? getOverridePrice(itemId, city) : null;
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].buy_price || 0;
}
function getSellPrice(itemData, city, bounds, itemId) {
  const ov = itemId ? getOverridePrice(itemId, city) : null;
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return city === "Black Market"
    ? itemData[city].buy_price || 0
    : itemData[city].sell_price || 0;
}

// ── FIXED findBestBuyCity (this is what we want production to look like) ────
function findBestBuyCity(marketData, itemId, cities, minVolume) {
  const forced = getCityForce(itemId, "buy");
  if (forced && cities.includes(forced)) {
    const p = getBuyPrice(marketData[itemId], forced, null, itemId);
    return { city: forced, price: p > 0 ? p : 0 };
  }
  let bestPrice = Infinity, bestCity = null;
  cities.forEach((c) => {
    const p = getBuyPrice(marketData[itemId], c, null, itemId);
    const v = marketData[itemId]?.[c]?.volume_24h || 0;
    if (p > 0 && (v >= minVolume || getOverridePrice(itemId, c) !== null) && p < bestPrice) {
      bestPrice = p; bestCity = c;
    }
  });
  return { city: bestCity, price: bestCity ? bestPrice : 0 };
}

// ── FIXED findBestSellCity ──────────────────────────────────────────────────
function findBestSellCity(marketData, itemId, cities, minVolume, excludeBuyCity) {
  const forced = getCityForce(itemId, "sell");
  if (forced && cities.includes(forced)) {
    const p = getSellPrice(marketData[itemId], forced, null, itemId);
    return { city: forced, price: p > 0 ? p : 0 };
  }
  let bestPrice = 0, bestCity = null;
  cities.forEach((c) => {
    if (excludeBuyCity && isInvalidCrossRoute(excludeBuyCity, c)) return;
    const p = getSellPrice(marketData[itemId], c, null, itemId);
    const v = marketData[itemId]?.[c]?.volume_24h || 0;
    if (p > 0 && (v >= minVolume || getOverridePrice(itemId, c) !== null) && p > bestPrice) {
      bestPrice = p; bestCity = c;
    }
  });
  return { city: bestCity, price: bestPrice };
}

// ── FIXED mount-craft material buy loop ─────────────────────────────────────
function selectMountMaterialBuy(marketData, mount, craftCity, MIN_VOLUME) {
  const matBestPrices = {};
  let allAvailable = true;
  mount.materials.forEach((m) => {
    let bestPrice = Infinity, bestCity = null;
    const forcedBuyCity = getCityForce(m.matId, "buy");
    // Zone gate: only honor the forced buy city when it's compatible with the
    // craft city under BMR off. Without this, a Lymhurst force would apply to
    // a Caerleon-craft row (impossible "buy Lymhurst, craft Caerleon" route).
    const matForceValid = forcedBuyCity && (isBlackRedZoneEnabled() ||
      (forcedBuyCity === "Caerleon") === (craftCity === "Caerleon"));
    if (matForceValid) {
      const p = getBuyPrice(marketData[m.matId], forcedBuyCity, null, m.matId);
      bestCity = forcedBuyCity;
      bestPrice = p > 0 ? p : 0;
      if (p <= 0) allAvailable = false;
    } else {
      CITIES.forEach((buyCity) => {
        if (!isBlackRedZoneEnabled() && buyCity === "Caerleon" && craftCity !== "Caerleon") return;
        if (!isBlackRedZoneEnabled() && buyCity !== "Caerleon" && craftCity === "Caerleon") return;
        const p = getBuyPrice(marketData[m.matId], buyCity, null, m.matId);
        const v = marketData[m.matId]?.[buyCity]?.volume_24h || 0;
        if (p > 0 && v >= MIN_VOLUME && p < bestPrice) {
          bestPrice = p; bestCity = buyCity;
        }
      });
      if (!bestCity) allAvailable = false;
    }
    matBestPrices[m.matId] = { price: bestCity ? bestPrice : 0, city: bestCity };
  });
  return { matBestPrices, allAvailable };
}

// ── FIXED mount-craft sell loop (returns the picked sell city) ──────────────
function selectMountSell(marketData, mount, craftCity, MIN_VOLUME) {
  const forcedSellCity = getCityForce(mount.id, "sell");
  const effectiveSellCities = forcedSellCity ? [forcedSellCity] : SELL_CITIES;

  let bestCity = null, bestMargin = -Infinity, bestPrice = 0;
  effectiveSellCities.forEach((sc) => {
    if (isInvalidCrossRoute(craftCity, sc)) return;
    const sPrice = getSellPrice(marketData[mount.id], sc, null, mount.id);
    const sVol = marketData[mount.id]?.[sc]?.volume_24h || 0;
    if (sPrice > 0 && sVol >= MIN_VOLUME) {
      // Toy "margin" — just sPrice for picking; real code subtracts costs.
      const margin = sPrice;
      if (margin > bestMargin) {
        bestMargin = margin; bestCity = sc; bestPrice = sPrice;
      }
    }
  });
  return { city: bestCity, price: bestPrice };
}

// ── Test runner ─────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function test(name, fn) {
  _priceOverrides = {};
  _cityForce = {};
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

// ═════════════════════════════════════════════════════════════════════════════
// findBestBuyCity / findBestSellCity
// ═════════════════════════════════════════════════════════════════════════════
console.log("findBestBuyCity / findBestSellCity respect city force:");

const BABY = "T7_MOUNT_SWAMPDRAGON_BABY";
const GROWN = "T7_MOUNT_SWAMPDRAGON";

const marketData = {
  [BABY]: {
    Lymhurst:    { buy_price: 100, sell_price: 0,    volume_24h: 50 },
    Bridgewatch: { buy_price: 200, sell_price: 0,    volume_24h: 50 },
    Martlock:    { buy_price: 150, sell_price: 0,    volume_24h: 50 },
    Caerleon:    { buy_price: 250, sell_price: 0,    volume_24h: 50 },
  },
  [GROWN]: {
    Lymhurst:    { buy_price: 0, sell_price: 1000, volume_24h: 50 },
    Bridgewatch: { buy_price: 0, sell_price: 800,  volume_24h: 50 },
    Martlock:    { buy_price: 0, sell_price: 1200, volume_24h: 50 },
    Caerleon:    { buy_price: 0, sell_price: 900,  volume_24h: 50 },
    "Black Market": { buy_price: 1500, sell_price: 0, volume_24h: 50 },
  },
};

test("findBestBuyCity honours forced city even without price override", () => {
  setCityForce(BABY, "buy", "Bridgewatch");
  const r = findBestBuyCity(marketData, BABY, CITIES, 25);
  assert.strictEqual(r.city, "Bridgewatch");
  assert.strictEqual(r.price, 200);  // market price at Bridgewatch
});

test("findBestSellCity honours forced city even without price override", () => {
  setCityForce(GROWN, "sell", "Bridgewatch");
  const r = findBestSellCity(marketData, GROWN, SELL_CITIES, 25, null);
  assert.strictEqual(r.city, "Bridgewatch");
  assert.strictEqual(r.price, 800);
});

test("findBestBuyCity ignores forced city if it's not in the cities arg (royal-only branch)", () => {
  setCityForce(BABY, "buy", "Caerleon");
  // Caller passed ROYAL_CITIES only — must NOT honour Caerleon force here
  const r = findBestBuyCity(marketData, BABY, ROYAL_CITIES, 25);
  assert.strictEqual(r.city, "Lymhurst");  // cheapest royal
  assert.strictEqual(r.price, 100);
});

test("findBestSellCity ignores forced city if not in the cities arg (caerleon-only branch)", () => {
  setCityForce(GROWN, "sell", "Lymhurst");
  const r = findBestSellCity(marketData, GROWN, ["Caerleon", "Black Market"], 25, "Caerleon");
  // Lymhurst is forced but not in this branch's allowed cities → fall back
  // Of allowed: Caerleon=900, Black Market=1500 (BM uses buy_price as sell)
  assert.strictEqual(r.city, "Black Market");
  assert.strictEqual(r.price, 1500);
});

test("findBestBuyCity returns price 0 when forced city has no data and no override", () => {
  setCityForce(BABY, "buy", "Fort Sterling");  // not in marketData
  const r = findBestBuyCity(marketData, BABY, CITIES, 25);
  assert.strictEqual(r.city, "Fort Sterling");
  assert.strictEqual(r.price, 0);
});

test("findBestSellCity returns price 0 when forced city has no data and no override", () => {
  setCityForce(GROWN, "sell", "Fort Sterling");
  const r = findBestSellCity(marketData, GROWN, SELL_CITIES, 25, null);
  assert.strictEqual(r.city, "Fort Sterling");
  assert.strictEqual(r.price, 0);
});

test("findBestBuyCity uses override price when forced city has override", () => {
  setOverridePrice(BABY, "Fort Sterling", 50);
  setCityForce(BABY, "buy", "Fort Sterling");
  const r = findBestBuyCity(marketData, BABY, CITIES, 25);
  assert.strictEqual(r.city, "Fort Sterling");
  assert.strictEqual(r.price, 50);
});

test("findBestBuyCity falls back to cheapest when no city force set", () => {
  // No setCityForce call
  const r = findBestBuyCity(marketData, BABY, CITIES, 25);
  assert.strictEqual(r.city, "Lymhurst");  // cheapest = 100
  assert.strictEqual(r.price, 100);
});

test("findBestSellCity falls back to highest when no city force set", () => {
  const r = findBestSellCity(marketData, GROWN, SELL_CITIES, 25, null);
  assert.strictEqual(r.city, "Black Market");  // 1500
  assert.strictEqual(r.price, 1500);
});

// ═════════════════════════════════════════════════════════════════════════════
// Mount craft material buy loop
// ═════════════════════════════════════════════════════════════════════════════
console.log("\nMount craft material buy loop respects city force:");

const MAT_A = "T7_LEATHER";
const MAT_B = "T7_CLOTH";
const mountAvalonian = {
  id: "T7_MOUNT_SWAMPDRAGON_AVALON_BASILISK",
  materials: [
    { matId: MAT_A, count: 1 },
    { matId: MAT_B, count: 5 },
  ],
};
const mountMarketData = {
  [MAT_A]: {
    Lymhurst:    { buy_price: 1000, sell_price: 0, volume_24h: 50 },
    Bridgewatch: { buy_price: 1500, sell_price: 0, volume_24h: 50 },
    Martlock:    { buy_price: 1200, sell_price: 0, volume_24h: 50 },
  },
  [MAT_B]: {
    Lymhurst:    { buy_price: 100, sell_price: 0, volume_24h: 50 },
    Bridgewatch: { buy_price: 80,  sell_price: 0, volume_24h: 50 },
    Martlock:    { buy_price: 90,  sell_price: 0, volume_24h: 50 },
  },
  "T7_MOUNT_SWAMPDRAGON_AVALON_BASILISK": {
    Lymhurst:    { buy_price: 0, sell_price: 50000, volume_24h: 50 },
    Bridgewatch: { buy_price: 0, sell_price: 70000, volume_24h: 50 },
    Martlock:    { buy_price: 0, sell_price: 60000, volume_24h: 50 },
  },
};

test("Mount material buy loop picks cheapest when no force", () => {
  const { matBestPrices, allAvailable } = selectMountMaterialBuy(mountMarketData, mountAvalonian, "Lymhurst", 25);
  assert.strictEqual(allAvailable, true);
  assert.strictEqual(matBestPrices[MAT_A].city, "Lymhurst");  // 1000 cheapest
  assert.strictEqual(matBestPrices[MAT_B].city, "Bridgewatch");  // 80 cheapest
});

test("Mount material buy loop honours forced buy city for one material", () => {
  setCityForce(MAT_A, "buy", "Bridgewatch");
  const { matBestPrices } = selectMountMaterialBuy(mountMarketData, mountAvalonian, "Lymhurst", 25);
  assert.strictEqual(matBestPrices[MAT_A].city, "Bridgewatch");
  assert.strictEqual(matBestPrices[MAT_A].price, 1500);
  // MAT_B is unforced → still cheapest
  assert.strictEqual(matBestPrices[MAT_B].city, "Bridgewatch");  // 80
});

test("Mount material buy loop honours forced city per-material independently", () => {
  setCityForce(MAT_A, "buy", "Martlock");
  setCityForce(MAT_B, "buy", "Lymhurst");
  const { matBestPrices } = selectMountMaterialBuy(mountMarketData, mountAvalonian, "Lymhurst", 25);
  assert.strictEqual(matBestPrices[MAT_A].city, "Martlock");
  assert.strictEqual(matBestPrices[MAT_A].price, 1200);
  assert.strictEqual(matBestPrices[MAT_B].city, "Lymhurst");
  assert.strictEqual(matBestPrices[MAT_B].price, 100);
});

test("Mount material buy loop marks allAvailable=false when forced city has no data", () => {
  setCityForce(MAT_A, "buy", "Fort Sterling");  // no data
  const { matBestPrices, allAvailable } = selectMountMaterialBuy(mountMarketData, mountAvalonian, "Lymhurst", 25);
  assert.strictEqual(allAvailable, false);
  assert.strictEqual(matBestPrices[MAT_A].city, "Fort Sterling");
  assert.strictEqual(matBestPrices[MAT_A].price, 0);
});

// Zone-gate tests (BMR off): a force on a cross-zone city must NOT be honored
// — otherwise the Caerleon-craft row would silently display a "buy Lymhurst,
// craft Caerleon" route that's impossible under standard zone rules.
test("Mount material buy loop ignores Lymhurst force when craftCity=Caerleon (BMR off)", () => {
  // Add Caerleon mat data so the fallback scan can pick something up.
  const md = JSON.parse(JSON.stringify(mountMarketData));
  md[MAT_A].Caerleon = { buy_price: 2000, sell_price: 0, volume_24h: 50 };
  md[MAT_B].Caerleon = { buy_price: 200, sell_price: 0, volume_24h: 50 };
  setCityForce(MAT_A, "buy", "Lymhurst");  // royal force, cross-zone with Caerleon craft
  const { matBestPrices } = selectMountMaterialBuy(md, mountAvalonian, "Caerleon", 25);
  // Force is dropped → scan picks Caerleon (only valid buy city for Caerleon craft).
  assert.strictEqual(matBestPrices[MAT_A].city, "Caerleon");
  assert.strictEqual(matBestPrices[MAT_A].price, 2000);
});

test("Mount material buy loop ignores Caerleon force when craftCity=Lymhurst (BMR off)", () => {
  const md = JSON.parse(JSON.stringify(mountMarketData));
  md[MAT_A].Caerleon = { buy_price: 500, sell_price: 0, volume_24h: 50 };  // very cheap at Caerleon
  setCityForce(MAT_A, "buy", "Caerleon");
  const { matBestPrices } = selectMountMaterialBuy(md, mountAvalonian, "Lymhurst", 25);
  // Force=Caerleon is cross-zone from Lymhurst → ignored. Scan picks cheapest Royal (Lymhurst=1000).
  assert.strictEqual(matBestPrices[MAT_A].city, "Lymhurst");
  assert.strictEqual(matBestPrices[MAT_A].price, 1000);
});

test("Mount material buy loop honors a Royal force in a different Royal craftCity (same zone)", () => {
  // Force=Bridgewatch (royal). craftCity=Lymhurst (also royal). Same zone → honored.
  setCityForce(MAT_A, "buy", "Bridgewatch");
  const { matBestPrices } = selectMountMaterialBuy(mountMarketData, mountAvalonian, "Lymhurst", 25);
  assert.strictEqual(matBestPrices[MAT_A].city, "Bridgewatch");
  assert.strictEqual(matBestPrices[MAT_A].price, 1500);
});

// ═════════════════════════════════════════════════════════════════════════════
// Mount craft sell loop
// ═════════════════════════════════════════════════════════════════════════════
console.log("\nMount craft sell loop respects city force:");

test("Mount sell loop picks best-margin (highest price proxy) when no force", () => {
  // craftCity=Lymhurst (royal) → Caerleon excluded by isInvalidCrossRoute
  const r = selectMountSell(mountMarketData, mountAvalonian, "Lymhurst", 25);
  assert.strictEqual(r.city, "Bridgewatch");  // 70000 highest of royals
  assert.strictEqual(r.price, 70000);
});

test("Mount sell loop honours forced sell city even when another would yield higher margin", () => {
  setCityForce(mountAvalonian.id, "sell", "Lymhurst");
  const r = selectMountSell(mountMarketData, mountAvalonian, "Lymhurst", 25);
  assert.strictEqual(r.city, "Lymhurst");  // 50000 — lower than Bridgewatch but forced
  assert.strictEqual(r.price, 50000);
});

test("Mount sell loop returns null city when forced sell city has no data (no fallback)", () => {
  setCityForce(mountAvalonian.id, "sell", "Fort Sterling");  // no data
  const r = selectMountSell(mountMarketData, mountAvalonian, "Lymhurst", 25);
  assert.strictEqual(r.city, null);
  assert.strictEqual(r.price, 0);
});

test("Mount sell loop respects forced sell city across royal/caerleon split", () => {
  // Forced "Bridgewatch" (royal). craftCity=Caerleon → cross-route is invalid
  // Caerleon -> Bridgewatch is invalid → no candidate → null
  setCityForce(mountAvalonian.id, "sell", "Bridgewatch");
  const r = selectMountSell(mountMarketData, mountAvalonian, "Caerleon", 25);
  assert.strictEqual(r.city, null);
});

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
