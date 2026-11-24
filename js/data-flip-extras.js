/**
 * Tradeable families the Flipping table had no source for.
 *
 * getAllFlippingItems() (js/utils.js) unions the app's PRODUCTION catalogs —
 * gear, mounts, consumables, farming, resources, artifacts, luxury. Families the
 * app models only as a revenue line in another table (laborer trophies, which
 * live in js/data-laborers.js) or never catalogued at all (house furniture,
 * tomes, the saltwater catch) therefore never appeared as flips, even though a
 * full market scan already priced them. This file is that missing source.
 *
 * Ids only — display names come from ITEM_NAMES_MAP (js/item-names.js).
 *
 * Excluded on purpose: T2-T8 Battle Vault, T2-T5 Wardrobe and T6-T8 chests. They
 * carry <craftingrequirements> in items.xml but have NO EN-US localized name and
 * return no market data, i.e. they are not obtainable in game. Same rule drops
 * the *_CRYSTAL_DECAY artifacts, *_NONTRADABLE ids and the legacy event tokens.
 */

const TROPHY_LINES = ["FIBER", "FISH", "GENERAL", "HIDE", "MERCENARY", "ORE", "ROCK", "WOOD"];
const TROPHY_TIERS = [2, 3, 4, 5, 6, 7, 8];

/** Laborer happiness trophies — journal rewards, sold on the market. */
const FLIP_TROPHY_IDS = [
  ...TROPHY_LINES.flatMap((line) => TROPHY_TIERS.map((t) => `T${t}_FURNITUREITEM_TROPHY_${line}`)),
  // Trophy Shark: the only craftable trophy (shark + planks + bars), and the
  // only one that helps EVERY laborer type (+5 happiness, up to 10 laborers).
  "T8_FURNITUREITEM_TROPHY_FISHING_BOSS",
];

/** House/guild-hall furniture with a real recipe and a real market. */
const FLIP_FURNITURE_IDS = [
  ...[2, 3, 4, 5, 6, 7, 8].map((t) => `T${t}_FURNITUREITEM_BED`),
  ...[2, 3, 4, 5, 6, 7, 8].map((t) => `T${t}_FURNITUREITEM_TABLE`),
  ...[2, 3, 4, 5].map((t) => `T${t}_FURNITUREITEM_CHEST`),
  ...[4, 5, 6, 7, 8].map((t) => `T${t}_FURNITUREITEM_REPAIRKIT`),
];

/** Tome of Insight + the five gathering tomes (the dump marks them tradable). */
const FLIP_TOME_IDS = [
  "T4_SKILLBOOK_STANDARD",
  ...["FIBER", "HIDE", "ORE", "ROCK", "WOOD"].flatMap((line) =>
    [4, 5, 6, 7, 8].map((t) => `T${t}_SKILLBOOK_GATHER_${line}`),
  ),
];

/** Saltwater catch — the common fish line plus the boss shark. */
const FLIP_FISH_IDS = [
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((t) => `T${t}_FISH_SALTWATER_ALL_COMMON`),
  "T8_FISH_SALTWATER_ALL_BOSS_SHARK",
];

/**
 * Crests — the artifact-cape blueprints, one family per faction/city.
 *
 * The crest is the `matId` of its cape recipe (js/gear-capes.js), and
 * getAllFlippingItems() pushes recipe IDS only, never material ids, so no crest
 * could ever be a flip row even though all 14 families trade. Display names are
 * synthesized from the cape (getItemDisplayName, js/utils.js): "Adept's Undead
 * Crest". Unlike the cape, the crest itself does not enchant.
 */
const CREST_FAMILIES = [
  "AVALON", "DEMON", "HERETIC", "KEEPER", "MORGANA", "SMUGGLER", "UNDEAD",
  "FW_BRECILIEN", "FW_BRIDGEWATCH", "FW_CAERLEON", "FW_FORTSTERLING",
  "FW_LYMHURST", "FW_MARTLOCK", "FW_THETFORD",
];
const FLIP_CREST_IDS = CREST_FAMILIES.flatMap((fam) =>
  [4, 5, 6, 7, 8].map((t) => `T${t}_CAPEITEM_${fam}_BP`),
);

/**
 * Artifacts ARTIFACT_MAPPING (js/data-artifacts.js) does not carry.
 *
 * Black Leather is the Hell war-gloves artifact. It belongs here rather than in
 * ARTIFACT_MAPPING because that table also drives the Artifact Rolling meld
 * pool, which is pinned to the 136 verified meld outcomes — a flip-only
 * artifact must not change the roll odds.
 */
const FLIP_ARTIFACT_EXTRA_IDS = [4, 5, 6, 7, 8].map(
  (t) => `T${t}_ARTEFACT_2H_IRONGAUNTLETS_HELL`,
);

/**
 * Journals — the empty one you buy and the full one you sell.
 *
 * items.xml keys a journal by its carried form (`T2_JOURNAL_WOOD`); the market
 * trades the `_EMPTY` and `_FULL` ids. The carried, partially-filled journal
 * cannot be listed at all, so it is deliberately absent. The Journals table
 * already models the fill economics — this is the plain buy-low/sell-high side.
 */
