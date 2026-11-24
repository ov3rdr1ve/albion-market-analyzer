/**
 * Tests for js/price-edit-dropdown.js — the builder behind the inline price
 * editor's city <select>. Black-box: stub out the globals the builder reads
 * (CITIES, SELL_CITIES, FOOD_ITEMS, getOverridePrice, getOrderType,
 * ITEM_NAMES_MAP, getItemDisplayName), then exercise buildCityOptions and
 * verify the returned shape.
 *
 * Covers:
 *  - cheapest-default selection (buy + sell) for non-food items
 *  - override participation (override beats market when cheaper for buy /
 *    higher for sell)
 *  - no-data fallback returns defaultIndex = -1
 *  - non-food items keep the same itemId across all options; cityToItemId is empty
 *  - food items: each city's option carries that city's cheapest tier
 *  - food default = absolute cheapest (city, tier) combo
 *  - cityToItemId map exposes the resolved tier per city
 *  - plants (non-meat food category) treated symmetrically
 *
 * Run: node tests/price-edit-dropdown.test.cjs
 */

const assert = require("assert");

// --- Set up globals BEFORE requiring the builder so its IIFE-time setup
// is unaffected (the builder reads globals lazily at call time anyway). ---
let _priceOverrides = {};
globalThis.CITIES = ["Caerleon", "Lymhurst", "Bridgewatch", "Fort Sterling", "Martlock", "Thetford", "Brecilien"];
globalThis.SELL_CITIES = [...globalThis.CITIES, "Black Market"];
globalThis.FOOD_ITEMS = {
  meat: ["T3_MEAT", "T4_MEAT", "T5_MEAT", "T6_MEAT", "T7_MEAT", "T8_MEAT"],
  plants: ["T3_WHEAT", "T4_TURNIP", "T5_CABBAGE"],
  chocolate: ["UNIQUE_CONSUMABLE_EVENT_EASTER_2020_CHOCOLATE"],
};
globalThis.ITEM_NAMES_MAP = {
  T3_MEAT: "Raw Chicken",
  T4_MEAT: "Raw Goat",
  T5_MEAT: "Raw Goose",
};
// Active-order mock matching js/utils.js: entries are { buyOrder, sellOrder,
// use }; getOverridePrice returns the ACTIVE value (the `use` field).
globalThis.getOverridePrice = (itemId, city) => {
  const e = _priceOverrides[itemId]?.[city];
  if (e == null || !e.use) return null;
  const v = e.use === "buy" ? e.buyOrder : e.sellOrder;
  return typeof v === "number" ? v : null;
};
// Mirrors js/utils.js getOverrideField: the raw stored buy/sell field value,
// independent of which side is active. The label uses it so an override-only
// city still shows both order fields.
globalThis.getOverrideField = (itemId, city, side) => {
  const e = _priceOverrides[itemId]?.[city];
  if (!e) return null;
  return (side === "buy" ? e.buyOrder : e.sellOrder) ?? null;
};
globalThis.getOrderType = () => "market";
globalThis.getItemDisplayName = (id) => id;

