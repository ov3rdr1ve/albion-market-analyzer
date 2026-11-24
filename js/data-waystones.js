/**
 * Dragon Sanctuary Waystones — Artifact Foundry (fragments → raid key).
 *
 * Dragonfire, 2026-08-31. A Waystone opens a Dragon Sanctuary for a raid of up
 * to twenty players. Twelve exist: tiers T6/T7/T8 × four difficulties D1–D4,
 * which items.xml carries as enchantment levels 1–4 — so the marketplace ids
 * end in @1…@4 and the in-game names read "…", "Uncommon …", "Rare …",
 * "Exceptional …". Both the Waystones and their fragments are tradeable.
 *
 * Kept out of js/data-maps.js on purpose. That file is the SOUL-crafted
 * dungeon and hellgate maps, and all three of its defining quirks — a flat
 * silver fee, a soul as the input, a station fee derived from itemvalue — are
 * different here: a Waystone melds from shards, charges no silver, and has no
 * itemvalue at all, so it pays no station fee either. What the two families do
 * share is that souls and fragments are never refunded (maxreturnamount="0")
 * and neither craft costs focus.
 *
 * ── which route is priced ──
 * items.xml gives every Waystone THREE alternative craft blocks:
 *
 *   1. fragments only            100 / 300 / 900 / 2700 for D1 / D2 / D3 / D4
 *   2. 3 × the same tier's D(n−1)                       (D2 upward)
 *   3. 3 × the tier below at the same difficulty        (T7 and T8 only)
 *
 * Only route 1 is priced here. Which of the three is actually cheapest depends
 * entirely on live prices — a Waystone one rung down can be underpriced
 * relative to the fragments that would make it — and picking a winner is the
 * Craft Planner's job, not a catalog's. Pricing route 1 keeps the row honest:
 * it is the route that always exists and never depends on another Waystone
 * being on the market.
 *
 * Names drop the game's trailing "(Large Group)" — every Dragon Sanctuary is a
 * raid, so the parenthetical distinguishes nothing and only costs column width.
 */

// Fragments burned per difficulty step, from the fragment-only craft block.
const WAYSTONE_FRAGMENTS_FOR_DIFFICULTY = { 1: 100, 2: 300, 3: 900, 4: 2700 };
const WAYSTONE_TIERS = [6, 7, 8];
const WAYSTONE_DIFFICULTIES = [1, 2, 3, 4];
// Tier word and difficulty prefix, matching the EN-US strings in the dump.
const WAYSTONE_TIER_WORD = { 6: "Master's", 7: "Grandmaster's", 8: "Elder's" };
const WAYSTONE_QUALITY_WORD = { 1: "", 2: "Uncommon ", 3: "Rare ", 4: "Exceptional " };

const WAYSTONE_FRAGMENT_IDS = WAYSTONE_TIERS.map(
  (tier) => `T${tier}_SHARD_RANDOM_DUNGEON_ELITE_DRAGON_TOKEN`,
);

const WAYSTONES = WAYSTONE_TIERS.flatMap((tier) =>
  WAYSTONE_DIFFICULTIES.map((diff) => ({
    // The difficulty IS the enchantment level, so the marketplace id needs the
    // @n suffix — without it every difficulty would price as the same item.
    id: `T${tier}_RANDOM_DUNGEON_ELITE_DRAGON_TOKEN_D${diff}@${diff}`,
    name: `${WAYSTONE_QUALITY_WORD[diff]}${WAYSTONE_TIER_WORD[tier]} Dragon Sanctuary Waystone [T${tier}]`,
    craftType: null,
    materials: [
      {
        matId: `T${tier}_SHARD_RANDOM_DUNGEON_ELITE_DRAGON_TOKEN`,
        count: WAYSTONE_FRAGMENTS_FOR_DIFFICULTY[diff],
      },
    ],
    // The @n suffix here is a DIFFICULTY, not an enchant of some base row —
    // there is no T{n}_…_D1 item to nest under, and each difficulty has its
    // own recipe. Without this flag the enchant-variant collapse in
    // js/sorting.js would hide all twelve rows forever.
    topLevelVariant: true,
    silverCost: 0,
    noReturn: true,
    // No itemvalue in the dump ⇒ no station usage fee to charge.
    nutritionPerCraft: 0,
  })),
);

/**
 * Append every Waystone to a crafting catalog (CRAFTING_ITEMS), skipping ids
 * that are already present. Safe to call twice. Mirrors injectCraftableMaps.
 */
function injectWaystones(craftingItems) {
  if (!Array.isArray(craftingItems)) return craftingItems;
  const existing = new Set(craftingItems.map((i) => i.id));
  WAYSTONES.forEach((w) => {
    if (!existing.has(w.id)) craftingItems.push({ ...w });
  });
  return craftingItems;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { WAYSTONES, WAYSTONE_FRAGMENT_IDS, injectWaystones };
}
