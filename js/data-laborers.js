/**
 * Laborer reference data: types, modes, per-cycle yields, and contract IDs.
 *
 * Albion has 11 laborer types in 3 broad categories — gatherers, crafters,
 * mercenary. Each laborer can run one of several journal modes:
 *
 *   Trophy     — trophy journal in, trophy + empty journal out
 *   Resource   — gathering journal in, raw resources (enchant-distributed) + empty out
 *   Crafting   — crafting journal in, refined-resource mix + empty out
 *   Mercenary  — mercenary journal in, flat silver + empty out
 *
 * Numeric facts (baseloot, mercenary silver, enchant distribution, weights)
 * are extracted directly from items.xml. Crafting refined-resource mixes
 * come from the community wiki — items.xml stores the mix indirectly via
 * loot tables that we don't model line-by-line.
 *
 * Slug mismatches (be careful!):
 *   - Stonecutter:  journal STONE,  resource ROCK,  trophy ROCK,    contract STONE
 *   - Fisherman:    journal FISHING, resource FISH, trophy FISH,    contract FISHERMAN
 *   - Mercenary:    journal MERCENARY across the board
 *
 * Fisherman Resource mode is special-cased: its journal yields a MIX of fish
 * (freshwater/saltwater commons spanning the journal tier and the two below it,
 * plus biome rares and a little T1 seaweed). Rather than explode the API batch
 * across 18+ species, we collapse it to the best-priced common catch of the row
 * tier plus a rare-share blend — the same shape the Gathering "Fishing" row
 * uses. See FISH_LABORER_BASELOOT / _fishResourceRevenue. Fisherman also still
 * appears in Trophy mode (TROPHY_FISHING).
 */

// Mode constants — used by render-laborers.js to dispatch payload calc.
const LABORER_MODE = {
  TROPHY:    "Trophy",
  RESOURCE:  "Resource",
  CRAFTING:  "Crafting",
  MERCENARY: "Mercenary",
};

const LABORER_TIERS = [2, 3, 4, 5, 6, 7, 8];

// ─── Happiness → yield ────────────────────────────────────────────────────
//
// Wiki (Laborer, "Happiness and Yield"):
//
//   yield = min(150%, baseYield + 0.5% × (happiness − 100 × laborerTier))
//   baseYield = 100% for a journal at the laborer's OWN tier
//               150% for any journal at least one tier BELOW it
//
// A laborer's base happiness is 100 × its tier, met by one bed and one table of
// its tier or higher. Everything above that comes from trophies — 5 happiness
// per general trophy, 10 for one matching the laborer's own type — and each
// point is worth +0.5% yield up to a +50% ceiling.
//
// The app therefore models the BONUS (points above base), not the absolute
// number: trophies pay a fixed amount whatever the laborer's tier, and the base
// cancels out of the formula, so one bonus figure describes a house's whole
// trophy setup across every tier of laborer in it. getLaborerHappiness(tier) in
// js/laborer-happiness.js converts it back to the number shown in game.
//
// At >100% the in-game bonus is probabilistic, but EV equals the yield
// fraction, so it is treated as a deterministic multiplier.
const LABORER_YIELD_CAP = 1.5;
const LABORER_YIELD_PER_HAPPINESS = 0.005;

// Trophy happiness, straight from items.xml `<furnitureitem labourerhappiness>`:
//
//   general trophies  labourersaffected="all"  →  5 happiness, EVERY laborer
//   matching trophies labourersaffected="wood" → 10 happiness, that type only
//
// A bed and a table are 50 × tier each, so a laborer with both at its own tier
// sits exactly on its 100 × tier base and trophies are the whole bonus. T8 is
// the top of the furniture ladder, so a T8 laborer's bonus is trophies alone.
//
// THE CEILING IS NOT THE SAME FOR EVERY LABORER. items.xml has trophies for
// wood / stone / ore / fiber / hide / fishing / mercenary and nothing else —
// there is NO trophy targeting a crafting laborer, so a Blacksmith, Fletcher,
// Imbuer or Tinker can only ever collect the general 5s. Their own-tier yield
// therefore CANNOT pass 120%, however decorated the house is; only the
// gatherers and the mercenary can reach the 150% cap on an own-tier journal.
const GENERAL_TROPHY_HAPPINESS_MAX = 40;   // 8 distinct general trophies × 5
const MATCHING_TROPHY_HAPPINESS_MAX = 70;  // T2-T8 of the laborer's own type × 10

// Which `labourersaffected` value each laborer answers to; null = no trophy in
// the game targets it. Keyed by LABORERS slug (and the trophy lines resolve to
// their laborer first, so a Lumberjack on a trophy journal still reads "wood").
const LABORER_TROPHY_AFFECT = {
  WOOD: "wood", STONE: "stone", ORE: "ore", FIBER: "fiber", HIDE: "hide",
  FISHING: "fishing", MERCENARY: "mercenary",
  WARRIOR: null, HUNTER: null, MAGE: null, TOOLMAKER: null,
};

