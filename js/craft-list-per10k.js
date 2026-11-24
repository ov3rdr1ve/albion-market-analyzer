/**
 * My Crafting List — the "Profit / 10k Focus" column, re-based on the row's
 * planned quantity.
 *
 * In its own table that column is a MARGINAL number: profit per play × the
 * whole plays one 10,000-focus bar buys. In the list a row also has a quantity,
 * and the question the list answers is "what does this plan make" — so here the
 * cell reads
 *
 *     Total Profit (qty × unit profit)  +  one full 10,000-focus bar
 *
 * The two addends overlap when the planned quantity is itself funded out of the
 * same focus budget, so this is a planned-run total, NOT a marginal value; the
 * header and cell tooltips say so (see _clColTitle in js/render-craft-list.js).
 *
 * Scope: only the column whose source `data-sort` is `profitPer10kFocus`.
 * "Profit Gathered / 10k Focus" and the Faction Spending FP column keep their
 * own meaning and are untouched.
 *
 * The base number is never parsed back out of the rendered cell — every table
 * carrying this column puts it on the row object as `row.profitPer10kFocus`
 * (js/render-mounts.js, js/render-crafting.js, js/render-farming.js,
 * js/render-consumables.js, js/render-craft-planner.js), and the list already
 * holds that object.
 */

/** The source `data-sort` this module owns. */
const CL_PER10K_SORT = "profitPer10kFocus";

/** Cell marker + the attributes the live qty path re-reads the bases from. */
const CL_PER10K_CLASS = "cl-p10k";
const CL_PER10K_ATTR = "data-cl-p10k-base";
const CL_PER10K_ATTR_SELF = "data-cl-p10k-base-self";
const CL_PER10K_ATTR_GATHERED = "data-cl-p10k-base-gathered";

/**
 * Which column of `tableId` is the per-10k one, or -1.
 *
 * Read from the source <thead>, the same place _clHeaderRow and
 * _clGroupColCount read their shape from, so the index can never disagree with
 * the header the list draws.
 */
function per10kColumnIndex(tableId) {
  if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") {
    return -1;
  }
  const ths = [...document.querySelectorAll(`#${tableId} thead th`)];
  return ths.findIndex((th) => typeof th.getAttribute === "function"
    && th.getAttribute("data-sort") === CL_PER10K_SORT);
}

/** Pure: the number the list prints. Parked rows plan nothing, so add nothing. */
function combinedPer10k(base, rowProfit, parked) {
  // `Number(null)` is 0, and a row whose table prints "—" here (the Crafting
  // Planner, when the craft cannot spend focus) reports exactly null — adding
  // Total Profit to it would invent a focus number that row does not have.
  if (base === null || base === undefined || base === "") return null;
  const b = Number(base);
  if (!Number.isFinite(b)) return null;
  if (parked) return b;
  const p = Number(rowProfit);
  return b + (Number.isFinite(p) ? p : 0);
}

/** Local silver formatter — the app's when it is loaded, plain grouping otherwise. */
function _clP10kFmt(n) {
  if (typeof formatSilver === "function") return formatSilver(n);
  return Math.round(Number(n) || 0).toLocaleString();
}

function _clP10kTip(base, rowProfit, parked) {
  const say = (typeof tx === "function")
    ? tx
    : (en) => en;
  if (parked) {
    return say("One full 10,000-focus bar. This row is parked at 0, so it adds no planned profit.",
      "r_cl_p10k_parked_tip");
  }
  return say("Total Profit {total} + one full 10,000-focus bar {p10k}", "r_cl_p10k_combined_tip")
    .replace("{total}", _clP10kFmt(rowProfit))
    .replace("{p10k}", _clP10kFmt(base));
}

/**
 * The dimmed self-found <small> under the bought value — the same line the
 * mounts breeding table prints (js/render-mounts-breeding-row.js), but with
 * the list's COMBINED figure: the row's planned total over the self-bred bar
 * instead of the bought one. Shared by the full patch and the live qty path;
 * empty string when the row has no self-found number.
 */
function _clSelfSmallHtml(baseSelf, rowProfit, parked) {
  const value = combinedPer10k(baseSelf, rowProfit, parked);
  if (value === null) return "";
  const say = (typeof tx === "function")
    ? tx
    : (en) => en;
  const tip = say(
    "Same plan with every baby self-found (self-bred, baby purchase cost excluded), plus one 10k focus bar on self-bred babies: {value}",
    "r_cl_p10k_self_tip",
  ).replace("{value}", _clP10kFmt(value));
  return `<small style="color:#9ca3af;display:block;font-size:0.7rem" title="${tip}">`
    + `${say("self-found", "r_p10k_breed_self")} ${_clP10kFmt(value)}</small>`;
}

