// Mount crafting recipes (Saddler station) and breeding flip items
// Recipes are hardcoded since gameinfo API doesn't return mount recipes

const MOUNT_RECIPES = [
  // Riding Horse T3-T8: grown horse + 20x leather
  { id: "T3_MOUNT_HORSE", name: "Riding Horse [T3]", materials: [
    { matId: "T3_FARM_HORSE_GROWN", count: 1 }, { matId: "T3_LEATHER", count: 20 }
  ]},
  { id: "T4_MOUNT_HORSE", name: "Riding Horse [T4]", materials: [
    { matId: "T4_FARM_HORSE_GROWN", count: 1 }, { matId: "T4_LEATHER", count: 20 }
  ]},
  { id: "T5_MOUNT_HORSE", name: "Riding Horse [T5]", materials: [
    { matId: "T5_FARM_HORSE_GROWN", count: 1 }, { matId: "T5_LEATHER", count: 20 }
  ]},
  { id: "T6_MOUNT_HORSE", name: "Riding Horse [T6]", materials: [
    { matId: "T6_FARM_HORSE_GROWN", count: 1 }, { matId: "T6_LEATHER", count: 20 }
  ]},
  { id: "T7_MOUNT_HORSE", name: "Riding Horse [T7]", materials: [
    { matId: "T7_FARM_HORSE_GROWN", count: 1 }, { matId: "T7_LEATHER", count: 20 }
  ]},
  { id: "T8_MOUNT_HORSE", name: "Riding Horse [T8]", materials: [
    { matId: "T8_FARM_HORSE_GROWN", count: 1 }, { matId: "T8_LEATHER", count: 20 }
  ]},

  // Armored Horse T5-T8: grown horse + 10x cloth + 20x metalbar
  { id: "T5_MOUNT_ARMORED_HORSE", name: "Armored Horse [T5]", materials: [
    { matId: "T5_FARM_HORSE_GROWN", count: 1 }, { matId: "T5_CLOTH", count: 10 }, { matId: "T5_METALBAR", count: 20 }
  ]},
  { id: "T6_MOUNT_ARMORED_HORSE", name: "Armored Horse [T6]", materials: [
    { matId: "T6_FARM_HORSE_GROWN", count: 1 }, { matId: "T6_CLOTH", count: 10 }, { matId: "T6_METALBAR", count: 20 }
  ]},
  { id: "T7_MOUNT_ARMORED_HORSE", name: "Armored Horse [T7]", materials: [
    { matId: "T7_FARM_HORSE_GROWN", count: 1 }, { matId: "T7_CLOTH", count: 10 }, { matId: "T7_METALBAR", count: 20 }
  ]},
  { id: "T8_MOUNT_ARMORED_HORSE", name: "Armored Horse [T8]", materials: [
    { matId: "T8_FARM_HORSE_GROWN", count: 1 }, { matId: "T8_CLOTH", count: 10 }, { matId: "T8_METALBAR", count: 20 }
  ]},

  // Transport Ox T3-T8: grown ox + 30x planks
  { id: "T3_MOUNT_OX", name: "Transport Ox [T3]", materials: [
    { matId: "T3_FARM_OX_GROWN", count: 1 }, { matId: "T3_PLANKS", count: 30 }
  ]},
  { id: "T4_MOUNT_OX", name: "Transport Ox [T4]", materials: [
    { matId: "T4_FARM_OX_GROWN", count: 1 }, { matId: "T4_PLANKS", count: 30 }
  ]},
  { id: "T5_MOUNT_OX", name: "Transport Ox [T5]", materials: [
    { matId: "T5_FARM_OX_GROWN", count: 1 }, { matId: "T5_PLANKS", count: 30 }
  ]},
  { id: "T6_MOUNT_OX", name: "Transport Ox [T6]", materials: [
    { matId: "T6_FARM_OX_GROWN", count: 1 }, { matId: "T6_PLANKS", count: 30 }
  ]},
  { id: "T7_MOUNT_OX", name: "Transport Ox [T7]", materials: [
    { matId: "T7_FARM_OX_GROWN", count: 1 }, { matId: "T7_PLANKS", count: 30 }
  ]},
  { id: "T8_MOUNT_OX", name: "Transport Ox [T8]", materials: [
    { matId: "T8_FARM_OX_GROWN", count: 1 }, { matId: "T8_PLANKS", count: 30 }
  ]},

  // Giant Stag T4: grown stag + 20x leather
  { id: "T4_MOUNT_GIANTSTAG", name: "Giant Stag [T4]", materials: [
    { matId: "T4_FARM_GIANTSTAG_GROWN", count: 1 }, { matId: "T4_LEATHER", count: 20 }
  ]},

  // Swiftclaw T5: grown cougar + 20x leather (game-internal stem is COUGAR;
  // the saddled mount item id carries the _KEEPER suffix from its drop source).
  // items.xml gives it enchantmentlevel="1", so it only exists — on the market,
  // the AODP API and the sniffer's item index — as the @1 id. The bare id has no
  // listings, which left the row reading 5.0 and never priced. Same for the
  // other native-.1 mounts below (Command Mammoth, Rageclaw, Bonehorse,
  // Morgana Nightmare, Caerleon Cottontail).
  { id: "T5_MOUNT_COUGAR_KEEPER@1", name: "Swiftclaw [T5.1]", materials: [
    { matId: "T5_FARM_COUGAR_GROWN", count: 1 }, { matId: "T5_LEATHER", count: 20 }
  ]},

  // Direwolf T6: grown direwolf + 20x leather
  { id: "T6_MOUNT_DIREWOLF", name: "Direwolf [T6]", materials: [
    { matId: "T6_FARM_DIREWOLF_GROWN", count: 1 }, { matId: "T6_LEATHER", count: 20 }
  ]},

  // Direboar T7: grown direboar + 20x leather
  { id: "T7_MOUNT_DIREBOAR", name: "Direboar [T7]", materials: [
    { matId: "T7_FARM_DIREBOAR_GROWN", count: 1 }, { matId: "T7_LEATHER", count: 20 }
  ]},

  // Saddled Swamp Dragon T7: grown swamp dragon + 20x leather
  { id: "T7_MOUNT_SWAMPDRAGON", name: "Saddled Swamp Dragon [T7]", materials: [
    { matId: "T7_FARM_SWAMPDRAGON_GROWN", count: 1 }, { matId: "T7_LEATHER", count: 20 }
  ]},

  // Direbear T8: grown direbear + 20x leather
  { id: "T8_MOUNT_DIREBEAR", name: "Direbear [T8]", materials: [
    { matId: "T8_FARM_DIREBEAR_GROWN", count: 1 }, { matId: "T8_LEATHER", count: 20 }
  ]},

  // Mammoth T8: grown mammoth + 20x leather
  { id: "T8_MOUNT_MAMMOTH_TRANSPORT", name: "Transport Mammoth [T8]", materials: [
    { matId: "T8_FARM_MAMMOTH_GROWN", count: 1 }, { matId: "T8_LEATHER", count: 20 }
  ]},

  // T5 Faction Warfare saddled mounts: tame + 20x T5 leather + 5x heart fragment
  { id: "T5_MOUNT_SWAMPDRAGON_FW_THETFORD", name: "Saddled Swamp Salamander [T5]", materials: [
    { matId: "T5_FARM_SWAMPDRAGON_FW_THETFORD_GROWN", count: 1 },
    { matId: "T5_LEATHER", count: 20 }, { matId: "T1_FACTION_SWAMP_TOKEN_1", count: 5 }
  ]},
  { id: "T5_MOUNT_DIREBEAR_FW_FORTSTERLING", name: "Saddled Winter Bear [T5]", materials: [
    { matId: "T5_FARM_DIREBEAR_FW_FORTSTERLING_GROWN", count: 1 },
    { matId: "T5_LEATHER", count: 20 }, { matId: "T1_FACTION_MOUNTAIN_TOKEN_1", count: 5 }
  ]},
  { id: "T5_MOUNT_DIREBOAR_FW_LYMHURST", name: "Saddled Wild Boar [T5]", materials: [
    { matId: "T5_FARM_DIREBOAR_FW_LYMHURST_GROWN", count: 1 },
    { matId: "T5_LEATHER", count: 20 }, { matId: "T1_FACTION_FOREST_TOKEN_1", count: 5 }
  ]},
  { id: "T5_MOUNT_RAM_FW_MARTLOCK", name: "Saddled Bighorn Ram [T5]", materials: [
    { matId: "T5_FARM_RAM_FW_MARTLOCK_GROWN", count: 1 },
    { matId: "T5_LEATHER", count: 20 }, { matId: "T1_FACTION_HIGHLAND_TOKEN_1", count: 5 }
  ]},
  { id: "T5_MOUNT_MOABIRD_FW_BRIDGEWATCH", name: "Saddled Moabird [T5]", materials: [
    { matId: "T5_FARM_MOABIRD_FW_BRIDGEWATCH_GROWN", count: 1 },
    { matId: "T5_LEATHER", count: 20 }, { matId: "T1_FACTION_STEPPE_TOKEN_1", count: 5 }
  ]},
  { id: "T5_MOUNT_GREYWOLF_FW_CAERLEON", name: "Saddled Greywolf [T5]", materials: [
    { matId: "T5_FARM_GREYWOLF_FW_CAERLEON_GROWN", count: 1 },
    { matId: "T5_LEATHER", count: 20 }, { matId: "T1_FACTION_CAERLEON_TOKEN_1", count: 5 }
  ]},

  // T8 Faction Warfare Elite saddled mounts: tame + 20x T8 leather + 20x heart fragment
  { id: "T8_MOUNT_SWAMPDRAGON_FW_THETFORD_ELITE", name: "Elite Swamp Salamander [T8]", materials: [
    { matId: "T8_FARM_SWAMPDRAGON_FW_THETFORD_GROWN", count: 1 },
    { matId: "T8_LEATHER", count: 20 }, { matId: "T1_FACTION_SWAMP_TOKEN_1", count: 20 }
  ]},
  { id: "T8_MOUNT_DIREBEAR_FW_FORTSTERLING_ELITE", name: "Elite Winter Bear [T8]", materials: [
    { matId: "T8_FARM_DIREBEAR_FW_FORTSTERLING_GROWN", count: 1 },
    { matId: "T8_LEATHER", count: 20 }, { matId: "T1_FACTION_MOUNTAIN_TOKEN_1", count: 20 }
  ]},
  { id: "T8_MOUNT_DIREBOAR_FW_LYMHURST_ELITE", name: "Elite Wild Boar [T8]", materials: [
    { matId: "T8_FARM_DIREBOAR_FW_LYMHURST_GROWN", count: 1 },
    { matId: "T8_LEATHER", count: 20 }, { matId: "T1_FACTION_FOREST_TOKEN_1", count: 20 }
  ]},
  { id: "T8_MOUNT_RAM_FW_MARTLOCK_ELITE", name: "Elite Bighorn Ram [T8]", materials: [
    { matId: "T8_FARM_RAM_FW_MARTLOCK_GROWN", count: 1 },
    { matId: "T8_LEATHER", count: 20 }, { matId: "T1_FACTION_HIGHLAND_TOKEN_1", count: 20 }
  ]},
  { id: "T8_MOUNT_MOABIRD_FW_BRIDGEWATCH_ELITE", name: "Elite Terrorbird [T8]", materials: [
    { matId: "T8_FARM_MOABIRD_FW_BRIDGEWATCH_GROWN", count: 1 },
    { matId: "T8_LEATHER", count: 20 }, { matId: "T1_FACTION_STEPPE_TOKEN_1", count: 20 }
  ]},
  { id: "T8_MOUNT_GREYWOLF_FW_CAERLEON_ELITE", name: "Elite Greywolf [T8]", materials: [
    { matId: "T8_FARM_GREYWOLF_FW_CAERLEON_GROWN", count: 1 },
    { matId: "T8_LEATHER", count: 20 }, { matId: "T1_FACTION_CAERLEON_TOKEN_1", count: 20 }
  ]},

  // Battle Mounts (Energy Manipulator)
  { id: "T6_MOUNT_SIEGE_BALLISTA", name: "Siege Ballista [T6]", craftType: "battlemount", materials: [
    { matId: "T6_MOUNT_OX", count: 1 }, { matId: "T6_METALBAR", count: 20 },
    { matId: "T6_LEATHER", count: 20 }, { matId: "T6_PLANKS", count: 20 },
    { matId: "UNIQUE_GVGTOKEN_GENERIC", count: 500 }
  ]},
  { id: "T7_MOUNT_SWAMPDRAGON_BATTLE", name: "Flame Basilisk [T7]", craftType: "battlemount", materials: [
    { matId: "T7_MOUNT_SWAMPDRAGON", count: 1 }, { matId: "T7_CLOTH", count: 20 },
    { matId: "UNIQUE_GVGTOKEN_GENERIC", count: 5000 }
  ]},
  { id: "T7_MOUNT_ARMORED_SWAMPDRAGON_BATTLE", name: "Venom Basilisk [T7]", craftType: "battlemount", materials: [
    { matId: "T7_MOUNT_SWAMPDRAGON", count: 1 }, { matId: "T7_METALBAR", count: 20 },
    { matId: "UNIQUE_GVGTOKEN_GENERIC", count: 5000 }
  ]},
  { id: "T8_MOUNT_MAMMOTH_BATTLE@1", name: "Command Mammoth [T8.1]", craftType: "battlemount", materials: [
    { matId: "T8_MOUNT_MAMMOTH_TRANSPORT", count: 1 }, { matId: "T8_LEATHER", count: 20 },
    { matId: "UNIQUE_GVGTOKEN_GENERIC", count: 10000 }
  ]},
  { id: "T7_MOUNT_SWAMPDRAGON_AVALON_BASILISK", name: "Avalonian Basilisk [T7]", craftType: "battlemount", materials: [
    { matId: "T7_MOUNT_SWAMPDRAGON", count: 1 }, { matId: "QUESTITEM_TOKEN_AVALON", count: 5000 }
  ]},

  // Seasonal mounts (Saddler)
  { id: "T8_MOUNT_RABBIT_EASTER", name: "Spring Cottontail [T8]", materials: [
    { matId: "T8_FARM_RABBIT_EASTER_GROWN", count: 1 }, { matId: "T8_LEATHER", count: 20 }
  ]},
  { id: "T8_MOUNT_RABBIT_EASTER_DARK@1", name: "Caerleon Cottontail [T8.1]", materials: [
    { matId: "T8_FARM_RABBIT_EASTER_GROWN_DARK", count: 1 }, { matId: "T8_LEATHER", count: 20 }
  ]},

  // ── Faction / special / event mounts (real ids + recipes from items.xml,
  //    wiki names; verified 2026-05-29). Cosmetic re-skins are intentionally
  //    omitted, as are Adventurer's Challenge reward mounts (ids suffixed _ADC:
  //    Frost Ram, Snow Husky, Pest Lizard, Saddled Terrorbird, Keeper Bear).
  //    Those carry an EMPTY <craftingrequirements> in items.xml (no resources) —
  //    they are earned via 600K Challenge Points, not craftable. Do not re-add.
  { id: "T5_MOUNT_OWL_FW_BRECILIEN", name: "Saddled Mystic Owl [T5]", materials: [
    { matId: "T5_FARM_OWL_FW_BRECILIEN_GROWN", count: 1 }, { matId: "T5_LEATHER", count: 20 }, { matId: "QUESTITEM_TOKEN_MISTS", count: 5 }
  ]},
  { id: "T5_MOUNT_SPIDER_HELL", name: "Hellspinner [T5]", materials: [
    { matId: "T5_FARM_SPIDER_HELL_GROWN", count: 1 }, { matId: "T5_LEATHER", count: 20 }, { matId: "T1_FACTION_CAERLEON_TOKEN_1", count: 5 }
  ]},
  { id: "T6_MOUNT_GIANTSTAG_MOOSE", name: "Moose [T6]", materials: [
    { matId: "T6_FARM_GIANTSTAG_MOOSE_GROWN", count: 1 }, { matId: "T6_LEATHER", count: 20 }
  ]},
  { id: "T8_MOUNT_ARMORED_HORSE_MORGANA@1", name: "Morgana Nightmare [T8.1]", materials: [
    { matId: "T8_MOUNT_ARMORED_HORSE", count: 1 }, { matId: "T8_MOUNTUPGRADE_HORSE_MORGANA", count: 1 }
  ]},
  { id: "T8_MOUNT_COUGAR_KEEPER@1", name: "Rageclaw [T8.1]", materials: [
    { matId: "T5_MOUNT_COUGAR_KEEPER@1", count: 1 }, { matId: "T8_MOUNTUPGRADE_COUGAR_KEEPER", count: 1 }
  ]},
  { id: "T8_MOUNT_HORSE_UNDEAD@1", name: "Spectral Bonehorse [T8.1]", materials: [
    { matId: "T8_MOUNT_HORSE", count: 1 }, { matId: "T8_MOUNTUPGRADE_HORSE_CURSE", count: 1 }
  ]},
  { id: "T8_MOUNT_OWL_FW_BRECILIEN_ELITE", name: "Elite Mystic Owl [T8]", materials: [
    { matId: "T8_FARM_OWL_FW_BRECILIEN_GROWN", count: 1 }, { matId: "T8_LEATHER", count: 20 }, { matId: "QUESTITEM_TOKEN_MISTS", count: 20 }
  ]},
  { id: "T8_MOUNT_SPIDER_HELL", name: "Soulspinner [T8]", materials: [
    { matId: "T8_FARM_SPIDER_HELL_GROWN", count: 1 }, { matId: "T8_LEATHER", count: 20 }, { matId: "T1_FACTION_CAERLEON_TOKEN_1", count: 20 }
  ]},
  // Firewing Drake (Dragonfire, 2026-08-31). Saddled like a riding mount —
  // just leather; the egg itself is the Azaryon drop that gates the whole line.
  { id: "T8_MOUNT_DRAKE_FIRE", name: "Firewing Drake [T8]", materials: [
    { matId: "T8_FARM_DRAKE_GROWN", count: 1 }, { matId: "T8_LEATHER", count: 20 }
  ]},
];