// Callers hand this either a LABORERS slug (ORE) or the journal line's slug
// (TROPHY_ORE) — the trophy journals carry a `TROPHY_` prefix on the same
// profession. They answer to the same trophies, so fold the prefix away rather
// than silently reading "no matching trophy" and capping a Prospector at 120%.
// TROPHY_GENERAL folds to GENERAL, which is absent from the table on purpose:
// the general line has no profession, so it gets the general trophies only.
function _laborerTrophyKey(slug) {
  return String(slug || "").replace(/^TROPHY_/, "");
}

function laborerHasMatchingTrophy(laborerSlug) {
  return !!LABORER_TROPHY_AFFECT[_laborerTrophyKey(laborerSlug)];
}

// The most trophy happiness this laborer can physically be given. Furniture
// slots may bite first — a T8 house has furniturelimit 14, so 3 beds + a table
// leave only 10 trophy slots — but this is the game's own ceiling.
function getLaborerMaxHappinessBonus(laborerSlug) {
  return GENERAL_TROPHY_HAPPINESS_MAX +
    (laborerHasMatchingTrophy(laborerSlug) ? MATCHING_TROPHY_HAPPINESS_MAX : 0);
}

function getLaborerBaseHappiness(tier) {
  return 100 * Number(tier || 0);
}

// Bonus for a laborer whose type is NOT known. Deliberately the general-trophy
// share alone: it is the part every laborer gets, so a call site that forgets to
// name its laborer understates a gatherer rather than promising a crafting
// laborer a yield no trophy in the game can buy. Falls back to the max when the
// preference module (js/laborer-happiness.js) is not loaded — Node harnesses
// compile this file alone, and the app-wide convention is max spec.
function _laborerHappinessBonus() {
  if (typeof getLaborerHappinessGeneral === "function") return getLaborerHappinessGeneral();
  return GENERAL_TROPHY_HAPPINESS_MAX;
}

// Bonus for a NAMED laborer: the general trophies plus, if any trophy targets
// its type, the matching ones.
function getLaborerHappinessBonusFor(laborerSlug) {
  const general = _laborerHappinessBonus();
  if (!laborerHasMatchingTrophy(laborerSlug)) return general;
  const matching = (typeof getLaborerHappinessMatching === "function")
    ? getLaborerHappinessMatching()
    : MATCHING_TROPHY_HAPPINESS_MAX;
  return general + matching;
}

// Yield of a laborer running a journal at its OWN tier. `tier` is part of the
// question but not the arithmetic: base happiness and the 100×tier threshold
// cancel, so only the trophy bonus moves the number. Pass `bonusHappiness` to
// override the stored preference. Lower-tier journals are the other branch —
// see getLaborerJournalYield in js/laborer-journal-value.js.
function getLaborerYield(tier, bonusHappiness) {
  const raw = bonusHappiness == null ? _laborerHappinessBonus() : Number(bonusHappiness);
  const bonus = Number.isFinite(raw) ? Math.max(0, raw) : 0;
  return Math.min(LABORER_YIELD_CAP, 1 + LABORER_YIELD_PER_HAPPINESS * bonus);
}

// Own-tier yield for a NAMED laborer — the form every row should use, since the
// trophy ceiling is type-dependent. A T8 Tinker tops out at 120% (general
// trophies only); a T8 Lumberjack reaches the 150% cap.
function getLaborerYieldFor(laborerSlug, tier) {
  return getLaborerYield(tier, getLaborerHappinessBonusFor(laborerSlug));
}

// Baseloot per cycle from items.xml (`<journalitem baselootamount="...">`).
// Gatherers all share the same schedule; crafters have a steeper decline.
const GATHERER_BASELOOT  = { 2: 38, 3: 60, 4: 48, 5: 32, 6: 32, 7: 38.4, 8: 38.4 };
const CRAFTING_BASELOOT  = { 2: 38, 3: 24, 4: 16, 5: 8,  6: 5.3333, 7: 4.4, 8: 4.2 };

// ─── Fishing resource model (Fisherman in Resource mode) ──────────────────
// The fishing journal has its OWN baseloot schedule (distinct from, and lower
// than, the land GATHERER_BASELOOT above). `baselootamount` is the number of
// loot ROLLS per cycle; each roll draws ONE line from the journal's lootlist by
// weight. Source: items.xml `T{n}_JOURNAL_FISHING` baselootamount.
const FISH_LABORER_BASELOOT = { 2: 10.6, 3: 9.976, 4: 13.9112, 5: 17.0301, 6: 20.0528, 7: 22.3876, 8: 25.119 };

