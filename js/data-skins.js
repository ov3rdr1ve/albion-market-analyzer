/**
 * Tradeable vanity-skin catalog for the Skins Trading table.
 *
 * In Albion the *applied* skin (the SKIN_* mount appearance, the
 * UNIQUE_ARMOR_VANITY_* costume you've already used) is account-bound — it
 * carries `showinmarketplace="false"` and the market API returns nothing for it.
 * The TRADEABLE form is the wardrobe "unlock token": `UNIQUE_UNLOCK_*_VANITY_*`.
 * You buy/sell the token on the Marketplace; using it consumes the token and
 * unlocks the skin account-wide.
 *
 * This list is the genuinely tradeable subset only — the `_TELLAFRIEND`
 * (referral), `_NON_TRADABLE` and internal `_COPY` unlock tokens are excluded
 * because they never reach the auction house. Ids + EN-US names are taken
 * verbatim from the ao-bin-dumps (items.xml / items.json), so they hit the
 * market API directly. Regenerate after a dump refresh with:
 *   node scripts/gen-skins-catalog.cjs   (see that script's header)
 */

const SKIN_TRADE_ITEMS = [
  // -- Armor --
  { id: "UNIQUE_UNLOCK_ARMOR_VANITY_DRAGON_FACTION", slot: "Armor", name: "Ancient Mystic's Garb" },
  { id: "UNIQUE_UNLOCK_ARMOR_VANITY_GLADIATOR_ARENA", slot: "Armor", name: "Arena Gladiator Armor" },
  { id: "UNIQUE_UNLOCK_ARMOR_VANITY_ARENA_SET_01", slot: "Armor", name: "Arena Veteran's Cloak" },
  { id: "UNIQUE_UNLOCK_ARMOR_VANITY_DRAGONKEEPER_AJ", slot: "Armor", name: "Ashborn Armor" },
  { id: "UNIQUE_UNLOCK_ARMOR_VANITY_WEDDING_DRESS", slot: "Armor", name: "Bridal Dress" },
  { id: "UNIQUE_UNLOCK_ARMOR_VANITY_EASTER", slot: "Armor", name: "Bunny Stalker Overalls" },
  { id: "UNIQUE_UNLOCK_ARMOR_VANITY_WARRIOR_KNIGHT", slot: "Armor", name: "Champion's Armor" },
  { id: "UNIQUE_UNLOCK_ARMOR_VANITY_GLADIATOR_CRYSTAL", slot: "Armor", name: "Crystal Gladiator Armor" },
  { id: "UNIQUE_UNLOCK_ARMOR_VANITY_WEALTHY_NOBLE_AJ", slot: "Armor", name: "Decadent Robe" },
  { id: "UNIQUE_UNLOCK_ARMOR_VANITY_VERY_WEALTHY_NOBLE_AJ", slot: "Armor", name: "Exorbitant Robe" },
  { id: "UNIQUE_UNLOCK_ARMOR_VANITY_WEDDING_TUXEDO", slot: "Armor", name: "Groom's Suit" },
  { id: "UNIQUE_UNLOCK_ARMOR_VANITY_DARK_SORCERER", slot: "Armor", name: "Harbinger's Robes" },
  { id: "UNIQUE_UNLOCK_ARMOR_VANITY_PLAGUEDOC", slot: "Armor", name: "Hygienic Coat" },
  { id: "UNIQUE_UNLOCK_ARMOR_VANITY_JESTER", slot: "Armor", name: "Jester Costume" },
  { id: "UNIQUE_UNLOCK_ARMOR_VANITY_WARRIOR_KING", slot: "Armor", name: "Paragon's Armor" },
  { id: "UNIQUE_UNLOCK_ARMOR_VANITY_DRESS_RED", slot: "Armor", name: "Red Tulip Dress" },
  { id: "UNIQUE_UNLOCK_ARMOR_VANITY_SKELETON", slot: "Armor", name: "Ribcage" },
  { id: "UNIQUE_UNLOCK_ARMOR_VANITY_RICH_NOBLE", slot: "Armor", name: "Rich Noble's Doublet" },
  { id: "UNIQUE_UNLOCK_ARMOR_VANITY_FOUNDER_ASIA_CRYSTAL", slot: "Armor", name: "Sea Captain's Coat" },
  { id: "UNIQUE_UNLOCK_ARMOR_VANITY_FOUNDER_ASIA_GOLD", slot: "Armor", name: "Seafarer's Coat" },
  { id: "UNIQUE_UNLOCK_ARMOR_VANITY_SMUGGLER", slot: "Armor", name: "Smuggler's Coat" },
  { id: "UNIQUE_UNLOCK_ARMOR_VANITY_SKELETON_UNDEAD", slot: "Armor", name: "Undead Ribcage" },
  { id: "UNIQUE_UNLOCK_ARMOR_VANITY_KICKSTART_2024", slot: "Armor", name: "Warden's Armor" },
  { id: "UNIQUE_UNLOCK_ARMOR_VANITY_KICKSTART_2024_UPGRADE", slot: "Armor", name: "Warden's Legendary Armor" },
  { id: "UNIQUE_UNLOCK_ARMOR_VANITY_DARK_NOVICE", slot: "Armor", name: "Warlock's Robes" },
  { id: "UNIQUE_UNLOCK_ARMOR_VANITY_SANTACLAUS", slot: "Armor", name: "Yule Coat" },
  // -- Cape --
  { id: "UNIQUE_UNLOCK_CAPE_VANITY_DRAGON_FACTION", slot: "Cape", name: "Ancient Mystic's Cape" },
  { id: "UNIQUE_UNLOCK_CAPE_VANITY_GLADIATOR_ARENA", slot: "Cape", name: "Arena Gladiator Cape" },
  { id: "UNIQUE_UNLOCK_CAPE_VANITY_ARENA_SET_01", slot: "Cape", name: "Arena Veteran's Cape" },
  { id: "UNIQUE_UNLOCK_CAPE_VANITY_WARRIOR_KNIGHT", slot: "Cape", name: "Champion's Sword and Cape" },
  { id: "UNIQUE_UNLOCK_CAPE_VANITY_GLADIATOR_CRYSTAL", slot: "Cape", name: "Crystal Gladiator Cape" },
  { id: "UNIQUE_UNLOCK_CAPE_VANITY_WEDDING_TUXEDO", slot: "Cape", name: "Groom's Cape" },
  { id: "UNIQUE_UNLOCK_CAPE_VANITY_DARK_SORCERER", slot: "Cape", name: "Harbinger's Staff and Cape" },
  { id: "UNIQUE_UNLOCK_CAPE_VANITY_WARRIOR_KING", slot: "Cape", name: "Paragon's Sword and Cape" },
  { id: "UNIQUE_UNLOCK_CAPE_VANITY_SKELETON", slot: "Cape", name: "Ragged Cape" },
  { id: "UNIQUE_UNLOCK_CAPE_VANITY_SKELETON_UNDEAD", slot: "Cape", name: "Ragged Undead Cape" },
  { id: "UNIQUE_UNLOCK_CAPE_VANITY_FOUNDER_ASIA_CRYSTAL", slot: "Cape", name: "Sea Captain's Spyglass" },
  { id: "UNIQUE_UNLOCK_CAPE_VANITY_FOUNDER_ASIA_GOLD", slot: "Cape", name: "Seafarer's Harpoon" },
  { id: "UNIQUE_UNLOCK_CAPE_VANITY_SMUGGLER", slot: "Cape", name: "Smuggler's Cloak" },
  { id: "UNIQUE_UNLOCK_CAPE_VANITY_KICKSTART_2024", slot: "Cape", name: "Warden's Axe" },
  { id: "UNIQUE_UNLOCK_CAPE_VANITY_KICKSTART_2024_UPGRADE", slot: "Cape", name: "Warden's Legendary Axe" },
  { id: "UNIQUE_UNLOCK_CAPE_VANITY_DARK_NOVICE", slot: "Cape", name: "Warlock's Staff and Cape" },
  // -- Head --
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_DRAGON_FACTION", slot: "Head", name: "Ancient Mystic's Mask" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_PUMPKIN_03", slot: "Head", name: "Angry Pumpkin Head" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_GLADIATOR_ARENA", slot: "Head", name: "Arena Gladiator Helm" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_ARENA_SET_01", slot: "Head", name: "Arena Veteran's Circlet" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_ARENA_EYEPATCH", slot: "Head", name: "Arena Veteran's Eyepatch" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_DRAGONKEEPER_AJ", slot: "Head", name: "Ashborn Helmet" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_WEDDING_DRESS", slot: "Head", name: "Bridal Veil" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_EASTER_BROWN", slot: "Head", name: "Bunny Stalker Hat" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_WARRIOR_KNIGHT", slot: "Head", name: "Champion's Visage" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_GLADIATOR_CRYSTAL", slot: "Head", name: "Crystal Gladiator Helm" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_FARMER_COZY_AJ", slot: "Head", name: "Delightful Straw Hat" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_DESTINY_STONES_AJ", slot: "Head", name: "Destiny's Circlet" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_DESTINY_STONES_ADVANCED_AJ", slot: "Head", name: "Fullfilled Destiny's Circlet" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_PUMPKIN_01", slot: "Head", name: "Grinning Pumpkin Head" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_WEDDING_TUXEDO", slot: "Head", name: "Groom's Hat" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_DARK_SORCERER", slot: "Head", name: "Harbinger's Crown" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_PLAGUEDOC", slot: "Head", name: "Hygienic Mask" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_JESTER", slot: "Head", name: "Jester Mask" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_SKELETON", slot: "Head", name: "Laughing Skull" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_FARMER_AJ", slot: "Head", name: "Lovely Straw Hat" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_SHADOW_HELMET_RED_AJ", slot: "Head", name: "Malevolent Helmet" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_WARRIOR_KING", slot: "Head", name: "Paragon's Crown" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_DRESS_RED", slot: "Head", name: "Red Tulip Hat" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_RICH_NOBLE", slot: "Head", name: "Rich Noble's Hat" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_PUMPKIN_02", slot: "Head", name: "Sad Pumpkin Head" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_FOUNDER_ASIA_CRYSTAL", slot: "Head", name: "Sea Captain's Hat" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_FOUNDER_ASIA_GOLD", slot: "Head", name: "Seafarer's Bandana" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_SHADOW_HELMET_ORANGE_AJ", slot: "Head", name: "Sinister Helmet" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_SMUGGLER", slot: "Head", name: "Smuggler's Hat" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_EASTER_WHITE", slot: "Head", name: "Snow Bunny Stalker Hat" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_SKELETON_UNDEAD", slot: "Head", name: "Undead Skull" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_KICKSTART_2024", slot: "Head", name: "Warden's Helmet" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_KICKSTART_2024_UPGRADE", slot: "Head", name: "Warden's Legendary Helmet" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_DARK_NOVICE", slot: "Head", name: "Warlock's Circlet" },
  { id: "UNIQUE_UNLOCK_HEAD_VANITY_SANTACLAUS", slot: "Head", name: "Yule Hat" },
  // -- Shoes --
  { id: "UNIQUE_UNLOCK_SHOES_VANITY_DRAGON_FACTION", slot: "Shoes", name: "Ancient Mystic's Boots" },
  { id: "UNIQUE_UNLOCK_SHOES_VANITY_GLADIATOR_ARENA", slot: "Shoes", name: "Arena Gladiator Boots" },
  { id: "UNIQUE_UNLOCK_SHOES_VANITY_ARENA_SET_01", slot: "Shoes", name: "Arena Veteran's Boots" },
  { id: "UNIQUE_UNLOCK_SHOES_VANITY_WEDDING_DRESS", slot: "Shoes", name: "Bridal Shoes" },
  { id: "UNIQUE_UNLOCK_SHOES_VANITY_EASTER", slot: "Shoes", name: "Bunny Stalker Shoes" },
  { id: "UNIQUE_UNLOCK_SHOES_VANITY_WARRIOR_KNIGHT", slot: "Shoes", name: "Champion's Boots" },
  { id: "UNIQUE_UNLOCK_SHOES_VANITY_GLADIATOR_CRYSTAL", slot: "Shoes", name: "Crystal Gladiator Boots" },
  { id: "UNIQUE_UNLOCK_SHOES_VANITY_WEDDING_TUXEDO", slot: "Shoes", name: "Groom's Shoes" },
  { id: "UNIQUE_UNLOCK_SHOES_VANITY_DARK_SORCERER", slot: "Shoes", name: "Harbinger's Boots" },
  { id: "UNIQUE_UNLOCK_SHOES_VANITY_PLAGUEDOC", slot: "Shoes", name: "Hygienic Boots" },
  { id: "UNIQUE_UNLOCK_SHOES_VANITY_JESTER", slot: "Shoes", name: "Jester Shoes" },
  { id: "UNIQUE_UNLOCK_SHOES_VANITY_SKELETON", slot: "Shoes", name: "Legbones" },
  { id: "UNIQUE_UNLOCK_SHOES_VANITY_WARRIOR_KING", slot: "Shoes", name: "Paragon's Boots" },
  { id: "UNIQUE_UNLOCK_SHOES_VANITY_DRESS_RED", slot: "Shoes", name: "Red Tulip Shoes" },
  { id: "UNIQUE_UNLOCK_SHOES_VANITY_RICH_NOBLE", slot: "Shoes", name: "Rich Noble's Footwear" },
  { id: "UNIQUE_UNLOCK_SHOES_VANITY_FOUNDER_ASIA_CRYSTAL", slot: "Shoes", name: "Sea Captain's Boots" },
  { id: "UNIQUE_UNLOCK_SHOES_VANITY_FOUNDER_ASIA_GOLD", slot: "Shoes", name: "Seafarer's Boots" },
  { id: "UNIQUE_UNLOCK_SHOES_VANITY_SMUGGLER", slot: "Shoes", name: "Smuggler's Boots" },
  { id: "UNIQUE_UNLOCK_SHOES_VANITY_SKELETON_UNDEAD", slot: "Shoes", name: "Undead Legs" },
  { id: "UNIQUE_UNLOCK_SHOES_VANITY_KICKSTART_2024", slot: "Shoes", name: "Warden's Boots" },
  { id: "UNIQUE_UNLOCK_SHOES_VANITY_KICKSTART_2024_UPGRADE", slot: "Shoes", name: "Warden's Legendary Boots" },
  { id: "UNIQUE_UNLOCK_SHOES_VANITY_DARK_NOVICE", slot: "Shoes", name: "Warlock's Boots" },
  { id: "UNIQUE_UNLOCK_SHOES_VANITY_SANTACLAUS", slot: "Shoes", name: "Yule Shoes" },
  // -- Offhand --
  { id: "UNIQUE_UNLOCK_OFF_VANITY_WEDDING_DRESS", slot: "Offhand", name: "Bridal Bouquet" },
  { id: "UNIQUE_UNLOCK_OFF_VANITY_CHARITY_MARCH2020", slot: "Offhand", name: "Staff of Hermes" },
  { id: "UNIQUE_UNLOCK_OFF_VANITY_WEDDING_TUXEDO", slot: "Offhand", name: "Wedding Ring" },
  // -- Backpack --
  { id: "UNIQUE_UNLOCK_BACKPACK_VANITY_EASTER", slot: "Backpack", name: "Bunny Stalker Basket" },
  { id: "UNIQUE_UNLOCK_BACKPACK_VANITY_KICKSTART", slot: "Backpack", name: "Warden's Backpack" },
  { id: "UNIQUE_UNLOCK_BACKPACK_VANITY_SANTACLAUS", slot: "Backpack", name: "Yule Backpack" },
  // -- Weapon --
  { id: "UNIQUE_UNLOCK_VANITY_2H_FW_BRIDGEWATCH_BANNER", slot: "Weapon", name: "Bridgewatch Warbanner" },
  { id: "UNIQUE_UNLOCK_VANITY_2H_FW_CAERLEON_BANNER", slot: "Weapon", name: "Caerleon Warbanner" },
  { id: "UNIQUE_UNLOCK_VANITY_MAIN_DICE_SIXSIDED_AJ", slot: "Weapon", name: "Cube of Fate" },
  { id: "UNIQUE_UNLOCK_VANITY_2H_SKULL_DEMON_AJ", slot: "Weapon", name: "Demon Skull" },
  { id: "UNIQUE_UNLOCK_VANITY_2H_GUN_ANNIVERSARY", slot: "Weapon", name: "Firework Launcher: Chromacannon" },
  { id: "UNIQUE_UNLOCK_VANITY_2H_FW_FORTSTERLING_BANNER", slot: "Weapon", name: "Fort Sterling Warbanner" },
  { id: "UNIQUE_UNLOCK_VANITY_2H_BANNER_GUIDON_GOLDEN_AJ", slot: "Weapon", name: "Glorious Heraldic Guidon" },
  { id: "UNIQUE_UNLOCK_VANITY_2H_BANNER_GUIDON_AJ", slot: "Weapon", name: "Heraldic Guidon" },
  { id: "UNIQUE_UNLOCK_VANITY_MAIN_DICE_TWENTYSIDED_AJ", slot: "Weapon", name: "Icosahedron of Fate" },
  { id: "UNIQUE_UNLOCK_VANITY_2H_FW_LYMHURST_BANNER", slot: "Weapon", name: "Lymhurst Warbanner" },
  { id: "UNIQUE_UNLOCK_VANITY_2H_FW_MARTLOCK_BANNER", slot: "Weapon", name: "Martlock Warbanner" },
  { id: "UNIQUE_UNLOCK_VANITY_2H_MULTITOOL_OVERCHARGED_AJ", slot: "Weapon", name: "Razor-Sharp Axe" },
  { id: "UNIQUE_UNLOCK_VANITY_2H_MULTITOOL_AJ", slot: "Weapon", name: "Sharpened Axe" },
  { id: "UNIQUE_UNLOCK_UNIQUE_VANITY_2H_CHICKENGUN_EASTER", slot: "Weapon", name: "The Eggsecutioner" },
  { id: "UNIQUE_UNLOCK_VANITY_2H_FW_THETFORD_BANNER", slot: "Weapon", name: "Thetford Warbanner" },
  { id: "UNIQUE_UNLOCK_VANITY_2H_LUTE_MAGNIFICENT_AJ", slot: "Weapon", name: "Troubadour's Lute" },
  { id: "UNIQUE_UNLOCK_VANITY_2H_SKULL_UNDEAD_AJ", slot: "Weapon", name: "Undead Skull" },
  { id: "UNIQUE_UNLOCK_VANITY_2H_LUTE_AJ", slot: "Weapon", name: "Wanderer's Lute" },
  // -- Other --
  { id: "UNIQUE_UNLOCK_VANITY_HEAD_TUTORIAL_COMPLETED_AJ", slot: "Other", name: "Academic Biretta" },
  { id: "UNIQUE_UNLOCK_HORSE_VANITY_KICKSTART_2024_UPGRADE", slot: "Other", name: "Riding Horse Skin: Warden's Legendary Steed" },
  { id: "UNIQUE_UNLOCK_HORSE_VANITY_KICKSTART_2024", slot: "Other", name: "Riding Horse Skin: Warden's Steed" },
];

/** Ids the market scan must fetch for the Skins Trading table. */
function getSkinsItemIds() {
  return SKIN_TRADE_ITEMS.map((i) => i.id);
}