// Breeding items: baby -> grown flip analysis
const BREEDING_ITEMS = [
  // Riding animals - Horses
  { babyId: "T3_FARM_HORSE_BABY", grownId: "T3_FARM_HORSE_GROWN", name: "Horse [T3]" },
  { babyId: "T4_FARM_HORSE_BABY", grownId: "T4_FARM_HORSE_GROWN", name: "Horse [T4]" },
  { babyId: "T5_FARM_HORSE_BABY", grownId: "T5_FARM_HORSE_GROWN", name: "Horse [T5]" },
  { babyId: "T6_FARM_HORSE_BABY", grownId: "T6_FARM_HORSE_GROWN", name: "Horse [T6]" },
  { babyId: "T7_FARM_HORSE_BABY", grownId: "T7_FARM_HORSE_GROWN", name: "Horse [T7]", grownName: "Grandmaster's Horse", babyName: "Grandmaster's Foal" },
  { babyId: "T8_FARM_HORSE_BABY", grownId: "T8_FARM_HORSE_GROWN", name: "Horse [T8]" },

  // Oxen
  { babyId: "T3_FARM_OX_BABY", grownId: "T3_FARM_OX_GROWN", name: "Ox [T3]" },
  { babyId: "T4_FARM_OX_BABY", grownId: "T4_FARM_OX_GROWN", name: "Ox [T4]" },
  { babyId: "T5_FARM_OX_BABY", grownId: "T5_FARM_OX_GROWN", name: "Ox [T5]" },
  { babyId: "T6_FARM_OX_BABY", grownId: "T6_FARM_OX_GROWN", name: "Ox [T6]" },
  { babyId: "T7_FARM_OX_BABY", grownId: "T7_FARM_OX_GROWN", name: "Ox [T7]" },
  { babyId: "T8_FARM_OX_BABY", grownId: "T8_FARM_OX_GROWN", name: "Ox [T8]" },

  // Livestock
  { babyId: "T3_FARM_CHICKEN_BABY", grownId: "T3_FARM_CHICKEN_GROWN", name: "Chicken [T3]" },
  { babyId: "T4_FARM_GOAT_BABY", grownId: "T4_FARM_GOAT_GROWN", name: "Goat [T4]" },
  { babyId: "T5_FARM_GOOSE_BABY", grownId: "T5_FARM_GOOSE_GROWN", name: "Goose [T5]" },
  { babyId: "T6_FARM_SHEEP_BABY", grownId: "T6_FARM_SHEEP_GROWN", name: "Sheep [T6]" },
  { babyId: "T7_FARM_PIG_BABY", grownId: "T7_FARM_PIG_GROWN", name: "Pig [T7]" },
  { babyId: "T8_FARM_COW_BABY", grownId: "T8_FARM_COW_GROWN", name: "Cow [T8]" },

  // Special mounts
  { babyId: "T4_FARM_GIANTSTAG_BABY", grownId: "T4_FARM_GIANTSTAG_GROWN", name: "Giant Stag [T4]" },

  { babyId: "T5_FARM_COUGAR_BABY", grownId: "T5_FARM_COUGAR_GROWN", name: "Swiftclaw [T5]" },
  { babyId: "T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY", grownId: "T5_FARM_SWAMPDRAGON_FW_THETFORD_GROWN", name: "Swamp Salamander [T5]" },
  { babyId: "T5_FARM_DIREBEAR_FW_FORTSTERLING_BABY", grownId: "T5_FARM_DIREBEAR_FW_FORTSTERLING_GROWN", name: "Winter Bear [T5]" },
  { babyId: "T5_FARM_DIREBOAR_FW_LYMHURST_BABY", grownId: "T5_FARM_DIREBOAR_FW_LYMHURST_GROWN", name: "Wild Boar [T5]" },
  { babyId: "T5_FARM_GREYWOLF_FW_CAERLEON_BABY", grownId: "T5_FARM_GREYWOLF_FW_CAERLEON_GROWN", name: "Greywolf [T5]" },
  { babyId: "T5_FARM_MOABIRD_FW_BRIDGEWATCH_BABY", grownId: "T5_FARM_MOABIRD_FW_BRIDGEWATCH_GROWN", name: "Moabird FW [T5]" },
  { babyId: "T5_FARM_RAM_FW_MARTLOCK_BABY", grownId: "T5_FARM_RAM_FW_MARTLOCK_GROWN", name: "Bighorn Ram [T5]" },
  { babyId: "T5_FARM_OWL_FW_BRECILIEN_BABY", grownId: "T5_FARM_OWL_FW_BRECILIEN_GROWN", name: "Mystic Owl [T5]" },
  { babyId: "T5_FARM_SPIDER_HELL_BABY", grownId: "T5_FARM_SPIDER_HELL_GROWN", name: "Hellspinner [T5]" },

  { babyId: "T6_FARM_GIANTSTAG_BABY", grownId: "T6_FARM_GIANTSTAG_GROWN", name: "Giant Stag [T6]" },
  { babyId: "T6_FARM_GIANTSTAG_MOOSE_BABY", grownId: "T6_FARM_GIANTSTAG_MOOSE_GROWN", name: "Moose [T6]" },
  { babyId: "T6_FARM_DIREWOLF_BABY", grownId: "T6_FARM_DIREWOLF_GROWN", name: "Direwolf [T6]" },

  { babyId: "T7_FARM_DIREBOAR_BABY", grownId: "T7_FARM_DIREBOAR_GROWN", name: "Direboar [T7]" },
  { babyId: "T7_FARM_SWAMPDRAGON_BABY", grownId: "T7_FARM_SWAMPDRAGON_GROWN", name: "Swamp Dragon [T7]" },

  { babyId: "T8_FARM_DIREBEAR_BABY", grownId: "T8_FARM_DIREBEAR_GROWN", name: "Direbear [T8]" },
  { babyId: "T8_FARM_MAMMOTH_BABY", grownId: "T8_FARM_MAMMOTH_GROWN", name: "Mammoth [T8]" },
  { babyId: "T8_FARM_DIREWOLF_BABY", grownId: "T8_FARM_DIREWOLF_GROWN", name: "Ghostwolf [T8]" },
  { babyId: "T8_FARM_SWAMPDRAGON_FW_THETFORD_BABY", grownId: "T8_FARM_SWAMPDRAGON_FW_THETFORD_GROWN", name: "Elite Swamp Salamander [T8]" },
  { babyId: "T8_FARM_DIREBEAR_FW_FORTSTERLING_BABY", grownId: "T8_FARM_DIREBEAR_FW_FORTSTERLING_GROWN", name: "Elite Winter Bear [T8]" },
  { babyId: "T8_FARM_DIREBOAR_FW_LYMHURST_BABY", grownId: "T8_FARM_DIREBOAR_FW_LYMHURST_GROWN", name: "Elite Wild Boar [T8]" },
  { babyId: "T8_FARM_GREYWOLF_FW_CAERLEON_BABY", grownId: "T8_FARM_GREYWOLF_FW_CAERLEON_GROWN", name: "Elite Greywolf [T8]" },
  { babyId: "T8_FARM_MOABIRD_FW_BRIDGEWATCH_BABY", grownId: "T8_FARM_MOABIRD_FW_BRIDGEWATCH_GROWN", name: "Elite Terrorbird [T8]" },
  { babyId: "T8_FARM_RAM_FW_MARTLOCK_BABY", grownId: "T8_FARM_RAM_FW_MARTLOCK_GROWN", name: "Elite Bighorn Ram [T8]" },
  { babyId: "T8_FARM_OWL_FW_BRECILIEN_BABY", grownId: "T8_FARM_OWL_FW_BRECILIEN_GROWN", name: "Elite Mystic Owl [T8]" },
  { babyId: "T8_FARM_SPIDER_HELL_BABY", grownId: "T8_FARM_SPIDER_HELL_GROWN", name: "Soulspinner [T8]" },

  // Dragonfire (2026-08-31). The egg drops from Azaryon; it never breeds itself
  // back (offspring chance 0) and it is raised on MOUNTS, not crops or meat.
  { babyId: "T8_FARM_DRAKE_BABY", grownId: "T8_FARM_DRAKE_GROWN", name: "Firewing Drake [T8]", babyName: "Firewing Drake Egg", grownName: "Tame Firewing Drake" },

  // Seasonal mounts
  { babyId: "T8_FARM_RABBIT_EASTER_BABY", grownId: "T8_FARM_RABBIT_EASTER_GROWN", name: "Spring Cottontail [T8]" },
];

