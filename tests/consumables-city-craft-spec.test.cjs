/**
 * Test: consumables (Potions and Meals) participate in city crafting
 * specialization per the Albion Wiki "Local Production Bonus":
 *   - Brecilien gets +15% on Potion crafts
 *   - Caerleon gets +15% on Food (Meal) crafts
 *
 * Source-loading via `new Function` follows the project pattern used in
 * tests/city-craft-spec.test.cjs and tests/artifact-rrr-exclusion.test.cjs:
 * the input is a checked-in source file, not user input.
 *
 * Run: node tests/consumables-city-craft-spec.test.cjs
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

function loadFileContent(relPath) {
  return fs.readFileSync(path.join(__dirname, "..", relPath), "utf-8");
}

// The city bonus tables were split into js/data-city-bonuses.js; the sandbox
// needs both sources, in load order.
const calcSrc = loadFileContent("js/data-city-bonuses.js") + (loadFileContent("js/calculations.js") + loadFileContent("js/calculations-margins.js"));
const sandbox = new Function(
  `${calcSrc}; return { CITY_CRAFT_SPEC, getCraftRRR, getConsumableCraftType, calcRRR };`,
)();
const { CITY_CRAFT_SPEC, getCraftRRR, getConsumableCraftType, calcRRR } = sandbox;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL: ${name} - ${e.message}`);
  }
}

console.log("Consumables City Craft Spec Tests\n");

// -- Helper: id -> craftType ----------------------------------------------
const potionIds = [
  "T3_POTION_HEAL", "T8_POTION_ENERGY", "T5_POTION_POISON",
  "T6_POTION_STONESKIN", "T8_POTION_GIGANTIFY", "T4_POTION_REVIVE",
  "T3_POTION_SLOWFIELD", "T6_POTION_COOLDOWN", "T8_POTION_CLEANSE",
];
potionIds.forEach((id) => {
  test(`getConsumableCraftType("${id}") -> "potion"`, () => {
    assert.strictEqual(getConsumableCraftType(id), "potion");
  });
});

const mealIds = [
  "T3_MEAL_PIE", "T4_MEAL_STEW", "T5_MEAL_SANDWICH",
  "T6_MEAL_OMELETTE", "T7_MEAL_SOUP", "T8_MEAL_ROAST", "T2_MEAL_SALAD",
  "T1_MEAL_SOUP_FISH", "T2_MEAL_SALAD_FISH", "T3_MEAL_PIE_FISH",
  "T3_MEAL_OMELETTE_FISH", "T4_MEAL_STEW_FISH", "T4_MEAL_SANDWICH_FISH",
  "T3_MEAL_ROAST_FISH",
  "T3_MEAL_OMELETTE_AVALON", "T4_MEAL_STEW_AVALON", "T4_MEAL_SANDWICH_AVALON",
];
mealIds.forEach((id) => {
  test(`getConsumableCraftType("${id}") -> "food"`, () => {
    assert.strictEqual(getConsumableCraftType(id), "food");
  });
});

const nonConsumables = [
  "T4_BAG", "T5_CAPE", "T6_2H_NATURESTAFF",
  "T3_COMFREY", "T4_BURDOCK", "T8_MEAT", "T6_MILK", "T4_BREAD",
  null, undefined, "",
];
nonConsumables.forEach((id) => {
  test(`getConsumableCraftType(${JSON.stringify(id)}) -> null`, () => {
    assert.strictEqual(getConsumableCraftType(id), null);
  });
});

// -- CITY_CRAFT_SPEC includes "potion" at Brecilien, "food" at Caerleon ---
test(`CITY_CRAFT_SPEC.Brecilien includes "potion"`, () => {
  assert.ok(
    CITY_CRAFT_SPEC.Brecilien.includes("potion"),
    `Expected Brecilien to specialize in "potion", got ${JSON.stringify(CITY_CRAFT_SPEC.Brecilien)}`,
  );
});

test(`CITY_CRAFT_SPEC.Caerleon includes "food"`, () => {
  assert.ok(
    CITY_CRAFT_SPEC.Caerleon.includes("food"),
    `Expected Caerleon to specialize in "food", got ${JSON.stringify(CITY_CRAFT_SPEC.Caerleon)}`,
  );
});

// -- Specialization is exclusive: potion only at Brecilien, food only at Caerleon
test(`only Brecilien specializes in "potion"`, () => {
  const cities = Object.entries(CITY_CRAFT_SPEC)
    .filter(([, types]) => types.includes("potion"))
    .map(([city]) => city);
  assert.deepStrictEqual(cities, ["Brecilien"]);
});

test(`only Caerleon specializes in "food"`, () => {
  const cities = Object.entries(CITY_CRAFT_SPEC)
    .filter(([, types]) => types.includes("food"))
    .map(([city]) => city);
  assert.deepStrictEqual(cities, ["Caerleon"]);
});

// -- RRR math: spec city beats base city by exactly the +15% bonus delta --
test(`Brecilien("potion") RRR > Lymhurst("potion") RRR (focus on)`, () => {
  const breci = getCraftRRR("Brecilien", "potion", true);
  const lym = getCraftRRR("Lymhurst", "potion", true);
  // Brecilien: 18% + 15% + 59% -> calcRRR(0.92)
  // Lymhurst: 18% + 59% -> calcRRR(0.77)
  assert.strictEqual(breci, calcRRR(0.18 + 0.15 + 0.59));
  assert.strictEqual(lym, calcRRR(0.18 + 0.59));
  assert.ok(breci > lym, `expected Brecilien RRR (${breci}) > Lymhurst RRR (${lym})`);
});

test(`Caerleon("food") RRR > Martlock("food") RRR (focus on)`, () => {
  const caer = getCraftRRR("Caerleon", "food", true);
  const mart = getCraftRRR("Martlock", "food", true);
  assert.strictEqual(caer, calcRRR(0.18 + 0.15 + 0.59));
  assert.strictEqual(mart, calcRRR(0.18 + 0.59));
  assert.ok(caer > mart, `expected Caerleon RRR (${caer}) > Martlock RRR (${mart})`);
});

// -- Without focus, spec still applies --
test(`Brecilien("potion") no-focus RRR uses 33% bonus`, () => {
  // Mirror function arithmetic: 0.18 + 0.15 (not literal 0.33) avoids float ULP drift
  assert.strictEqual(getCraftRRR("Brecilien", "potion", false), calcRRR(0.18 + 0.15));
});

test(`Caerleon("food") no-focus RRR uses 33% bonus`, () => {
  assert.strictEqual(getCraftRRR("Caerleon", "food", false), calcRRR(0.18 + 0.15));
});

// -- Cross-city safety: potion at Caerleon does NOT get the spec bonus --
test(`Caerleon("potion") no-focus RRR is base 18% (no Caerleon potion bonus)`, () => {
  assert.strictEqual(getCraftRRR("Caerleon", "potion", false), calcRRR(0.18));
});

test(`Brecilien("food") no-focus RRR is base 18% (no Brecilien food bonus)`, () => {
  assert.strictEqual(getCraftRRR("Brecilien", "food", false), calcRRR(0.18));
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