// The fishing journal's fixed lootlist, verbatim from items.xml
// `T{n}_JOURNAL_FISHING <lootlist>`, as [marketId, itemAmount, weight]. A
// laborer running this journal returns a biome-INDEPENDENT mix: commons span
// the journal tier and the two-three tiers below (freshwater AND saltwater),
// biome rares are spread EQUALLY across all 6 freshwater biomes + saltwater at
// the T3/T5/T7 band (weight 10 each), plus near-worthless T1 seaweed. The
// expected catch value is therefore Σ (weight/Σweight × amount × price) over
// every line — NOT a single cherry-picked "best" rare. Valuing the catch at the
// most expensive biome rare (the old heuristic) overstated revenue ~2-4×, since
// in reality any one rare is just 1 of 21 equally-weighted rare lines. Static
// game data; re-extract from items.xml if the journal lootlists change.
const FISH_JOURNAL_LOOTLIST = {
  2: [
    ["T1_SEAWEED", 1, 10],
    ["T1_FISH_FRESHWATER_ALL_COMMON", 1, 24],
    ["T2_FISH_FRESHWATER_ALL_COMMON", 1, 24],
    ["T1_FISH_SALTWATER_ALL_COMMON", 1, 24],
    ["T2_FISH_SALTWATER_ALL_COMMON", 1, 24],
  ],
  3: [
    ["T1_SEAWEED", 1, 41],
    ["T1_FISH_FRESHWATER_ALL_COMMON", 1, 50],
    ["T2_FISH_FRESHWATER_ALL_COMMON", 1, 50],
    ["T3_FISH_FRESHWATER_ALL_COMMON", 1, 50],
    ["T1_FISH_SALTWATER_ALL_COMMON", 1, 50],
    ["T2_FISH_SALTWATER_ALL_COMMON", 1, 50],
    ["T3_FISH_SALTWATER_ALL_COMMON", 1, 50],
    ["T3_FISH_FRESHWATER_FOREST_RARE", 1, 10],
    ["T3_FISH_FRESHWATER_MOUNTAIN_RARE", 1, 10],
    ["T3_FISH_FRESHWATER_HIGHLANDS_RARE", 1, 10],
    ["T3_FISH_FRESHWATER_STEPPE_RARE", 1, 10],
    ["T3_FISH_FRESHWATER_SWAMP_RARE", 1, 10],
    ["T3_FISH_FRESHWATER_AVALON_RARE", 1, 10],
    ["T3_FISH_SALTWATER_ALL_RARE", 1, 10],
  ],
  4: [
    ["T1_SEAWEED", 2, 29],
    ["T2_FISH_FRESHWATER_ALL_COMMON", 1, 50],
    ["T3_FISH_FRESHWATER_ALL_COMMON", 1, 50],
    ["T4_FISH_FRESHWATER_ALL_COMMON", 1, 50],
    ["T2_FISH_SALTWATER_ALL_COMMON", 1, 50],
    ["T3_FISH_SALTWATER_ALL_COMMON", 1, 50],
    ["T4_FISH_SALTWATER_ALL_COMMON", 1, 50],
    ["T3_FISH_FRESHWATER_FOREST_RARE", 1, 10],
    ["T3_FISH_FRESHWATER_MOUNTAIN_RARE", 1, 10],
    ["T3_FISH_FRESHWATER_HIGHLANDS_RARE", 1, 10],
    ["T3_FISH_FRESHWATER_STEPPE_RARE", 1, 10],
    ["T3_FISH_FRESHWATER_SWAMP_RARE", 1, 10],
    ["T3_FISH_FRESHWATER_AVALON_RARE", 1, 10],
    ["T3_FISH_SALTWATER_ALL_RARE", 1, 10],
  ],
  5: [
    ["T1_SEAWEED", 4, 46],
    ["T3_FISH_FRESHWATER_ALL_COMMON", 1, 100],
    ["T4_FISH_FRESHWATER_ALL_COMMON", 1, 100],
    ["T5_FISH_FRESHWATER_ALL_COMMON", 1, 100],
    ["T3_FISH_SALTWATER_ALL_COMMON", 1, 100],
    ["T4_FISH_SALTWATER_ALL_COMMON", 1, 100],
    ["T5_FISH_SALTWATER_ALL_COMMON", 1, 100],
    ["T3_FISH_FRESHWATER_FOREST_RARE", 1, 10],
    ["T5_FISH_FRESHWATER_FOREST_RARE", 1, 10],
    ["T3_FISH_FRESHWATER_MOUNTAIN_RARE", 1, 10],
    ["T5_FISH_FRESHWATER_MOUNTAIN_RARE", 1, 10],
    ["T3_FISH_FRESHWATER_HIGHLANDS_RARE", 1, 10],
    ["T5_FISH_FRESHWATER_HIGHLANDS_RARE", 1, 10],
    ["T3_FISH_FRESHWATER_STEPPE_RARE", 1, 10],
    ["T5_FISH_FRESHWATER_STEPPE_RARE", 1, 10],
    ["T3_FISH_FRESHWATER_SWAMP_RARE", 1, 10],
    ["T5_FISH_FRESHWATER_SWAMP_RARE", 1, 10],
    ["T3_FISH_FRESHWATER_AVALON_RARE", 1, 10],
    ["T5_FISH_FRESHWATER_AVALON_RARE", 1, 10],
    ["T3_FISH_SALTWATER_ALL_RARE", 1, 10],
    ["T5_FISH_SALTWATER_ALL_RARE", 1, 10],
  ],
  6: [
    ["T1_SEAWEED", 6, 39],
    ["T4_FISH_FRESHWATER_ALL_COMMON", 1, 100],
    ["T5_FISH_FRESHWATER_ALL_COMMON", 1, 100],
    ["T6_FISH_FRESHWATER_ALL_COMMON", 1, 100],
    ["T4_FISH_SALTWATER_ALL_COMMON", 1, 100],
    ["T5_FISH_SALTWATER_ALL_COMMON", 1, 100],
    ["T6_FISH_SALTWATER_ALL_COMMON", 1, 100],
    ["T3_FISH_FRESHWATER_FOREST_RARE", 1, 10],
    ["T5_FISH_FRESHWATER_FOREST_RARE", 1, 10],
    ["T3_FISH_FRESHWATER_MOUNTAIN_RARE", 1, 10],
    ["T5_FISH_FRESHWATER_MOUNTAIN_RARE", 1, 10],
    ["T3_FISH_FRESHWATER_HIGHLANDS_RARE", 1, 10],
    ["T5_FISH_FRESHWATER_HIGHLANDS_RARE", 1, 10],
    ["T3_FISH_FRESHWATER_STEPPE_RARE", 1, 10],
    ["T5_FISH_FRESHWATER_STEPPE_RARE", 1, 10],
    ["T3_FISH_FRESHWATER_SWAMP_RARE", 1, 10],
    ["T5_FISH_FRESHWATER_SWAMP_RARE", 1, 10],
    ["T3_FISH_FRESHWATER_AVALON_RARE", 1, 10],
    ["T5_FISH_FRESHWATER_AVALON_RARE", 1, 10],
    ["T3_FISH_SALTWATER_ALL_RARE", 1, 10],
    ["T5_FISH_SALTWATER_ALL_RARE", 1, 10],
  ],
  7: [
    ["T1_SEAWEED", 9, 52],
    ["T5_FISH_FRESHWATER_ALL_COMMON", 1, 150],
    ["T6_FISH_FRESHWATER_ALL_COMMON", 1, 150],
    ["T7_FISH_FRESHWATER_ALL_COMMON", 1, 150],
    ["T5_FISH_SALTWATER_ALL_COMMON", 1, 150],
    ["T6_FISH_SALTWATER_ALL_COMMON", 1, 150],
    ["T7_FISH_SALTWATER_ALL_COMMON", 1, 150],
    ["T3_FISH_FRESHWATER_FOREST_RARE", 1, 10],
    ["T5_FISH_FRESHWATER_FOREST_RARE", 1, 10],
    ["T7_FISH_FRESHWATER_FOREST_RARE", 1, 10],
    ["T3_FISH_FRESHWATER_MOUNTAIN_RARE", 1, 10],
    ["T5_FISH_FRESHWATER_MOUNTAIN_RARE", 1, 10],
    ["T7_FISH_FRESHWATER_MOUNTAIN_RARE", 1, 10],
    ["T3_FISH_FRESHWATER_HIGHLANDS_RARE", 1, 10],
    ["T5_FISH_FRESHWATER_HIGHLANDS_RARE", 1, 10],
    ["T7_FISH_FRESHWATER_HIGHLANDS_RARE", 1, 10],
    ["T3_FISH_FRESHWATER_STEPPE_RARE", 1, 10],
    ["T5_FISH_FRESHWATER_STEPPE_RARE", 1, 10],
    ["T7_FISH_FRESHWATER_STEPPE_RARE", 1, 10],
    ["T3_FISH_FRESHWATER_SWAMP_RARE", 1, 10],
    ["T5_FISH_FRESHWATER_SWAMP_RARE", 1, 10],
    ["T7_FISH_FRESHWATER_SWAMP_RARE", 1, 10],
    ["T3_FISH_FRESHWATER_AVALON_RARE", 1, 10],
    ["T5_FISH_FRESHWATER_AVALON_RARE", 1, 10],
    ["T7_FISH_FRESHWATER_AVALON_RARE", 1, 10],
    ["T3_FISH_SALTWATER_ALL_RARE", 1, 10],
    ["T5_FISH_SALTWATER_ALL_RARE", 1, 10],
    ["T7_FISH_SALTWATER_ALL_RARE", 1, 10],
  ],
  8: [
    ["T1_SEAWEED", 14, 46],
    ["T6_FISH_FRESHWATER_ALL_COMMON", 1, 150],
    ["T7_FISH_FRESHWATER_ALL_COMMON", 1, 150],
    ["T8_FISH_FRESHWATER_ALL_COMMON", 1, 150],
    ["T6_FISH_SALTWATER_ALL_COMMON", 1, 150],
    ["T7_FISH_SALTWATER_ALL_COMMON", 1, 150],
    ["T8_FISH_SALTWATER_ALL_COMMON", 1, 150],
    ["T3_FISH_FRESHWATER_FOREST_RARE", 1, 10],
    ["T5_FISH_FRESHWATER_FOREST_RARE", 1, 10],
    ["T7_FISH_FRESHWATER_FOREST_RARE", 1, 10],
    ["T3_FISH_FRESHWATER_MOUNTAIN_RARE", 1, 10],
    ["T5_FISH_FRESHWATER_MOUNTAIN_RARE", 1, 10],
    ["T7_FISH_FRESHWATER_MOUNTAIN_RARE", 1, 10],
    ["T3_FISH_FRESHWATER_HIGHLANDS_RARE", 1, 10],
    ["T5_FISH_FRESHWATER_HIGHLANDS_RARE", 1, 10],
    ["T7_FISH_FRESHWATER_HIGHLANDS_RARE", 1, 10],
    ["T3_FISH_FRESHWATER_STEPPE_RARE", 1, 10],
    ["T5_FISH_FRESHWATER_STEPPE_RARE", 1, 10],
    ["T7_FISH_FRESHWATER_STEPPE_RARE", 1, 10],
    ["T3_FISH_FRESHWATER_SWAMP_RARE", 1, 10],
    ["T5_FISH_FRESHWATER_SWAMP_RARE", 1, 10],
    ["T7_FISH_FRESHWATER_SWAMP_RARE", 1, 10],
    ["T3_FISH_FRESHWATER_AVALON_RARE", 1, 10],
    ["T5_FISH_FRESHWATER_AVALON_RARE", 1, 10],
    ["T7_FISH_FRESHWATER_AVALON_RARE", 1, 10],
    ["T3_FISH_SALTWATER_ALL_RARE", 1, 10],
    ["T5_FISH_SALTWATER_ALL_RARE", 1, 10],
    ["T7_FISH_SALTWATER_ALL_RARE", 1, 10],
  ],
};

