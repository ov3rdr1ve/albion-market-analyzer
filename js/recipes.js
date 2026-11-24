/**
 * Albion Online Consumable Recipes — Bundled Data
 *
 * The browser can't read gameinfo.albiononline.com (CORS), so consumable
 * (meal/potion) recipes are bundled here. These were ORIGINALLY copied from the
 * gameinfo API and drifted out of date (e.g. Resistance potions listed rock,
 * meals used fake T3_BREAD/T4_FLOUR ids) — they have since been reconciled to
 * items.xml, the same source the focus/sauce extractors use.
 *
 * SOURCE OF TRUTH = items.xml (<consumableitem> base craftingrequirements).
 * Do NOT re-sync these from gameinfo. tests/consumable-recipes-match-itemsxml
 * asserts every CONSUMABLES recipe (ingredients, counts, noReturn) matches
 * items.xml, so any drift fails CI. After an items.xml drop, run that test and
 * correct anything it flags. Enchant upgrade sauces are appended by the variant
 * generator from ENCHANT_UPGRADE_SAUCE, not listed here.
 *
 * tests/recipe-catalogs-match-itemsxml covers the REST of this file — the
 * furniture and fish-sauce entries the consumable test never reached — plus
 * GEAR_RECIPES_ALL, MOUNT_RECIPES and the resolved CRAFTING_ITEMS. It also
 * fails on any key whose id does not exist in items.xml, which is how 43
 * invented wrong-tier meal/potion entries (T5_MEAL_STEW, T4_POTION_POISON, ...)
 * were finally removed. Do not re-add a recipe without checking the id exists.
 */

