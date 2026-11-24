// ── THE Silver/Focus standard ───────────────────────────────────────────────
//
// Every table that shows a "Silver/Focus" column and a "Best Focus" column
// answers one question with one definition.
//
// A focus PLAY is a single placement of a focus charge somewhere inside a row's
// pipeline: the craft itself, one refine step below it, an ingredient's own
// chain craft, a nurture cycle, a watering. A play is described by two numbers:
//
//   profitDelta   silver the play ADDS to the FINAL PRODUCT's profit, measured
//                 against the same row run WITHOUT that focus. Focus never
//                 raises revenue — it only raises a return rate — so the delta
//                 is always a cost the play removes from the finished item.
//   focusCost     focus points the play burns, once.
//
//   silverPerFocus = profitDelta / focusCost
//
// Best Focus   = the play with the highest profitDelta.
// Silver/Focus = that same winning play's silverPerFocus.
//
// Ranking on profitDelta and not on the rate is deliberate. A cheap low-tier
// step is often the most efficient per focus point while saving almost nothing
// in absolute silver, which is the wrong answer when the objective is the
// finished item's profit (the craft's revenue is the same whichever placement
// you pick, so "most profitable end product" is exactly "biggest cost removed").
// Focus is scarce, so an exact tie on delta goes to the play that burns fewer
// points.
//
// This module is the single source of that arithmetic. Before it, Refining
// ranked ladder tiers by rate, the Crafting Planner by delta, and Consumables /
// Mounts-craft / Farming divided the row's WHOLE profit by its focus cost — an
// average that credited focus with profit the row earns anyway. Four tables,
// four different answers about the same focus point.
//
// See also: js/refining-route.js marginalSilverPerFocus (the closed form of a
// single RRR-only play) and js/craft-planner-pricing.js (candidate enumeration
// for a refine ▸ craft pipeline).

// Per-craft / per-cycle unit the delta is quoted in, by play kind. The delta is
// always "per one execution of the row", and the kinds differ in what one
// execution is.
const FOCUS_PLAY_UNITS = {
  craft: "/craft",      // the row's own craft step (crafting, consumables, mounts, saddler bases)
  refine: "/refine",    // one refine step of a material's ladder
  chain: "/craft",      // an ingredient's own sub-craft (butcher, mill)
  nurture: "/cycle",    // one breeding cycle's nurture charges
  saddler: "/craft",    // the saddler craft that turns a grown mount into a mount
  water: "/cycle",      // one farming cycle's watering charges
};

function _fpTx(en, slug) {
  return (typeof tx === "function") ? tx(en, slug) : en;
}

function _fpName(id) {
  if (!id) return "";
  return (typeof getItemDisplayName === "function") ? getItemDisplayName(id) : id;
}

function _fpSilver(n) {
  return (typeof formatSilver === "function")
    ? formatSilver(n)
    : Math.round(n).toLocaleString();
}

// Focus costs are fractional (getFocusCost returns the exact charge), so they
// go through the shared formatter rather than toLocaleString.
function _fpFocus(n) {
  if (typeof formatFocusCost === "function") return formatFocusCost(n);
  const abs = Math.abs(n);
  if (abs >= 100) return Math.round(n).toLocaleString();
  return String(Number(n.toFixed(abs >= 10 ? 1 : 2)));
}

/**
 * Normalize one candidate placement into a focus play.
 *
 * Returns null when the step cannot take focus at all (no positive focus cost —
 * fish chops, no-return combines, un-watered farm rows). A play whose delta is
 * zero or negative IS kept: "focus is a bad buy here" is a real answer and the
 * column renders it in the negative class, whereas dropping it would read as
 * "this step can't use focus".
 *
 * Every other field on `spec` (matId, focusItemId, tier, chain, label…) is
 * carried through untouched for the caller's renderer.
 */
function makeFocusPlay(spec) {
  if (!spec || !spec.kind) return null;
  const focusCost = spec.focusCost;
  if (!(focusCost > 0)) return null;
  const profitDelta = spec.profitDelta || 0;
  return { ...spec, focusCost, profitDelta, silverPerFocus: profitDelta / focusCost };
}

