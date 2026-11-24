/**
 * Test: the Flipping table's enchant (.1-.4) variant rows.
 *
 * Reported: enchanted items are missing from the Flipping table entirely — the
 * Ench. picker empties the board because getAllFlippingItems() only ever unions
 * BASE ids. Enchant variants are now generated on demand: a base row expands
 * into its .1-.4 children, or the picker surfaces one level across the table.
 *
 * Black-box over expandFlipItems / hasEnchantVariants / flipVariantIds: load the
 * real catalogs end-to-end (same files/order as index.html), expand, and assert
 * on the resulting id/name sets. No live API / DOM — document, window and
 * localStorage are stubbed.
 *
 * Run: node tests/flipping-enchant-variants.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

globalThis.tx = globalThis.tx || ((en) => en);

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const stubs = `
const document = { getElementById: () => null, addEventListener: () => {}, querySelector: () => null };
const window = { addEventListener: () => {} };
const localStorage = { getItem: () => null, setItem: () => {} };
`;

const src =
  stubs +
  J("item-names.js") + J("resource-names.js") + J("data-artifacts.js") + J("data.js") +
  J("data-consumables.js") + J("data-mounts.js") +
  J("gear-cloth-armor.js") + J("gear-leather-armor.js") + J("gear-leather-dragon.js") + J("gear-plate-armor.js") +
  J("gear-melee-light.js") + J("gear-melee-heavy.js") + J("gear-ranged.js") +
  J("gear-staves-a.js") + J("gear-staves-b.js") + J("gear-staves-c.js") +
  J("gear-offhand.js") + J("gear-capes.js") + J("gear-tools.js") + J("gear-gatherer.js") +
  J("gear-crystal-weapons.js") + J("gear-crystal-weapons-b.js") + J("gear-token-substitute.js") +
  J("gear.js") + J("data-flip-extras.js") + (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) + J("flip-enchant-variants.js") +
  "\nbuildArtifactFlipItems(); buildResourceFlipItems();" +
  "\nmodule.exports = { getAllFlippingItems, getFlippingItemIds, getFlippingSearchIds," +
  " expandFlipItems, hasEnchantVariants, flipVariantIds, MOUNT_RECIPES, CONSUMABLES };";

const mod = new Module("flipping-enchant-variants");
mod.paths = Module._nodeModulePaths(process.cwd());
mod._compile(src, "flipping-enchant-variants.js");
const {
  getAllFlippingItems, getFlippingItemIds, getFlippingSearchIds,
  expandFlipItems, hasEnchantVariants, flipVariantIds,
  MOUNT_RECIPES, CONSUMABLES,
} = mod.exports;

const base = getAllFlippingItems();
const baseIds = base.map((i) => i.id);
const idsOf = (items) => items.map((i) => i.id);

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.error(`FAIL  ${name}\n      ${e.message}`); }
}

// ── hasEnchantVariants: who has a .1-.4 ladder ──────────────────────────────
const ENCHANTABLE = [
  "T4_BAG", "T8_BAG", "T6_BAG_INSIGHT", "T4_CAPE", "T6_CAPEITEM_FW_LYMHURST",
  "T8_MAIN_SWORD", "T4_2H_BOW", "T5_HEAD_CLOTH_SET1", "T7_ARMOR_LEATHER_SET3",
  "T8_SHOES_PLATE_SET1", "T6_OFF_SHIELD", "T8_HEAD_GATHERER_FIBER",
];
const NOT_ENCHANTABLE = [
  // below the enchant tier floor
  "T2_BAG", "T3_BAG", "T3_CAPE", "T3_MAIN_SWORD",
  // not equipment
  "T4_RUNE", "T6_SOUL", "T8_RELIC", "T5_JOURNAL_WOOD", "T4_SKILLBOOK_STANDARD",
  "T8_FURNITUREITEM_TROPHY_FISH", "T6_FURNITUREITEM_BED", "T4_ARTEFACT_2H_BOW_HELL",
  "T8_MOUNT_HORSE", "T6_POTION_HEAL", "T5_MEAL_SOUP", "T4_WOOD", "T5_PLANKS",
  "T6_FARM_CABBAGE_SEED", "T7_FISH_SALTWATER_ALL_COMMON",
  // crests: the blueprint of an enchantable cape, but flat itself — items.xml
  // has no CAPEITEM_*_BP@n, so a ladder here would only add dead rows
  "T4_CAPEITEM_UNDEAD_BP", "T8_CAPEITEM_FW_LYMHURST_BP", "T6_CAPEITEM_AVALON_BP",
  // already a variant — never re-expanded
  "T8_BAG@2", "T4_WOOD_LEVEL1@1",
];
check("hasEnchantVariants is true for T4-T8 equipment", () => {
  ENCHANTABLE.forEach((id) => assert.ok(hasEnchantVariants(id), `${id} should enchant`));
});
check("hasEnchantVariants is false for everything else", () => {
  NOT_ENCHANTABLE.forEach((id) => assert.ok(!hasEnchantVariants(id), `${id} should NOT enchant`));
});

// ── expandFlipItems: nothing revealed by default ────────────────────────────
check("no expand + no picker leaves the universe untouched", () => {
  assert.deepStrictEqual(idsOf(expandFlipItems(base, { expanded: new Set(), enchSel: "" })), baseIds);
});
check(".0 pick is the base board too (an unenchanted row IS .0)", () => {
  assert.deepStrictEqual(idsOf(expandFlipItems(base, { expanded: new Set(), enchSel: "0" })), baseIds);
});

// ── expandFlipItems: one expanded base ──────────────────────────────────────
const oneOpen = expandFlipItems(base, { expanded: new Set(["T8_BAG"]), enchSel: "" });
check("an expanded base gains exactly its four variants", () => {
  const added = idsOf(oneOpen).filter((id) => !baseIds.includes(id));
  assert.deepStrictEqual(added, ["T8_BAG@1", "T8_BAG@2", "T8_BAG@3", "T8_BAG@4"]);
});
check("variants sit directly under their base", () => {
  const at = idsOf(oneOpen).indexOf("T8_BAG");
  assert.deepStrictEqual(idsOf(oneOpen).slice(at, at + 5),
    ["T8_BAG", "T8_BAG@1", "T8_BAG@2", "T8_BAG@3", "T8_BAG@4"]);
});
check("a variant row is named [T8.1] and carries its base + level", () => {
  const v = oneOpen.find((i) => i.id === "T8_BAG@1");
  const b = base.find((i) => i.id === "T8_BAG");
  assert.strictEqual(v.name, b.name.replace("[T8]", "[T8.1]"));
  assert.strictEqual(v.baseId, "T8_BAG");
  assert.strictEqual(v.enchantVariant, 1);
});
check("expanding a NON-enchantable base adds nothing", () => {
  ["T8_MOUNT_HORSE", "T2_BAG", "T4_RUNE", "T4_WOOD"].forEach((id) => {
    assert.deepStrictEqual(
      idsOf(expandFlipItems(base, { expanded: new Set([id]), enchSel: "" })), baseIds,
      `${id} should not expand`);
  });
});

// ── expandFlipItems: the Ench. picker ───────────────────────────────────────
const enchantableCount = base.filter((i) => hasEnchantVariants(i.id)).length;
[1, 2, 3, 4].forEach((lvl) => {
  check(`picking .${lvl} adds exactly one variant per enchantable base`, () => {
    const out = expandFlipItems(base, { expanded: new Set(), enchSel: String(lvl) });
    const added = idsOf(out).filter((id) => !baseIds.includes(id));
    assert.strictEqual(added.length, enchantableCount);
    assert.ok(added.every((id) => id.endsWith("@" + lvl)), `a non-.${lvl} id leaked in`);
  });
});
check("the enchantable universe is the T4-T8 gear catalog, not a sample", () => {
  assert.ok(enchantableCount > 1000, `expected >1000 enchantable bases, got ${enchantableCount}`);
});
check("an expanded base still shows all four levels under an active pick", () => {
  const out = expandFlipItems(base, { expanded: new Set(["T8_BAG"]), enchSel: "2" });
  const ids = idsOf(out);
  [1, 2, 3, 4].forEach((n) => assert.ok(ids.includes(`T8_BAG@${n}`), `missing T8_BAG@${n}`));
});

// ── resource variants (already on the board) must be left alone ─────────────
const RESOURCE_VARIANT = "T4_WOOD_LEVEL1@1";
check("resource _LEVELn@n rows pass through and are never re-expanded", () => {
  assert.ok(baseIds.includes(RESOURCE_VARIANT), "fixture drifted: resource variant not in the universe");
  const out = idsOf(expandFlipItems(base, { expanded: new Set([RESOURCE_VARIANT]), enchSel: "3" }));
  assert.ok(out.includes(RESOURCE_VARIANT), "resource variant dropped");
  assert.ok(!out.some((id) => id.startsWith(RESOURCE_VARIANT + "@")), "resource variant re-enchanted");
});

// ── invariants ──────────────────────────────────────────────────────────────
check("no duplicate ids after expansion", () => {
  [{ expanded: new Set(), enchSel: "" },
    { expanded: new Set(["T8_BAG", "T4_2H_BOW", "T8_MAIN_SWORD"]), enchSel: "" },
    { expanded: new Set(["T8_BAG"]), enchSel: "4" }].forEach((opts) => {
    const ids = idsOf(expandFlipItems(base, opts));
    assert.strictEqual(new Set(ids).size, ids.length, "duplicate ids leaked through");
  });
});
check("the hand-written gear variants are gone from the catalog", () => {
  // They would duplicate the generated children of their own base row.
  ["T4_2H_BOW@1", "T4_2H_BOW@4", "T8_MAIN_SWORD@1", "T8_MAIN_SWORD@4"].forEach((id) => {
    assert.ok(!baseIds.includes(id), `${id} is still hand-listed in FLIPPING_ITEMS`);
  });
});
check("mounts and consumables never gain gear variants", () => {
  const out = new Set(idsOf(expandFlipItems(base, { expanded: new Set(), enchSel: "1" })));
  MOUNT_RECIPES.forEach((m) => assert.ok(!out.has(m.id + "@1"), `mount ${m.id} enchanted`));
  CONSUMABLES.slice(0, 20).forEach((c) => assert.ok(!out.has(c.id + "@1"), `consumable ${c.id} enchanted`));
});

// ── the lazy-fetch id lists ─────────────────────────────────────────────────
check("flipVariantIds({baseId}) is that base's four variants", () => {
  assert.deepStrictEqual(flipVariantIds({ baseId: "T8_BAG" }),
    ["T8_BAG@1", "T8_BAG@2", "T8_BAG@3", "T8_BAG@4"]);
});
check("flipVariantIds({enchLevel}) is one level across every enchantable base", () => {
  const ids = flipVariantIds({ enchLevel: 3 });
  assert.strictEqual(ids.length, enchantableCount);
  assert.ok(ids.every((id) => id.endsWith("@3")));
});
check("flipVariantIds for a non-enchantable base is empty", () => {
  assert.deepStrictEqual(flipVariantIds({ baseId: "T8_MOUNT_HORSE" }), []);
  assert.deepStrictEqual(flipVariantIds({ baseId: "T2_BAG" }), []);
});

// ── scan vs search id universes ─────────────────────────────────────────────
check("Scan Flipping still fetches base ids only", () => {
  assert.deepStrictEqual(getFlippingItemIds(), baseIds);
});
check("the search catalog carries every variant so the Ench. picker can match", () => {
  const search = getFlippingSearchIds();
  assert.strictEqual(search.length, baseIds.length + enchantableCount * 4);
  ["T8_BAG@1", "T8_BAG@4", "T6_BAG_INSIGHT@2", "T4_2H_BOW@3"].forEach((id) =>
    assert.ok(search.includes(id), `missing ${id}`));
  assert.strictEqual(new Set(search).size, search.length, "duplicate ids in the search catalog");
});
check("the search catalog keeps every base id", () => {
  const search = new Set(getFlippingSearchIds());
  baseIds.forEach((id) => assert.ok(search.has(id), `dropped base ${id}`));
});

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — flipping-enchant-variants (${enchantableCount} enchantable bases)`);
process.exit(failures === 0 ? 0 : 1);
