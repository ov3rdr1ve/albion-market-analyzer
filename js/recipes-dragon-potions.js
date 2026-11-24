/**
 * Dragonfire potions — Bundled Recipes (alchemy)
 *
 * One family so far: the Lifeward Potion, added by the Dragonfire update
 * (2026-08-31). It works like the seven rare-animal-remains potions — an
 * artifact ingredient plus ordinary herbs — but the ingredient is Dragon Blood,
 * a drop from Drakes and Dragons rather than a tracked creature's remains:
 *
 *   Lifeward (POTION_LIFEWARD) — Dragon Blood (Drake/Dragon)  T4/T6/T8
 *
 * Counts are the per-craft-action <craftresource> values verbatim from the live
 * ao-bin-dumps items.xml (2026-08-31) — same convention as recipes.js. Dragon
 * Blood has maxreturnamount="0" in-game (never refunded by the city Resource
 * Return Rate), so it carries noReturn:true; the renderer skips the RRR
 * multiplier for it (render-consumables.js). Herbs, agaric and alcohol are
 * returnable as usual. The .1/.2/.3 enchant upgrade material (Basic/Refined/
 * Pure Arcane Extract, T1_ALCHEMY_EXTRACT_LEVEL{N}) is appended by the variant
 * generator from ENCHANT_UPGRADE_SAUCE, not listed here.
 *
 * Its own file rather than an append to recipes-rare-potions.js: the
 * ingredient comes from a different activity (Ancient Lands / Dragon Attacks,
 * not Tracking), and the Dragonfire line will grow.
 *
 * MUST load after js/recipes.js (it merges into that file's BUNDLED_RECIPES).
 */
const DRAGON_POTION_RECIPES = {
  // ── Lifeward Potion (revives allies on a fatal blow) — Dragon Blood ──
  T4_POTION_LIFEWARD: [
    { matId: "T4_ALCHEMY_RARE_DRAGONAREA", count: 1, noReturn: true },
    { matId: "T4_BURDOCK", count: 16 },
  ],
  T6_POTION_LIFEWARD: [
    { matId: "T6_ALCHEMY_RARE_DRAGONAREA", count: 1, noReturn: true },
    { matId: "T6_FOXGLOVE", count: 48 },
    { matId: "T5_TEASEL", count: 24 },
    { matId: "T2_AGARIC", count: 12 },
  ],
  T8_POTION_LIFEWARD: [
    { matId: "T8_ALCHEMY_RARE_DRAGONAREA", count: 1, noReturn: true },
    { matId: "T8_YARROW", count: 144 },
    { matId: "T7_MULLEIN", count: 72 },
    { matId: "T5_TEASEL", count: 72 },
    { matId: "T2_AGARIC", count: 36 },
    { matId: "T8_ALCOHOL", count: 36 },
  ],
};

// Merge into the main recipe table (declared in js/recipes.js, shared across
// classic <script> tags via the global lexical scope).
if (typeof BUNDLED_RECIPES !== "undefined") {
  Object.assign(BUNDLED_RECIPES, DRAGON_POTION_RECIPES);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { DRAGON_POTION_RECIPES };
}
