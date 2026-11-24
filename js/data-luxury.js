// Luxury (trade) goods — Flipping table catalog.
//
// Luxury goods (items.xml shopcategory="luxurygoods", ids TREASURE_*) are NOT
// crafted (unlockedtocraft="true" is a lie — empty craftingrequirements). They
// drop from mobs / hidden treasures / open-world chests, are fished from
// floating treasures, or are bought off the marketplace. Each is sold to a
// marketplace TRADER NPC at a FIXED price in ONE designated city; the six royal
// families bind to a single royal/Caerleon city, the Avalonian trio sells in
// ANY city.
//
// NPC sell price = items.xml itemvalue * 40. Verified in-game against the wiki:
// Ritual Candles 1,000 / Blood Chalice 5,000 / Sacrificial Dagger 25,000.
// weight = items.xml weight (R1 2.5 / R2 5 / R3 6.25 kg) — used for ox-load, so
// it must NOT go through getGearWeightKg (that formula is for equipment).
//
// Flip model (see js/render-flipping.js buildLuxuryFlipRoute): BUY cheap on the
// market where looters dump loot -> haul -> SELL to the fixed NPC. The sell side
// is a constant, independent of any market sell order.
const LUXURY_FLIP_ITEMS = [
  // Knowledge -> Martlock
  { id: "TREASURE_KNOWLEDGE_RARITY1", name: "Corrupted Scroll", sellCity: "Martlock", npcPrice: 1000, tier: 4, weight: 2.5 },
  { id: "TREASURE_KNOWLEDGE_RARITY2", name: "Thin Booklet", sellCity: "Martlock", npcPrice: 5000, tier: 5, weight: 5 },
  { id: "TREASURE_KNOWLEDGE_RARITY3", name: "Ancient Tome", sellCity: "Martlock", npcPrice: 25000, tier: 6, weight: 6.25 },
  // Silverware -> Lymhurst
  { id: "TREASURE_SILVERWARE_RARITY1", name: "Silver Cup", sellCity: "Lymhurst", npcPrice: 1000, tier: 4, weight: 2.5 },
  { id: "TREASURE_SILVERWARE_RARITY2", name: "Silver Mirror", sellCity: "Lymhurst", npcPrice: 5000, tier: 5, weight: 5 },
  { id: "TREASURE_SILVERWARE_RARITY3", name: "Silver Candelabrum", sellCity: "Lymhurst", npcPrice: 25000, tier: 6, weight: 6.25 },
  // Decorative -> Fort Sterling
  { id: "TREASURE_DECORATIVE_RARITY1", name: "Simple Stone Toy", sellCity: "Fort Sterling", npcPrice: 1000, tier: 4, weight: 2.5 },
  { id: "TREASURE_DECORATIVE_RARITY2", name: "Stone Mask", sellCity: "Fort Sterling", npcPrice: 5000, tier: 5, weight: 5 },
  { id: "TREASURE_DECORATIVE_RARITY3", name: "Stone Idol", sellCity: "Fort Sterling", npcPrice: 25000, tier: 6, weight: 6.25 },
  // Ceremonial -> Thetford
  { id: "TREASURE_CEREMONIAL_RARITY1", name: "Ornamental Scepter", sellCity: "Thetford", npcPrice: 1000, tier: 4, weight: 2.5 },
  { id: "TREASURE_CEREMONIAL_RARITY2", name: "Globus Cruciger", sellCity: "Thetford", npcPrice: 5000, tier: 5, weight: 5 },
  { id: "TREASURE_CEREMONIAL_RARITY3", name: "Golden Crown", sellCity: "Thetford", npcPrice: 25000, tier: 6, weight: 6.25 },
  // Tribal -> Bridgewatch
  { id: "TREASURE_TRIBAL_RARITY1", name: "Feather Talisman", sellCity: "Bridgewatch", npcPrice: 1000, tier: 4, weight: 2.5 },
  { id: "TREASURE_TRIBAL_RARITY2", name: "Dreamcatcher", sellCity: "Bridgewatch", npcPrice: 5000, tier: 5, weight: 5 },
  { id: "TREASURE_TRIBAL_RARITY3", name: "Holy Fetish", sellCity: "Bridgewatch", npcPrice: 25000, tier: 6, weight: 6.25 },
  // Ritual -> Caerleon
  { id: "TREASURE_RITUAL_RARITY1", name: "Ritual Candles", sellCity: "Caerleon", npcPrice: 1000, tier: 4, weight: 2.5 },
  { id: "TREASURE_RITUAL_RARITY2", name: "Blood Chalice", sellCity: "Caerleon", npcPrice: 5000, tier: 5, weight: 5 },
  { id: "TREASURE_RITUAL_RARITY3", name: "Sacrificial Dagger", sellCity: "Caerleon", npcPrice: 25000, tier: 6, weight: 6.25 },
  // Avalonian -> any city
  { id: "TREASURE_AVALON_RARITY1", name: "Golden Frame", sellCity: "any", npcPrice: 10000, tier: 6, weight: 2.5 },
  { id: "TREASURE_AVALON_RARITY2", name: "Golden Gyroscope", sellCity: "any", npcPrice: 50000, tier: 7, weight: 5 },
  { id: "TREASURE_AVALON_RARITY3", name: "Golden Sextant", sellCity: "any", npcPrice: 250000, tier: 8, weight: 6.25 },
];

const LUXURY_BY_ID = LUXURY_FLIP_ITEMS.reduce((m, l) => {
  m[l.id] = l;
  return m;
}, {});

// Returns the catalog entry for a luxury-good id, or null. render-flipping uses
// this to branch onto the fixed-NPC-price route instead of a market sell.
function getLuxuryFlipInfo(id) {
  return LUXURY_BY_ID[id] || null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { LUXURY_FLIP_ITEMS, LUXURY_BY_ID, getLuxuryFlipInfo };
}
