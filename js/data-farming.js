// Farming production data — crops, herbs, and animal byproducts.
//
// Source: Albion Wiki "Island Farms" (Wild Blood Update, verified 2026-05-17).
//   - Crops (8): 22h cycle, 9 seeds/plot. Each seed plants one slot and
//     yields 3-6 of its crop at harvest (6-12 with Premium, loot.xml
//     T*_*_LOOT) — `producePerPlot` is that 4.5 BASE average; Premium is
//     +100% Product Yield, summed once with the city's +10% in
//     calcFarmingEconomics. Seed yield % (base + watering) is a SEPARATE
//     per-slot roll and decides how many seeds come back — when ≥100% the
//     farm is self-sustaining. A harvested slot also has a 10% chance of 1
//     Earthworm, 2 with Premium (`wormsPerPlot`, the only bait ingredient in
//     the game) — sold like the surplus seed.
//   - Herbs (7, T2-T8): same plot mechanics as crops.
//   - Byproducts: a GROWN animal on a pasture slot eats 864 nutrition and
//     produces 7-11 eggs/milk per 22h cycle (`produceBase` is the free
//     average; Premium is +100% Product Yield, summed with the city's +10% —
//     never chained).
//     The animal survives the harvest, so it is reusable CAPITAL, not an
//     input: only the feed is a per-cycle cost. A favorite crop is worth
//     double nutrition (items.xml favoritebonus="1"), so 864 / (48x2) = 9
//     favorite crops feed one cycle. The baby is a breeding item — buying
//     one to milk it is just an expensive way to get the grown animal, and
//     its offspring play is priced in the Mounts table instead.
//     T7 Pig has no byproduct (meat only).
//
// Bonus city is computed at render time via CITY_FARM_SPEC + getFarmingYieldBonus.
// The Earthworm every crop and herb lootlist carries. T1 is the only tier the
// game has; every fishing-bait recipe is built from it.
const FARM_WORM_ID = "T1_WORM";

