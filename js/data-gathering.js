// Gathering profitability data — raw resources you HARVEST from the open world
// (Mining, Quarrying, Lumberjacking, Skinning, Harvesting, Fishing), so the
// Gathering table can rank which gathering activity currently pays best.
//
// Scope: ONE comparable row per activity × tier so you can read off the best
// gathering Silver/Hour at a glance. Five land professions × 7 tiers (T2–T8) = 35,
// plus Fishing as 7 merged tier rows (T2–T8) + the single T1 seaweed byproduct =
// 8 → 43 rows total.
//
// Every Silver/kg & Silver/Hour is ALL-IN — the bonus is folded into the number,
// never shown as a separate "+x%" badge:
//   • land (ore/wood/hide/fiber) folds in the enchanted (.1–.4) drops you also
//     pull from T4+ nodes, weighted by an estimated zone rate (getEnchantDist);
//     stone has no enchanted version, so Quarrying stays flat.
//   • fishing folds in the biome RARE fish (fishing's "enchant"): each merged
//     Fishing[T] row prices the best common catch (freshwater vs saltwater) and
//     blends in the best-priced rare of that water at an estimated rare SHARE of
//     catches (FISH_RARE_SHARE). Rares exist only at T3/T5/T7, so a fishing tier
//     maps to its rare band (T4→T3, T6→T5, T8→T7); T2 has none.
//
// Fish carry their real (lighter) in-game weight and a minigame-paced catch rate
// (FISH_*). Ids are real game ids (T4_ORE, T6_HIDE, T6_ORE_LEVEL1@1,
// T5_FISH_FRESHWATER_ALL_COMMON, T7_FISH_FRESHWATER_FOREST_RARE …) so market
// prices resolve — see [[project_app_catalog_architecture]].
//
// The pure economics live in calcGatheringEconomics (land) and calcFishingEconomics
// (fishing) in js/calculations.js; this file holds the catalogue + tunables only.

// Raw resource family → gathering profession label + the in-game tool.
const GATHERING_PROFESSIONS = {
  ore:      { label: "Mining",        tool: "Pickaxe" },
  wood:     { label: "Lumberjacking", tool: "Wood Axe" },
  hide:     { label: "Skinning",      tool: "Skinning Knife" },
  fiber:    { label: "Harvesting",    tool: "Sickle" },
  rock:     { label: "Quarrying",     tool: "Stone Hammer" },
  fish:     { label: "Fishing",       tool: "Fishing Rod" },
  // Fishing inside the Ancient Lands is its own activity: you can only do it
  // while an Ancient Lands run is up, and the only catch that reaches the
  // market is the leyfin. Kept apart from `fish` so the badge, the tooltip and
  // the throughput estimate never claim to describe open-world fishing.
  fishAncient: { label: "Ancient Lands Fishing", tool: "Fishing Rod" },
  tracking: { label: "Tracking",      tool: "Tracking Toolkit" },
};

// LAND gathering families → raw-id segment after the tier prefix (T{tier}_{RAW}).
// Matches RESOURCE_DEFS in data.js; kept local so this file (and its test) can
// stand alone. Fishing is handled separately below (it merges multiple market ids
// per row), not via this table.
const GATHERING_RESOURCE_DEFS = [
  { type: "ore",   raw: "ORE" },
  { type: "wood",  raw: "WOOD" },
  { type: "hide",  raw: "HIDE" },
  { type: "fiber", raw: "FIBER" },
  { type: "rock",  raw: "ROCK" },
];

const GATHERING_TIERS = [2, 3, 4, 5, 6, 7, 8];

// Freshwater rare-fish biomes (the saltwater line is a single FISH_SALTWATER_ALL).
// A merged Fishing row blends in the best-priced rare of its water type.
const FISH_RARE_BIOMES = ["FOREST", "MOUNTAIN", "HIGHLANDS", "STEPPE", "SWAMP", "AVALON"];

// Rares exist only at T3/T5/T7. A fishing tier maps to its rare band by flooring
// to the nearest odd tier ≥ 3 (T3→3, T4→3, T5→5, T6→5, T7→7, T8→7); T2 has none.
function fishingRareTier(tier) {
  if (tier < 3) return null;
  return tier % 2 === 1 ? tier : tier - 1;
}

