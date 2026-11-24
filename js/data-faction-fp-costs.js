/**
 * Faction Point costs for items purchasable from the Faction Enlistment NPC.
 *
 * Source: https://wiki.albiononline.com/wiki/Faction_Enlistment_NPC (verified
 * 2026-05-02). All six royal-city NPCs share the same price structure:
 *  - City heart fragment: 3,000 FP
 *  - Adept's / Expert's / Master's / Grandmaster's / Elder's Crest: 400 / 2,250 / 3,000 / 7,500 / 15,000 FP
 *  - T5 city baby mount: 3,000 FP
 *  - T8 elite city baby mount: 50,000 FP (verified in-game by user 2026-05-02 — supersedes wiki's 15K)
 *  - Iron Campaign Chest: 9,000 FP
 *  - Warbanner: 10× heart fragment (priced via the heart, not a flat FP value)
 *
 * Brecilien (the Mists hub) is a separate case: its faction rewards are bought
 * with FAVOR (from Eralia Wayfarer), NOT Faction Points — so its crests and
 * Mystic Owl babies are modelled in the Favor section (js/data-favor-costs.js),
 * not here. See FAVOR_CREST_FAMILIES / BRECILIEN_BABIES there.
 */
const FACTION_FP_COSTS = {
  // ── Heart fragments (city resources) ─────────────────────────────────
  T1_FACTION_SWAMP_TOKEN_1: 3000,        // Vineheart (Thetford)
  T1_FACTION_FOREST_TOKEN_1: 3000,       // Treeheart (Lymhurst)
  T1_FACTION_MOUNTAIN_TOKEN_1: 3000,     // Mountainheart (Fort Sterling)
  T1_FACTION_HIGHLAND_TOKEN_1: 3000,     // Rockheart (Martlock)
  T1_FACTION_STEPPE_TOKEN_1: 3000,       // Beastheart (Bridgewatch)
  T1_FACTION_CAERLEON_TOKEN_1: 3000,     // Shadowheart (Caerleon)

  // ── Iron Campaign Chests (one per royal city + Caerleon) ────────────
  UNIQUE_LOOTCHEST_FACTIONCAMPAIGN_REWARD_SWAMP_01: 9000,
  UNIQUE_LOOTCHEST_FACTIONCAMPAIGN_REWARD_FOREST_01: 9000,
  UNIQUE_LOOTCHEST_FACTIONCAMPAIGN_REWARD_MOUNTAIN_01: 9000,
  UNIQUE_LOOTCHEST_FACTIONCAMPAIGN_REWARD_HIGHLAND_01: 9000,
  UNIQUE_LOOTCHEST_FACTIONCAMPAIGN_REWARD_STEPPE_01: 9000,
  UNIQUE_LOOTCHEST_FACTIONCAMPAIGN_REWARD_CAERLEON_01: 9000,

  // ── T5 city baby mounts (each 3,000 FP) ─────────────────────────────
  T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY: 3000,
  T5_FARM_DIREBEAR_FW_FORTSTERLING_BABY: 3000,
  T5_FARM_DIREBOAR_FW_LYMHURST_BABY: 3000,
  T5_FARM_RAM_FW_MARTLOCK_BABY: 3000,
  T5_FARM_MOABIRD_FW_BRIDGEWATCH_BABY: 3000,
  T5_FARM_GREYWOLF_FW_CAERLEON_BABY: 3000,

  // ── T8 elite city baby mounts (each 50,000 FP, in-game verified) ────
  T8_FARM_SWAMPDRAGON_FW_THETFORD_BABY: 50000,
  T8_FARM_DIREBEAR_FW_FORTSTERLING_BABY: 50000,
  T8_FARM_DIREBOAR_FW_LYMHURST_BABY: 50000,
  T8_FARM_RAM_FW_MARTLOCK_BABY: 50000,
  T8_FARM_MOABIRD_FW_BRIDGEWATCH_BABY: 50000,
  T8_FARM_GREYWOLF_FW_CAERLEON_BABY: 50000,
  // Brecilien's Mystic Owl babies are NOT here — they're a Favor purchase
  // (Eralia Wayfarer), modelled as BRECILIEN_BABIES in js/data-favor-costs.js.
};

// Crest costs follow Adept→Elder progression and are uniform across the five
// royal-city Faction Enlistment NPCs. Brecilien is excluded: its crests are a
// Favor purchase (Eralia Wayfarer), not an FP one — see FAVOR_CREST_FAMILIES in
// js/data-favor-costs.js.
const _CREST_TIER_FP = { 4: 400, 5: 2250, 6: 3000, 7: 7500, 8: 15000 };
const _CREST_CITIES = ["THETFORD", "LYMHURST", "BRIDGEWATCH", "FORTSTERLING", "MARTLOCK"];
for (const city of _CREST_CITIES) {
  for (const [tier, fp] of Object.entries(_CREST_TIER_FP)) {
    FACTION_FP_COSTS[`T${tier}_CAPEITEM_FW_${city}_BP`] = fp;
  }
}

// Sales tax only — the setup fee is added separately below, and only when the
// sale is a market ORDER. An instant sale into a standing buy order creates no
// order and pays no setup fee. Mirrors js/calculations.js (marketSetupFee).
const FACTION_TAX_PREMIUM = 0.04;
const FACTION_TAX_NON_PREMIUM = 0.08;
const FACTION_SETUP_FEE = 0.025;

function getFpCost(itemId) {
  if (!itemId) return 0;
  return FACTION_FP_COSTS[itemId] || 0;
}

function netSilverAfterFees(grossSilver, premium) {
  if (!grossSilver || grossSilver <= 0) return 0;
  const tax = premium ? FACTION_TAX_PREMIUM : FACTION_TAX_NON_PREMIUM;
  // js/calculations.js loads first in the browser; the guard keeps this file
  // usable on its own in the Node harnesses, where "market orders" is the
  // historical default.
  const setup = typeof marketSetupFee === "function" ? marketSetupFee() : FACTION_SETUP_FEE;
  return Math.round(grossSilver * (1 - tax - setup));
}

function calculateSilverPerFp(silverYield, fpCost) {
  if (!fpCost || fpCost <= 0) return 0;
  return silverYield / fpCost;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    FACTION_FP_COSTS,
    FACTION_TAX_PREMIUM,
    FACTION_TAX_NON_PREMIUM,
    FACTION_SETUP_FEE,
    getFpCost,
    netSilverAfterFees,
    calculateSilverPerFp,
  };
}
