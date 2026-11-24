// How LONG a journal takes to fill — the half of the journal question the
// silver-per-fame ranking never answers.
//
// The Journals and Gathering tables rank journals by silver-per-fame, which is
// the right ranking (fame is the constraint, and fame/hour does not depend on
// which journal you carry). But it leaves the reason a small journal wins
// invisible: it simply turns over faster. This module supplies the missing
// number and the rule that bounds it.
//
//   hours    = maxfame ÷ baseFamePerHour
//   silver/h = silverPerFame × baseFamePerHour  (identically margin ÷ hours)
//
// FILL WINDOW (Albion wiki "Journal"): gathering at tier G fills journals of
// tier G−2 … G — a journal fills from its own tier up to two tiers HIGHER, so a
// T8 gatherer cannot fill a T3 journal at all. FISHING is exempt: any fish fills
// any tier. Only base fame counts; premium bonus fame does not fill journals.
// data-journals.js already encodes the same rule from the other direction, in
// getJournalCandidates — tests/journal-fill-speed pins the two together.
//
// GATHERING TIER: the tables that read this are not gathering-tier statements
// (a journal row is a journal, a laborer row is a laborer), so there is no
// header preference any more — the old Gathering Tier select is gone. A JOURNAL
// row is priced filling at its OWN tier and a LABORER row at the laborer's own
// tier (a row priced at many different gathering tiers cannot be compared or
// sorted per hour). The Gathering table is the same rule from the other side:
// each of its rows already IS a gathering tier, so it passes its own tier as
// `gatherTierOverride`.

// ── tier resolution ───────────────────────────────────────────────────────

// Gathering tier to price a journal row's fill speed at: always the journal's
// own tier.
function resolveGatherTier(journalTier) {
  return journalTier;
}

// Gathering tier for a LABORER row, which is a different question.
//
// A Laborers (or Building Costs) row is a laborer tier, and the player feeding
// that laborer gathers at their own tier — not at each candidate journal's tier.
// Pricing every candidate at its own tier there made one row compare plays that
// cannot be run simultaneously, and it neutralised the ±2 fill window entirely:
// with gatherTier == journalTier every tier passes canFillAtTier, so a T8 land
// laborer was offered T2-T8 journals when a T8 gatherer can only fill T6-T8.
//
// The laborer's own tier is the answer; with none (a malformed row) there is
// nothing to say, so it returns null and the caller falls back to the journal's
// own tier.
function resolveLaborerGatherTier(laborerTier) {
  return laborerTier != null ? laborerTier : null;
}

// ── the maths ─────────────────────────────────────────────────────────────

// Hours of gathering to fill a journal. Every degenerate input collapses to 0
// ("no estimate") — a renderer divides by this and prints it, so it must never
// produce Infinity or NaN.
function getJournalFillHours(maxfame, baseFamePerHour) {
  const f = Number(maxfame);
  const r = Number(baseFamePerHour);
  if (!Number.isFinite(f) || !Number.isFinite(r) || f <= 0 || r <= 0) return 0;
  return f / r;
}

// Does this journal type ignore the fill window entirely? Fishing and the
// General trophy do — see NO_FILL_WINDOW_TYPES in js/data-journals.js for the
// items.xml evidence. Duplicated as a local fallback only because this file is
// also loaded standalone by tests.
function journalTypeIgnoresFillWindow(type) {
  if (typeof NO_FILL_WINDOW_TYPES !== "undefined") return NO_FILL_WINDOW_TYPES.has(type);
  return type === "fish" || type === "general";
}

// Can a tier-`journalTier` journal be filled while gathering at `gatherTier`?
// The window is [journalTier, journalTier + 2]. `unwindowed` opts out of it
// entirely — pass journalTypeIgnoresFillWindow(type), true for fishing and for
// the General trophy, which items.xml gates by nothing at all.
function canFillAtTier(journalTier, gatherTier, unwindowed) {
  const j = Number(journalTier);
  const g = Number(gatherTier);
  if (!Number.isFinite(j) || !Number.isFinite(g) || j <= 0 || g <= 0) return false;
  if (unwindowed) return true;
  return g >= j && g <= j + 2;
}

/**
 * Everything a cell needs about one journal's fill speed.
 * `type` is a gathering profession key ("ore"/"wood"/…/"fish"), or "general" for
 * the General trophy — getBaseFamePerHour falls through to the land table for
 * every non-fish type, which is the intended default. "general" also opts out of
 * the fill window: items.xml gates that journal by nothing at all, so any tier
 * of it is fillable by any activity at any tier.
 * Returns { gatherTier, famePerHour, hours, fillable, reason }, where reason is
 * null | "no-fame-schedule" | "out-of-window" | "no-fame-rate".
 */
