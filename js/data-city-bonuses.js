// City production-bonus tables — which city boosts what, and by how much.
//
// Pure data plus the bonus constants that scale it. Split out of
// js/calculations.js so that file stays a calculator; every consumer reads
// these by bare identifier (classic scripts share one top-level scope), and
// in Node calculations.js hoists them onto globalThis before use.
//
// Source: Albion Wiki "Local Production Bonus" + "Island Farms".
// --- City Production Bonuses ---
// Each Royal City has 18% base production bonus.
// Specialized cities get +15% crafting or +40% refining for specific categories.
// With Focus: +59% flat production bonus on top.
// RRR = productionBonus / (1 + productionBonus)

const BASE_CITY_BONUS = 0.18; // 18% base Royal City production bonus
const CRAFT_SPEC_BONUS = 0.15; // 15% additional for specialized crafting
const REFINE_SPEC_BONUS = 0.4; // 40% additional for specialized refining
const BUTCHER_SPEC_BONUS = 0.10; // 10% additional for specialized butchering (per meat tier)
const FARMING_SPEC_BONUS = 0.10; // 10% extra seed/byproduct yield in the right farming city
const PREMIUM_PRODUCT_BONUS = 1.0; // Premium: +100% Product Yield — same stat as the city's +10%, summed with it (never chained)
const FOCUS_BONUS = 0.59; // 59% flat focus bonus

// City -> crafting specialization categories (+15% bonus, source: Wiki "Local Production Bonus")
const CITY_CRAFT_SPEC = {
  "Fort Sterling": ["hammer", "spear", "holystaff", "plate_helmet", "cloth_armor"],
  Lymhurst: ["sword", "bow", "arcanestaff", "leather_helmet", "leather_shoes"],
  Bridgewatch: ["crossbow", "dagger", "cursestaff", "plate_armor", "cloth_shoes"],
  Thetford: ["mace", "naturestaff", "firestaff", "leather_armor", "cloth_helmet"],
  Martlock: ["axe", "quarterstaff", "froststaff", "plate_shoes", "shield", "torch", "book", "totem", "orb", "horn"],
  Caerleon: [
    // Tool
    "pickaxe", "sickle", "skinningknife", "fishing", "stonehammer", "demolitionhammer", "woodaxe",
    // Gathering Gear (6 resources × 4 slots)
    "fibergatherer_helmet", "fibergatherer_armor", "fibergatherer_shoes", "fibergatherer_backpack",
    "hidegatherer_helmet", "hidegatherer_armor", "hidegatherer_shoes", "hidegatherer_backpack",
    "oregatherer_helmet", "oregatherer_armor", "oregatherer_shoes", "oregatherer_backpack",
    "rockgatherer_helmet", "rockgatherer_armor", "rockgatherer_shoes", "rockgatherer_backpack",
    "woodgatherer_helmet", "woodgatherer_armor", "woodgatherer_shoes", "woodgatherer_backpack",
    "fishgatherer_helmet", "fishgatherer_armor", "fishgatherer_shoes", "fishgatherer_backpack",
    // War Gloves
    "knuckles",
    // Shapeshifter Staff
    "shapeshifterstaff",
    // Food (Meals)
    "food",
  ],
  Brecilien: ["cape", "bag", "potion"],
};

// Consumables (CONSUMABLES[].id has no craftType field; derive from id pattern).
// Returns "potion" / "food" / null. Used by render-consumables.js to pick up
// Brecilien (+15% potion) and Caerleon (+15% food) production bonuses.
function getConsumableCraftType(id) {
  if (!id || typeof id !== "string") return null;
  if (id.includes("_POTION_")) return "potion";
  if (id.includes("_MEAL_")) return "food";
  return null;
}

// City -> refining specialization resource
const CITY_REFINE_SPEC = {
  "Fort Sterling": "wood",
  Lymhurst: "fiber",
  Bridgewatch: "rock",
  Thetford: "ore",
  Martlock: "hide",
};

// City -> butcher meat specialization (+10 PB per meat tier, source: Wiki
// "Local Production Bonus"). Fort Sterling is the only city with two meats.
// Caerleon and Brecilien have no butcher specs.
const CITY_BUTCHER_SPEC = {
  "Fort Sterling": ["T3_MEAT", "T6_MEAT"], // Raw Chicken, Raw Mutton
  Bridgewatch: ["T4_MEAT"],                // Raw Goat
  Lymhurst: ["T5_MEAT"],                   // Raw Goose
  Thetford: ["T7_MEAT"],                   // Raw Pork
  Martlock: ["T8_MEAT"],                   // Raw Beef
};

// City -> farming specialization (+10% PRODUCT yield: more crops/herbs per
// harvested slot, more eggs/milk per pasture cycle — never a seed-yield bonus),
// source: Wiki "Local Production Bonus" + "Island Farms" (Wild Blood Update).
// Each royal city boosts 1 crop + 1 herb + 1 livestock byproduct, with
// Caerleon hitting 3 herbs, Brecilien hitting all 8 crops, and Fort Sterling
// being the only royal with TWO byproducts (chicken eggs T3 + sheep milk T6).
const CITY_FARM_SPEC = {
  "Fort Sterling": {
    crops: ["T4_TURNIP"],
    herbs: ["T8_YARROW"],
    byproducts: ["T3_EGG", "T6_MILK"],
  },
  Lymhurst: {
    crops: ["T1_CARROT", "T8_PUMPKIN"],
    herbs: ["T4_BURDOCK"],
    byproducts: ["T5_EGG"],
  },
  Bridgewatch: {
    crops: ["T2_BEAN", "T7_CORN"],
    herbs: ["T5_TEASEL"],
    byproducts: ["T4_MILK"],
  },
  Martlock: {
    crops: ["T3_WHEAT", "T6_POTATO"],
    herbs: ["T6_FOXGLOVE"],
    byproducts: ["T8_MILK"],
  },
  Thetford: {
    crops: ["T5_CABBAGE"],
    herbs: ["T2_AGARIC", "T7_MULLEIN"],
    byproducts: [],
  },
  Caerleon: {
    crops: [],
    herbs: ["T3_COMFREY", "T5_TEASEL", "T7_MULLEIN"],
    byproducts: [],
  },
  Brecilien: {
    crops: ["T1_CARROT", "T2_BEAN", "T3_WHEAT", "T4_TURNIP", "T5_CABBAGE", "T6_POTATO", "T7_CORN", "T8_PUMPKIN"],
    herbs: [],
    byproducts: [],
  },
};
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    BASE_CITY_BONUS, CRAFT_SPEC_BONUS, REFINE_SPEC_BONUS, BUTCHER_SPEC_BONUS,
    FARMING_SPEC_BONUS, PREMIUM_PRODUCT_BONUS, FOCUS_BONUS,
    CITY_CRAFT_SPEC, CITY_REFINE_SPEC, CITY_BUTCHER_SPEC, CITY_FARM_SPEC,
    getConsumableCraftType,
  };
}
