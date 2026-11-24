/**
 * Albion Market Application Main Controller
 * Binds data fetching to calculation logic and UI rendering.
 */

// Safe-route cities: 5 Royal Continent cities + Brecilien (reached via yellow Mists portals).
const ROYAL_CITIES = [
  "Lymhurst",
  "Fort Sterling",
  "Thetford",
  "Martlock",
  "Bridgewatch",
  "Brecilien",
];

// Black-zone markets. The Smuggler's Network shares ONE order book across all 35
// Smuggler's Dens and the 3 Outlands Rests, so it acts as a single market
// location. A den has a bank, the market, repair, an artifact foundry, a faction
// rep and a travel planner — but NO crafting stations, so it can never be a
// craft/refine city. It also sits deep in the black zone: with Black/Red Zone
// Routes off it is unreachable and drops out of every route (isInvalidCrossRoute).
// AODP publishes no prices for it, so its numbers come from manual price edits.
const BLACK_ZONE_CITIES = ["Smuggler's Den"];

// Cities you can craft/refine in.
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
// Cities you can buy in — every market.
const CITIES = [...CRAFT_CITIES, ...BLACK_ZONE_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];

// ITEM_NAMES_MAP lives in js/item-names.js (loaded before this file).

// --- Targeted Item Datasets ---
const CRAFTING_ITEMS = [
  {
    id: "T4_HEAD_CLOTH_SET1",
    name: "Scholar Cowl [T4]",
    matId: "T4_CLOTH",
    matCount: 8,
    craftType: "cloth_helmet",
    isGearRecipe: true,
  },
  {
    id: "T4_ARMOR_CLOTH_SET1",
    name: "Scholar Robe [T4]",
    matId: "T4_CLOTH",
    matCount: 16,
    craftType: "cloth_armor",
    isGearRecipe: true,
  },
  {
    id: "T4_SHOES_CLOTH_SET1",
    name: "Scholar Sandals [T4]",
    matId: "T4_CLOTH",
    matCount: 8,
    craftType: "cloth_shoes",
    isGearRecipe: true,
  },
  {
    id: "T4_ARMOR_CLOTH_SET1@1",
    name: "Scholar Robe [T4.1]",
    matId: "T4_CLOTH_LEVEL1@1",
    matCount: 16,
    craftType: "cloth_armor",
  },
  {
    id: "T4_ARMOR_CLOTH_SET1@2",
    name: "Scholar Robe [T4.2]",
    matId: "T4_CLOTH_LEVEL2@2",
    matCount: 16,
    craftType: "cloth_armor",
  },
  {
    id: "T4_ARMOR_CLOTH_SET1@3",
    name: "Scholar Robe [T4.3]",
    matId: "T4_CLOTH_LEVEL3@3",
    matCount: 16,
    craftType: "cloth_armor",
  },
  {
    id: "T8_ARMOR_PLATE_SET1",
    name: "Soldier Armor [T8]",
    matId: "T8_METALBAR",
    matCount: 16,
    craftType: "plate_armor",
  },
  {
    id: "T8_HEAD_LEATHER_SET1",
    name: "Mercenary Hood [T8]",
    matId: "T8_LEATHER",
    matCount: 8,
    craftType: "leather_helmet",
  },
  {
    id: "T8_ARMOR_GATHERER_WOOD",
    name: "Lumberjack Garb [T8]",
    matId: "T8_LEATHER",
    matCount: 16,
    craftType: null,
  },
  // ── Furniture ────────────────────────────────────────────
  // Furniture entries below list only their PRIMARY material. The full recipe
  // lives in BUNDLED_RECIPES (js/recipes.js) and is what every table renders,
  // via resolveItemRecipe (js/recipe-resolver.js) — cold cache included.
  // matId/matCount stay because they are the RECIPE FALLBACK when the bundled
  // recipe cache is cold (resolveItemRecipe, js/recipe-resolver.js). They used
  // to double as the Input Cost cell's override key; that cell is read-only now
  // (aggregateCostTd, js/app.js) because it shows a per-craft total, not a
  // per-unit price.
  // Tables (planks + cloth — full recipe in BUNDLED_RECIPES)
  {
    id: "T4_FURNITUREITEM_TABLE",
    name: "Adept's Table",
    matId: "T4_PLANKS",
    matCount: 30,
    craftType: null,
  },
  {
    id: "T5_FURNITUREITEM_TABLE",
    name: "Expert's Table",
    matId: "T5_PLANKS",
    matCount: 30,
    craftType: null,
  },
  {
    id: "T6_FURNITUREITEM_TABLE",
    name: "Master's Table",
    matId: "T6_PLANKS",
    matCount: 30,
    craftType: null,
  },
  {
    id: "T7_FURNITUREITEM_TABLE",
    name: "Grandmaster's Table",
    matId: "T7_PLANKS",
    matCount: 30,
    craftType: null,
  },
  {
    id: "T8_FURNITUREITEM_TABLE",
    name: "Elder's Table",
    matId: "T8_PLANKS",
    matCount: 30,
    craftType: null,
  },
  // Beds (planks + cloth — full recipe in BUNDLED_RECIPES)
  {
    id: "T4_FURNITUREITEM_BED",
    name: "Adept's Bed",
    matId: "T4_PLANKS",
    matCount: 10,
    craftType: null,
  },
  {
    id: "T5_FURNITUREITEM_BED",
    name: "Expert's Bed",
    matId: "T5_PLANKS",
    matCount: 10,
    craftType: null,
  },
  {
    id: "T6_FURNITUREITEM_BED",
    name: "Master's Bed",
    matId: "T6_PLANKS",
    matCount: 10,
    craftType: null,
  },
  {
    id: "T7_FURNITUREITEM_BED",
    name: "Grandmaster's Bed",
    matId: "T7_PLANKS",
    matCount: 10,
    craftType: null,
  },
  {
    id: "T8_FURNITUREITEM_BED",
    name: "Elder's Bed",
    matId: "T8_PLANKS",
    matCount: 10,
    craftType: null,
  },
  // Chests (planks + metal bars — full recipe in BUNDLED_RECIPES).
  // T2-T5 only: items.xml also carries T6-T8 chest ids, but they have no
  // localized name in the ao-bin-dumps EN-US dump and no craftingfocus, i.e.
  // they are leftover data, not in-game items — the market returns no prices.
  {
    id: "T2_FURNITUREITEM_CHEST",
    name: "Novice's Chest",
    matId: "T2_PLANKS",
    matCount: 20,
    craftType: null,
  },
  {
    id: "T3_FURNITUREITEM_CHEST",
    name: "Journeyman's Chest",
    matId: "T3_PLANKS",
    matCount: 20,
    craftType: null,
  },
  {
    id: "T4_FURNITUREITEM_CHEST",
    name: "Adept's Chest",
    matId: "T4_PLANKS",
    matCount: 20,
    craftType: null,
  },
  {
    id: "T5_FURNITUREITEM_CHEST",
    name: "Expert's Chest",
    matId: "T5_PLANKS",
    matCount: 20,
    craftType: null,
  },
  // Trophy Shark (shark + planks + metal bars — full recipe in BUNDLED_RECIPES).
  // The only craftable trophy, and a GENERAL one: +5 happiness to any laborer
  // type, up to 10 of them. The fisherman trophy (Swordfish) is journal-only.
  {
    id: "T8_FURNITUREITEM_TROPHY_FISHING_BOSS",
    name: "Trophy Shark",
    matId: "T8_FISH_SALTWATER_ALL_BOSS_SHARK",
    matCount: 1,
    craftType: null,
  },
  // ── Hideout Construction Kit ──────────────────────────────────────
  {
    id: "UNIQUE_HIDEOUT",
    name: "Hideout Construction Kit",
    materials: [
      { matId: "UNIQUE_GVGTOKEN_GENERIC", count: 500 },
      { matId: "T2_STONEBLOCK", count: 3000 },
      { matId: "T3_STONEBLOCK", count: 2000 },
      { matId: "T4_STONEBLOCK", count: 800 },
      { matId: "T5_STONEBLOCK", count: 400 },
      { matId: "T6_STONEBLOCK", count: 200 },
    ],
    silverCost: 10000000,
    craftType: null,
    noReturn: true,
    nutritionPerCraft: 190703,
  },
  // Repair Kits (planks + metal bars — full recipe in BUNDLED_RECIPES)
  {
    id: "T4_FURNITUREITEM_REPAIRKIT",
    name: "Adept's Repair Kit",
    matId: "T4_PLANKS",
    matCount: 8,
    craftType: null,
  },
  {
    id: "T5_FURNITUREITEM_REPAIRKIT",
    name: "Expert's Repair Kit",
    matId: "T5_PLANKS",
    matCount: 8,
    craftType: null,
  },
  {
    id: "T6_FURNITUREITEM_REPAIRKIT",
    name: "Master's Repair Kit",
    matId: "T6_PLANKS",
    matCount: 8,
    craftType: null,
  },
  {
    id: "T7_FURNITUREITEM_REPAIRKIT",
    name: "Grandmaster's Repair Kit",
    matId: "T7_PLANKS",
    matCount: 8,
    craftType: null,
  },
  {
    id: "T8_FURNITUREITEM_REPAIRKIT",
    name: "Elder's Repair Kit",
    matId: "T8_PLANKS",
    matCount: 8,
    craftType: null,
  },
];

