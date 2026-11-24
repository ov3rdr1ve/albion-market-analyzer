// Journal-filling catalogue — the "best journal to fill while gathering" model.
//
// While gathering you earn base fame, which passively fills any journal you
// carry (see the Albion wiki "Journal"). The play is to BUY an empty journal,
// fill it with fame you'd earn anyway, then SELL the full one — profit per
// journal = full_sell − empty_buy, with FAME (each tier's `maxfame`) the real
// constraint. Two journal families fill from a given gathering profession's
// fame: the resource (gathering) journal and the trophy journal; the General
// Trophy journal fills from ANY fame. A journal also only fills from resources
// of its own tier up to +2 tiers higher, so a Tier-T gathering run can fill
// journal tiers [max(2,T-2) .. T].
//
// This file is the catalogue + tunables only; the pure economics live in
// calcJournalEconomics (js/calculations.js) and the pricing/render in
// js/render-journals.js. Ids are real game ids (T8_JOURNAL_ORE_FULL …) so the
// market prices resolve — see [[project_app_catalog_architecture]]. All maxfame
// and weight values are guarded against items.xml by tests/journals-data.

const JOURNAL_TIERS = [2, 3, 4, 5, 6, 7, 8];

// `maxfame` (base fame to fill) per journal slug × tier — straight from
// items.xml `<journalitem maxfame="…">`. Resource gathering journals share one
// schedule (WOOD/STONE/ORE/FIBER/HIDE); FISHING, the trophy families and the
// General trophy each differ.
const RESOURCE_FAME = { 2: 450, 3: 900, 4: 1800, 5: 3600, 6: 7200, 7: 14400, 8: 28800 };
const FISHING_FAME = { 2: 720, 3: 1360, 4: 2223, 5: 3680, 6: 4880, 7: 6640, 8: 8320 };
const TROPHY_RESOURCE_FAME = { 2: 900, 3: 1800, 4: 3600, 5: 7200, 6: 14400, 7: 28800, 8: 57600 };
const TROPHY_HIDE_FAME = { 2: 1350, 3: 2700, 4: 5400, 5: 10800, 6: 21600, 7: 43200, 8: 86400 };
const TROPHY_FISHING_FAME = { 2: 2160, 3: 4080, 4: 6669, 5: 11040, 6: 14640, 7: 19920, 8: 24960 };
const TROPHY_GENERAL_FAME = { 2: 2400, 3: 3600, 4: 5400, 5: 8100, 6: 12150, 7: 18225, 8: 27339 };

// slug → fame schedule. Resource (WOOD/STONE/ORE/FIBER) and their trophies map
// to the shared schedules; HIDE/FISHING/GENERAL are special-cased.
const JOURNAL_FAME = {
  WOOD: RESOURCE_FAME, STONE: RESOURCE_FAME, ORE: RESOURCE_FAME, FIBER: RESOURCE_FAME,
  HIDE: RESOURCE_FAME, FISHING: FISHING_FAME,
  TROPHY_WOOD: TROPHY_RESOURCE_FAME, TROPHY_STONE: TROPHY_RESOURCE_FAME,
  TROPHY_ORE: TROPHY_RESOURCE_FAME, TROPHY_FIBER: TROPHY_RESOURCE_FAME,
  TROPHY_HIDE: TROPHY_HIDE_FAME, TROPHY_FISHING: TROPHY_FISHING_FAME,
  TROPHY_GENERAL: TROPHY_GENERAL_FAME,
};

// Every journal slug this module models (resource + trophy families + general).
const JOURNAL_SLUGS = Object.keys(JOURNAL_FAME);

// Journal weight (kg) is uniform across every family by tier (items.xml).
const JOURNAL_WEIGHT = { 2: 0.15, 3: 0.23, 4: 0.34, 5: 0.51, 6: 0.76, 7: 1.14, 8: 1.71 };

// Gathering profession `type` (matches data-gathering.js) → journal slug +
// human label. The trophy slug is always `TROPHY_<slug>`; General trophy is
// shared across all (fills from any fame).
const GATHER_PROFESSION_JOURNAL = {
  ore:   { slug: "ORE",   label: "Ore" },
  wood:  { slug: "WOOD",  label: "Wood" },
  hide:  { slug: "HIDE",  label: "Hide" },
  fiber: { slug: "FIBER", label: "Fiber" },
  rock:  { slug: "STONE", label: "Stone" },
  fish:  { slug: "FISHING", label: "Fishing" },
};

