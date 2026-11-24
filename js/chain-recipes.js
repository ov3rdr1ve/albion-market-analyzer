// Intermediate craft recipes used by the consumables table to expand the
// "buy raw vs make-it-yourself" comparison. Sourced directly from items.xml
// (simpleitem entries). These are *not* end consumables — they're the leaf
// ingredients (raw meat, flour, bread, butter, alcohol) that feed into
// BUNDLED_RECIPES.
//
// Shape: { matId: { inputs: [{ matId, count, noReturn? }], output, station } }
// `output` = how many of the produced item come out of one craft batch.
// `noReturn = true` on an input means the input is fully consumed (no RRR
// refund). Two crafts use this flag:
//   - Butcher (meat, fish chops) — items.xml flags these with
//     returnproductnotresource="true", so RRR is paid as extra output meat
//     rather than as input refund. We conservatively ignore the extra-output
//     bonus and treat the input as fully consumed.
//   - Cook → fish sauce (T1_FISHSAUCE_LEVEL{1,2,3}) — fish sauce simply has
//     no RRR; chops and seaweed are always fully consumed.
const CHAIN_RECIPES = {
  // Mill — Sheaf of Wheat → Flour (1:1)
  T3_FLOUR: { inputs: [{ matId: "T3_WHEAT", count: 1 }], output: 1, station: "mill" },

  // Bakery (Cook station) — Flour → Bread (1:1). Only T4_BREAD exists in-game;
  // recipes.js still references T3_BREAD/T5_BREAD which are legacy IDs and
  // resolve to no chain (treated as raw market lookup).
  T4_BREAD: { inputs: [{ matId: "T3_FLOUR", count: 1 }], output: 1, station: "cook" },

  // Dairy — Milk → Butter (1:1) at the MILL, like flour (see data-craft-stations,
  // which already maps _BUTTER there). Only even tiers exist in-game.
  T4_BUTTER: { inputs: [{ matId: "T4_MILK", count: 1 }], output: 1, station: "mill" },
  T6_BUTTER: { inputs: [{ matId: "T6_MILK", count: 1 }], output: 1, station: "mill" },
  T8_BUTTER: { inputs: [{ matId: "T8_MILK", count: 1 }], output: 1, station: "mill" },

  // Alchemist — 1 crop → 1 alcohol (1:1, like butter). The station is the
  // ALCHEMIST, not the mill: buildings.xml lists T6/T7/T8_ALCOHOL as
  // <craftitem> of T6/T7/T8_ALCHEMIST (@BUILDING_ITEMS_CATEGORY_POTIONS),
  // while the mill craftbuilding lists only T3_FLOUR and the three butters.
  // Only T6/T7/T8 alcohol exists in-game.
  T6_ALCOHOL: { inputs: [{ matId: "T6_POTATO",  count: 1 }], output: 1, station: "alchemist" },
  T7_ALCOHOL: { inputs: [{ matId: "T7_CORN",    count: 1 }], output: 1, station: "alchemist" },
  T8_ALCOHOL: { inputs: [{ matId: "T8_PUMPKIN", count: 1 }], output: 1, station: "alchemist" },

  // Butcher — 1 Grown Animal → 18 Raw Meat. The animal is fully consumed; the
  // city RRR pays out as extra meats (returnproductnotresource flag) which we
  // ignore here for a conservative estimate.
  T3_MEAT: { inputs: [{ matId: "T3_FARM_CHICKEN_GROWN", count: 1, noReturn: true }], output: 18, station: "butcher" },
  T4_MEAT: { inputs: [{ matId: "T4_FARM_GOAT_GROWN",    count: 1, noReturn: true }], output: 18, station: "butcher" },
  T5_MEAT: { inputs: [{ matId: "T5_FARM_GOOSE_GROWN",   count: 1, noReturn: true }], output: 18, station: "butcher" },
  T6_MEAT: { inputs: [{ matId: "T6_FARM_SHEEP_GROWN",   count: 1, noReturn: true }], output: 18, station: "butcher" },
  T7_MEAT: { inputs: [{ matId: "T7_FARM_PIG_GROWN",     count: 1, noReturn: true }], output: 18, station: "butcher" },
  T8_MEAT: { inputs: [{ matId: "T8_FARM_COW_GROWN",     count: 1, noReturn: true }], output: 18, station: "butcher" },
};

