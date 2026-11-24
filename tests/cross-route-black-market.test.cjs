/**
 * Test: which routes can reach the Black Market.
 *
 * The Black Market is a sell-only order book that physically sits INSIDE
 * Caerleon. So reaching it is not a rule of its own — it is the ordinary
 * "can this buy city reach Caerleon?" question, and the answer is the same one
 * isInvalidCrossRoute already gives for Caerleon's public market:
 *
 *   - Black/Red Zone Routes OFF — the player never leaves the royal ring, so
 *     only a Caerleon buy can reach it. A royal, Brecilien or Smuggler's Den
 *     origin is dead, exactly as royal -> Caerleon is dead.
 *   - Black/Red Zone Routes ON — the haul is opted into, so any buy city can
 *     reach it, exactly as any buy city can reach Caerleon.
 *
 * The rule used to sit ABOVE the routes toggle and demand buyCity === "Caerleon"
 * unconditionally, which made the Black Market invisible to every royal-origin
 * row in Flipping, Crafting, the Craft Planner, Consumables, Mounts, Enchanting,
 * Transmute, Rerolling and Rolling even with routes on.
 *
 * Buying AT the Black Market is never possible at any setting: it takes bids
 * from players and sells to nobody.
 *
 * Run: node tests/cross-route-black-market.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const BM = "Black Market";
const SMUG = "Smuggler's Den";

function loadScript(filePath) {
  return fs.readFileSync(path.join(__dirname, "..", filePath), "utf-8");
}

// Fake the "include-caerleon" checkbox so isBlackRedZoneEnabled() is steerable.
const routesCheckbox = { checked: false };
const sandbox = {
  window: {},
  document: {
    getElementById: (id) => (id === "include-caerleon" ? routesCheckbox : null),
  },
  localStorage: { getItem: () => null, setItem: () => {} },
  exports: {},
};
vm.createContext(sandbox);
for (const s of ["js/item-names.js", "js/data.js", "js/utils.js"]) {
  try { vm.runInContext(loadScript(s), sandbox); }
  catch (e) { console.error(`Error loading ${s}: ${e.message}`); process.exit(1); }
}
const extract = (name) => vm.runInContext(name, sandbox);
const CITIES = extract("CITIES");
const SELL_CITIES = extract("SELL_CITIES");
const ROYAL_CITIES = extract("ROYAL_CITIES");
const isInvalidCrossRoute = extract("isInvalidCrossRoute");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    failed++;
  }
}
const withRoutes = (on, fn) => {
  routesCheckbox.checked = on;
  try { fn(); } finally { routesCheckbox.checked = false; }
};

console.log("\n=== Black Market membership ===");

test("Black Market is a sell city, never a buy city", () => {
  assert.ok(SELL_CITIES.includes(BM));
  assert.ok(!CITIES.includes(BM));
});

console.log("\n=== Selling INTO the Black Market ===");

// [routesOn, buyCity, invalid?, label]
const BM_SELL_CASES = [
  // Routes OFF: only Caerleon can reach it, same as Caerleon's own market.
  [false, "Caerleon", false, "OFF: Caerleon -> BM"],
  [false, "Lymhurst", true, "OFF: royal -> BM"],
  [false, "Martlock", true, "OFF: royal -> BM (second royal)"],
  [false, "Brecilien", true, "OFF: Brecilien -> BM"],
  [false, SMUG, true, "OFF: Smuggler's Den -> BM"],
  // Routes ON: the black/red haul is opted into, so every origin reaches it.
  [true, "Caerleon", false, "ON: Caerleon -> BM"],
  [true, "Lymhurst", false, "ON: royal -> BM"],
  [true, "Martlock", false, "ON: royal -> BM (second royal)"],
  [true, "Brecilien", false, "ON: Brecilien -> BM"],
  [true, SMUG, false, "ON: Smuggler's Den -> BM"],
];

BM_SELL_CASES.forEach(([on, buy, invalid, label]) => {
  test(`${label} ${invalid ? "blocked" : "allowed"}`, () => {
    withRoutes(on, () => {
      assert.strictEqual(isInvalidCrossRoute(buy, BM), invalid);
    });
  });
});

test("a BM sale is allowed exactly when the same buy city can reach Caerleon", () => {
  [false, true].forEach((on) => {
    withRoutes(on, () => {
      [...ROYAL_CITIES, "Caerleon", SMUG].forEach((buy) => {
        assert.strictEqual(
          isInvalidCrossRoute(buy, BM),
          isInvalidCrossRoute(buy, "Caerleon"),
          `${buy} -> BM disagrees with ${buy} -> Caerleon (routes ${on ? "ON" : "OFF"})`,
        );
      });
    });
  });
});

console.log("\n=== Buying AT the Black Market ===");

[false, true].forEach((on) => {
  [...ROYAL_CITIES, "Caerleon", SMUG, BM].forEach((sell) => {
    test(`routes ${on ? "ON" : "OFF"}: BM -> ${sell} blocked`, () => {
      withRoutes(on, () => {
        assert.strictEqual(isInvalidCrossRoute(BM, sell), true);
      });
    });
  });
});

console.log("\n=== Non-Black-Market routes are unchanged ===");

// [routesOn, buy, sell, invalid?, label]
const REGRESSION_CASES = [
  [false, "Lymhurst", "Martlock", false, "OFF: royal -> royal"],
  [false, "Caerleon", "Caerleon", false, "OFF: Caerleon -> Caerleon"],
  [false, "Lymhurst", "Caerleon", true, "OFF: royal -> Caerleon"],
  [false, "Caerleon", "Lymhurst", true, "OFF: Caerleon -> royal"],
  [false, SMUG, SMUG, true, "OFF: den -> den"],
  [true, "Lymhurst", "Caerleon", false, "ON: royal -> Caerleon"],
  [true, "Caerleon", "Lymhurst", false, "ON: Caerleon -> royal"],
  [true, SMUG, SMUG, false, "ON: den -> den"],
];

REGRESSION_CASES.forEach(([on, buy, sell, invalid, label]) => {
  test(`${label} ${invalid ? "blocked" : "allowed"}`, () => {
    withRoutes(on, () => {
      assert.strictEqual(isInvalidCrossRoute(buy, sell), invalid);
    });
  });
});

console.log("\n=== Missing arguments ===");

test("a missing city is always invalid", () => {
  withRoutes(true, () => {
    assert.strictEqual(isInvalidCrossRoute("", BM), true);
    assert.strictEqual(isInvalidCrossRoute("Caerleon", ""), true);
    assert.strictEqual(isInvalidCrossRoute(null, null), true);
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
