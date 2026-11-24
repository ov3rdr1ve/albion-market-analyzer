/**
 * Item display-name lookup table.
 *
 * Maps raw Albion game item ids (UniqueName) to human-readable English names.
 * getItemDisplayName() (js/utils.js) consults this map FIRST, so any id present
 * here renders with its real in-game name instead of the raw slug.
 *
 * Extracted from js/data.js to keep that file under the 800-line limit.
 * MUST load before js/utils.js and any render-*.js (see index.html).
 */
const ITEM_NAMES_MAP = {
  // Raw materials T1
  T1_HIDE: "T1 Scraps of Hide",
  T1_ROCK: "T1 Rough Stone",
  T1_WOOD: "T1 Rough Logs",

  // Raw materials T2
  T2_WOOD: "T2 Birch Logs",
  T2_ROCK: "T2 Limestone",
  T2_ORE: "T2 Copper Ore",
  T2_HIDE: "T2 Rugged Hide",
  T2_FIBER: "T2 Cotton",

  // Raw materials T3
  T3_WOOD: "T3 Chestnut Logs",
  T3_ROCK: "T3 Sandstone",
  T3_ORE: "T3 Tin Ore",
  T3_HIDE: "T3 Thin Hide",
  T3_FIBER: "T3 Flax",

  // Refined materials T2
  T2_PLANKS: "T2 Birch Planks",
  T2_STONEBLOCK: "T2 Limestone Block",
  T2_METALBAR: "T2 Copper Bar",
  T2_LEATHER: "T2 Stiff Leather",
  T2_CLOTH: "T2 Simple Cloth",

  // Misc crafting ingredients
  T6_JOURNAL_TOOLMAKER_EMPTY: "Master Tinker's Journal (Empty)",
  T4_SKILLBOOK_STANDARD: "Adept's Tome of Insight",
  // Non-tradable Tomes of Insight (combat fame books) — the T8 is sold for Favor
  // at the Energy Manipulator (Faction Spending table). Named for display since
  // getItemDisplayName has no rule for the SKILLBOOK_NONTRADABLE family.
  T4_SKILLBOOK_NONTRADABLE: "Adept's Tome of Insight",
  T5_SKILLBOOK_NONTRADABLE: "Expert's Tome of Insight",
  T6_SKILLBOOK_NONTRADABLE: "Master's Tome of Insight",
  T7_SKILLBOOK_NONTRADABLE: "Grandmaster's Tome of Insight",
  T8_SKILLBOOK_NONTRADABLE: "Elder's Tome of Insight",

  // Rare creature remains — shapeshifter staff crafting (Tracking drops, T3/T5/T7)
  // Werewolf Fangs (Bloodmoon Staff)
  T3_ALCHEMY_RARE_WEREWOLF: "Rugged Werewolf Fangs",
  T5_ALCHEMY_RARE_WEREWOLF: "Fine Werewolf Fangs",
  T7_ALCHEMY_RARE_WEREWOLF: "Excellent Werewolf Fangs",
  // Shadow Claws (Prowling Staff / Panther)
  T3_ALCHEMY_RARE_PANTHER: "Rugged Shadow Claws",
  T5_ALCHEMY_RARE_PANTHER: "Fine Shadow Claws",
  T7_ALCHEMY_RARE_PANTHER: "Excellent Shadow Claws",
  // Sylvian Root (Rootbound Staff / Ent)
  T3_ALCHEMY_RARE_ENT: "Rugged Sylvian Root",
  T5_ALCHEMY_RARE_ENT: "Fine Sylvian Root",
  T7_ALCHEMY_RARE_ENT: "Excellent Sylvian Root",
  // Spirit Paws (Primal Staff / Direbear)
  T3_ALCHEMY_RARE_DIREBEAR: "Rugged Spirit Paws",
  T5_ALCHEMY_RARE_DIREBEAR: "Fine Spirit Paws",
  T7_ALCHEMY_RARE_DIREBEAR: "Excellent Spirit Paws",
  // Imp's Horn (Hellspawn Staff)
  T3_ALCHEMY_RARE_IMP: "Rugged Imp's Horn",
  T5_ALCHEMY_RARE_IMP: "Fine Imp's Horn",
  T7_ALCHEMY_RARE_IMP: "Excellent Imp's Horn",
  // Runestone Tooth (Earthrune Staff / Stone Golem)
  T3_ALCHEMY_RARE_ELEMENTAL: "Rugged Runestone Tooth",
  T5_ALCHEMY_RARE_ELEMENTAL: "Fine Runestone Tooth",
  T7_ALCHEMY_RARE_ELEMENTAL: "Excellent Runestone Tooth",
  // Dawnfeather (Lightcaller / Dawnbird)
  T3_ALCHEMY_RARE_EAGLE: "Rugged Dawnfeather",
  T5_ALCHEMY_RARE_EAGLE: "Fine Dawnfeather",
  T7_ALCHEMY_RARE_EAGLE: "Excellent Dawnfeather",

  // Rare / Tracking potions — consume the rare remains above (Minor/…/Major).
  // Internal ids differ from the in-game names (Calming=MOB_RESET,
  // Cleansing=CLEANSE2, Hellfire=LAVA, Tornado=TORNADO).
  T3_POTION_MOB_RESET: "Minor Calming Potion",
  T5_POTION_MOB_RESET: "Calming Potion",
  T7_POTION_MOB_RESET: "Major Calming Potion",
  T3_POTION_CLEANSE2: "Minor Cleansing Potion",
  T5_POTION_CLEANSE2: "Cleansing Potion",
  T7_POTION_CLEANSE2: "Major Cleansing Potion",
  T3_POTION_ACID: "Minor Acid Potion",
  T5_POTION_ACID: "Acid Potion",
  T7_POTION_ACID: "Major Acid Potion",
  T4_POTION_BERSERK: "Minor Berserk Potion",
  T6_POTION_BERSERK: "Berserk Potion",
  T8_POTION_BERSERK: "Major Berserk Potion",
  T4_POTION_GATHER: "Minor Gathering Potion",
  T6_POTION_GATHER: "Gathering Potion",
  T8_POTION_GATHER: "Major Gathering Potion",
  T4_POTION_LAVA: "Minor Hellfire Potion",
  T6_POTION_LAVA: "Hellfire Potion",
  T8_POTION_LAVA: "Major Hellfire Potion",
  T4_POTION_TORNADO: "Minor Tornado in a Bottle",
  T6_POTION_TORNADO: "Tornado in a Bottle",
  T8_POTION_TORNADO: "Major Tornado in a Bottle",

  // Dragon Blood — the Lifeward Potion's artifact ingredient. Dropped by
  // Drakes and Dragons (Dragonfire, 2026-08-31); only T4 / T6 / T8 exist.
  T4_ALCHEMY_RARE_DRAGONAREA: "Diluted Dragon Blood",
  T6_ALCHEMY_RARE_DRAGONAREA: "Dragon Blood",
  T8_ALCHEMY_RARE_DRAGONAREA: "Potent Dragon Blood",
  T4_POTION_LIFEWARD: "Minor Lifeward Potion",
  T6_POTION_LIFEWARD: "Lifeward Potion",
  T8_POTION_LIFEWARD: "Major Lifeward Potion",

  // Arcane Extract — alchemy enchant-upgrade material for the potions above
  // (.1/.2/.3). Non-tradeable; rendered so breakdown rows aren't raw ids.
  T1_ALCHEMY_EXTRACT_LEVEL1: "Basic Arcane Extract",
  T1_ALCHEMY_EXTRACT_LEVEL2: "Refined Arcane Extract",
  T1_ALCHEMY_EXTRACT_LEVEL3: "Pure Arcane Extract",

  // Siphoned Energy
  UNIQUE_GVGTOKEN_GENERIC: "Siphoned Energy",

  // Battle mounts
  T6_MOUNT_SIEGE_BALLISTA: "Siege Ballista",
  T7_MOUNT_SWAMPDRAGON_BATTLE: "Flame Basilisk",
  T7_MOUNT_ARMORED_SWAMPDRAGON_BATTLE: "Venom Basilisk",
  "T8_MOUNT_MAMMOTH_BATTLE@1": "Elder's Command Mammoth",
  T7_MOUNT_SWAMPDRAGON_AVALON_BASILISK: "Avalonian Basilisk",

  // Quest tokens
  QUESTITEM_TOKEN_AVALON: "Avalonian Energy",
  QUESTITEM_TOKEN_ROYAL_T4: "Adept's Royal Sigil",
  QUESTITEM_TOKEN_ROYAL_T5: "Expert's Royal Sigil",
  QUESTITEM_TOKEN_ROYAL_T6: "Master's Royal Sigil",
  QUESTITEM_TOKEN_ROYAL_T7: "Grandmaster's Royal Sigil",
  QUESTITEM_TOKEN_ROYAL_T8: "Elder's Royal Sigil",
  QUESTITEM_TOKEN_MISTS: "Faerie Fire", // Brecilien / Mists crafting token (capes + Mystic Owl)

  // Faction hearts (cape ingredients)
  T1_FACTION_STEPPE_TOKEN_1: "Beastheart",
  T1_FACTION_MOUNTAIN_TOKEN_1: "Mountainheart",
  T1_FACTION_FOREST_TOKEN_1: "Treeheart",
  T1_FACTION_HIGHLAND_TOKEN_1: "Rockheart",
  T1_FACTION_SWAMP_TOKEN_1: "Vineheart",
  T1_FACTION_CAERLEON_TOKEN_1: "Shadowheart",

  // Special / faction mount-craft ingredients. Grown tamed animals (Saddler
  // inputs) and battle-mount upgrade tokens. Names are the exact EN-US strings
  // from ao-bin-dumps; without these the raw ids leak into recipe rows.
  T5_FARM_OWL_FW_BRECILIEN_GROWN: "Tame Mystic Owl",
  T8_FARM_OWL_FW_BRECILIEN_GROWN: "Tame Elite Mystic Owl",
  T5_FARM_OWL_FW_BRECILIEN_BABY: "Mystic Owlet", // sold by Brecilien faction enlistment for FP
  T8_FARM_OWL_FW_BRECILIEN_BABY: "Elite Mystic Owlet", // sold by Brecilien faction enlistment for FP
  T5_FARM_SPIDER_HELL_GROWN: "Tame Hellspinner",
  T8_FARM_SPIDER_HELL_GROWN: "Tame Soulspinner",
  T5_FARM_SPIDER_HELL_BABY: "Hellspinner Baby", // sold by The Antiquarian for Favor
  T8_FARM_SPIDER_HELL_BABY: "Soulspinner Baby", // sold by The Antiquarian for Favor
  // Firewing Drake (Dragonfire, 2026-08-31). The egg is a rare Azaryon drop —
  // and doubles as the Drake Egg Biscuits ingredient, so it shows up in a
  // cooking breakdown as well as the Kennel.
  T8_FARM_DRAKE_BABY: "Firewing Drake Egg",
  T8_FARM_DRAKE_GROWN: "Tame Firewing Drake",
  // Dragon Sanctuary Waystone fragments — ten of these combine into a Waystone
  // at the Artifact Foundry (js/data-waystones.js). Tradeable in their own right.
  T6_SHARD_RANDOM_DUNGEON_ELITE_DRAGON_TOKEN: "Master's Waystone Fragment",
  T7_SHARD_RANDOM_DUNGEON_ELITE_DRAGON_TOKEN: "Grandmaster's Waystone Fragment",
  T8_SHARD_RANDOM_DUNGEON_ELITE_DRAGON_TOKEN: "Elder's Waystone Fragment",
  T8_FARM_RABBIT_EASTER_GROWN_DARK: "\"Tame\" Caerleon Cottontail", // in-game name literally quotes "Tame"
  T8_MOUNTUPGRADE_COUGAR_KEEPER: "Sacred Bone Marrow", // Rageclaw upgrade
  T8_MOUNTUPGRADE_HORSE_MORGANA: "Infernal Horseshoes", // Morgana Nightmare upgrade
  T8_MOUNTUPGRADE_HORSE_CURSE: "Spectral Mask", // Spectral Bonehorse upgrade

  T4_WOOD: "T4 Pine Logs",
  T4_ROCK: "T4 Travertine",
  T4_ORE: "T4 Iron Ore",
  T4_HIDE: "T4 Medium Hide",
  T4_FIBER: "T4 Hemp",

  // Raw materials T5-T8
  T5_WOOD: "T5 Cedar Logs",
  T5_ORE: "T5 Titanium Ore",
  T5_HIDE: "T5 Heavy Hide",
  T5_FIBER: "T5 Skyflower",
  T5_ROCK: "T5 Granite",
  T6_WOOD: "T6 Bloodoak Logs",
  T6_ORE: "T6 Runite Ore",
  T6_HIDE: "T6 Robust Hide",
  T6_FIBER: "T6 Amberleaf Cotton",
  T6_ROCK: "T6 Slate",
  T7_WOOD: "T7 Ashenbark Logs",
  T7_ORE: "T7 Meteorite Ore",
  T7_HIDE: "T7 Thick Hide",
  T7_FIBER: "T7 Sunflax",
  T7_ROCK: "T7 Basalt",
  T8_WOOD: "T8 Whitewood Logs",
  T8_ORE: "T8 Adamantium Ore",
  T8_HIDE: "T8 Resilient Hide",
  T8_FIBER: "T8 Ghost Hemp",
  T8_ROCK: "T8 Marble",

  // Refined materials T4
  T4_PLANKS: "T4 Pine Planks",
  T4_STONEBLOCK: "T4 Travertine Block",
  T4_METALBAR: "T4 Steel Bar",
  T4_LEATHER: "T4 Worked Leather",
  T4_CLOTH: "T4 Fine Cloth",
  "T4_PLANKS_LEVEL1@1": "T4.1 Uncommon Pine Planks",
  "T4_PLANKS_LEVEL2@2": "T4.2 Rare Pine Planks",
  "T4_PLANKS_LEVEL3@3": "T4.3 Exceptional Pine Planks",
  "T4_STONEBLOCK_LEVEL1@1": "T4.1 Uncommon Travertine Block",
  "T4_STONEBLOCK_LEVEL2@2": "T4.2 Rare Travertine Block",
  "T4_STONEBLOCK_LEVEL3@3": "T4.3 Exceptional Travertine Block",
  "T4_METALBAR_LEVEL1@1": "T4.1 Uncommon Steel Bar",
  "T4_METALBAR_LEVEL2@2": "T4.2 Rare Steel Bar",
  "T4_METALBAR_LEVEL3@3": "T4.3 Exceptional Steel Bar",
  "T4_LEATHER_LEVEL1@1": "T4.1 Uncommon Worked Leather",
  "T4_LEATHER_LEVEL2@2": "T4.2 Rare Worked Leather",
  "T4_LEATHER_LEVEL3@3": "T4.3 Exceptional Worked Leather",
  "T4_PLANKS_LEVEL4@4": "T4.4 Pristine Pine Planks",
  "T4_STONEBLOCK_LEVEL4@4": "T4.4 Pristine Travertine Block",
  "T4_METALBAR_LEVEL4@4": "T4.4 Pristine Steel Bar",
  "T4_LEATHER_LEVEL4@4": "T4.4 Pristine Worked Leather",
  "T4_CLOTH_LEVEL1@1": "T4.1 Uncommon Fine Cloth",
  "T4_CLOTH_LEVEL2@2": "T4.2 Rare Fine Cloth",
  "T4_CLOTH_LEVEL3@3": "T4.3 Exceptional Fine Cloth",
  "T4_CLOTH_LEVEL4@4": "T4.4 Pristine Fine Cloth",

  // Refined materials T5
  T5_PLANKS: "T5 Cedar Planks",
  T5_METALBAR: "T5 Titanium Steel Bar",
  T5_LEATHER: "T5 Cured Leather",
  T5_CLOTH: "T5 Ornate Cloth",
  T5_STONEBLOCK: "T5 Granite Block",
  "T5_PLANKS_LEVEL1@1": "T5.1 Uncommon Cedar Planks",
  "T5_PLANKS_LEVEL2@2": "T5.2 Rare Cedar Planks",
  "T5_PLANKS_LEVEL3@3": "T5.3 Exceptional Cedar Planks",
  "T5_STONEBLOCK_LEVEL1@1": "T5.1 Uncommon Granite Block",
  "T5_STONEBLOCK_LEVEL2@2": "T5.2 Rare Granite Block",
  "T5_STONEBLOCK_LEVEL3@3": "T5.3 Exceptional Granite Block",
  "T5_METALBAR_LEVEL1@1": "T5.1 Uncommon Titanium Steel Bar",
  "T5_METALBAR_LEVEL2@2": "T5.2 Rare Titanium Steel Bar",
  "T5_METALBAR_LEVEL3@3": "T5.3 Exceptional Titanium Steel Bar",
  "T5_LEATHER_LEVEL1@1": "T5.1 Uncommon Cured Leather",
  "T5_LEATHER_LEVEL2@2": "T5.2 Rare Cured Leather",
  "T5_LEATHER_LEVEL3@3": "T5.3 Exceptional Cured Leather",
  "T5_CLOTH_LEVEL1@1": "T5.1 Uncommon Ornate Cloth",
  "T5_CLOTH_LEVEL2@2": "T5.2 Rare Ornate Cloth",
  "T5_CLOTH_LEVEL3@3": "T5.3 Exceptional Ornate Cloth",
  "T5_PLANKS_LEVEL4@4": "T5.4 Pristine Cedar Planks",
  "T5_STONEBLOCK_LEVEL4@4": "T5.4 Pristine Granite Block",
  "T5_METALBAR_LEVEL4@4": "T5.4 Pristine Titanium Steel Bar",
  "T5_LEATHER_LEVEL4@4": "T5.4 Pristine Cured Leather",
  "T5_CLOTH_LEVEL4@4": "T5.4 Pristine Ornate Cloth",

  // Refined materials T6
  T6_PLANKS: "T6 Bloodoak Planks",
  T6_METALBAR: "T6 Runite Steel Bar",
  T6_LEATHER: "T6 Hardened Leather",
  T6_CLOTH: "T6 Lavish Cloth",
  T6_STONEBLOCK: "T6 Slate Block",
  "T6_PLANKS_LEVEL1@1": "T6.1 Uncommon Bloodoak Planks",
  "T6_PLANKS_LEVEL2@2": "T6.2 Rare Bloodoak Planks",
  "T6_PLANKS_LEVEL3@3": "T6.3 Exceptional Bloodoak Planks",
  "T6_STONEBLOCK_LEVEL1@1": "T6.1 Uncommon Slate Block",
  "T6_STONEBLOCK_LEVEL2@2": "T6.2 Rare Slate Block",
  "T6_STONEBLOCK_LEVEL3@3": "T6.3 Exceptional Slate Block",
  "T6_METALBAR_LEVEL1@1": "T6.1 Uncommon Runite Steel Bar",
  "T6_METALBAR_LEVEL2@2": "T6.2 Rare Runite Steel Bar",
  "T6_METALBAR_LEVEL3@3": "T6.3 Exceptional Runite Steel Bar",
  "T6_LEATHER_LEVEL1@1": "T6.1 Uncommon Hardened Leather",
  "T6_LEATHER_LEVEL2@2": "T6.2 Rare Hardened Leather",
  "T6_LEATHER_LEVEL3@3": "T6.3 Exceptional Hardened Leather",
  "T6_CLOTH_LEVEL1@1": "T6.1 Uncommon Lavish Cloth",
  "T6_CLOTH_LEVEL2@2": "T6.2 Rare Lavish Cloth",
  "T6_CLOTH_LEVEL3@3": "T6.3 Exceptional Lavish Cloth",
  "T6_PLANKS_LEVEL4@4": "T6.4 Pristine Bloodoak Planks",
  "T6_STONEBLOCK_LEVEL4@4": "T6.4 Pristine Slate Block",
  "T6_METALBAR_LEVEL4@4": "T6.4 Pristine Runite Steel Bar",
  "T6_LEATHER_LEVEL4@4": "T6.4 Pristine Hardened Leather",
  "T6_CLOTH_LEVEL4@4": "T6.4 Pristine Lavish Cloth",

  // Refined materials T7
  T7_PLANKS: "T7 Ashenbark Planks",
  T7_METALBAR: "T7 Meteorite Steel Bar",
  T7_LEATHER: "T7 Reinforced Leather",
  T7_CLOTH: "T7 Opulent Cloth",
  T7_STONEBLOCK: "T7 Basalt Block",
  "T7_PLANKS_LEVEL1@1": "T7.1 Uncommon Ashenbark Planks",
  "T7_PLANKS_LEVEL2@2": "T7.2 Rare Ashenbark Planks",
  "T7_PLANKS_LEVEL3@3": "T7.3 Exceptional Ashenbark Planks",
  "T7_STONEBLOCK_LEVEL1@1": "T7.1 Uncommon Basalt Block",
  "T7_STONEBLOCK_LEVEL2@2": "T7.2 Rare Basalt Block",
  "T7_STONEBLOCK_LEVEL3@3": "T7.3 Exceptional Basalt Block",
  "T7_METALBAR_LEVEL1@1": "T7.1 Uncommon Meteorite Steel Bar",
  "T7_METALBAR_LEVEL2@2": "T7.2 Rare Meteorite Steel Bar",
  "T7_METALBAR_LEVEL3@3": "T7.3 Exceptional Meteorite Steel Bar",
  "T7_LEATHER_LEVEL1@1": "T7.1 Uncommon Reinforced Leather",
  "T7_LEATHER_LEVEL2@2": "T7.2 Rare Reinforced Leather",
  "T7_LEATHER_LEVEL3@3": "T7.3 Exceptional Reinforced Leather",
  "T7_CLOTH_LEVEL1@1": "T7.1 Uncommon Opulent Cloth",
  "T7_CLOTH_LEVEL2@2": "T7.2 Rare Opulent Cloth",
  "T7_CLOTH_LEVEL3@3": "T7.3 Exceptional Opulent Cloth",
  "T7_PLANKS_LEVEL4@4": "T7.4 Pristine Ashenbark Planks",
  "T7_STONEBLOCK_LEVEL4@4": "T7.4 Pristine Basalt Block",
  "T7_METALBAR_LEVEL4@4": "T7.4 Pristine Meteorite Steel Bar",
  "T7_LEATHER_LEVEL4@4": "T7.4 Pristine Reinforced Leather",
  "T7_CLOTH_LEVEL4@4": "T7.4 Pristine Opulent Cloth",

  // Refined materials T8
  T8_PLANKS: "T8 Whitewood Planks",
  T8_STONEBLOCK: "T8 Marble Block",
  T8_METALBAR: "T8 Adamantium Steel Bar",
  T8_LEATHER: "T8 Fortified Leather",
  T8_CLOTH: "T8 Baroque Cloth",
  "T8_PLANKS_LEVEL1@1": "T8.1 Uncommon Whitewood Planks",
  "T8_PLANKS_LEVEL2@2": "T8.2 Rare Whitewood Planks",
  "T8_PLANKS_LEVEL3@3": "T8.3 Exceptional Whitewood Planks",
  "T8_STONEBLOCK_LEVEL1@1": "T8.1 Uncommon Marble Block",
  "T8_STONEBLOCK_LEVEL2@2": "T8.2 Rare Marble Block",
  "T8_STONEBLOCK_LEVEL3@3": "T8.3 Exceptional Marble Block",
  "T8_METALBAR_LEVEL1@1": "T8.1 Uncommon Adamantium Steel Bar",
  "T8_METALBAR_LEVEL2@2": "T8.2 Rare Adamantium Steel Bar",
  "T8_METALBAR_LEVEL3@3": "T8.3 Exceptional Adamantium Steel Bar",
  "T8_LEATHER_LEVEL1@1": "T8.1 Uncommon Fortified Leather",
  "T8_LEATHER_LEVEL2@2": "T8.2 Rare Fortified Leather",
  "T8_LEATHER_LEVEL3@3": "T8.3 Exceptional Fortified Leather",
  "T8_CLOTH_LEVEL1@1": "T8.1 Uncommon Baroque Cloth",
  "T8_CLOTH_LEVEL2@2": "T8.2 Rare Baroque Cloth",
  "T8_CLOTH_LEVEL3@3": "T8.3 Exceptional Baroque Cloth",
  "T8_PLANKS_LEVEL4@4": "T8.4 Pristine Whitewood Planks",
  "T8_STONEBLOCK_LEVEL4@4": "T8.4 Pristine Marble Block",
  "T8_METALBAR_LEVEL4@4": "T8.4 Pristine Adamantium Steel Bar",
  "T8_LEATHER_LEVEL4@4": "T8.4 Pristine Fortified Leather",
  "T8_CLOTH_LEVEL4@4": "T8.4 Pristine Baroque Cloth",

  // T3 refined (secondary material for T4 refining)
  T3_PLANKS: "T3 Chestnut Planks",
  "T3_PLANKS@1": "T3.1 Uncommon Chestnut Planks",
  "T3_PLANKS@2": "T3.2 Rare Chestnut Planks",
  "T3_PLANKS@3": "T3.3 Exceptional Chestnut Planks",
  T3_STONEBLOCK: "T3 Sandstone Block",
  "T3_STONEBLOCK@1": "T3.1 Uncommon Sandstone Block",
  "T3_STONEBLOCK@2": "T3.2 Rare Sandstone Block",
  "T3_STONEBLOCK@3": "T3.3 Exceptional Sandstone Block",
  T3_METALBAR: "T3 Bronze Bar",
  "T3_METALBAR@1": "T3.1 Uncommon Bronze Bar",
  "T3_METALBAR@2": "T3.2 Rare Bronze Bar",
  "T3_METALBAR@3": "T3.3 Exceptional Bronze Bar",
  T3_LEATHER: "T3 Thick Leather",
  "T3_LEATHER@1": "T3.1 Uncommon Thick Leather",
  "T3_LEATHER@2": "T3.2 Rare Thick Leather",
  "T3_LEATHER@3": "T3.3 Exceptional Thick Leather",
  "T3_PLANKS@4": "T3.4 Pristine Chestnut Planks",
  "T3_STONEBLOCK@4": "T3.4 Pristine Sandstone Block",
  "T3_METALBAR@4": "T3.4 Pristine Bronze Bar",
  "T3_LEATHER@4": "T3.4 Pristine Thick Leather",
  T3_CLOTH: "T3 Neat Cloth",
  "T3_CLOTH@1": "T3.1 Uncommon Neat Cloth",
  "T3_CLOTH@2": "T3.2 Rare Neat Cloth",
  "T3_CLOTH@3": "T3.3 Exceptional Neat Cloth",
  "T3_CLOTH@4": "T3.4 Pristine Neat Cloth",

  // Cooking ingredients — meats
  T3_MEAT: "Raw Chicken [T3]",
  T4_MEAT: "Raw Goat [T4]",
  T5_MEAT: "Raw Goose [T5]",
  T6_MEAT: "Raw Mutton [T6]",
  T7_MEAT: "Raw Pork [T7]",
  T8_MEAT: "Raw Beef [T8]",
  // Crops. T7_WHEAT is legacy — the real T7 crop has uniquename T7_CORN
  // (display name "Bundle of Corn") and is the one used by current recipes.
  T3_WHEAT: "Sheaf of Wheat [T3]",
  T4_TURNIP: "Turnips [T4]",
  T5_CABBAGE: "Cabbage [T5]",
  T6_POTATO: "Potatoes [T6]",
  T7_CORN: "Bundle of Corn [T7]",
  T8_PUMPKIN: "Pumpkin [T8]",
  // Herbs. The alchemy line uses one herb per tier: T2 Agaric, T3 Comfrey,
  // T4 Burdock, T5 Teasel, T6 Foxglove, T7 Mullein, T8 Yarrow. T7_TEASEL and
  // T8_MULLEIN are kept for legacy recipe references but are not real items.
  T3_COMFREY: "Brightleaf Comfrey [T3]",
  T4_BURDOCK: "Crenellated Burdock [T4]",
  T5_TEASEL: "Dragon Teasel [T5]",
  T6_FOXGLOVE: "Elusive Foxglove [T6]",
  // Dairy. Only T4 (Goat), T6 (Sheep), T8 (Cow) exist in items.xml. Other
  // tiers are kept here only because legacy recipes still reference them; the
  // API just returns no data for non-existent ids.
  T4_MILK: "Goat's Milk [T4]",
  T6_MILK: "Sheep's Milk [T6]",
  T8_MILK: "Cow's Milk [T8]",
  T4_BUTTER: "Goat's Butter [T4]",
  T6_BUTTER: "Sheep's Butter [T6]",
  T8_BUTTER: "Cow's Butter [T8]",
  // Eggs, bread, flour. Only T3 (Hen) and T5 (Goose) eggs exist; T4 is a
  // legacy id referenced by a few old recipes. Bread is T4 only; flour is T3.
  T3_EGG: "Hen Eggs [T3]",
  T4_EGG: "Eggs [T4]",
  T5_EGG: "Goose Eggs [T5]",
  T4_BREAD: "Bread [T4]",
  T3_FLOUR: "Flour [T3]",
  // Enchant upgrade sauces. Fish sauce is tradeable in-game; essence
  // potions are non-tradeable. Foods upgrade with FISHSAUCE per level;
  // potions upgrade with ESSENCE_POTION matching the potion tier. Names
  // show the level/tier so the breakdown row is readable.
  T1_FISHSAUCE_LEVEL1: "Fishsauce [.1]",
  T1_FISHSAUCE_LEVEL2: "Fishsauce [.2]",
  T1_FISHSAUCE_LEVEL3: "Fishsauce [.3]",
  // Fish sauce ingredients (tradeable cooking byproducts).
  T1_FISHCHOPS: "Fish Chops [T1]",
  T1_SEAWEED: "Seaweed [T1]",
  // Fishing bait + its ingredient (worm, a farming product).
  T1_WORM: "Worms [T1]",
  T1_FISHINGBAIT: "Fishing Bait [T1]",
  T3_FISHINGBAIT: "Fishing Bait [T3]",
  T5_FISHINGBAIT: "Fishing Bait [T5]",
  T4_ESSENCE_POTION: "Essence Potion [T4]",
  T5_ESSENCE_POTION: "Essence Potion [T5]",
  T6_ESSENCE_POTION: "Essence Potion [T6]",
  T7_ESSENCE_POTION: "Essence Potion [T7]",
  T8_ESSENCE_POTION: "Essence Potion [T8]",
  // Low-tier crops & herbs
  T1_CARROT: "Carrots [T1]",
  T2_BEAN: "Beans [T2]",
  T2_AGARIC: "Arcane Agaric [T2]",
  T7_MULLEIN: "Firetouched Mullein [T7]",
  T8_YARROW: "Ghoul Yarrow [T8]",
  // Event consumables (used as breeding feed for cottontails)
  UNIQUE_CONSUMABLE_EVENT_EASTER_2020_CHOCOLATE: "Easter Chocolate [T4]",
  // Alcohol
  T6_ALCOHOL: "Potato Schnapps [T6]",
  T7_ALCOHOL: "Corn Hooch [T7]",
  T8_ALCOHOL: "Pumpkin Moonshine [T8]",
  // Rare fish (Forest — Eels)
  T3_FISH_FRESHWATER_FOREST_RARE: "Greenriver Eel [T3]",
  T5_FISH_FRESHWATER_FOREST_RARE: "Redspring Eel [T5]",
  T7_FISH_FRESHWATER_FOREST_RARE: "Deadwater Eel [T7]",
  // Rare fish (Swamp — Clams)
  T3_FISH_FRESHWATER_SWAMP_RARE: "Greenmoor Clam [T3]",
  T5_FISH_FRESHWATER_SWAMP_RARE: "Murkwater Clam [T5]",
  T7_FISH_FRESHWATER_SWAMP_RARE: "Blackbog Clam [T7]",
  // Rare fish (Mountain — Coldeyes)
  T3_FISH_FRESHWATER_MOUNTAIN_RARE: "Upland Coldeye [T3]",
  T5_FISH_FRESHWATER_MOUNTAIN_RARE: "Mountain Blindeye [T5]",
  T7_FISH_FRESHWATER_MOUNTAIN_RARE: "Frostpeak Deadeye [T7]",
  // Rare fish (Highlands — Lurchers)
  T3_FISH_FRESHWATER_HIGHLANDS_RARE: "Stonestream Lurcher [T3]",
  T5_FISH_FRESHWATER_HIGHLANDS_RARE: "Rushwater Lurcher [T5]",
  T7_FISH_FRESHWATER_HIGHLANDS_RARE: "Thunderfall Lurcher [T7]",
  // Rare fish (Steppe — Crabs)
  T3_FISH_FRESHWATER_STEPPE_RARE: "Lowriver Crab [T3]",
  T5_FISH_FRESHWATER_STEPPE_RARE: "Drybrook Crab [T5]",
  T7_FISH_FRESHWATER_STEPPE_RARE: "Dusthole Crab [T7]",
  // Rare fish (Saltwater — Squid/Octopus/Kraken)
  T3_FISH_SALTWATER_ALL_RARE: "Shallowshore Squid [T3]",
  T5_FISH_SALTWATER_ALL_RARE: "Midwater Octopus [T5]",
  T7_FISH_SALTWATER_ALL_RARE: "Deepwater Kraken [T7]",
  // Rare fish (Avalon — Snappers)
  T3_FISH_FRESHWATER_AVALON_RARE: "Whitefog Snapper [T3]",
  T5_FISH_FRESHWATER_AVALON_RARE: "Clearhaze Snapper [T5]",
  T7_FISH_FRESHWATER_AVALON_RARE: "Puremist Snapper [T7]",
  // Common fish — sourced by fishing any spot in their respective biomes.
  // All butcher into T1_FISHCHOPS at yields 1/2/3/4/6/8/10/14 (T1-T8).
  T1_FISH_FRESHWATER_ALL_COMMON: "Common Rudd [T1]",
  T2_FISH_FRESHWATER_ALL_COMMON: "Striped Carp [T2]",
  T3_FISH_FRESHWATER_ALL_COMMON: "Albion Perch [T3]",
  T4_FISH_FRESHWATER_ALL_COMMON: "Bluescale Pike [T4]",
  T5_FISH_FRESHWATER_ALL_COMMON: "Spotted Trout [T5]",
  T6_FISH_FRESHWATER_ALL_COMMON: "Brightscale Zander [T6]",
  T7_FISH_FRESHWATER_ALL_COMMON: "Danglemouth Catfish [T7]",
  T8_FISH_FRESHWATER_ALL_COMMON: "River Sturgeon [T8]",
  T1_FISH_SALTWATER_ALL_COMMON:  "Common Herring [T1]",
  T2_FISH_SALTWATER_ALL_COMMON:  "Striped Mackerel [T2]",
  T3_FISH_SALTWATER_ALL_COMMON:  "Flatshore Plaice [T3]",
  T4_FISH_SALTWATER_ALL_COMMON:  "Bluescale Cod [T4]",
  T5_FISH_SALTWATER_ALL_COMMON:  "Spotted Wolffish [T5]",
  T6_FISH_SALTWATER_ALL_COMMON:  "Strongfin Salmon [T6]",
  T7_FISH_SALTWATER_ALL_COMMON:  "Bluefin Tuna [T7]",
  T8_FISH_SALTWATER_ALL_COMMON:  "Steelscale Swordfish [T8]",
  // Boss shark — butchers into 200 fish chops per catch.
  T8_FISH_SALTWATER_ALL_BOSS_SHARK: "Shark [T8]",
  // Laborer trophies (journal rewards; Trophy Shark is the one craftable trophy)
  T2_FURNITUREITEM_TROPHY_FIBER: "Comfy Cotton Trophy",
  T3_FURNITUREITEM_TROPHY_FIBER: "Fine Flax Trophy",
  T4_FURNITUREITEM_TROPHY_FIBER: "Exquisite Hemp Trophy",
  T5_FURNITUREITEM_TROPHY_FIBER: "Soft Skyflower Trophy",
  T6_FURNITUREITEM_TROPHY_FIBER: "Comfy Amberleaf Cotton Trophy",
  T7_FURNITUREITEM_TROPHY_FIBER: "Fine Sunflax Trophy",
  T8_FURNITUREITEM_TROPHY_FIBER: "Exquisite Ghost Hemp Trophy",
  T2_FURNITUREITEM_TROPHY_FISH: "Carp Trophy",
  T3_FURNITUREITEM_TROPHY_FISH: "Perch Trophy",
  T4_FURNITUREITEM_TROPHY_FISH: "Pike Trophy",
  T5_FURNITUREITEM_TROPHY_FISH: "Trout Trophy",
  T6_FURNITUREITEM_TROPHY_FISH: "Zander Trophy",
  T7_FURNITUREITEM_TROPHY_FISH: "Catfish Trophy",
  T8_FURNITUREITEM_TROPHY_FISH: "Swordfish Trophy",
  T2_FURNITUREITEM_TROPHY_GENERAL: "Adventurer's Handbook",
  T3_FURNITUREITEM_TROPHY_GENERAL: "Magical Tome",
  T4_FURNITUREITEM_TROPHY_GENERAL: "Ancient Scripture",
  T5_FURNITUREITEM_TROPHY_GENERAL: "Tome of Knowledge",
  T6_FURNITUREITEM_TROPHY_GENERAL: "Encyclopedia of Power",
  T7_FURNITUREITEM_TROPHY_GENERAL: "Occult Octavo",
  T8_FURNITUREITEM_TROPHY_GENERAL: "Ledger of Truths",
  T2_FURNITUREITEM_TROPHY_HIDE: "Stuffed Fox Head",
  T3_FURNITUREITEM_TROPHY_HIDE: "Stuffed Wolf Head",
  T4_FURNITUREITEM_TROPHY_HIDE: "Stuffed Boar Head",
  T5_FURNITUREITEM_TROPHY_HIDE: "Stuffed Bear Head",
  T6_FURNITUREITEM_TROPHY_HIDE: "Stuffed Direwolf Head",
  T7_FURNITUREITEM_TROPHY_HIDE: "Stuffed Direboar Head",
  T8_FURNITUREITEM_TROPHY_HIDE: "Stuffed Direbear Head",
  T2_FURNITUREITEM_TROPHY_MERCENARY: "Novice Mercenary's Trophy",
  T3_FURNITUREITEM_TROPHY_MERCENARY: "Journeyman Mercenary's Trophy",
  T4_FURNITUREITEM_TROPHY_MERCENARY: "Adept Mercenary's Trophy",
  T5_FURNITUREITEM_TROPHY_MERCENARY: "Expert Mercenary's Trophy",
  T6_FURNITUREITEM_TROPHY_MERCENARY: "Master Mercenary's Trophy",
  T7_FURNITUREITEM_TROPHY_MERCENARY: "Grandmaster Mercenary's Trophy",
  T8_FURNITUREITEM_TROPHY_MERCENARY: "Elder Mercenary's Trophy",
  T2_FURNITUREITEM_TROPHY_ORE: "Copper Ore Sample",
  T3_FURNITUREITEM_TROPHY_ORE: "Tin Ore Sample",
  T4_FURNITUREITEM_TROPHY_ORE: "Iron Ore Sample",
  T5_FURNITUREITEM_TROPHY_ORE: "Titanium Ore Sample",
  T6_FURNITUREITEM_TROPHY_ORE: "Runite Ore Sample",
  T7_FURNITUREITEM_TROPHY_ORE: "Meteorite Ore Sample",
  T8_FURNITUREITEM_TROPHY_ORE: "Adamantium Ore Sample",
  T2_FURNITUREITEM_TROPHY_ROCK: "Limestone Fragment",
  T3_FURNITUREITEM_TROPHY_ROCK: "Sandstone Fragment",
  T4_FURNITUREITEM_TROPHY_ROCK: "Travertine Fragment",
  T5_FURNITUREITEM_TROPHY_ROCK: "Granite Fragment",
  T6_FURNITUREITEM_TROPHY_ROCK: "Slate Fragment",
  T7_FURNITUREITEM_TROPHY_ROCK: "Basalt Fragment",
  T8_FURNITUREITEM_TROPHY_ROCK: "Marble Fragment",
  T2_FURNITUREITEM_TROPHY_WOOD: "Birch Bonsai",
  T3_FURNITUREITEM_TROPHY_WOOD: "Chestnut Bonsai",
  T4_FURNITUREITEM_TROPHY_WOOD: "Pine Bonsai",
  T5_FURNITUREITEM_TROPHY_WOOD: "Cedar Bonsai",
  T6_FURNITUREITEM_TROPHY_WOOD: "Bloodoak Bonsai",
  T7_FURNITUREITEM_TROPHY_WOOD: "Ashenbark Bonsai",
  T8_FURNITUREITEM_TROPHY_WOOD: "Whitewood Bonsai",
  T8_FURNITUREITEM_TROPHY_FISHING_BOSS: "Trophy Shark",
  // Craftable furniture
  T2_FURNITUREITEM_BED: "Novice's Bed",
  T3_FURNITUREITEM_BED: "Journeyman's Bed",
  T4_FURNITUREITEM_BED: "Adept's Bed",
  T5_FURNITUREITEM_BED: "Expert's Bed",
  T6_FURNITUREITEM_BED: "Master's Bed",
  T7_FURNITUREITEM_BED: "Grandmaster's Bed",
  T8_FURNITUREITEM_BED: "Elder's Bed",
  T2_FURNITUREITEM_CHEST: "Novice's Chest",
  T3_FURNITUREITEM_CHEST: "Journeyman's Chest",
  T4_FURNITUREITEM_CHEST: "Adept's Chest",
  T5_FURNITUREITEM_CHEST: "Expert's Chest",
  T2_FURNITUREITEM_TABLE: "Novice's Table",
  T3_FURNITUREITEM_TABLE: "Journeyman's Table",
  T4_FURNITUREITEM_TABLE: "Adept's Table",
  T5_FURNITUREITEM_TABLE: "Expert's Table",
  T6_FURNITUREITEM_TABLE: "Master's Table",
  T7_FURNITUREITEM_TABLE: "Grandmaster's Table",
  T8_FURNITUREITEM_TABLE: "Elder's Table",
  T4_FURNITUREITEM_REPAIRKIT: "Adept's Repair Kit",
  T5_FURNITUREITEM_REPAIRKIT: "Expert's Repair Kit",
  T6_FURNITUREITEM_REPAIRKIT: "Master's Repair Kit",
  T7_FURNITUREITEM_REPAIRKIT: "Grandmaster's Repair Kit",
  T8_FURNITUREITEM_REPAIRKIT: "Elder's Repair Kit",
  // Tomes of Insight + gathering tomes
  T4_SKILLBOOK_GATHER_FIBER: "Adept Fiber Harvester Tome",
  T5_SKILLBOOK_GATHER_FIBER: "Expert Fiber Harvester Tome",
  T6_SKILLBOOK_GATHER_FIBER: "Master Fiber Harvester Tome",
  T7_SKILLBOOK_GATHER_FIBER: "Grandmaster Fiber Harvester Tome",
  T8_SKILLBOOK_GATHER_FIBER: "Elder Fiber Harvester Tome",
  T4_SKILLBOOK_GATHER_HIDE: "Adept Animal Skinner Tome",
  T5_SKILLBOOK_GATHER_HIDE: "Expert Animal Skinner Tome",
  T6_SKILLBOOK_GATHER_HIDE: "Master Animal Skinner Tome",
  T7_SKILLBOOK_GATHER_HIDE: "Grandmaster Animal Skinner Tome",
  T8_SKILLBOOK_GATHER_HIDE: "Elder Animal Skinner Tome",
  T4_SKILLBOOK_GATHER_ORE: "Adept Ore Miner Tome",
  T5_SKILLBOOK_GATHER_ORE: "Expert Ore Miner Tome",
  T6_SKILLBOOK_GATHER_ORE: "Master Ore Miner Tome",
  T7_SKILLBOOK_GATHER_ORE: "Grandmaster Ore Miner Tome",
  T8_SKILLBOOK_GATHER_ORE: "Elder Ore Miner Tome",
  T4_SKILLBOOK_GATHER_ROCK: "Adept Quarrier Tome",
  T5_SKILLBOOK_GATHER_ROCK: "Expert Quarrier Tome",
  T6_SKILLBOOK_GATHER_ROCK: "Master Quarrier Tome",
  T7_SKILLBOOK_GATHER_ROCK: "Grandmaster Quarrier Tome",
  T8_SKILLBOOK_GATHER_ROCK: "Elder Quarrier Tome",
  T4_SKILLBOOK_GATHER_WOOD: "Adept Lumberjack Tome",
  T5_SKILLBOOK_GATHER_WOOD: "Expert Lumberjack Tome",
  T6_SKILLBOOK_GATHER_WOOD: "Master Lumberjack Tome",
  T7_SKILLBOOK_GATHER_WOOD: "Grandmaster Lumberjack Tome",
  T8_SKILLBOOK_GATHER_WOOD: "Elder Lumberjack Tome",
  // Artifact Foundry maps (souls + flat silver, 0% RRR — see js/data-maps.js).
  T5_CORRUPTED_NONLETHAL_MAP: "Corrupted Dungeon Map (Hunter)",
  T6_CORRUPTED_LETHAL_MAP: "Corrupted Dungeon Map (Stalker/Slayer)",
  T5_HELLGATE_2V2_NON_LETHAL_1_MAP: "Hellgate Map 2v2 (Non-Lethal)",
  T5_HELLGATE_5V5_NON_LETHAL_1_MAP: "Hellgate Map 5v5 (Non-Lethal)",
  T5_HELLGATE_10V10_NON_LETHAL_1_MAP: "Hellgate Map 10v10 (Non-Lethal)",
  T6_HELLGATE_2V2_LETHAL_1_MAP: "Hellgate Map 2v2 (Lethal)",
  T7_HELLGATE_5V5_LETHAL_1_MAP: "Hellgate Map 5v5 (Lethal)",
  T8_HELLGATE_10V10_LETHAL_1_MAP: "Hellgate Map 10v10 (Lethal)",
  // Solo dungeon map, the one tier the id pattern does not name for itself.
  T3_RANDOM_DUNGEON_SOLO_TOKEN_1: "Journeyman's Dungeon Map (Solo)",
  // Black Leather — the Hell war-gloves artifact. Kept out of ARTIFACT_MAPPING
  // (js/data-artifacts.js) so the Rolling meld pool stays at its verified 136.
  T4_ARTEFACT_2H_IRONGAUNTLETS_HELL: "Adept's Black Leather",
  T5_ARTEFACT_2H_IRONGAUNTLETS_HELL: "Expert's Black Leather",
  T6_ARTEFACT_2H_IRONGAUNTLETS_HELL: "Master's Black Leather",
  T7_ARTEFACT_2H_IRONGAUNTLETS_HELL: "Grandmaster's Black Leather",
  T8_ARTEFACT_2H_IRONGAUNTLETS_HELL: "Elder's Black Leather",
  // Faded Essence: the raw drop the Arcane Essence potion is brewed from.
  T4_ESSENCE: "Adept's Faded Essence",
  T5_ESSENCE: "Expert's Faded Essence",
  T6_ESSENCE: "Master's Faded Essence",
  T7_ESSENCE: "Grandmaster's Faded Essence",
  T8_ESSENCE: "Elder's Faded Essence",
  // Common animal remains — the game really does call the T1 id "Rare".
  T1_ALCHEMY_COMMON: "Rare Animal Remains",
  // Mount upgrade kits whose lower tier has no other catalog entry.
  T5_MOUNTUPGRADE_HORSE_CURSE: "Necromantic Elixir",
  T5_MOUNTUPGRADE_HORSE_MORGANA: "Morgana Mare Saddle",
  // Tierless faction tokens.
  QUESTITEM_TOKEN_KEEPER: "Keeper Totem",
  QUESTITEM_TOKEN_MORGANA: "Morgana's Favor",
  QUESTITEM_TOKEN_UNDEAD: "Undead Knucklebone",
  QUESTITEM_TOKEN_SMUGGLER: "Smuggler's Coin",
};
