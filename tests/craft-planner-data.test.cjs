/**
 * Test: craft-planner-data — the journal mapping + crafting-fame model that
 * the Crafting Planner table uses to value journal-fill while crafting.
 *
 * Black-box: feed item descriptors (id + craftType) and resource counts,
 * assert the journal slug, fame-per-craft, journal candidates and scan ids.
 *
 * Game facts under test (researched, see project memory):
 *   - Crafting professions → journal: Warrior's Forge=WARRIOR (plate + warrior
 *     weapons), Hunter's Lodge=HUNTER (leather + hunter weapons), Mage's Tower=
 *     MAGE (cloth + mage weapons), Toolmaker=TOOLMAKER (tools + furniture).
 *   - Journal fame per craft = nonArtifactMats × FAME_MULT[tier] × 2^enchant,
 *     with FAME_MULT = {2:1.5,3:7.5,4:22.5,5:90,6:270,7:645,8:1395}. Enchant
 *     DOUBLES per level off the item's own tier; it does not raise the tier
 *     (verified in game: a T4.2 Bloodletter with 24 non-artifact mats awarded
 *     exactly 24 × 22.5 × 2^2 = 2160 journal fame — forum thread 167786).
 *     Artifacts do not affect fame gain at all, so they are simply absent from
 *     the material count.
 *   - Crafting journal maxfame schedule = {2:900 … 8:57600}.
 *
 * Run: node tests/craft-planner-data.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

function loadFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

// Stub the two browser globals getCraftPlannerItemIds depends on so the scan-id
// assembly can be exercised in Node. getCraftingItemIds returns a mix of base +
// enchant (@n) ids; getRefiningChainIds returns one raw per base refined mat.
const idStubs = `
function getCraftingItemIds() {
  return ["T5_MAIN_SWORD","T5_MAIN_SWORD@1","T5_MAIN_SWORD@2","T5_METALBAR","T5_METALBAR@1","T8_ARMOR_PLATE_SET1"];
}
function getRefiningChainIds(id) {
  return id === "T5_METALBAR" ? ["T5_ORE","T4_METALBAR"] : [];
}
`;
const mod = new Module("craft-planner-data-test");
mod._compile(
  idStubs +
    loadFile("js/data-craft-journal-fame.js") +
    loadFile("js/data-craft-planner.js") +
    "\nmodule.exports = { CRAFT_JOURNAL_BY_TYPE, CRAFT_BASE_FAME_MULT, " +
    "CRAFT_JOURNAL_FAME, getCraftJournalSlug, getCraftingFamePerCraft, " +
    "getCraftPlannerJournalCandidates, getCraftPlannerJournalIds, getCraftPlannerItemIds };",
  "data-craft-planner.js"
);
const M = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// ── Journal slug mapping ────────────────────────────────────────────────────
console.log("\n=== craftType → journal slug ===");

const SLUG_CASES = [
  // Warrior's Forge: plate armor + warrior weapons + warrior off-hands
  ["plate_armor", "T8_ARMOR_PLATE_SET1", "WARRIOR"],
  ["plate_helmet", "T6_HEAD_PLATE_SET2", "WARRIOR"],
  ["sword", "T7_MAIN_SWORD", "WARRIOR"],
  ["axe", "T5_2H_AXE", "WARRIOR"],
  ["crossbow", "T8_2H_CROSSBOW", "WARRIOR"],
  ["knuckles", "T6_2H_KNUCKLES_SET1", "WARRIOR"],
  ["shield", "T4_OFF_SHIELD", "WARRIOR"],
  // Hunter's Lodge: leather armor + hunter weapons + hunter off-hands
  ["leather_helmet", "T8_HEAD_LEATHER_SET1", "HUNTER"],
  ["leather_armor", "T6_ARMOR_LEATHER_SET2", "HUNTER"],
  ["bow", "T5_2H_BOW", "HUNTER"],
  ["spear", "T7_2H_SPEAR", "HUNTER"],
  ["naturestaff", "T6_2H_NATURESTAFF", "HUNTER"],
  ["quarterstaff", "T8_2H_QUARTERSTAFF", "HUNTER"],
  ["dagger", "T4_MAIN_DAGGER", "HUNTER"],
  ["horn", "T5_OFF_HORN_KEEPER", "HUNTER"],
  // Mage's Tower: cloth armor + mage weapons + mage off-hands
  ["cloth_armor", "T4_ARMOR_CLOTH_SET1", "MAGE"],
  ["cloth_shoes", "T8_SHOES_CLOTH_SET1", "MAGE"],
  ["firestaff", "T7_2H_FIRESTAFF", "MAGE"],
  ["froststaff", "T5_MAIN_FROSTSTAFF", "MAGE"],
  ["arcanestaff", "T6_2H_ARCANESTAFF", "MAGE"],
  ["holystaff", "T8_2H_HOLYSTAFF", "MAGE"],
  ["cursestaff", "T7_MAIN_CURSEDSTAFF", "MAGE"],
  ["book", "T6_OFF_BOOK", "MAGE"],
  ["orb", "T5_OFF_ORB_MORGANA", "MAGE"],
  ["totem", "T4_OFF_TOTEM_KEEPER", "MAGE"],
  // Toolmaker: tools
  ["pickaxe", "T6_2H_TOOL_PICK", "TOOLMAKER"],
  ["sickle", "T5_2H_TOOL_SICKLE", "TOOLMAKER"],
];

SLUG_CASES.forEach(([craftType, id, expected]) => {
  test(`craftType '${craftType}' → ${expected}`, () => {
    assert.strictEqual(M.getCraftJournalSlug({ id, craftType }), expected);
  });
});

test("furniture (craftType null) maps to TOOLMAKER by id pattern", () => {
  assert.strictEqual(
    M.getCraftJournalSlug({ id: "T8_FURNITUREITEM_TABLE", craftType: null }),
    "TOOLMAKER"
  );
  assert.strictEqual(
    M.getCraftJournalSlug({ id: "T4_FURNITUREITEM_BED", craftType: null }),
    "TOOLMAKER"
  );
});

test("a craft in no journal's validitem list → null (no journal fill)", () => {
  // Food and mounts fill nothing, and neither do the COMBINE crafts — an
  // artifact cape shares craftType "cape" with the plain cape that DOES fill the
  // Toolmaker journal, which is why the mapping is per item id, not per type.
  assert.strictEqual(M.getCraftJournalSlug({ id: "T4_MEAL_SOUP", craftType: "food" }), null);
  assert.strictEqual(M.getCraftJournalSlug({ id: "T8_CAPEITEM_AVALON", craftType: "cape" }), null);
  assert.strictEqual(M.getCraftJournalSlug({ id: "T8_ARMOR_PLATE_ROYAL", craftType: "plate_armor" }), null);
});

test("gatherer gear and capes DO fill the Toolmaker journal", () => {
  // Both showed nothing while the lookup went through craftType.
  assert.strictEqual(M.getCraftJournalSlug({ id: "T8_ARMOR_GATHERER_WOOD", craftType: null }), "TOOLMAKER");
  assert.strictEqual(M.getCraftJournalSlug({ id: "T8_CAPE", craftType: "cape" }), "TOOLMAKER");
  assert.strictEqual(M.getCraftJournalSlug({ id: "T8_BAG", craftType: "bag" }), "TOOLMAKER");
});

// ── Crafting fame per craft ────────────────────────────────────────────────
console.log("\n=== crafting fame per craft ===");

test("fame mult table matches researched values", () => {
  assert.deepStrictEqual(M.CRAFT_BASE_FAME_MULT, {
    1: 0, 2: 1.5, 3: 7.5, 4: 22.5, 5: 90, 6: 270, 7: 645, 8: 1395,
  });
});

test("T8 craft, 16 mats → 16 × 1395 = 22320 fame", () => {
  const fame = M.getCraftingFamePerCraft({ id: "T8_ARMOR_PLATE_SET1" }, 16, 0);
  assert.strictEqual(fame, 16 * 1395);
});

test("T4 craft, 8 mats → 8 × 22.5 = 180 fame", () => {
  const fame = M.getCraftingFamePerCraft({ id: "T4_HEAD_CLOTH_SET1" }, 8, 0);
  assert.strictEqual(fame, 8 * 22.5);
});

// Enchant DOUBLES the fame per level, off the item's OWN tier. It does not walk
// up the multiplier table: that table is not a doubling (90→270 is ×3,
// 645→1395 is ×2.16), so "+1 effective tier per enchant" gave a different — and
// wrong — answer in both directions. The reference case is measured in game.
test("the in-game reference: T4.2, 24 non-artifact mats → 2,160 journal fame", () => {
  // Adept's Bloodletter 4.2 = 16 rare worked leather + 8 rare steel bar + 1
  // artifact. 24 × 22.5 × 2^2 = 2160, exactly what the game awarded.
  assert.strictEqual(M.getCraftingFamePerCraft({ id: "T4_MAIN_DAGGER@2" }, 24, 2), 2160);
});

test("enchant doubles per level rather than raising the tier", () => {
  // T6.2: 16 × 270 × 4 = 17,280. The old effective-tier rule read the T8 row
  // (16 × 1395 = 22,320) — 29% high.
  assert.strictEqual(M.getCraftingFamePerCraft({ id: "T6_ARMOR_PLATE_SET1@2" }, 16, 2), 16 * 270 * 4);
});

test("a T8 enchant is not clamped — the doubling has no ceiling", () => {
  // The old rule capped the effective tier at 8, so every T8.1-.4 craft read the
  // plain T8 multiplier and lost the whole enchant bonus.
  assert.strictEqual(M.getCraftingFamePerCraft({ id: "T8_ARMOR_PLATE_SET1@4" }, 16, 4), 16 * 1395 * 16);
  assert.strictEqual(M.getCraftingFamePerCraft({ id: "T7_2H_BOW@3" }, 20, 3), 20 * 645 * 8);
});

test("a .0 craft gets no enchant factor", () => {
  assert.strictEqual(M.getCraftingFamePerCraft({ id: "T8_ARMOR_PLATE_SET1" }, 16, 0), 16 * 1395);
});

test("the enchant level is read off the id when not passed", () => {
  assert.strictEqual(M.getCraftingFamePerCraft({ id: "T6_ARMOR_PLATE_SET1@2" }, 16), 16 * 270 * 4);
});

test("zero non-artifact mats → zero fame", () => {
  assert.strictEqual(M.getCraftingFamePerCraft({ id: "T8_2H_HOLYSTAFF" }, 0, 0), 0);
});

// ── Journal candidates (±2 tier fill window) ───────────────────────────────
console.log("\n=== journal candidates ===");

test("maxfame schedule matches items.xml (T7/T8 stop doubling)", () => {
  assert.deepStrictEqual(M.CRAFT_JOURNAL_FAME, {
    2: 900, 3: 1800, 4: 3600, 5: 7200, 6: 14400, 7: 28380, 8: 58590,
  });
});

test("a T8 craft fills the T8 journal and no other", () => {
  // items.xml lists only same-tier items under <craftitemfame>; the ±2 window
  // belongs to the GATHERING journals, whose <gatherfame> blocks really do span
  // three tiers of resource.
  const cands = M.getCraftPlannerJournalCandidates("WARRIOR", 8);
  assert.deepStrictEqual(cands.map((c) => c.tier), [8]);
  assert.strictEqual(cands[0].emptyId, "T8_JOURNAL_WARRIOR_EMPTY");
  assert.strictEqual(cands[0].fullId, "T8_JOURNAL_WARRIOR_FULL");
  assert.strictEqual(cands[0].maxfame, 58590);
});

test("a T3 craft fills only the T3 journal", () => {
  assert.deepStrictEqual(
    M.getCraftPlannerJournalCandidates("MAGE", 3).map((c) => c.tier),
    [3],
  );
});

test("null slug → no candidates", () => {
  assert.deepStrictEqual(M.getCraftPlannerJournalCandidates(null, 8), []);
});

// ── Scan ids ────────────────────────────────────────────────────────────────
console.log("\n=== scan ids ===");

test("getCraftPlannerJournalIds covers 4 slugs × 7 tiers × {empty,full}", () => {
  const ids = M.getCraftPlannerJournalIds();
  assert.strictEqual(ids.length, 4 * 7 * 2);
  assert.ok(ids.includes("T8_JOURNAL_TOOLMAKER_FULL"));
  assert.ok(ids.includes("T2_JOURNAL_HUNTER_EMPTY"));
  assert.ok(ids.includes("T5_JOURNAL_MAGE_FULL"));
  assert.ok(ids.includes("T7_JOURNAL_WARRIOR_EMPTY"));
});

test("getCraftPlannerItemIds drops @n enchant variants (planner renders base recipes only)", () => {
  const ids = M.getCraftPlannerItemIds();
  assert.strictEqual(ids.filter((x) => x.includes("@")).length, 0, "no enchant variants fetched");
  assert.ok(ids.includes("T5_MAIN_SWORD"), "base item kept");
  assert.ok(ids.includes("T5_METALBAR"), "base mat kept");
  assert.ok(!ids.includes("T5_MAIN_SWORD@1"), "enchant item dropped");
  assert.ok(!ids.includes("T5_METALBAR@1"), "enchant mat dropped");
});

test("getCraftPlannerItemIds folds in refining-chain intermediates for base mats", () => {
  const ids = M.getCraftPlannerItemIds();
  assert.ok(ids.includes("T5_ORE"), "raw from base mat's refining chain");
  assert.ok(ids.includes("T4_METALBAR"), "lower-tier refined from chain");
});

test("getCraftPlannerItemIds always appends the crafting journals", () => {
  const ids = M.getCraftPlannerItemIds();
  const journals = ids.filter((x) => x.includes("_JOURNAL_"));
  assert.strictEqual(journals.length, 4 * 7 * 2, "all journal ids present");
});

test("getCraftPlannerItemIds appends the 15 enchanting mats (T4-T8 × RUNE/SOUL/RELIC)", () => {
  // The planner prices the buy-@(n-1)-and-enchant-up route on its .1-.3 rows
  // (js/craft-planner-enchant-route.js), so the runes must be fetched.
  const ids = M.getCraftPlannerItemIds();
  const mats = ids.filter((x) => /^(T[4-8])_(RUNE|SOUL|RELIC)$/.test(x));
  assert.strictEqual(mats.length, 15);
  ["T4_RUNE", "T6_SOUL", "T8_RELIC"].forEach((id) => assert.ok(ids.includes(id)));
});

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
