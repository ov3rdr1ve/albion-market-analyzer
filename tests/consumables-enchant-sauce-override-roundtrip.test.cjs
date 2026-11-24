/**
 * Test: Enchant-sauce price override survives a save/read roundtrip even
 * when the editor commits the override at a city other than the renderer's
 * default (`matCitySearch[0]`).
 *
 * Bug: render-consumables.js:359-368 read only one key —
 *   getOverridePrice(m.matId, matCitySearch[0])
 * — but the price-edit dropdown (js/app.js + js/price-edit-dropdown.js)
 * lets the user commit at any city in CITIES. A user who clicked the
 * Fishsauce price, switched the dropdown city, and typed a value stored
 * their override at e.g. "Caerleon" while the renderer kept looking at
 * "Lymhurst" — so the override silently never took effect.
 *
 * Fix: scan every city for an override, pick the first hit. Treat
 * override = 0 as "absent" (the explicit-clear sentinel).
 *
 * Black-box: mirror the new scan loop + setOverridePrice/getOverridePrice
 * and verify the produced (price, city) pair against the matBestPrices
 * entry the renderer would emit.
 *
 * Run: node tests/consumables-enchant-sauce-override-roundtrip.test.cjs
 */

const assert = require("assert");

// ── Mirror utils.js getOverridePrice / setOverridePrice ─────────────────────
let _priceOverrides = {};
function setOverridePrice(itemId, city, price) {
  if (!_priceOverrides[itemId]) _priceOverrides[itemId] = {};
  _priceOverrides[itemId][city] = { price };
}
function getOverridePrice(itemId, city) {
  const entry = _priceOverrides[itemId]?.[city];
  return entry ? entry.price : null;
}