// BASE gathering fame earned per hour (premium bonus excluded — only base fame
// fills journals). DERIVED, not tuned: js/gather-fame-rates.js multiplies the
// units/hour tunables in data-gathering.js by items.xml's per-unit `famevalue`
// (land) and per-CATCH `fishingfame` (fishing). Re-exported under the original
// names so every consumer and test reads them exactly as before. To move these
// numbers, tune GATHER_UNITS_PER_HOUR / FISH_UNITS_PER_HOUR — the fame follows.
//
// The tables are NOT redeclared here: gather-fame-rates.js already binds both
// names at script-global scope in the browser, and a second `const` of the same
// name in a sibling script is a SyntaxError. This resolves them instead —
// globals in the browser, a require() in Node, memoised either way.
let _fameRateCache = null;
function _fameRates() {
  if (_fameRateCache) return _fameRateCache;
  if (typeof GATHER_BASE_FAME_PER_HOUR !== "undefined") {
    _fameRateCache = { land: GATHER_BASE_FAME_PER_HOUR, fish: FISH_BASE_FAME_PER_HOUR };
  } else if (typeof require !== "undefined") {
    const rates = require("./gather-fame-rates.js");
    _fameRateCache = { land: rates.GATHER_BASE_FAME_PER_HOUR, fish: rates.FISH_BASE_FAME_PER_HOUR };
  } else {
    _fameRateCache = { land: {}, fish: {} };
  }
  return _fameRateCache;
}

// ── lookups ──────────────────────────────────────────────────────────────
function getJournalMaxfame(slug, tier) {
  return (JOURNAL_FAME[slug] && JOURNAL_FAME[slug][tier]) || 0;
}
function getJournalWeight(tier) {
  return JOURNAL_WEIGHT[tier] || 0;
}
// Base fame/hour for a gathering activity (profession type + tier). Everything
// that is not fishing — including the General trophy's "general" type — takes
// the land table, which is the intended default.
function getBaseFamePerHour(type, tier) {
  const rates = _fameRates();
  const table = type === "fish" ? rates.fish : rates.land;
  return table[tier] || 0;
}

// ── id helpers (kept local so this module + its test stand alone) ──────────
// Empty/Full are the two market states of the same journalitem (items.xml has
// the base id; AODP prices the _EMPTY / _FULL variants — already fetched by the
// Laborers table via data-laborers.js).
function journalEmptyId(slug, tier) { return `T${tier}_JOURNAL_${slug}_EMPTY`; }
function journalFullId(slug, tier)  { return `T${tier}_JOURNAL_${slug}_FULL`; }

// One candidate journal a gathering run could fill, with its real market ids.
function makeCandidate(kind, slug, tier, label) {
  return {
    kind, slug, tier, label,
    maxfame: getJournalMaxfame(slug, tier),
    weightKg: getJournalWeight(tier),
    emptyId: journalEmptyId(slug, tier),
    fullId: journalFullId(slug, tier),
  };
}

// The resource + trophy journals of one profession at one tier.
function professionTierCandidates(prof, tier) {
  return [
    makeCandidate("gathering", prof.slug, tier, `${prof.label}`),
    makeCandidate("trophy", `TROPHY_${prof.slug}`, tier, `${prof.label} Trophy`),
  ];
}

// The General trophy of one tier — no profession, and (see below) no tier gate.
function generalTierCandidate(tier) {
  return makeCandidate("general", "TROPHY_GENERAL", tier, `General Trophy`);
}

// Those three at one tier. Only for the ALL-TIERS scan; the windowed scan has
// to treat the General trophy separately, because it is not windowed.
function tierCandidates(prof, tier) {
  return [...professionTierCandidates(prof, tier), generalTierCandidate(tier)];
}