const FARMING_PRODUCTION = [
  // Crops (vegetables)
  { type: "crop", section: "crops", id: "T1_FARM_CARROT_SEED",   outputId: "T1_CARROT",  name: "Carrot [T1]",         tier: 1, cycleHours: 22, plotsPerCycle: 9, producePerPlot: 4.5, wormsPerPlot: 0.1, baseSeedYield: 0,      wateringBonus: 2.00 },
  { type: "crop", section: "crops", id: "T2_FARM_BEAN_SEED",     outputId: "T2_BEAN",    name: "Bean [T2]",           tier: 2, cycleHours: 22, plotsPerCycle: 9, producePerPlot: 4.5, wormsPerPlot: 0.1, baseSeedYield: 0.3333, wateringBonus: 1.3333 },
  { type: "crop", section: "crops", id: "T3_FARM_WHEAT_SEED",    outputId: "T3_WHEAT",   name: "Sheaf of Wheat [T3]", tier: 3, cycleHours: 22, plotsPerCycle: 9, producePerPlot: 4.5, wormsPerPlot: 0.1, baseSeedYield: 0.60,   wateringBonus: 0.80 },
  { type: "crop", section: "crops", id: "T4_FARM_TURNIP_SEED",   outputId: "T4_TURNIP",  name: "Turnip [T4]",         tier: 4, cycleHours: 22, plotsPerCycle: 9, producePerPlot: 4.5, wormsPerPlot: 0.1, baseSeedYield: 0.7333, wateringBonus: 0.5333 },
  { type: "crop", section: "crops", id: "T5_FARM_CABBAGE_SEED",  outputId: "T5_CABBAGE", name: "Cabbage [T5]",        tier: 5, cycleHours: 22, plotsPerCycle: 9, producePerPlot: 4.5, wormsPerPlot: 0.1, baseSeedYield: 0.80,   wateringBonus: 0.40 },
  { type: "crop", section: "crops", id: "T6_FARM_POTATO_SEED",   outputId: "T6_POTATO",  name: "Potato [T6]",         tier: 6, cycleHours: 22, plotsPerCycle: 9, producePerPlot: 4.5, wormsPerPlot: 0.1, baseSeedYield: 0.8667, wateringBonus: 0.2667 },
  { type: "crop", section: "crops", id: "T7_FARM_CORN_SEED",     outputId: "T7_CORN",    name: "Bundle of Corn [T7]", tier: 7, cycleHours: 22, plotsPerCycle: 9, producePerPlot: 4.5, wormsPerPlot: 0.1, baseSeedYield: 0.9111, wateringBonus: 0.1778 },
  { type: "crop", section: "crops", id: "T8_FARM_PUMPKIN_SEED",  outputId: "T8_PUMPKIN", name: "Pumpkin [T8]",        tier: 8, cycleHours: 22, plotsPerCycle: 9, producePerPlot: 4.5, wormsPerPlot: 0.1, baseSeedYield: 0.9333, wateringBonus: 0.1333 },

  // Herbs (T2-T8, alchemy)
  { type: "herb", section: "herbs", id: "T2_FARM_AGARIC_SEED",   outputId: "T2_AGARIC",   name: "Arcane Agaric [T2]",       tier: 2, cycleHours: 22, plotsPerCycle: 9, producePerPlot: 4.5, wormsPerPlot: 0.1, baseSeedYield: 0.3333, wateringBonus: 1.3333 },
  { type: "herb", section: "herbs", id: "T3_FARM_COMFREY_SEED",  outputId: "T3_COMFREY",  name: "Brightleaf Comfrey [T3]",  tier: 3, cycleHours: 22, plotsPerCycle: 9, producePerPlot: 4.5, wormsPerPlot: 0.1, baseSeedYield: 0.60,   wateringBonus: 0.80 },
  { type: "herb", section: "herbs", id: "T4_FARM_BURDOCK_SEED",  outputId: "T4_BURDOCK",  name: "Crenellated Burdock [T4]", tier: 4, cycleHours: 22, plotsPerCycle: 9, producePerPlot: 4.5, wormsPerPlot: 0.1, baseSeedYield: 0.7333, wateringBonus: 0.5333 },
  { type: "herb", section: "herbs", id: "T5_FARM_TEASEL_SEED",   outputId: "T5_TEASEL",   name: "Dragon Teasel [T5]",       tier: 5, cycleHours: 22, plotsPerCycle: 9, producePerPlot: 4.5, wormsPerPlot: 0.1, baseSeedYield: 0.80,   wateringBonus: 0.40 },
  { type: "herb", section: "herbs", id: "T6_FARM_FOXGLOVE_SEED", outputId: "T6_FOXGLOVE", name: "Elusive Foxglove [T6]",    tier: 6, cycleHours: 22, plotsPerCycle: 9, producePerPlot: 4.5, wormsPerPlot: 0.1, baseSeedYield: 0.8667, wateringBonus: 0.2667 },
  { type: "herb", section: "herbs", id: "T7_FARM_MULLEIN_SEED",  outputId: "T7_MULLEIN",  name: "Firetouched Mullein [T7]", tier: 7, cycleHours: 22, plotsPerCycle: 9, producePerPlot: 4.5, wormsPerPlot: 0.1, baseSeedYield: 0.9111, wateringBonus: 0.1778 },
  { type: "herb", section: "herbs", id: "T8_FARM_YARROW_SEED",   outputId: "T8_YARROW",   name: "Ghoul Yarrow [T8]",        tier: 8, cycleHours: 22, plotsPerCycle: 9, producePerPlot: 4.5, wormsPerPlot: 0.1, baseSeedYield: 0.9333, wateringBonus: 0.1333 },

// Animal byproducts (eggs + milk). One pasture slot, one 22h produce cycle.
// `id` is the FEED crop because that is what the cycle actually buys; the
// animal itself is reported separately as capital. `produceBase` is the
// free-account average of the in-game 7-11 roll (loot.xml T*_*_LOOT) —
// Premium sums on top of it (+100% Product Yield) in calcFarmingEconomics.
  // T7 Pig has no <products> block in items.xml so it is intentionally absent.
  { type: "byproduct", section: "byproducts", id: "T3_WHEAT",   outputId: "T3_EGG",  name: "Hen Eggs [T3]",     tier: 3, cycleHours: 22, plotsPerCycle: 1, sourceAnimal: "Chicken", animalId: "T3_FARM_CHICKEN_GROWN", babyId: "T3_FARM_CHICKEN_BABY", feedId: "T3_WHEAT",   feedCount: 9, produceBase: 9 },
  { type: "byproduct", section: "byproducts", id: "T4_TURNIP",  outputId: "T4_MILK", name: "Goat's Milk [T4]",  tier: 4, cycleHours: 22, plotsPerCycle: 1, sourceAnimal: "Goat",    animalId: "T4_FARM_GOAT_GROWN",    babyId: "T4_FARM_GOAT_BABY",    feedId: "T4_TURNIP",  feedCount: 9, produceBase: 9 },
  { type: "byproduct", section: "byproducts", id: "T5_CABBAGE", outputId: "T5_EGG",  name: "Goose Eggs [T5]",   tier: 5, cycleHours: 22, plotsPerCycle: 1, sourceAnimal: "Goose",   animalId: "T5_FARM_GOOSE_GROWN",   babyId: "T5_FARM_GOOSE_BABY",   feedId: "T5_CABBAGE", feedCount: 9, produceBase: 9 },
  { type: "byproduct", section: "byproducts", id: "T6_POTATO",  outputId: "T6_MILK", name: "Sheep's Milk [T6]", tier: 6, cycleHours: 22, plotsPerCycle: 1, sourceAnimal: "Sheep",   animalId: "T6_FARM_SHEEP_GROWN",   babyId: "T6_FARM_SHEEP_BABY",   feedId: "T6_POTATO",  feedCount: 9, produceBase: 9 },
  { type: "byproduct", section: "byproducts", id: "T8_PUMPKIN", outputId: "T8_MILK", name: "Cow's Milk [T8]",   tier: 8, cycleHours: 22, plotsPerCycle: 1, sourceAnimal: "Cow",     animalId: "T8_FARM_COW_GROWN",     babyId: "T8_FARM_COW_BABY",     feedId: "T8_PUMPKIN", feedCount: 9, produceBase: 9 },
];

