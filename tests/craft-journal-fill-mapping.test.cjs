/**
 * Black-box tests for "which crafting journal does this craft fill, and how many
 * crafts fill it" (js/data-craft-journal-fame.js + js/data-craft-planner.js).
 *
 * The mapping used to be a hand-written craftType → journal table. It was wrong
 * in both directions and the Crafting Planner's Journal Fill column showed the
 * damage: every cape rendered "—" (reported bug), while a craftType rule would
 * have credited the artifact capes with a journal they cannot fill.
 *
 * items.xml settles it per item — each <journalitem> lists the exact ids that
 * fill it:
 *   • Toolmaker takes capes, bags, gatherer gear, tools and furniture;
 *   • COMBINE crafts (artifact + faction capes, Royal armour, the Crystal
 *     weapons, the Shapeshifter staves) appear in no list at all — same family
 *     of crafts that already carry 0 focus and 0 return rate;
 *   • every valid item is the journal's OWN tier, so the ±2 fill window that the
 *     gathering journals use must not be applied to crafting journals.
 *
 * Run: node tests/craft-journal-fill-mapping.test.cjs
 */

const assert = require("assert");
const {
  CRAFT_JOURNAL_MAXFAME,
  getCraftJournalForItem,
} = require("../js/data-craft-journal-fame.js");
const {
  getCraftJournalSlug,
  getCraftPlannerJournalCandidates,
  getCraftsToFillJournal,
} = require("../js/data-craft-planner.js");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL: ${name} — ${e.message}`);
  }
}

const item = (id, craftType) => ({ id, craftType });

console.log("Craft Journal Fill Mapping Tests\n");

// ── the reported bug: capes fill the Toolmaker journal ──────────────────────

[
  ["T4_CAPE", "cape"],
  ["T8_CAPE", "cape"],
  ["T8_CAPE@3", "cape"],
  ["T6_CAPE_CLOTH_UNDEAD", "cape"],
  ["T6_CAPE_PLATE_MORGANA", "cape"],
  ["T8_BAG", "bag"],
  ["T8_BAG_INSIGHT", "bag"],
  ["T8_ARMOR_GATHERER_ORE", null],
  ["T8_BACKPACK_GATHERER_FISH", null],
  ["T8_2H_TOOL_PICK", "pickaxe"],
  ["T8_2H_TOOL_PICK_AVALON", "pickaxe"],
  ["T5_FURNITUREITEM_CHEST", null],
].forEach(([id, craftType]) => {
  test(`${id} fills the Toolmaker journal`, () => {
    assert.strictEqual(getCraftJournalSlug(item(id, craftType)), "TOOLMAKER");
  });
});

// ── combine crafts fill nothing ─────────────────────────────────────────────

[
  ["T8_CAPEITEM_AVALON", "cape"],
  ["T8_CAPEITEM_FW_BRECILIEN", "cape"],
  ["T8_CAPEITEM_SMUGGLER", "cape"],
  ["T4_CAPEITEM_UNDEAD", "cape"],
  ["T8_ARMOR_PLATE_ROYAL", "plate_armor"],
  ["T8_HEAD_CLOTH_ROYAL", "cloth_helmet"],
].forEach(([id, craftType]) => {
  test(`${id} fills no crafting journal`, () => {
    assert.strictEqual(getCraftJournalSlug(item(id, craftType)), null);
  });
});

// Crystal weapons and the Shapeshifter staves used to be combine-only crafts
// filling nothing; the 2026 dump lists them in the ordinary crafting journals
// (T8_2H_HAMMER_CRYSTAL → T8_JOURNAL_WARRIOR, Shapeshifter → HUNTER).
[
  ["T8_2H_HAMMER_CRYSTAL", "hammer", "WARRIOR"],
  ["T8_MAIN_SWORD_CRYSTAL", "sword", "WARRIOR"],
  ["T8_2H_SHAPESHIFTER_HELL", "shapeshifterstaff", "HUNTER"],
].forEach(([id, craftType, slug]) => {
  test(`${id} fills the ${slug} journal`, () => {
    assert.strictEqual(getCraftJournalSlug(item(id, craftType)), slug);
  });
});

test("a T1 craft fills nothing — journals start at T2", () => {
  assert.strictEqual(getCraftJournalSlug(item("T1_MAIN_SWORD", "sword")), null);
});

test("an item outside every list is null, not a craftType guess", () => {
  assert.strictEqual(getCraftJournalSlug(item("T8_MOUNT_HORSE", "mount")), null);
  assert.strictEqual(getCraftJournalSlug(item("T8_MEAL_PIE", null)), null);
});

// ── the ordinary gear lines keep their journal ──────────────────────────────

[
  ["T8_ARMOR_PLATE_SET1", "WARRIOR"],
  ["T8_HEAD_PLATE_UNDEAD", "WARRIOR"],
  ["T8_OFF_SHIELD", "WARRIOR"],
  ["T8_ARMOR_LEATHER_SET1", "HUNTER"],
  ["T8_2H_BOW", "HUNTER"],
  ["T8_OFF_TORCH", "HUNTER"],
  ["T8_ARMOR_CLOTH_SET1", "MAGE"],
  ["T8_MAIN_FIRESTAFF", "MAGE"],
].forEach(([id, slug]) => {
  test(`${id} still fills the ${slug} journal`, () => {
    assert.strictEqual(getCraftJournalSlug(item(id, null)), slug);
  });
});

// ── same tier only ──────────────────────────────────────────────────────────

test("a craft offers exactly one journal candidate, at its own tier", () => {
  const cands = getCraftPlannerJournalCandidates("WARRIOR", 8);
  assert.strictEqual(cands.length, 1);
  assert.strictEqual(cands[0].tier, 8);
  assert.strictEqual(cands[0].emptyId, "T8_JOURNAL_WARRIOR_EMPTY");
  assert.strictEqual(cands[0].fullId, "T8_JOURNAL_WARRIOR_FULL");
});

[2, 3, 4, 5, 6, 7, 8].forEach((tier) => {
  test(`a T${tier} craft is offered only the T${tier} journal`, () => {
    const cands = getCraftPlannerJournalCandidates("MAGE", tier);
    assert.deepStrictEqual(cands.map((c) => c.tier), [tier]);
    assert.strictEqual(cands[0].maxfame, CRAFT_JOURNAL_MAXFAME[tier]);
  });
});

test("a null slug or a tier with no journal offers nothing", () => {
  assert.deepStrictEqual(getCraftPlannerJournalCandidates(null, 8), []);
  assert.deepStrictEqual(getCraftPlannerJournalCandidates("MAGE", 1), []);
});

// ── maxfame straight from items.xml ─────────────────────────────────────────

test("maxfame matches items.xml, including the un-rounded T7/T8", () => {
  assert.deepStrictEqual(CRAFT_JOURNAL_MAXFAME, {
    2: 900, 3: 1800, 4: 3600, 5: 7200, 6: 14400, 7: 28380, 8: 58590,
  });
});

// ── crafts to fill ──────────────────────────────────────────────────────────
//
// The whole point of the column: one craft never fills a journal, so the
// journal's silver has to be split across the crafts it takes to fill it.

test("crafts-to-fill is maxfame ÷ fame per craft", () => {
  assert.strictEqual(getCraftsToFillJournal(0, 3600), 0);
  assert.strictEqual(getCraftsToFillJournal(180, 3600), 20);
  assert.strictEqual(getCraftsToFillJournal(3600, 3600), 1);
  // Rounding is deliberate: a partial craft still counts, so this stays
  // fractional rather than ceil()-ing and under-crediting the fill.
  assert.strictEqual(getCraftsToFillJournal(1000, 3600), 3.6);
});

test("crafts-to-fill of a real cape is a plausible handful, not one", () => {
  // T4 cape: 4 cloth + 4 leather = 8 non-artifact mats.
  const { getCraftingFamePerCraft } = require("../js/data-craft-planner.js");
  const fame = getCraftingFamePerCraft({ id: "T4_CAPE" }, 8, 0);
  const crafts = getCraftsToFillJournal(fame, CRAFT_JOURNAL_MAXFAME[4]);
  assert.ok(crafts > 1, `expected more than one craft per journal, got ${crafts}`);
  assert.ok(crafts < 200, `expected a sane craft count, got ${crafts}`);
});

test("getCraftJournalForItem reports the tier and maxfame together", () => {
  assert.deepStrictEqual(getCraftJournalForItem("T8_CAPE"), {
    slug: "TOOLMAKER", tier: 8, maxfame: 58590,
  });
  assert.strictEqual(getCraftJournalForItem("T8_CAPEITEM_AVALON"), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
