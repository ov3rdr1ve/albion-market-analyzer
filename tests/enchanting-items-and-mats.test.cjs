/**
 * Test: Enchanting table coverage + enchant material counts.
 *
 * Rules (Albion wiki "Enchanting"):
 *   - Every equipment piece T4-T8 is enchantable (.0→.1→.2→.3); .3→.4 is NOT.
 *   - Rune/soul/relic count depends on the SLOT, not on the craft recipe:
 *       two-handed weapons / tools ... 384
 *       one-handed (MAIN) weapons ... 288
 *       armor, bags ................. 192
 *       helmets, boots, capes, off-hands ... 96
 *   - Mounts cannot be enchanted; artifact materials are not equipment.
 *
 * Run: node tests/enchanting-items-and-mats.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const CRAFTING_ITEMS = [
  // equipment (enchantable)
  { id: "T4_2H_FIRESTAFF", name: "Great Fire Staff [T4]", materials: [{ matId: "T4_PLANKS", count: 20 }, { matId: "T4_CLOTH", count: 12 }], isGearRecipe: true },
  { id: "T5_MAIN_SWORD", name: "Broadsword [T5]", materials: [{ matId: "T5_METALBAR", count: 16 }, { matId: "T5_LEATHER", count: 8 }], isGearRecipe: true },
  { id: "T6_ARMOR_CLOTH_SET1", name: "Scholar Robe [T6]", materials: [{ matId: "T6_CLOTH", count: 16 }], isGearRecipe: true },
  { id: "T7_HEAD_PLATE_SET1", name: "Soldier Helmet [T7]", materials: [{ matId: "T7_METALBAR", count: 8 }], isGearRecipe: true },
  { id: "T8_SHOES_LEATHER_SET1", name: "Mercenary Shoes [T8]", materials: [{ matId: "T8_LEATHER", count: 8 }], isGearRecipe: true },
  { id: "T4_CAPE", name: "Cape [T4]", materials: [{ matId: "T4_CLOTH", count: 2 }], isGearRecipe: true },
  { id: "T6_CAPEITEM_FW_MARTLOCK", name: "Martlock Cape [T6]", materials: [{ matId: "T6_CAPE", count: 1 }], isGearRecipe: true },
  { id: "T5_OFF_SHIELD", name: "Shield [T5]", materials: [{ matId: "T5_METALBAR", count: 8 }], isGearRecipe: true },
  { id: "T6_BAG", name: "Bag [T6]", materials: [{ matId: "T6_LEATHER", count: 8 }], isGearRecipe: true },
  { id: "T7_BACKPACK_GATHERER_FIBER", name: "Harvester Backpack [T7]", materials: [{ matId: "T7_LEATHER", count: 8 }], isGearRecipe: true },
  { id: "T5_2H_TOOL_PICK", name: "Pickaxe [T5]", materials: [{ matId: "T5_METALBAR", count: 16 }], isGearRecipe: true },
  { id: "T6_ARMOR_GATHERER_ORE_SET1", name: "Miner Garb [T6]", materials: [{ matId: "T6_CLOTH", count: 16 }], isGearRecipe: true },
  { id: "T8_2H_ARCANESTAFF_HELL", name: "Occult Staff [T8]", materials: [{ matId: "T8_PLANKS", count: 16 }, { matId: "T8_ARTEFACT_2H_ARCANESTAFF_HELL", count: 1 }], isGearRecipe: true },

  // NOT enchantable
  { id: "T3_MAIN_SWORD", name: "Sword [T3]", materials: [{ matId: "T3_METALBAR", count: 16 }], isGearRecipe: true },
  { id: "T5_ARTEFACT_2H_SHAPESHIFTER_CRYSTAL", name: "Shapeshifter Artifact [T5]", materials: [{ matId: "T5_CRYSTALFRAGMENT", count: 1 }], isGearRecipe: true },
  { id: "T8_MOUNT_HORSE", name: "Horse [T8]", materials: [{ matId: "T8_LEATHER", count: 16 }] },
  { id: "T6_MEAL_SOUP", name: "Soup [T6]", materials: [{ matId: "T6_CARROT", count: 4 }], isGearRecipe: true },
  { id: "T6_ARMOR_CLOTH_SET1@2", name: "Scholar Robe [T6.2]", materials: [{ matId: "T6_CLOTH_LEVEL2@2", count: 16 }], isGearRecipe: true },
];

const ctx = {
  console,
  CRAFTING_ITEMS,
  getTierFromId(id) {
    const m = id.match(/^T(\d)/);
    return m ? parseInt(m[1], 10) : 0;
  },
};
vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "..", "js", "data-enchanting.js"), "utf8"),
  ctx,
  { filename: "data-enchanting.js" },
);
const { getEnchantableItems, getEnchantMatCount, getEnchantedItemId, getEnchantMatId, getAllEnchantItemIds } = ctx;
const ENCHANT_TRANSITIONS = vm.runInContext("ENCHANT_TRANSITIONS", ctx);

const byId = (id) => CRAFTING_ITEMS.find((i) => i.id === id);
let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log("  PASS", name);
  } catch (e) {
    failures++;
    console.log("  FAIL", name, "-", e.message);
  }
}

// ── material counts per slot ──
const MAT_CASES = [
  ["T4_2H_FIRESTAFF", 384],
  ["T8_2H_ARCANESTAFF_HELL", 384], // artifact weapon: still a 2H
  ["T5_2H_TOOL_PICK", 384],
  ["T5_MAIN_SWORD", 288],
  ["T6_ARMOR_CLOTH_SET1", 192],
  ["T6_ARMOR_GATHERER_ORE_SET1", 192],
  ["T6_BAG", 192],
  ["T7_BACKPACK_GATHERER_FIBER", 192],
  ["T7_HEAD_PLATE_SET1", 96],
  ["T8_SHOES_LEATHER_SET1", 96],
  ["T4_CAPE", 96],
  ["T6_CAPEITEM_FW_MARTLOCK", 96],
  ["T5_OFF_SHIELD", 96],
];
MAT_CASES.forEach(([id, expected]) => {
  check(`mat count ${id} = ${expected}`, () => {
    assert.strictEqual(getEnchantMatCount(byId(id)), expected);
  });
});

// ── item coverage ──
const items = getEnchantableItems();
const ids = items.map((i) => i.id);

const INCLUDED = [
  "T4_2H_FIRESTAFF",
  "T5_MAIN_SWORD",
  "T5_OFF_SHIELD",
  "T4_CAPE",
  "T6_BAG",
  "T5_2H_TOOL_PICK",
  "T6_CAPEITEM_FW_MARTLOCK",
  "T8_2H_ARCANESTAFF_HELL",
];
INCLUDED.forEach((id) => {
  check(`includes ${id}`, () => assert.ok(ids.includes(id), `${id} missing`));
});

const EXCLUDED = [
  ["T3_MAIN_SWORD", "below T4"],
  ["T5_ARTEFACT_2H_SHAPESHIFTER_CRYSTAL", "artifact material, not equipment"],
  ["T8_MOUNT_HORSE", "mounts cannot be enchanted"],
  ["T6_MEAL_SOUP", "food uses fish sauces, not runes"],
  ["T6_ARMOR_CLOTH_SET1@2", "already enchanted"],
];
EXCLUDED.forEach(([id, why]) => {
  check(`excludes ${id} (${why})`, () => assert.ok(!ids.includes(id), `${id} present`));
});

// ── transitions: .0→.1→.2→.3 only, no .4 ──
check("three transitions, rune/soul/relic, no .4", () => {
  assert.deepStrictEqual(
    [...ENCHANT_TRANSITIONS].map((t) => `${t.from}${t.to}${t.matType}`),
    ["01RUNE", "12SOUL", "23RELIC"],
  );
});

check("enchanted id + mat id helpers", () => {
  assert.strictEqual(getEnchantedItemId("T5_MAIN_SWORD", 2), "T5_MAIN_SWORD@2");
  assert.strictEqual(getEnchantedItemId("T5_MAIN_SWORD@2", 0), "T5_MAIN_SWORD");
  assert.strictEqual(getEnchantMatId(6, "SOUL"), "T6_SOUL");
});

check("scan ids cover base + @1..@3 + T4-T8 mats", () => {
  const all = new Set(getAllEnchantItemIds());
  ["T4_2H_FIRESTAFF", "T4_2H_FIRESTAFF@1", "T4_2H_FIRESTAFF@2", "T4_2H_FIRESTAFF@3"].forEach((id) =>
    assert.ok(all.has(id), `${id} not scanned`),
  );
  assert.ok(!all.has("T4_2H_FIRESTAFF@4"), "@4 must not be scanned — not enchantable");
  assert.ok(!all.has("T3_MAIN_SWORD"), "T3 gear must not be scanned");
  for (let t = 4; t <= 8; t++) {
    ["RUNE", "SOUL", "RELIC"].forEach((m) => assert.ok(all.has(`T${t}_${m}`), `T${t}_${m} not scanned`));
  }
});

console.log(failures === 0 ? "\nAll enchanting tests passed" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