const FLIPPING_ITEMS = [
  { id: "T4_MAIN_SWORD", name: "Broadsword [T4]" },
  { id: "T4_MAIN_SPEAR", name: "One-Handed Spear [T4]" },
  { id: "T4_2H_BOW", name: "Bow [T4]" },
  { id: "T4_2H_NATURESTAFF", name: "Nature Staff [T4]" },
  { id: "T8_MAIN_SWORD", name: "Broadsword [T8]" },
  { id: "T8_2H_BOW", name: "Bow [T8]" },
  { id: "T8_HEAD_GATHERER_FIBER", name: "Harvester Cap [T8]" },
  { id: "T8_ARMOR_GATHERER_FIBER", name: "Harvester Garb [T8]" },
  { id: "T8_SHOES_GATHERER_FIBER", name: "Harvester Workboots [T8]" },
  { id: "T4_RUNE", name: "Adept's Rune" },
  { id: "T5_RUNE", name: "Expert's Rune" },
  { id: "T6_RUNE", name: "Master's Rune" },
  { id: "T7_RUNE", name: "Grandmaster's Rune" },
  { id: "T8_RUNE", name: "Elder's Rune" },
  { id: "T4_SOUL", name: "Adept's Soul" },
  { id: "T5_SOUL", name: "Expert's Soul" },
  { id: "T6_SOUL", name: "Master's Soul" },
  { id: "T7_SOUL", name: "Grandmaster's Soul" },
  { id: "T8_SOUL", name: "Elder's Soul" },
  { id: "T4_RELIC", name: "Adept's Relic" },
  { id: "T5_RELIC", name: "Expert's Relic" },
  { id: "T6_RELIC", name: "Master's Relic" },
  { id: "T7_RELIC", name: "Grandmaster's Relic" },
  { id: "T8_RELIC", name: "Elder's Relic" },
  { id: "T4_SHARD_AVALONIAN", name: "Adept's Avalonian Shard" },
  { id: "T5_SHARD_AVALONIAN", name: "Expert's Avalonian Shard" },
  { id: "T6_SHARD_AVALONIAN", name: "Master's Avalonian Shard" },
  { id: "T7_SHARD_AVALONIAN", name: "Grandmaster's Avalonian Shard" },
  { id: "T8_SHARD_AVALONIAN", name: "Elder's Avalonian Shard" },
  { id: "T4_SHARD_CRYSTAL", name: "Adept's Crystal Shard" },
  { id: "T5_SHARD_CRYSTAL", name: "Expert's Crystal Shard" },
  { id: "T6_SHARD_CRYSTAL", name: "Master's Crystal Shard" },
  { id: "T7_SHARD_CRYSTAL", name: "Grandmaster's Crystal Shard" },
  { id: "T8_SHARD_CRYSTAL", name: "Elder's Crystal Shard" },
  { id: "T4_SHARD_FIRE_DRAGON", name: "Adept's Fire Dragon Scales" },
  { id: "T5_SHARD_FIRE_DRAGON", name: "Expert's Fire Dragon Scales" },
  { id: "T6_SHARD_FIRE_DRAGON", name: "Master's Fire Dragon Scales" },
  { id: "T7_SHARD_FIRE_DRAGON", name: "Grandmaster's Fire Dragon Scales" },
  { id: "T8_SHARD_FIRE_DRAGON", name: "Elder's Fire Dragon Scales" },
  // Tokens & Tomes
  { id: "UNIQUE_GVGTOKEN_GENERIC", name: "Siphoned Energy" },
  { id: "QUESTITEM_TOKEN_AVALON", name: "Avalonian Energy" },
  { id: "T4_SKILLBOOK_STANDARD", name: "Adept's Tome of Insight" },
  // Mounts
  { id: "T4_MOUNT_HORSE", name: "Riding Horse [T4]" },
  { id: "T5_MOUNT_HORSE", name: "Riding Horse [T5]" },
  { id: "T5_MOUNT_ARMORED_HORSE", name: "Armored Horse [T5]" },
  { id: "T8_MOUNT_HORSE", name: "Riding Horse [T8]" },
  { id: "T8_MOUNT_ARMORED_HORSE", name: "Armored Horse [T8]" },
  { id: "T4_MOUNT_OX", name: "Transport Ox [T4]" },
  { id: "T5_MOUNT_OX", name: "Transport Ox [T5]" },
  { id: "T8_MOUNT_OX", name: "Transport Ox [T8]" },
  // Journals
  { id: "T4_JOURNAL_MERCENARY_FULL", name: "Mercenary's Journal (Full) [T4]" },
  { id: "T5_JOURNAL_MERCENARY_FULL", name: "Mercenary's Journal (Full) [T5]" },
  {
    id: "T4_JOURNAL_MERCENARY_EMPTY",
    name: "Mercenary's Journal (Empty) [T4]",
  },
  {
    id: "T5_JOURNAL_MERCENARY_EMPTY",
    name: "Mercenary's Journal (Empty) [T5]",
  },
  // Furniture
  { id: "T4_FURNITUREITEM_BED", name: "Adept's Bed" },
  { id: "T5_FURNITUREITEM_BED", name: "Expert's Bed" },
  { id: "T6_FURNITUREITEM_BED", name: "Master's Bed" },
  { id: "T7_FURNITUREITEM_BED", name: "Grandmaster's Bed" },
  { id: "T8_FURNITUREITEM_BED", name: "Elder's Bed" },
  { id: "T2_FURNITUREITEM_CHEST", name: "Novice's Chest" },
  { id: "T3_FURNITUREITEM_CHEST", name: "Journeyman's Chest" },
  { id: "T4_FURNITUREITEM_CHEST", name: "Adept's Chest" },
  { id: "T5_FURNITUREITEM_CHEST", name: "Expert's Chest" },
  { id: "T4_FURNITUREITEM_TABLE", name: "Adept's Table" },
  { id: "T5_FURNITUREITEM_TABLE", name: "Expert's Table" },
  { id: "T6_FURNITUREITEM_TABLE", name: "Master's Table" },
  { id: "T7_FURNITUREITEM_TABLE", name: "Grandmaster's Table" },
  { id: "T8_FURNITUREITEM_TABLE", name: "Elder's Table" },
  { id: "T4_FURNITUREITEM_REPAIRKIT", name: "Adept's Repair Kit" },
  { id: "T5_FURNITUREITEM_REPAIRKIT", name: "Expert's Repair Kit" },
  { id: "T6_FURNITUREITEM_REPAIRKIT", name: "Master's Repair Kit" },
  { id: "T7_FURNITUREITEM_REPAIRKIT", name: "Grandmaster's Repair Kit" },
  { id: "T8_FURNITUREITEM_REPAIRKIT", name: "Elder's Repair Kit" },
  // Dungeon Maps - Solo
  { id: "T4_RANDOM_DUNGEON_SOLO_TOKEN_1", name: "Solo Map (Normal) [T4]" },
  { id: "T5_RANDOM_DUNGEON_SOLO_TOKEN_1", name: "Solo Map (Normal) [T5]" },
  { id: "T6_RANDOM_DUNGEON_SOLO_TOKEN_1", name: "Solo Map (Normal) [T6]" },
  { id: "T7_RANDOM_DUNGEON_SOLO_TOKEN_1", name: "Solo Map (Normal) [T7]" },
  { id: "T8_RANDOM_DUNGEON_SOLO_TOKEN_1", name: "Solo Map (Normal) [T8]" },
  { id: "T4_RANDOM_DUNGEON_SOLO_TOKEN_2", name: "Solo Map (Uncommon) [T4]" },
  { id: "T5_RANDOM_DUNGEON_SOLO_TOKEN_2", name: "Solo Map (Uncommon) [T5]" },
  { id: "T6_RANDOM_DUNGEON_SOLO_TOKEN_2", name: "Solo Map (Uncommon) [T6]" },
  { id: "T7_RANDOM_DUNGEON_SOLO_TOKEN_2", name: "Solo Map (Uncommon) [T7]" },
  { id: "T8_RANDOM_DUNGEON_SOLO_TOKEN_2", name: "Solo Map (Uncommon) [T8]" },
  // Dungeon Maps - Group
  { id: "T4_RANDOM_DUNGEON_TOKEN_1", name: "Group Map (Normal) [T4]" },
  { id: "T5_RANDOM_DUNGEON_TOKEN_1", name: "Group Map (Normal) [T5]" },
  { id: "T6_RANDOM_DUNGEON_TOKEN_1", name: "Group Map (Normal) [T6]" },
  { id: "T7_RANDOM_DUNGEON_TOKEN_1", name: "Group Map (Normal) [T7]" },
  { id: "T8_RANDOM_DUNGEON_TOKEN_1", name: "Group Map (Normal) [T8]" },
  // Dungeon Maps - Elite/Avalonian
  { id: "T6_RANDOM_DUNGEON_ELITE_TOKEN_1", name: "Avalonian Map (Normal) [T6]" },
  { id: "T7_RANDOM_DUNGEON_ELITE_TOKEN_1", name: "Avalonian Map (Normal) [T7]" },
  { id: "T8_RANDOM_DUNGEON_ELITE_TOKEN_1", name: "Avalonian Map (Normal) [T8]" },
  // Skins
  { id: "UNIQUE_MOUNT_PUPPY_DIREWOLF", name: "Direwolf Pup" },
  { id: "UNIQUE_MOUNT_PUPPY_SWAMPDRAGON", name: "Swamp Dragon Pup" },
  // Fish
  { id: "T5_FISH_FRESHWATER_ALL_COMMON", name: "Spotted Trout [T5]" },
  { id: "T7_FISH_FRESHWATER_ALL_COMMON", name: "Deadwater Eel [T7]" },
  { id: "T8_FISH_FRESHWATER_ALL_RARE", name: "Dusthole Crab [T8]" },
  { id: "T7_FISH_BOSSFISH_ALBION", name: "Kraken [T7 Boss]" },
  { id: "T3_FISHCHOPS", name: "Chopped Fish" },
  // Crystallized items — drop-only from Conquerors' Challenge Chests.
  // Substitutes for Rune/Soul/Relic/Avalonian Shard in enchanting recipes.
  { id: "T4_ARTEFACT_TOKEN_FAVOR_1", name: "Adept's Crystallized Spirit" },
  { id: "T5_ARTEFACT_TOKEN_FAVOR_1", name: "Expert's Crystallized Spirit" },
  { id: "T6_ARTEFACT_TOKEN_FAVOR_1", name: "Master's Crystallized Spirit" },
  { id: "T7_ARTEFACT_TOKEN_FAVOR_1", name: "Grandmaster's Crystallized Spirit" },
  { id: "T8_ARTEFACT_TOKEN_FAVOR_1", name: "Elder's Crystallized Spirit" },
  { id: "T4_ARTEFACT_TOKEN_FAVOR_2", name: "Adept's Crystallized Dread" },
  { id: "T5_ARTEFACT_TOKEN_FAVOR_2", name: "Expert's Crystallized Dread" },
  { id: "T6_ARTEFACT_TOKEN_FAVOR_2", name: "Master's Crystallized Dread" },
  { id: "T7_ARTEFACT_TOKEN_FAVOR_2", name: "Grandmaster's Crystallized Dread" },
  { id: "T8_ARTEFACT_TOKEN_FAVOR_2", name: "Elder's Crystallized Dread" },
  { id: "T4_ARTEFACT_TOKEN_FAVOR_3", name: "Adept's Crystallized Magic" },
  { id: "T5_ARTEFACT_TOKEN_FAVOR_3", name: "Expert's Crystallized Magic" },
  { id: "T6_ARTEFACT_TOKEN_FAVOR_3", name: "Master's Crystallized Magic" },
  { id: "T7_ARTEFACT_TOKEN_FAVOR_3", name: "Grandmaster's Crystallized Magic" },
  { id: "T8_ARTEFACT_TOKEN_FAVOR_3", name: "Elder's Crystallized Magic" },
  { id: "T4_ARTEFACT_TOKEN_FAVOR_4", name: "Adept's Crystallized Divinity" },
  { id: "T5_ARTEFACT_TOKEN_FAVOR_4", name: "Expert's Crystallized Divinity" },
  { id: "T6_ARTEFACT_TOKEN_FAVOR_4", name: "Master's Crystallized Divinity" },
  { id: "T7_ARTEFACT_TOKEN_FAVOR_4", name: "Grandmaster's Crystallized Divinity" },
  { id: "T8_ARTEFACT_TOKEN_FAVOR_4", name: "Elder's Crystallized Divinity" },
];

