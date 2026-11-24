/**
 * Tests for the Black Zone (Outlands) production-bonus data module.
 *
 * Black-box: we only touch the exported constants and the pure helpers,
 * asserting them against the numbers published on the Albion wiki
 * (Resource Return Rate / Hideout / patch 19.000.1):
 *
 *   - Hideout GENERAL crafting bonus comes from Power Level alone.
 *   - Hideout SPECIALIZED crafting bonus is a Zone Quality × Power Level matrix.
 *   - Hideout REFINING is a flat 15 PB (10 in the Roads), with no specialization.
 *   - Rests are flat: 15 refining / 18 crafting / 33 specialized crafting.
 *   - RRR = PB / (100 + PB); focus adds a flat +59 PB.
 *
 * Run: node tests/black-zone-bonuses.test.cjs
 */

const assert = require("assert");

const {
  HIDEOUT_GENERAL_PB,
  HIDEOUT_SPEC_PB,
  HIDEOUT_REFINE_PB,
  ROADS_REFINE_PB,
  REST_BONUS,
  BIOME_TO_CITY,
  REST_CRAFT_SPEC,
  ZONE_QUALITIES,
  POWER_LEVELS,
  getHideoutCraftPB,
  getBlackZoneRRR,
} = require("../js/data-black-zone.js");