// Estimated raw resources gathered per hour — solo, decent gathering gear +
// spec, in a matching-tier zone. This is an ESTIMATE: the game publishes no
// clean per-tier rate, and real throughput swings hard with zone density,
// mount, spec, food and competition. The curve encodes the well-documented
// reality that higher tiers yield far FEWER units/hour — slower node respawn
// (Wiki "Resource": T2 ~30–90s vs T7/8 minutes), lower density, slower gather
// speed, and being gated to more dangerous zones. Each silver/hour cell scales
// linearly with these, so tune freely. These estimates assume a healthy
// black-zone-class node density (the Outlands, where most gathering runs go);
// royal-zone density is thinner. Basis: Albion Wiki "Gathering" / "Resource" +
// community silver/hour reports (~0.5–1.5M/h across tiers).
const GATHER_UNITS_PER_HOUR = {
  2: 1200,
  3: 900,
  4: 650,
  5: 480,
  6: 360,
  7: 270,
  8: 200,
};

// Estimated total FISH caught per hour (commons + the rare share) — fishing is a
// different activity from swinging a pickaxe at a node, so it gets its own curve.
// You cast, wait for a bite, then play the reel-in minigame; each landed catch
// yields ~3–4 fish. Throughput still falls with tier — higher-tier fish live in
// rarer, danger-gated spots and need a higher-tier rod — but the absolute rate is
// lower than mining at low tiers (the minigame paces you) and converges by T8. An
// ESTIMATE, tunable like GATHER_UNITS_PER_HOUR; calibrated so the live-priced
// silver/hour lands in the community band (~0.5–0.7M/h around T5, ~1.5–2M/h at
// T7–T8 with good gear): Albion Wiki "Fishing" + forum silver/hour guides.
const FISH_UNITS_PER_HOUR = {
  2: 600,
  3: 500,
  4: 420,
  5: 350,
  6: 290,
  7: 240,
  8: 200,
};

// Rare biome fish are fishing's "enchant" — a low SHARE of your catches at the
// rare-tier spots are rares (the rest commons), worth far more. We fold them into
// Silver/kg & Silver/Hour exactly like enchanted drops are folded into ore: the
// catch is common with prob (1−share), rare with prob `share`. TUNABLE — raise it
// with bait / higher fishing spec. (Rares only exist at T3/T5/T7.)
const FISH_RARE_SHARE = 0.08;

// Seaweed (the T1 fishing byproduct) comes up constantly while fishing — cheap
// and heavy. A single flat estimate; seaweed has no tiers and gets its own row.
const SEAWEED_UNITS_PER_HOUR = 200;

// Real in-game weight (kg) of fish, from items.xml <… resourcetype="FISH"
// weight="…">. Fish are far LIGHTER than the 0.1×1.5^tier mined/quarried
// resources (T8 common fish 0.73kg vs T8 ore 2.56kg) so they haul much better per
// kg. Rare fish are chunkier than commons (T3 0.52 / T5 0.78 / T7 1.04); seaweed
// is a flat 1kg.
const FISH_WEIGHT_KG = {
  1: 0.05, 2: 0.10, 3: 0.16, 4: 0.21, 5: 0.31, 6: 0.41, 7: 0.52, 8: 0.73,
};
const FISH_RARE_WEIGHT_KG = { 3: 0.52, 5: 0.78, 7: 1.04 };
const SEAWEED_WEIGHT_KG = 1.0;

// ─── Ancient Lands fishing (Dragonfire, 2026-08-31) ─────────────────────────
// The leyfin (T{3,5,7}_FISH_FRESHWATER_DRAGON_AREA_RARE) is caught only inside
// the instanced Ancient Lands, so it is deliberately NOT a seventh entry in
// FISH_RARE_BIOMES: the merged open-world rows must not price a fish you cannot
// catch in the open world. It gets its own rows instead, and those rows price
// the leyfin itself as the staple catch — there is no published common/rare
// split inside the instance, so the row does not invent one (rare share 0).
// Making the leyfin the staple also keeps the row's identity distinct: the
// gathering row key is rawId|section (js/sorting-row-key.js), so a row whose
// staple was the ordinary freshwater common would collide with the open-world
// row of the same tier.
const ANCIENT_FISH_TIERS = [3, 5, 7];