// Distinct market ids a Fisherman resource cycle can produce at `tier` — every
// item in the journal's lootlist (commons, biome rares, seaweed). Used by the
// scan (to fetch prices) and by the revenue EV. De-duplicated.
function getFishResourceIds(tier) {
  const lootlist = FISH_JOURNAL_LOOTLIST[tier];
  if (!lootlist) return [];
  return [...new Set(lootlist.map((line) => line[0]))];
}

// Mercenary silver per cycle by tier — from <loot silveramount="..."> in items.xml
// (matches community testing values exactly).
const MERCENARY_SILVER_BY_TIER = { 2: 371, 3: 660, 4: 1123, 5: 1746, 6: 2690, 7: 4202, 8: 6584 };

// ─── Laborer leveling (for the Best Leveling Path column) ─────────────────
//
// Hiring a laborer from a Guild Hall always yields a free-ish T2 apprentice for
// a flat fee; higher tiers are reached by running journals until enough fame
// accrues, or bought pre-leveled on the market.
const HIRE_COST = 1000;

// Fame awarded per journal at 100% yield, by journal type and journal tier.
// Source: wiki.albiononline.com/wiki/Laborer (decoded from the merged-cell
// "Fame awarded per journal" table). Fame scales with yield, and leveling runs
// same-tier journals, so callers scale by getLaborerYield(tier) — 100% at bare
// minimum happiness up to the 150% cap, set by the house's trophies.
// At T2-T5 the wiki merges Gathering/Trophy-General/Crafting into one value;
// they diverge only at T6+. Crafting differs from gathering by <2%.
const LABORER_FAME_PER_JOURNAL = {
  GATHERING:        { 2: 76,  3: 120, 4: 240, 5: 480, 6: 960,  7: 1920, 8: 3840 },
  TROPHY_GENERAL:   { 2: 76,  3: 120, 4: 240, 5: 480, 6: 960,  7: 1920, 8: 3840 },
  CRAFTING:         { 2: 76,  3: 120, 4: 240, 5: 480, 6: 965,  7: 1896, 8: 3910 },
  FISHERMAN:        { 2: 159, 3: 299, 4: 472, 5: 783, 6: 1022, 7: 1388, 8: 1733 },
  FISHERMAN_TROPHY: { 2: 144, 3: 269, 4: 439, 5: 737, 6: 972,  7: 1326, 8: 1664 },
  MERCENARY:        { 2: 283, 3: 435, 4: 653, 5: 874, 6: 1172, 7: 1594, 8: 2160 },
};

