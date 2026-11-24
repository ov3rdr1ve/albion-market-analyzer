/**
 * Test: "(no spec)" marker on consumable craft rows.
 *
 * Context: with BMR off the royal section excludes Caerleon, so for food
 * items the 5 royal cities + Brecilien all tie at base 18% RRR (none have
 * the food spec). The picker hands the slot to the first non-Caerleon city
 * in CITIES order — Lymhurst — which is misleading: there's no actual
 * cooking bonus there. The renderer now appends a yellow "(no spec)" tag
 * after the craft city when CITY_CRAFT_SPEC[city] does not include the
 * consumable's craftType.
 *
 * Black-box: mirrors the predicate used in render-consumables.js to decide
 * whether to show the tag, then asserts it for each (city, craftType) pair.
 *
 * Run: node tests/consumables-no-spec-marker.test.cjs
 */

const assert = require("assert");

// Mirrors js/calculations.js — kept narrow on purpose. Only the spec city
// for each consumable type matters here.
const CITY_CRAFT_SPEC = {
  "Fort Sterling": ["hammer", "spear", "holystaff", "plate_helmet", "cloth_armor"],
  Lymhurst: ["sword", "bow", "arcanestaff", "leather_helmet", "leather_shoes"],
  Bridgewatch: ["crossbow", "dagger", "cursestaff", "plate_armor", "cloth_shoes"],
  Thetford: ["mace", "naturestaff", "firestaff", "leather_armor", "cloth_helmet"],
  Martlock: ["axe", "quarterstaff", "froststaff", "plate_shoes", "shield"],
  Caerleon: ["food"],
  Brecilien: ["cape", "bag", "potion"],
};

function getConsumableCraftType(id) {
  if (!id || typeof id !== "string") return null;
  if (id.includes("_POTION_")) return "potion";
  if (id.includes("_MEAL_")) return "food";
  return null;
}

// The predicate the renderer uses to decide whether to append "(no spec)".
function shouldShowNoSpec(itemId, craftCity) {
  const craftType = getConsumableCraftType(itemId);
  if (!craftType) return false;       // not a food/potion → no marker
  const specs = CITY_CRAFT_SPEC[craftCity];
  const hasSpec = specs && specs.includes(craftType);
  return !hasSpec;
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("\n=== Consumable (no spec) marker predicate ===");

// --- FOOD: Caerleon is the only spec city; everywhere else is "(no spec)" ---
[
  "Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Brecilien",
].forEach((city) => {
  test(`food in ${city} → (no spec)`, () => {
    assert.strictEqual(shouldShowNoSpec("T8_MEAL_STEW_FISH", city), true);
  });
});

test("food in Caerleon → no marker (Caerleon has the food spec)", () => {
  assert.strictEqual(shouldShowNoSpec("T8_MEAL_STEW_FISH", "Caerleon"), false);
});

// --- POTION: Brecilien is the only spec city; everywhere else is "(no spec)" ---
[
  "Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch",
].forEach((city) => {
  test(`potion in ${city} → (no spec)`, () => {
    assert.strictEqual(shouldShowNoSpec("T8_POTION_HEAL", city), true);
  });
});

test("potion in Brecilien → no marker (Brecilien has the potion spec)", () => {
  assert.strictEqual(shouldShowNoSpec("T8_POTION_HEAL", "Brecilien"), false);
});

// --- Cross-checks: spec mismatches must each get the marker ---
test("food in Brecilien (potion-spec city) → (no spec)", () => {
  assert.strictEqual(shouldShowNoSpec("T6_MEAL_OMELETTE", "Brecilien"), true);
});

test("potion in Caerleon (food-spec city) → (no spec)", () => {
  assert.strictEqual(shouldShowNoSpec("T6_POTION_STONESKIN", "Caerleon"), true);
});

// --- Items that have no consumable craftType (e.g. tracking toolkit, hideout
// kit, raw materials) get NO marker even if their city has no matching spec.
test("non-food/non-potion item gets no marker (T6 tracking toolkit in Lymhurst)", () => {
  assert.strictEqual(shouldShowNoSpec("T6_2H_TOOL_TRACKING", "Lymhurst"), false);
});

test("raw flip with null craftType gets no marker (T8_FISH in Bridgewatch)", () => {
  assert.strictEqual(shouldShowNoSpec("T8_FISH", "Bridgewatch"), false);
});

// --- Edge cases ---
test("missing/empty itemId → no marker (defensive)", () => {
  assert.strictEqual(shouldShowNoSpec("", "Lymhurst"), false);
  assert.strictEqual(shouldShowNoSpec(null, "Lymhurst"), false);
  assert.strictEqual(shouldShowNoSpec(undefined, "Lymhurst"), false);
});

test("unknown city → marker shows (no entry in CITY_CRAFT_SPEC)", () => {
  // If we ever introduce a new city before its spec is configured, the
  // marker should still show — better to flag than to claim a false bonus.
  assert.strictEqual(shouldShowNoSpec("T8_MEAL_STEW_FISH", "Foundryville"), true);
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