const { CITY_CRAFT_SPEC, calcRRR } = require("../js/calculations.js");
const { prettyCraftType, CRAFT_TYPE_LABELS } = require("../js/render-city-bonuses.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

// Wiki: "Hideouts Specialized Crafting Bonus", rows = zone quality 1..6,
// columns = power level 1..9.
const WIKI_SPEC_PB = {
  1: [1, 10.75, 19.5, 27.25, 34, 39.75, 45.5, 51.25, 57],
  2: [6, 15.75, 24.5, 32.25, 39, 44.75, 50.5, 56.25, 62],
  3: [11, 20.75, 29.5, 37.25, 44, 49.75, 55.5, 61.25, 67],
  4: [16, 25.75, 34.5, 42.25, 49, 54.75, 60.5, 66.25, 72],
  5: [21, 30.75, 39.5, 47.25, 54, 59.75, 65.5, 71.25, 77],
  6: [26, 35.75, 44.5, 52.25, 59, 64.75, 70.5, 76.25, 82],
};

// Wiki: "Hideouts General Crafting Bonus", power level 1..9.
const WIKI_GENERAL_PB = [0, 6, 11, 15, 18, 20, 22, 24, 26];

console.log("\n=== production bonus tables match the wiki ===");

test("ZONE_QUALITIES is 1..6 and POWER_LEVELS is 1..9", () => {
  assert.deepStrictEqual(ZONE_QUALITIES, [1, 2, 3, 4, 5, 6]);
  assert.deepStrictEqual(POWER_LEVELS, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("HIDEOUT_GENERAL_PB matches the wiki power-level row", () => {
  assert.deepStrictEqual(HIDEOUT_GENERAL_PB, WIKI_GENERAL_PB);
});

test("all 54 HIDEOUT_SPEC_PB cells match the wiki matrix", () => {
  ZONE_QUALITIES.forEach((q) => {
    POWER_LEVELS.forEach((p) => {
      assert.strictEqual(
        getHideoutCraftPB(q, p, true),
        WIKI_SPEC_PB[q][p - 1],
        `spec PB mismatch at quality ${q} / power ${p}`,
      );
    });
  });
});

test("getHideoutCraftPB ignores zone quality for the general bonus", () => {
  ZONE_QUALITIES.forEach((q) => {
    POWER_LEVELS.forEach((p) => {
      assert.strictEqual(getHideoutCraftPB(q, p, false), WIKI_GENERAL_PB[p - 1],
        `general PB must not depend on quality (q${q}/p${p})`);
    });
  });
});

test("HIDEOUT_SPEC_PB rows are exposed as a 6×9 matrix", () => {
  assert.strictEqual(Object.keys(HIDEOUT_SPEC_PB).length, 6);
  ZONE_QUALITIES.forEach((q) => {
    assert.strictEqual(HIDEOUT_SPEC_PB[q].length, 9, `quality ${q} needs 9 power levels`);
  });
});

test("refining is flat: 15 in the Outlands, 10 in the Roads, 15 at Rests", () => {
  assert.strictEqual(HIDEOUT_REFINE_PB, 15);
  assert.strictEqual(ROADS_REFINE_PB, 10);
  assert.strictEqual(REST_BONUS.refine, 15);
});

test("Rests craft flat 18 general / 33 specialized", () => {
  assert.strictEqual(REST_BONUS.craftBase, 18);
  assert.strictEqual(REST_BONUS.craftSpec, 33);
});

console.log("\n=== getBlackZoneRRR ===");

// [label, production bonus, wiki base RRR %, wiki RRR-with-focus %]
const RRR_CASES = [
  ["hideout spec, quality 1 / power 1", 1, 1.0, 37.5],
  ["hideout spec, quality 1 / power 9", 57, 36.3, 53.7],
  ["hideout spec, quality 6 / power 1", 26, 20.6, 45.9],
  ["hideout spec, quality 6 / power 9", 82, 45.1, 58.5],
  ["hideout spec, quality 3 / power 5", 44, 30.6, 50.7],
  ["hideout general, power 1", 0, 0, 37.1],
  ["hideout general, power 5", 18, 15.3, 43.5],
  ["hideout general, power 9", 26, 20.6, 45.9],
  ["hideout / rest refining", 15, 13.0, 42.5],
  ["roads hideout refining", 10, 9.1, 40.8],
  ["rest specialized crafting", 33, 24.8, 47.9],
  ["rest general crafting", 18, 15.3, 43.5],
];

RRR_CASES.forEach(([label, pb, expectBase, expectFocus]) => {
  test(`${label} (PB ${pb}): ${expectBase}% base / ${expectFocus}% with focus`, () => {
    const base = getBlackZoneRRR(pb, false) * 100;
    const focus = getBlackZoneRRR(pb, true) * 100;
    assert.ok(Math.abs(base - expectBase) < 0.1,
      `base RRR ${base.toFixed(2)}% != wiki ${expectBase}%`);
    assert.ok(Math.abs(focus - expectFocus) < 0.1,
      `focus RRR ${focus.toFixed(2)}% != wiki ${expectFocus}%`);
  });
});

test("focus adds a flat +59 production bonus (not a multiplier)", () => {
  [0, 15, 33, 82].forEach((pb) => {
    assert.strictEqual(getBlackZoneRRR(pb, true), getBlackZoneRRR(pb + 59, false),
      `focus at PB ${pb} must equal no-focus at PB ${pb + 59}`);
  });
});

test("agrees with calculations.js calcRRR for the same bonus", () => {
  [0, 1, 15, 26, 44, 82].forEach((pb) => {
    assert.strictEqual(getBlackZoneRRR(pb, false), calcRRR(pb / 100),
      `getBlackZoneRRR must reuse the shared RRR formula (PB ${pb})`);
  });
});

test("zero / negative production bonus returns 0", () => {
  assert.strictEqual(getBlackZoneRRR(0, false), 0);
  assert.strictEqual(getBlackZoneRRR(-5, false), 0);
});

console.log("\n=== specialization lists ===");

test("BIOME_TO_CITY maps the 5 Outlands biomes to their royal-city twin", () => {
  assert.deepStrictEqual(BIOME_TO_CITY, {
    Highland: "Martlock",
    Steppe: "Bridgewatch",
    Forest: "Lymhurst",
    Mountain: "Fort Sterling",
    Swamp: "Thetford",
  });
});

test("every biome's city has a craft-spec list in CITY_CRAFT_SPEC", () => {
  Object.values(BIOME_TO_CITY).forEach((city) => {
    assert.ok(Array.isArray(CITY_CRAFT_SPEC[city]) && CITY_CRAFT_SPEC[city].length > 0,
      `CITY_CRAFT_SPEC missing craft list for ${city}`);
  });
});

test("REST_CRAFT_SPEC covers the 3 Rests with weapon + armor lines", () => {
  assert.deepStrictEqual(Object.keys(REST_CRAFT_SPEC).sort(), [
    "Arthur's Rest", "Merlyn's Rest", "Morgana's Rest",
  ]);
  assert.deepStrictEqual(REST_CRAFT_SPEC["Arthur's Rest"].sort(), [
    "axe", "crossbow", "hammer", "knuckles", "mace",
    "plate_armor", "plate_helmet", "plate_shoes", "sword",
  ]);
  assert.deepStrictEqual(REST_CRAFT_SPEC["Merlyn's Rest"].sort(), [
    "bow", "dagger", "leather_armor", "leather_helmet", "leather_shoes",
    "naturestaff", "quarterstaff", "shapeshifterstaff", "spear",
  ]);
  assert.deepStrictEqual(REST_CRAFT_SPEC["Morgana's Rest"].sort(), [
    "arcanestaff", "cloth_armor", "cloth_helmet", "cloth_shoes",
    "cursestaff", "firestaff", "froststaff", "holystaff",
  ]);
});

test("every Rest craft key has a friendly label (no raw kebab leaks)", () => {
  Object.values(REST_CRAFT_SPEC).flat().forEach((key) => {
    if (key.includes("_")) {
      assert.ok(Object.prototype.hasOwnProperty.call(CRAFT_TYPE_LABELS, key),
        `CRAFT_TYPE_LABELS missing label for ${key}`);
    }
    assert.ok(!prettyCraftType(key).includes("_"),
      `prettyCraftType('${key}') still contains an underscore`);
  });
});

test("war gloves render as 'War Gloves', not 'Knuckles'", () => {
  assert.strictEqual(prettyCraftType("knuckles"), "War Gloves");
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