// Watering ONE SEED for one cycle. The game charges
//
//   1000 * 0.5^(focus cost efficiency / 100)
//
// (Albion forum thread 78912; the wiki gives the same endpoints, 1000 at no spec
// down to 125 at full spec). Efficiency runs 0-300: 1 per Crop Farmer/Herbalist
// level plus 2 per crop-specific level, which is exactly what the crop and herb
// nodes carry in achievements.xml — so the base is the game's 1,000 and the
// ⚙ Specs panel derives everything between 1,000 and 125.
//
// PER SEED is the whole point of the name: a plot holds `plotsPerCycle` seed
// slots (9 on an island farm) and each planted seed is watered — and paid for —
// on its own, so a full plot costs 9 × this, 1,125 at max spec. Callers scale it;
// see js/render-farming.js, which prices one focus PLAY as one watered cycle.
//
// It used to be back-solved the other way round (100 at max spec, over an
// assumed 40,000 FCE → base 1,600). The herb/crop nodes only reach 30,000, so
// that printed 200 focus per seed at max spec — 1.6× the game's 125, which sank
// every Farming Silver/Focus and Profit / 10k Focus figure by the same factor.
const FARMING_FOCUS_BASE = 1000;
const FARMING_FOCUS_PER_SEED = 125; // max spec (30,000 FCE), the fallback figure

function getFarmingFocusCost(seedOrAnimalId) {
  const mult = typeof focusSpecMultiplier === "function"
    ? focusSpecMultiplier(seedOrAnimalId)
    : Math.pow(0.5, 3); // no spec data loaded → the max-spec default (30,000 FCE)
  return Math.max(1, Math.round(FARMING_FOCUS_BASE * mult));
}