/**
 * The placement that leaves the row's END PRODUCT most profitable: highest
 * profitDelta, ties broken toward the cheaper focus charge. Nulls in the list
 * (steps that can't take focus) are skipped. Returns null when nothing can.
 */
function pickBestFocusPlay(plays) {
  if (!plays || !plays.length) return null;
  let best = null;
  for (const p of plays) {
    if (!p) continue;
    if (!best) { best = p; continue; }
    const better = p.profitDelta > best.profitDelta + 1e-6;
    const tieCheaper = Math.abs(p.profitDelta - best.profitDelta) <= 1e-6 &&
      p.focusCost < best.focusCost;
    if (better || tieCheaper) best = p;
  }
  return best;
}

/** The winning play's silver-per-focus — the Silver/Focus column's value. */
function focusPlayRate(play) {
  return play ? play.silverPerFocus : 0;
}

// What to focus, in words, per kind. Refine/chain plays name the step so the
// user is told which craft to run, not merely which material is involved.
function focusPlayLabel(play) {
  switch (play.kind) {
    case "refine":
      return `${_fpTx("Refine", "r_refine")} ${_fpName(play.focusItemId || play.matId)}`;
    case "chain":
      return `${_fpTx("Craft", "r_craft")} ${_fpName(play.focusItemId || play.matId)}`;
    case "nurture": return _fpTx("Nurture", "r_focus_play_nurture");
    case "saddler": return _fpTx("Saddle", "r_focus_play_saddle");
    case "water":   return _fpTx("Water", "r_focus_play_water");
    default:        return _fpTx("Craft", "r_craft");
  }
}

function focusPlayTip(play) {
  switch (play.kind) {
    case "refine":
      return _fpTx("Spend your focus on THIS refine step (the tier of the ladder that removes the most cost) and use the result in the craft — of every place this row can put a focus point, that leaves the finished item most profitable. Every other step is run without focus.", "r_tip_focus_refine_used");
    case "chain":
      return _fpTx("Spend your focus on this ingredient's own craft and use the output in the recipe: of every placement this row allows, it leaves the finished item most profitable.", "r_tip_focus_chain_used");
    case "nurture":
      return _fpTx("Spend your focus nurturing the offspring: the extra offspring chance is worth more here than the return rate focus would buy on the saddler craft.", "r_tip_focus_nurture");
    case "saddler":
      return _fpTx("Spend your focus on the saddler craft: the extra return rate on its materials beats what the same focus buys nurturing offspring.", "r_tip_focus_saddler");
    case "water":
      return _fpTx("Spend your focus watering: the yield it adds over an unwatered cycle is what the focus buys here.", "r_tip_focus_water");
    default:
      return _fpTx("Spend your focus on the CRAFT itself: the extra return rate saves more on this recipe's materials than focusing any single step below it, so the finished item ends up most profitable.", "r_tip_focus_craft");
  }
}

/**
 * Inner HTML of a "Best Focus" cell. Reads left to right as the advice it is:
 * WHAT to focus · what it adds to this row · the rate it adds it at.
 *
 * opts.unit        override the per-execution label (defaults to the kind's).
 * opts.linkRefine  (focusItemId, labelHtml) => html — wraps a refine play's
 *                  label in a jump to that refine's own row. Ignored for other
 *                  kinds, which have no row to jump to.
 * opts.focusPerExecution
 *                  focus ONE EXECUTION OF THE ROW burns, when that differs from
 *                  `play.focusCost` (one step's charge). `profitDelta` is always
 *                  per execution, so the two are only divisible when the step
 *                  runs once per execution — true for a craft/nurture/water play,
 *                  false for the Crafting Planner's refine play, where the delta
 *                  covers every unit of the material the craft eats times every
 *                  ladder refine per unit. Pass the row's own total (the planner
 *                  has it as _cpFocusPerCraft, the divisor Profit / 10k Focus
 *                  uses) and both the rate and the tooltip quote that instead.
 *                  Ignored when absent or not positive.
 */