// Total fame needed to upgrade a laborer FROM tier T to T+1, by category.
// Source: wiki "Fame required to upgrade by tier" table (T2..T7; T8 is max).
const LABORER_FAME_TO_UPGRADE = {
  GATHER_CRAFT: { 2: 75,  3: 360,  4: 1200, 5: 4320, 6: 12480, 7: 36480 },
  FISHERMAN:    { 2: 76,  3: 393,  4: 1255, 5: 4374, 6: 12519, 7: 36537 },
  MERCENARY:    { 2: 282, 3: 1302, 4: 3265, 5: 7866, 6: 15223, 7: 30286 },
};

// A fame type stands for a family of laborers, and the own-tier yield it levels
// at depends on whether any trophy targets that family. Only CRAFTING has none,
// so its laborers level slower than everything else at the same happiness. The
// TROPHY_* fame types are the trophy-journal lines of gatherers and the
// mercenary, all of which do have their own trophy.
const LABORER_FAME_TYPE_SLUG = {
  GATHERING: "WOOD", TROPHY_GENERAL: "WOOD", CRAFTING: "WARRIOR",
  FISHERMAN: "FISHING", FISHERMAN_TROPHY: "FISHING", MERCENARY: "MERCENARY",
};

// Number of tier-T journals (= tier-T work cycles) needed to upgrade T→T+1.
// `fameType` keys LABORER_FAME_PER_JOURNAL; `upgradeCat` keys
// LABORER_FAME_TO_UPGRADE. Returns 0 when tier/keys are out of range (T8 has no
// upgrade). Fame scales with yield, so we divide by famePerJournal × yield.
// Defaults to the same-tier yield of `fameType`'s family (leveling runs same-
// tier journals) — pass `yield_` to model a house with different trophies.
function getLaborerUpgradeJournals(fameType, upgradeCat, tier, yield_) {
  const needed = (LABORER_FAME_TO_UPGRADE[upgradeCat] || {})[tier];
  const perJournal = (LABORER_FAME_PER_JOURNAL[fameType] || {})[tier];
  if (!needed || !perJournal) return 0;
  const y = yield_ == null
    ? getLaborerYieldFor(LABORER_FAME_TYPE_SLUG[fameType], tier)
    : yield_;
  return Math.ceil(needed / (perJournal * y));
}