// Dynamic artifact flip items — built after ARTIFACT_MAPPING is defined (line ~640)
// We populate this array later once ARTIFACT_MAPPING is available.
const ARTIFACT_FLIP_ITEMS = [];

function buildArtifactFlipItems() {
  const tierNames = {
    4: "Adept's",
    5: "Expert's",
    6: "Master's",
    7: "Grandmaster's",
    8: "Elder's",
  };
  const added = new Set();
  for (let t = 4; t <= 8; t++) {
    Object.entries(ARTIFACT_MAPPING).forEach(([suffix, info]) => {
      const id = `T${t}_ARTEFACT_${suffix}`;
      if (!added.has(id)) {
        added.add(id);
        const tierName = tierNames[t] || `T${t}`;
        const subcatLabel = info.subcat.replace(/_/g, " ");
        const displayName =
          info.name || `${info.category} ${subcatLabel} Artifact`;
        ARTIFACT_FLIP_ITEMS.push({
          id,
          name: `${tierName} ${displayName}`,
          isArtifact: true,
        });
      }
    });
  }
}

// Tier tuple: [tier, rawName, refinedName, rawRatio]. The names are kept for
// documentation only — resources display via resourceShortName ("6.1 planks");
// see js/resource-names.js. rawRatio is the raw count per refine (T2=1, T3=2,
// T4=2, T5=3, T6=4, T7=5, T8=5); T2 refines from raw alone (no lower refined).
const RESOURCE_DEFS = [
  {
    type: "wood", raw: "WOOD", refined: "PLANKS",
    tiers: [
      [2, "Birch Logs", "Birch Planks", 1], [3, "Chestnut Logs", "Chestnut Planks", 2],
      [4, "Pine Logs", "Pine Planks", 2], [5, "Cedar Logs", "Cedar Planks", 3], [6, "Bloodoak Logs", "Bloodoak Planks", 4],
      [7, "Ashenbark Logs", "Ashenbark Planks", 5], [8, "Whitewood Logs", "Whitewood Planks", 5],
    ],
  },
  {
    type: "ore", raw: "ORE", refined: "METALBAR",
    tiers: [
      [2, "Copper Ore", "Copper Bar", 1], [3, "Tin Ore", "Bronze Bar", 2],
      [4, "Iron Ore", "Iron Bar", 2], [5, "Titanium Ore", "Titanium Bar", 3], [6, "Runite Ore", "Runite Bar", 4],
      [7, "Meteorite Ore", "Meteorite Bar", 5], [8, "Adamantium Ore", "Adamantium Bar", 5],
    ],
  },
  {
    type: "hide", raw: "HIDE", refined: "LEATHER",
    tiers: [
      [2, "Rugged Hide", "Stiff Leather", 1], [3, "Thin Hide", "Thick Leather", 2],
      [4, "Medium Hide", "Worked Leather", 2], [5, "Heavy Hide", "Cured Leather", 3], [6, "Robust Hide", "Hardened Leather", 4],
      [7, "Thick Hide", "Reinforced Leather", 5], [8, "Robust Hide", "Fortified Leather", 5],
    ],
  },
  {
    type: "fiber", raw: "FIBER", refined: "CLOTH",
    tiers: [
      [2, "Cotton", "Simple Cloth", 1], [3, "Flax", "Neat Cloth", 2],
      [4, "Hemp", "Simple Cloth", 2], [5, "Skyflower", "Neat Cloth", 3], [6, "Amberleaf Cotton", "Fine Cloth", 4],
      [7, "Sunflax", "Ornate Cloth", 5], [8, "Ghost Hemp", "Royal Cloth", 5],
    ],
  },
  {
    type: "rock", raw: "ROCK", refined: "STONEBLOCK",
    tiers: [
      [2, "Limestone", "Limestone Block", 1], [3, "Sandstone", "Sandstone Block", 2],
      [4, "Travertine", "Travertine Block", 2], [5, "Granite", "Granite Block", 3], [6, "Slate", "Slate Block", 4],
      [7, "Basalt", "Basalt Block", 5], [8, "Marble", "Marble Block", 5],
    ],
  },
];

