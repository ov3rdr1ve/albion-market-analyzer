/**
 * Test: getFactionLockCity helper parses _FW_<CITY>_ from item IDs and returns
 * the matching Royal City name. Used to lock FW mount crafting to the only
 * city the game permits (e.g. Saddled Swamp Salamander → Thetford).
 *
 * Run: node tests/faction-lock-city.test.cjs
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const Module = require("module");

const utilsSrc = ["utils", "utils-item-ids", "utils-overrides", "utils-focus-fees"].map((n) => fs.readFileSync(path.join(__dirname, "..", "js", n + ".js"), "utf-8")).join("\n");

// Load utils.js into an isolated module so we can pluck out getFactionLockCity
// without dragging in browser-only globals it may reference elsewhere.
const utilsMod = new Module("utils-faction-lock");
utilsMod._compile(
  utilsSrc + "\nmodule.exports = { getFactionLockCity };",
  "utils.js"
);
const { getFactionLockCity } = utilsMod.exports;

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

console.log("Faction Warfare city-lock tests\n");

// ── direct mapping for all six faction cities ──
const cityMap = [
  ["T5_MOUNT_SWAMPDRAGON_FW_THETFORD",            "Thetford"],
  ["T8_MOUNT_SWAMPDRAGON_FW_THETFORD_ELITE",      "Thetford"],
  ["T5_MOUNT_DIREBOAR_FW_LYMHURST",               "Lymhurst"],
  ["T8_MOUNT_DIREBOAR_FW_LYMHURST_ELITE",         "Lymhurst"],
  ["T5_MOUNT_DIREBEAR_FW_FORTSTERLING",           "Fort Sterling"],
  ["T8_MOUNT_DIREBEAR_FW_FORTSTERLING_ELITE",     "Fort Sterling"],
  ["T5_MOUNT_MOABIRD_FW_BRIDGEWATCH",             "Bridgewatch"],
  ["T8_MOUNT_MOABIRD_FW_BRIDGEWATCH_ELITE",       "Bridgewatch"],
  ["T5_MOUNT_RAM_FW_MARTLOCK",                    "Martlock"],
  ["T8_MOUNT_RAM_FW_MARTLOCK_ELITE",              "Martlock"],
  ["T5_MOUNT_GREYWOLF_FW_CAERLEON",               "Caerleon"],
  ["T8_MOUNT_GREYWOLF_FW_CAERLEON_ELITE",         "Caerleon"],
];

cityMap.forEach(([id, city]) => {
  test(`mount id ${id} → ${city}`, () => {
    assert.strictEqual(getFactionLockCity(id), city);
  });
});

// ── farm ids (grown + baby) carry the same lock ──
const farmIds = [
  ["T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY",        "Thetford"],
  ["T5_FARM_SWAMPDRAGON_FW_THETFORD_GROWN",       "Thetford"],
  ["T8_FARM_SWAMPDRAGON_FW_THETFORD_GROWN",       "Thetford"],
  ["T5_FARM_DIREBEAR_FW_FORTSTERLING_GROWN",      "Fort Sterling"],
  ["T8_FARM_DIREBOAR_FW_LYMHURST_GROWN",          "Lymhurst"],
  ["T5_FARM_MOABIRD_FW_BRIDGEWATCH_GROWN",        "Bridgewatch"],
  ["T8_FARM_RAM_FW_MARTLOCK_GROWN",               "Martlock"],
  ["T5_FARM_GREYWOLF_FW_CAERLEON_GROWN",          "Caerleon"],
];

farmIds.forEach(([id, city]) => {
  test(`farm id ${id} → ${city}`, () => {
    assert.strictEqual(getFactionLockCity(id), city);
  });
});

// ── non-FW items return null ──
const nullCases = [
  "T7_MOUNT_SWAMPDRAGON",                    // standard saddled swamp dragon
  "T7_FARM_SWAMPDRAGON_GROWN",
  "T5_FARM_HORSE_BABY",
  "T8_MOUNT_MAMMOTH_BATTLE",
  "T4_MAIN_SWORD",
  "T5_LEATHER",
  "",
  null,
  undefined,
];

nullCases.forEach((id) => {
  test(`non-FW id ${JSON.stringify(id)} → null`, () => {
    assert.strictEqual(getFactionLockCity(id), null);
  });
});

// ── unknown FW suffix returns null (defensive) ──
test("unknown FW suffix returns null", () => {
  assert.strictEqual(getFactionLockCity("T5_MOUNT_FOO_FW_ATLANTIS"), null);
});

// ── case-sensitive: ID format always uses uppercase suffix ──
test("lowercase suffix not matched (game IDs are uppercase)", () => {
  assert.strictEqual(getFactionLockCity("t5_mount_swampdragon_fw_thetford"), null);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