/**
 * The dimmed "gathered" <small> under the bought value — the line the source
 * tables print (gatheredPer10kSmallHtml in js/self-found-profit.js), with the
 * list's COMBINED figure: the planned total over the self-gathered bar. Empty
 * string when the row has no finite gathered number.
 */
function _clGatheredSmallHtml(baseGathered, rowProfit, parked) {
  const value = combinedPer10k(baseGathered, rowProfit, parked);
  if (value === null) return "";
  const say = (typeof tx === "function")
    ? tx
    : (en) => en;
  const tip = say(
    "Same plan with the gatherable mats self-gathered (cost 0), plus one 10k focus bar the same way: {value}",
    "r_cl_p10k_gathered_tip",
  ).replace("{value}", _clP10kFmt(value));
  return `<small style="color:#9ca3af;display:block;font-size:0.7rem" title="${tip}">`
    + `${say("gathered", "r_p10k_gathered")} ${_clP10kFmt(value)}</small>`;
}

/**
 * The planned total a twin line adds its bar to: the twin's own (babies
 * self-found / mats self-gathered for the WHOLE planned qty, from
 * clTwinProfits below), or the bought headline when the
 * caller passes none.
 */
function _clTwinOf(twins, key, rowProfit) {
  const v = twins ? Number(twins[key]) : NaN;
  return Number.isFinite(v) ? v : rowProfit;
}

/**
 * What ONE breeding cycle stops paying under each Profit / 10k Focus twin,
 * read off its own shopping lines (_clBreedingMats in js/craft-list-extractors.js) (so it can never disagree with the list's
 * cost) and grossed up by the buy-side setup fee the row charges on them:
 *
 *   self      the BABY line — babies self-found, everything else bought
 *   gathered  the FEED line and the RRR-eligible saddler mats (leather) —
 *             babies still bought, gatherable mats self-gathered
 *
 * The two are separate plans, never stacked.
 */
function clBreedingSavings(row, mats) {
  const fee = 1 + ((typeof SETUP_FEE === "number") ? SETUP_FEE : 0);
  const babyId = row.item && row.item.babyId;
  const feedId = row.feed && row.feed.id;
  let self = 0, gathered = 0;
  (mats || []).forEach((m) => {
    const cost = (Number(m.count) || 0) * (Number(m.perUnit) || 0);
    if (m.matId === babyId) self += cost;
    else if (m.matId === feedId) gathered += cost;
    else if (typeof isRrrEligible !== "function" || isRrrEligible(m.matId)) gathered += cost;
  });
  return { self: self * fee, gathered: gathered * fee };
}

/** A mounts row's savings for the funded and the base-rate shopping lines; null off breeding. */
function clTwinSavings(row, mats, matsNoFocus) {
  if (!row || !row.isBreeding) return null;
  return { on: clBreedingSavings(row, mats), off: clBreedingSavings(row, matsNoFocus) };
}

/**
 * The planned totals the two dimmed Profit / 10k Focus lines add their bar to
 * (patchPer10kCell / refreshPer10kCell below), under the same funded/unfunded split as the
 * headline:
 *
 *   self      every planned baby self-found: the headline plus each unit's
 *             baby cost (breeding rows only — no other row has a "self-found")
 *   gathered  every gatherable mat self-gathered: a breeding row's headline
 *             plus each unit's feed + leather cost (babies still bought); any
 *             other row's own self-gathered twin × qty, the same figure its
 *             Total Profit cell prints under the headline
 *
 * Before this, both lines reused the bought headline and only swapped the bar,
 * so 1,440 planned moose read ~5M apart where the babies alone cost 336M.
 */
function clTwinProfits(extracted, split, qty, rowProfit) {
  const out = { self: rowProfit, gathered: rowProfit };
  if (!extracted) return out;
  const sv = extracted.twinSavings;
  const funded = split.fundedQty || 0;
  const unfunded = split.unfundedQty || 0;
  if (sv && sv.on && sv.off) {
    out.self = rowProfit + sv.on.self * funded + sv.off.self * unfunded;
    out.gathered = rowProfit + sv.on.gathered * funded + sv.off.gathered * unfunded;
    return out;
  }
  const unit = Number(extracted.unitProfitSelfFound);
  if (extracted.unitProfitSelfFound != null && Number.isFinite(unit)) {
    out.gathered = unit * (Number(qty) || 0);
  }
  return out;
}

/** Pure: is this a breeding row's self-found bar, i.e. a finite number? */
function _clSelfBaseOf(baseSelf) {
  if (baseSelf === null || baseSelf === undefined || baseSelf === "") return null;
  const b = Number(baseSelf);
  return Number.isFinite(b) ? b : null;
}