function resolveJournalFill({ type, journalTier, maxfame, gatherTierOverride } = {}) {
  const gatherTier = gatherTierOverride != null ? gatherTierOverride : resolveGatherTier(journalTier);
  const famePerHour = (typeof getBaseFamePerHour === "function")
    ? getBaseFamePerHour(type, gatherTier) : 0;
  const out = { gatherTier, famePerHour, hours: 0, fillable: false, reason: null };
  if (!(Number(maxfame) > 0)) { out.reason = "no-fame-schedule"; return out; }
  if (!canFillAtTier(journalTier, gatherTier, journalTypeIgnoresFillWindow(type))) { out.reason = "out-of-window"; return out; }
  if (!(famePerHour > 0)) { out.reason = "no-fame-rate"; return out; }
  out.hours = getJournalFillHours(maxfame, famePerHour);
  out.fillable = out.hours > 0;
  if (!out.fillable) out.reason = "no-fame-rate";
  return out;
}

// ── laborer slug → gathering profession ───────────────────────────────────
// The two catalogues spell the same profession differently (laborer slug STONE
// vs gathering type "rock", FISHING vs "fish"), so invert GATHER_PROFESSION_JOURNAL
// rather than hand-typing a second copy that can drift from it.
let _slugToTypeCache = null;
function _slugGatherTypeMap() {
  if (_slugToTypeCache) return _slugToTypeCache;
  const map = {};
  const professions = (typeof GATHER_PROFESSION_JOURNAL !== "undefined") ? GATHER_PROFESSION_JOURNAL : {};
  Object.entries(professions).forEach(([type, prof]) => {
    map[prof.slug] = type;
    map[`TROPHY_${prof.slug}`] = type;
  });
  // The General trophy fills from any fame; it has no profession of its own, so
  // it takes the land fame/hour rate (getBaseFamePerHour's non-fish default).
  map.TROPHY_GENERAL = "general";
  _slugToTypeCache = map;
  return map;
}

// Gathering profession for a laborer/journal slug, or null when the fame that
// fills it has no hours model in this repo: the four crafting journals
// (crafting fame is modelled per CRAFT, never per hour) and the two mercenary
// ones (combat fame is not modelled at all).
function laborerSlugToGatherType(slug) {
  if (!slug || typeof slug !== "string") return null;
  const t = _slugGatherTypeMap()[slug];
  return t != null ? t : null;
}

// ── shared markup ─────────────────────────────────────────────────────────

// "18 min" / "3.1 h" / "42 h" — minutes below the hour so a fast-filling low
// tier does not render as "0.3 h".
function formatFillHours(hours) {
  if (!(hours > 0)) return "";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 10) return `${hours.toFixed(1)} h`;
  return `${Math.round(hours)} h`;
}

function _fsSilver(n) {
  return (typeof formatSilver === "function") ? formatSilver(n) : Math.round(n).toLocaleString();
}

// The two-line body both the Journals cell and the Gathering cell render, so
// they cannot drift apart: fill time on top, the silver/hour it implies below.
// `note` is an optional third line (the Laborers capacity chip).
// `rateSuffix` is optional muted text appended to the rate line — the Laborers
// column puts its silver-per-fame sort key there, so what orders the rows is
// visible on the row. Nothing else passes it, so the other two cells are
// byte-identical to before.
function fillSpeedLines({ hours, ratePerHour, note, rateSuffix } = {}) {
  const time = formatFillHours(hours);
  if (!time) return "";
  const rateColor = ratePerHour >= 0 ? "#1f9d55" : "#c0392b";
  const suffix = rateSuffix ? `<small style="color:#9ca3af">${rateSuffix}</small>` : "";
  const rate = (ratePerHour != null && ratePerHour !== 0)
    ? `<br><span style="color:${rateColor}">${ratePerHour > 0 ? "+" : ""}${_fsSilver(ratePerHour)}/h</span>${suffix}`
    : "";
  const extra = note ? `<br><small style="color:#9ca3af">${note}</small>` : "";
  return `<strong>${time}</strong>${rate}${extra}`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    resolveGatherTier,
    resolveLaborerGatherTier,
    getJournalFillHours,
    journalTypeIgnoresFillWindow,
    canFillAtTier,
    resolveJournalFill,
    laborerSlugToGatherType,
    formatFillHours,
    fillSpeedLines,
  };
}