function focusPlayCell(play, opts) {
  if (!play) return '<span style="color:#6b7280;font-style:italic">—</span>';
  const o = opts || {};
  const unit = o.unit || FOCUS_PLAY_UNITS[play.kind] || "/craft";
  const perExec = o.focusPerExecution > 0 ? o.focusPerExecution : 0;
  const focusShown = perExec || play.focusCost;
  const rateVal = perExec ? play.profitDelta / perExec : play.silverPerFocus;
  const label = `<span style="text-decoration:underline dotted" title="${focusPlayTip(play)}">${
    focusPlayLabel(play)}${play.kind === "refine" ? " ↗" : ""}</span>`;

  // The winning ladder tier is a step INSIDE the material's chain and is often
  // below it (a T6 block ladder refines a T5 block on the way), so naming the
  // material alone would answer the wrong question — "refine T5 or T6?".
  const stepId = play.focusItemId || play.matId;
  const ladderNote = (play.kind === "refine" && play.matId && stepId !== play.matId)
    ? ` <small style="color:#9ca3af">(${
        _fpTx("in the {mat} ladder", "r_focus_refine_ladder").replace("{mat}", _fpName(play.matId))})</small>`
    : "";
  const where = (play.kind === "refine" && typeof o.linkRefine === "function")
    ? o.linkRefine(stepId, label) + ladderNote
    : label + ladderNote;

  // The delta is always shown, including 0 and negatives: "this step CAN take
  // focus and it buys you nothing" is a different answer from the em dash a
  // missing play renders, and the cell should say which one it is.
  const deltaCls = play.profitDelta >= 0 ? "profit-low" : "profit-negative";
  const sign = play.profitDelta > 0 ? "+" : "";
  const delta = ` <b class="${deltaCls}">${sign}${_fpSilver(play.profitDelta)}</b>` +
    `<small style="color:#9ca3af"> ${_fpTx(unit, "r_per_" + unit.slice(1))}</small>`;
  const rate = rateVal > 0
    ? `<b class="profit-low">${rateVal.toFixed(1)}</b>`
    : `<span class="profit-negative">${rateVal.toFixed(1)}</span>`;
  return `${where}${delta} <small style="color:#9ca3af" title="${
    _fpFocus(focusShown)} ${_fpTx("focus ea", "r_focus_ea")}">·</small> ` +
    `${rate}<small style="color:#9ca3af"> ${_fpTx("/focus", "r_per_focus")}</small>`;
}

/**
 * Why a row has NO focus play at all — the hover text on its Profit / 10k Focus
 * dash, so an empty cell explains itself instead of reading like a bug.
 *
 * A combine craft — royal gear (base SETn armor + Royal Sigils) and the
 * artifact / faction capes (base cape + crest + tokens) — has craftingfocus="0"
 * in items.xml and returns none of its inputs (maxreturnamount="0"): the focus
 * was already paid making the base item. With no input to refine either, a
 * 10,000-focus bar buys nothing on that row. Empty string when the item does
 * have a focus cost (the dash then has some other cause, e.g. an enchant buy).
 */
function noFocusPlayTip(itemId, tier) {
  const cost = (typeof getCraftFocusCost === "function") ? getCraftFocusCost(itemId, tier) : 0;
  if (cost > 0) return "";
  const say = (typeof tx === "function") ? tx : (en) => en;
  return say("No focus to spend here: this is a combine craft (finished base item + sigils/crests/tokens) that costs 0 focus in the game data, and none of its inputs can be refined, so a 10k focus bar buys nothing on it. It also fills no crafting journal.", "r_no_focus_combine_tip");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    FOCUS_PLAY_UNITS,
    makeFocusPlay,
    pickBestFocusPlay,
    focusPlayRate,
    focusPlayLabel,
    focusPlayTip,
    focusPlayCell,
    noFocusPlayTip,
  };
}
