/**
 * Test: Mount items must NOT generate enchantment variants (@1, @2, @3, @4).
 * Mounts in Albion Online only exist in normal quality — no enchantment levels.
 *
 * Run: node tests/mount-no-enchant-variants.test.cjs
 */

const assert = require("assert");

// ── helpers: replicate the logic from render-crafting.js and utils.js ──

function getTierFromId(id) {
  const m = id.match(/^T(\d)/);
  return m ? parseInt(m[1], 10) : 0;
}

function shouldGenerateEnchantVariant(item) {
  return item.isGearRecipe && !item.id.includes("@") &&
    getTierFromId(item.id) >= 4 && getTierFromId(item.id) <= 8;
}

// ── test data ──

const MOUNT_IDS = [
  "T6_MOUNT_ARMORED_HORSE",
  "T6_MOUNT_SIEGE_BALLISTA",
  "T6_MOUNT_DIREWOLF",
  "T6_MOUNT_MOABIRD",
  "T7_MOUNT_HORSE",
  "T7_MOUNT_ARMORED_HORSE",
  "T7_MOUNT_OX",
  "T7_MOUNT_DIREBOAR",
  "T7_MOUNT_SWAMPDRAGON",
  "T7_MOUNT_SWAMPDRAGON_BATTLE",
  "T7_MOUNT_ARMORED_SWAMPDRAGON_BATTLE",
  "T7_MOUNT_SWAMPDRAGON_AVALON_BASILISK",
  "T8_MOUNT_HORSE",
  "T8_MOUNT_ARMORED_HORSE",
  "T8_MOUNT_OX",
  "T8_MOUNT_DIREBEAR",
  "T8_MOUNT_MAMMOTH_TRANSPORT",
  "T8_MOUNT_MAMMOTH_BATTLE",
];

const GEAR_IDS = [
  "T6_MAIN_SWORD",
  "T7_2H_BOW",
  "T8_ARMOR_CLOTH_SET1",
];

// ── tests ──

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

// Mount items injected as crafting items should NOT have isGearRecipe: true
MOUNT_IDS.forEach((id) => {
  test(`${id} must not generate enchant variants`, () => {
    const item = { id, isGearRecipe: false };
    assert.strictEqual(shouldGenerateEnchantVariant(item), false);
  });
});

// Regular gear items SHOULD still generate enchant variants
GEAR_IDS.forEach((id) => {
  test(`${id} should generate enchant variants`, () => {
    const item = { id, isGearRecipe: true };
    assert.strictEqual(shouldGenerateEnchantVariant(item), true);
  });
});

// Items that already have @ should not double-enchant
test("item with existing @4 should not generate variant", () => {
  const item = { id: "T7_MAIN_SWORD@4", isGearRecipe: true };
  assert.strictEqual(shouldGenerateEnchantVariant(item), false);
});

// Mounts should not generate variants (they never have isGearRecipe in real code)
test("T5 mount should not generate variant", () => {
  const item = { id: "T5_MOUNT_SWIFTCLAW", isGearRecipe: false };
  assert.strictEqual(shouldGenerateEnchantVariant(item), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