// Enchant distribution for Resource mode — items.xml lootlist weights are
// 1889/100/10/1 (total 2000) for base / @1 / @2 / @3 across all gatherers.
const ENCHANT_DISTRIBUTION = [
  { level: 0, prob: 1889 / 2000 }, // 94.45%
  { level: 1, prob:  100 / 2000 }, // 5.00%
  { level: 2, prob:   10 / 2000 }, // 0.50%
  { level: 3, prob:    1 / 2000 }, // 0.05%
];

// Below T4 enchanting does not exist: the journal lootlist is 100% base (no
// _LEVELn lines), so the enchant ids never trade and applying the .1-.3 split
// would silently drop ~5.55% of the output to priceless ids.
const ENCHANT_DISTRIBUTION_BASE_ONLY = [{ level: 0, prob: 1 }];

// Enchant split a gather/craft laborer's output follows — the items.xml lootlist
// distribution (1889/100/10/1) at T4+, base-only below. Same for every family,
// INCLUDING stone: enchanted raw rock is real and trades (T?_ROCK_LEVELn@n). The
// distribution only runs to .3, which also matches stone's real cap (no pristine
// rock exists), so stone needs no special-casing. See [[project_stone_no_enchant]].
// `tier` defaults to an enchantable tier so slug-only callers get the full split.
function getLaborerEnchantDistribution(_resourceSlug, tier = 8) {
  return tier < 4 ? ENCHANT_DISTRIBUTION_BASE_ONLY : ENCHANT_DISTRIBUTION;
}

// Trophy lines (8) — each maps to the laborer that runs it. GENERAL can be
// run by any laborer. Trophy slug mismatches: STONE journal → ROCK trophy,
// FISHING journal → FISH trophy.
const TROPHY_LABORERS = [
  { journalSlug: "TROPHY_GENERAL",   trophySlug: "GENERAL",   name: "General Trophy",   runByLaborerSlug: null /* any */ },
  { journalSlug: "TROPHY_MERCENARY", trophySlug: "MERCENARY", name: "Mercenary Trophy", runByLaborerSlug: "MERCENARY" },
  { journalSlug: "TROPHY_HIDE",      trophySlug: "HIDE",      name: "Hide Trophy",      runByLaborerSlug: "HIDE" },
  { journalSlug: "TROPHY_WOOD",      trophySlug: "WOOD",      name: "Wood Trophy",      runByLaborerSlug: "WOOD" },
  { journalSlug: "TROPHY_ORE",       trophySlug: "ORE",       name: "Ore Trophy",       runByLaborerSlug: "ORE" },
  { journalSlug: "TROPHY_FIBER",     trophySlug: "FIBER",     name: "Fiber Trophy",     runByLaborerSlug: "FIBER" },
  { journalSlug: "TROPHY_STONE",     trophySlug: "ROCK",      name: "Rock Trophy",      runByLaborerSlug: "STONE" },
  { journalSlug: "TROPHY_FISHING",   trophySlug: "FISH",      name: "Fish Trophy",      runByLaborerSlug: "FISHING" },
];

