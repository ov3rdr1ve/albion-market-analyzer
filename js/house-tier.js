/**
 * The house you actually own — one stored tier, and what it lets you place.
 *
 * THE RULE. A building holds furniture of its OWN tier or lower and nothing
 * above: a T6 house takes T2-T6 furniture. It is not in the dumps —
 * `<furnitureitem>` in items.xml carries `placeableindoors` / `placeableoutdoors`
 * (where an item may stand) and its own `tier`, but no building-tier
 * requirement, and buildings.xml carries only `furniturelimit` /
 * `laborerslimit`. So the cap is coded here rather than generated.
 *
 * WHO READS IT. Two tables have no building of their own to ask:
 *
 *   • Laborers — the two happiness boxes (js/laborer-happiness.js). Trophy
 *     happiness is tier-flat and stacks only across DISTINCT items, so the
 *     number of trophies a house can hold IS the number of tiers it can hold.
 *   • Crafting Planner — the furniture rows (beds, tables, chests, repair kits,
 *     Trophy Shark). A T8 bed is not a plan for a T6 house.
 *
 * The Building Costs table does NOT read this: every row there is a building of
 * a known tier, so js/buildings-furnishing.js caps against `building.tier`.
 *
 * DEFAULT T8. Unset means the top house, so a user who never opens the picker
 * sees exactly what the app showed before this preference existed — no rows
 * silently hidden, no yields silently lowered.
 *
 * This is a TIER cap only. Furniture SLOTS bite as well (a T8 house has 14 and
 * spends 4 on beds and a table), but that is the Building Costs table's job and
 * these ceilings ignore it on purpose — the same limitation js/data-laborers.js
 * already states for GENERAL_TROPHY_HAPPINESS_MAX.
 *
 * Pure getters — no DOM below initHouseTierControl, so Node harnesses can load
 * this file alone.
 */

const HOUSE_TIER_KEY = "houseTier";
const HOUSE_TIER_DEFAULT = 8;
const HOUSE_TIER_MIN = 2;   // T1 houses do not exist
const HOUSE_TIER_MAX = 8;

// ── the preference ────────────────────────────────────────────────────────

// Node exposes a `localStorage` global that throws unless the runtime was
// started with a store, so the guard is on the read, not on the symbol.
function _rawHouseTier() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(HOUSE_TIER_KEY);
  } catch (e) {
    return null;
  }
}

// Anything unusable degrades to the default; anything in-range-ish is clamped,
// so a corrupt stored value can never hide a row or zero a yield.
function _clampHouseTier(value, fallback = HOUSE_TIER_DEFAULT) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(HOUSE_TIER_MIN, Math.min(HOUSE_TIER_MAX, n));
}

function getHouseTier() {
  const raw = _rawHouseTier();
  if (raw == null || String(raw).trim() === "") return HOUSE_TIER_DEFAULT;
  return _clampHouseTier(raw);
}

// Writes the CLAMPED tier. A value that parses to nothing clears the preference
// rather than storing a tier nobody chose.
function setHouseTier(tier) {
  const n = parseInt(tier, 10);
  try {
    if (typeof localStorage === "undefined") return;
    if (!Number.isFinite(n)) localStorage.removeItem(HOUSE_TIER_KEY);
    else localStorage.setItem(HOUSE_TIER_KEY, String(_clampHouseTier(n)));
  } catch (e) { /* private mode — the session still reads the default */ }
}

// ── what that tier can hold ───────────────────────────────────────────────

/**
 * The most trophy happiness a house of this tier can be given, split the way
 * the Laborers boxes are: `matching` reaches the laborer's own type only,
 * `general` reaches every laborer including the crafting ones.
 *
 * A house of tier H holds the trophy tiers T2..TH, i.e. H − 1 of each line, at
 * the tier-flat 10 (specialist) and 5 (general) items.xml gives them. The T8
 * general figure is 40 rather than 35 because the Founder's Looking Glass is an
 * eighth distinct `labourersaffected="all"` trophy — the catalog constants below
 * are the authority on both ceilings.
 */
function getHouseTrophyCaps(houseTier) {
  const tier = _clampHouseTier(houseTier);
  const tiers = tier - 1;                       // T2..TH
  const genMax = typeof GENERAL_TROPHY_HAPPINESS_MAX !== "undefined"
    ? GENERAL_TROPHY_HAPPINESS_MAX : 40;
  const matchMax = typeof MATCHING_TROPHY_HAPPINESS_MAX !== "undefined"
    ? MATCHING_TROPHY_HAPPINESS_MAX : 70;
  // Whatever the ladder does not account for (the Founder's Looking Glass) is
  // only reachable at the top tier, so it rides on T8 rather than on every tier.
  const generalLadder = 5 * tiers;
  return {
    matching: Math.min(matchMax, 10 * tiers),
    general: Math.min(genMax, tier >= HOUSE_TIER_MAX ? genMax : generalLadder),
  };
}

// ── the picker ────────────────────────────────────────────────────────────

// Every `select.house-tier-select` on the page edits the same preference — the
// Laborers header and the Crafting Planner header each carry one. They are kept
// in step because two pickers disagreeing would be reporting two houses.
function initHouseTierControl(onChange) {
  if (typeof document === "undefined") return;
  const selects = Array.from(document.querySelectorAll("select.house-tier-select") || []);
  if (selects.length === 0) return;

  const paint = () => {
    const tier = String(getHouseTier());
    selects.forEach((el) => { el.value = tier; });
  };
  paint();

  selects.forEach((el) => {
    el.addEventListener("change", () => {
      setHouseTier(el.value);
      paint();
      if (typeof onChange === "function") onChange();
    });
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    HOUSE_TIER_KEY, HOUSE_TIER_DEFAULT, HOUSE_TIER_MIN, HOUSE_TIER_MAX,
    getHouseTier, setHouseTier, getHouseTrophyCaps, initHouseTierControl,
  };
}