// ── Mirror data.js city lists ───────────────────────────────────────────────
const ROYAL_CITIES = ["Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];

// ── Mock market data lookup ─────────────────────────────────────────────────
// In the real renderer, findCheapestMarketBuy walks getBuyPrice — which
// honors overrides FIRST, then falls back to itemData[city]. Here we only
// exercise the marketData-fallback path (overrides are tested separately
// via getOverridePrice). marketData shape: { matId: { city: { price } } }.
let _marketData = {};
function setMarketPrice(matId, city, price) {
  if (!_marketData[matId]) _marketData[matId] = {};
  _marketData[matId][city] = price;
}
function findCheapestMarketBuy(matId, _md, cities) {
  let best = { city: null, price: 0 };
  for (const c of cities) {
    const p = _marketData[matId]?.[c] || 0;
    if (p > 0 && (best.price === 0 || p < best.price)) {
      best = { city: c, price: p };
    }
  }
  return best;
}

// ── Mirror the enchant-sauce resolution from render-consumables.js ──────────
// Priority: override → real market via findCheapestMarketBuy → 0.
function resolveEnchantSauce(matId, matCitySearch) {
  let resolvedPrice = null;
  let resolvedCity = null;
  for (const c of CITIES) {
    const ov = getOverridePrice(matId, c);
    if (ov !== null && ov > 0) {
      resolvedPrice = ov;
      resolvedCity = c;
      break;
    }
  }
  if (resolvedPrice === null) {
    const realMarket = findCheapestMarketBuy(matId, _marketData, matCitySearch);
    if (realMarket.price > 0) {
      resolvedPrice = realMarket.price;
      resolvedCity = realMarket.city;
    }
  }
  const fallbackCity = matCitySearch[0];
  return {
    price: resolvedPrice ?? 0,
    city: resolvedCity ?? fallbackCity,
    sourcing: {
      perUnit: resolvedPrice ?? 0,
      source: "market",
      city: resolvedCity ?? fallbackCity,
    },
  };
}

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    _priceOverrides = {};
    _marketData = {};
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

const MAT = "T1_FISHSAUCE_LEVEL1";
// matCitySearch for BMR-off non-Caerleon flow is ROYAL_CITIES.
const ROYAL_SEARCH = ROYAL_CITIES;

console.log("\n=== Consumables — enchant-sauce override roundtrip ===");

// ── Pre-fix regression: override at the renderer's preferred city ──────────
test("override at matCitySearch[0] is picked up (pre-fix case still works)", () => {
  setOverridePrice(MAT, "Lymhurst", 100);
  const r = resolveEnchantSauce(MAT, ROYAL_SEARCH);
  assert.strictEqual(r.price, 100);
  assert.strictEqual(r.city, "Lymhurst");
  assert.strictEqual(r.sourcing.perUnit, 100);
  assert.strictEqual(r.sourcing.city, "Lymhurst");
});

// ── The actual bug: override committed at a non-preferred city ─────────────
test("override at Caerleon is picked up (bug repro from user screenshot)", () => {
  // User clicked the Fishsauce price, dropdown defaulted to a 0-price city,
  // user changed it to Caerleon and typed 100. Pre-fix: lost. Post-fix: read.
  setOverridePrice(MAT, "Caerleon", 100);
  const r = resolveEnchantSauce(MAT, ROYAL_SEARCH);
  assert.strictEqual(r.price, 100);
  assert.strictEqual(r.city, "Caerleon",
    "renderer must surface the city the override was saved at, not matCitySearch[0]");
});

test("override at Bridgewatch is picked up", () => {
  setOverridePrice(MAT, "Bridgewatch", 250);
  const r = resolveEnchantSauce(MAT, ROYAL_SEARCH);
  assert.strictEqual(r.price, 250);
  assert.strictEqual(r.city, "Bridgewatch");
});

test("override at Brecilien is picked up (last city in CITIES)", () => {
  setOverridePrice(MAT, "Brecilien", 75);
  const r = resolveEnchantSauce(MAT, ROYAL_SEARCH);
  assert.strictEqual(r.price, 75);
  assert.strictEqual(r.city, "Brecilien");
});

// ── No override anywhere ────────────────────────────────────────────────────
test("no override anywhere → price 0, city falls back to matCitySearch[0]", () => {
  const r = resolveEnchantSauce(MAT, ROYAL_SEARCH);
  assert.strictEqual(r.price, 0);
  assert.strictEqual(r.city, "Lymhurst", "fallback must be ROYAL_CITIES[0]");
  assert.strictEqual(r.sourcing.perUnit, 0);
});

test("no override → BMR flow falls back to CITIES[0] = Caerleon", () => {
  const r = resolveEnchantSauce(MAT, CITIES);
  assert.strictEqual(r.city, "Caerleon");
});

test("no override → Caerleon craft falls back to Caerleon", () => {
  const r = resolveEnchantSauce(MAT, ["Caerleon"]);
  assert.strictEqual(r.city, "Caerleon");
});

// ── Override = 0 is the user's explicit clear sentinel ──────────────────────
test("override = 0 is treated as absent (do not re-surface as a saved 0)", () => {
  // Pre-fix code had `overridePrice ?? 0` — but the override map stored 0
  // is a falsy-but-not-null value. The new scan must skip zeros so the row
  // still shows "no data" instead of pinning a stale 0-priced override city.
  setOverridePrice(MAT, "Caerleon", 0);
  const r = resolveEnchantSauce(MAT, ROYAL_SEARCH);
  assert.strictEqual(r.price, 0);
  assert.strictEqual(r.city, "Lymhurst",
    "0-priced override must NOT lock the row to the override's city");
});

test("override = 0 alongside override = 100 — the 100 wins", () => {
  setOverridePrice(MAT, "Caerleon", 0);
  setOverridePrice(MAT, "Thetford", 100);
  const r = resolveEnchantSauce(MAT, ROYAL_SEARCH);
  assert.strictEqual(r.price, 100);
  assert.strictEqual(r.city, "Thetford");
});

// ── Multiple non-zero overrides: deterministic pick ─────────────────────────
test("multiple non-zero overrides → first in CITIES order wins (deterministic)", () => {
  // Caerleon is CITIES[0], so it wins. This is contract: users normally
  // set one override; if they set several, the first scanned one is used.
  setOverridePrice(MAT, "Bridgewatch", 300);
  setOverridePrice(MAT, "Caerleon", 100);
  setOverridePrice(MAT, "Lymhurst", 200);
  const r = resolveEnchantSauce(MAT, ROYAL_SEARCH);
  assert.strictEqual(r.price, 100);
  assert.strictEqual(r.city, "Caerleon");
});

// ── Different enchant sauce ids ─────────────────────────────────────────────
test("T1_FISHSAUCE_LEVEL2 / LEVEL3 are independent matIds", () => {
  setOverridePrice("T1_FISHSAUCE_LEVEL1", "Caerleon", 100);
  setOverridePrice("T1_FISHSAUCE_LEVEL2", "Lymhurst", 500);
  // LEVEL1 read finds Caerleon
  const r1 = resolveEnchantSauce("T1_FISHSAUCE_LEVEL1", ROYAL_SEARCH);
  assert.strictEqual(r1.price, 100);
  assert.strictEqual(r1.city, "Caerleon");
  // LEVEL2 read finds Lymhurst
  const r2 = resolveEnchantSauce("T1_FISHSAUCE_LEVEL2", ROYAL_SEARCH);
  assert.strictEqual(r2.price, 500);
  assert.strictEqual(r2.city, "Lymhurst");
  // LEVEL3 read finds nothing
  const r3 = resolveEnchantSauce("T1_FISHSAUCE_LEVEL3", ROYAL_SEARCH);
  assert.strictEqual(r3.price, 0);
});

test("essence_potion follows the same override path (T6_ESSENCE_POTION)", () => {
  // Potion variants use TX_ESSENCE_POTION as their sauce — same isEnchantSauce
  // branch — so the fix must round-trip these too.
  setOverridePrice("T6_ESSENCE_POTION", "Martlock", 2_500);
  const r = resolveEnchantSauce("T6_ESSENCE_POTION", ROYAL_SEARCH);
  assert.strictEqual(r.price, 2_500);
  assert.strictEqual(r.city, "Martlock");
});

test("T1_ALCHEMY_EXTRACT also works through the same path", () => {
  // Documented non-tradeable prefix (api.js:285-289) — pin so a future
  // refactor that special-cases by id doesn't regress these.
  setOverridePrice("T1_ALCHEMY_EXTRACT", "Fort Sterling", 90);
  const r = resolveEnchantSauce("T1_ALCHEMY_EXTRACT", ROYAL_SEARCH);
  assert.strictEqual(r.price, 90);
  assert.strictEqual(r.city, "Fort Sterling");
});

// ── Renderer-side invariants for the sourcing struct ───────────────────────
test("matBestPrices sourcing struct stays consistent with picked city", () => {
  setOverridePrice(MAT, "Thetford", 333);
  const r = resolveEnchantSauce(MAT, ROYAL_SEARCH);
  assert.strictEqual(r.sourcing.perUnit, r.price);
  assert.strictEqual(r.sourcing.city, r.city);
  assert.strictEqual(r.sourcing.source, "market");
});

// ── Real market data fallback (sauces are tradeable now) ───────────────────
// The original special-case treated sauces as non-tradeable and ignored
// real market data. The fix: when no override is set, fall back to the
// cheapest market listing across matCitySearch. Bug repro from user
// screenshot: salad uses T1_FISHSAUCE_LEVEL3 with no override, but the
// dropdown showed market listings (Thetford 35420, Caerleon 42002, etc.)
// — the renderer still wrote "no data".

console.log("\n=== Consumables — real market data fallback ===");

test("no override + market data exists → uses cheapest market price", () => {
  setMarketPrice(MAT, "Thetford", 35420);
  setMarketPrice(MAT, "Lymhurst", 36686);
  setMarketPrice(MAT, "Martlock", 36500);
  const r = resolveEnchantSauce(MAT, ROYAL_SEARCH);
  assert.strictEqual(r.price, 35420);
  assert.strictEqual(r.city, "Thetford", "must pick cheapest across matCitySearch");
  assert.strictEqual(r.sourcing.perUnit, 35420);
});

test("override beats market price (override priority preserved)", () => {
  setOverridePrice(MAT, "Caerleon", 1000);
  setMarketPrice(MAT, "Thetford", 35420);
  const r = resolveEnchantSauce(MAT, ROYAL_SEARCH);
  assert.strictEqual(r.price, 1000);
  assert.strictEqual(r.city, "Caerleon", "override beats market");
});

test("override = 0 + market data → market wins (zero override is absent)", () => {
  setOverridePrice(MAT, "Caerleon", 0);
  setMarketPrice(MAT, "Bridgewatch", 4000);
  const r = resolveEnchantSauce(MAT, ROYAL_SEARCH);
  assert.strictEqual(r.price, 4000);
  assert.strictEqual(r.city, "Bridgewatch");
});

test("market data only at city OUTSIDE matCitySearch → ignored, falls to 0", () => {
  // matCitySearch = ROYAL_CITIES (no Caerleon). Sauce only listed at Caerleon.
  setMarketPrice(MAT, "Caerleon", 42000);
  const r = resolveEnchantSauce(MAT, ROYAL_SEARCH);
  assert.strictEqual(r.price, 0, "Caerleon market is out of scope for Royal craft");
  assert.strictEqual(r.city, "Lymhurst", "fallback to matCitySearch[0]");
});

test("Caerleon craft picks up Caerleon market data", () => {
  setMarketPrice(MAT, "Caerleon", 42000);
  const r = resolveEnchantSauce(MAT, ["Caerleon"]);
  assert.strictEqual(r.price, 42000);
  assert.strictEqual(r.city, "Caerleon");
});

test("no override + no market data → falls back to 0 (row still renders)", () => {
  const r = resolveEnchantSauce(MAT, ROYAL_SEARCH);
  assert.strictEqual(r.price, 0);
  assert.strictEqual(r.city, "Lymhurst");
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
