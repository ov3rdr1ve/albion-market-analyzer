// The Laborers table's "Best Journal Play" column — the two ways to work one
// laborer for one 22h cycle, side by side in a single cell.
//
//   BUY FILLED   buy a full journal at market, run it, sell the empty one back.
//                Net of the purchase. Free to pick ANY tier, because the market
//                sells all of them. (computeBestLaborerRoute, laborers-pricing.js)
//   SELF-FILL    fill a journal with fame you were going to earn anyway, run it,
//                get the same journal back empty. Nothing is bought or sold, so
//                the whole payload is profit — but the tier is pinned by what you
//                can actually fill: the ±2 gathering window, or, for a crafting
//                laborer, the tier you craft at. (laborer-self-fill.js)
//
// THE TWO ARE NOT IN THE SAME UNIT, AND MUST NOT BE. They are limited by
// different things, so "per what" differs:
//
//   BUY FILLED is limited by SILVER and market supply. You can run it as often
//     as you can afford a journal, so the meaningful figure is per journal —
//     i.e. per 22h laborer cycle. It nets its number AFTER the purchase.
//   SELF-FILL is limited by YOUR OWN EFFORT, so it is priced in the unit that
//     effort comes in: silver per HOUR of gathering for a gatherer, silver per
//     CRAFT for a crafting laborer (crafting has no cast time, so it has no
//     honest hourly rate).
//
// An earlier version forced both onto silver-per-laborer-cycle so they could be
// compared head to head. That is only the right question when laborers are your
// bottleneck. With laborers to spare the two are not rivals at all — you run
// both — and the real question is which TIER to spend your effort on. So each
// line carries its own denominator, stated on the line, and the cell no longer
// claims they are comparable.
//
// A LATER version priced self-fill per point of journal FAME, so that the
// gathering and crafting rows would at least share a unit with each other. They
// do not: a journal's fame requirement doubles per tier while a gatherer's fame
// rate rises only ~1.3-1.9× per tier, so a point of T3 fame costs about seven
// times the gathering time a point of T8 fame does, and fishing runs on a
// different rate table again. Per-fame ranked a T3 journal level with a T8 one
// worth ~6.8× more per hour. See js/laborer-self-fill.js.
//
// The column SORTS on the self-fill rate — the half your own effort controls,
// and the only one of the two every row can state (a mercenary has no fill
// model). Because the two families' rates are in different units, they are
// BANDED, not merged: see journalPlayValue.

// Silver formatter that degrades outside the browser, as everywhere else here.
function _ljpSilver(n) {
  return (typeof formatSilver === "function") ? formatSilver(n) : Math.round(n).toLocaleString();
}

function _ljpT(en, key) {
  return (typeof tx === "function") ? tx(en, key) : en;
}

/** Silver per 22h laborer cycle of the buy-the-filled-journal play, or null. */
function buyFilledValue(bestJournal) {
  if (!bestJournal || typeof bestJournal !== "object" || bestJournal.profit == null) return null;
  return bestJournal.profit;
}

/**
 * The self-fill play's PROFIT in its own unit, or null: silver per hour of
 * gathering for a gatherer, silver per craft for a crafting laborer. Null means
 * "no play", not "zero".
 *
 * It is the payload and nothing is netted off it. The loop buys no journal, so
 * it has no cost that could take it below zero; what the same fame would have
 * fetched sold full is a comparison with a DIFFERENT play, lives in the tooltip
 * and in `netSilverPerHour`, and is not this number.
 */
function selfFillValue(selfFill) {
  if (!selfFill || !selfFill.found) return null;
  const gross = selfFill.kind === "craft" ? selfFill.silverPerCraft : selfFill.silverPerHour;
  return gross > 0 ? gross : null;
}

/** The unit `selfFillValue` came back in, for the label beside the number. */
function selfFillUnit(selfFill) {
  return (selfFill && selfFill.kind === "craft")
    ? _ljpT("/ craft", "r_selffill_per_craft")
    : _ljpT("/ h", "r_selffill_per_hour");
}

/**
 * The column's sort key: the self-fill rate, BANDED by unit.
 *
 * NOT a max() of the two plays — they are in different units (see the module
 * header), so a max would be meaningless arithmetic. Nor is it a bare rate: the
 * gathering rows are silver per HOUR and the crafting rows silver per CRAFT,
 * those ranges overlap, so a single ordering would interleave them and read as a
 * head-to-head that is not being claimed. Each family is squashed into its own
 * interval instead:
 *
 *   x ↦ x/(1+|x|) is strictly increasing and lands in (−1, 1), so
 *   gathering rows → 2 + squash(silver/h)     ∈ (1, 3)
 *   crafting rows  →     squash(silver/craft) ∈ (−1, 1)
 *   no fill model  → −2, beneath both
 *
 * Descending therefore reads "best gathering play … worst, then best crafting
 * play … worst, then the rows with no model", each family ordered correctly
 * inside itself and never compared across. Ascending mirrors it.
 */
const _LJP_NO_MODEL = -2;
const _LJP_GATHER_BAND = 2;
function _ljpSquash(x) {
  return x / (1 + Math.abs(x));
}
function journalPlayValue(bestJournal, selfFill) {
  const v = selfFillValue(selfFill);
  if (v == null) return _LJP_NO_MODEL;
  const band = selfFill.kind === "craft" ? 0 : _LJP_GATHER_BAND;
  return band + _ljpSquash(v);
}

