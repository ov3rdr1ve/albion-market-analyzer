/**
 * Laborer trophy-happiness preferences — the two numbers that set every
 * laborer's own-tier journal yield.
 *
 * The yield model itself lives in js/data-laborers.js (getLaborerYield /
 * getLaborerYieldFor); this file owns only the stored preferences and the
 * header controls that edit them, so the model stays usable in Node harnesses
 * that have no DOM and no store.
 *
 * WHY TWO NUMBERS. items.xml gives trophies a `labourersaffected` value, and it
 * is either "all" (a general trophy, 5 happiness) or one gathering/mercenary
 * type (10 happiness). No trophy exists for a crafting laborer, so a Blacksmith,
 * Fletcher, Imbuer or Tinker collects ONLY the general share — one blended
 * number would either overstate them or understate everyone else. Kept apart,
 * each box is a question the user can answer by looking at their house: which
 * general trophies have I placed, and which of the laborer's own type.
 *
 *   general  0-40  = 8 distinct general trophies × 5 (T2-T8 plus the Founder's
 *                    Looking Glass, which is also labourersaffected="all")
 *   matching 0-70  = the laborer's own type, T2-T8 × 10
 *
 * THOSE TWO CEILINGS ARE THE T8 ONES. A building holds furniture of its own tier
 * or lower, so a T6 house has no T7 or T8 trophy to place and tops out at +50 /
 * +25. Both boxes are therefore capped by the stored house tier — see
 * getHouseTrophyCaps in js/house-tier.js, which defaults to T8 so an untouched
 * install reads exactly the numbers above.
 *
 * A laborer's happiness is base (100 × tier, met by a bed and table at its own
 * tier) plus its applicable trophies, and every point above base is +0.5% yield
 * to a 150% cap. So a fully-trophied T8 Tinker reads 840 in game and yields
 * 120%; a fully-trophied T8 Lumberjack reads 910 and is capped at 150%.
 *
 * Both default to their max, consistent with the app's max-spec assumption
 * everywhere else. The Laborers header captions the resulting yields so the
 * assumption is never silent.
 */

const LABORER_HAPPINESS_GENERAL_KEY = "laborerHappinessGeneral";
const LABORER_HAPPINESS_MATCHING_KEY = "laborerHappinessMatching";

// ── the preferences ───────────────────────────────────────────────────────

