/**
 * Test: human-readable resolution of special item ids via getItemDisplayName.
 *
 * Covers the bug where mount/cape recipe ingredients leaked raw game slugs
 * (e.g. "QUESTITEM_TOKEN_MISTS") into the UI because ITEM_NAMES_MAP had no
 * entry for them. Also guards the ITEM_NAMES_MAP extraction into
 * js/item-names.js and the removal of the fictional T6_MOUNT_MOABIRD recipe.
 *
 * Black-box: feed an item id to getItemDisplayName, assert the output name.
 *
 * Run: node tests/item-names.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");


// utils.js localizes through tx(english, slug); identity keeps names English.
const sandbox = {
  window: {},
  document: { getElementById: () => null },
  console,
  tx: (en) => en,
};
vm.createContext(sandbox);
const scriptFiles = [
  "js/item-names.js",
  "js/resource-names.js",
  "js/data.js",
  "js/data-consumables.js",
  "js/data-mounts.js",
  "js/data-farming.js",
  "js/utils.js",
];
for (const s of scriptFiles) {
  const src = fs.readFileSync(path.join(__dirname, "..", s), "utf-8");
  try { vm.runInContext(src, sandbox); }
  catch (e) { console.error(`Error loading ${s}: ${e.message}`); process.exit(1); }
}
const getItemDisplayName = vm.runInContext("getItemDisplayName", sandbox);
const MOUNT_RECIPES = vm.runInContext("MOUNT_RECIPES", sandbox);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name}\n    ${e.message}`); }
}

// ── 1. The 9 previously-unreadable ids now resolve to their real EN-US name ──
const EXPECTED = {
  QUESTITEM_TOKEN_MISTS: "Faerie Fire",
  T5_FARM_OWL_FW_BRECILIEN_GROWN: "Tame Mystic Owl",
  T8_FARM_OWL_FW_BRECILIEN_GROWN: "Tame Elite Mystic Owl",
  T5_FARM_SPIDER_HELL_GROWN: "Tame Hellspinner",
  T8_FARM_SPIDER_HELL_GROWN: "Tame Soulspinner",
  T8_FARM_RABBIT_EASTER_GROWN_DARK: '"Tame" Caerleon Cottontail',
  T8_MOUNTUPGRADE_COUGAR_KEEPER: "Sacred Bone Marrow",
  T8_MOUNTUPGRADE_HORSE_MORGANA: "Infernal Horseshoes",
  T8_MOUNTUPGRADE_HORSE_CURSE: "Spectral Mask",
};
for (const [id, name] of Object.entries(EXPECTED)) {
  test(`${id} resolves to "${name}"`, () => {
    assert.strictEqual(getItemDisplayName(id), name);
  });
  test(`${id} does not leak its raw id`, () => {
    assert.notStrictEqual(getItemDisplayName(id), id);
  });
}

// ── 2. Regression: existing names survive the ITEM_NAMES_MAP extraction ──
const REGRESSION = {
  QUESTITEM_TOKEN_AVALON: "Avalonian Energy",
  UNIQUE_GVGTOKEN_GENERIC: "Siphoned Energy",
  T4_LEATHER: "T4 leather", // resources resolve to the generic short label (resource-names.js)
  T1_FACTION_CAERLEON_TOKEN_1: "Shadowheart",
};
for (const [id, name] of Object.entries(REGRESSION)) {
  test(`existing map entry ${id} still resolves to "${name}"`, () => {
    assert.strictEqual(getItemDisplayName(id), name);
  });
}

// ── 2b. Enchant variants ("@n") resolve to "<base name> [.n]" instead of
//       leaking the raw slug. The volume table keys off raw market ids and
//       calls getItemDisplayName directly, so every resolution branch
//       (map / CRAFTING_ITEMS / MOUNT_RECIPES) must handle the suffix. ──
const ENCHANT = {
  "T5_LEATHER@3": "T5.3 leather",                      // resource → generic short label (resource-names.js)
  "T4_HEAD_CLOTH_SET1@2": "Scholar Cowl [T4] [.2]",   // base via CRAFTING_ITEMS (same branch as gear)
  "T5_MOUNT_SPIDER_HELL@1": "Hellspinner [T5] [.1]",  // base via MOUNT_RECIPES
};
for (const [id, name] of Object.entries(ENCHANT)) {
  test(`enchant variant ${id} resolves to "${name}"`, () => {
    assert.strictEqual(getItemDisplayName(id), name);
  });
}
test("enchant variant with unknown base falls through to raw id (no fabricated name)", () => {
  assert.strictEqual(getItemDisplayName("ZZZ_FAKE_ITEM@2"), "ZZZ_FAKE_ITEM@2");
});
test("getItemCategory resolves enchant variants from their base id", () => {
  const getItemCategory = vm.runInContext("getItemCategory", sandbox);
  assert.strictEqual(getItemCategory("T4_HEAD_CLOTH_SET1@2"), "Gear");
});

// ── 3. Fictional Moabird recipe is gone (absent from official dump + items.xml) ──
test("MOUNT_RECIPES no longer contains fictional T6_MOUNT_MOABIRD", () => {
  assert.ok(!MOUNT_RECIPES.some((m) => m.id === "T6_MOUNT_MOABIRD"));
});
test("no mount recipe references fictional T6_FARM_MOABIRD_GROWN", () => {
  const refs = MOUNT_RECIPES.filter((m) =>
    (m.materials || []).some((mat) => mat.matId === "T6_FARM_MOABIRD_GROWN"));
  assert.strictEqual(refs.length, 0, `referenced by: ${refs.map((m) => m.id).join(", ")}`);
});

// ── 4. Invariant (the reported bug class): every mount-recipe ingredient
//      must render as a human name, never a raw UPPER_SNAKE game slug. ──
test("every MOUNT_RECIPES ingredient resolves to a human-readable name", () => {
  const unreadable = [];
  for (const m of MOUNT_RECIPES) {
    for (const mat of m.materials || []) {
      const nm = getItemDisplayName(mat.matId);
      // raw == resolver returned the id unchanged AND it looks like a slug
      if (nm === mat.matId && /^[A-Z0-9]+(_[A-Z0-9]+)+/.test(mat.matId)) {
        unreadable.push(`${mat.matId} (in ${m.id})`);
      }
    }
  }
  assert.strictEqual(unreadable.length, 0, `unreadable ingredients:\n    ${unreadable.join("\n    ")}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