const { buildCityOptions, isFoodItem } = require("../js/price-edit-dropdown.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// Store an active override. `use` defaults to "buy" (the dropdown only ever
// reads the active value, so the side just needs to point at the given price).
function setOverride(itemId, city, price, use = "buy") {
  if (!_priceOverrides[itemId]) _priceOverrides[itemId] = {};
  const e = { use };
  e[use === "buy" ? "buyOrder" : "sellOrder"] = price;
  _priceOverrides[itemId][city] = e;
}

// Store BOTH order fields (the editor saves sell + buy together). `use` marks
// the active side.
function setOverrideBoth(itemId, city, { buyOrder, sellOrder, use = "buy" }) {
  if (!_priceOverrides[itemId]) _priceOverrides[itemId] = {};
  _priceOverrides[itemId][city] = { buyOrder, sellOrder, use };
}

// Helper: build a marketData with buy_price == price for the given (item, city)
// pairs. Volume defaults to 100 (above the dropdown's volume display threshold).
function makeMarket(entries) {
  const md = {};
  entries.forEach(({ id, city, buy, sell, vol }) => {
    if (!md[id]) md[id] = {};
    md[id][city] = {
      buy_price: buy ?? 0,
      sell_price: sell ?? 0,
      volume_24h: vol ?? 100,
    };
  });
  return md;
}

console.log("\n=== Price-edit dropdown builder ===");

// ----- Bug 1: generic cheapest-default selection -----

test("buy: defaults to cheapest market city", () => {
  _priceOverrides = {};
  const market = makeMarket([
    { id: "T5_VINEHEART", city: "Caerleon",     buy: 1500 },
    { id: "T5_VINEHEART", city: "Lymhurst",     buy: 1450 },
    { id: "T5_VINEHEART", city: "Thetford",     buy: 1397 },
    { id: "T5_VINEHEART", city: "Martlock",     buy: 1360 }, // cheapest
    { id: "T5_VINEHEART", city: "Bridgewatch",  buy: 1462 },
  ]);
  const r = buildCityOptions("T5_VINEHEART", "buy", market);
  assert.ok(r.defaultIndex >= 0, "expected a default to be picked");
  assert.strictEqual(r.options[r.defaultIndex].city, "Martlock");
  assert.strictEqual(r.options[r.defaultIndex].price, 1360);
});

test("sell: defaults to highest market city", () => {
  _priceOverrides = {};
  const market = makeMarket([
    { id: "T5_VINEHEART", city: "Martlock", sell: 800 },
    { id: "T5_VINEHEART", city: "Caerleon", sell: 950 }, // highest
    { id: "T5_VINEHEART", city: "Lymhurst", sell: 875 },
  ]);
  const r = buildCityOptions("T5_VINEHEART", "sell", market);
  assert.ok(r.defaultIndex >= 0);
  assert.strictEqual(r.options[r.defaultIndex].city, "Caerleon");
  assert.strictEqual(r.options[r.defaultIndex].price, 950);
});

test("override beats market when cheaper (buy)", () => {
  _priceOverrides = {};
  const market = makeMarket([
    { id: "T5_VINEHEART", city: "Martlock", buy: 2000 },
    { id: "T5_VINEHEART", city: "Thetford", buy: 1800 },
  ]);
  setOverride("T5_VINEHEART", "Thetford", 1200); // override is cheaper
  const r = buildCityOptions("T5_VINEHEART", "buy", market);
  assert.strictEqual(r.options[r.defaultIndex].city, "Thetford");
  assert.strictEqual(r.options[r.defaultIndex].price, 1200);
});

test("override beats market when higher (sell)", () => {
  _priceOverrides = {};
  const market = makeMarket([
    { id: "T5_VINEHEART", city: "Caerleon", sell: 950 },
    { id: "T5_VINEHEART", city: "Lymhurst", sell: 600 },
  ]);
  setOverride("T5_VINEHEART", "Lymhurst", 1500); // override is higher
  const r = buildCityOptions("T5_VINEHEART", "sell", market);
  assert.strictEqual(r.options[r.defaultIndex].city, "Lymhurst");
  assert.strictEqual(r.options[r.defaultIndex].price, 1500);
});

test("no-data fallback returns defaultIndex = -1", () => {
  _priceOverrides = {};
  const market = {}; // no data anywhere
  const r = buildCityOptions("T5_VINEHEART", "buy", market);
  assert.strictEqual(r.defaultIndex, -1);
  assert.strictEqual(r.options.length, globalThis.CITIES.length);
});

test("non-food keeps single itemId across all options", () => {
  _priceOverrides = {};
  const market = makeMarket([
    { id: "T5_VINEHEART", city: "Martlock", buy: 1360 },
    { id: "T5_VINEHEART", city: "Thetford", buy: 1397 },
  ]);
  const r = buildCityOptions("T5_VINEHEART", "buy", market);
  assert.strictEqual(r.isFood, false);
  assert.strictEqual(r.cityToItemId.size, 0);
  r.options.forEach((o) => assert.strictEqual(o.itemId, "T5_VINEHEART"));
});

// ----- Bug 2: cross-tier food dropdown (opt-in via { foodMode: true }) -----
// Food-mode is opt-in so recipe-ingredient cells that happen to reference a
// food itemId (e.g. Raw Mutton inside Deepwater Kraken Salad) stay tier-
// specific. Only the breeding feed cells in mounts/faction-spending pass
// foodMode:true.

test("food cross-tier: each city shows its cheapest tier", () => {
  _priceOverrides = {};
  // Caerleon: T3 cheaper than T5; Lymhurst: T4 cheaper than T3
  const market = makeMarket([
    { id: "T3_MEAT", city: "Caerleon", buy: 100 },
    { id: "T5_MEAT", city: "Caerleon", buy: 200 },
    { id: "T3_MEAT", city: "Lymhurst", buy: 130 },
    { id: "T4_MEAT", city: "Lymhurst", buy: 110 },
  ]);
  const r = buildCityOptions("T5_MEAT", "buy", market, { foodMode: true });
  assert.strictEqual(r.isFood, true);
  const caer = r.options.find((o) => o.city === "Caerleon");
  const lym = r.options.find((o) => o.city === "Lymhurst");
  assert.strictEqual(caer.itemId, "T3_MEAT", "Caerleon should resolve to T3_MEAT");
  assert.strictEqual(caer.price, 100);
  assert.strictEqual(lym.itemId, "T4_MEAT", "Lymhurst should resolve to T4_MEAT");
  assert.strictEqual(lym.price, 110);
});

test("food default = absolute cheapest combo across cities and tiers", () => {
  _priceOverrides = {};
  const market = makeMarket([
    { id: "T3_MEAT", city: "Caerleon", buy: 100 },
    { id: "T4_MEAT", city: "Martlock", buy: 80 }, // absolute cheapest combo
    { id: "T5_MEAT", city: "Lymhurst", buy: 120 },
  ]);
  const r = buildCityOptions("T5_MEAT", "buy", market, { foodMode: true });
  assert.ok(r.defaultIndex >= 0);
  const chosen = r.options[r.defaultIndex];
  assert.strictEqual(chosen.city, "Martlock");
  assert.strictEqual(chosen.itemId, "T4_MEAT");
  assert.strictEqual(chosen.price, 80);
});

test("food: cityToItemId map exposes the resolved tier per city", () => {
  _priceOverrides = {};
  const market = makeMarket([
    { id: "T3_MEAT", city: "Caerleon", buy: 100 },
    { id: "T4_MEAT", city: "Martlock", buy: 80 },
    { id: "T6_MEAT", city: "Lymhurst", buy: 120 },
  ]);
  const r = buildCityOptions("T5_MEAT", "buy", market, { foodMode: true });
  assert.strictEqual(r.cityToItemId.get("Caerleon"), "T3_MEAT");
  assert.strictEqual(r.cityToItemId.get("Martlock"), "T4_MEAT");
  assert.strictEqual(r.cityToItemId.get("Lymhurst"), "T6_MEAT");
});

// ----- Regression: opt-out is the default (Raw Mutton in salad recipe bug) -----
// Before the opt-in switch, ANY food-item cell on the buy side auto-enabled
// cross-tier substitution. That broke the Deepwater Kraken Salad recipe cell
// for Raw Mutton [T6] — clicking the price opened a dropdown that re-routed
// the override to whatever meat tier was cheapest at the chosen city
// (e.g. T3_MEAT). The override saved under T3_MEAT, so the Raw Mutton row
// kept rendering the live market price as if no edit happened.

test("food itemId WITHOUT foodMode opt-in stays tier-specific (default)", () => {
  _priceOverrides = {};
  const market = makeMarket([
    { id: "T3_MEAT", city: "Caerleon", buy: 100 },
    { id: "T6_MEAT", city: "Caerleon", buy: 326 },
    { id: "T6_MEAT", city: "Bridgewatch", buy: 326 },
  ]);
  // No opts → foodMode defaults to false even though T6_MEAT is in FOOD_ITEMS.
  const r = buildCityOptions("T6_MEAT", "buy", market);
  assert.strictEqual(r.isFood, false, "Default must NOT enable food mode");
  assert.strictEqual(r.foodCategory, null, "foodCategory exposed to commit must be null");
  assert.strictEqual(r.cityToItemId.size, 0, "cityToItemId must be empty — commit reads itemId directly");
  r.options.forEach((opt) => {
    assert.strictEqual(opt.itemId, "T6_MEAT",
      `every option must keep T6_MEAT, got ${opt.itemId} for ${opt.city}`);
  });
});

test("recipe ingredient: cheapest pick is the row's tier, not a cheaper tier", () => {
  _priceOverrides = {};
  // Recipe wants T6_MEAT. T3_MEAT is cheaper but irrelevant — the dropdown
  // must never offer it as a substitute when foodMode is off.
  const market = makeMarket([
    { id: "T3_MEAT", city: "Caerleon", buy: 50 },   // cheaper tier — must NOT win
    { id: "T6_MEAT", city: "Caerleon", buy: 350 },
    { id: "T6_MEAT", city: "Bridgewatch", buy: 326 }, // cheapest T6
  ]);
  const r = buildCityOptions("T6_MEAT", "buy", market);
  const chosen = r.options[r.defaultIndex];
  assert.strictEqual(chosen.itemId, "T6_MEAT");
  assert.strictEqual(chosen.city, "Bridgewatch");
  assert.strictEqual(chosen.price, 326);
});

// ----- Bug: food cross-tier was applied to SELL side too. Result was that
// committing a sell-price override on Raw Mutton saved the override to a
// DIFFERENT meat tier (whichever was cheapest at that city), so the row's
// sell cell appeared to "switch back" to the live market price on re-render.
// Food mode is a buy-side feature (cross-tier feed scanning) — sell side
// must always edit the row's own itemId.

test("food on SELL side: isFood is false even with foodMode opt-in (cross-tier is buy-only)", () => {
  _priceOverrides = {};
  const market = makeMarket([
    { id: "T3_MEAT", city: "Caerleon", buy: 100, sell: 150 },
    { id: "T5_MEAT", city: "Caerleon", buy: 200, sell: 250 },
    { id: "T6_MEAT", city: "Lymhurst", buy: 180, sell: 430 },
  ]);
  // Pass foodMode:true to prove sell-side IGNORES it (cross-tier is buy-only).
  const r = buildCityOptions("T6_MEAT", "sell", market, { foodMode: true });
  assert.strictEqual(r.isFood, false,
    "sell side must skip food mode so the override saves to T6_MEAT, not a cheaper tier");
  assert.strictEqual(r.foodCategory, null,
    "foodCategory exposed to commit must be null on sell side");
});

test("food on SELL side: every option's itemId is the row's own itemId", () => {
  _priceOverrides = {};
  const market = makeMarket([
    { id: "T3_MEAT", city: "Caerleon", buy: 100, sell: 150 },
    { id: "T6_MEAT", city: "Lymhurst", buy: 180, sell: 430 },
    { id: "T6_MEAT", city: "Martlock", sell: 433 },
  ]);
  const r = buildCityOptions("T6_MEAT", "sell", market, { foodMode: true });
  r.options.forEach((opt) => {
    assert.strictEqual(opt.itemId, "T6_MEAT",
      `every sell-side option must carry T6_MEAT, got ${opt.itemId} for ${opt.city}`);
  });
  assert.strictEqual(r.cityToItemId.size, 0,
    "cityToItemId must be empty on sell side (commit reads itemId directly)");
});

test("food on SELL side: default picks the city with the highest SELL price", () => {
  _priceOverrides = {};
  const market = makeMarket([
    { id: "T6_MEAT", city: "Caerleon", sell: 380 },
    { id: "T6_MEAT", city: "Lymhurst", sell: 430 },
    { id: "T6_MEAT", city: "Martlock", sell: 450 }, // highest
  ]);
  const r = buildCityOptions("T6_MEAT", "sell", market, { foodMode: true });
  const chosen = r.options[r.defaultIndex];
  assert.strictEqual(chosen.city, "Martlock");
  assert.strictEqual(chosen.itemId, "T6_MEAT");
  assert.strictEqual(chosen.price, 450);
});

test("food on SELL side: sell-price override wins over market on the same city", () => {
  _priceOverrides = {};
  const market = makeMarket([
    { id: "T6_MEAT", city: "Martlock", sell: 433 },
  ]);
  setOverride("T6_MEAT", "Martlock", 600); // user typed 600 silver/unit
  const r = buildCityOptions("T6_MEAT", "sell", market, { foodMode: true });
  const martlock = r.options.find((o) => o.city === "Martlock");
  assert.strictEqual(martlock.price, 600, "override must win over the market sell");
  assert.strictEqual(martlock.itemId, "T6_MEAT", "still the row's itemId, not a cheaper tier");
});

test("food on BUY side: still uses cross-tier (regression — buy-side feature intact)", () => {
  _priceOverrides = {};
  const market = makeMarket([
    { id: "T3_MEAT", city: "Caerleon", buy: 100 },
    { id: "T6_MEAT", city: "Caerleon", buy: 200 },
  ]);
  const r = buildCityOptions("T6_MEAT", "buy", market, { foodMode: true });
  assert.strictEqual(r.isFood, true, "buy side with foodMode opt-in keeps food mode");
  const caer = r.options.find((o) => o.city === "Caerleon");
  assert.strictEqual(caer.itemId, "T3_MEAT", "buy side resolves to cheapest tier");
});

test("plants treated same as meat (cross-tier scan)", () => {
  _priceOverrides = {};
  const market = makeMarket([
    { id: "T3_WHEAT",   city: "Caerleon", buy: 50 },
    { id: "T4_TURNIP",  city: "Caerleon", buy: 30 }, // cheapest at Caerleon
    { id: "T5_CABBAGE", city: "Lymhurst", buy: 25 }, // cheapest overall
  ]);
  const r = buildCityOptions("T4_TURNIP", "buy", market, { foodMode: true });
  assert.strictEqual(r.isFood, true);
  const caer = r.options.find((o) => o.city === "Caerleon");
  assert.strictEqual(caer.itemId, "T4_TURNIP");
  assert.strictEqual(caer.price, 30);
  const chosen = r.options[r.defaultIndex];
  assert.strictEqual(chosen.city, "Lymhurst");
  assert.strictEqual(chosen.itemId, "T5_CABBAGE");
});

test("isFoodItem detects all three categories", () => {
  assert.strictEqual(isFoodItem("T5_MEAT"), "meat");
  assert.strictEqual(isFoodItem("T4_TURNIP"), "plants");
  assert.strictEqual(isFoodItem("UNIQUE_CONSUMABLE_EVENT_EASTER_2020_CHOCOLATE"), "chocolate");
  assert.strictEqual(isFoodItem("T5_VINEHEART"), null);
  assert.strictEqual(isFoodItem("T8_2H_HAMMER"), null);
});

test("returns foodCategory for meat / plants / chocolate (opt-in)", () => {
  _priceOverrides = {};
  const market = makeMarket([{ id: "T5_MEAT", city: "Lymhurst", buy: 100 }]);
  assert.strictEqual(buildCityOptions("T5_MEAT", "buy", market, { foodMode: true }).foodCategory, "meat");
  assert.strictEqual(buildCityOptions("T4_TURNIP", "buy", market, { foodMode: true }).foodCategory, "plants");
  assert.strictEqual(
    buildCityOptions("UNIQUE_CONSUMABLE_EVENT_EASTER_2020_CHOCOLATE", "buy", market, { foodMode: true }).foodCategory,
    "chocolate",
  );
});

test("returns foodCategory: null for non-food items", () => {
  _priceOverrides = {};
  const market = makeMarket([{ id: "T8_2H_HAMMER", city: "Lymhurst", buy: 1000 }]);
  // foodMode:true on a non-food item still returns null (isFoodItem rejects it).
  const r = buildCityOptions("T8_2H_HAMMER", "buy", market, { foodMode: true });
  assert.strictEqual(r.foodCategory, null);
  assert.strictEqual(r.isFood, false);
});

test("food no-data: every city shows 'no data' but builder still returns options", () => {
  _priceOverrides = {};
  const market = {};
  const r = buildCityOptions("T5_MEAT", "buy", market, { foodMode: true });
  assert.strictEqual(r.isFood, true);
  assert.strictEqual(r.defaultIndex, -1);
  assert.strictEqual(r.options.length, globalThis.CITIES.length);
  // Without data, optItemId stays as the original itemId (no tier resolution).
  r.options.forEach((o) => {
    assert.strictEqual(o.price, 0);
    assert.strictEqual(o.itemId, "T5_MEAT");
  });
});

test("override on a non-rendered tier wins for that city in food mode", () => {
  // User has previously locked in T4_MEAT @ Martlock at 70 silver.
  // Even though no T4_MEAT market data exists in this scan, the override
  // should make T4_MEAT @ Martlock the cheapest for that city, beating
  // T3_MEAT @ Martlock market 90.
  _priceOverrides = {};
  const market = makeMarket([
    { id: "T3_MEAT", city: "Martlock", buy: 90 },
    { id: "T5_MEAT", city: "Caerleon", buy: 100 },
  ]);
  setOverride("T4_MEAT", "Martlock", 70);
  const r = buildCityOptions("T5_MEAT", "buy", market, { foodMode: true });
  const martlock = r.options.find((o) => o.city === "Martlock");
  assert.strictEqual(martlock.itemId, "T4_MEAT");
  assert.strictEqual(martlock.price, 70);
  // And it should be the absolute default since 70 < 100
  assert.strictEqual(r.options[r.defaultIndex].city, "Martlock");
});

// ----- preferCity: pin the default-select to the city the user clicked -----
// Bug: when the user clicked an editable cell labeled "Caerleon 276,262", the
// dropdown's defaultIndex used best-price logic and frequently landed on a
// DIFFERENT city (e.g., a royal city with higher sell). Pressing Enter saved
// the override at that highlighted city, not the cell's city → the row's
// section-locked lookup (Caerleon row searches only ["Caerleon", "Black
// Market"]) ignored the out-of-scope override and the cell looked unchanged.
//
// Fix: opts.preferCity (set by the caller from the cell's data-city) pins the
// defaultIndex to that city, so a no-change Enter saves the override at the
// city the user thinks they're editing.

test("preferCity: pins defaultIndex to the requested city even when another has best price", () => {
  _priceOverrides = {};
  const market = makeMarket([
    { id: "T5_VINEHEART", city: "Caerleon", sell: 276262 },
    { id: "T5_VINEHEART", city: "Lymhurst", sell: 350000 }, // would normally win
  ]);
  const r = buildCityOptions("T5_VINEHEART", "sell", market, { preferCity: "Caerleon" });
  assert.ok(r.defaultIndex >= 0, "expected a default to be picked");
  assert.strictEqual(r.options[r.defaultIndex].city, "Caerleon",
    "preferCity must beat best-price logic");
  assert.strictEqual(r.options[r.defaultIndex].price, 276262);
});

test("preferCity: pins default on BUY side too (cheapest is ignored when preferCity is set)", () => {
  _priceOverrides = {};
  const market = makeMarket([
    { id: "T5_VINEHEART", city: "Martlock", buy: 1360 }, // cheapest
    { id: "T5_VINEHEART", city: "Thetford", buy: 1500 },
  ]);
  const r = buildCityOptions("T5_VINEHEART", "buy", market, { preferCity: "Thetford" });
  assert.strictEqual(r.options[r.defaultIndex].city, "Thetford");
  assert.strictEqual(r.options[r.defaultIndex].price, 1500);
});

test("preferCity: pinned even when the preferred city has no data", () => {
  // The 'no data ea' food cell: user clicks an editable cell whose own city
  // has no market data. The dropdown should still default to that city so
  // the user can type in the override; the no-data fallback is the caller's
  // job (app.js prefills input with 0).
  _priceOverrides = {};
  const market = makeMarket([
    { id: "T5_VINEHEART", city: "Lymhurst", buy: 1500 },
    // Caerleon has no data
  ]);
  const r = buildCityOptions("T5_VINEHEART", "buy", market, { preferCity: "Caerleon" });
  const caerleonOpt = r.options.find((o) => o.city === "Caerleon");
  assert.ok(caerleonOpt, "Caerleon option must exist");
  assert.strictEqual(r.options[r.defaultIndex].city, "Caerleon",
    "even no-data preferCity wins over a city with data");
  assert.strictEqual(caerleonOpt.price, 0, "no-data city has price 0");
});

test("preferCity: falls back to best-price when preferCity is NOT in cityList", () => {
  // Defensive — if the cell's data-city is garbage or a city no longer in
  // CITIES, the dropdown shouldn't lose its default. Falls back to the
  // best-price city via existing logic.
  _priceOverrides = {};
  const market = makeMarket([
    { id: "T5_VINEHEART", city: "Martlock", buy: 1360 },
    { id: "T5_VINEHEART", city: "Thetford", buy: 1500 },
  ]);
  const r = buildCityOptions("T5_VINEHEART", "buy", market, { preferCity: "Atlantis" });
  // Falls back to cheapest = Martlock
  assert.strictEqual(r.options[r.defaultIndex].city, "Martlock");
});

test("preferCity: empty string / missing falls back to best-price", () => {
  _priceOverrides = {};
  const market = makeMarket([
    { id: "T5_VINEHEART", city: "Martlock", buy: 1360 },
    { id: "T5_VINEHEART", city: "Thetford", buy: 1500 },
  ]);
  const r1 = buildCityOptions("T5_VINEHEART", "buy", market, { preferCity: "" });
  const r2 = buildCityOptions("T5_VINEHEART", "buy", market, { preferCity: null });
  const r3 = buildCityOptions("T5_VINEHEART", "buy", market, {}); // no preferCity at all
  // All three fall back to cheapest = Martlock
  assert.strictEqual(r1.options[r1.defaultIndex].city, "Martlock");
  assert.strictEqual(r2.options[r2.defaultIndex].city, "Martlock");
  assert.strictEqual(r3.options[r3.defaultIndex].city, "Martlock");
});

test("preferCity: works alongside foodMode (cross-tier dropdown defaults to preferCity)", () => {
  // Real-world case: faction-spending breed-detail food cell. data-city is
  // "Caerleon" (the section's feed-search city). The food-mode dropdown
  // does cross-tier substitution per city, and preferCity pins the default
  // to Caerleon so the user's commit lands there.
  _priceOverrides = {};
  const market = makeMarket([
    { id: "T3_MEAT", city: "Caerleon", buy: 100 },
    { id: "T4_MEAT", city: "Lymhurst", buy: 80 }, // absolute cheapest combo
    { id: "T5_MEAT", city: "Lymhurst", buy: 120 },
  ]);
  const r = buildCityOptions("T5_MEAT", "buy", market, {
    foodMode: true,
    preferCity: "Caerleon",
  });
  assert.strictEqual(r.isFood, true);
  const chosen = r.options[r.defaultIndex];
  assert.strictEqual(chosen.city, "Caerleon", "preferCity beats absolute cheapest combo");
  assert.strictEqual(chosen.itemId, "T3_MEAT", "Caerleon's cheapest tier resolved");
  assert.strictEqual(chosen.price, 100);
});

test("preferCity: no-data-anywhere case still defaults to preferCity (not -1)", () => {
  // Edge case: no market data anywhere AND preferCity is in CITIES. Without
  // preferCity the defaultIndex would be -1; with preferCity it should be
  // the index of that city's option so the editor opens with a sensible
  // pre-selection.
  _priceOverrides = {};
  const market = {};
  const r = buildCityOptions("T5_VINEHEART", "buy", market, { preferCity: "Caerleon" });
  const caerleonIdx = r.options.findIndex((o) => o.city === "Caerleon");
  assert.ok(caerleonIdx >= 0);
  assert.strictEqual(r.defaultIndex, caerleonIdx,
    "no-data + preferCity must still produce a defaulted index");
});

// ----- Active override: the chosen order's value surfaces on BOTH dropdowns,
// regardless of side or order-type toggle (it's the single effective price). --

test("active override (use=buy) surfaces as the price on both buy and sell dropdowns", () => {
  _priceOverrides = {};
  const market = makeMarket([
    { id: "T5_VINEHEART", city: "Martlock", buy: 1000, sell: 1500 },
  ]);
  setOverride("T5_VINEHEART", "Martlock", 700, "buy");
  const buyOpt = buildCityOptions("T5_VINEHEART", "buy", market).options.find((o) => o.city === "Martlock");
  const sellOpt = buildCityOptions("T5_VINEHEART", "sell", market).options.find((o) => o.city === "Martlock");
  assert.strictEqual(buyOpt.price, 700, "buy dropdown shows the active value");
  assert.strictEqual(sellOpt.price, 700, "sell dropdown shows the same active value");
});

test("active override (use=sell) surfaces the sell-order value on both dropdowns", () => {
  _priceOverrides = {};
  const market = makeMarket([
    { id: "T5_VINEHEART", city: "Martlock", buy: 1000, sell: 1500 },
  ]);
  setOverride("T5_VINEHEART", "Martlock", 2200, "sell");
  const buyOpt = buildCityOptions("T5_VINEHEART", "buy", market).options.find((o) => o.city === "Martlock");
  const sellOpt = buildCityOptions("T5_VINEHEART", "sell", market).options.find((o) => o.city === "Martlock");
  assert.strictEqual(buyOpt.price, 2200);
  assert.strictEqual(sellOpt.price, 2200);
});

// ----- Quality Rerolling: dropdown must source from the quality slice -----
// Bug: the Quality Rerolling table stores prices in lastQualityMarketData
// (keyed [itemId][quality][city]), but the editor passed lastMarketData
// (keyed [itemId][city]) to buildCityOptions — so every city showed
// "no data". app.js now flattens the cell's quality slice into the plain
// [itemId][city] shape before calling the builder. These tests pin that
// contract: given the flattened slice, the dropdown produces real prices.

// Mirror app.js: build { [itemId]: lastQualityMarketData[itemId][quality] }.
function flattenQualitySlice(qualityData, itemId, quality) {
  return { [itemId]: qualityData?.[itemId]?.[quality] || {} };
}

test("rerolling buy: flattened quality slice yields real per-city prices (not no-data)", () => {
  _priceOverrides = {};
  // lastQualityMarketData shape: [itemId][quality][city]
  const qualityData = {
    T8_SHOES_PLATE_SET3: {
      1: { // Normal
        Lymhurst: { buy_price: 49, sell_price: 60, volume_24h: 30 },
        "Fort Sterling": { buy_price: 45, sell_price: 55, volume_24h: 12 },
      },
    },
  };
  const market = flattenQualitySlice(qualityData, "T8_SHOES_PLATE_SET3", 1);
  const r = buildCityOptions("T8_SHOES_PLATE_SET3", "buy", market, { preferCity: "Lymhurst" });
  const lym = r.options.find((o) => o.city === "Lymhurst");
  const fs = r.options.find((o) => o.city === "Fort Sterling");
  assert.strictEqual(lym.price, 49, "Lymhurst buy price must come from the quality slice");
  assert.strictEqual(fs.price, 45, "Fort Sterling buy price must come from the quality slice");
  assert.ok(r.defaultIndex >= 0, "a city must be defaulted, not -1");
});

test("rerolling sell: flattened quality slice yields real sell prices per city", () => {
  _priceOverrides = {};
  const qualityData = {
    T8_SHOES_PLATE_SET3: {
      4: { // Excellent (the rerolled target quality)
        "Fort Sterling": { buy_price: 90000, sell_price: 100000, volume_24h: 5 },
        Thetford: { buy_price: 110000, sell_price: 125110, volume_24h: 3 },
      },
    },
  };
  const market = flattenQualitySlice(qualityData, "T8_SHOES_PLATE_SET3", 4);
  const r = buildCityOptions("T8_SHOES_PLATE_SET3", "sell", market, { preferCity: "Fort Sterling" });
  const thet = r.options.find((o) => o.city === "Thetford");
  assert.strictEqual(thet.price, 125110, "Thetford sell price must come from the quality slice");
  // preferCity pins the default to the clicked city even though Thetford sells higher.
  assert.strictEqual(r.options[r.defaultIndex].city, "Fort Sterling");
});

test("rerolling: missing quality slice degrades to all-no-data without throwing", () => {
  _priceOverrides = {};
  // Quality 4 for this item was never scanned → slice is {}.
  const market = flattenQualitySlice({ T8_SHOES_PLATE_SET3: { 1: {} } }, "T8_SHOES_PLATE_SET3", 4);
  const r = buildCityOptions("T8_SHOES_PLATE_SET3", "sell", market);
  assert.strictEqual(r.defaultIndex, -1);
  r.options.forEach((o) => assert.strictEqual(o.price, 0));
});

// ----- Label format: show sell order · buy order · vol (in-game layout) -----
// Bug: on the buy side the dropdown only displayed the buy order, so the user
// couldn't see sell prices while editing. The label now shows the full order
// book at each city — sell (left) · buy (right) · 24h vol — matching the
// in-game market window and the editor's sell-left/buy-right input layout.

test("label shows sell · buy · vol on the buy side", () => {
  _priceOverrides = {};
  const market = makeMarket([
    { id: "T5_VINEHEART", city: "Martlock", buy: 1812, sell: 2950, vol: 14219 },
  ]);
  const r = buildCityOptions("T5_VINEHEART", "buy", market);
  const opt = r.options.find((o) => o.city === "Martlock");
  assert.strictEqual(opt.label, "Martlock — 2,950 · 1,812 · 14,219 vol");
});

test("label shows sell · buy · vol on the sell side too", () => {
  _priceOverrides = {};
  const market = makeMarket([
    { id: "T5_VINEHEART", city: "Caerleon", buy: 900, sell: 950, vol: 3763 },
  ]);
  const r = buildCityOptions("T5_VINEHEART", "sell", market);
  const opt = r.options.find((o) => o.city === "Caerleon");
  assert.strictEqual(opt.label, "Caerleon — 950 · 900 · 3,763 vol");
});

test("label: a missing side renders an em dash, vol omitted at zero", () => {
  _priceOverrides = {};
  const market = makeMarket([
    { id: "T5_VINEHEART", city: "Lymhurst", buy: 1404, sell: 0, vol: 0 },
  ]);
  const r = buildCityOptions("T5_VINEHEART", "buy", market);
  const opt = r.options.find((o) => o.city === "Lymhurst");
  assert.strictEqual(opt.label, "Lymhurst — — · 1,404");
});

test("label: override field wins over the market for that side; ⚡ appended", () => {
  _priceOverrides = {};
  const market = makeMarket([
    { id: "T5_VINEHEART", city: "Thetford", buy: 1800, sell: 2000, vol: 500 },
  ]);
  setOverride("T5_VINEHEART", "Thetford", 1200, "buy"); // buy override beats market buy
  const r = buildCityOptions("T5_VINEHEART", "buy", market);
  const opt = r.options.find((o) => o.city === "Thetford");
  assert.strictEqual(opt.label, "Thetford — 2,000 · 1,200 · 500 vol ⚡");
});

test("label: override-only city (no market) shows BOTH stored sell and buy", () => {
  // The reported bug: Thetford had no live order book, only an override storing
  // sell 2198 + buy 1557. The label must show both, not just the active side.
  _priceOverrides = {};
  const market = {}; // no market data anywhere
  setOverrideBoth("T5_VINEHEART", "Thetford", { sellOrder: 2198, buyOrder: 1557, use: "buy" });
  const r = buildCityOptions("T5_VINEHEART", "buy", market);
  const opt = r.options.find((o) => o.city === "Thetford");
  assert.strictEqual(opt.label, "Thetford — 2,198 · 1,557 ⚡");
});

test("label: override-only with a single stored field shows that side, dash for the other", () => {
  _priceOverrides = {};
  const market = {}; // no market data anywhere
  setOverride("T5_VINEHEART", "Bridgewatch", 1500, "buy");
  const r = buildCityOptions("T5_VINEHEART", "buy", market);
  const opt = r.options.find((o) => o.city === "Bridgewatch");
  assert.strictEqual(opt.label, "Bridgewatch — — · 1,500 ⚡");
});

test("label: food mode shows the resolved tier name before the order book", () => {
  _priceOverrides = {};
  const market = makeMarket([
    { id: "T3_MEAT", city: "Caerleon", buy: 100, sell: 130, vol: 2000 },
  ]);
  const r = buildCityOptions("T5_MEAT", "buy", market, { foodMode: true });
  const opt = r.options.find((o) => o.city === "Caerleon");
  assert.strictEqual(opt.label, "Caerleon Raw Chicken — 130 · 100 · 2,000 vol");
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