// Raw stored value, or null when there is no store to read. Node exposes a
// `localStorage` global that throws unless the runtime was started with a
// store, so the guard is on the read, not on the symbol.
function _rawLaborerHappiness(key) {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

// Unset, blank or unparseable degrades to the max; anything out of range is
// clamped, so a corrupt stored value can never produce a nonsense yield. A
// stored 0 is a real answer (no trophies placed) and is kept.
function _happinessPref(key, max) {
  const raw = _rawLaborerHappiness(key);
  if (raw == null || String(raw).trim() === "") return max;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return max;
  return Math.max(0, Math.min(max, n));
}

// What the CURRENT house can actually hold. js/house-tier.js is a separate
// script tag, and Node harnesses load this file without it, so the absence of
// the getter degrades to the T8 ceilings rather than to zero.
function _happinessCaps() {
  if (typeof getHouseTrophyCaps === "function" && typeof getHouseTier === "function") {
    return getHouseTrophyCaps(getHouseTier());
  }
  return { general: GENERAL_TROPHY_HAPPINESS_MAX, matching: MATCHING_TROPHY_HAPPINESS_MAX };
}

// Happiness from general trophies — every laborer gets this, crafting included.
function getLaborerHappinessGeneral() {
  return _happinessPref(LABORER_HAPPINESS_GENERAL_KEY, _happinessCaps().general);
}

// Happiness from trophies of the laborer's own type. Only reaches laborers that
// HAVE such a trophy — see LABORER_TROPHY_AFFECT in js/data-laborers.js.
function getLaborerHappinessMatching() {
  return _happinessPref(LABORER_HAPPINESS_MATCHING_KEY, _happinessCaps().matching);
}

// The absolute happiness the game would show for this laborer at this tier —
// base + the trophies that actually reach it. Display only; the maths uses the
// bonus. `laborerSlug` omitted = the general-only case (a crafting laborer).
function getLaborerHappiness(tier, laborerSlug) {
  return getLaborerBaseHappiness(tier) + getLaborerHappinessBonusFor(laborerSlug);
}

// ── the header control ────────────────────────────────────────────────────

// What the current setting means, in one line: the two own-tier yields it buys,
// named by the families they apply to, with the in-game T8 numbers to compare
// against. WOOD stands in for every laborer that has a matching trophy — they
// all share one ceiling.
function laborerHappinessSummary() {
  const gather = getLaborerYieldFor("WOOD", 8) * 100;
  const craft = getLaborerYieldFor("TOOLMAKER", 8) * 100;
  return {
    general: getLaborerHappinessGeneral(),
    matching: getLaborerHappinessMatching(),
    gatherPct: +gather.toFixed(1),
    craftPct: +craft.toFixed(1),
    text: `T8 own-tier yield: gatherers ${gather.toFixed(1)}% (reads ${
      getLaborerHappiness(8, "WOOD")}) · crafters ${craft.toFixed(1)}% (reads ${
      getLaborerHappiness(8, "TOOLMAKER")})`,
  };
}

function _refreshLaborerHappinessNote() {
  if (typeof document === "undefined") return;
  const note = document.getElementById("laborer-happiness-note");
  if (note) note.textContent = laborerHappinessSummary().text;
}

// The house tier can move under these boxes, so the ceiling is re-read on every
// paint rather than captured when the input was wired: `capOf` is a function,
// not a number.
function _paintHappinessInput(id, key, capOf) {
  if (typeof document === "undefined") return;
  const input = document.getElementById(id);
  if (!input) return;
  const max = capOf();
  input.max = String(max);
  input.value = String(_happinessPref(key, max));
}

function _wireHappinessInput(id, key, capOf, onChange) {
  if (typeof document === "undefined") return;
  const input = document.getElementById(id);
  if (!input) return;
  _paintHappinessInput(id, key, capOf);

  input.addEventListener("change", () => {
    // Write back the CLAMPED value, so the box never shows a number the tables
    // are not priced at (and a cleared box falls back to the max default).
    const raw = input.value.trim();
    try {
      if (typeof localStorage !== "undefined") {
        if (raw === "") localStorage.removeItem(key);
        else localStorage.setItem(key, String(parseInt(raw, 10)));
      }
    } catch (e) { /* private mode — the session still re-renders below */ }
    _paintHappinessInput(id, key, capOf);
    _refreshLaborerHappinessNote();
    if (typeof onChange === "function") onChange();
  });
}

// Re-reads both boxes against the current house tier. Called by the house-tier
// picker: dropping to a T6 house has to pull a stored +70 down to +50 on screen,
// not only inside the yield maths.
function refreshLaborerHappinessControl() {
  _paintHappinessInput("laborer-happiness-general", LABORER_HAPPINESS_GENERAL_KEY,
    () => _happinessCaps().general);
  _paintHappinessInput("laborer-happiness-matching", LABORER_HAPPINESS_MATCHING_KEY,
    () => _happinessCaps().matching);
  _refreshLaborerHappinessNote();
}

// Wires the two header <input>s. Owns its own restore/persist so app.js (already
// far over the file-size limit) grows by a single call.
function initLaborerHappinessControl(onChange) {
  if (typeof document === "undefined") return;
  _wireHappinessInput("laborer-happiness-general", LABORER_HAPPINESS_GENERAL_KEY,
    () => _happinessCaps().general, onChange);
  _wireHappinessInput("laborer-happiness-matching", LABORER_HAPPINESS_MATCHING_KEY,
    () => _happinessCaps().matching, onChange);
  _refreshLaborerHappinessNote();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    LABORER_HAPPINESS_GENERAL_KEY,
    LABORER_HAPPINESS_MATCHING_KEY,
    getLaborerHappinessGeneral,
    getLaborerHappinessMatching,
    getLaborerHappiness,
    laborerHappinessSummary,
    initLaborerHappinessControl,
    refreshLaborerHappinessControl,
  };
}