// Catches per hour inside the Ancient Lands. An ESTIMATE like
// FISH_UNITS_PER_HOUR, and a deliberately conservative one: an Ancient Lands
// run is time-boxed and contested, so only part of the hour is spent fishing.
// Set at ~40% of the open-world rate for the same tier. TUNABLE.
const ANCIENT_FISH_UNITS_PER_HOUR = {
  3: 200,
  5: 140,
  7: 96,
};

// ─── Tracking (Wild Blood hunting) ──────────────────────────────────────────
// Tracking is an open-world HUNTING profession (Wild Blood update): you use a
// Tracking Toolkit to reveal a creature's trail, run a multi-step hunt (each step
// relocates the target), kill it, and collect LOOT — not harvest a node. Three
// tradeable rewards per kill, all folded into the all-in Silver/kg & Silver/Hour
// (calcTrackingEconomics) so a Tracking row compares directly to Fishing/Mining:
//   • Rare Animal Remains — the STAPLE per-kill drop (a light ESSENCE alchemy
//     ingredient, T{3,5,7}_ALCHEMY_RARE_{creature}). Fishing's "common catch".
//     You hunt whichever creature pays best, so the row prices the best-paying
//     creature's remains (mirrors fishing picking the better-priced water).
//   • Shapeshifter Artifact — a low-chance, HIGH-value bonus drop
//     (T{4..8}_ARTEFACT_2H_SHAPESHIFTER_{faction}). Fishing's "rare fish": share-
//     blended into Silver/kg & Silver/Hour. Best-paying faction is priced.
//   • Rare-Quarry Black Market loot — silver/BM drops from rare quarries
//     (Earthdaughter / Keeper of Souls / Shadowmask). No clean per-unit price, so
//     it's a TUNABLE expected-silver estimate folded into Silver/Hour only (it has
//     no haulable per-kg weight). Combat/tracking fame is ignored (not tradeable).
// Remains exist only at T3/T5/T7 (the game's rare-ingredient band), so Tracking is
// 3 merged rows — one per remains tier — the same one-row-per-tier shape as fishing.

const TRACK_TIERS = [3, 5, 7];

// The 5 tracked animals (Wild Blood), by item key: PANTHER (Panther, T3), WEREWOLF
// (Werewolf, T4), IMP (Hellfire Imp, T5), ELEMENTAL (Stone Golem, T6), EAGLE (Dawnbird,
// T7). Each has a T3/T5/T7 "Rare Animal Remains" quality variant. (Direbear & Ent are
// legacy rare-ingredient creatures, not trackable animals — excluded.) Display names
// live in TRACK_CREATURE_LABELS (render-gathering.js).
const TRACK_CREATURES = ["EAGLE", "ELEMENTAL", "IMP", "PANTHER", "WEREWOLF"];

// The 5 Shapeshifter artifact factions — a tracked creature drops one; we price the
// best-paying faction at the row's tier (like fishing prices the best biome rare).
const TRACK_ARTIFACT_FACTIONS = ["AVALON", "CRYSTAL", "HELL", "KEEPER", "MORGANA"];

// Real in-game weights (items.xml): Rare Animal Remains are a flat, very light
// 0.05 kg (so they haul superbly); a Shapeshifter artifact is a chunky 2 kg.
const REMAINS_WEIGHT_KG = 0.05;
const TRACK_ARTIFACT_WEIGHT_KG = 2.0;

// Shapeshifter artifacts start at T4, so a T3 hunt's artifact is the T4 (Journeyman /
// Prowling) one; T5/T7 map to their own tier. Maps a remains tier → artifact tier.
function trackArtifactTier(tier) { return tier === 3 ? 4 : tier; }

// Estimated KILLS per hour — tracking is slow (reveal trail, multi-step hunt, fight,
// travel), so far fewer "units" than swinging a pickaxe, and it falls with tier
// (tougher targets, danger-gated zones). ESTIMATE, tunable like GATHER_UNITS_PER_HOUR.
const TRACK_KILLS_PER_HOUR = { 3: 14, 5: 10, 7: 7 };

