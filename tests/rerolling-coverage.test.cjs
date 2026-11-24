/**
 * Test: quality-rerolling item coverage.
 *
 * Same two coverage bugs the enchanting table had (enchanting-items-and-mats):
 *   - the catalog was filtered to tier >= 6, so T4/T5 gear never appeared;
 *   - `isGearRecipe` alone let the artifact-MATERIAL crafts (T*_ARTEFACT_*) in.
 *     Artifact materials have no quality, so those rows can never price — they
 *     only bloat the table and the quality-price scan.
 *
 * Quality applies to every equipment piece T4-T8 — and to mounts: a mount's
 * item value is billed against the reroll like any other equipment, so mounts
 * from MOUNT_RECIPES (already merged into CRAFTING_ITEMS) enter the table too.
 * Excluded on purpose: T3 (below the tier floor) and the handful of mounts
 * items.xml marks maxqualitylevel=1 (siege engines, battle swampdragons,
 * drake, battle mammoth — they have no quality, so they can never price).
 *
 * Run: node tests/rerolling-coverage.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const CRAFTING_ITEMS = [
  // equipment — rerollable
  { id: "T4_2H_BOW_KEEPER", name: "Bow of Badon [T4]", isGearRecipe: true },
  { id: "T5_MAIN_SWORD", name: "Broadsword [T5]", isGearRecipe: true },
  { id: "T6_ARMOR_CLOTH_SET1", name: "Scholar Robe [T6]", isGearRecipe: true },
  { id: "T7_HEAD_PLATE_SET1", name: "Soldier Helmet [T7]", isGearRecipe: true },
  { id: "T8_SHOES_LEATHER_SET1", name: "Mercenary Shoes [T8]", isGearRecipe: true },
  { id: "T4_CAPE", name: "Cape [T4]", isGearRecipe: true },
  { id: "T6_BAG", name: "Bag [T6]", isGearRecipe: true },
  { id: "T5_OFF_SHIELD", name: "Shield [T5]", isGearRecipe: true },
  { id: "T5_2H_TOOL_PICK", name: "Pickaxe [T5]", isGearRecipe: true },

  // mounts — rerollable (MOUNT_RECIPES entries enter CRAFTING_ITEMS without
  // an isGearRecipe flag, so the filter must recognise them by their _MOUNT_ id)
  { id: "T8_MOUNT_HORSE", name: "Horse [T8]" },
  { id: "T5_MOUNT_ARMORED_HORSE", name: "Armored Horse [T5]" },
  // native .1 mount: the @1 id is the item itself, not an enchant variant
  { id: "T5_MOUNT_COUGAR_KEEPER@1", name: "Swiftclaw [T5.1]" },

  // not rerollable
  { id: "T3_MAIN_SWORD", name: "Sword [T3]", isGearRecipe: true },
  { id: "T5_ARTEFACT_2H_SHAPESHIFTER_CRYSTAL", name: "Shapeshifter Artifact [T5]", isGearRecipe: true },
  { id: "T3_MOUNT_HORSE", name: "Riding Horse [T3]" },
  { id: "T8_MOUNT_MAMMOTH_BATTLE@1", name: "Command Mammoth [T8.1]" },
  { id: "T6_MOUNT_SIEGE_BALLISTA", name: "Siege Ballista [T6]" },
  { id: "T6_MEAL_SOUP", name: "Soup [T6]", isGearRecipe: true },
  { id: "T6_ARMOR_CLOTH_SET1@2", name: "Scholar Robe [T6.2]", isGearRecipe: true },
];

const ctx = {
  console,
  CRAFTING_ITEMS,
  MOUNT_RECIPES: [{ id: "T5_MOUNT_COUGAR_KEEPER@1" }, { id: "T8_MOUNT_MAMMOTH_BATTLE@1" }],
  getTierFromId(id) {
    const m = id.match(/^T(\d)/);
    return m ? parseInt(m[1], 10) : 0;
  },
};
vm.createContext(ctx);
const load = (f) =>
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8"), ctx, { filename: f });
load("data-enchanting.js"); // getEquipmentSlot lives here; data-rerolling reuses it
load("data-rerolling.js");
const { getRerollableItems, getQualityItemIds, getEquipmentSlot } = ctx;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Rerolling coverage tests\n");

const ids = getRerollableItems().map((i) => i.id);

[
  ["T4_2H_BOW_KEEPER", "T4 gear — the reported Bow of Badon case"],
  ["T5_MAIN_SWORD", "T5 gear"],
  ["T6_ARMOR_CLOTH_SET1", "T6 gear"],
  ["T8_SHOES_LEATHER_SET1", "T8 gear"],
  ["T4_CAPE", "capes have quality"],
  ["T6_BAG", "bags have quality"],
  ["T5_OFF_SHIELD", "off-hands have quality"],
  ["T5_2H_TOOL_PICK", "gathering tools have quality"],
  ["T8_MOUNT_HORSE", "mounts reroll quality like any other equipment"],
  ["T5_MOUNT_ARMORED_HORSE", "armored mounts reroll quality too"],
  ["T5_MOUNT_COUGAR_KEEPER@1", "Swiftclaw is natively .1 and still has quality"],
].forEach(([id, why]) => {
  test(`includes ${id} (${why})`, () => assert.ok(ids.includes(id), `${id} missing`));
});

[
  ["T3_MAIN_SWORD", "below T4"],
  ["T5_ARTEFACT_2H_SHAPESHIFTER_CRYSTAL", "artifact material has no quality"],
  ["T3_MOUNT_HORSE", "below the T4 tier floor"],
  ["T8_MOUNT_MAMMOTH_BATTLE@1", "no quality per items.xml (maxqualitylevel=1)"],
  ["T6_MOUNT_SIEGE_BALLISTA", "no quality per items.xml (maxqualitylevel=1)"],
  ["T6_MEAL_SOUP", "consumables have no quality"],
  ["T6_ARMOR_CLOTH_SET1@2", "enchant variant is priced under its base id"],
].forEach(([id, why]) => {
  test(`excludes ${id} (${why})`, () => assert.ok(!ids.includes(id), `${id} present`));
});

["T8_MOUNT_HORSE", "T5_MOUNT_ARMORED_HORSE"].forEach((id) => {
  test(`quality price scan includes mount ${id}`, () =>
    assert.ok(getQualityItemIds().includes(id), `${id} missing from the quality scan`));
});

test("mounts still map to no equipment slot (no leak into the enchanting table)", () => {
  assert.strictEqual(getEquipmentSlot("T8_MOUNT_HORSE"), null);
});

test("quality scan ids match the rerollable catalog", () => {
  assert.deepStrictEqual([...getQualityItemIds()].sort(), [...ids].sort());
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
