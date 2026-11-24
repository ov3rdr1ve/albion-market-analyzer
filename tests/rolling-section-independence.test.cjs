/**
 * Test: Rolling table royal vs Caerleon sections are independent.
 *
 * Bug: editing a price in the "Royal Cities" section auto-changed the same
 * artifact in the "Caerleon & Black Market" section (and vice versa). Cause:
 * the artifact sell-city picker honored the global per-item city force WITHOUT
 * checking that the forced city belongs to the current section's city list.
 * Because city force is a single per-(item, side) slot shared by both sections,
 * forcing Martlock (royal) made the Caerleon section also display Martlock.
 *
 * Fix mirrors findBestSellCity in utils.js: only honor the forced city when
 * sellCities.includes(it). Royal and Caerleon city sets are disjoint, so the
 * sections become independent.
 *
 * Black-box: mirror the (fixed) sell-city selection used by renderRollingTable.
 *
 * Run: node tests/rolling-section-independence.test.cjs
 */
const assert = require("assert");

// ── Override + city-force stores (mirror utils.js) ──────────────────────────
let _priceOverrides = {};
let _cityForces = {};
function setOverridePrice(itemId, city, price) {
  if (!_priceOverrides[itemId]) _priceOverrides[itemId] = {};
  _priceOverrides[itemId][city] = { price };
}
function getOverridePrice(itemId, city) {
  const e = _priceOverrides[itemId]?.[city];
  return e ? e.price : null;
}
function setCityForce(itemId, side, city) {
  if (!_cityForces[itemId]) _cityForces[itemId] = {};
  _cityForces[itemId][side] = city;
}
function getCityForce(itemId, side) {
  return _cityForces[itemId]?.[side] ?? null;
}
// Mirror of utils.getSellPrice: override wins, else instant-sell (buy_price).
function getSellPrice(itemData, city, _bounds, itemId) {
  const ov = itemId ? getOverridePrice(itemId, city) : null;
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].sell_price || itemData[city].buy_price || 0;
}

// ── Mirror of the FIXED renderRollingTable sell-city selection ──────────────
// The only change vs production is the `sellCities.includes(forced)` guard.
function pickRollingSellCity(marketData, artId, sellCities) {
  let bestSellCity = null;
  let bestSellPrice = 0;
  const forced = getCityForce(artId, "sell");
  if (
    forced &&
    sellCities.includes(forced) &&
    getOverridePrice(artId, forced) !== null
  ) {
    const p = getSellPrice(marketData[artId], forced, null, artId);
    bestSellCity = forced;
    bestSellPrice = p > 0 ? p : 0;
  } else {
    sellCities.forEach((city) => {
      const ov = getOverridePrice(artId, city);
      const d = marketData[artId]?.[city];
      if (!d && ov === null) return;
      const p = ov !== null ? ov : d.sell_price || d.buy_price || 0;
      if (p > bestSellPrice) {
        bestSellPrice = p;
        bestSellCity = city;
      }
    });
  }
  return { city: bestSellCity, price: bestSellPrice };
}

// ── Fixtures ────────────────────────────────────────────────────────────────
const ROYAL = ["Thetford", "Fort Sterling", "Lymhurst", "Bridgewatch", "Martlock"];
const CAERLEON = ["Caerleon", "Black Market"];
const ART = "T4_ARTEFACT_OFF_SHIELD_AVALON";

function freshMarket() {
  return {
    [ART]: {
      Martlock: { sell_price: 5000 },
      Lymhurst: { sell_price: 4000 },
      Caerleon: { sell_price: 6000 },
      "Black Market": { sell_price: 7000 },
    },
  };
}

let passed = 0, failed = 0;
function test(name, fn) {
  _priceOverrides = {};
  _cityForces = {};
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.error(`  FAIL: ${name}\n    ${e.message}`); }
}

console.log("Rolling section independence:");

test("baseline: each section auto-picks its own best city", () => {
  const md = freshMarket();
  assert.strictEqual(pickRollingSellCity(md, ART, ROYAL).city, "Martlock");
  assert.strictEqual(pickRollingSellCity(md, ART, CAERLEON).city, "Black Market");
});

test("royal edit (force+override Martlock) does NOT bleed into Caerleon", () => {
  const md = freshMarket();
  setCityForce(ART, "sell", "Martlock");
  setOverridePrice(ART, "Martlock", 99999);

  const royal = pickRollingSellCity(md, ART, ROYAL);
  assert.strictEqual(royal.city, "Martlock");
  assert.strictEqual(royal.price, 99999); // royal honors the user's edit

  const cae = pickRollingSellCity(md, ART, CAERLEON);
  assert.ok(CAERLEON.includes(cae.city), "Caerleon must stay within its own cities");
  assert.notStrictEqual(cae.city, "Martlock");
  assert.notStrictEqual(cae.price, 99999); // the royal override must not leak
  assert.strictEqual(cae.city, "Black Market"); // its own market best
});

test("Caerleon edit (force+override Black Market) does NOT bleed into Royal", () => {
  const md = freshMarket();
  setCityForce(ART, "sell", "Black Market");
  setOverridePrice(ART, "Black Market", 88888);

  const cae = pickRollingSellCity(md, ART, CAERLEON);
  assert.strictEqual(cae.city, "Black Market");
  assert.strictEqual(cae.price, 88888);

  const royal = pickRollingSellCity(md, ART, ROYAL);
  assert.ok(ROYAL.includes(royal.city), "Royal must stay within its own cities");
  assert.notStrictEqual(royal.city, "Black Market");
  assert.notStrictEqual(royal.price, 88888);
  assert.strictEqual(royal.city, "Martlock");
});

test("a royal-city override is invisible to the Caerleon section", () => {
  // Override on a royal city only (no matching market in Caerleon's set).
  const md = { [ART]: { Caerleon: { sell_price: 6000 }, "Black Market": { sell_price: 7000 } } };
  setCityForce(ART, "sell", "Lymhurst");
  setOverridePrice(ART, "Lymhurst", 123456);

  const cae = pickRollingSellCity(md, ART, CAERLEON);
  assert.notStrictEqual(cae.price, 123456);
  assert.ok(CAERLEON.includes(cae.city));
});

test("forcing a city that IS in the section still works (regression guard)", () => {
  const md = freshMarket();
  // Force Lymhurst within the royal section even though Martlock is pricier.
  setCityForce(ART, "sell", "Lymhurst");
  setOverridePrice(ART, "Lymhurst", 4500);
  const royal = pickRollingSellCity(md, ART, ROYAL);
  assert.strictEqual(royal.city, "Lymhurst");
  assert.strictEqual(royal.price, 4500);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