// Expected Rare Animal Remains dropped per kill (the staple). Tunable; flat by tier.
const TRACK_REMAINS_PER_KILL = 3;

// Chance a kill also drops a Shapeshifter Artifact — "a chance of Artifacts unique
// to the creature" (Wiki). Fishing's FISH_RARE_SHARE analogue; tunable, low.
const TRACK_ARTIFACT_SHARE = 0.15;

// Rare-Quarry Black Market loot — a SHARE of hunts are rare quarries that drop BM
// loot (and very rarely a T8 mount upgrade). No clean per-unit price → a rough
// TUNABLE estimate: expected gross BM silver per rare-quarry kill × that share is
// folded into Silver/Hour only. Set TRACK_BM_LOOT_GROSS = 0 to exclude BM loot.
const TRACK_RARE_QUARRY_SHARE = 0.06;
const TRACK_BM_LOOT_GROSS = 120000;

// Every gathered land family has enchanted (.1+) versions you can pull from T4+
// nodes — including STONE: enchanted RAW rock exists and trades on the market
// (T*_ROCK_LEVELn@n, verified live + items.xml). Stone is special only in that it
// caps at .3 (exceptional) — there is NO .4 (pristine) rock in-game (no
// T*_ROCK_LEVEL4 in items.xml). The refined stoneblock has no enchant at all.
// See [[project_stone_no_enchant]].
const ENCHANTABLE_TYPES = new Set(["ore", "wood", "hide", "fiber", "rock"]);

// Enchanted resources spawn only from T4 up; .1–.4 (uncommon→pristine), EXCEPT
// stone which tops out at .3 (no pristine rock exists).
const MIN_ENCHANT_TIER = 4;
const MAX_ENCHANT_LEVEL = 4;
const ROCK_MAX_ENCHANT_LEVEL = 3;

// Top enchant level a family's RAW resource reaches (stone caps at .3).
function maxEnchantLevelFor(type) {
  return type === "rock" ? ROCK_MAX_ENCHANT_LEVEL : MAX_ENCHANT_LEVEL;
}

// Zone enchantment rate — the chance a freshly-gathered unit is .1 (uncommon).
// Community/Wiki data ("Enchantment rate modifier"): higher enchants fall off
// ~10x each, so a rate R gives ≈ R for .1, R/10 for .2, R/100 for .3, R/1000 for
// .4. Real rates: Royal zones 8–33%, Outlands 11–22% (+ up to 20% from territory
// towers). Serious gathering happens mostly in the BLACK ZONES (Outlands) —
// denser nodes, more enchanted drops, and the ocean access that saltwater
// fishing needs — so the default reflects a black-zone rate. Drop it toward
// ROYAL_ENCHANT_RATE if you gather royal-only. TUNABLE, like GATHER_UNITS_PER_HOUR.
// Fish are unaffected (no enchant ids → their blend collapses to flat); stone
// blends only .1–.3 (its .4 share, valued at the flat price for lack of a .4 id,
// is a ~0.02% sliver).
const ROYAL_ENCHANT_RATE = 0.10; // royal / yellow zones (lower spawn rate)
const BLACK_ZONE_ENCHANT_RATE = 0.20; // black / red Outlands (higher spawn rate)
const ZONE_ENCHANT_RATE = BLACK_ZONE_ENCHANT_RATE;

// Expected share of gathered units at each enchant level for a given tier. Empty
// (all-zero) below T4 where nothing enchants. The flat share is 1 − sum.
function getEnchantDist(tier, rate = ZONE_ENCHANT_RATE) {
  if (tier < MIN_ENCHANT_TIER || rate <= 0) return { 1: 0, 2: 0, 3: 0, 4: 0 };
  return { 1: rate, 2: rate / 10, 3: rate / 100, 4: rate / 1000 };
}

