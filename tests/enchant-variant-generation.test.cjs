/**
 * Test: Enchanted gear variant generation (.1-.4) for T4-T8 items.
 * Verifies material transformation, artifact preservation, dedup, and tier filtering.
 *
 * Run: node tests/enchant-variant-generation.test.cjs
 */

const assert = require("assert");

// ── helpers: replicate the logic from render-crafting.js ──

function getTierFromId(id) {
  const m = id.match(/^T(\d)/);
  return m ? parseInt(m[1], 10) : 0;
}

function generateEnchantedVariants(items) {
  const result = [];
  const seenIds = new Set();

  items.forEach((item) => {
    if (seenIds.has(item.id)) return;
    seenIds.add(item.id);
    result.push(item);

    if (item.isGearRecipe && !item.id.includes("@")) {
      const tier = getTierFromId(item.id);
      if (tier >= 4 && tier <= 8) {
        for (let enchLevel = 1; enchLevel <= 4; enchLevel++) {
          const enchId = item.id + "@" + enchLevel;
          if (seenIds.has(enchId)) continue;
          seenIds.add(enchId);
          const baseMats = item.materials || [{ matId: item.matId, count: item.matCount }];
          const enchMats = baseMats.map(m => {
            if (/^T\d+_(LEATHER|CLOTH|METALBAR|PLANKS|STONEBLOCK)$/.test(m.matId))
              return { ...m, matId: m.matId + "_LEVEL" + enchLevel + "@" + enchLevel };
            if (/^T\d+_/.test(m.matId) &&
                !/ARTEFACT|_BP|TOKEN|_FACTION_|ALCHEMY_RARE|SKILLBOOK/.test(m.matId))
              return { ...m, matId: m.matId + "@" + enchLevel };
            return m;
          });
          result.push({ ...item, id: enchId, name: item.name + " [." + enchLevel + "]", materials: enchMats });
        }
      }
    }
  });

  return result;
}

