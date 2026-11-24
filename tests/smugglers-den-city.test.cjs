/**
 * Test: Smuggler's Den as a market city.
 *
 * The Smuggler's Network (35 Smuggler's Dens + 3 Outlands Rests share one order
 * book) is a real marketplace, so the app must let the user price items there —
 * fetch it from the API like any other location and set manual prices on it.
 *
 * Three behaviours are pinned:
 *
 * 1. It is a MARKET city, never a CRAFT city. A den has bank / market / repair /
 *    artifact foundry / faction rep / travel planner — no crafting stations. So
 *    it belongs to CITIES (buy) and SELL_CITIES (sell) but NOT to CRAFT_CITIES,
 *    which is what every craft-city loop iterates.
 *
 * 2. It is deep black zone. With "Black/Red Zone Routes" OFF the royal-only
 *    player cannot reach it at all, so EVERY route touching it is invalid —
 *    unlike Caerleon, whose self-contained Caerleon→Caerleon route stays valid.
 *    With routes ON it trades with everything.
 *
 * 3. The API asks AODP for it (it is in LOCATIONS), and the parser drops the
 *    "0" city rows AODP returns for a location it cannot resolve — those are
 *    all-zero placeholders, not a market.
 *
 * Run: node tests/smugglers-den-city.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

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
const CRAFT_CITIES = extract("CRAFT_CITIES");
const SELL_CITIES = extract("SELL_CITIES");
const ROYAL_CITIES = extract("ROYAL_CITIES");
const BLACK_ZONE_CITIES = extract("BLACK_ZONE_CITIES");
const isInvalidCrossRoute = extract("isInvalidCrossRoute");
const isValidSourceCity = extract("isValidSourceCity");

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
const withRoutes = (on, fn) => { routesCheckbox.checked = on; try { fn(); } finally { routesCheckbox.checked = false; } };

console.log("\n=== Smuggler's Den city membership ===");

test("CITIES includes Smuggler's Den (buy side)", () => {
  assert.ok(CITIES.includes(SMUG), `CITIES = ${CITIES.join(", ")}`);
});

test("SELL_CITIES includes Smuggler's Den (sell side)", () => {
  assert.ok(SELL_CITIES.includes(SMUG));
});

test("CRAFT_CITIES excludes Smuggler's Den (no crafting stations)", () => {
  assert.ok(!CRAFT_CITIES.includes(SMUG));
});

test("CRAFT_CITIES = Caerleon + the royal cities", () => {
  assert.deepStrictEqual([...CRAFT_CITIES].sort(), ["Caerleon", ...ROYAL_CITIES].sort());
});

test("ROYAL_CITIES excludes Smuggler's Den (not a safe-route city)", () => {
  assert.ok(!ROYAL_CITIES.includes(SMUG));
});

test("BLACK_ZONE_CITIES lists Smuggler's Den", () => {
  assert.ok(BLACK_ZONE_CITIES.includes(SMUG));
});

test("Black Market stays sell-only", () => {
  assert.ok(!CITIES.includes("Black Market"));
  assert.ok(SELL_CITIES.includes("Black Market"));
});

console.log("\n=== Zone gating: Black/Red Zone Routes OFF ===");

const ROUTE_CASES_OFF = [
  // [buy, sell, invalid?]
  [SMUG, "Lymhurst", true, "den -> royal blocked"],
  ["Lymhurst", SMUG, true, "royal -> den blocked"],
  [SMUG, "Caerleon", true, "den -> Caerleon blocked"],
  ["Caerleon", SMUG, true, "Caerleon -> den blocked"],
  [SMUG, SMUG, true, "den -> den blocked (den itself is unreachable)"],
  [SMUG, "Black Market", true, "den -> Black Market blocked"],
  ["Caerleon", "Caerleon", false, "Caerleon -> Caerleon still valid"],
  ["Caerleon", "Black Market", false, "Caerleon -> Black Market still valid"],
  ["Lymhurst", "Martlock", false, "royal -> royal still valid"],
  ["Lymhurst", "Caerleon", true, "royal -> Caerleon still blocked"],
];

ROUTE_CASES_OFF.forEach(([buy, sell, invalid, label]) => {
  test(`routes OFF: ${label}`, () => {
    withRoutes(false, () => {
      assert.strictEqual(isInvalidCrossRoute(buy, sell), invalid);
    });
  });
});

console.log("\n=== Zone gating: Black/Red Zone Routes ON ===");

const ROUTE_CASES_ON = [
  [SMUG, "Lymhurst", "den -> royal"],
  ["Lymhurst", SMUG, "royal -> den"],
  [SMUG, "Caerleon", "den -> Caerleon"],
  [SMUG, SMUG, "den -> den"],
];

ROUTE_CASES_ON.forEach(([buy, sell, label]) => {
  test(`routes ON: ${label} valid`, () => {
    withRoutes(true, () => {
      assert.strictEqual(isInvalidCrossRoute(buy, sell), false);
    });
  });
});

// The Black Market's order book sits inside Caerleon, so with routes ON it is
// reachable from wherever Caerleon is — see tests/cross-route-black-market.
test("routes ON: Black Market is reachable from anywhere Caerleon is", () => {
  withRoutes(true, () => {
    assert.strictEqual(isInvalidCrossRoute(SMUG, "Black Market"), false);
    assert.strictEqual(isInvalidCrossRoute("Lymhurst", "Black Market"), false);
    assert.strictEqual(isInvalidCrossRoute("Caerleon", "Black Market"), false);
    // Never a buy city, at any setting.
    assert.strictEqual(isInvalidCrossRoute("Black Market", "Caerleon"), true);
  });
});

console.log("\n=== isValidSourceCity (material buy city vs craft city) ===");

// Sourcing is zone-locked whatever the toggle says (tests/zone-locked-sourcing):
// the routes setting decides only whether the black-zone den is REACHABLE, and
// the den sits on the Caerleon side of the line.
const SOURCE_CASES = [
  // [routesOn, buyCity, craftCity, valid, label]
  [false, SMUG, "Lymhurst", false, "OFF: den mats for a royal craft"],
  [false, SMUG, "Caerleon", false, "OFF: den mats for a Caerleon craft"],
  [false, "Lymhurst", "Caerleon", false, "OFF: royal mats for a Caerleon craft"],
  [false, "Caerleon", "Lymhurst", false, "OFF: Caerleon mats for a royal craft"],
  [false, "Martlock", "Lymhurst", true, "OFF: royal mats for a royal craft"],
  [false, "Caerleon", "Caerleon", true, "OFF: Caerleon mats for a Caerleon craft"],
  [true, SMUG, "Lymhurst", false, "ON: den mats for a royal craft"],
  [true, SMUG, "Caerleon", true, "ON: den mats for a Caerleon craft"],
  [true, "Lymhurst", "Caerleon", false, "ON: royal mats for a Caerleon craft"],
  [true, "Caerleon", "Lymhurst", false, "ON: Caerleon mats for a royal craft"],
  [true, "Martlock", "Lymhurst", true, "ON: royal mats for a royal craft"],
  [true, "Caerleon", "Caerleon", true, "ON: Caerleon mats for a Caerleon craft"],
];

SOURCE_CASES.forEach(([on, buy, craft, valid, label]) => {
  test(label, () => {
    withRoutes(on, () => {
      assert.strictEqual(isValidSourceCity(buy, craft), valid);
    });
  });
});

console.log("\n=== API wiring ===");

const apiSrc = loadScript("js/api.js");

test("LOCATIONS asks AODP for Smuggler's Den", () => {
  const m = apiSrc.match(/const LOCATIONS\s*=\s*([\s\S]*?);/);
  assert.ok(m, "LOCATIONS constant not found");
  assert.ok(m[1].includes(SMUG), `LOCATIONS = ${m[1].trim()}`);
});

test("LOCATIONS still lists every other city", () => {
  const m = apiSrc.match(/const LOCATIONS\s*=\s*([\s\S]*?);/);
  [...SELL_CITIES].forEach((c) => assert.ok(m[1].includes(c), `missing ${c}`));
});

test("parser drops AODP's unresolved-location rows (city '0')", () => {
  // AODP answers an unknown location with city "0" and all-zero prices. Those
  // must never land in marketData as a city bucket.
  const parseCtx = {
    window: {},
    document: { getElementById: () => null },
    localStorage: { getItem: () => null, setItem: () => {} },
    console,
  };
  vm.createContext(parseCtx);
  vm.runInContext(loadScript("js/api.js"), parseCtx);
  const isRealCity = vm.runInContext("typeof isRealMarketCity === 'function' ? isRealMarketCity : null", parseCtx);
  assert.ok(isRealCity, "isRealMarketCity() helper not exported by js/api.js");
  assert.strictEqual(isRealCity("0"), false);
  assert.strictEqual(isRealCity(""), false);
  assert.strictEqual(isRealCity(SMUG), true);
  assert.strictEqual(isRealCity("Lymhurst"), true);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