// Market ids of a row's enchanted variants, keyed by enchant level. Empty below
// T4 (no enchanted resources). Stone is included but caps at .3 (no pristine
// rock). Format mirrors the Flipping / Refining tables: _LEVELn@n —
// see [[reference_aodp_refined_enchant_id_format]].
function getEnchantIds(type, tier, raw) {
  if (!ENCHANTABLE_TYPES.has(type) || tier < MIN_ENCHANT_TIER) return {};
  const ids = {};
  const top = maxEnchantLevelFor(type);
  for (let k = 1; k <= top; k++) ids[k] = `T${tier}_${raw}_LEVEL${k}@${k}`;
  return ids;
}

// One descriptor per comparable gathering row. Each carries the market ids it
// needs priced (`marketIds`) and a `kind` the renderer branches on:
//   • "land"    — a single resource + its enchant variants (calcGatheringEconomics)
//   • "fishing" — a merged tier row: two common ids + the biome rare ids; the
//                 renderer picks the best water and blends via calcFishingEconomics
//   • "seaweed" — the lone T1 byproduct (single id, calcGatheringEconomics)
function getGatheringResources() {
  const rows = [];

  // Land — one row per family × tier, enchant variants folded into silver/hour.
  GATHERING_RESOURCE_DEFS.forEach(({ type, raw }) => {
    GATHERING_TIERS.forEach((tier) => {
      const rawId = `T${tier}_${raw}`;
      const enchantIds = getEnchantIds(type, tier, raw);
      rows.push({
        type, kind: "land", tier, rawId,
        profession: GATHERING_PROFESSIONS[type],
        unitsPerHour: GATHER_UNITS_PER_HOUR[tier] || 0,
        weightKg: null, // null → calcGatheringEconomics uses the 0.1×1.5^tier formula
        enchantable: ENCHANTABLE_TYPES.has(type),
        enchantIds,
        marketIds: [rawId, ...Object.values(enchantIds)],
      });
    });
  });

  // Fishing — one merged row per tier. Base = the better-priced common (fresh vs
  // salt); the rare bonus (best-priced rare of that water) is share-blended into
  // silver/hour. Rares only exist at the mapped rare band.
  GATHERING_TIERS.forEach((tier) => {
    const rareTier = fishingRareTier(tier);
    const freshCommonId = `T${tier}_FISH_FRESHWATER_ALL_COMMON`;
    const saltCommonId = `T${tier}_FISH_SALTWATER_ALL_COMMON`;
    const freshRareIds = rareTier ? FISH_RARE_BIOMES.map((b) => `T${rareTier}_FISH_FRESHWATER_${b}_RARE`) : [];
    const saltRareId = rareTier ? `T${rareTier}_FISH_SALTWATER_ALL_RARE` : null;
    rows.push({
      type: "fish", kind: "fishing", tier,
      profession: GATHERING_PROFESSIONS.fish,
      freshCommonId, saltCommonId, freshRareIds, saltRareId, rareTier,
      commonWeightKg: FISH_WEIGHT_KG[tier] || 0,
      rareWeightKg: rareTier ? (FISH_RARE_WEIGHT_KG[rareTier] || 0) : 0,
      rareShare: rareTier ? FISH_RARE_SHARE : 0,
      unitsPerHour: FISH_UNITS_PER_HOUR[tier] || 0,
      enchantable: false, enchantIds: {},
      marketIds: [freshCommonId, saltCommonId, ...freshRareIds, ...(saltRareId ? [saltRareId] : [])],
    });
  });

  // Ancient Lands fishing — one row per leyfin tier. Same `kind` as fishing so
  // the renderer's row builder and calcFishingEconomics are reused unchanged;
  // `ancient` flips the badge, the name and the tooltip.
  ANCIENT_FISH_TIERS.forEach((tier) => {
    const leyfinId = `T${tier}_FISH_FRESHWATER_DRAGON_AREA_RARE`;
    rows.push({
      type: "fish", kind: "fishing", ancient: true, tier,
      profession: GATHERING_PROFESSIONS.fishAncient,
      rowName: `T${tier} leyfin`,
      freshCommonId: leyfinId, saltCommonId: null,
      freshRareIds: [], saltRareId: null, rareTier: tier,
      commonWeightKg: FISH_RARE_WEIGHT_KG[tier] || 0,
      rareWeightKg: 0,
      rareShare: 0,
      unitsPerHour: ANCIENT_FISH_UNITS_PER_HOUR[tier] || 0,
      enchantable: false, enchantIds: {},
      marketIds: [leyfinId],
    });
  });

  // Tracking — one merged row per remains tier (T3/T5/T7). Staple = the best-paying
  // creature's Rare Animal Remains; the Shapeshifter artifact (best faction) is the
  // share-blended bonus, and rare-quarry Black Market loot folds into Silver/Hour.
  TRACK_TIERS.forEach((tier) => {
    const at = trackArtifactTier(tier);
    const remainsIds = TRACK_CREATURES.map((c) => `T${tier}_ALCHEMY_RARE_${c}`);
    const artifactIds = TRACK_ARTIFACT_FACTIONS.map((f) => `T${at}_ARTEFACT_2H_SHAPESHIFTER_${f}`);
    const killsPerHour = TRACK_KILLS_PER_HOUR[tier] || 0;
    rows.push({
      type: "tracking", kind: "tracking", tier,
      profession: GATHERING_PROFESSIONS.tracking,
      remainsIds, artifactIds, artifactTier: at,
      remainsWeightKg: REMAINS_WEIGHT_KG,
      artifactWeightKg: TRACK_ARTIFACT_WEIGHT_KG,
      remainsPerKill: TRACK_REMAINS_PER_KILL,
      artifactShare: TRACK_ARTIFACT_SHARE,
      killsPerHour,
      rareQuarryShare: TRACK_RARE_QUARRY_SHARE,
      bmLootGross: TRACK_BM_LOOT_GROSS,
      // remains/hour = kills/hour × remains/kill — the "units" matching Net/Unit.
      unitsPerHour: killsPerHour * TRACK_REMAINS_PER_KILL,
      enchantable: false, enchantIds: {},
      marketIds: [...remainsIds, ...artifactIds],
    });
  });

  // Seaweed — the single T1 byproduct row (priced like a plain resource).
  rows.push({
    type: "fish", kind: "seaweed", tier: 1, rawId: "T1_SEAWEED",
    profession: GATHERING_PROFESSIONS.fish,
    unitsPerHour: SEAWEED_UNITS_PER_HOUR, weightKg: SEAWEED_WEIGHT_KG,
    enchantable: false, enchantIds: {}, marketIds: ["T1_SEAWEED"],
  });

  return rows;
}

