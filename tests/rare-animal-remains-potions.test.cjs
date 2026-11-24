/**
 * Test: Rare-animal-remains potions (Calming / Cleansing / Acid / Berserk /
 * Gathering / Hellfire / Tornado in a Bottle) in the Consumables table.
 *
 * These 7 potion families each consume one tracked-creature's rare remains
 * (Shadow Claws, Sylvian Root, Spirit Paws, Werewolf Fangs, Runestone Tooth,
 * Imp's Horn, Dawnfeather). Black-box: drives the real catalog/recipe/focus/
 * sauce/name data + the variant generator — no live API or DB.
 *
 * Authoritative values verified against the live ao-bin-dumps items.xml
 * (2026-06-05). Recipe counts are the per-craft-action <craftresource> values
 * verbatim (same convention as js/recipes.js). The rare remain has
 * maxreturnamount=0 in-game, so it must carry noReturn:true (no RRR refund).
 *
 * Run: node tests/rare-animal-remains-potions.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

function load(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

// ── Family / tier model (single source of truth for the parameterized cases) ──
// remain tier = the odd tier at/just below the potion tier:
//   T3/T5/T7 potions use the same-tier remain; T4/T6/T8 use T3/T5/T7.
const FAMILIES = [
  { stem: "POTION_MOB_RESET", creature: "PANTHER",   tiers: [3, 5, 7], word: "Calming" },
  { stem: "POTION_CLEANSE2",  creature: "ENT",       tiers: [3, 5, 7], word: "Cleansing" },
  { stem: "POTION_ACID",      creature: "DIREBEAR",  tiers: [3, 5, 7], word: "Acid" },
  { stem: "POTION_BERSERK",   creature: "WEREWOLF",  tiers: [4, 6, 8], word: "Berserk" },
  { stem: "POTION_GATHER",    creature: "ELEMENTAL", tiers: [4, 6, 8], word: "Gathering" },
  { stem: "POTION_LAVA",      creature: "IMP",       tiers: [4, 6, 8], word: "Hellfire" },
  { stem: "POTION_TORNADO",   creature: "EAGLE",     tiers: [4, 6, 8], word: "Tornado" },
];

const remainTier = (t) => (t % 2 === 1 ? t : t - 1);
const potionId = (stem, t) => `T${t}_${stem}`;
const remainId = (creature, t) => `T${remainTier(t)}_ALCHEMY_RARE_${creature}`;

// Every (family, tier) pair → 21 potions.
const CASES = FAMILIES.flatMap((f) =>
  f.tiers.map((t) => ({
    id: potionId(f.stem, t),
    tier: t,
    word: f.word,
    remain: remainId(f.creature, t),
  }))
);

// Spot-check focus values (base craft, 0 spec) straight from the dump.
const EXPECTED_BASE_FOCUS = {
  T3_POTION_MOB_RESET: 56, T5_POTION_MOB_RESET: 294, T7_POTION_MOB_RESET: 1272,
  T3_POTION_CLEANSE2: 56,  T5_POTION_CLEANSE2: 298,  T7_POTION_CLEANSE2: 1283,
  T3_POTION_ACID: 56,      T5_POTION_ACID: 294,      T7_POTION_ACID: 1296,
  T4_POTION_BERSERK: 56,   T6_POTION_BERSERK: 298,   T8_POTION_BERSERK: 1307,
  T4_POTION_GATHER: 61,    T6_POTION_GATHER: 310,    T8_POTION_GATHER: 1319,
  T4_POTION_LAVA: 56,      T6_POTION_LAVA: 294,      T8_POTION_LAVA: 1272,
  T4_POTION_TORNADO: 56,   T6_POTION_TORNADO: 294,   T8_POTION_TORNADO: 1296,
};

const EXTRACT_IDS = [
  "T1_ALCHEMY_EXTRACT_LEVEL1",
  "T1_ALCHEMY_EXTRACT_LEVEL2",
  "T1_ALCHEMY_EXTRACT_LEVEL3",
];

// ── Compile the real browser modules together (mirrors the existing
//    consumable-enchant-variants test harness). ──
const stubs = `
function getTierFromId(id) {
  const m = id.match(/^T(\\d)/);
  return m ? parseInt(m[1], 10) : 0;
}
`;
const sources =
  stubs +
  load("js/data-consumables.js") +
  load("js/recipes.js") +
  load("js/recipes-rare-potions.js") +
  load("js/data-enchant-sauces.js") +
  load("js/item-names.js");

const renderSrc = (load("js/render-consumables.js") + load("js/render-consumables-row.js"));
const helperBlock = renderSrc.slice(0, renderSrc.indexOf("function renderConsumableTable"))
  + load("js/consumable-enchant-variants.js"); // extracted generator module

const mod = new Module("rare-potions-test");
mod._compile(
  sources + helperBlock +
    "\nmodule.exports = { generateConsumableEnchantVariants, consumableBaseHasEnchantVariants, CONSUMABLES, BUNDLED_RECIPES, ENCHANT_UPGRADE_SAUCE, ITEM_NAMES_MAP };",
  "rare-potions-test.js"
);
const {
  generateConsumableEnchantVariants,
  consumableBaseHasEnchantVariants,
  CONSUMABLES,
  BUNDLED_RECIPES,
  ENCHANT_UPGRADE_SAUCE,
  ITEM_NAMES_MAP,
} = mod.exports;

// focus-costs.json is the generated artifact the tests read (per repo convention).
const FOCUS_COSTS = require("../js/focus-costs.json");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("\n=== Catalog: all 21 potions present in CONSUMABLES ===");
const catalogIds = new Set(CONSUMABLES.map((c) => c.id));
for (const c of CASES) {
  test(`${c.id} is in CONSUMABLES`, () => {
    assert.ok(catalogIds.has(c.id), `${c.id} missing from CONSUMABLES`);
  });
}

console.log("\n=== Recipe: rare remain present, noReturn, count 1, sole no-return mat ===");
for (const c of CASES) {
  test(`${c.id} recipe consumes ${c.remain} (noReturn)`, () => {
    const rec = BUNDLED_RECIPES[c.id];
    assert.ok(Array.isArray(rec), `${c.id} has no BUNDLED_RECIPES entry`);
    assert.ok(rec.length >= 2, `${c.id} recipe too small`);
    const remainEntry = rec.find((m) => m.matId === c.remain);
    assert.ok(remainEntry, `${c.id} should consume ${c.remain}`);
    assert.strictEqual(remainEntry.count, 1, `${c.remain} count should be 1`);
    assert.strictEqual(remainEntry.noReturn, true, `${c.remain} must be noReturn`);
    const noReturnMats = rec.filter((m) => m.noReturn);
    assert.strictEqual(noReturnMats.length, 1,
      `only the rare remain may be noReturn (got ${noReturnMats.map((m) => m.matId)})`);
  });
}

console.log("\n=== Focus: base + @1/@2/@3 present in focus-costs.json ===");
for (const c of CASES) {
  test(`${c.id} base focus = ${EXPECTED_BASE_FOCUS[c.id]}`, () => {
    assert.strictEqual(FOCUS_COSTS[c.id], EXPECTED_BASE_FOCUS[c.id],
      `${c.id} focus mismatch (got ${FOCUS_COSTS[c.id]})`);
    for (const lvl of [1, 2, 3]) {
      assert.ok(FOCUS_COSTS[`${c.id}@${lvl}`] > 0,
        `${c.id}@${lvl} focus missing`);
    }
  });
}

console.log("\n=== Enchant sauce: 3 Arcane-Extract levels per potion ===");
for (const c of CASES) {
  test(`${c.id} upgrades with T1_ALCHEMY_EXTRACT L1/L2/L3`, () => {
    const ups = ENCHANT_UPGRADE_SAUCE[c.id];
    assert.ok(Array.isArray(ups), `${c.id} missing from ENCHANT_UPGRADE_SAUCE`);
    assert.deepStrictEqual(ups.map((u) => u.level).sort(), [1, 2, 3]);
    for (const u of ups) {
      assert.strictEqual(u.sauceMatId, `T1_ALCHEMY_EXTRACT_LEVEL${u.level}`,
        `${c.id} level ${u.level} should use the matching Arcane Extract`);
      assert.ok(u.count > 0, `${c.id} level ${u.level} count must be > 0`);
    }
  });
}

console.log("\n=== Display names: potions + Arcane Extracts are humanized ===");
for (const c of CASES) {
  test(`${c.id} name contains "${c.word}"`, () => {
    const name = ITEM_NAMES_MAP[c.id];
    assert.ok(name && typeof name === "string", `${c.id} has no display name`);
    assert.ok(!name.includes("_"), `${c.id} name leaks a raw id: ${name}`);
    assert.ok(name.includes(c.word), `${c.id} name "${name}" should mention ${c.word}`);
  });
}
test("Arcane Extract ids are named (Basic/Refined/Pure)", () => {
  const expect = ["Basic", "Refined", "Pure"];
  EXTRACT_IDS.forEach((id, i) => {
    const name = ITEM_NAMES_MAP[id];
    assert.ok(name, `${id} missing display name`);
    assert.ok(name.includes(expect[i]) && /Arcane Extract/i.test(name),
      `${id} name "${name}" unexpected`);
  });
});

console.log("\n=== Enchant variants: T3 potions also expand (tier<3 guard) ===");
const variantIds = new Set(
  generateConsumableEnchantVariants(CONSUMABLES).map((c) => c.id)
);
for (const id of ["T3_POTION_MOB_RESET", "T3_POTION_CLEANSE2", "T3_POTION_ACID",
                   "T8_POTION_GATHER", "T4_POTION_BERSERK"]) {
  test(`${id} spawns .1 / .2 / .3 variants`, () => {
    for (const lvl of [1, 2, 3]) {
      assert.ok(variantIds.has(`${id}@${lvl}`), `${id}@${lvl} not generated`);
    }
  });
}

console.log("\n=== Expand caret predicate (tier-agnostic, keyed on sauce map) ===");
test("T3 rare potions are expandable (variants exist from T3)", () => {
  for (const id of ["T3_POTION_MOB_RESET", "T3_POTION_CLEANSE2", "T3_POTION_ACID"]) {
    assert.strictEqual(consumableBaseHasEnchantVariants(id), true, `${id} should be expandable`);
  }
});
test("T2/T3 potions are expandable too — the dump gives them .1/.2/.3", () => {
  // Low-tier potions used to be base-only. The 2026 dump gives every potion an
  // <enchantments> block upgrading with Arcane Extract, T2 upward.
  for (const id of ["T3_POTION_STONESKIN", "T3_POTION_SLOWFIELD", "T3_POTION_REVIVE"]) {
    assert.strictEqual(consumableBaseHasEnchantVariants(id), true, `${id} should be expandable`);
  }
});
test("T4+ rare potions and classic meals stay expandable", () => {
  for (const id of ["T8_POTION_GATHER", "T4_POTION_BERSERK", "T4_MEAL_STEW", "T8_MEAL_SANDWICH_FISH"]) {
    assert.strictEqual(consumableBaseHasEnchantVariants(id), true, `${id} should be expandable`);
  }
});
test("raw flips and @-variant ids are not expandable", () => {
  assert.strictEqual(consumableBaseHasEnchantVariants("T8_MEAT"), false);
  assert.strictEqual(consumableBaseHasEnchantVariants("T3_POTION_MOB_RESET@1"), false);
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