// Nurture mechanics per baby. Source: items.xml farmableitem attrs
// (activefarmfocuscost / activefarmmaxcycles / activefarmbonus) and the
// grownitem <offspring chance>. Focus cost per cycle is a flat 1000 before
// mastery reductions. baseOffspring is the offspring chance without nurture;
// rare mounts (stags, wolves, bears, cougars, mammoths, swamp dragons,
// FW mounts, cottontails) all have 0 and gain offspring only via nurture.
const BREEDING_NURTURE_DATA = {
  // Long-grow Horses (bonus decays with tier; cycles = tier - 2)
  T3_FARM_HORSE_BABY:  { maxCycles: 1, bonusPerCycle: 0.2000, baseOffspring: 0.8400 },
  T4_FARM_HORSE_BABY:  { maxCycles: 2, bonusPerCycle: 0.1333, baseOffspring: 0.7867 },
  T5_FARM_HORSE_BABY:  { maxCycles: 3, bonusPerCycle: 0.0889, baseOffspring: 0.7867 },
  T6_FARM_HORSE_BABY:  { maxCycles: 4, bonusPerCycle: 0.0593, baseOffspring: 0.8104 },
  T7_FARM_HORSE_BABY:  { maxCycles: 5, bonusPerCycle: 0.0395, baseOffspring: 0.8420 },
  T8_FARM_HORSE_BABY:  { maxCycles: 6, bonusPerCycle: 0.0263, baseOffspring: 0.8736 },

  // Long-grow Oxen (mirror horses)
  T3_FARM_OX_BABY:     { maxCycles: 1, bonusPerCycle: 0.2000, baseOffspring: 0.8400 },
  T4_FARM_OX_BABY:     { maxCycles: 2, bonusPerCycle: 0.1333, baseOffspring: 0.7867 },
  T5_FARM_OX_BABY:     { maxCycles: 3, bonusPerCycle: 0.0889, baseOffspring: 0.7867 },
  T6_FARM_OX_BABY:     { maxCycles: 4, bonusPerCycle: 0.0593, baseOffspring: 0.8104 },
  T7_FARM_OX_BABY:     { maxCycles: 5, bonusPerCycle: 0.0395, baseOffspring: 0.8420 },
  T8_FARM_OX_BABY:     { maxCycles: 6, bonusPerCycle: 0.0263, baseOffspring: 0.8736 },

  // Short-grow Livestock (all capped at 1 nurture)
  T3_FARM_CHICKEN_BABY: { maxCycles: 1, bonusPerCycle: 0.8000, baseOffspring: 0.6000 },
  T4_FARM_GOAT_BABY:    { maxCycles: 1, bonusPerCycle: 0.5333, baseOffspring: 0.7333 },
  T5_FARM_GOOSE_BABY:   { maxCycles: 1, bonusPerCycle: 0.4000, baseOffspring: 0.8000 },
  T6_FARM_SHEEP_BABY:   { maxCycles: 1, bonusPerCycle: 0.2667, baseOffspring: 0.8667 },
  T7_FARM_PIG_BABY:     { maxCycles: 1, bonusPerCycle: 0.1778, baseOffspring: 0.9111 },
  T8_FARM_COW_BABY:     { maxCycles: 1, bonusPerCycle: 0.1333, baseOffspring: 0.9333 },

  // Rare mounts — base offspring 0, focus is the only way to earn one
  T4_FARM_GIANTSTAG_BABY:       { maxCycles: 2, bonusPerCycle: 0.175,  baseOffspring: 0 },
  T5_FARM_COUGAR_BABY:          { maxCycles: 3, bonusPerCycle: 0.10,   baseOffspring: 0 },
  T6_FARM_GIANTSTAG_BABY:       { maxCycles: 4, bonusPerCycle: 0.06,   baseOffspring: 0 },
  T6_FARM_GIANTSTAG_MOOSE_BABY: { maxCycles: 4, bonusPerCycle: 0.06,   baseOffspring: 0 },
  T6_FARM_DIREWOLF_BABY:        { maxCycles: 4, bonusPerCycle: 0.06,   baseOffspring: 0 },
  T7_FARM_DIREBOAR_BABY:        { maxCycles: 5, bonusPerCycle: 0.04,   baseOffspring: 0 },
  T7_FARM_SWAMPDRAGON_BABY:     { maxCycles: 5, bonusPerCycle: 0.04,   baseOffspring: 0 },
  T8_FARM_DIREBEAR_BABY:        { maxCycles: 6, bonusPerCycle: 0.0250, baseOffspring: 0 },
  T8_FARM_MAMMOTH_BABY:         { maxCycles: 6, bonusPerCycle: 0.0250, baseOffspring: 0 },
  T8_FARM_DIREWOLF_BABY:        { maxCycles: 6, bonusPerCycle: 0.0250, baseOffspring: 0 },
  // Firewing Drake — 14 cycles at a token 0.4% each (items.xml
  // activefarmmaxcycles / activefarmbonus). Even fully nurtured that is 5.6%,
  // so the egg is effectively single-use.
  T8_FARM_DRAKE_BABY:           { maxCycles: 14, bonusPerCycle: 0.004, baseOffspring: 0 },

  // Faction-Warfare T5 (all 3 cycles × 10%)
  T5_FARM_MOABIRD_FW_BRIDGEWATCH_BABY:  { maxCycles: 3, bonusPerCycle: 0.10, baseOffspring: 0 },
  T5_FARM_DIREBEAR_FW_FORTSTERLING_BABY: { maxCycles: 3, bonusPerCycle: 0.10, baseOffspring: 0 },
  T5_FARM_DIREBOAR_FW_LYMHURST_BABY:    { maxCycles: 3, bonusPerCycle: 0.10, baseOffspring: 0 },
  T5_FARM_RAM_FW_MARTLOCK_BABY:         { maxCycles: 3, bonusPerCycle: 0.10, baseOffspring: 0 },
  T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY: { maxCycles: 3, bonusPerCycle: 0.10, baseOffspring: 0 },
  T5_FARM_GREYWOLF_FW_CAERLEON_BABY:    { maxCycles: 3, bonusPerCycle: 0.10, baseOffspring: 0 },
  T5_FARM_OWL_FW_BRECILIEN_BABY:        { maxCycles: 3, bonusPerCycle: 0.10, baseOffspring: 0 },
  T5_FARM_SPIDER_HELL_BABY:             { maxCycles: 3, bonusPerCycle: 0.10, baseOffspring: 0 },

  // Faction-Warfare T8 elites (6 cycles × 2.5%)
  T8_FARM_MOABIRD_FW_BRIDGEWATCH_BABY:  { maxCycles: 6, bonusPerCycle: 0.025, baseOffspring: 0 },
  T8_FARM_DIREBEAR_FW_FORTSTERLING_BABY: { maxCycles: 6, bonusPerCycle: 0.025, baseOffspring: 0 },
  T8_FARM_DIREBOAR_FW_LYMHURST_BABY:    { maxCycles: 6, bonusPerCycle: 0.025, baseOffspring: 0 },
  T8_FARM_RAM_FW_MARTLOCK_BABY:         { maxCycles: 6, bonusPerCycle: 0.025, baseOffspring: 0 },
  T8_FARM_SWAMPDRAGON_FW_THETFORD_BABY: { maxCycles: 6, bonusPerCycle: 0.025, baseOffspring: 0 },
  T8_FARM_GREYWOLF_FW_CAERLEON_BABY:    { maxCycles: 6, bonusPerCycle: 0.025, baseOffspring: 0 },
  T8_FARM_OWL_FW_BRECILIEN_BABY:        { maxCycles: 6, bonusPerCycle: 0.025, baseOffspring: 0 },
  T8_FARM_SPIDER_HELL_BABY:             { maxCycles: 6, bonusPerCycle: 0.025, baseOffspring: 0 },

  // Seasonal cottontails (short-grow, 1 nurture × 10%)
  T8_FARM_RABBIT_EASTER_BABY:      { maxCycles: 1, bonusPerCycle: 0.10, baseOffspring: 0 },
  T8_FARM_RABBIT_EASTER_DARK_BABY: { maxCycles: 1, bonusPerCycle: 0.10, baseOffspring: 0 },
};