const JOURNAL_LINES = [
  "WOOD", "STONE", "ORE", "FIBER", "HIDE", "FISHING",
  "WARRIOR", "HUNTER", "MAGE", "TOOLMAKER", "MERCENARY",
  "TROPHY_GENERAL", "TROPHY_MERCENARY", "TROPHY_HIDE", "TROPHY_WOOD",
  "TROPHY_STONE", "TROPHY_ORE", "TROPHY_FIBER", "TROPHY_FISHING",
];
const FLIP_JOURNAL_IDS = JOURNAL_LINES.flatMap((line) =>
  [2, 3, 4, 5, 6, 7, 8].flatMap((t) => [
    `T${t}_JOURNAL_${line}_EMPTY`,
    `T${t}_JOURNAL_${line}_FULL`,
  ]),
);

/**
 * Maps the curated FLIPPING_ITEMS list (js/data.js) leaves out: the eight
 * Corrupted Dungeon / Hellgate rituals, which the Crafting table already models
 * as Artifact Foundry crafts (js/data-maps.js) but which had no flip row, plus
 * the T3 solo dungeon map — FLIPPING_ITEMS starts that ladder at T4.
 */
const FLIP_DUNGEON_MAP_IDS = [
  "T3_RANDOM_DUNGEON_SOLO_TOKEN_1",
  "T5_CORRUPTED_NONLETHAL_MAP",
  "T6_CORRUPTED_LETHAL_MAP",
  "T5_HELLGATE_2V2_NON_LETHAL_1_MAP",
  "T5_HELLGATE_5V5_NON_LETHAL_1_MAP",
  "T5_HELLGATE_10V10_NON_LETHAL_1_MAP",
  "T6_HELLGATE_2V2_LETHAL_1_MAP",
  "T7_HELLGATE_5V5_LETHAL_1_MAP",
  "T8_HELLGATE_10V10_LETHAL_1_MAP",
];

/**
 * Rare animal remains (the potion inputs — see js/recipes-rare-potions.js),
 * the common remains, and the three arcane extracts. Rare remains exist at
 * T3/T5/T7 only ("Rugged"/"Fine"/"Excellent"), never on every tier.
 */
const REMAINS_LINES = ["PANTHER", "ENT", "DIREBEAR", "WEREWOLF", "IMP", "ELEMENTAL", "EAGLE"];
const FLIP_REMAINS_IDS = [
  ...REMAINS_LINES.flatMap((line) => [3, 5, 7].map((t) => `T${t}_ALCHEMY_RARE_${line}`)),
  "T1_ALCHEMY_COMMON",
  ...[1, 2, 3].map((lvl) => `T1_ALCHEMY_EXTRACT_LEVEL${lvl}`),
];

/** Faded Essence and the Arcane Essence brewed from it, T4-T8. */
const FLIP_ESSENCE_IDS = [4, 5, 6, 7, 8].flatMap((t) => [`T${t}_ESSENCE`, `T${t}_ESSENCE_POTION`]);

/**
 * Mount upgrade kits — the `matId`s of the Morgana/Keeper/Cursed mount crafts
 * (js/data-mounts.js). Only the tiers that exist; the *_XMAS bridles are event
 * cosmetics with no standing market.
 */
const FLIP_MOUNT_UPGRADE_IDS = [
  "T5_MOUNTUPGRADE_HORSE_CURSE",
  "T8_MOUNTUPGRADE_HORSE_CURSE",
  "T5_MOUNTUPGRADE_HORSE_MORGANA",
  "T8_MOUNTUPGRADE_HORSE_MORGANA",
  "T8_MOUNTUPGRADE_COUGAR_KEEPER",
];

/**
 * Faction and zone tokens. Tierless drops that trade steadily: Keeper Totem,
 * Morgana's Favor, Undead Knucklebone, Avalonian Energy, Faerie Fire (Mists)
 * and the Smuggler's Coin.
 */
const FLIP_TOKEN_IDS = ["KEEPER", "MORGANA", "UNDEAD", "AVALON", "MISTS", "SMUGGLER"].map(
  (faction) => `QUESTITEM_TOKEN_${faction}`,
);

const FLIP_EXTRA_IDS = [
  ...FLIP_TROPHY_IDS,
  ...FLIP_FURNITURE_IDS,
  ...FLIP_TOME_IDS,
  ...FLIP_FISH_IDS,
  ...FLIP_CREST_IDS,
  ...FLIP_ARTIFACT_EXTRA_IDS,
  ...FLIP_JOURNAL_IDS,
  ...FLIP_DUNGEON_MAP_IDS,
  ...FLIP_REMAINS_IDS,
  ...FLIP_ESSENCE_IDS,
  ...FLIP_MOUNT_UPGRADE_IDS,
  ...FLIP_TOKEN_IDS,
];

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    FLIP_EXTRA_IDS,
    FLIP_TROPHY_IDS,
    FLIP_FURNITURE_IDS,
    FLIP_TOME_IDS,
    FLIP_FISH_IDS,
    FLIP_CREST_IDS,
    FLIP_ARTIFACT_EXTRA_IDS,
    FLIP_JOURNAL_IDS,
    FLIP_DUNGEON_MAP_IDS,
    FLIP_REMAINS_IDS,
    FLIP_ESSENCE_IDS,
    FLIP_MOUNT_UPGRADE_IDS,
    FLIP_TOKEN_IDS,
  };
}
