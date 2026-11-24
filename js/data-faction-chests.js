/**
 * Iron Campaign Chests purchasable from each Faction Enlistment NPC.
 *
 * Bronze/Silver/Gold campaign chests are excluded — those are monthly campaign
 * rewards earned by reaching FP thresholds, not buyable on demand at the NPC.
 *
 * Sealed chests are NOT tradeable on the market (no listings observed via
 * albion-online-data API). Their "value" is the expected silver yield from
 * opening them, which is highly variable. The default is ~76,000 silver per
 * chest (≈500K observed across a 7-chest sample); overrideable per row.
 *
 * Source for FP cost (9,000): https://wiki.albiononline.com/wiki/Faction_Enlistment_NPC
 */
const FACTION_CHESTS = [
  {
    id: "UNIQUE_LOOTCHEST_FACTIONCAMPAIGN_REWARD_SWAMP_01",
    name: "Iron Campaign Chest: Thetford",
    city: "Thetford",
    biome: "swamp",
  },
  {
    id: "UNIQUE_LOOTCHEST_FACTIONCAMPAIGN_REWARD_FOREST_01",
    name: "Iron Campaign Chest: Lymhurst",
    city: "Lymhurst",
    biome: "forest",
  },
  {
    id: "UNIQUE_LOOTCHEST_FACTIONCAMPAIGN_REWARD_MOUNTAIN_01",
    name: "Iron Campaign Chest: Fort Sterling",
    city: "Fort Sterling",
    biome: "mountain",
  },
  {
    id: "UNIQUE_LOOTCHEST_FACTIONCAMPAIGN_REWARD_HIGHLAND_01",
    name: "Iron Campaign Chest: Martlock",
    city: "Martlock",
    biome: "highland",
  },
  {
    id: "UNIQUE_LOOTCHEST_FACTIONCAMPAIGN_REWARD_STEPPE_01",
    name: "Iron Campaign Chest: Bridgewatch",
    city: "Bridgewatch",
    biome: "steppe",
  },
  {
    id: "UNIQUE_LOOTCHEST_FACTIONCAMPAIGN_REWARD_CAERLEON_01",
    name: "Iron Campaign Chest: Caerleon",
    city: "Caerleon",
    biome: "caerleon",
  },
];

const DEFAULT_CHEST_AVG_YIELD = 76000;

// Every Iron Campaign Chest also contains Tomes of Insight on top of the silver
// loot. These tomes are NON-tradeable (consumed for instant combat fame), so
// they have no market price of their own. We value them by fame-equivalence
// against the only tradeable Tome of Insight — the Adept's (T4_SKILLBOOK_STANDARD):
//
//   value(tome) = fame(tome) × (market price of Adept's Tome / fame(Adept's Tome))
//
// i.e. "what it would cost to buy the same fame from tradeable tomes".
//
// Combat fame per Tome of Insight tier (fixed, not affected by zone/premium
// bonuses). Source: https://wiki.albiononline.com/wiki/Tome_Of_Insight
//   Adept (T4) 10,000 · Master (T6) 50,000 · Grandmaster (T7) 100,000
const TOME_INSIGHT_FAME = { 4: 10000, 6: 50000, 7: 100000 };

// The tradeable reference tome used to price the non-tradeable ones.
const TRADEABLE_TOME_ID = "T4_SKILLBOOK_STANDARD";
const TRADEABLE_TOME_TIER = 4;

// Tome contents of every Iron Campaign Chest: 2× Grandmaster (T7) + 1× Master (T6).
const CHEST_TOME_CONTENTS = [
  { tier: 7, count: 2 },
  { tier: 6, count: 1 },
];

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    FACTION_CHESTS,
    DEFAULT_CHEST_AVG_YIELD,
    TOME_INSIGHT_FAME,
    TRADEABLE_TOME_ID,
    TRADEABLE_TOME_TIER,
    CHEST_TOME_CONTENTS,
  };
}
