// What a filled journal is worth FED TO A LABORER, for the two tables that are
// otherwise only ever about selling it.
//
// The Gathering and Journal Filling tables both price one play: buy an empty
// journal, fill it with fame you were earning anyway, sell it full. That is the
// silver-per-1k-fame ranking they lead with. But a filled journal has a second
// buyer — your own laborer — and 22h later that laborer returns a payload AND
// the same journal, empty. This module prices that second play so the two can be
// read against each other on the row where the decision is actually made.
//
// It is the same loop js/laborer-self-fill.js models, seen from the other end.
// There the row is a laborer and the question is which journal to fill; here the
// row IS a journal and the question is what a laborer would pay for it. So:
//
//  • THE HEADLINE IS SILVER PER HOUR OF YOUR GATHERING, because that is the only
//    scarce input in the loop this answers: fill journals yourself, hand them to
//    laborers you have plenty of, collect the returns. The tier choice is then
//    "which journal turns an hour of my fishing into the most silver", and the
//    hours come from whatever gathering tier the caller is priced at — the header
//    preference for a Journal Filling row, the row's own tier for a Gathering row.
//    The payload PER JOURNAL stays on the face above it, because that is the unit
//    the rest of both tables speaks (margin, /1k fame) and the two rows that pay
//    the same per hour can want very different numbers of laborers.
//  • THE RATE IS GROSS, and deliberately so. The sell-it-full rate is already in
//    the Fill Speed column in the SAME unit (margin ÷ the same hours), so the two
//    plays are compared on screen rather than one being netted off the other
//    behind a single number. The net figure is in the tooltip. This is the one
//    place that differs from the Laborers table's self-fill column, which has no
//    sell rate beside it and so must net the fame itself.
//  • CAPACITY IS REPORTED, NEVER FOLDED IN. `laborersFed = 22h ÷ fill hours` is
//    what the play's "unlimited laborers" assumption actually costs — a journal
//    that fills in five minutes needs ~260 laborers to absorb one hour of your
//    fishing. It sits on the cell as a chip; it never divides the rate, or the
//    denominator would silently switch from player time to laborer time.
//  • THE LABORER IS THE BEST ONE THAT HELPS, capped at T8. Any journal below T8
//    run by a T8 laborer earns the 150% tier-advantage yield; a T8 journal gets
//    the own-tier rate its Trophy Happiness buys (getLaborerJournalYield). That
//    is the play's ceiling, and the cell names the tier and yield it assumed
//    rather than hiding it.
//  • THE COMPARISON IS AGAINST THE JOURNAL'S MARGIN — full sell net of tax, less
//    the empty the SELLING play must re-buy to fill and sell another. Feeding the
//    laborer buys no empty, and neither does this cycle of the selling play; but
//    the selling play consumes the journal, so it is one short every cycle it
//    runs, and the empty belongs on its side of the ledger. That is exactly the
//    bill getJournalFameBill charges the self-fill loops, so this column and the
//    Laborers column can never disagree about what a journal's fame is worth.
//
// `advantage` is therefore payload − that margin: positive means feed the
// laborer, negative means sell it, and the sign is what the cell colours.
// `advantageFull` is the same figure with the journal LIQUIDATED — sold full and
// never replaced — the pessimistic bound, reported in the tooltip and never
// ranked.

// Laborer tier this column assumes. Capped at the game's maximum; a lower
// laborer would only ever earn less, and the play's ceiling is the useful figure.
const JLP_LABORER_TIER = 8;

function _jlpSilver(n) {
  return (typeof formatSilver === "function") ? formatSilver(n) : Math.round(n).toLocaleString();
}

function _jlpT(en, key) {
  return (typeof tx === "function") ? tx(en, key) : en;
}

/**
 * A Laborers-table row spec for the laborer that would run this journal, or null
 * when no laborer does.
 *
 * Built from the same two spec builders the Laborers table uses
 * (js/laborers-pricing.js) so the payload model cannot fork: `_laborerJournalRowSpec`
 * for the six gathering journals, `_trophyRowSpec` for the trophy lines. The
 * mercenary pair is excluded — its payload is flat silver, not a market good, and
 * neither of these tables lists it — as are the four crafting journals, which no
 * gathering fame fills.
 */
function journalSlugToLaborerSpec(slug, tier) {
  if (!slug || !(tier > 0)) return null;
  if (typeof LABORER_MODE === "undefined") return null;

  if (slug.startsWith("TROPHY_")) {
    if (slug === "TROPHY_MERCENARY") return null;
    const line = (typeof TROPHY_LABORERS !== "undefined")
      ? TROPHY_LABORERS.find((l) => l.journalSlug === slug) : null;
    if (!line || typeof _trophyRowSpec !== "function") return null;
    return _trophyRowSpec(line, tier);
  }

  const lab = (typeof LABORERS !== "undefined")
    ? LABORERS.find((l) => l.slug === slug) : null;
  if (!lab || typeof _laborerJournalRowSpec !== "function") return null;
  // Only the resource laborers: a gathering journal's payload is raw resources.
  if (!lab.modes.includes(LABORER_MODE.RESOURCE)) return null;
  return _laborerJournalRowSpec(lab, tier, LABORER_MODE.RESOURCE);
}