/**
 * Rewrite the per-10k cell of one freshly formatted source row.
 *
 * Call it while the <tr> still has the SOURCE column layout — before the list
 * grafts its own cells over `td.cell-add` — so the header index still lines up.
 * A no-op when the table has no such column, the row has no number, or the cell
 * is missing (a formatter that emits fewer cells than headers).
 *
 * `baseSelf` (optional) is a breeding row's `profitPer10kFocusSelfFound`: the
 * source formatter printed it as a dimmed "self-found" <small> under the bar,
 * which the textContent wipe below would destroy — so it is rebuilt combined
 * the same way, with the bar addend swapped to the self-bred one, and stashed
 * on the cell for the live qty path. `baseGathered` (optional) is the row's
 * `profitPer10kFocusGathered`, handled the same way for the "gathered" line.
 */
function patchPer10kCell(tr, tableId, base, rowProfit, parked, baseSelf, baseGathered, twins) {
  if (!tr || typeof tr.querySelectorAll !== "function") return false;
  const value = combinedPer10k(base, rowProfit, parked);
  if (value === null) return false;
  const at = per10kColumnIndex(tableId);
  if (at < 0) return false;
  const td = tr.querySelectorAll("td")[at];
  if (!td) return false;
  td.textContent = _clP10kFmt(value);
  if (td.classList && typeof td.classList.add === "function") td.classList.add(CL_PER10K_CLASS);
  else td.className = `${td.className || ""} ${CL_PER10K_CLASS}`.trim();
  td.setAttribute(CL_PER10K_ATTR, String(Number(base)));
  td.setAttribute("title", _clP10kTip(base, rowProfit, parked));
  // The engine caches the first tooltip it sees into data-tip, so a stale one
  // would survive every later repaint of this row.
  if (typeof td.removeAttribute === "function") td.removeAttribute("data-tip");
  const selfBase = _clSelfBaseOf(baseSelf);
  if (selfBase !== null) {
    td.setAttribute(CL_PER10K_ATTR_SELF, String(selfBase));
    const small = _clSelfSmallHtml(selfBase, _clTwinOf(twins, "self", rowProfit), parked);
    if (small && typeof td.insertAdjacentHTML === "function") {
      td.insertAdjacentHTML("beforeend", small);
    }
  }
  const gatheredBase = _clSelfBaseOf(baseGathered);
  if (gatheredBase !== null) {
    td.setAttribute(CL_PER10K_ATTR_GATHERED, String(gatheredBase));
    const small = _clGatheredSmallHtml(gatheredBase, _clTwinOf(twins, "gathered", rowProfit), parked);
    if (small && typeof td.insertAdjacentHTML === "function") {
      td.insertAdjacentHTML("beforeend", small);
    }
  }
  return true;
}

/**
 * Live update while a quantity is being typed: recompute from the base stashed
 * on the cell, so the column tracks the field instead of going stale until the
 * next full repaint.
 */
function refreshPer10kCell(row, rowProfit, parked, twins) {
  if (!row || typeof row.querySelector !== "function") return false;
  const td = row.querySelector(`.${CL_PER10K_CLASS}`);
  if (!td) return false;
  const base = Number(td.getAttribute(CL_PER10K_ATTR));
  const value = combinedPer10k(base, rowProfit, parked);
  if (value === null) return false;
  // A stashed self-found base means the cell also carries the dimmed twin
  // line; rebuild the whole content so no stale combined value survives in
  // either the bought text or the line's own tooltip.
  const selfBase = _clSelfBaseOf(td.getAttribute(CL_PER10K_ATTR_SELF));
  const gatheredBase = _clSelfBaseOf(td.getAttribute(CL_PER10K_ATTR_GATHERED));
  const small = (selfBase !== null
    ? _clSelfSmallHtml(selfBase, _clTwinOf(twins, "self", rowProfit), parked) : "")
    + (gatheredBase !== null
      ? _clGatheredSmallHtml(gatheredBase, _clTwinOf(twins, "gathered", rowProfit), parked) : "");
  if (small) td.innerHTML = _clP10kFmt(value) + small;
  else td.textContent = _clP10kFmt(value);
  td.setAttribute("title", _clP10kTip(base, rowProfit, parked));
  if (typeof td.removeAttribute === "function") td.removeAttribute("data-tip");
  return true;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CL_PER10K_SORT,
    CL_PER10K_CLASS,
    CL_PER10K_ATTR,
    CL_PER10K_ATTR_GATHERED,
    per10kColumnIndex,
    combinedPer10k,
    clBreedingSavings,
    clTwinSavings,
    clTwinProfits,
    patchPer10kCell,
    refreshPer10kCell,
  };
}
