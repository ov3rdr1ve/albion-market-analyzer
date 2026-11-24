/**
 * Rare-animal-remains potions — Bundled Recipes (alchemy)
 *
 * Seven potion families that each consume one tracked-creature's rare remains
 * (a Shapeshifter "Rare Animal Remains" drop). These were added to Albion in
 * 2024–2025 patches and are absent from the legacy recipe dump in recipes.js,
 * so they live in their own module (keeps recipes.js under the 800-line cap and
 * groups the alchemy-artifact line in one place).
 *
 *   Calming   (POTION_MOB_RESET) — Shadow Claws    (Panther)   T3/T5/T7
 *   Cleansing (POTION_CLEANSE2)  — Sylvian Root     (Ent)       T3/T5/T7
 *   Acid      (POTION_ACID)      — Spirit Paws      (Direbear)  T3/T5/T7
 *   Berserk   (POTION_BERSERK)   — Werewolf Fangs   (Werewolf)  T4/T6/T8
 *   Gathering (POTION_GATHER)    — Runestone Tooth  (Elemental) T4/T6/T8
 *   Hellfire  (POTION_LAVA)      — Imp's Horn       (Imp)       T4/T6/T8
 *   Tornado   (POTION_TORNADO)   — Dawnfeather      (Eagle)     T4/T6/T8
 *
 * Counts are the per-craft-action <craftresource> values verbatim from the
 * live ao-bin-dumps items.xml (2026-06-05) — same convention as recipes.js.
 * The rare remain has maxreturnamount="0" in-game (never refunded by the city
 * Resource Return Rate), so it carries noReturn:true; the renderer skips the
 * RRR multiplier for it (render-consumables.js). Herbs/dairy/alcohol/agaric are
 * returnable as usual. The .1/.2/.3 enchant upgrade material (Basic/Refined/
 * Pure Arcane Extract, T1_ALCHEMY_EXTRACT_LEVEL{N}) is appended by the variant
 * generator from ENCHANT_UPGRADE_SAUCE, not listed here.
 *
 * MUST load after js/recipes.js (it merges into that file's BUNDLED_RECIPES).
 */