// Enchanted raw/refined resources exist only from T4 up; T2/T3 are plain-only.
const MIN_RESOURCE_ENCHANT_TIER = 4;

// Stone is the only family whose REFINED product has no enchanted version — there
// is no enchanted stoneblock in-game (items.xml: STONEBLOCK is enchantmentlevel=0
// at every tier; enchanted raw rock refines into PLAIN blocks). The RAW rock,
// however, does enchant and trades (T*_ROCK_LEVELn@n) — but only up to .3, since
// no pristine (.4) rock exists. See [[project_stone_no_enchant]].
const NON_ENCHANTABLE_REFINED_TYPES = new Set(["rock"]);

// Top enchant level (0 = plain only) for a family's RAW resource at a tier: 4
// from T4 up, but 3 for stone (no pristine rock).
function rawMaxEnchant(type, tier) {
  if (tier < MIN_RESOURCE_ENCHANT_TIER) return 0;
  return type === "rock" ? 3 : 4;
}

// Same for the REFINED product: 4 from T4 up, but always 0 for stoneblock.
function refinedMaxEnchant(type, tier) {
  if (NON_ENCHANTABLE_REFINED_TYPES.has(type)) return 0;
  return tier >= MIN_RESOURCE_ENCHANT_TIER ? 4 : 0;
}

