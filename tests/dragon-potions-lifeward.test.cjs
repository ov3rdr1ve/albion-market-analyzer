/**
 * Test: the Lifeward Potion family (Dragonfire, 2026-08-31) in the
 * Consumables table.
 *
 * Lifeward is the eighth artifact-ingredient potion line: T4 / T6 / T8, each
 * consuming exactly one Dragon Blood (T{4,6,8}_ALCHEMY_RARE_DRAGONAREA), a
 * dragon drop that carries maxreturnamount="0" in-game and therefore must be
 * noReturn (no city Resource Return Rate refund). Everything else in the
 * recipe — herbs, agaric, alcohol — is returnable as usual.
 *
 * Black-box: drives the real catalog / recipe / focus / sauce / name data plus
 * the enchant-variant generator. No live API or DB.
 *
 * Authoritative values are the per-craft-action <craftresource> counts read
 * verbatim from the ao-bin-dumps items.xml of 2026-08-31.
 *
 * Run: node tests/dragon-potions-lifeward.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

function load(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

// ── The family, verbatim from items.xml ──────────────────────────────────────
const CASES = [
  {
    id: "T4_POTION_LIFEWARD",
    tier: 4,
    blood: "T4_ALCHEMY_RARE_DRAGONAREA",
    focus: 56,
    mats: [["T4_ALCHEMY_RARE_DRAGONAREA", 1], ["T4_BURDOCK", 16]],
  },
  {
    id: "T6_POTION_LIFEWARD",
    tier: 6,
    blood: "T6_ALCHEMY_RARE_DRAGONAREA",
    focus: 294,
    mats: [["T6_ALCHEMY_RARE_DRAGONAREA", 1], ["T6_FOXGLOVE", 48],
           ["T5_TEASEL", 24], ["T2_AGARIC", 12]],
  },
  {
    id: "T8_POTION_LIFEWARD",
    tier: 8,
    blood: "T8_ALCHEMY_RARE_DRAGONAREA",
    focus: 1296,
    mats: [["T8_ALCHEMY_RARE_DRAGONAREA", 1], ["T8_YARROW", 144],
           ["T7_MULLEIN", 72], ["T5_TEASEL", 72], ["T2_AGARIC", 36],
           ["T8_ALCOHOL", 36]],
  },
];

// Dragon Blood tiers and their in-game names.
const BLOOD_NAMES = {
  T4_ALCHEMY_RARE_DRAGONAREA: "Diluted Dragon Blood",
  T6_ALCHEMY_RARE_DRAGONAREA: "Dragon Blood",
  T8_ALCHEMY_RARE_DRAGONAREA: "Potent Dragon Blood",
};

const POTION_NAMES = {
  T4_POTION_LIFEWARD: "Minor Lifeward Potion",
  T6_POTION_LIFEWARD: "Lifeward Potion",
  T8_POTION_LIFEWARD: "Major Lifeward Potion",
};

// ── Compile the real browser modules together. ───────────────────────────────
const stubs = [
  "function getTierFromId(id) {",
  "  const m = id.match(/^T(\\d)/);",
  "  return m ? parseInt(m[1], 10) : 0;",
  "}",
  "",
].join("\n");

const sources =
  stubs +
  load("js/data-consumables.js") +
  load("js/recipes.js") +
  load("js/recipes-rare-potions.js") +
  load("js/recipes-dragon-potions.js") +
  load("js/data-enchant-sauces.js") +
  load("js/item-names.js");

const renderSrc = (load("js/render-consumables.js") + load("js/render-consumables-row.js"));
const helperBlock = renderSrc.slice(0, renderSrc.indexOf("function renderConsumableTable"))
  + load("js/consumable-enchant-variants.js");

const mod = new Module("dragon-potions-test");
mod._compile(
  sources + helperBlock +
    "\nmodule.exports = { generateConsumableEnchantVariants, consumableBaseHasEnchantVariants, CONSUMABLES, BUNDLED_RECIPES, ENCHANT_UPGRADE_SAUCE, ITEM_NAMES_MAP };",
  "dragon-potions-test.js"
);
const {
  generateConsumableEnchantVariants,
  consumableBaseHasEnchantVariants,
  CONSUMABLES,
  BUNDLED_RECIPES,
  ENCHANT_UPGRADE_SAUCE,
  ITEM_NAMES_MAP,
} = mod.exports;

const FOCUS_COSTS = require("../js/focus-costs.json");
const CONSUMABLE_OUTPUT = require("../js/consumable-output.json");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name + " — " + e.message); failed++; }
}

console.log("\n=== Catalog: all three Lifeward potions are in CONSUMABLES ===");
const catalogIds = new Set(CONSUMABLES.map((c) => c.id));
for (const c of CASES) {
  test(c.id + " is in CONSUMABLES", () => {
    assert.ok(catalogIds.has(c.id), c.id + " missing from CONSUMABLES");
  });
}
test("no T2/T3/T5/T7 Lifeward row was invented", () => {
  const stray = [...catalogIds].filter(
    (id) => /_POTION_LIFEWARD$/.test(id) && !CASES.some((c) => c.id === id)
  );
  assert.deepStrictEqual(stray, [], "Lifeward only exists at T4/T6/T8");
});

console.log("\n=== Recipe: exact material list, Dragon Blood is the sole noReturn ===");
for (const c of CASES) {
  test(c.id + " recipe matches items.xml", () => {
    const rec = BUNDLED_RECIPES[c.id];
    assert.ok(Array.isArray(rec), c.id + " has no BUNDLED_RECIPES entry");
    assert.deepStrictEqual(
      rec.map((m) => [m.matId, m.count]),
      c.mats,
      c.id + " material list/order differs from the dump"
    );
  });
  test(c.id + " refunds nothing on " + c.blood, () => {
    const rec = BUNDLED_RECIPES[c.id];
    const blood = rec.find((m) => m.matId === c.blood);
    assert.ok(blood, c.id + " should consume " + c.blood);
    assert.strictEqual(blood.count, 1, c.blood + " count should be 1");
    assert.strictEqual(blood.noReturn, true, c.blood + " must be noReturn");
    const noReturnMats = rec.filter((m) => m.noReturn);
    assert.strictEqual(noReturnMats.length, 1,
      "only Dragon Blood may be noReturn (got " + noReturnMats.map((m) => m.matId) + ")");
  });
}

console.log("\n=== Focus: base + @1/@2/@3 present in focus-costs.json ===");
for (const c of CASES) {
  test(c.id + " base focus = " + c.focus, () => {
    assert.strictEqual(FOCUS_COSTS[c.id], c.focus,
      c.id + " focus mismatch (got " + FOCUS_COSTS[c.id] + ")");
    for (const lvl of [1, 2, 3]) {
      assert.ok(FOCUS_COSTS[c.id + "@" + lvl] > 0, c.id + "@" + lvl + " focus missing");
    }
  });
}

console.log("\n=== Output: a Lifeward craft action yields 10 potions ===");
for (const c of CASES) {
  test(c.id + " amountcrafted = 10", () => {
    assert.strictEqual(CONSUMABLE_OUTPUT[c.id], 10,
      c.id + " output should be 10 (got " + CONSUMABLE_OUTPUT[c.id] + ")");
  });
}

console.log("\n=== Enchant sauce: 3 Arcane-Extract levels per potion ===");
for (const c of CASES) {
  test(c.id + " upgrades with T1_ALCHEMY_EXTRACT L1/L2/L3", () => {
    const ups = ENCHANT_UPGRADE_SAUCE[c.id];
    assert.ok(Array.isArray(ups), c.id + " missing from ENCHANT_UPGRADE_SAUCE");
    assert.deepStrictEqual(ups.map((u) => u.level).sort(), [1, 2, 3]);
    for (const u of ups) {
      assert.strictEqual(u.sauceMatId, "T1_ALCHEMY_EXTRACT_LEVEL" + u.level);
      assert.ok(u.count > 0, c.id + " level " + u.level + " count must be > 0");
    }
  });
}

console.log("\n=== Enchant variants: .1 / .2 / .3 are generated ===");
const variantIds = new Set(
  generateConsumableEnchantVariants(CONSUMABLES).map((c) => c.id)
);
for (const c of CASES) {
  test(c.id + " spawns .1 / .2 / .3 variants", () => {
    assert.strictEqual(consumableBaseHasEnchantVariants(c.id), true,
      c.id + " should be expandable");
    for (const lvl of [1, 2, 3]) {
      assert.ok(variantIds.has(c.id + "@" + lvl), c.id + "@" + lvl + " not generated");
    }
  });
}

console.log("\n=== Display names: potions and Dragon Blood are humanized ===");
for (const c of CASES) {
  test(c.id + " renders as \"" + POTION_NAMES[c.id] + "\"", () => {
    const name = ITEM_NAMES_MAP[c.id];
    assert.ok(name && typeof name === "string", c.id + " has no display name");
    assert.ok(!name.includes("_"), c.id + " name leaks a raw id: " + name);
    assert.ok(name.includes(POTION_NAMES[c.id]),
      c.id + " name \"" + name + "\" should contain \"" + POTION_NAMES[c.id] + "\"");
  });
}
for (const [id, name] of Object.entries(BLOOD_NAMES)) {
  test(id + " renders as \"" + name + "\"", () => {
    assert.strictEqual(ITEM_NAMES_MAP[id], name,
      id + " display name is \"" + ITEM_NAMES_MAP[id] + "\"");
  });
}

console.log("\n" + "=".repeat(50));
console.log("Total: " + (passed + failed) + " | Passed: " + passed + " | Failed: " + failed);
if (failed > 0) process.exit(1);