const RARE_REMAINS_POTION_RECIPES = {
  // ── Calming Potion (invisible to mobs + shield) — Shadow Claws / Panther ──
  T3_POTION_MOB_RESET: [
    { matId: "T3_ALCHEMY_RARE_PANTHER", count: 1, noReturn: true },
    { matId: "T3_COMFREY", count: 16 },
  ],
  T5_POTION_MOB_RESET: [
    { matId: "T5_ALCHEMY_RARE_PANTHER", count: 1, noReturn: true },
    { matId: "T5_TEASEL", count: 48 },
    { matId: "T4_BURDOCK", count: 24 },
    { matId: "T2_AGARIC", count: 12 },
  ],
  T7_POTION_MOB_RESET: [
    { matId: "T7_ALCHEMY_RARE_PANTHER", count: 1, noReturn: true },
    { matId: "T7_MULLEIN", count: 144 },
    { matId: "T6_FOXGLOVE", count: 72 },
    { matId: "T3_COMFREY", count: 72 },
    { matId: "T2_AGARIC", count: 36 },
    { matId: "T7_ALCOHOL", count: 36 },
  ],

  // ── Cleansing Potion (purge) — Sylvian Root / Ent ──
  T3_POTION_CLEANSE2: [
    { matId: "T3_ALCHEMY_RARE_ENT", count: 1, noReturn: true },
    { matId: "T3_COMFREY", count: 16 },
  ],
  T5_POTION_CLEANSE2: [
    { matId: "T5_ALCHEMY_RARE_ENT", count: 1, noReturn: true },
    { matId: "T5_TEASEL", count: 48 },
    { matId: "T3_COMFREY", count: 24 },
    { matId: "T4_BUTTER", count: 12 },
  ],
  T7_POTION_CLEANSE2: [
    { matId: "T7_ALCHEMY_RARE_ENT", count: 1, noReturn: true },
    { matId: "T7_MULLEIN", count: 144 },
    { matId: "T4_BURDOCK", count: 72 },
    { matId: "T3_COMFREY", count: 72 },
    { matId: "T6_BUTTER", count: 36 },
    { matId: "T7_ALCOHOL", count: 36 },
  ],

  // ── Acid Potion (-resistances) — Spirit Paws / Direbear ──
  T3_POTION_ACID: [
    { matId: "T3_ALCHEMY_RARE_DIREBEAR", count: 1, noReturn: true },
    { matId: "T3_COMFREY", count: 16 },
  ],
  T5_POTION_ACID: [
    { matId: "T5_ALCHEMY_RARE_DIREBEAR", count: 1, noReturn: true },
    { matId: "T5_TEASEL", count: 48 },
    { matId: "T4_BURDOCK", count: 24 },
    { matId: "T4_MILK", count: 12 },
  ],
  T7_POTION_ACID: [
    { matId: "T7_ALCHEMY_RARE_DIREBEAR", count: 1, noReturn: true },
    { matId: "T7_MULLEIN", count: 144 },
    { matId: "T6_FOXGLOVE", count: 72 },
    { matId: "T6_ALCOHOL", count: 72 },
    { matId: "T6_MILK", count: 36 },
    { matId: "T7_ALCOHOL", count: 36 },
  ],

  // ── Berserk Potion (+damage) — Werewolf Fangs / Werewolf ──
  T4_POTION_BERSERK: [
    { matId: "T3_ALCHEMY_RARE_WEREWOLF", count: 1, noReturn: true },
    { matId: "T4_BURDOCK", count: 16 },
  ],
  T6_POTION_BERSERK: [
    { matId: "T5_ALCHEMY_RARE_WEREWOLF", count: 1, noReturn: true },
    { matId: "T6_FOXGLOVE", count: 48 },
    { matId: "T2_AGARIC", count: 24 },
    { matId: "T6_ALCOHOL", count: 12 },
  ],
  T8_POTION_BERSERK: [
    { matId: "T7_ALCHEMY_RARE_WEREWOLF", count: 1, noReturn: true },
    { matId: "T8_YARROW", count: 144 },
    { matId: "T3_COMFREY", count: 72 },
    { matId: "T6_ALCOHOL", count: 72 },
    { matId: "T7_ALCOHOL", count: 36 },
    { matId: "T8_ALCOHOL", count: 36 },
  ],

  // ── Gathering Potion (+gather yield) — Runestone Tooth / Elemental ──
  T4_POTION_GATHER: [
    { matId: "T3_ALCHEMY_RARE_ELEMENTAL", count: 1, noReturn: true },
    { matId: "T4_BUTTER", count: 16 },
  ],
  T6_POTION_GATHER: [
    { matId: "T5_ALCHEMY_RARE_ELEMENTAL", count: 1, noReturn: true },
    { matId: "T6_BUTTER", count: 48 },
    { matId: "T6_FOXGLOVE", count: 24 },
    { matId: "T5_TEASEL", count: 12 },
  ],
  T8_POTION_GATHER: [
    { matId: "T7_ALCHEMY_RARE_ELEMENTAL", count: 1, noReturn: true },
    { matId: "T8_BUTTER", count: 144 },
    { matId: "T8_YARROW", count: 72 },
    { matId: "T7_MULLEIN", count: 72 },
    { matId: "T6_FOXGLOVE", count: 36 },
    { matId: "T8_ALCOHOL", count: 36 },
  ],

  // ── Hellfire Potion (AoE fire) — Imp's Horn / Imp (internal id LAVA) ──
  T4_POTION_LAVA: [
    { matId: "T3_ALCHEMY_RARE_IMP", count: 1, noReturn: true },
    { matId: "T4_MILK", count: 16 },
  ],
  T6_POTION_LAVA: [
    { matId: "T5_ALCHEMY_RARE_IMP", count: 1, noReturn: true },
    { matId: "T6_MILK", count: 48 },
    { matId: "T6_FOXGLOVE", count: 24 },
    { matId: "T3_EGG", count: 12 },
  ],
  T8_POTION_LAVA: [
    { matId: "T7_ALCHEMY_RARE_IMP", count: 1, noReturn: true },
    { matId: "T8_MILK", count: 144 },
    { matId: "T8_YARROW", count: 72 },
    { matId: "T7_MULLEIN", count: 72 },
    { matId: "T5_EGG", count: 36 },
    { matId: "T8_ALCOHOL", count: 36 },
  ],

  // ── Tornado in a Bottle (knockback) — Dawnfeather / Eagle ──
  T4_POTION_TORNADO: [
    { matId: "T3_ALCHEMY_RARE_EAGLE", count: 1, noReturn: true },
    { matId: "T4_BURDOCK", count: 16 },
  ],
  T6_POTION_TORNADO: [
    { matId: "T5_ALCHEMY_RARE_EAGLE", count: 1, noReturn: true },
    { matId: "T6_FOXGLOVE", count: 48 },
    { matId: "T5_TEASEL", count: 24 },
    { matId: "T3_EGG", count: 12 },
  ],
  T8_POTION_TORNADO: [
    { matId: "T7_ALCHEMY_RARE_EAGLE", count: 1, noReturn: true },
    { matId: "T8_YARROW", count: 144 },
    { matId: "T7_MULLEIN", count: 72 },
    { matId: "T7_ALCOHOL", count: 72 },
    { matId: "T5_EGG", count: 36 },
    { matId: "T8_ALCOHOL", count: 36 },
  ],
};

// Merge into the main recipe table (declared in js/recipes.js, shared across
// classic <script> tags via the global lexical scope).
if (typeof BUNDLED_RECIPES !== "undefined") {
  Object.assign(BUNDLED_RECIPES, RARE_REMAINS_POTION_RECIPES);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { RARE_REMAINS_POTION_RECIPES };
}