const RESOURCE_FLIP_ITEMS = [];

function buildResourceFlipItems() {
  RESOURCE_DEFS.forEach(({ type, raw, refined, tiers }) => {
    tiers.forEach(([tier]) => {
      // Plain-only below T4. Raw rock enchants to .3; refined stoneblock stays
      // flat (no enchanted block exists) — so the two sides cap independently.
      const rawEnch = rawMaxEnchant(type, tier);
      const refEnch = refinedMaxEnchant(type, tier);
      for (let ench = 0; ench <= Math.max(rawEnch, refEnch); ench++) {
        const suffix = ench ? `_LEVEL${ench}@${ench}` : "";
        if (ench <= rawEnch) {
          const rawId = `T${tier}_${raw}${suffix}`;
          RESOURCE_FLIP_ITEMS.push({ id: rawId, name: resourceShortName(rawId) });
        }
        if (ench <= refEnch) {
          const refinedId = `T${tier}_${refined}${suffix}`;
          RESOURCE_FLIP_ITEMS.push({ id: refinedId, name: resourceShortName(refinedId) });
        }
      }
    });
  });
}

// One refining row per resource tier × enchant. The displayed row label comes
// from getItemDisplayName(refinedId) ("6.1 planks"); no name is stored here.
// Low-tier specifics: T2/T3 have no enchant variants, and T2 refines from raw
// alone (no lower refined product as secondary).
const TRANSPORT_ITEMS = RESOURCE_DEFS.flatMap(({ type, raw, refined, tiers }) =>
  tiers.flatMap(([tier, , , rawRatio]) => {
    const prevTier = tier - 1;
    // Refining produces the refined product, so cap on the refined side: stone
    // blocks never enchant (enchanted raw rock refines into plain blocks).
    const maxEnch = refinedMaxEnchant(type, tier);
    const hasSecondary = tier >= 3;
    return Array.from({ length: maxEnch + 1 }, (_unused, ench) => {
      const suffix = ench ? `_LEVEL${ench}@${ench}` : "";
      // T4.X consumes plain T3; T5+.X inherits the enchant on its secondary.
      const secondarySuffix = (ench && prevTier >= 4) ? `_LEVEL${ench}@${ench}` : "";
      return {
        rawId: `T${tier}_${raw}${suffix}`,
        refinedId: `T${tier}_${refined}${suffix}`,
        rawRatio,
        resourceType: type,
        secondaryMatId: hasSecondary ? `T${prevTier}_${refined}${secondarySuffix}` : null,
        secondaryMatCount: hasSecondary ? 1 : 0,
      };
    });
  })
);