// Focus per nurture. Same charge as watering a farm plot — the game's
// 1000 * 0.5^(focus cost efficiency / 100), 1,000 at no spec down to 125 at full
// spec (Albion forum thread 78912 / the Island Farms wiki page).
//
// The FARM_ANIMALS tree grants 30,000 Focus Cost Efficiency at max
// (js/focus-spec-items.js): 1 per Animal Breeder level + 2 per animal level. The
// ⚙ Specs panel on the Mounts / Faction Spending tables scales between the two —
// drop the animal's node and the nurture cost climbs toward the 1,000 base.
//
// Two errors used to cancel here: the generator double-counted FARM_ANIMALS
// (40,000 FCE) and the base was back-solved to 1,600 so max spec would read 100.
// Both are fixed; max spec now reads the game's 125.
const BREEDING_NURTURE_BASE_FOCUS = 1000;
const BREEDING_NURTURE_FOCUS_PER_CYCLE = 125; // max spec (30,000 FCE), the fallback figure

function getNurtureFocusCost(babyId) {
  const mult = typeof focusSpecMultiplier === "function"
    ? focusSpecMultiplier(babyId)
    : Math.pow(0.5, 3); // no spec data loaded → the max-spec default (30,000 FCE)
  return Math.max(1, Math.round(BREEDING_NURTURE_BASE_FOCUS * mult));
}

