/**
 * Test: Adventurer's Challenge reward mounts must NOT appear in the craftable
 * mount catalog (MOUNT_RECIPES).
 *
 * Background: mounts whose game id carries the `_ADC` suffix (ADventurer's
 * Challenge) are earned by reaching 600,000 Challenge Points in a monthly
 * Adventurer's Challenge — they are Premium-account rewards, not craftable.
 * In items.xml each one has an EMPTY <craftingrequirements silver="0" time="0"/>
 * with no <craftresource> children (contrast the Moose, T6_MOUNT_GIANTSTAG_MOOSE,
 * which has a real <craftresource>). They had previously been added to
 * MOUNT_RECIPES with a fabricated placeholder recipe (T3_FARM_OX_GROWN + 30
 * T3_PLANKS), producing bogus craft-profit rows.
 *
 * Known annual rotation rewards (verified against the Albion wiki, 2026-06-01):
 *   T6_MOUNT_FROSTRAM_ADC       Frost Ram          — January Frost Challenge
 *   T7_MOUNT_HUSKY_ADC          Snow Husky         — December Yuletide Challenge
 *   T7_MOUNT_MONITORLIZARD_ADC  Pest Lizard        — November Challenge
 *   T7_MOUNT_TERRORBIRD_ADC     Saddled Terrorbird — February Challenge
 *   UNIQUE_MOUNT_BEAR_KEEPER_ADC Keeper Bear       — challenge reward
 *
 * Black-box: compile js/data-mounts.js, inspect the exported MOUNT_RECIPES.
 *
 * Run: node tests/mount-adc-not-craftable.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

// data-mounts.js is a browser-global script of pure const declarations with no
// external references at eval time, so it compiles standalone.
const src = fs.readFileSync(path.join(__dirname, "..", "js", "data-mounts.js"), "utf8");
const mod = new Module("data-mounts");
mod._compile(src + "\nmodule.exports = { MOUNT_RECIPES, BREEDING_ITEMS };", "data-mounts.js");
const { MOUNT_RECIPES } = mod.exports;

const recipeIds = new Set(MOUNT_RECIPES.map((r) => r.id));

// Known Adventurer's Challenge reward mounts — none may be craftable.
const ADC_REWARD_MOUNTS = [
  "T6_MOUNT_FROSTRAM_ADC",
  "T7_MOUNT_HUSKY_ADC",
  "T7_MOUNT_MONITORLIZARD_ADC",
  "T7_MOUNT_TERRORBIRD_ADC",
  "UNIQUE_MOUNT_BEAR_KEEPER_ADC",
];

// Mounts that ARE legitimately craftable and must survive — guards against
// over-deletion (esp. the Moose, which sat interleaved among the ADC entries
// but has a real grown-animal recipe).
const CRAFTABLE_MUST_EXIST = [
  "T6_MOUNT_GIANTSTAG_MOOSE", // Moose — bred from T6_FARM_GIANTSTAG_MOOSE_GROWN
  "T3_MOUNT_HORSE",
  "T8_MOUNT_OX",
];

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("\n=== Adventurer's Challenge mounts are not craftable ===");

ADC_REWARD_MOUNTS.forEach((id) => {
  test(`${id} must NOT be in MOUNT_RECIPES`, () => {
    assert.ok(!recipeIds.has(id), `${id} is an Adventurer's Challenge reward — it has no craft recipe`);
  });
});

test("no MOUNT_RECIPES id carries the _ADC (Adventurer's Challenge) suffix", () => {
  const offenders = [...recipeIds].filter((id) => id.includes("_ADC"));
  assert.deepStrictEqual(offenders, [], `unexpected challenge-reward mounts in catalog: ${offenders.join(", ")}`);
});

CRAFTABLE_MUST_EXIST.forEach((id) => {
  test(`${id} remains a craftable mount`, () => {
    assert.ok(recipeIds.has(id), `${id} should still be present in MOUNT_RECIPES`);
  });
});

test("no surviving recipe uses the fabricated ADC placeholder (ox+30 planks for a non-ox mount)", () => {
  // The ADC entries all shared the identical bogus recipe T3_FARM_OX_GROWN + 30
  // T3_PLANKS. A genuine T3 transport ox legitimately uses that recipe, so only
  // flag NON-ox mounts that carry it.
  const bogus = MOUNT_RECIPES.filter((r) => {
    if (/_MOUNT_OX(\b|_)/.test(r.id) || r.id === "T3_MOUNT_OX") return false;
    const mats = r.materials || [];
    const hasOx = mats.some((m) => m.matId === "T3_FARM_OX_GROWN" && m.count === 1);
    const hasPlanks = mats.some((m) => m.matId === "T3_PLANKS" && m.count === 30);
    return hasOx && hasPlanks;
  });
  assert.deepStrictEqual(bogus.map((r) => r.id), [], `non-ox mounts still using the placeholder recipe: ${bogus.map((r) => r.id).join(", ")}`);
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
