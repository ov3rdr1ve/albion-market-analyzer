/**
 * Test: a craft buys where it crafts.
 *
 * The material and refining legs of a route must stay on ONE side of the zone
 * line — the royal continent (Brecilien included) or the outlands (Caerleon and
 * the Smuggler's Network) — whatever "Black/Red Zone Routes" says. That toggle
 * governs the SALE only.
 *
 * Reported: the Crafting Planner bought a Master's Cape's fiber and hide in
 * Caerleon, refined at Lymhurst and Martlock, crafted in Brecilien for the +15%
 * cape bonus, then sold back at the Black Market — crossing the line twice for a
 * route the model billed nothing for. Cross-zone hauling is free here (the
 * Brecilien Travel Planner fee is disabled and no other leg is charged), so with
 * the toggle on every material independently picked the globally cheapest city
 * and a five-city route was compared against a one-city route at the same price.
 *
 * Two functions divide the work and this pins the split:
 *
 *   isValidSourceCity(buy, craft)   — the haul TO the station. Zone-locked
 *                                     always; the toggle only decides whether
 *                                     the Smuggler's Network is reachable.
 *   isInvalidCrossRoute(buy, sell)  — the sale. Unchanged, toggle-governed.
 *
 * Both are the real functions out of js/utils.js, with the routes checkbox faked
 * so the toggle is steerable. No live API.
 *
 * Run: node tests/zone-locked-sourcing.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Module = require("module");

const SMUG = "Smuggler's Den";
const load = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf-8");

// -- The app's real city rules, with a steerable routes checkbox --------------
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
  vm.runInContext(load(s), sandbox);
}
const get = (name) => vm.runInContext(name, sandbox);
const CITIES = get("CITIES");
const ROYAL_CITIES = get("ROYAL_CITIES");
const isValidSourceCity = get("isValidSourceCity");
const isInvalidCrossRoute = get("isInvalidCrossRoute");

function withRoutes(on, fn) {
  const prev = routesCheckbox.checked;
  routesCheckbox.checked = on;
  try { return fn(); } finally { routesCheckbox.checked = prev; }
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

console.log("\n=== Sourcing is zone-locked on BOTH toggle settings ===");

// [buyCity, craftCity, validRoutesOff, validRoutesOn, label]
const SOURCE_CASES = [
  // Royal to royal: free hauling, and always was.
  ["Martlock", "Lymhurst", true, true, "royal mats, royal craft"],
  ["Fort Sterling", "Fort Sterling", true, true, "same royal city"],
  // Brecilien is royal (reached by yellow Mists portals), so it hauls freely
  // with the rest of the continent — this is the leg the reported row kept.
  ["Lymhurst", "Brecilien", true, true, "royal mats, Brecilien craft"],
  ["Brecilien", "Martlock", true, true, "Brecilien mats, royal craft"],
  // Caerleon to itself: self-contained, never crosses anything.
  ["Caerleon", "Caerleon", true, true, "Caerleon mats, Caerleon craft"],
  // The regression under test: the toggle used to wave these through.
  ["Caerleon", "Lymhurst", false, false, "Caerleon mats, royal craft"],
  ["Caerleon", "Brecilien", false, false, "Caerleon mats, Brecilien craft (the report)"],
  ["Lymhurst", "Caerleon", false, false, "royal mats, Caerleon craft"],
  // The Smuggler's Network is outlands: unreachable with routes off, and on the
  // CAERLEON side of the line with routes on.
  [SMUG, "Caerleon", false, true, "den mats, Caerleon craft"],
  [SMUG, "Lymhurst", false, false, "den mats, royal craft"],
  [SMUG, "Brecilien", false, false, "den mats, Brecilien craft"],
];

SOURCE_CASES.forEach(([buy, craft, off, on, label]) => {
  test(`routes OFF: ${label} -> ${off}`, () => {
    withRoutes(false, () => assert.strictEqual(isValidSourceCity(buy, craft), off));
  });
  test(`routes ON:  ${label} -> ${on}`, () => {
    withRoutes(true, () => assert.strictEqual(isValidSourceCity(buy, craft), on));
  });
});

test("the toggle changes the answer for den legs only", () => {
  const moved = SOURCE_CASES.filter(([, , off, on]) => off !== on).map(([b, c]) => `${b}->${c}`);
  assert.deepStrictEqual(moved, [`${SMUG}->Caerleon`]);
});

test("a missing city is never a valid source", () => {
  withRoutes(true, () => {
    assert.strictEqual(isValidSourceCity(null, "Lymhurst"), false);
    assert.strictEqual(isValidSourceCity("Lymhurst", ""), false);
  });
});

test("the Black Market is never a source (it buys, it does not sell)", () => {
  withRoutes(true, () => {
    assert.strictEqual(isValidSourceCity("Black Market", "Caerleon"), false);
    assert.strictEqual(isValidSourceCity("Black Market", "Lymhurst"), false);
  });
});

console.log("\n=== The SALE still crosses — isInvalidCrossRoute is untouched ===");

test("routes ON: a royal craft can still sell into the Black Market", () => {
  withRoutes(true, () => {
    assert.strictEqual(isInvalidCrossRoute("Brecilien", "Black Market"), false);
    assert.strictEqual(isInvalidCrossRoute("Lymhurst", "Caerleon"), false);
  });
});

test("routes OFF: the sale is blocked, as before", () => {
  withRoutes(false, () => {
    assert.strictEqual(isInvalidCrossRoute("Lymhurst", "Caerleon"), true);
    assert.strictEqual(isInvalidCrossRoute("Caerleon", "Lymhurst"), true);
  });
});

test("one crossing is allowed and it is the last leg", () => {
  withRoutes(true, () => {
    // buy royal -> craft Brecilien -> sell Black Market
    assert.strictEqual(isValidSourceCity("Martlock", "Brecilien"), true);
    assert.strictEqual(isInvalidCrossRoute("Brecilien", "Black Market"), false);
    // buy Caerleon -> craft Brecilien -> sell Black Market  (the reported route)
    assert.strictEqual(isValidSourceCity("Caerleon", "Brecilien"), false);
  });
});

console.log("\n=== The buy pool that every table shares ===");

// getValidBuyCitiesForRefine is the one helper the material pools go through
// (js/refining-chain-pricing.js). Loaded on top of the same city rules.
const poolMod = new Module("zone-locked-pool");
const chainSrc = load("js/refining-chain-pricing.js");
const slice = chainSrc.slice(
  chainSrc.indexOf("function getValidBuyCitiesForRefine"),
  chainSrc.indexOf("// Per-unit Brecilien Travel Planner fee"),
);
poolMod._compile(
  `const routesOn = { on: false };
   const CITIES = ${JSON.stringify(CITIES)};
   const ROYAL_CITIES = ${JSON.stringify(ROYAL_CITIES)};
   const BLACK_ZONE_CITIES = ${JSON.stringify(get("BLACK_ZONE_CITIES"))};
   const CITY_REFINE_SPEC = {};
   const isBlackRedZoneEnabled = () => routesOn.on;
   const isValidSourceCity = ${isValidSourceCity.toString()};
   ` + slice +
  "\nmodule.exports = { getValidBuyCitiesForRefine, getRefineCityFor, routesOn };",
  "refining-chain-pricing.js",
);
const { getValidBuyCitiesForRefine, routesOn } = poolMod.exports;

test("routes ON: a royal refine city no longer offers Caerleon or the den", () => {
  routesOn.on = true;
  const pool = getValidBuyCitiesForRefine("Lymhurst");
  assert.ok(!pool.includes("Caerleon"), pool.join(", "));
  assert.ok(!pool.includes(SMUG), pool.join(", "));
  assert.ok(pool.includes("Martlock") && pool.includes("Brecilien"), pool.join(", "));
});

test("routes ON: a Caerleon refine city offers Caerleon and the den only", () => {
  routesOn.on = true;
  assert.deepStrictEqual(getValidBuyCitiesForRefine("Caerleon").sort(), ["Caerleon", SMUG].sort());
});

test("routes OFF: a Caerleon refine city loses the den, keeping itself", () => {
  routesOn.on = false;
  assert.deepStrictEqual(getValidBuyCitiesForRefine("Caerleon"), ["Caerleon"]);
});

test("routes OFF: a royal refine city is unchanged by this work", () => {
  routesOn.on = false;
  assert.deepStrictEqual(getValidBuyCitiesForRefine("Lymhurst").sort(), [...ROYAL_CITIES].sort());
});

test("an explicit Buy City pick still narrows the pool, never widens it", () => {
  routesOn.on = true;
  assert.deepStrictEqual(
    getValidBuyCitiesForRefine("Lymhurst", { buyCities: ["Martlock", "Caerleon"] }),
    ["Martlock"]);
  assert.deepStrictEqual(
    getValidBuyCitiesForRefine("Lymhurst", { buyCities: ["Caerleon"] }), []);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