// The floor getNurtureFocusCost can reach: every breeding node at 100, i.e.
// FCE = Σ bonus × 100 × 100 → multiplier 0.5^(Σ bonus). Every farm baby pairs
// the +1/level Animal Breeder mastery with one +2/level specialist, so this is
// 125 across the board — but summing the family keeps it honest if a node set
// ever changes. The row prints it so "(max spec)" is claimed only when true.
function getNurtureFocusMaxSpec(babyId) {
  if (typeof specNodesForItem !== "function") return BREEDING_NURTURE_FOCUS_PER_CYCLE;
  const nodes = specNodesForItem(babyId);
  if (!nodes.length) return BREEDING_NURTURE_FOCUS_PER_CYCLE;
  const bonusSum = nodes.reduce((sum, [, bonus]) => sum + bonus, 0);
  return Math.max(1, Math.round(BREEDING_NURTURE_BASE_FOCUS * Math.pow(0.5, bonusSum)));
}

// Base masterpiece chance for the saddler craft. Albion's craft quality table
// is Normal 68.8% / Good 25% / Outstanding 5% / Excellent 1.1% / Masterpiece 0.1%.
// The animal-breeder/saddler specialization adds RRR but no quality bonus per
// the wiki, so this 0.1% baseline applies uniformly to every saddler craft
// regardless of mount tier or mastery level.
const MOUNT_MP_CHANCE = 0.001;