// 11 laborer types with their mode availability + contract slug + crafting mix.
// `resourceSlug` is the raw-resource base ID slug (T?_<slug>) that the
// resource journal yields. `contractSlug` is the suffix used by the
// `T?_LABOURER_CONTRACT_<slug>` market id.
const LABORERS = [
  // Gatherers
  { slug: "WOOD",      name: "Lumberjack",  category: "gather", contractSlug: "WOOD",      resourceSlug: "WOOD",  modes: [LABORER_MODE.RESOURCE] },
  { slug: "STONE",     name: "Stonecutter", category: "gather", contractSlug: "STONE",     resourceSlug: "ROCK",  modes: [LABORER_MODE.RESOURCE] },
  { slug: "ORE",       name: "Prospector",  category: "gather", contractSlug: "ORE",       resourceSlug: "ORE",   modes: [LABORER_MODE.RESOURCE] },
  { slug: "FIBER",     name: "Cropper",     category: "gather", contractSlug: "FIBER",     resourceSlug: "FIBER", modes: [LABORER_MODE.RESOURCE] },
  { slug: "HIDE",      name: "Gamekeeper",  category: "gather", contractSlug: "HIDE",      resourceSlug: "HIDE",  modes: [LABORER_MODE.RESOURCE] },
  { slug: "FISHING",   name: "Fisherman",   category: "gather", contractSlug: "FISHERMAN", resourceSlug: null,    modes: [LABORER_MODE.RESOURCE] /* fish mix — special-cased, see file header */ },
  // Crafters — each splits refined-resource output by type per the wiki.
  { slug: "WARRIOR",   name: "Blacksmith",  category: "craft",  contractSlug: "WARRIOR",   resourceSlug: null, modes: [LABORER_MODE.CRAFTING],
    craftingMix: { METALBAR: 0.70, PLANKS:   0.20, CLOTH:    0.10 } },
  { slug: "HUNTER",    name: "Fletcher",    category: "craft",  contractSlug: "HUNTER",    resourceSlug: null, modes: [LABORER_MODE.CRAFTING],
    craftingMix: { LEATHER:  0.4545, METALBAR: 0.2727, PLANKS:   0.2728 } },
  { slug: "MAGE",      name: "Imbuer",      category: "craft",  contractSlug: "MAGE",      resourceSlug: null, modes: [LABORER_MODE.CRAFTING],
    craftingMix: { CLOTH:    0.50, PLANKS:   0.40, METALBAR: 0.10 } },
  { slug: "TOOLMAKER", name: "Tinker",      category: "craft",  contractSlug: "TOOLMAKER", resourceSlug: null, modes: [LABORER_MODE.CRAFTING],
    craftingMix: { PLANKS:   0.4444, METALBAR: 0.2222, CLOTH:    0.2222, LEATHER:  0.1112 } },
  // Mercenary
  { slug: "MERCENARY", name: "Mercenary",   category: "battle", contractSlug: "MERCENARY", resourceSlug: null, modes: [LABORER_MODE.MERCENARY] },
];

// ─── ID helpers ──────────────────────────────────────────────────────────
function getLaborerFilledJournalId(journalSlug, tier) { return `T${tier}_JOURNAL_${journalSlug}_FULL`; }
function getLaborerEmptyJournalId(journalSlug, tier)  { return `T${tier}_JOURNAL_${journalSlug}_EMPTY`; }
function getLaborerTrophyId(trophySlug, tier)         { return `T${tier}_FURNITUREITEM_TROPHY_${trophySlug}`; }
function getLaborerContractId(contractSlug, tier)     { return `T${tier}_LABOURER_CONTRACT_${contractSlug}`; }

// Enchanted resource ID for ADP — base T6_WOOD, @1 T6_WOOD_LEVEL1@1, etc.
function getEnchantedResourceId(resourceSlug, tier, level) {
  return level === 0
    ? `T${tier}_${resourceSlug}`
    : `T${tier}_${resourceSlug}_LEVEL${level}@${level}`;
}

// Lookup laborer that runs a given trophy line.
function getLaborerForTrophyLine(trophyLine) {
  if (!trophyLine.runByLaborerSlug) {
    // GENERAL trophy — runs on any laborer. We pick the cheapest contract path
    // in the renderer; here we just return null so the caller can decide.
    return null;
  }
  return LABORERS.find((l) => l.slug === trophyLine.runByLaborerSlug) || null;
}

// All market IDs the scan needs. Roughly:
//   - 11 laborer × 7 tier × 2 journal states (FULL+EMPTY for resource/craft/merc journals)
//   - 8 trophy lines × 7 tier × 2 journal states (trophy journals)
//   - 8 trophy slugs × 7 tier (trophy furniture)
//   - 5 resource laborers × 7 tier × 4 enchant levels (raw resource output)
//   - 4 crafting laborers × refined mix (no enchant) × 7 tier
//   - 11 laborer × 7 tier (contracts)
function getLaborersItemIds() {
  const ids = new Set();

  // Resource + crafting + mercenary journals (one slug per laborer)
  LABORERS.forEach((lab) => {
    getLaborerJournalScanIds(lab.slug).forEach((id) => ids.add(id));
  });

  // Trophy journals + trophies
  TROPHY_LABORERS.forEach((line) => {
    LABORER_TIERS.forEach((tier) => {
      ids.add(getLaborerFilledJournalId(line.journalSlug, tier));
      ids.add(getLaborerEmptyJournalId(line.journalSlug, tier));
      ids.add(getLaborerTrophyId(line.trophySlug, tier));
    });
  });

  return Array.from(ids);
}