// ─────────────────────────────────────────────────────────────────────────
// PASTURE — eggs and milk from a grown animal.
//
// A grown animal on a pasture slot eats `feedCount` favorite crops per 22h cycle
// and hands back `produceBase` eggs/milk. The animal SURVIVES the harvest, so it
// is reusable capital, not an input: it rides on `capital` (priced for display by
// the row, never summed into the cost — chain-pricing.js only walks `inputs`),
// exactly the way js/farming-row-econ.js evaluateFarmingAnimal treats it.
// The feed is eaten outright (`noReturn`) — a pasture has no return rate.
//
// Derived from FARMING_PRODUCTION so the Consumables and Farming tables can
// never disagree about the same cycle. index.html loads data-farming.js before
// this file; the guard keeps Node harnesses that load chain-recipes.js alone
// from throwing.
//
// `output` is the free-account base. Premium and the +10% byproduct spec city
// scale it at pricing time — see getPastureYieldMultiplier in js/pasture-econ.js.
if (typeof FARMING_PRODUCTION !== "undefined") {
  FARMING_PRODUCTION.filter((r) => r.type === "byproduct").forEach((r) => {
    CHAIN_RECIPES[r.outputId] = {
      inputs: [{ matId: r.feedId, count: r.feedCount, noReturn: true }],
      output: r.produceBase,
      station: "pasture",
      capital: { matId: r.animalId, count: 1 },
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────
// FISH CHOPS — butcher routes from every fish in items.xml.
//
// Unlike raw meat (one animal per meat tier), fish chops always produces
// the same output item (T1_FISHCHOPS) regardless of the fish input. The
// 38 fish→chops crafting requirements in items.xml:1201-1316 each get
// their own synthetic CHAIN_RECIPES entry keyed `T1_FISHCHOPS__<fishId>`
// so they can render as separate rows in the Consumables table. The
// row's sell price routes back to real T1_FISHCHOPS market data via the
// `sellAs` field on each CONSUMABLES entry (handled in render-consumables.js).
//
// Yields verified against items.xml:1201-1316 (2026-05-14):
//   freshwater common T1-T8 → 1/2/3/4/6/8/10/14 chops
//   saltwater common T1-T8 → 1/2/3/4/6/8/10/14 chops (mirror)
//   biome rare T3/T5/T7    → 10/20/30 chops (6 biomes + saltwater rare)
//   T8 boss shark          → 200 chops
const FISHCHOPS_FISH_SOURCES = [
  // Freshwater common
  { fishId: "T1_FISH_FRESHWATER_ALL_COMMON", yield:   1, label: "Common Rudd [T1]" },
  { fishId: "T2_FISH_FRESHWATER_ALL_COMMON", yield:   2, label: "Striped Carp [T2]" },
  { fishId: "T3_FISH_FRESHWATER_ALL_COMMON", yield:   3, label: "Albion Perch [T3]" },
  { fishId: "T4_FISH_FRESHWATER_ALL_COMMON", yield:   4, label: "Bluescale Pike [T4]" },
  { fishId: "T5_FISH_FRESHWATER_ALL_COMMON", yield:   6, label: "Spotted Trout [T5]" },
  { fishId: "T6_FISH_FRESHWATER_ALL_COMMON", yield:   8, label: "Brightscale Zander [T6]" },
  { fishId: "T7_FISH_FRESHWATER_ALL_COMMON", yield:  10, label: "Danglemouth Catfish [T7]" },
  { fishId: "T8_FISH_FRESHWATER_ALL_COMMON", yield:  14, label: "River Sturgeon [T8]" },
  // Saltwater common (yields mirror freshwater)
  { fishId: "T1_FISH_SALTWATER_ALL_COMMON",  yield:   1, label: "Common Herring [T1]" },
  { fishId: "T2_FISH_SALTWATER_ALL_COMMON",  yield:   2, label: "Striped Mackerel [T2]" },
  { fishId: "T3_FISH_SALTWATER_ALL_COMMON",  yield:   3, label: "Flatshore Plaice [T3]" },
  { fishId: "T4_FISH_SALTWATER_ALL_COMMON",  yield:   4, label: "Bluescale Cod [T4]" },
  { fishId: "T5_FISH_SALTWATER_ALL_COMMON",  yield:   6, label: "Spotted Wolffish [T5]" },
  { fishId: "T6_FISH_SALTWATER_ALL_COMMON",  yield:   8, label: "Strongfin Salmon [T6]" },
  { fishId: "T7_FISH_SALTWATER_ALL_COMMON",  yield:  10, label: "Bluefin Tuna [T7]" },
  { fishId: "T8_FISH_SALTWATER_ALL_COMMON",  yield:  14, label: "Steelscale Swordfish [T8]" },
  // Freshwater rare — Forest (Eels)
  { fishId: "T3_FISH_FRESHWATER_FOREST_RARE", yield: 10, label: "Greenriver Eel [T3]" },
  { fishId: "T5_FISH_FRESHWATER_FOREST_RARE", yield: 20, label: "Redspring Eel [T5]" },
  { fishId: "T7_FISH_FRESHWATER_FOREST_RARE", yield: 30, label: "Deadwater Eel [T7]" },
  // Freshwater rare — Steppe (Crabs)
  { fishId: "T3_FISH_FRESHWATER_STEPPE_RARE", yield: 10, label: "Lowriver Crab [T3]" },
  { fishId: "T5_FISH_FRESHWATER_STEPPE_RARE", yield: 20, label: "Drybrook Crab [T5]" },
  { fishId: "T7_FISH_FRESHWATER_STEPPE_RARE", yield: 30, label: "Dusthole Crab [T7]" },
  // Freshwater rare — Mountain (Coldeyes)
  { fishId: "T3_FISH_FRESHWATER_MOUNTAIN_RARE", yield: 10, label: "Upland Coldeye [T3]" },
  { fishId: "T5_FISH_FRESHWATER_MOUNTAIN_RARE", yield: 20, label: "Mountain Blindeye [T5]" },
  { fishId: "T7_FISH_FRESHWATER_MOUNTAIN_RARE", yield: 30, label: "Frostpeak Deadeye [T7]" },
  // Freshwater rare — Highlands (Lurchers)
  { fishId: "T3_FISH_FRESHWATER_HIGHLANDS_RARE", yield: 10, label: "Stonestream Lurcher [T3]" },
  { fishId: "T5_FISH_FRESHWATER_HIGHLANDS_RARE", yield: 20, label: "Rushwater Lurcher [T5]" },
  { fishId: "T7_FISH_FRESHWATER_HIGHLANDS_RARE", yield: 30, label: "Thunderfall Lurcher [T7]" },
  // Freshwater rare — Swamp (Clams)
  { fishId: "T3_FISH_FRESHWATER_SWAMP_RARE", yield: 10, label: "Greenmoor Clam [T3]" },
  { fishId: "T5_FISH_FRESHWATER_SWAMP_RARE", yield: 20, label: "Murkwater Clam [T5]" },
  { fishId: "T7_FISH_FRESHWATER_SWAMP_RARE", yield: 30, label: "Blackbog Clam [T7]" },
  // Freshwater rare — Avalon (Snappers)
  { fishId: "T3_FISH_FRESHWATER_AVALON_RARE", yield: 10, label: "Whitefog Snapper [T3]" },
  { fishId: "T5_FISH_FRESHWATER_AVALON_RARE", yield: 20, label: "Clearhaze Snapper [T5]" },
  { fishId: "T7_FISH_FRESHWATER_AVALON_RARE", yield: 30, label: "Puremist Snapper [T7]" },
  // Freshwater rare — Ancient Lands (Leyfin). Dragonfire, 2026-08-31.
  { fishId: "T3_FISH_FRESHWATER_DRAGON_AREA_RARE", yield: 10, label: "Carefree Leyfin [T3]" },
  { fishId: "T5_FISH_FRESHWATER_DRAGON_AREA_RARE", yield: 20, label: "Brightsoul Leyfin [T5]" },
  { fishId: "T7_FISH_FRESHWATER_DRAGON_AREA_RARE", yield: 30, label: "Dragonbound Leyfin [T7]" },
  // Saltwater rare (Squid / Octopus / Kraken)
  { fishId: "T3_FISH_SALTWATER_ALL_RARE", yield: 10, label: "Shallowshore Squid [T3]" },
  { fishId: "T5_FISH_SALTWATER_ALL_RARE", yield: 20, label: "Midwater Octopus [T5]" },
  { fishId: "T7_FISH_SALTWATER_ALL_RARE", yield: 30, label: "Deepwater Kraken [T7]" },
  // Saltwater boss
  { fishId: "T8_FISH_SALTWATER_ALL_BOSS_SHARK", yield: 200, label: "Shark [T8]" },
];

// Register each fish source as its own CHAIN_RECIPES entry. The key is
// the synthetic id; the renderer treats it as a chain output but routes
// sell-side lookups to T1_FISHCHOPS via the row's `sellAs` field.
FISHCHOPS_FISH_SOURCES.forEach((f) => {
  CHAIN_RECIPES[`T1_FISHCHOPS__${f.fishId}`] = {
    inputs: [{ matId: f.fishId, count: 1, noReturn: true }],
    output: f.yield,
    station: "butcher",
  };
});

// Push corresponding CONSUMABLES rows. Script load order in index.html
// puts data-consumables.js BEFORE chain-recipes.js, so CONSUMABLES is
// already defined when this loop runs. Each row sets sellAs so the
// renderer routes market-data, override, and focus-cost lookups back
// to the real T1_FISHCHOPS id.
if (typeof CONSUMABLES !== "undefined") {
  FISHCHOPS_FISH_SOURCES.forEach((f) => {
    CONSUMABLES.push({
      id: `T1_FISHCHOPS__${f.fishId}`,
      name: `Fish Chops [T1] (← ${f.label})`,
      sellAs: "T1_FISHCHOPS",
    });
  });
  // Aggregate row: real T1_FISHCHOPS id with a multi-option chain that
  // auto-picks the cheapest fish source per city at render time. Marked
  // `forcedChainOnly` so the chain only runs when this row force-chains
  // itself — other recipes that use T1_FISHCHOPS as an ingredient (e.g.,
  // fish sauce) still use market price, not the chain.
  CONSUMABLES.push({
    id: "T1_FISHCHOPS",
    name: "Fish Chops [T1] (auto: cheapest fish)",
  });
}

// Aggregate chain entry: multi-option recipe. Mirrors each entry in
// FISHCHOPS_FISH_SOURCES as a one-option subrecipe. chain-pricing.js
// scans every option at each city and picks the lowest cost-per-chop.
CHAIN_RECIPES["T1_FISHCHOPS"] = {
  options: FISHCHOPS_FISH_SOURCES.map((f) => ({
    inputs: [{ matId: f.fishId, count: 1, noReturn: true }],
    output: f.yield,
  })),
  station: "butcher",
  forcedChainOnly: true,
};

// Fish sauce chains (items.xml:1318-1335). Non-tradeable in-game, so they
// have no market price — the bonus walker recurses into their chops/seaweed
// sub-chain to find any tradeable + non-focus-craftable leaf savings (chops
// chain ~81.5 silver/unit at Lymhurst) and rolls those up into the parent
// enchanted recipe's silver/focus column. forcedChainOnly:true prevents
// inline-expansion in parent recipe breakdowns — sauce rows already render
// the sub-recipe separately as their own table rows.
CHAIN_RECIPES["T1_FISHSAUCE_LEVEL1"] = {
  inputs: [
    { matId: "T1_FISHCHOPS", count: 15, noReturn: true },
    { matId: "T1_SEAWEED",   count: 1,  noReturn: true },
  ],
  output: 1,
  station: "cook",
  forcedChainOnly: true,
};
CHAIN_RECIPES["T1_FISHSAUCE_LEVEL2"] = {
  inputs: [
    { matId: "T1_FISHCHOPS", count: 45, noReturn: true },
    { matId: "T1_SEAWEED",   count: 3,  noReturn: true },
  ],
  output: 1,
  station: "cook",
  forcedChainOnly: true,
};
CHAIN_RECIPES["T1_FISHSAUCE_LEVEL3"] = {
  inputs: [
    { matId: "T1_FISHCHOPS", count: 135, noReturn: true },
    { matId: "T1_SEAWEED",   count: 9,   noReturn: true },
  ],
  output: 1,
  station: "cook",
  forcedChainOnly: true,
};