// Which journals ignore the ±2 fill window, per items.xml <famefillingmissions>:
//
//   fish     <fishingfame value="n"/>  — no validitem list, no mintier, so any
//            tier of fish fills any tier of fishing journal.
//   general  <fameearned value="n"/>   — no list, no mintier, and no activity
//            restriction at all: ANY fame from ANY activity at ANY tier fills a
//            General trophy. The wiki says the same in words ("general journals
//            fill up when you do anything that brings in fame").
//
// Everything else that reaches here carries <gatherfame mintier="n"> plus an
// exhaustive validitem list spanning n … n+2, i.e. the window.
// Guarded against the dump by tests/journal-fill-window-matches-itemsxml.
const NO_FILL_WINDOW_TYPES = new Set(["fish", "general"]);

// The journals a Tier-`gatherTier` run of profession `type` can actually fill:
// resource + trophy of that profession, plus the General trophy. LAND gathering
// obeys the ±2-tier fill window [max(2, gatherTier-2) .. gatherTier] (a journal
// fills from its tier up to +2 higher); FISHING ignores it (any fish fills any
// tier). The General trophy ignores it too, at EVERY tier, which is why it is
// appended outside the window loop rather than emitted inside it.
// Non-gathering / unknown types (e.g. tracking) yield none.
function getJournalCandidates(type, gatherTier) {
  const prof = GATHER_PROFESSION_JOURNAL[type];
  if (!prof) return [];
  if (NO_FILL_WINDOW_TYPES.has(type)) return getProfessionJournalCandidates(type);
  const lo = Math.max(2, gatherTier - 2);
  const cands = [];
  for (let tier = lo; tier <= gatherTier; tier++) {
    if (!JOURNAL_TIERS.includes(tier)) continue;
    cands.push(...professionTierCandidates(prof, tier));
  }
  JOURNAL_TIERS.forEach((tier) => cands.push(generalTierCandidate(tier)));
  return cands;
}

// Every journal of a profession across ALL tiers (no fill window) — used to
// surface the globally best journal per fame, regardless of the gathering tier
// you're at. Lets the Gathering column note when a lower tier ranks higher
// overall than the one you can fill right now.
function getProfessionJournalCandidates(type) {
  const prof = GATHER_PROFESSION_JOURNAL[type];
  if (!prof) return [];
  const cands = [];
  JOURNAL_TIERS.forEach((tier) => cands.push(...tierCandidates(prof, tier)));
  return cands;
}

// Every journal line for the standalone "Journal Filling" companion table:
// gathering + trophy for each of the 6 families, plus the 7 General-trophy
// tiers (catalogue only; pricing happens in render-journals.js).
function getAllJournalRows() {
  const rows = [];
  Object.entries(GATHER_PROFESSION_JOURNAL).forEach(([type, prof]) => {
    JOURNAL_TIERS.forEach((tier) => {
      rows.push({ ...makeCandidate("gathering", prof.slug, tier, prof.label), type });
      rows.push({ ...makeCandidate("trophy", `TROPHY_${prof.slug}`, tier, `${prof.label} Trophy`), type });
    });
  });
  JOURNAL_TIERS.forEach((tier) => {
    rows.push({ ...makeCandidate("general", "TROPHY_GENERAL", tier, "General Trophy"), type: "general" });
  });
  return rows;
}

// All journal market ids the scan needs (every slug × tier × {empty, full}).
function getJournalItemIds() {
  const ids = new Set();
  JOURNAL_SLUGS.forEach((slug) => {
    JOURNAL_TIERS.forEach((tier) => {
      ids.add(journalEmptyId(slug, tier));
      ids.add(journalFullId(slug, tier));
    });
  });
  return [...ids];
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    JOURNAL_TIERS,
    JOURNAL_SLUGS,
    JOURNAL_FAME,
    JOURNAL_WEIGHT,
    GATHER_PROFESSION_JOURNAL,
    GATHER_BASE_FAME_PER_HOUR: _fameRates().land,
    FISH_BASE_FAME_PER_HOUR: _fameRates().fish,
    getJournalMaxfame,
    getJournalWeight,
    getBaseFamePerHour,
    journalEmptyId,
    journalFullId,
    NO_FILL_WINDOW_TYPES,
    getJournalCandidates,
    getProfessionJournalCandidates,
    getAllJournalRows,
    getJournalItemIds,
  };
}
