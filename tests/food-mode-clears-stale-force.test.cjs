/**
 * Tests for the food-mode stale-cityForce-clear behavior wired into the
 * price-edit dropdown commit path.
 *
 * Background — bug being fixed:
 *   Before the food-mode dropdown was added, every commit on a meat/plants/
 *   chocolate cell called setCityForce(itemId, side, selectedCity). That force
 *   stuck around in localStorage. After the food-mode skip was added (so new
 *   commits no longer pin a city), the OLD pins from pre-fix commits remained
 *   active. findCheapestFeed() in render-mounts.js reads getCityForce() per
 *   food id and locks the search to that one city — so the cell renders the
 *   stale-pinned (city, tier) combo even when the user just committed a
 *   cheaper override at a different city.
 *
 *   Fix: on a food-mode commit, clear cityForce for EVERY item in
 *   FOOD_ITEMS[foodCategory] (not just the cell's effectiveItemId). The whole
 *   category is cleared because (a) all stale forces in this category are
 *   pre-fix bugs by construction — there's no UI path post-fix that can set
 *   one — and (b) clearing only the current item leaves other tiers stuck on
 *   stale cities, which masks the actual cheapest combo.
 *
 * Black-box: clearStaleFoodForces is a pure helper that takes a deps bundle.
 * No DOM, no localStorage; tests inject a mock clearCityForce spy.
 *
 * Run: node tests/food-mode-clears-stale-force.test.cjs
 */

const assert = require("assert");

// --- Pure helper extracted from app.js commit path --------------------------
// Lives here as the system-under-test. The actual app.js code calls the same
// logic inline (small enough that re-extracting it as a module would be
// over-engineering for 4 lines).
function clearStaleFoodForces(foodCategory, side, deps) {
  const { FOOD_ITEMS, clearCityForce } = deps;
  if (!foodCategory) return 0;
  const ids = (FOOD_ITEMS && FOOD_ITEMS[foodCategory]) || [];
  ids.forEach((id) => clearCityForce(id, side));
  return ids.length;
}

const FOOD_ITEMS = {
  meat: ["T3_MEAT", "T4_MEAT", "T5_MEAT", "T6_MEAT", "T7_MEAT", "T8_MEAT"],
  plants: [
    "T1_CARROT", "T2_BEAN", "T3_WHEAT", "T4_TURNIP",
    "T5_CABBAGE", "T6_POTATO", "T7_CORN", "T8_PUMPKIN",
  ],
  chocolate: ["UNIQUE_CONSUMABLE_EVENT_EASTER_2020_CHOCOLATE"],
};

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// Mock cityForce store + spy on clears.
function makeMockStore(initial = {}) {
  const store = JSON.parse(JSON.stringify(initial));
  const clears = []; // [{ itemId, side }]
  const clearCityForce = (itemId, side) => {
    clears.push({ itemId, side });
    if (store[itemId]) {
      delete store[itemId][side];
      if (Object.keys(store[itemId]).length === 0) delete store[itemId];
    }
  };
  return { store, clears, clearCityForce };
}

console.log("\n=== Food-mode stale-force clear ===");

test("meat commit clears force on every meat tier", () => {
  // Reproduce the exact bug: user has Thetford pins from pre-fix commits on
  // T6_MEAT and T8_MEAT. They commit Lymhurst T8_MEAT 314 in food mode.
  // After commit, no meat tier should be force-pinned anywhere.
  const { store, clears, clearCityForce } = makeMockStore({
    T8_MEAT: { buy: "Thetford" },
    T6_MEAT: { buy: "Thetford" },
    T5_MEAT: { buy: "Bridgewatch" },
  });
  const cleared = clearStaleFoodForces("meat", "buy", { FOOD_ITEMS, clearCityForce });
  assert.strictEqual(cleared, 6, "Should iterate all 6 meat tiers");
  assert.strictEqual(Object.keys(store).length, 0, "All meat forces removed");
  // Spy fires for every meat id, even ones with no existing pin (idempotent).
  const calledIds = clears.map((c) => c.itemId).sort();
  assert.deepStrictEqual(calledIds, [...FOOD_ITEMS.meat].sort());
  clears.forEach((c) => assert.strictEqual(c.side, "buy"));
});

