/**
 * Test: Luxury (trade) goods in the Flipping table.
 *
 * Luxury goods (TREASURE_* / shopcategory="luxurygoods") are NOT market flips:
 * they are looted/fished/dropped, then sold to a marketplace TRADER NPC at a
 * FIXED price in ONE designated city. The six royal families each bind to a
 * single royal/Caerleon city; the Avalonian trio (TREASURE_AVALON_*) sells in
 * ANY city. NPC sell price = items.xml itemvalue * 40 (verified in-game:
 * Ritual Candles 1,000 / Blood Chalice 5,000 / Sacrificial Dagger 25,000).
 *
 * Flip model: BUY cheap on the market (looters dump loot) -> haul -> SELL to the
 * fixed NPC. So the sell side is a constant, independent of any market sell
 * order, and the sell city is fixed (or, for "any", the buy city itself).
 *
 * Zone routing (Black/Red Zone Routes toggle):
 *   ON  -> may buy in any city and haul cross-zone to the sell city.
 *   OFF -> royal<->Caerleon hauling blocked. A Caerleon-locked good (Ritual
 *          family) may only be bought in Caerleon; a royal-locked good only in
 *          the royal cities. "any" goods sell locally, so zone never blocks them.
 *
 * Black-box over an in-file replica of the luxury route + margin logic (same
 * no-DOM / no-live-API pattern as flipping-buy-sell-split.test.cjs).
 *
 * Run: node tests/flipping-luxury-goods.test.cjs
 */

const assert = require("assert");