// ── test runner ──

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} -- ${e.message}`);
    failed++;
  }
}

// ── test data ──

const T4_CULTIST_ROBE = {
  id: "T4_ARMOR_CLOTH_MORGANA",
  name: "Adept's Cultist Robe [T4]",
  materials: [
    { matId: "T4_CLOTH", count: 16 },
    { matId: "T4_ARTEFACT_ARMOR_CLOTH_MORGANA", count: 1 },
  ],
  craftType: "cloth_armor",
  isGearRecipe: true,
};

const T5_SCHOLAR_ROBE = {
  id: "T5_ARMOR_CLOTH_SET1",
  name: "Expert's Scholar Robe [T5]",
  materials: [{ matId: "T5_CLOTH", count: 16 }],
  craftType: "cloth_armor",
  isGearRecipe: true,
};

const T7_SWORD = {
  id: "T7_MAIN_SWORD",
  name: "Grandmaster's Broadsword [T7]",
  materials: [{ matId: "T7_METALBAR", count: 16 }],
  craftType: "sword",
  isGearRecipe: true,
};

const T3_ITEM = {
  id: "T3_HEAD_CLOTH_SET1",
  name: "Journeyman's Scholar Cowl [T3]",
  materials: [{ matId: "T3_CLOTH", count: 8 }],
  craftType: "cloth_helmet",
  isGearRecipe: true,
};

const T5_SATCHEL_INSIGHT = {
  id: "T5_BAG_INSIGHT",
  name: "Expert's Satchel of Insight [T5]",
  materials: [
    { matId: "T5_CLOTH", count: 8 },
    { matId: "T5_LEATHER", count: 8 },
    { matId: "T4_SKILLBOOK_STANDARD", count: 1 },
  ],
  craftType: "bag",
  isGearRecipe: true,
};

const FURNITURE = {
  id: "T4_FURNITUREITEM_TABLE",
  name: "Adept's Table",
  matId: "T4_PLANKS",
  matCount: 30,
  craftType: null,
};

// ── tests ──

// T4 artifact item generates .1-.4
test("T4 Cultist Robe generates 4 enchanted variants", () => {
  const result = generateEnchantedVariants([T4_CULTIST_ROBE]);
  assert.strictEqual(result.length, 5); // base + .1 + .2 + .3 + .4
  const ids = result.map(r => r.id);
  assert.ok(ids.includes("T4_ARMOR_CLOTH_MORGANA@1"));
  assert.ok(ids.includes("T4_ARMOR_CLOTH_MORGANA@2"));
  assert.ok(ids.includes("T4_ARMOR_CLOTH_MORGANA@3"));
  assert.ok(ids.includes("T4_ARMOR_CLOTH_MORGANA@4"));
});

// Artifact material unchanged in enchanted variants
[1, 2, 3, 4].forEach((level) => {
  test(`Cultist Robe .${level} keeps artifact material unchanged`, () => {
    const result = generateEnchantedVariants([T4_CULTIST_ROBE]);
    const variant = result.find(r => r.id === `T4_ARMOR_CLOTH_MORGANA@${level}`);
    const artifactMat = variant.materials.find(m => m.matId.includes("ARTEFACT"));
    assert.strictEqual(artifactMat.matId, "T4_ARTEFACT_ARMOR_CLOTH_MORGANA");
    assert.strictEqual(artifactMat.count, 1);
  });
});

// Cloth material transformed correctly per enchantment level
[1, 2, 3, 4].forEach((level) => {
  test(`Cultist Robe .${level} transforms cloth to LEVEL${level}@${level}`, () => {
    const result = generateEnchantedVariants([T4_CULTIST_ROBE]);
    const variant = result.find(r => r.id === `T4_ARMOR_CLOTH_MORGANA@${level}`);
    const clothMat = variant.materials.find(m => !m.matId.includes("ARTEFACT"));
    assert.strictEqual(clothMat.matId, `T4_CLOTH_LEVEL${level}@${level}`);
    assert.strictEqual(clothMat.count, 16);
  });
});

// T5 normal item generates .1-.4
test("T5 Scholar Robe generates 4 enchanted variants", () => {
  const result = generateEnchantedVariants([T5_SCHOLAR_ROBE]);
  assert.strictEqual(result.length, 5);
  const ids = result.map(r => r.id);
  assert.ok(ids.includes("T5_ARMOR_CLOTH_SET1@1"));
  assert.ok(ids.includes("T5_ARMOR_CLOTH_SET1@4"));
});

// T7 metalbar item transforms correctly
test("T7 Sword .2 transforms metalbar to LEVEL2@2", () => {
  const result = generateEnchantedVariants([T7_SWORD]);
  const variant = result.find(r => r.id === "T7_MAIN_SWORD@2");
  assert.strictEqual(variant.materials[0].matId, "T7_METALBAR_LEVEL2@2");
});

// T3 item should NOT generate variants
test("T3 item does not generate enchanted variants", () => {
  const result = generateEnchantedVariants([T3_ITEM]);
  assert.strictEqual(result.length, 1);
});

// Furniture (no isGearRecipe) should NOT generate variants
test("Furniture does not generate enchanted variants", () => {
  const result = generateEnchantedVariants([FURNITURE]);
  assert.strictEqual(result.length, 1);
});

// Items already containing @ should NOT double-enchant
test("Already enchanted item does not get double-enchanted", () => {
  const enchItem = { ...T7_SWORD, id: "T7_MAIN_SWORD@3", isGearRecipe: true };
  const result = generateEnchantedVariants([enchItem]);
  assert.strictEqual(result.length, 1);
});

// Dedup: hardcoded @1 is not overwritten
test("Hardcoded enchanted item prevents duplicate generation", () => {
  const hardcoded = {
    id: "T4_ARMOR_CLOTH_SET1@1",
    name: "Scholar Robe [T4.1]",
    matId: "T4_CLOTH_LEVEL1@1",
    matCount: 16,
    craftType: "cloth_armor",
  };
  const base = {
    id: "T4_ARMOR_CLOTH_SET1",
    name: "Scholar Robe [T4]",
    matId: "T4_CLOTH",
    matCount: 16,
    craftType: "cloth_armor",
    isGearRecipe: true,
  };
  // hardcoded comes first (as in real CRAFTING_ITEMS)
  const result = generateEnchantedVariants([hardcoded, base]);
  const at1Items = result.filter(r => r.id === "T4_ARMOR_CLOTH_SET1@1");
  assert.strictEqual(at1Items.length, 1);
  // The hardcoded version should be the one that survived
  assert.strictEqual(at1Items[0].name, "Scholar Robe [T4.1]");
  // .2, .3, .4 should still be auto-generated
  assert.ok(result.find(r => r.id === "T4_ARMOR_CLOTH_SET1@2"));
  assert.ok(result.find(r => r.id === "T4_ARMOR_CLOTH_SET1@3"));
  assert.ok(result.find(r => r.id === "T4_ARMOR_CLOTH_SET1@4"));
});

// Name suffix format
test("Enchanted variant name has correct suffix", () => {
  const result = generateEnchantedVariants([T4_CULTIST_ROBE]);
  const v1 = result.find(r => r.id === "T4_ARMOR_CLOTH_MORGANA@1");
  assert.strictEqual(v1.name, "Adept's Cultist Robe [T4] [.1]");
  const v4 = result.find(r => r.id === "T4_ARMOR_CLOTH_MORGANA@4");
  assert.strictEqual(v4.name, "Adept's Cultist Robe [T4] [.4]");
});

// Skillbook/Tome material is NOT enchanted (tomes have no .1-.4 versions)
[1, 2, 3, 4].forEach((level) => {
  test(`Satchel of Insight .${level} keeps the Tome (SKILLBOOK) unenchanted`, () => {
    const result = generateEnchantedVariants([T5_SATCHEL_INSIGHT]);
    const variant = result.find(r => r.id === `T5_BAG_INSIGHT@${level}`);
    const tome = variant.materials.find(m => m.matId.includes("SKILLBOOK"));
    assert.strictEqual(tome.matId, "T4_SKILLBOOK_STANDARD");
    assert.strictEqual(tome.count, 1);
    // cloth & leather still carry the enchant
    const cloth = variant.materials.find(m => m.matId.startsWith("T5_CLOTH"));
    const leather = variant.materials.find(m => m.matId.startsWith("T5_LEATHER"));
    assert.strictEqual(cloth.matId, `T5_CLOTH_LEVEL${level}@${level}`);
    assert.strictEqual(leather.matId, `T5_LEATHER_LEVEL${level}@${level}`);
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