// Stone-only alt-sourcing rows: enchanted RAW rock refines into PLAIN blocks
// (there is no enchanted stone block). In-game one refine of `rawRatio` enchanted
// rock + 2^e lower plain blocks yields 2^e plain blocks — wiki Granite Block:
// Uncommon/Rare/Exceptional Granite → 2/4/8 Granite Block. Normalized to the
// table's per-1-output basis, each output block consumes rawRatio/2^e enchanted
// rock + 1 lower plain block (and 1/2^e of a refine's focus, applied in
// render-transport.js via outputPerRefine). These sit BESIDE the plain-rock row
// for the same T{tier}_STONEBLOCK so a refiner sees when buying enchanted rock
// beats plain rock per block. Enchant .1–.3 only (no pristine rock); the
// enchanted-rock recipe has NO faction-heart variant (heart is plain-rock only).
// See [[project_stone_no_enchant]].
(function buildEnchantedRockRefineRows() {
  const rockDef = RESOURCE_DEFS.find((d) => d.type === "rock");
  if (!rockDef) return;
  rockDef.tiers.forEach(([tier, , , rawRatio]) => {
    if (tier < MIN_RESOURCE_ENCHANT_TIER) return; // enchanted rock is T4+ only
    const prevTier = tier - 1; // ≥3, so a plain lower block always exists
    for (let ench = 1; ench <= rawMaxEnchant("rock", tier); ench++) {
      const yieldPer = Math.pow(2, ench);
      TRANSPORT_ITEMS.push({
        rawId: `T${tier}_ROCK_LEVEL${ench}@${ench}`,
        refinedId: `T${tier}_STONEBLOCK`,       // plain block — the sold good
        rawRatio: rawRatio / yieldPer,           // enchanted rock per 1 output block
        resourceType: "rock",
        secondaryMatId: `T${prevTier}_STONEBLOCK`,
        secondaryMatCount: 1,
        outputPerRefine: yieldPer,               // 2^e plain blocks per refine action
        enchantedRaw: ench,                      // .1–.3 raw-rock source marker
      });
    }
  });
})();
