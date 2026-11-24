// How much BASE fame an hour of gathering earns — the number journal fill speed
// divides into a journal's maxfame.
//
// It used to be two hand-written tables sitting next to two OTHER hand-written
// tables (GATHER_UNITS_PER_HOUR / FISH_UNITS_PER_HOUR) that describe the same
// hour of play, and the pair disagreed: you cannot gather 200 T8 ore an hour,
// each worth famevalue="150", and earn only 19,000 fame. There is one tunable
// here — how much you gather per hour — and the fame follows from items.xml:
//
//   land   <… famevalue="…">     per gathered UNIT, doubling per enchant level
//                                (T7_ORE 75 / 150 / 300 / 600 / 1200)
//   fish   <… fishingfame="…">   per landed CATCH (see below)
//
// Both reproduce the Albion wiki's published tables, and the fishing values ×1.5
// (premium) reproduce a player's logged in-game readings exactly, so items.xml
// is treated as truth. Only BASE fame fills journals — premium's bonus does not,
// which is why nothing here carries a premium factor.
//
// THE RULE EVERYONE MISREADS: fishing fame is awarded PER CATCH, not per fish.
// One catch of Danglemouth Catfish pays 100 base fame whether it lands one fish
// or five. FISH_UNITS_PER_HOUR counts FISH, so it must be divided by
// FISH_PER_CATCH before the per-catch fame is applied. Land gathering has no
// such split — famevalue is genuinely per unit.
//
// Anchor (Albion forum, "Fisherman's Journal takes very long time to fill"): 2.5
// hours of black-zone T5-T7 fishing filled 36 T2 Fisherman's Journals = 25,920
// base fame, i.e. ~10,368 base fame/hour. The derived T7/T8 rates land within
// ~11% of that, and the same log's per-catch fame values (150 for a T7 catfish,
// 450 for a T7 clam) are exactly items.xml × 1.5.
//
// Sources: items.xml, https://wiki.albiononline.com/wiki/Journal,
// https://forum.albiononline.com/index.php/Thread/87184-Fisherman-s-Journal-takes-very-long-time-to-fill-picture-included/
//
// Tuning note: every rate here scales linearly with the units/hour tunables in
// js/data-gathering.js. If a fame/hour reads too high, the fix is that file's
// throughput estimate — which also drives silver/hour — not a second knob here.

// Browser: js/data-gathering.js is already a global by load order. Node: pull it
// in, since the tests require this module directly.
const _GFR_GATHERING = (typeof GATHER_UNITS_PER_HOUR !== "undefined")
  ? null
  : require("./data-gathering.js");
const _gfrUnitsPerHour = () =>
  _GFR_GATHERING ? _GFR_GATHERING.GATHER_UNITS_PER_HOUR : GATHER_UNITS_PER_HOUR;
const _gfrFishUnitsPerHour = () =>
  _GFR_GATHERING ? _GFR_GATHERING.FISH_UNITS_PER_HOUR : FISH_UNITS_PER_HOUR;
const _gfrRareShare = () =>
  _GFR_GATHERING ? _GFR_GATHERING.FISH_RARE_SHARE : FISH_RARE_SHARE;
const _gfrEnchantDist = (tier) =>
  (_GFR_GATHERING ? _GFR_GATHERING.getEnchantDist : getEnchantDist)(tier);
const _gfrRareTier = (tier) =>
  (_GFR_GATHERING ? _GFR_GATHERING.fishingRareTier : fishingRareTier)(tier);

// items.xml `famevalue` on the unenchanted raw resource. Identical for ORE,
// WOOD, HIDE, FIBER and ROCK, so one table covers every land profession.
const GATHER_FAME_PER_UNIT = { 2: 1.5, 3: 3, 4: 7.5, 5: 22.5, 6: 45, 7: 75, 8: 150 };