// Cities this play may be priced in — the same set the self-fill loop searches,
// with the caller's city leading so an exact tie never moves the column off the
// city the rest of the row talks about.
function _jlpCities(fallbackCity) {
  if (typeof _selfFillCities === "function") return _selfFillCities(fallbackCity);
  const list = (typeof CITIES !== "undefined") ? CITIES : [];
  if (!fallbackCity) return list;
  return [fallbackCity, ...list.filter((c) => c !== fallbackCity)];
}

/**
 * What a laborer pays for one filled journal, against what the market pays.
 *
 * Always returns an object; `hasData` is false when nothing the laborer would
 * return is priced. `sellFull` is 0 when the full journal itself has no price —
 * the payload still stands on its own, and the cell says the comparison is
 * missing rather than blanking the row.
 */
function computeJournalLaborerPlay({ slug, tier, marketData, city, laborerTier } = {}) {
  const none = {
    hasData: false, payload: 0, sellFull: 0, fameCost: 0, advantage: 0,
    advantageFull: 0, fameBasis: "none", city: null,
    yield: 1, laborerTier: laborerTier || JLP_LABORER_TIER, slug: slug || null,
    tier: tier || 0, sellPriced: false,
  };
  const spec = journalSlugToLaborerSpec(slug, tier);
  if (!spec || !marketData || typeof laborerSelfFillPayout !== "function") return none;

  const lt = Math.max(tier, Math.min(laborerTier || JLP_LABORER_TIER, JLP_LABORER_TIER));
  const cities = _jlpCities(city);
  let best = null;
  cities.forEach((c) => {
    const payout = laborerSelfFillPayout(spec, marketData, c, tier, lt);
    if (!payout.hasData) return;
    // `>` over a caller-first city list: an exact tie stays on the row's city.
    if (!best || payout.revenue > best.payload) {
      best = { payload: payout.revenue, city: c, yield: payout.yield };
    }
  });
  if (!best) return none;

  // What the market pays for the same journal, IN THE CITY THE PAYLOAD IS PRICED
  // IN. The comparison is against its MARGIN — full sell net of tax, less the
  // empty the selling play must re-buy to fill and sell another. Neither play
  // buys an empty for THIS cycle (the laborer returns one), but the selling play
  // consumes the journal, so it is short one every cycle it runs. The whole sale
  // is kept as `advantageFull`, the pessimistic bound. Reusing the self-fill bill
  // keeps this column and the Laborers column in step — including the city, which
  // across the whole list would take the best sell and the cheapest empty from
  // two different places with no haul between them.
  const maxfame = (typeof getJournalMaxfame === "function") ? getJournalMaxfame(slug, tier) : 0;
  const bill = (typeof getJournalFameBill === "function")
    ? getJournalFameBill({ slug, tier, maxfame, marketData, cities: [best.city] })
    : { cost: 0, hasData: false, basis: "none", full: { cost: 0 }, fullNet: 0, fullCity: null };
  const fameCost = bill.hasData ? (bill.cost || 0) : 0;
  const sellFull = bill.hasData ? (bill.fullNet || 0) : 0;

  return {
    hasData: true,
    payload: best.payload,
    // The sale itself, for the prose — what the journal fetches if you sell it.
    sellFull,
    // The bill actually charged, and the comparison it makes.
    fameCost,
    advantage: best.payload - fameCost,
    // The bound: the same comparison with the journal liquidated and never
    // replaced. Reported, never ranked.
    advantageFull: best.payload - sellFull,
    fameBasis: bill.basis,
    city: best.city,
    yield: best.yield,
    laborerTier: lt,
    slug,
    tier,
    sellPriced: !!bill.hasData,
    sellCity: bill.fullCity || null,
  };
}

// ── the hourly view ───────────────────────────────────────────────────────

/**
 * What this play is worth per hour of the gathering that fills the journal, and
 * how many laborers that rate demands.
 *
 * `hours` is the caller's fill time — the Journal Filling table's `fillHours` at
 * the header's Gathering Tier, or the Gathering table's own row tier. Callers
 * that have no fill time (an out-of-window journal, no fame rate) pass 0 or
 * nothing, and get zeros back rather than Infinity: the cell then shows the
 * per-journal figure alone and says why the rate is missing.
 *
 * `laborersFed` is the same 22h-cycle capacity js/laborer-self-fill.js reports —
 * reused, never re-derived — and is a REPORT, not a divisor. Folding it into the
 * rate would switch the denominator from your hours to laborer-hours.
 */