const BUNDLED_RECIPES = {
  // ═══════════════════════════════════════════
  //  MEALS — STEW (Damage buff)
  // ═══════════════════════════════════════════
  T4_MEAL_STEW: [
    { matId: "T4_TURNIP", count: 4 },
    { matId: "T4_BREAD", count: 4 },
    { matId: "T4_MEAT", count: 8 },
  ],
  T6_MEAL_STEW: [
    { matId: "T6_POTATO", count: 12 },
    { matId: "T4_BREAD", count: 12 },
    { matId: "T6_MEAT", count: 24 },
  ],
  T8_MEAL_STEW: [
    { matId: "T8_PUMPKIN", count: 36 },
    { matId: "T4_BREAD", count: 36 },
    { matId: "T8_MEAT", count: 72 },
  ],

  // ═══════════════════════════════════════════
  //  MEALS — ROAST (Lifesteal buff)
  // ═══════════════════════════════════════════
  T3_MEAL_ROAST: [
    { matId: "T3_MEAT", count: 8 },
    { matId: "T2_BEAN", count: 4 },
    { matId: "T4_MILK", count: 4 },
  ],
  T5_MEAL_ROAST: [
    { matId: "T5_MEAT", count: 24 },
    { matId: "T5_CABBAGE", count: 12 },
    { matId: "T6_MILK", count: 12 },
  ],
  T7_MEAL_ROAST: [
    { matId: "T7_MEAT", count: 72 },
    { matId: "T7_CORN", count: 36 },
    { matId: "T8_MILK", count: 36 },
  ],

  // ═══════════════════════════════════════════
  //  MEALS — OMELETTE (Cast Speed + CDR buff)
  // ═══════════════════════════════════════════
  T3_MEAL_OMELETTE: [
    { matId: "T3_WHEAT", count: 4 },
    { matId: "T3_MEAT", count: 8 },
    { matId: "T3_EGG", count: 2 },
  ],
  T5_MEAL_OMELETTE: [
    { matId: "T5_CABBAGE", count: 12 },
    { matId: "T5_MEAT", count: 24 },
    { matId: "T5_EGG", count: 6 },
  ],
  T7_MEAL_OMELETTE: [
    { matId: "T7_CORN", count: 36 },
    { matId: "T7_MEAT", count: 72 },
    { matId: "T5_EGG", count: 18 },
  ],

  // ═══════════════════════════════════════════
  //  MEALS — SANDWICH (Max HP + Healing buff)
  // ═══════════════════════════════════════════
  T4_MEAL_SANDWICH: [
    { matId: "T4_BREAD", count: 4 },
    { matId: "T4_MEAT", count: 8 },
    { matId: "T4_BUTTER", count: 2 },
  ],
  T6_MEAL_SANDWICH: [
    { matId: "T4_BREAD", count: 12 },
    { matId: "T6_MEAT", count: 24 },
    { matId: "T6_BUTTER", count: 6 },
  ],
  T8_MEAL_SANDWICH: [
    { matId: "T4_BREAD", count: 36 },
    { matId: "T8_MEAT", count: 72 },
    { matId: "T8_BUTTER", count: 18 },
  ],

  // ═══════════════════════════════════════════
  //  MEALS — SOUP (Healing received buff)
  // ═══════════════════════════════════════════
  T1_MEAL_SOUP: [
    { matId: "T1_CARROT", count: 16 },
  ],
  T3_MEAL_SOUP: [
    { matId: "T3_WHEAT", count: 48 },
  ],
  T5_MEAL_SOUP: [
    { matId: "T5_CABBAGE", count: 144 },
  ],

  // ═══════════════════════════════════════════
  //  MEALS — SALAD (Craft Speed / Quality buff)
  // ═══════════════════════════════════════════
  T4_MEAL_SALAD: [
    { matId: "T4_TURNIP", count: 24 },
    { matId: "T3_WHEAT", count: 24 },
  ],
  T6_MEAL_SALAD: [
    { matId: "T6_POTATO", count: 72 },
    { matId: "T5_CABBAGE", count: 72 },
  ],

  // ═══════════════════════════════════════════
  //  MEALS — PIE (Gathering Yield + Max Load buff)
  // ═══════════════════════════════════════════
  T3_MEAL_PIE: [
    { matId: "T3_WHEAT", count: 2 },
    { matId: "T3_FLOUR", count: 4 },
    { matId: "T3_MEAT", count: 8 },
  ],
  T5_MEAL_PIE: [
    { matId: "T5_CABBAGE", count: 6 },
    { matId: "T3_FLOUR", count: 12 },
    { matId: "T5_MEAT", count: 24 },
    { matId: "T4_MILK", count: 6 },
  ],
  T7_MEAL_PIE: [
    { matId: "T7_CORN", count: 18 },
    { matId: "T3_FLOUR", count: 36 },
    { matId: "T7_MEAT", count: 72 },
    { matId: "T6_MILK", count: 18 },
  ],

  // ═══════════════════════════════════════════
  //  POTIONS — STONESKIN / RESISTANCE
  // ═══════════════════════════════════════════
  T3_POTION_STONESKIN: [
    { matId: "T3_COMFREY", count: 8 },
  ],
  T5_POTION_STONESKIN: [
    { matId: "T5_TEASEL", count: 24 },
    { matId: "T4_BURDOCK", count: 12 },
    { matId: "T4_MILK", count: 6 },
  ],
  T7_POTION_STONESKIN: [
    { matId: "T7_MULLEIN", count: 72 },
    { matId: "T6_FOXGLOVE", count: 36 },
    { matId: "T4_BURDOCK", count: 36 },
    { matId: "T6_MILK", count: 18 },
    { matId: "T7_ALCOHOL", count: 18 },
  ],

  // ═══════════════════════════════════════════
  //  POTIONS — HEAL
  // ═══════════════════════════════════════════
  T4_POTION_HEAL: [
    { matId: "T4_BURDOCK", count: 24 },
    { matId: "T3_EGG", count: 6 },
  ],
  T6_POTION_HEAL: [
    { matId: "T6_FOXGLOVE", count: 72 },
    { matId: "T5_EGG", count: 18 },
    { matId: "T6_ALCOHOL", count: 18 },
  ],

  // ═══════════════════════════════════════════
  //  POTIONS — ENERGY
  // ═══════════════════════════════════════════
  T4_POTION_ENERGY: [
    { matId: "T4_BURDOCK", count: 24 },
    { matId: "T4_MILK", count: 6 },
  ],
  T6_POTION_ENERGY: [
    { matId: "T6_FOXGLOVE", count: 72 },
    { matId: "T6_MILK", count: 18 },
    { matId: "T6_ALCOHOL", count: 18 },
  ],

  // ═══════════════════════════════════════════
  //  POTIONS — POISON
  // ═══════════════════════════════════════════

  // ═══════════════════════════════════════════
  //  POTIONS — REVIVE / GIGANTIFY
  // ═══════════════════════════════════════════
  T3_POTION_REVIVE: [
    { matId: "T3_COMFREY", count: 8 },
  ],
  T5_POTION_REVIVE: [
    { matId: "T5_TEASEL", count: 24 },
    { matId: "T4_BURDOCK", count: 12 },
    { matId: "T5_EGG", count: 6 },
  ],
  T7_POTION_REVIVE: [
    { matId: "T7_MULLEIN", count: 72 },
    { matId: "T6_FOXGLOVE", count: 36 },
    { matId: "T5_EGG", count: 18 },
    { matId: "T7_ALCOHOL", count: 18 },
  ],

  // ── Furniture ─────────────────────────────────────────────
  // Beds: 10 planks + 20 cloth
  T4_FURNITUREITEM_BED: [{ matId: "T4_PLANKS", count: 10 }, { matId: "T4_CLOTH", count: 20 }],
  T5_FURNITUREITEM_BED: [{ matId: "T5_PLANKS", count: 10 }, { matId: "T5_CLOTH", count: 20 }],
  T6_FURNITUREITEM_BED: [{ matId: "T6_PLANKS", count: 10 }, { matId: "T6_CLOTH", count: 20 }],
  T7_FURNITUREITEM_BED: [{ matId: "T7_PLANKS", count: 10 }, { matId: "T7_CLOTH", count: 20 }],
  T8_FURNITUREITEM_BED: [{ matId: "T8_PLANKS", count: 10 }, { matId: "T8_CLOTH", count: 20 }],
  // ═══════════════════════════════════════════
  //  MEALS — SALAD (Crafting Speed buff) — T2 only; T4-T8 already above
  // ═══════════════════════════════════════════
  T2_MEAL_SALAD: [
    { matId: "T2_BEAN", count: 8 },
    { matId: "T1_CARROT", count: 8 },
  ],

  // ═══════════════════════════════════════════
  //  FISH MEALS — SOUP FISH (Health Regen)
  // ═══════════════════════════════════════════
  T1_MEAL_SOUP_FISH: [
    { matId: "T3_FISH_FRESHWATER_SWAMP_RARE", count: 1 },
    { matId: "T1_CARROT", count: 2 },
  ],
  T3_MEAL_SOUP_FISH: [
    { matId: "T5_FISH_FRESHWATER_SWAMP_RARE", count: 1 },
    { matId: "T3_WHEAT", count: 2 },
    { matId: "T3_COMFREY", count: 2 },
    { matId: "T3_MEAT", count: 2 },
  ],
  T5_MEAL_SOUP_FISH: [
    { matId: "T7_FISH_FRESHWATER_SWAMP_RARE", count: 1 },
    { matId: "T5_CABBAGE", count: 6 },
    { matId: "T5_TEASEL", count: 6 },
    { matId: "T5_MEAT", count: 6 },
  ],

  // ═══════════════════════════════════════════
  //  FISH MEALS — SALAD FISH (Crafting Speed)
  // ═══════════════════════════════════════════
  T2_MEAL_SALAD_FISH: [
    { matId: "T3_FISH_SALTWATER_ALL_RARE", count: 1 },
    { matId: "T2_BEAN", count: 1 },
    { matId: "T2_AGARIC", count: 1 },
  ],
  T4_MEAL_SALAD_FISH: [
    { matId: "T5_FISH_SALTWATER_ALL_RARE", count: 1 },
    { matId: "T4_TURNIP", count: 2 },
    { matId: "T4_BURDOCK", count: 2 },
    { matId: "T4_MEAT", count: 2 },
  ],
  T6_MEAL_SALAD_FISH: [
    { matId: "T7_FISH_SALTWATER_ALL_RARE", count: 1 },
    { matId: "T6_POTATO", count: 6 },
    { matId: "T6_FOXGLOVE", count: 6 },
    { matId: "T6_MEAT", count: 6 },
  ],

  // ═══════════════════════════════════════════
  //  FISH MEALS — PIE FISH (Gathering Yield)
  // ═══════════════════════════════════════════
  T3_MEAL_PIE_FISH: [
    { matId: "T3_FISH_FRESHWATER_MOUNTAIN_RARE", count: 1 },
    { matId: "T3_FLOUR", count: 1 },
    { matId: "T3_EGG", count: 1 },
  ],
  T5_MEAL_PIE_FISH: [
    { matId: "T5_FISH_FRESHWATER_MOUNTAIN_RARE", count: 1 },
    { matId: "T5_CABBAGE", count: 2 },
    { matId: "T5_TEASEL", count: 2 },
    { matId: "T5_EGG", count: 2 },
  ],
  T7_MEAL_PIE_FISH: [
    { matId: "T7_FISH_FRESHWATER_MOUNTAIN_RARE", count: 1 },
    { matId: "T7_CORN", count: 6 },
    { matId: "T7_MULLEIN", count: 6 },
    { matId: "T7_MEAT", count: 6 },
  ],

  // ═══════════════════════════════════════════
  //  FISH MEALS — OMELETTE FISH (Cast Speed)
  // ═══════════════════════════════════════════
  T3_MEAL_OMELETTE_FISH: [
    { matId: "T3_FISH_FRESHWATER_STEPPE_RARE", count: 1 },
    { matId: "T3_COMFREY", count: 1 },
    { matId: "T3_EGG", count: 1 },
  ],
  T5_MEAL_OMELETTE_FISH: [
    { matId: "T5_FISH_FRESHWATER_STEPPE_RARE", count: 1 },
    { matId: "T5_CABBAGE", count: 2 },
    { matId: "T5_TEASEL", count: 2 },
    { matId: "T5_EGG", count: 2 },
  ],
  T7_MEAL_OMELETTE_FISH: [
    { matId: "T7_FISH_FRESHWATER_STEPPE_RARE", count: 1 },
    { matId: "T7_CORN", count: 6 },
    { matId: "T7_MULLEIN", count: 6 },
    { matId: "T7_MEAT", count: 6 },
  ],

  // ═══════════════════════════════════════════
  //  FISH MEALS — LEYFIN OMELETTE (Cast Speed + CDR + heal bonus)
  //  Dragonfire, 2026-08-31. The leyfin is an ordinary ingredient — it takes
  //  normal RRR, unlike the artifact ingredients in the potion lines.
  // ═══════════════════════════════════════════
  T3_MEAL_OMELETTE_DRAGONAREA: [
    { matId: "T3_FISH_FRESHWATER_DRAGON_AREA_RARE", count: 1 },
    { matId: "T4_MILK", count: 1 },
    { matId: "T3_COMFREY", count: 1 },
    { matId: "T3_EGG", count: 1 },
  ],
  T5_MEAL_OMELETTE_DRAGONAREA: [
    { matId: "T5_FISH_FRESHWATER_DRAGON_AREA_RARE", count: 1 },
    { matId: "T6_MILK", count: 2 },
    { matId: "T5_TEASEL", count: 2 },
    { matId: "T5_EGG", count: 2 },
  ],
  T7_MEAL_OMELETTE_DRAGONAREA: [
    { matId: "T7_FISH_FRESHWATER_DRAGON_AREA_RARE", count: 1 },
    { matId: "T7_MULLEIN", count: 6 },
    { matId: "T5_TEASEL", count: 6 },
    { matId: "T5_EGG", count: 6 },
  ],

  // ═══════════════════════════════════════════
  //  FISH MEALS — STEW FISH (Damage)
  // ═══════════════════════════════════════════
  T4_MEAL_STEW_FISH: [
    { matId: "T3_FISH_FRESHWATER_FOREST_RARE", count: 1 },
    { matId: "T4_TURNIP", count: 1 },
    { matId: "T4_BURDOCK", count: 1 },
  ],
  T6_MEAL_STEW_FISH: [
    { matId: "T5_FISH_FRESHWATER_FOREST_RARE", count: 1 },
    { matId: "T6_POTATO", count: 2 },
    { matId: "T6_FOXGLOVE", count: 2 },
    { matId: "T6_MILK", count: 2 },
  ],
  T8_MEAL_STEW_FISH: [
    { matId: "T7_FISH_FRESHWATER_FOREST_RARE", count: 1 },
    { matId: "T8_PUMPKIN", count: 6 },
    { matId: "T8_YARROW", count: 6 },
    { matId: "T8_MILK", count: 6 },
  ],

  // ═══════════════════════════════════════════
  //  FISH MEALS — SANDWICH FISH (Max HP)
  // ═══════════════════════════════════════════
  T4_MEAL_SANDWICH_FISH: [
    { matId: "T3_FISH_FRESHWATER_HIGHLANDS_RARE", count: 1 },
    { matId: "T4_TURNIP", count: 1 },
    { matId: "T4_BUTTER", count: 1 },
  ],
  T6_MEAL_SANDWICH_FISH: [
    { matId: "T5_FISH_FRESHWATER_HIGHLANDS_RARE", count: 1 },
    { matId: "T6_POTATO", count: 2 },
    { matId: "T6_FOXGLOVE", count: 2 },
    { matId: "T6_BUTTER", count: 2 },
  ],
  T8_MEAL_SANDWICH_FISH: [
    { matId: "T7_FISH_FRESHWATER_HIGHLANDS_RARE", count: 1 },
    { matId: "T8_PUMPKIN", count: 6 },
    { matId: "T8_YARROW", count: 6 },
    { matId: "T8_BUTTER", count: 6 },
  ],

  // ═══════════════════════════════════════════
  //  FISH MEALS — ROAST FISH (Lifesteal)
  // ═══════════════════════════════════════════
  T3_MEAL_ROAST_FISH: [
    { matId: "T3_FISH_FRESHWATER_AVALON_RARE", count: 1 },
    { matId: "T3_COMFREY", count: 1 },
    { matId: "T4_MILK", count: 1 },
  ],
  T5_MEAL_ROAST_FISH: [
    { matId: "T5_FISH_FRESHWATER_AVALON_RARE", count: 1 },
    { matId: "T5_CABBAGE", count: 2 },
    { matId: "T5_TEASEL", count: 2 },
    { matId: "T6_MILK", count: 2 },
  ],
  T7_MEAL_ROAST_FISH: [
    { matId: "T7_FISH_FRESHWATER_AVALON_RARE", count: 1 },
    { matId: "T7_CORN", count: 6 },
    { matId: "T7_MULLEIN", count: 6 },
    { matId: "T8_MILK", count: 6 },
  ],

  // ═══════════════════════════════════════════
  //  AVALONIAN MEALS — OMELETTE AVALON (Cast Speed)
  // ═══════════════════════════════════════════
  T3_MEAL_OMELETTE_AVALON: [
    { matId: "T4_MILK", count: 4 },
    { matId: "T3_MEAT", count: 8 },
    { matId: "T3_EGG", count: 2 },
    { matId: "QUESTITEM_TOKEN_AVALON", count: 10, noReturn: true },
  ],
  T5_MEAL_OMELETTE_AVALON: [
    { matId: "T6_MILK", count: 12 },
    { matId: "T5_MEAT", count: 24 },
    { matId: "T5_EGG", count: 6 },
    { matId: "QUESTITEM_TOKEN_AVALON", count: 30, noReturn: true },
  ],
  T7_MEAL_OMELETTE_AVALON: [
    { matId: "T8_MILK", count: 36 },
    { matId: "T7_MEAT", count: 72 },
    { matId: "T5_EGG", count: 18 },
    { matId: "QUESTITEM_TOKEN_AVALON", count: 90, noReturn: true },
  ],

  // ═══════════════════════════════════════════
  //  AVALONIAN MEALS — STEW AVALON (Damage)
  // ═══════════════════════════════════════════
  T4_MEAL_STEW_AVALON: [
    { matId: "T1_CARROT", count: 4 },
    { matId: "T4_TURNIP", count: 4 },
    { matId: "T4_MEAT", count: 8 },
    { matId: "QUESTITEM_TOKEN_AVALON", count: 10, noReturn: true },
  ],
  T6_MEAL_STEW_AVALON: [
    { matId: "T5_CABBAGE", count: 12 },
    { matId: "T6_POTATO", count: 12 },
    { matId: "T6_MEAT", count: 24 },
    { matId: "QUESTITEM_TOKEN_AVALON", count: 30, noReturn: true },
  ],
  T8_MEAL_STEW_AVALON: [
    { matId: "T7_CORN", count: 36 },
    { matId: "T8_PUMPKIN", count: 36 },
    { matId: "T8_MEAT", count: 72 },
    { matId: "QUESTITEM_TOKEN_AVALON", count: 90, noReturn: true },
  ],

  // ═══════════════════════════════════════════
  //  AVALONIAN MEALS — SANDWICH AVALON (Max HP)
  // ═══════════════════════════════════════════
  T4_MEAL_SANDWICH_AVALON: [
    { matId: "T4_BREAD", count: 4 },
    { matId: "T4_MEAT", count: 8 },
    { matId: "T4_BUTTER", count: 2 },
    { matId: "QUESTITEM_TOKEN_AVALON", count: 10, noReturn: true },
  ],
  T6_MEAL_SANDWICH_AVALON: [
    { matId: "T4_BREAD", count: 12 },
    { matId: "T6_MEAT", count: 24 },
    { matId: "T6_BUTTER", count: 6 },
    { matId: "QUESTITEM_TOKEN_AVALON", count: 30, noReturn: true },
  ],
  T8_MEAL_SANDWICH_AVALON: [
    { matId: "T4_BREAD", count: 36 },
    { matId: "T8_MEAT", count: 72 },
    { matId: "T8_BUTTER", count: 18 },
    { matId: "QUESTITEM_TOKEN_AVALON", count: 90, noReturn: true },
  ],

  // ═══════════════════════════════════════════
  //  POTIONS — STICKY (AOE Slow)
  // ═══════════════════════════════════════════
  T3_POTION_SLOWFIELD: [
    { matId: "T3_COMFREY", count: 8 },
  ],
  T5_POTION_SLOWFIELD: [
    { matId: "T5_TEASEL", count: 24 },
    { matId: "T4_BURDOCK", count: 12 },
    { matId: "T5_EGG", count: 6 },
  ],
  T7_POTION_SLOWFIELD: [
    { matId: "T7_MULLEIN", count: 72 },
    { matId: "T6_FOXGLOVE", count: 36 },
    { matId: "T4_BURDOCK", count: 36 },
    { matId: "T5_EGG", count: 18 },
    { matId: "T7_ALCOHOL", count: 18 },
  ],

  // ═══════════════════════════════════════════
  //  POTIONS — COOLDOWN (Poison)
  // ═══════════════════════════════════════════
  T4_POTION_COOLDOWN: [
    { matId: "T4_BURDOCK", count: 8 },
    { matId: "T3_COMFREY", count: 4 },
  ],
  T6_POTION_COOLDOWN: [
    { matId: "T6_FOXGLOVE", count: 24 },
    { matId: "T5_TEASEL", count: 12 },
    { matId: "T3_COMFREY", count: 12 },
    { matId: "T6_MILK", count: 6 },
  ],
  T8_POTION_COOLDOWN: [
    { matId: "T8_YARROW", count: 72 },
    { matId: "T7_MULLEIN", count: 36 },
    { matId: "T5_TEASEL", count: 36 },
    { matId: "T8_MILK", count: 18 },
    { matId: "T8_ALCOHOL", count: 18 },
  ],

  // ═══════════════════════════════════════════
  //  POTIONS — CLEANSING
  // ═══════════════════════════════════════════
  T8_POTION_CLEANSE: [
    { matId: "T8_YARROW", count: 72 },
    { matId: "T7_MULLEIN", count: 36 },
    { matId: "T5_TEASEL", count: 36 },
    { matId: "T8_MILK", count: 18 },
    { matId: "T8_ALCOHOL", count: 18 },
  ],

  // ═══════════════════════════════════════════
  //  FURNITURE
  // ═══════════════════════════════════════════
  // Tables: 30 planks + 30 cloth
  T4_FURNITUREITEM_TABLE: [{ matId: "T4_PLANKS", count: 30 }, { matId: "T4_CLOTH", count: 30 }],
  T5_FURNITUREITEM_TABLE: [{ matId: "T5_PLANKS", count: 30 }, { matId: "T5_CLOTH", count: 30 }],
  T6_FURNITUREITEM_TABLE: [{ matId: "T6_PLANKS", count: 30 }, { matId: "T6_CLOTH", count: 30 }],
  T7_FURNITUREITEM_TABLE: [{ matId: "T7_PLANKS", count: 30 }, { matId: "T7_CLOTH", count: 30 }],
  T8_FURNITUREITEM_TABLE: [{ matId: "T8_PLANKS", count: 30 }, { matId: "T8_CLOTH", count: 30 }],
  // Chests: 20 planks + 10 metal bars
  T2_FURNITUREITEM_CHEST: [{ matId: "T2_PLANKS", count: 20 }, { matId: "T2_METALBAR", count: 10 }],
  T3_FURNITUREITEM_CHEST: [{ matId: "T3_PLANKS", count: 20 }, { matId: "T3_METALBAR", count: 10 }],
  T4_FURNITUREITEM_CHEST: [{ matId: "T4_PLANKS", count: 20 }, { matId: "T4_METALBAR", count: 10 }],
  T5_FURNITUREITEM_CHEST: [{ matId: "T5_PLANKS", count: 20 }, { matId: "T5_METALBAR", count: 10 }],
  // Repair Kits: 8 planks + 8 metal bars
  // Trophy Shark — the one craftable trophy. Helps EVERY laborer type (+5
  // happiness for up to 10 of them); the fisherman trophy is the journal-only
  // Swordfish Trophy. Zero focus, one per craft.
  T8_FURNITUREITEM_TROPHY_FISHING_BOSS: [
    { matId: "T8_FISH_SALTWATER_ALL_BOSS_SHARK", count: 1 },
    { matId: "T8_PLANKS", count: 4 },
    { matId: "T8_METALBAR", count: 2 },
  ],

  T4_FURNITUREITEM_REPAIRKIT: [{ matId: "T4_PLANKS", count: 8 }, { matId: "T4_METALBAR", count: 8 }],
  T5_FURNITUREITEM_REPAIRKIT: [{ matId: "T5_PLANKS", count: 8 }, { matId: "T5_METALBAR", count: 8 }],
  T6_FURNITUREITEM_REPAIRKIT: [{ matId: "T6_PLANKS", count: 8 }, { matId: "T6_METALBAR", count: 8 }],
  T7_FURNITUREITEM_REPAIRKIT: [{ matId: "T7_PLANKS", count: 8 }, { matId: "T7_METALBAR", count: 8 }],
  T8_FURNITUREITEM_REPAIRKIT: [{ matId: "T8_PLANKS", count: 8 }, { matId: "T8_METALBAR", count: 8 }],

  // ═══════════════════════════════════════════
  //  GRILLED FISH / SEAWEED SALAD (T1 simple fish meals)
  // ═══════════════════════════════════════════
  // Source: items.xml:3904-3913. Cooked at the Cook station, T1 only, single
  // ingredient each. Unlike fish sauce, these are regular food crafts — the
  // craftresource has no maxreturnamount="0", so the input takes normal RRR
  // (no noReturn flag). T1_FISHCHOPS resolves through the chain machinery
  // (CHAIN_RECIPES["T1_FISHCHOPS"]) for the butcher-from-fish comparison.
  T1_MEAL_GRILLEDFISH: [{ matId: "T1_FISHCHOPS", count: 10 }],
  T1_MEAL_SEAWEEDSALAD: [{ matId: "T1_SEAWEED", count: 10 }],

  // ═══════════════════════════════════════════
  //  SPECIAL FOOD — DRAKE EGG BISCUITS (T8)
  // ═══════════════════════════════════════════
  // Dragonfire, 2026-08-31. Cooked at the Cook station from a whole Firewing
  // Drake Egg — a Kennel animal, so the egg (not the dairy) is the row's cost.
  // No focus and no enchant ladder, and one craft action yields NINETY-NINE
  // biscuits: the per-unit cost only comes out right because
  // js/consumable-output.js carries that 99 (see the amountcrafted rule).
  // Nothing is pinned noReturn — items.xml gives no line maxreturnamount="0".
  T8_MEAL_SPECIAL_FOOD_DRAKE_EGG: [
    { matId: "T3_FLOUR", count: 36 },
    { matId: "T8_BUTTER", count: 12 },
    { matId: "T8_MILK", count: 24 },
    { matId: "T8_FARM_DRAKE_BABY", count: 1 },
  ],

  // ═══════════════════════════════════════════
  //  FISHING BAIT (T1 / T3 / T5)
  // ═══════════════════════════════════════════
  // Source: items.xml:3888-3902. Cooked at the Cook station; only three tiers
  // exist (T1/T3/T5) and all three are made purely from T1_WORM (1 / 5 / 25).
  // Not focus-craftable (no craftingfocus attr) and the worm takes normal RRR
  // (no maxreturnamount="0").
  T1_FISHINGBAIT: [{ matId: "T1_WORM", count: 1 }],
  T3_FISHINGBAIT: [{ matId: "T1_WORM", count: 5 }],
  T5_FISHINGBAIT: [{ matId: "T1_WORM", count: 25 }],

  // ═══════════════════════════════════════════
  //  FISH SAUCE (T4+ meal enchant upgrade material)
  // ═══════════════════════════════════════════
  // Source: items.xml:1318-1335 — <simpleitem> entries for the three rarity
  // tiers. Cooked at the Cook station; no NPC silver fee, not focus-craftable,
  // `amountcrafted` default = 1. Fish sauce has NO resource return rate —
  // every chop and seaweed is fully consumed (verified against wiki and
  // confirmed by the user). Both ingredients carry noReturn:true so the
  // renderer's RRR multiplier at render-consumables.js:670 is skipped.
  T1_FISHSAUCE_LEVEL1: [
    { matId: "T1_FISHCHOPS", count: 15, noReturn: true },
    { matId: "T1_SEAWEED",   count: 1,  noReturn: true },
  ],
  T1_FISHSAUCE_LEVEL2: [
    { matId: "T1_FISHCHOPS", count: 45, noReturn: true },
    { matId: "T1_SEAWEED",   count: 3,  noReturn: true },
  ],
  T1_FISHSAUCE_LEVEL3: [
    { matId: "T1_FISHCHOPS", count: 135, noReturn: true },
    { matId: "T1_SEAWEED",   count: 9,   noReturn: true },
  ],
};