// items.xml `fishingfame` on T{n}_FISH_{FRESH,SALT}WATER_ALL_COMMON — freshwater
// and saltwater pay the same, so the merged fishing row needs only one value.
const FISH_FAME_PER_CATCH_COMMON = {
  1: 10, 2: 20, 3: 30, 4: 40, 5: 60, 6: 80, 7: 100, 8: 140,
};

// items.xml `fishingfame` on the biome rares, which exist only at T3/T5/T7 —
// fishing's "enchant", worth ~3× a common catch of the same tier.
const FISH_FAME_PER_CATCH_RARE = { 3: 100, 5: 200, 7: 300 };

// Fish per landed catch. Fame is paid per CATCH while FISH_UNITS_PER_HOUR counts
// FISH, so this is the bridge between them. The value the units/hour comment
// already assumes ("each landed catch yields ~3-4 fish"); the forum log's
// ~86 catches/hour against 240 fish/hour at T7 puts it at ~2.8. TUNABLE.
const FISH_PER_CATCH = 3;

/**
 * How much the enchanted share of a land haul lifts its fame. items.xml doubles
 * famevalue per enchant level, so the expected fame of one gathered unit is
 * `flat share × 1 + Σ share_k × 2^k`. Collapses to exactly 1 below T4, where
 * nothing enchants, and for ROCK (which the shared land table still prices with
 * the enchantable multiplier — quarrying is one profession of five, and the
 * fill-speed column is a cross-profession estimate).
 */
function enchantFameMultiplier(tier) {
  const dist = _gfrEnchantDist(tier) || {};
  let enchantedShare = 0;
  let weighted = 0;
  for (let k = 1; k <= 4; k++) {
    const share = dist[k] || 0;
    enchantedShare += share;
    weighted += share * Math.pow(2, k);
  }
  return (1 - enchantedShare) + weighted;
}

/** Blended base fame of one landed catch at a fishing tier (common + rare mix). */
function fishFamePerCatch(tier) {
  const common = FISH_FAME_PER_CATCH_COMMON[tier] || 0;
  const rareTier = _gfrRareTier(tier);
  const rare = rareTier ? (FISH_FAME_PER_CATCH_RARE[rareTier] || 0) : 0;
  const share = rareTier ? _gfrRareShare() : 0;
  return (1 - share) * common + share * rare;
}

/** Tier-keyed base fame/hour for LAND gathering. */
function buildGatherBaseFamePerHour() {
  const units = _gfrUnitsPerHour() || {};
  const table = {};
  Object.keys(units).forEach((key) => {
    const tier = Number(key);
    const perUnit = GATHER_FAME_PER_UNIT[tier];
    if (!(perUnit > 0)) return;
    table[tier] = Math.round(units[tier] * perUnit * enchantFameMultiplier(tier));
  });
  return table;
}

/** Tier-keyed base fame/hour for FISHING (per-catch fame × catches/hour). */
function buildFishBaseFamePerHour() {
  const units = _gfrFishUnitsPerHour() || {};
  const table = {};
  Object.keys(units).forEach((key) => {
    const tier = Number(key);
    const perCatch = fishFamePerCatch(tier);
    if (!(perCatch > 0)) return;
    table[tier] = Math.round((units[tier] / FISH_PER_CATCH) * perCatch);
  });
  return table;
}

// Built once at load — the inputs are module constants, so nothing can drift
// between calls, and every consumer reads a plain tier-keyed object exactly as
// it did when these were hand-written literals.
const GATHER_BASE_FAME_PER_HOUR = buildGatherBaseFamePerHour();
const FISH_BASE_FAME_PER_HOUR = buildFishBaseFamePerHour();

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    GATHER_FAME_PER_UNIT,
    FISH_FAME_PER_CATCH_COMMON,
    FISH_FAME_PER_CATCH_RARE,
    FISH_PER_CATCH,
    enchantFameMultiplier,
    fishFamePerCatch,
    buildGatherBaseFamePerHour,
    buildFishBaseFamePerHour,
    GATHER_BASE_FAME_PER_HOUR,
    FISH_BASE_FAME_PER_HOUR,
  };
}