test("plants commit clears all plant forces, leaves meat alone", () => {
  // Cross-category isolation: a turnip commit must not nuke meat pins
  // (which are in a different category and managed by their own cell).
  const { store, clearCityForce } = makeMockStore({
    T4_TURNIP: { buy: "Lymhurst" },
    T8_PUMPKIN: { buy: "Caerleon" },
    T8_MEAT: { buy: "Thetford" }, // unrelated — must survive
  });
  clearStaleFoodForces("plants", "buy", { FOOD_ITEMS, clearCityForce });
  assert.strictEqual(store.T8_MEAT?.buy, "Thetford", "Meat force untouched");
  assert.strictEqual(store.T4_TURNIP, undefined, "Turnip force cleared");
  assert.strictEqual(store.T8_PUMPKIN, undefined, "Pumpkin force cleared");
});

test("chocolate commit clears the single chocolate id", () => {
  const { store, clearCityForce } = makeMockStore({
    UNIQUE_CONSUMABLE_EVENT_EASTER_2020_CHOCOLATE: { buy: "Caerleon" },
  });
  const cleared = clearStaleFoodForces("chocolate", "buy", { FOOD_ITEMS, clearCityForce });
  assert.strictEqual(cleared, 1);
  assert.strictEqual(Object.keys(store).length, 0);
});

test("non-food: foodCategory=null is a no-op", () => {
  // The commit path computes foodCategory = isFoodItem(itemId), which is null
  // for non-food. Helper should skip cleanly without iterating anything.
  const { store, clears, clearCityForce } = makeMockStore({
    T8_2H_HAMMER: { buy: "Caerleon" },
  });
  const cleared = clearStaleFoodForces(null, "buy", { FOOD_ITEMS, clearCityForce });
  assert.strictEqual(cleared, 0, "Returns 0 ids cleared");
  assert.strictEqual(clears.length, 0, "No clearCityForce calls");
  assert.strictEqual(store.T8_2H_HAMMER?.buy, "Caerleon", "Non-food force untouched");
});

test("missing FOOD_ITEMS entry: unknown category is a no-op", () => {
  // Defensive: if a future category name reaches here without FOOD_ITEMS
  // backing it, helper should skip silently rather than throw.
  const { clears, clearCityForce } = makeMockStore({});
  const cleared = clearStaleFoodForces("nonexistent", "buy", { FOOD_ITEMS, clearCityForce });
  assert.strictEqual(cleared, 0);
  assert.strictEqual(clears.length, 0);
});

test("buy and sell sides are independent", () => {
  // The cell's data-city-list dictates which side gets cleared. A buy-side
  // commit must NOT touch sell-side forces (and vice versa) — those govern
  // different price columns.
  const { store, clearCityForce } = makeMockStore({
    T8_MEAT: { buy: "Thetford", sell: "Caerleon" },
  });
  clearStaleFoodForces("meat", "buy", { FOOD_ITEMS, clearCityForce });
  assert.strictEqual(store.T8_MEAT?.sell, "Caerleon", "Sell side preserved");
  assert.strictEqual(store.T8_MEAT?.buy, undefined, "Buy side cleared");
});

test("idempotent: clearing twice is fine", () => {
  // Hard to misuse — if commit fires twice (once on close, once on enter),
  // the second pass should be a no-op rather than corrupt anything.
  const { store, clearCityForce } = makeMockStore({
    T8_MEAT: { buy: "Thetford" },
  });
  clearStaleFoodForces("meat", "buy", { FOOD_ITEMS, clearCityForce });
  clearStaleFoodForces("meat", "buy", { FOOD_ITEMS, clearCityForce });
  assert.strictEqual(Object.keys(store).length, 0);
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