// ── City constants (mirror js/data.js) ───────────────────────────────────
const ROYAL_CITIES = ["Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];

// ── Economy constants (mirror js/calculations.js) ─────────────────────────
const SETUP_FEE = 0.025;
let PREMIUM_TAX = 0.04; // premium: 4% sales tax

// ── Toggles (mirror the app's global getters) ─────────────────────────────
let _routesOn = true;
let _instant = false;
const isBlackRedZoneEnabled = () => _routesOn;
const getOrderType = () => (_instant ? "instant" : "market");

// ── Luxury catalog replica (mirror js/data-luxury.js) ─────────────────────
const LUXURY_FLIP_ITEMS = [
  { id: "TREASURE_KNOWLEDGE_RARITY3", name: "Ancient Tome", sellCity: "Martlock", npcPrice: 25000, tier: 6, weight: 6.25 },
  { id: "TREASURE_RITUAL_RARITY1", name: "Ritual Candles", sellCity: "Caerleon", npcPrice: 1000, tier: 4, weight: 2.5 },
  { id: "TREASURE_RITUAL_RARITY2", name: "Blood Chalice", sellCity: "Caerleon", npcPrice: 5000, tier: 5, weight: 5 },
  { id: "TREASURE_RITUAL_RARITY3", name: "Sacrificial Dagger", sellCity: "Caerleon", npcPrice: 25000, tier: 6, weight: 6.25 },
  { id: "TREASURE_AVALON_RARITY3", name: "Golden Sextant", sellCity: "any", npcPrice: 250000, tier: 8, weight: 6.25 },
];
const LUXURY_BY_ID = LUXURY_FLIP_ITEMS.reduce((m, l) => { m[l.id] = l; return m; }, {});
const getLuxuryFlipInfo = (id) => LUXURY_BY_ID[id] || null;

// ── Route builder replica (mirror js/render-flipping.js) ──────────────────
function luxuryBuyCities(sellCity) {
  if (isBlackRedZoneEnabled()) return CITIES;         // cross-zone haul allowed
  if (sellCity === "any") return CITIES;              // sold locally, no haul
  if (sellCity === "Caerleon") return ["Caerleon"];   // royal<->Caerleon blocked
  return ROYAL_CITIES;                                // royal-locked good
}

function getMarketBuyPrice(md, id, city) {
  const d = md[id]?.[city];
  if (!d) return 0;
  return (getOrderType() === "instant" ? d.sell_price : d.buy_price) || 0;
}

function buildLuxuryFlipRoute(md, lux) {
  const minVol = getOrderType() === "market" ? 25 : 0;
  const cities = luxuryBuyCities(lux.sellCity);
  let best = { city: null, price: 0 };
  cities.forEach((c) => {
    const p = getMarketBuyPrice(md, lux.id, c);
    const v = md[lux.id]?.[c]?.volume_24h || 0;
    if (p > 0 && v >= minVol && (best.city === null || p < best.price)) {
      best = { city: c, price: p };
    }
  });
  const sellCity = lux.sellCity === "any" ? (best.city || "") : lux.sellCity;
  return {
    buyCity: best.city || "",
    buyPrice: best.price,
    sellCity,
    sellPrice: best.city ? lux.npcPrice : 0,
    travelCost: 0,
  };
}

function calculateFlipMargin(buyPrice, sellPrice, travelCost = 0) {
  if (!buyPrice || !sellPrice) return { profit: 0, margin: 0 };
  const totalCost = buyPrice * (1 + SETUP_FEE) + travelCost;
  const totalRevenue = sellPrice * (1 - PREMIUM_TAX);
  const profit = totalRevenue - totalCost;
  return { profit, margin: (profit / totalCost) * 100 };
}

// ── Harness ───────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function test(name, fn) {
  try {
    _routesOn = true; _instant = false; PREMIUM_TAX = 0.04;
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

console.log("Flipping Luxury Goods Tests\n");

// Sacrificial Dagger is a real luxury good, Caerleon, 25,000.
test("Sacrificial Dagger = TREASURE_RITUAL_RARITY3, Caerleon, 25,000", () => {
  const l = getLuxuryFlipInfo("TREASURE_RITUAL_RARITY3");
  assert.ok(l, "in catalog");
  assert.strictEqual(l.name, "Sacrificial Dagger");
  assert.strictEqual(l.sellCity, "Caerleon");
  assert.strictEqual(l.npcPrice, 25000);
});

test("sell price is the fixed NPC price, ignoring any market sell order", () => {
  const md = { TREASURE_RITUAL_RARITY3: { Caerleon: { buy_price: 9000, sell_price: 999999, volume_24h: 100 } } };
  const r = buildLuxuryFlipRoute(md, getLuxuryFlipInfo("TREASURE_RITUAL_RARITY3"));
  assert.strictEqual(r.sellCity, "Caerleon");
  assert.strictEqual(r.sellPrice, 25000, "NPC fixed price, NOT the 999,999 market sell");
  assert.strictEqual(r.buyCity, "Caerleon");
  assert.strictEqual(r.buyPrice, 9000);
});

test("routes ON: buys the cheapest city and hauls cross-zone to the fixed sell city", () => {
  const md = {
    TREASURE_KNOWLEDGE_RARITY3: {
      Caerleon: { buy_price: 8000, sell_price: 0, volume_24h: 100 },
      Lymhurst: { buy_price: 6000, sell_price: 0, volume_24h: 100 },
      Martlock: { buy_price: 9000, sell_price: 0, volume_24h: 100 },
    },
  };
  const r = buildLuxuryFlipRoute(md, getLuxuryFlipInfo("TREASURE_KNOWLEDGE_RARITY3"));
  assert.strictEqual(r.buyCity, "Lymhurst", "cheapest market buy");
  assert.strictEqual(r.sellCity, "Martlock", "fixed sell city regardless of buy");
  assert.strictEqual(r.sellPrice, 25000);
});

test("routes OFF: Caerleon-locked good may only be bought in Caerleon", () => {
  _routesOn = false;
  const md = {
    TREASURE_RITUAL_RARITY3: {
      Lymhurst: { buy_price: 5000, sell_price: 0, volume_24h: 100 }, // cheaper but royal — blocked
      Caerleon: { buy_price: 9000, sell_price: 0, volume_24h: 100 },
    },
  };
  const r = buildLuxuryFlipRoute(md, getLuxuryFlipInfo("TREASURE_RITUAL_RARITY3"));
  assert.strictEqual(r.buyCity, "Caerleon", "royal buy is blocked with routes off");
  assert.strictEqual(r.buyPrice, 9000);
});

test("routes OFF: royal-locked good may only be bought in royal cities", () => {
  _routesOn = false;
  const md = {
    TREASURE_KNOWLEDGE_RARITY3: {
      Caerleon: { buy_price: 4000, sell_price: 0, volume_24h: 100 }, // cheaper but Caerleon — blocked
      Martlock: { buy_price: 7000, sell_price: 0, volume_24h: 100 },
    },
  };
  const r = buildLuxuryFlipRoute(md, getLuxuryFlipInfo("TREASURE_KNOWLEDGE_RARITY3"));
  assert.strictEqual(r.buyCity, "Martlock", "Caerleon buy is blocked with routes off");
});

test("Avalonian 'any' good: sells in the cheapest buy city, no haul", () => {
  const md = {
    TREASURE_AVALON_RARITY3: {
      Thetford: { buy_price: 100000, sell_price: 0, volume_24h: 50 },
      Bridgewatch: { buy_price: 80000, sell_price: 0, volume_24h: 50 },
    },
  };
  const r = buildLuxuryFlipRoute(md, getLuxuryFlipInfo("TREASURE_AVALON_RARITY3"));
  assert.strictEqual(r.buyCity, "Bridgewatch");
  assert.strictEqual(r.sellCity, "Bridgewatch", "'any' sells where bought");
  assert.strictEqual(r.sellPrice, 250000);
});

test("margin: NPC revenue taxed, buy pays setup fee", () => {
  const buy = 9000, npc = 25000;
  const m = calculateFlipMargin(buy, npc, 0);
  const expected = npc * (1 - 0.04) - buy * (1 + 0.025);
  assert.strictEqual(Math.round(m.profit), Math.round(expected));
  assert.ok(m.profit > 0, "profitable at these prices");
});

test("no market data anywhere: sell price 0, zero margin (no-data row)", () => {
  const r = buildLuxuryFlipRoute({}, getLuxuryFlipInfo("TREASURE_RITUAL_RARITY3"));
  assert.strictEqual(r.buyCity, "");
  assert.strictEqual(r.sellPrice, 0);
  assert.strictEqual(calculateFlipMargin(r.buyPrice, r.sellPrice).profit, 0);
});

test("market mode gates buy on 25+ daily volume; instant mode does not", () => {
  const md = { TREASURE_RITUAL_RARITY1: { Caerleon: { buy_price: 800, sell_price: 900, volume_24h: 3 } } };
  // market: 3 < 25 -> no buy
  let r = buildLuxuryFlipRoute(md, getLuxuryFlipInfo("TREASURE_RITUAL_RARITY1"));
  assert.strictEqual(r.buyCity, "", "thin market rejected in market mode");
  // instant: volume gate lifted, buys at the sell_price
  _instant = true;
  r = buildLuxuryFlipRoute(md, getLuxuryFlipInfo("TREASURE_RITUAL_RARITY1"));
  assert.strictEqual(r.buyCity, "Caerleon");
  assert.strictEqual(r.buyPrice, 900, "instant buy reads sell_price");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
