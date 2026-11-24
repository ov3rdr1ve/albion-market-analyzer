// CONSUMABLES: items with a recipe are craft-analyzed, items without are flip-analyzed.
// Item IDs and display names verified against items.xml + albiononline2d.com on
// 2026-05-05. Tier coverage follows what actually exists in-game (potions and
// meals only come in three tiers each, on alternating-tier schedules — see
// comments per section).
const CONSUMABLES = [
  // ── Potions ─────────────────────────────────────────────────────────────
  // Healing / Energy: T2 / T4 / T6 only. Names are "Minor … Potion",
  // "… Potion", "Major … Potion". T2 is excluded because it has no
  // meaningful market.
  { id: "T4_POTION_HEAL",   name: "Healing Potion [T4]",        herbId: "T4_BURDOCK" },
  { id: "T6_POTION_HEAL",   name: "Major Healing Potion [T6]",  herbId: "T6_FOXGLOVE" },
  { id: "T4_POTION_ENERGY", name: "Energy Potion [T4]",         herbId: "T4_BURDOCK" },
  { id: "T6_POTION_ENERGY", name: "Major Energy Potion [T6]",   herbId: "T6_FOXGLOVE" },

  // Resistance ("Stoneskin" internal name): T3 / T5 / T7.
  { id: "T3_POTION_STONESKIN", name: "Minor Resistance Potion [T3]", herbId: "T3_COMFREY" },
  { id: "T5_POTION_STONESKIN", name: "Resistance Potion [T5]",       herbId: "T5_TEASEL" },
  { id: "T7_POTION_STONESKIN", name: "Major Resistance Potion [T7]", herbId: "T7_MULLEIN" },

  // Sticky Potions ("Slowfield" internal name): T3 / T5 / T7.
  { id: "T3_POTION_SLOWFIELD", name: "Minor Sticky Potion [T3]", herbId: "T3_COMFREY" },
  { id: "T5_POTION_SLOWFIELD", name: "Sticky Potion [T5]",       herbId: "T5_TEASEL" },
  { id: "T7_POTION_SLOWFIELD", name: "Major Sticky Potion [T7]", herbId: "T7_MULLEIN" },

  // Poison / Cooldown Reduction: T4 / T6 / T8 (internal name COOLDOWN).
  { id: "T4_POTION_COOLDOWN", name: "Minor Poison Potion [T4]", herbId: "T4_BURDOCK" },
  { id: "T6_POTION_COOLDOWN", name: "Poison Potion [T6]",       herbId: "T6_FOXGLOVE" },
  { id: "T8_POTION_COOLDOWN", name: "Major Poison Potion [T8]", herbId: "T8_YARROW" },

  // Gigantify / Max-Load Potions (internal name REVIVE — legacy id from
  // pre-rework): T3 / T5 / T7.
  { id: "T3_POTION_REVIVE", name: "Minor Gigantify Potion [T3]", herbId: "T3_COMFREY" },
  { id: "T5_POTION_REVIVE", name: "Gigantify Potion [T5]",       herbId: "T5_TEASEL" },
  { id: "T7_POTION_REVIVE", name: "Major Gigantify Potion [T7]", herbId: "T7_MULLEIN" },

  // Invisibility ("Cleanse" internal name): T8 only.
  { id: "T8_POTION_CLEANSE", name: "Invisibility Potion [T8]" },

  // ── Rare / Tracking Potions ─────────────────────────────────────────────
  // Each consumes one tracked-creature's "Rare Animal Remains" (the same
  // drops that craft Shapeshifter staves). Naming is Minor / … / Major.
  // Recipes + focus live in recipes-rare-potions.js; the rare remain gets no
  // RRR refund (noReturn). Internal ids don't match the display names.

  // Calming (POTION_MOB_RESET) — Shadow Claws (Panther): T3 / T5 / T7.
  { id: "T3_POTION_MOB_RESET", name: "Minor Calming Potion [T3]", herbId: "T3_COMFREY" },
  { id: "T5_POTION_MOB_RESET", name: "Calming Potion [T5]",       herbId: "T5_TEASEL" },
  { id: "T7_POTION_MOB_RESET", name: "Major Calming Potion [T7]", herbId: "T7_MULLEIN" },

  // Cleansing (POTION_CLEANSE2) — Sylvian Root (Ent): T3 / T5 / T7.
  { id: "T3_POTION_CLEANSE2", name: "Minor Cleansing Potion [T3]", herbId: "T3_COMFREY" },
  { id: "T5_POTION_CLEANSE2", name: "Cleansing Potion [T5]",       herbId: "T5_TEASEL" },
  { id: "T7_POTION_CLEANSE2", name: "Major Cleansing Potion [T7]", herbId: "T7_MULLEIN" },

  // Acid (POTION_ACID) — Spirit Paws (Direbear): T3 / T5 / T7.
  { id: "T3_POTION_ACID", name: "Minor Acid Potion [T3]", herbId: "T3_COMFREY" },
  { id: "T5_POTION_ACID", name: "Acid Potion [T5]",       herbId: "T5_TEASEL" },
  { id: "T7_POTION_ACID", name: "Major Acid Potion [T7]", herbId: "T7_MULLEIN" },

  // Berserk (POTION_BERSERK) — Werewolf Fangs (Werewolf): T4 / T6 / T8.
  { id: "T4_POTION_BERSERK", name: "Minor Berserk Potion [T4]", herbId: "T4_BURDOCK" },
  { id: "T6_POTION_BERSERK", name: "Berserk Potion [T6]",       herbId: "T6_FOXGLOVE" },
  { id: "T8_POTION_BERSERK", name: "Major Berserk Potion [T8]", herbId: "T8_YARROW" },

  // Gathering (POTION_GATHER) — Runestone Tooth (Elemental): T4 / T6 / T8.
  // T4 has no herb (butter-based) → herbId null.
  { id: "T4_POTION_GATHER", name: "Minor Gathering Potion [T4]", herbId: null },
  { id: "T6_POTION_GATHER", name: "Gathering Potion [T6]",       herbId: "T6_FOXGLOVE" },
  { id: "T8_POTION_GATHER", name: "Major Gathering Potion [T8]", herbId: "T8_YARROW" },

  // Hellfire (POTION_LAVA internal name) — Imp's Horn (Imp): T4 / T6 / T8.
  // T4 has no herb (milk-based) → herbId null.
  { id: "T4_POTION_LAVA", name: "Minor Hellfire Potion [T4]", herbId: null },
  { id: "T6_POTION_LAVA", name: "Hellfire Potion [T6]",       herbId: "T6_FOXGLOVE" },
  { id: "T8_POTION_LAVA", name: "Major Hellfire Potion [T8]", herbId: "T8_YARROW" },

  // Tornado in a Bottle (POTION_TORNADO) — Dawnfeather (Eagle): T4 / T6 / T8.
  { id: "T4_POTION_TORNADO", name: "Minor Tornado in a Bottle [T4]", herbId: "T4_BURDOCK" },
  { id: "T6_POTION_TORNADO", name: "Tornado in a Bottle [T6]",       herbId: "T6_FOXGLOVE" },
  { id: "T8_POTION_TORNADO", name: "Major Tornado in a Bottle [T8]", herbId: "T8_YARROW" },

  // ── Dragonfire Potions ──────────────────────────────────────────────────
  // Lifeward (POTION_LIFEWARD) — Dragon Blood, dropped by Drakes and Dragons
  // rather than gathered by Tracking: T4 / T6 / T8. Recipes live in
  // recipes-dragon-potions.js; the blood gets no RRR refund (noReturn).
  { id: "T4_POTION_LIFEWARD", name: "Minor Lifeward Potion [T4]", herbId: "T4_BURDOCK" },
  { id: "T6_POTION_LIFEWARD", name: "Lifeward Potion [T6]",       herbId: "T6_FOXGLOVE" },
  { id: "T8_POTION_LIFEWARD", name: "Major Lifeward Potion [T8]", herbId: "T8_YARROW" },

  // ── Meals ───────────────────────────────────────────────────────────────
  // Pies: T3 / T5 / T7 (gathering yield). Named after the meat tier that
  // butchers into the recipe (T3=chicken, T5=goose, T7=pork).
  { id: "T3_MEAL_PIE", name: "Chicken Pie [T3]" },
  { id: "T5_MEAL_PIE", name: "Goose Pie [T5]" },
  { id: "T7_MEAL_PIE", name: "Pork Pie [T7]" },

  // Stews: T4 / T6 / T8 (damage). T4=goat, T6=mutton (sheep), T8=beef (cow).
  { id: "T4_MEAL_STEW", name: "Goat Stew [T4]" },
  { id: "T6_MEAL_STEW", name: "Mutton Stew [T6]" },
  { id: "T8_MEAL_STEW", name: "Beef Stew [T8]" },

  // Sandwiches: T4 / T6 / T8 (max HP). Same tier→meat mapping as Stew.
  { id: "T4_MEAL_SANDWICH", name: "Goat Sandwich [T4]" },
  { id: "T6_MEAL_SANDWICH", name: "Mutton Sandwich [T6]" },
  { id: "T8_MEAL_SANDWICH", name: "Beef Sandwich [T8]" },

  // Omelettes: T3 / T5 / T7 (cast speed). Same tier→meat mapping as Pie.
  { id: "T3_MEAL_OMELETTE", name: "Chicken Omelette [T3]" },
  { id: "T5_MEAL_OMELETTE", name: "Goose Omelette [T5]" },
  { id: "T7_MEAL_OMELETTE", name: "Pork Omelette [T7]" },

  // Soups: T1 / T3 / T5 (health regen). Named after the staple crop
  // ingredient (T1=Carrots, T3=Sheaf of Wheat, T5=Cabbage).
  { id: "T1_MEAL_SOUP", name: "Carrot Soup [T1]" },
  { id: "T3_MEAL_SOUP", name: "Wheat Soup [T3]" },
  { id: "T5_MEAL_SOUP", name: "Cabbage Soup [T5]" },

  // Roasts: T3 / T5 / T7 (lifesteal). In-game name uses "Roast X" form.
  { id: "T3_MEAL_ROAST", name: "Roast Chicken [T3]" },
  { id: "T5_MEAL_ROAST", name: "Roast Goose [T5]" },
  { id: "T7_MEAL_ROAST", name: "Roast Pork [T7]" },

  // Salads: T2 / T4 / T6 (crafting speed).
  { id: "T2_MEAL_SALAD", name: "Bean Salad [T2]" },
  { id: "T4_MEAL_SALAD", name: "Turnip Salad [T4]" },
  { id: "T6_MEAL_SALAD", name: "Potato Salad [T6]" },

  // ── Fish Meals ──────────────────────────────────────────────────────────
  // Grilled Fish & Seaweed Salad: T1 only, single-ingredient cooked foods.
  // Grilled Fish = 10× Fish Chops (any butchered fish); Seaweed Salad =
  // 10× Seaweed. Both take normal RRR (items.xml:3904-3913).
  { id: "T1_MEAL_GRILLEDFISH",  name: "Grilled Fish [T1]" },
  { id: "T1_MEAL_SEAWEEDSALAD", name: "Seaweed Salad [T1]" },
  // Soup Fish (Health Regen, swamp clams): T1 / T3 / T5.
  { id: "T1_MEAL_SOUP_FISH", name: "Greenmoor Clam Soup [T1]" },
  { id: "T3_MEAL_SOUP_FISH", name: "Murkwater Clam Soup [T3]" },
  { id: "T5_MEAL_SOUP_FISH", name: "Blackbog Clam Soup [T5]" },
  // Salad Fish (Crafting Speed, saltwater): T2 / T4 / T6.
  { id: "T2_MEAL_SALAD_FISH", name: "Shallowshore Squid Salad [T2]" },
  { id: "T4_MEAL_SALAD_FISH", name: "Midwater Octopus Salad [T4]" },
  { id: "T6_MEAL_SALAD_FISH", name: "Deepwater Kraken Salad [T6]" },
  // Pie Fish (Gathering Yield, mountain coldeyes): T3 / T5 / T7.
  { id: "T3_MEAL_PIE_FISH", name: "Upland Coldeye Pie [T3]" },
  { id: "T5_MEAL_PIE_FISH", name: "Mountain Blindeye Pie [T5]" },
  { id: "T7_MEAL_PIE_FISH", name: "Frostpeak Deadeye Pie [T7]" },
  // Omelette Fish (Cast Speed, steppe crabs): T3 / T5 / T7.
  { id: "T3_MEAL_OMELETTE_FISH", name: "Lowriver Crab Omelette [T3]" },
  { id: "T5_MEAL_OMELETTE_FISH", name: "Drybrook Crab Omelette [T5]" },
  { id: "T7_MEAL_OMELETTE_FISH", name: "Dusthole Crab Omelette [T7]" },
  // Leyfin Omelettes (Cast Speed + CDR + heal bonus, Ancient Lands leyfin):
  // T3 / T5 / T7. Dragonfire, 2026-08-31.
  { id: "T3_MEAL_OMELETTE_DRAGONAREA", name: "Carefree Leyfin Omelette [T3]" },
  { id: "T5_MEAL_OMELETTE_DRAGONAREA", name: "Brightsoul Leyfin Omelette [T5]" },
  { id: "T7_MEAL_OMELETTE_DRAGONAREA", name: "Dragonbound Leyfin Omelette [T7]" },
  // Stew Fish (Damage, forest eels): T4 / T6 / T8.
  { id: "T4_MEAL_STEW_FISH", name: "Greenriver Eel Stew [T4]" },
  { id: "T6_MEAL_STEW_FISH", name: "Redspring Eel Stew [T6]" },
  { id: "T8_MEAL_STEW_FISH", name: "Deadwater Eel Stew [T8]" },
  // Sandwich Fish (Max HP, highland lurchers): T4 / T6 / T8.
  { id: "T4_MEAL_SANDWICH_FISH", name: "Stonestream Lurcher Sandwich [T4]" },
  { id: "T6_MEAL_SANDWICH_FISH", name: "Rushwater Lurcher Sandwich [T6]" },
  { id: "T8_MEAL_SANDWICH_FISH", name: "Thunderfall Lurcher Sandwich [T8]" },
  // Roast Fish (Lifesteal, avalon snappers): T3 / T5 / T7.
  // In-game name pattern is "Roasted <Fish>" rather than "<Fish> Roast".
  { id: "T3_MEAL_ROAST_FISH", name: "Roasted Whitefog Snapper [T3]" },
  { id: "T5_MEAL_ROAST_FISH", name: "Roasted Clearhaze Snapper [T5]" },
  { id: "T7_MEAL_ROAST_FISH", name: "Roasted Puremist Snapper [T7]" },

  // ── Avalonian Meals ─────────────────────────────────────────────────────
  // Same tier→meat mapping as the standard meals; in-game names are
  // "Avalonian <Meat> <MealType>".
  { id: "T3_MEAL_OMELETTE_AVALON", name: "Avalonian Chicken Omelette [T3]" },
  { id: "T5_MEAL_OMELETTE_AVALON", name: "Avalonian Goose Omelette [T5]" },
  { id: "T7_MEAL_OMELETTE_AVALON", name: "Avalonian Pork Omelette [T7]" },
  { id: "T4_MEAL_STEW_AVALON",     name: "Avalonian Goat Stew [T4]" },
  { id: "T6_MEAL_STEW_AVALON",     name: "Avalonian Mutton Stew [T6]" },
  { id: "T8_MEAL_STEW_AVALON",     name: "Avalonian Beef Stew [T8]" },
  { id: "T4_MEAL_SANDWICH_AVALON", name: "Avalonian Goat Sandwich [T4]" },
  { id: "T6_MEAL_SANDWICH_AVALON", name: "Avalonian Mutton Sandwich [T6]" },
  { id: "T8_MEAL_SANDWICH_AVALON", name: "Avalonian Beef Sandwich [T8]" },

  // ── Special Food ────────────────────────────────────────────────────────
  // Drake Egg Biscuits (Dragonfire, 2026-08-31) — a combat+gathering FAME food
  // that stacks with a normal combat food. Cooked from a whole Firewing Drake
  // Egg, so the egg's price dominates the row; one craft action yields 99
  // biscuits and costs no focus.
  { id: "T8_MEAL_SPECIAL_FOOD_DRAKE_EGG", name: "Drake Egg Biscuits [T8]" },

  // ── Fish Sauce ──────────────────────────────────────────────────────────
  // Enchant-upgrade material for T4+ meals (the [.1] / [.2] / [.3]
  // variants). Tradeable in-game — verified via Thetford Marketplace buy
  // orders 2026-05-14. Three rarity tiers map to the three enchant levels.
  { id: "T1_FISHSAUCE_LEVEL1", name: "Basic Fish Sauce [T1]" },
  { id: "T1_FISHSAUCE_LEVEL2", name: "Fancy Fish Sauce [T1]" },
  { id: "T1_FISHSAUCE_LEVEL3", name: "Special Fish Sauce [T1]" },

  // ── Fishing Bait ────────────────────────────────────────────────────────
  // Cooked at the Cook station; only T1 / T3 / T5 exist, all made from Worms
  // (1 / 5 / 25). Used to bait fishing spots. Not focus-craftable.
  { id: "T1_FISHINGBAIT", name: "Fishing Bait [T1]" },
  { id: "T3_FISHINGBAIT", name: "Fishing Bait [T3]" },
  { id: "T5_FISHINGBAIT", name: "Fishing Bait [T5]" },

  // ── Raw Ingredients (Flips) — Crops ─────────────────────────────────────
  { id: "T1_CARROT",  name: "Carrots [T1 Ingredient]",     herbId: null },
  { id: "T2_BEAN",    name: "Beans [T2 Ingredient]",       herbId: null },
  { id: "T3_WHEAT",   name: "Sheaf of Wheat [T3 Ingredient]", herbId: null },
  { id: "T4_TURNIP",  name: "Turnips [T4 Ingredient]",     herbId: null },
  { id: "T5_CABBAGE", name: "Cabbage [T5 Ingredient]",     herbId: null },
  { id: "T6_POTATO",  name: "Potatoes [T6 Ingredient]",    herbId: null },
  { id: "T7_CORN",    name: "Bundle of Corn [T7 Ingredient]", herbId: null },
  { id: "T8_PUMPKIN", name: "Pumpkin [T8 Ingredient]",     herbId: null },

  // ── Raw Ingredients (Flips) — Herbs ────────────────────────────────────
  // Tier coverage follows the alchemy line: T2 Agaric, T3 Comfrey,
  // T4 Burdock, T5 Teasel, T6 Foxglove, T7 Mullein, T8 Yarrow.
  { id: "T2_AGARIC",   name: "Arcane Agaric [T2 Herb]",        herbId: null },
  { id: "T3_COMFREY",  name: "Brightleaf Comfrey [T3 Herb]",   herbId: null },
  { id: "T4_BURDOCK",  name: "Crenellated Burdock [T4 Herb]",  herbId: null },
  { id: "T5_TEASEL",   name: "Dragon Teasel [T5 Herb]",        herbId: null },
  { id: "T6_FOXGLOVE", name: "Elusive Foxglove [T6 Herb]",     herbId: null },
  { id: "T7_MULLEIN",  name: "Firetouched Mullein [T7 Herb]",  herbId: null },
  { id: "T8_YARROW",   name: "Ghoul Yarrow [T8 Herb]",         herbId: null },

  // ── Raw Ingredients (Flips) — Meats ────────────────────────────────────
  { id: "T3_MEAT", name: "Raw Chicken [T3 Meat]", herbId: null },
  { id: "T4_MEAT", name: "Raw Goat [T4 Meat]",    herbId: null },
  { id: "T5_MEAT", name: "Raw Goose [T5 Meat]",   herbId: null },
  { id: "T6_MEAT", name: "Raw Mutton [T6 Meat]",  herbId: null },
  { id: "T7_MEAT", name: "Raw Pork [T7 Meat]",    herbId: null },
  { id: "T8_MEAT", name: "Raw Beef [T8 Meat]",    herbId: null },

  // ── Pasture byproducts (milk + eggs) ───────────────────────────────────
  // NOT flips: you produce these. A grown animal on a pasture slot eats 9
  // favorite crops per 22h cycle and hands back 9 milk/eggs (18 with Premium),
  // surviving as reusable capital. CHAIN_RECIPES builds one pasture entry per
  // FARMING_PRODUCTION byproduct, so — like the alcohol block below — the entry
  // stays materials-free, resolveConsumableRecipe keeps returning nothing, and
  // the chain-craft branch of the renderer is what fires.
  // Milk exists for T4 / T6 / T8 only (goat / sheep / cow); eggs for T3 chicken
  // and T5 goose. T7 Pig is meat-only.
  { id: "T4_MILK", name: "Goat's Milk [T4]",  herbId: null },
  { id: "T6_MILK", name: "Sheep's Milk [T6]", herbId: null },
  { id: "T8_MILK", name: "Cow's Milk [T8]",   herbId: null },
  { id: "T3_EGG",  name: "Hen Eggs [T3]",     herbId: null },
  { id: "T5_EGG",  name: "Goose Eggs [T5]",   herbId: null },

  // ── Dairy chain crafts — Butter ────────────────────────────────────────
  // Milled 1:1 from the matching milk, which itself may come off the market or
  // out of the pasture, whichever prices lower.
  { id: "T4_BUTTER", name: "Goat's Butter [T4]",  herbId: null },
  { id: "T6_BUTTER", name: "Sheep's Butter [T6]", herbId: null },
  { id: "T8_BUTTER", name: "Cow's Butter [T8]",   herbId: null },

  // ── Raw Ingredients (Flips) — Baked Goods ──────────────────────────────
  // Only T4_BREAD exists in-game. T3_FLOUR is the only flour tier.
  { id: "T3_FLOUR", name: "Flour [T3]", herbId: null },
  { id: "T4_BREAD", name: "Bread [T4]", herbId: null },

  // ── Raw Ingredients (Flips) — Fishing Bait Worms ───────────────────────
  // Only T1_WORM exists; it's the sole ingredient for all fishing-bait tiers.
  { id: "T1_WORM", name: "Worms [T1 Ingredient]", herbId: null },

  // ── Alcohol ────────────────────────────────────────────────────────────
  // Chain crafts, not flips: CHAIN_RECIPES turns 1 crop into 1 alcohol at the
  // alchemist. They sit in this list the way flour/butter/meat do — the entry
  // stays materials-free so resolveConsumableRecipe keeps returning nothing
  // and the chain-craft branch of the renderer is what fires.
  { id: "T6_ALCOHOL", name: "Potato Schnapps [T6]",   herbId: null },
  { id: "T7_ALCOHOL", name: "Corn Hooch [T7]",        herbId: null },
  { id: "T8_ALCOHOL", name: "Pumpkin Moonshine [T8]", herbId: null },

  // ── Raw Ingredients (Flips) — Avalonian Energy ─────────────────────────
  { id: "QUESTITEM_TOKEN_AVALON", name: "Avalonian Energy", herbId: null },

  // ── Raw Ingredients (Flips) — Rare Fish ────────────────────────────────
  // Forest — Eels (Stew Fish ingredient)
  { id: "T3_FISH_FRESHWATER_FOREST_RARE", name: "Greenriver Eel [T3 Fish]", herbId: null },
  { id: "T5_FISH_FRESHWATER_FOREST_RARE", name: "Redspring Eel [T5 Fish]",  herbId: null },
  { id: "T7_FISH_FRESHWATER_FOREST_RARE", name: "Deadwater Eel [T7 Fish]",  herbId: null },
  // Swamp — Clams (Soup Fish ingredient)
  { id: "T3_FISH_FRESHWATER_SWAMP_RARE", name: "Greenmoor Clam [T3 Fish]",  herbId: null },
  { id: "T5_FISH_FRESHWATER_SWAMP_RARE", name: "Murkwater Clam [T5 Fish]",  herbId: null },
  { id: "T7_FISH_FRESHWATER_SWAMP_RARE", name: "Blackbog Clam [T7 Fish]",   herbId: null },
  // Mountain — Coldeyes (Pie Fish ingredient)
  { id: "T3_FISH_FRESHWATER_MOUNTAIN_RARE", name: "Upland Coldeye [T3 Fish]",     herbId: null },
  { id: "T5_FISH_FRESHWATER_MOUNTAIN_RARE", name: "Mountain Blindeye [T5 Fish]",  herbId: null },
  { id: "T7_FISH_FRESHWATER_MOUNTAIN_RARE", name: "Frostpeak Deadeye [T7 Fish]",  herbId: null },
  // Highlands — Lurchers (Sandwich Fish ingredient)
  { id: "T3_FISH_FRESHWATER_HIGHLANDS_RARE", name: "Stonestream Lurcher [T3 Fish]",  herbId: null },
  { id: "T5_FISH_FRESHWATER_HIGHLANDS_RARE", name: "Rushwater Lurcher [T5 Fish]",    herbId: null },
  { id: "T7_FISH_FRESHWATER_HIGHLANDS_RARE", name: "Thunderfall Lurcher [T7 Fish]",  herbId: null },
  // Steppe — Crabs (Omelette Fish ingredient)
  { id: "T3_FISH_FRESHWATER_STEPPE_RARE", name: "Lowriver Crab [T3 Fish]", herbId: null },
  { id: "T5_FISH_FRESHWATER_STEPPE_RARE", name: "Drybrook Crab [T5 Fish]", herbId: null },
  { id: "T7_FISH_FRESHWATER_STEPPE_RARE", name: "Dusthole Crab [T7 Fish]", herbId: null },
  // Saltwater — Squid / Octopus / Kraken (Salad Fish ingredient)
  { id: "T3_FISH_SALTWATER_ALL_RARE", name: "Shallowshore Squid [T3 Fish]", herbId: null },
  { id: "T5_FISH_SALTWATER_ALL_RARE", name: "Midwater Octopus [T5 Fish]",   herbId: null },
  { id: "T7_FISH_SALTWATER_ALL_RARE", name: "Deepwater Kraken [T7 Fish]",   herbId: null },
  // Avalon — Snappers (Roast Fish ingredient)
  { id: "T3_FISH_FRESHWATER_AVALON_RARE", name: "Whitefog Snapper [T3 Fish]",  herbId: null },
  { id: "T5_FISH_FRESHWATER_AVALON_RARE", name: "Clearhaze Snapper [T5 Fish]", herbId: null },
  { id: "T7_FISH_FRESHWATER_AVALON_RARE", name: "Puremist Snapper [T7 Fish]",  herbId: null },
  // Ancient Lands — Leyfin (Leyfin Omelette ingredient). Dragonfire, 2026-08-31.
  // Caught only inside the instanced Ancient Lands, so they are deliberately
  // NOT part of FISH_RARE_BIOMES (js/data-gathering.js) — the open-world
  // fishing rows must not be inflated by a fish you cannot catch there.
  { id: "T3_FISH_FRESHWATER_DRAGON_AREA_RARE", name: "Carefree Leyfin [T3 Fish]",   herbId: null },
  { id: "T5_FISH_FRESHWATER_DRAGON_AREA_RARE", name: "Brightsoul Leyfin [T5 Fish]", herbId: null },
  { id: "T7_FISH_FRESHWATER_DRAGON_AREA_RARE", name: "Dragonbound Leyfin [T7 Fish]", herbId: null },
];