// Everything ONE laborer's journal rows need priced: its journals at every tier,
// what those journals pay out, and its contracts. Split out of getLaborersItemIds
// so the Building Costs table can price the best journal for the laborer the user
// picked without pulling the whole Laborers scan (11 laborers × 7 tiers × both
// journal states plus every payload) through the API.
function getLaborerJournalScanIds(slug) {
  const lab = LABORERS.find((l) => l.slug === slug);
  if (!lab) return [];
  const ids = new Set();
  {
    LABORER_TIERS.forEach((tier) => {
      ids.add(getLaborerFilledJournalId(lab.slug, tier));
      ids.add(getLaborerEmptyJournalId(lab.slug, tier));
      // Resource mode output (enchant-distributed raw at T4+; base-only below)
      if (lab.modes.includes(LABORER_MODE.RESOURCE) && lab.resourceSlug) {
        getLaborerEnchantDistribution(lab.resourceSlug, tier).forEach((e) => {
          ids.add(getEnchantedResourceId(lab.resourceSlug, tier, e.level));
        });
      }
      // Fishing resource mode yields a fish mix (no resourceSlug; own id set)
      if (lab.modes.includes(LABORER_MODE.RESOURCE) && lab.slug === "FISHING") {
        getFishResourceIds(tier).forEach((id) => ids.add(id));
      }
      // Crafting mode output (refined types per laborer mix, enchant-spread at T4+)
      if (lab.modes.includes(LABORER_MODE.CRAFTING) && lab.craftingMix) {
        Object.keys(lab.craftingMix).forEach((refinedSlug) => {
          getLaborerEnchantDistribution(refinedSlug, tier).forEach((e) => {
            ids.add(getEnchantedResourceId(refinedSlug, tier, e.level));
          });
        });
      }
    });
    // All tier contracts — the "Buy T8" column anchors on T8, but the Best
    // Leveling Path column needs buy/sell prices at every start/end tier to
    // compare paths (e.g. buy a T7 contract and only level T7→T8).
    LABORER_TIERS.forEach((tier) => {
      ids.add(getLaborerContractId(lab.contractSlug, tier));
    });
  }
  return Array.from(ids);
}

// What the Gathering and Journal Filling tables' Feed-a-Laborer column needs
// priced: the PAYLOAD of every journal a gathering fame can fill, and nothing
// else. No journals (those tables already scan them), no contracts, no crafting
// mixes, no mercenary — that column never offers a laborer you buy, only the
// loot one returns. Kept here beside getLaborerJournalScanIds so the payload id
// rules (enchant distribution at T4+, the fishing mix, the trophy ids) have one
// home; duplicating them in a renderer is how ids drift out of the catalogue.
function getJournalPayloadScanIds() {
  const ids = new Set();
  LABORERS.forEach((lab) => {
    if (!lab.modes.includes(LABORER_MODE.RESOURCE)) return;
    LABORER_TIERS.forEach((tier) => {
      if (lab.resourceSlug) {
        getLaborerEnchantDistribution(lab.resourceSlug, tier).forEach((e) => {
          ids.add(getEnchantedResourceId(lab.resourceSlug, tier, e.level));
        });
      }
      if (lab.slug === "FISHING") {
        getFishResourceIds(tier).forEach((id) => ids.add(id));
      }
    });
  });
  TROPHY_LABORERS.forEach((line) => {
    if (line.journalSlug === "TROPHY_MERCENARY") return;
    LABORER_TIERS.forEach((tier) => {
      ids.add(getLaborerTrophyId(line.trophySlug, tier));
    });
  });
  return Array.from(ids);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    LABORER_MODE,
    LABORER_TIERS,
    getLaborerYield,
    getLaborerYieldFor,
    getLaborerBaseHappiness,
    getLaborerHappinessBonusFor,
    getLaborerMaxHappinessBonus,
    laborerHasMatchingTrophy,
    LABORER_TROPHY_AFFECT,
    LABORER_YIELD_CAP,
    LABORER_YIELD_PER_HAPPINESS,
    GENERAL_TROPHY_HAPPINESS_MAX,
    MATCHING_TROPHY_HAPPINESS_MAX,
    GATHERER_BASELOOT,
    CRAFTING_BASELOOT,
    MERCENARY_SILVER_BY_TIER,
    FISH_LABORER_BASELOOT,
    FISH_JOURNAL_LOOTLIST,
    getFishResourceIds,
    HIRE_COST,
    LABORER_FAME_PER_JOURNAL,
    LABORER_FAME_TO_UPGRADE,
    getLaborerUpgradeJournals,
    ENCHANT_DISTRIBUTION,
    getLaborerEnchantDistribution,
    TROPHY_LABORERS,
    LABORERS,
    getLaborerFilledJournalId,
    getLaborerEmptyJournalId,
    getLaborerTrophyId,
    getLaborerContractId,
    getEnchantedResourceId,
    getLaborerForTrophyLine,
    getLaborersItemIds,
    getLaborerJournalScanIds,
    getJournalPayloadScanIds,
  };
}