// "T8 · 28,800 fame · 1.5 h" for a gatherer, "T8 · 2.1 crafts" for a crafter —
// the fill effort in whichever unit that play actually has, always tiered so it
// can never be read as effort at some other tier. The gatherer's HOURS are on
// the face because the headline is per hour, and because they are the thing the
// fame count does not tell you: the same 28,800 fame is a very different amount
// of gathering at T3 than at T8.
function _ljpFillLabel(sf) {
  if (!sf || !sf.found) return "";
  if (sf.kind === "craft") {
    const count = (typeof formatCraftCount === "function") ? formatCraftCount(sf.crafts) : String(sf.crafts);
    return `T${sf.journalTier} · ${count} ${_ljpT("crafts", "r_selffill_crafts")}`;
  }
  const parts = [`T${sf.journalTier}`];
  if (sf.maxfame > 0) parts.push(`${Math.round(sf.maxfame).toLocaleString()} ${_ljpT("fame", "r_selffill_fame")}`);
  if (sf.hours > 0) {
    parts.push((typeof formatFillHours === "function") ? formatFillHours(sf.hours) : `${sf.hours.toFixed(1)} h`);
  }
  return parts.join(" · ");
}

// One line of the cell: silver, the unit it is in, then the play and its detail.
// The unit rides the number because the two lines are NOT in the same one.
function _ljpLine(silver, unit, label, detail, emphasise) {
  // The buy-filled line CAN be negative — that play buys a journal, so it can
  // lose money — and a loss is coloured whether or not it is the emphasised
  // line. The self-fill line buys nothing and never goes below zero.
  const loss = silver != null && silver < 0;
  const colour = loss ? "#dc2626" : "#1f9d55";
  const value = silver == null
    ? `<span style="color:#6b7280;font-style:italic">—</span>`
    : (emphasise
        ? `<strong style="color:${colour}">${_ljpSilver(silver)} ${unit}</strong>`
        : `<span style="color:${loss ? colour : "#9ca3af"}">${_ljpSilver(silver)} ${unit}</span>`);
  return `<div>${value} <small style="color:#9ca3af">${label}${detail ? ` · ${detail}` : ""}</small></div>`;
}

/**
 * The cell body: self-fill first, buy-filled beneath it.
 *
 * Self-fill leads and is the emphasised one because it is what the column sorts
 * on. The order is FIXED, unlike the earlier winner-first version — with the two
 * lines in different units there is no "winner" to promote, and a moving order
 * would imply one.
 */
function journalPlayLines(bestJournal, selfFill, laborerTier) {
  const buy = buyFilledValue(bestJournal);
  const own = selfFillValue(selfFill);
  if (buy == null && own == null) return "";

  const buyYield = (bestJournal && bestJournal.yield != null) ? +(bestJournal.yield * 100).toFixed(1) : null;
  const buyDetail = (bestJournal && bestJournal.journalTier != null)
    ? `T${bestJournal.journalTier}${buyYield != null ? ` @${buyYield}%` : ""}`
    : "";

  const ownLine = _ljpLine(own, selfFillUnit(selfFill),
    _ljpT("self-fill", "r_play_self_fill"), _ljpFillLabel(selfFill), true);
  const buyLine = _ljpLine(buy, _ljpT("/ cycle", "r_selffill_per_cycle"),
    _ljpT("buy filled", "r_play_buy_filled"), buyDetail, false);
  return `${ownLine}${buyLine}`;
}

/**
 * The merged tooltip. Both halves are the modules' own prose, verbatim
 * (bestJournalTip in js/render-laborers.js, selfFillTip in
 * js/laborer-self-fill.js which forwards crafting rows to craftFillTip) — the
 * one thing this column must not do is explain a play differently from the
 * module that computed it.
 */
function journalPlayTip(bestJournal, selfFill, laborerTier) {
  const parts = [];
  const buy = buyFilledValue(bestJournal);
  const own = selfFillValue(selfFill);

  if (buy != null && typeof bestJournalTip === "function") {
    parts.push(_ljpT("BUY FILLED:", "r_play_tip_buy_head") + " " + bestJournalTip(bestJournal, laborerTier));
  }
  if (selfFill && typeof selfFillTip === "function") {
    parts.push(_ljpT("SELF-FILL:", "r_play_tip_self_head") + " " + selfFillTip(selfFill, bestJournal));
  }

  if (buy != null && own != null) {
    // The one caveat that changes how the cell is read. WHY the units differ is
    // the module header's subject — it does not belong in a hover.
    parts.push(_ljpT("Different units: per laborer cycle vs per unit of your effort.", "r_play_tip_units"));
  } else if (buy == null && own != null) {
    parts.push(_ljpT("No filled journal is priced, so only the self-fill play has a figure.", "r_play_tip_no_buy"));
  }
  // No "only the buy play has a figure" sentence when own == null: selfFillTip
  // has already said WHY there is no rate, and saying it twice was most of what
  // made this tooltip long.
  return parts.join(" ").replace(/"/g, "&quot;");
}

/**
 * The Best Journal Play cell. `bestJournal` is the row's buy-the-filled-journal
 * verdict (`{ journalTier, yield, profit, sameTierProfit }`), `selfFill` the
 * self-fill one (js/laborer-self-fill.js). Either may be null.
 */
function journalPlayCell(bestJournal, selfFill, laborerTier) {
  const body = journalPlayLines(bestJournal, selfFill, laborerTier);
  if (!body) {
    return '<td class="silver-val" style="color:#6b7280;font-style:italic">—</td>';
  }
  return `<td class="silver-val cell-play" title="${journalPlayTip(bestJournal, selfFill, laborerTier)}">${body}</td>`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    buyFilledValue,
    selfFillValue,
    selfFillUnit,
    journalPlayValue,
    journalPlayLines,
    journalPlayTip,
    journalPlayCell,
  };
}