function journalLaborerRate(play, hours) {
  const h = Number(hours);
  if (!play || !play.hasData || !Number.isFinite(h) || h <= 0) {
    return { perHour: 0, netPerHour: 0, netPerHourFull: 0, laborersFed: 0, hours: 0 };
  }
  const cap = (typeof selfFillCapacity === "function")
    ? selfFillCapacity(h) : { laborersFed: 22 / h };
  return {
    perHour: play.payload / h,
    // Reported, never the headline: the Fill Speed column beside this one is
    // already the sell-it-full rate in the same unit, so the comparison belongs
    // on screen rather than baked into one number.
    netPerHour: play.sellPriced ? play.advantage / h : play.payload / h,
    // The same net rate against the pessimistic bill — journal liquidated, never
    // replaced. Reported alongside, never the headline and never ranked.
    netPerHourFull: play.sellPriced ? play.advantageFull / h : play.payload / h,
    laborersFed: cap.laborersFed,
    hours: h,
  };
}

// ── the shared cell ───────────────────────────────────────────────────────

function journalLaborerTip(play, rate) {
  if (!play || !play.hasData) {
    return _jlpT("Nothing a laborer would return from this journal is priced yet — run a scan.", "r_tip_jlp_no_data");
  }
  let tip = _jlpT("Fed to a T{laborer} laborer this journal returns {payload} at {yield}% yield after 22h, and comes back empty — nothing is bought but the fame.", "r_tip_jlp_payload")
    .replace("{laborer}", play.laborerTier)
    .replace("{payload}", _jlpSilver(play.payload))
    .replace("{yield}", (play.yield * 100).toFixed(1));
  if (rate && rate.perHour > 0) {
    tip += " " + _jlpT("About {hours} of gathering fills one, so {rate} / h gross.", "r_tip_jlp_per_hour")
      .replace("{rate}", _jlpSilver(rate.perHour))
      .replace("{hours}", (typeof formatFillHours === "function") ? formatFillHours(rate.hours) : `${rate.hours.toFixed(1)} h`);
  }
  if (play.city) {
    tip += " " + _jlpT("Priced in {city}.", "r_tip_jlp_city").replace("{city}", play.city);
  }
  // The alternative play, in one clause. It is a COMPARISON, never subtracted
  // from the payload above — see the module header on why this loop cannot lose.
  if (play.sellPriced) {
    tip += " " + (play.advantage >= 0
      ? _jlpT("Beats selling it full ({sell}) by {adv}.", "r_tip_jlp_vs_sell")
      : _jlpT("Sold full it nets {sell}, which is {adv} more than feeding it.", "r_tip_jlp_vs_sell_loses"))
      .replace("{sell}", _jlpSilver(play.sellFull))
      .replace("{adv}", _jlpSilver(Math.abs(play.advantage)));
  } else {
    tip += " " + _jlpT("The full journal has no price here, so there is nothing to compare it against.", "r_tip_jlp_no_sell");
  }
  return tip.replace(/"/g, "&quot;");
}

/**
 * The Feed-a-Laborer cell, shared by the Gathering and Journal Filling tables so
 * the two can never drift.
 *
 * `opts.hours` is the caller's fill time — with it the cell leads with the
 * silver-per-hour rate this column sorts on; without it (an out-of-window
 * journal at the current Gathering Tier) it keeps the per-journal figure and says
 * the rate is unavailable rather than printing a number it cannot stand behind.
 * `opts.emDash` lets a caller supply its own dimmed cell.
 */
function journalLaborerCell(play, opts) {
  const o = (typeof opts === "string" || (opts && opts.nodeType)) ? { emDash: opts } : (opts || {});
  const dash = o.emDash || '<td class="silver-val" style="color:#6b7280;font-style:italic">—</td>';
  const rate = journalLaborerRate(play, o.hours);
  if (!play || !play.hasData) {
    if (!play) return dash;
    return `<td class="silver-val cell-note" style="color:#6b7280;font-style:italic" title="${journalLaborerTip(play, rate)}">—</td>`;
  }
  const tip = journalLaborerTip(play, rate);
  const head = `<strong>${_jlpSilver(play.payload)}</strong> <small style="color:#9ca3af">${_jlpT("/ journal", "r_jlp_per_journal")}</small>`;
  // The ranked line. Green because it is a gross rate — it cannot be negative;
  // whether it BEATS selling is the Fill Speed column's number beside it.
  const rateLine = rate.perHour > 0
    ? `<br><span style="color:#1f9d55">+${_jlpSilver(rate.perHour)}</span> <small style="color:#9ca3af">${_jlpT("/ h self-fill", "r_jlp_per_hour")}</small>`
    : `<br><small style="color:#6b7280;font-style:italic">${_jlpT("no fill rate at this gathering tier", "r_jlp_no_rate")}</small>`;
  const fed = rate.laborersFed > 0
    ? `×${rate.laborersFed >= 10 ? Math.round(rate.laborersFed) : rate.laborersFed.toFixed(1)} ${_jlpT("laborers", "r_jlp_laborers")} · `
    : "";
  const detail = `${fed}T${play.laborerTier} @${(play.yield * 100).toFixed(1)}%${play.city ? ` · ${play.city}` : ""}`;
  return `<td class="silver-val cell-note" title="${tip}">${head}${rateLine}<br><small style="color:#9ca3af">${detail}</small></td>`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    JLP_LABORER_TIER,
    journalSlugToLaborerSpec,
    computeJournalLaborerPlay,
    journalLaborerRate,
    journalLaborerTip,
    journalLaborerCell,
  };
}