// Market ids to fetch for the Gathering table — every row's marketIds, deduped
// (adjacent fishing tiers share a rare band, e.g. T7 & T8 both pull T7 rares).
function getGatheringItemIds() {
  const ids = [];
  getGatheringResources().forEach((r) => (r.marketIds || []).forEach((id) => ids.push(id)));
  return [...new Set(ids)];
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    GATHERING_PROFESSIONS,
    GATHERING_RESOURCE_DEFS,
    GATHERING_TIERS,
    GATHER_UNITS_PER_HOUR,
    FISH_UNITS_PER_HOUR,
    FISH_RARE_SHARE,
    ANCIENT_FISH_TIERS,
    ANCIENT_FISH_UNITS_PER_HOUR,
    SEAWEED_UNITS_PER_HOUR,
    FISH_RARE_BIOMES,
    FISH_WEIGHT_KG,
    FISH_RARE_WEIGHT_KG,
    SEAWEED_WEIGHT_KG,
    fishingRareTier,
    TRACK_TIERS,
    TRACK_CREATURES,
    TRACK_ARTIFACT_FACTIONS,
    REMAINS_WEIGHT_KG,
    TRACK_ARTIFACT_WEIGHT_KG,
    trackArtifactTier,
    TRACK_KILLS_PER_HOUR,
    TRACK_REMAINS_PER_KILL,
    TRACK_ARTIFACT_SHARE,
    TRACK_RARE_QUARRY_SHARE,
    TRACK_BM_LOOT_GROSS,
    ENCHANTABLE_TYPES,
    ROYAL_ENCHANT_RATE,
    BLACK_ZONE_ENCHANT_RATE,
    ZONE_ENCHANT_RATE,
    getEnchantDist,
    getEnchantIds,
    getGatheringResources,
    getGatheringItemIds,
  };
}
