// The laborer SELF-FILL loop — what your own gathering hours are worth when you
// fill the journal yourself instead of buying it full.
//
// The Laborers table's main model buys the journal ALREADY FULL and sells the
// empty one back, so its constraint is the laborer's 22h cycle and how fast a
// journal fills is somebody else's problem. This module prices the other play,
// the one js/laborer-journal-value.js documents:
//
//   fill your own journal with gathering fame → hand it to your laborer →
//   22h later collect the loot AND THE SAME JOURNAL BACK, empty.
//
// Three consequences, each of which has a regression test in
// tests/laborer-self-fill:
//
//  • NO JOURNAL IS EVER BOUGHT OR SOLD. One set of journals cycles forever, so
//    value per journal is the laborer's PAYLOAD ALONE. Do not reach for
//    computeBestLaborerRoute's `revenue` or `profit` here — they add the empty
//    journal's resale and subtract the filled journal's purchase, neither of
//    which happens in this loop.
//  • THE SCARCE INPUT IS YOUR GATHERING TIME, so the play is RANKED on SILVER
//    PER HOUR of it:
//        silverPerHour = payload ÷ (maxfame ÷ famePerHour)
//    Hours, not fame, because the hour is the thing you actually spend: maxfame
//    DOUBLES per tier while famePerHour rises only ~1.3-1.9× per tier, and
//    fishing runs on a different rate table from land gathering at every tier.
//    silverPerFame is still computed and still shown in the tooltip — it is the
//    honest answer to "what is one point of THIS journal's fame worth". Within
//    one row the two orders now agree (see the gathering tier below); across
//    rows they do not, and the hour is the unit that survives the comparison.
//    The CRAFTING rows next door have no hours at all and rank on silver per
//    CRAFT; the two units are not merged, they are banded (laborer-journal-play).
//  • THE WHOLE ROW IS PRICED AT ONE GATHERING TIER — the LABORER's own, or the
//    header's Gathering Tier when the user has set one (resolveLaborerGatherTier,
//    js/journal-fill-speed.js). It is emphatically NOT resolveGatherTier's
//    "match the journal's own tier": that filled the T2 candidate at T2 speed
//    and the T8 candidate at T8 speed, so one row compared plays you cannot run
//    simultaneously, and it neutralised the ±2 fill window (with
//    gatherTier == journalTier every tier passes canFillAtTier, so a T8 land
//    laborer was offered T2-T8 journals when a T8 gatherer reaches only T6-T8).
//  • THE PROFIT OF THIS PLAY CANNOT BE NEGATIVE, AND THE RANKED FIGURE IS GROSS.
//    Nothing is bought to run the loop: you gather, the laborer works, the same
//    journal comes back. Its profit is therefore the PAYLOAD, full stop, and the
//    play is ranked on payload per hour of your gathering.
//    The fame still has an alternative use — fill the journal and SELL it full,
//    which is the Journal Filling table's play — and the market's MARGIN on that
//    journal is what that use pays (getJournalFameBill, js/journal-fame-price.js).
//    The empty journal is part of that margin: this loop never buys one, but the
//    alternative sells the journal and must re-buy an empty to run again.
//    That comparison is kept and reported — the `net*` fields, and they may be
//    negative, which says "this journal is worth more sold than fed to a
//    laborer". It is NOT the play's profit, and subtracting it from the face was
//    what printed a loss on every fisherman row: fishing has the smallest
//    payload on the board and the scarcest fame per hour, so the market rightly
//    prices its journals high and the subtraction went negative at every tier.
//    `fameCostFull`/`netPayoutFull` remain the pessimistic reading of that same
//    comparison (journal liquidated, never replaced), reported in the tooltip.
//  • silverPerHour STAYS UNCAPPED at the 22h laborer cycle: every other "/h"
//    column in this app is player-time throughput, and capping would silently
//    switch the denominator to laborer-time. The cycle is reported separately as
//    capacity (how many laborers one player's fame keeps fed, or how long one
//    laborer idles). `profitPerCycle` is reported and never ranked — what one
//    journal pays the laborer is the right unit only when the LABORER is the
//    bottleneck, which is the buy-the-filled-journal play's world, not this one's.
//  • THE FILL WINDOW APPLIES HERE AND NOT NEXT DOOR. The Best Journal column can
//    buy any tier at market; this loop can only fill [G−2 … G] at your gathering
//    tier, which for a Laborers row is the laborer's own tier. The two columns
//    will routinely name different tiers — that is correct, and the cell says so
//    rather than letting it read as a bug. Fishing and the General trophy are
//    exempt from the window, so those rows still see every tier — but now all of
//    them filled at ONE fame rate, so the comparison is finally like for like.
//
// Not directly comparable to the Journal Filling table's silver/hour: that one
// consumes a bought journal every cycle, this one never does. They differ by the
// journal's amortised purchase, which tends to zero over many cycles. Do not
// "fix" one to match the other.
//
// Coverage: the six gathering journals, their six trophies and the General
// trophy have a base fame/hour estimate (data-journals.js), and are priced here
// in HOURS (`kind: "gather"`). The four crafting journals have no fame/hour rate
// — crafting has no cast time, so crafts/hour would be invented — and are handed
// to js/laborer-craft-fill.js, which prices the same loop in CRAFTS
// (`kind: "craft"`). Only the mercenary pair is left with no model at all: its
// fame is combat fame, which this repo does not model. That reports
// `reason: "no-fame-model"` so the cell can show a dash with an explanation.

const LABORER_CYCLE_HOURS = 22;

// How a fill time relates to the laborer's fixed cycle. Reported beside the
// rate, never inside it.
function selfFillCapacity(hours) {
  if (!(hours > 0)) return { laborersFed: 0, idleHours: 0 };
  return {
    laborersFed: LABORER_CYCLE_HOURS / hours,
    idleHours: Math.max(0, hours - LABORER_CYCLE_HOURS),
  };
}

// Cities this play may be priced in, the row's own city first so an exact tie
// never moves the column off the city the rest of the row talks about.
//
// WHY IT IS NOT JUST THE ROW'S CITY. The row's Route comes from
// computeBestLaborerRoute, which maximises the BUY-THE-FILLED-JOURNAL play:
// journal purchase, payload, empty resale. This loop buys and sells no journal,
// so that city is the wrong constraint — and it varies per tier, which used to
// make one laborer's column price the same journal in five different cities and
// name a different winner in each. The play is free to run wherever the payload
// sells best, so it searches, and the cell names what it picked.
function _selfFillCities(fallbackCity) {
  const list = (typeof _laborerCityCandidates === "function")
    ? (_laborerCityCandidates().cities || []) : [];
  if (!list.length) return fallbackCity ? [fallbackCity] : [];
  if (!fallbackCity || !list.includes(fallbackCity)) return list;
  return [fallbackCity, ...list.filter((c) => c !== fallbackCity)];
}

// Payload one journal returns when worked by the laborer — the same revenue
// model the Laborers table's own rows use, at the journal's tier and the yield a
// laborer of `laborerTier` gets running it (150% for any journal below its tier).
function laborerSelfFillPayout(spec, marketData, city, journalTier, laborerTier) {
  if (!spec || typeof _computeRevenueForMode !== "function") return { revenue: 0, hasData: false, yield: 1 };
  // The laborer's own slug decides which trophies reach it on an own-tier
  // journal; trophy-mode specs carry the laborer they belong to.
  const laborerSlug = (spec.laborer && spec.laborer.slug) || spec.journalSlug || null;
  const y = (typeof getLaborerJournalYield === "function")
    ? getLaborerJournalYield(journalTier, laborerTier, laborerSlug)
    : 1;
  const r = _computeRevenueForMode({ ...spec, tier: journalTier, yield: y }, marketData, city);
  return { revenue: r.revenue || 0, hasData: !!r.hasData && r.revenue > 0, yield: y };
}

/**
 * The best self-fill play for one laborer row.
 *
 * `spec` is a Laborers-table row spec (js/laborers-pricing.js) — it carries the
 * mode, the payload keys and, since this column, `journalSlug`.
 * `gatherTier` pins the gathering tier; omitted, each candidate uses the header
 * preference (resolveGatherTier — "match the journal's own tier" by default).
 * `onlyTier` prices a single journal tier instead of searching.
 * `city` is where the row itself trades — the tie-break and the fallback, not a
 * constraint: the play is priced across every laborer city (_selfFillCities).
 *
 * Always returns an object. `found` is false with a `reason` of
 * "no-spec" | "no-fame-model" | "no-fillable-tier" | "no-price-data".
 */
function computeLaborerSelfFill({ spec, marketData, city, laborerTier, gatherTier, onlyTier } = {}) {
  const none = (reason) => ({
    found: false, kind: "gather", reason, journalTier: null, hours: 0, payout: 0,
    profitPerCycle: 0, silverPerHour: 0,
    silverPerFame: 0, maxfame: 0, city: null,
    famePrice: 0, fameCost: 0, netPayout: 0, netSilverPerHour: 0, netSilverPerFame: 0,
    famePriced: false, fameBasis: "none",
    fameCostFull: 0, netPayoutFull: 0, netSilverPerHourFull: 0, netSilverPerFameFull: 0,
    laborersFed: 0, idleHours: 0, yield: 1, gatherTier: gatherTier != null ? gatherTier : null,
    candidateTiers: [],
  });

  const slug = spec && spec.journalSlug;
  if (!slug || !city) return none("no-spec");

  // Crafting journals are filled by crafting fame, which has no hours model —
  // they are priced in crafts next door. Dispatching HERE rather than in each
  // renderer is what keeps the Laborers and Building Costs tables identical.
  const craftSlugs = (typeof CRAFT_JOURNAL_SLUGS !== "undefined") ? CRAFT_JOURNAL_SLUGS : [];
  if (craftSlugs.includes(slug) && typeof computeLaborerCraftFill === "function") {
    return computeLaborerCraftFill({ spec, marketData, city, laborerTier, onlyTier });
  }

  const type = (typeof laborerSlugToGatherType === "function") ? laborerSlugToGatherType(slug) : null;
  if (type == null) return none("no-fame-model");

  const tiers = (typeof LABORER_TIERS !== "undefined") ? LABORER_TIERS : [2, 3, 4, 5, 6, 7, 8];
  // ONE gathering tier for the whole row. A Laborers row is a laborer tier, and
  // its owner gathers at their own tier — never at each candidate journal's tier,
  // which is what resolveGatherTier would give and which made a single row
  // compare plays that cannot be run at the same time. See
  // resolveLaborerGatherTier (js/journal-fill-speed.js) for the whole argument.
  const rowGatherTier = gatherTier != null
    ? gatherTier
    : ((typeof resolveLaborerGatherTier === "function")
        ? resolveLaborerGatherTier(laborerTier)
        : null);
  const candidates = [];
  tiers.forEach((t) => {
    // A laborer can never take a journal above its own tier.
    if (laborerTier != null && t > laborerTier) return;
    if (onlyTier != null && t !== onlyTier) return;
    const maxfame = (typeof getJournalMaxfame === "function") ? getJournalMaxfame(slug, t) : 0;
    const fill = resolveJournalFill({
      type, journalTier: t, maxfame,
      gatherTierOverride: rowGatherTier != null ? rowGatherTier : undefined,
    });
    if (!fill.fillable) return;
    candidates.push({ tier: t, fill, maxfame });
  });
  const candidateTiers = candidates.map((c) => c.tier);
  if (candidates.length === 0) return { ...none("no-fillable-tier"), candidateTiers };

  const cities = _selfFillCities(city);
  let best = null;
  candidates.forEach(({ tier, fill, maxfame }) => {
    cities.forEach((c) => {
      const payout = laborerSelfFillPayout(spec, marketData, c, tier, laborerTier);
      if (!payout.hasData) return;
      // What this tier's fame could have sold for, PRICED IN THE CITY THE
      // PAYLOAD IS EARNED IN. Asking once per tier across every city returned
      // the best sell and the cheapest empty from two different cities with no
      // haul between them — a free arbitrage subtracted from single-city
      // revenue, which biased the comparison against every row and flipped the
      // thinnest payload (fishing) first.
      // The bill is the journal's MARGIN: the alternative play sells it full and
      // must re-buy an empty to run again, so the empty is on that play's side
      // of the ledger even though this loop never buys one. `bill.full` is the
      // same journal liquidated and never replaced — the pessimistic reading.
      // See getJournalFameBill (js/journal-fame-price.js).
      const bill = (typeof getJournalFameBill === "function")
        ? getJournalFameBill({ slug, tier, maxfame, marketData, cities: [c] })
        : { pricePerFame: 0, cost: 0, hasData: false, basis: "none", full: { cost: 0 } };
      const fameCost = bill.cost || 0;
      const fameCostFull = (bill.full && bill.full.cost) || 0;
      // RANKED on GROSS silver per HOUR of your gathering. Gross because nothing
      // is bought to run this loop, so the payload IS the profit; per hour
      // rather than per point of fame because the tiers are filled at different
      // fame rates. Both halves of that are the module header's subject.
      // `>` and not `>=` is load-bearing twice over: tiers iterate ascending, so
      // an exact tie keeps the LOWER journal (less fame committed per cycle),
      // and the caller's city leads `cities`, so a cross-city tie stays put.
      const silverPerFame = maxfame > 0 ? payout.revenue / maxfame : 0;
      const silverPerHour = fill.hours > 0 ? payout.revenue / fill.hours : 0;
      const netPayout = payout.revenue - fameCost;
      const netSilverPerHour = fill.hours > 0 ? netPayout / fill.hours : 0;
      const netPayoutFull = payout.revenue - fameCostFull;
      if (!best || silverPerHour > best.silverPerHour) {
        best = {
          journalTier: tier,
          city: c,
          hours: fill.hours,
          gatherTier: fill.gatherTier,
          payout: payout.revenue,
          yield: payout.yield,
          // Reported, never ranked: the same play measured AGAINST selling the
          // journal full instead. Negative means the market pays more for the
          // journal than the laborer pays for its contents — a real and useful
          // fact, and not a loss.
          netPayout,
          netSilverPerHour,
          netSilverPerFame: maxfame > 0 ? netPayout / maxfame : 0,
          famePrice: bill.pricePerFame,
          fameCost,
          famePriced: !!bill.hasData,
          fameBasis: bill.basis,
          // The pessimistic bound: the same play with the fame charged at the
          // WHOLE full sale, journal never replaced. Reported, never ranked —
          // the cells quote it beside the figure above.
          fameCostFull,
          netPayoutFull,
          netSilverPerHourFull: fill.hours > 0 ? netPayoutFull / fill.hours : 0,
          netSilverPerFameFull: maxfame > 0 ? netPayoutFull / maxfame : 0,
          // THE RANKED FIGURES, and the face of the cell: the payload per hour
          // of your gathering, and per point of the fame that filled it.
          // profitPerCycle is what ONE journal pays the laborer, the right unit
          // only when the LABORER is your bottleneck — reported, never ranked.
          silverPerHour,
          silverPerFame,
          maxfame,
          profitPerCycle: payout.revenue,
        };
      }
    });
  });
  if (!best) return { ...none("no-price-data"), candidateTiers };

  return { found: true, kind: "gather", reason: null, candidateTiers, ...best, ...selfFillCapacity(best.hours) };
}

// ── the shared cell ───────────────────────────────────────────────────────

// Why the column is blank, in the user's words.
function _selfFillNoDataTip(reason) {
  if (reason === "no-fame-model") {
    return tx("Filled by combat fame — no fill model, so no rate.", "r_tip_selffill_no_model");
  }
  if (reason === "no-craft-data") {
    return tx("No craft in the catalogue fills this journal's tier.", "r_tip_selffill_no_craft");
  }
  if (reason === "no-fillable-tier") {
    return tx("No journal this laborer can hold is fillable at this row's gathering tier — a journal fills from its own tier up to two above.", "r_tip_selffill_no_tier");
  }
  return tx("Nothing this laborer would return is priced yet — run a scan.", "r_tip_selffill_no_prices");
}

function _sfSilver(n) {
  return (typeof formatSilver === "function") ? formatSilver(n) : Math.round(n).toLocaleString();
}

// "28,800 fame · 1.5 h" — the effort side of a gathering self-fill play, in both
// units it has: the fame the journal swallows, and what that costs at the
// gathering tier this row was priced at. The HOURS are what the headline is per,
// so they belong on the face; the fame is kept beside them because it is the
// number the game shows you and the one that does not move with the header's
// Gathering Tier.
function _sfFameToFill(maxfame, hours) {
  const parts = [];
  if (maxfame > 0) parts.push(`${Math.round(maxfame).toLocaleString()} ${tx("fame", "r_selffill_fame")}`);
  if (hours > 0) {
    parts.push((typeof formatFillHours === "function") ? formatFillHours(hours) : `${hours.toFixed(1)} h`);
  }
  return parts.join(" · ");
}

/**
 * The three-line body of a GATHERING self-fill cell: what an hour of your
 * gathering is worth run through this journal, which journal it is and what it
 * costs to fill, and what that implies about keeping laborers fed.
 *
 * The headline is SILVER PER HOUR of your own gathering, not per point of fame:
 * fame is not one unit across tiers (module header), so a per-fame face made a
 * T3 row read as the equal of a T8 row worth ~6.8× more per hour.
 *
 * IT IS THE PAYLOAD, AND IT IS NEVER NEGATIVE. Nothing is bought to run this
 * loop, so there is no cost that could take it below zero. What the journal
 * would have fetched sold full is a COMPARISON against a different play, and it
 * gets its own line saying so — subtracting it from the face turned "this
 * journal sells well" into "this play loses money" and painted every fisherman
 * row red.
 *
 * Deliberately still NOT fillSpeedLines() — that helper leads with the fill time
 * and is about buying a journal to resell. The Journal Filling table uses it and
 * is unaffected.
 */
function selfFillLines({ silverPerHour, netSilverPerHour, silverPerFame, famePriced, journalTier, maxfame, hours, note } = {}) {
  if (!(silverPerHour > 0)) return "";
  const head = `<strong style="color:#1f9d55">${_sfSilver(silverPerHour)} ${tx("/ h", "r_selffill_per_hour")}</strong>`;
  const effort = _sfFameToFill(maxfame, hours);
  const perFame = silverPerFame != null && Number.isFinite(silverPerFame)
    ? ` · ${_sfSilver(silverPerFame * 1000)} ${tx("/ 1k fame", "r_selffill_per_kfame")}`
    : "";
  const fill = `<br><small style="color:#9ca3af">T${journalTier} ${tx("journal", "r_selffill_journal")}${effort ? ` · ${effort}` : ""}${perFame}</small>`;
  const tail = note ? `<br><small style="color:#9ca3af">${note}</small>` : "";
  return `${head}${fill}${_selfFillVsMarketLine({ silverPerHour, netSilverPerHour, famePriced })}${tail}`;
}

// How this play stands against SELLING the journal full instead — the one thing
// the face deliberately does not carry. Grey either way: neither reading is a
// loss, they are two plays, and this line says which the market prefers.
function _selfFillVsMarketLine({ silverPerHour, netSilverPerHour, famePriced } = {}) {
  if (!famePriced || netSilverPerHour == null || !Number.isFinite(netSilverPerHour)) return "";
  const delta = silverPerHour - netSilverPerHour;
  if (!(delta > 0)) return "";
  const text = netSilverPerHour >= 0
    ? tx("beats selling it by {n} / h", "r_selffill_beats_market").replace("{n}", _sfSilver(netSilverPerHour))
    : tx("sells for {n} / h more", "r_selffill_market_wins").replace("{n}", _sfSilver(-netSilverPerHour));
  return `<br><small style="color:#9ca3af">${text}</small>`;
}

// How this play relates to the laborer's fixed cycle, in three words.
function _selfFillCapLabel(sf) {
  return sf.idleHours > 0
    ? tx("idles {hours}h", "r_selffill_idles").replace("{hours}", Math.round(sf.idleHours))
    : tx("feeds ×{n}", "r_selffill_feeds").replace("{n}", sf.laborersFed >= 10 ? Math.round(sf.laborersFed) : sf.laborersFed.toFixed(1));
}

/**
 * A GATHERING self-fill play as one tooltip string: the figures and where they
 * come from, in two sentences.
 *
 * WHY IT IS SHORT. This used to append nine sentences of rationale — why the
 * rate is per hour and not per point of fame, the cross-city argument, the
 * pessimistic bound — and composed to ~2,300 characters, ~45 lines in a 340px
 * box that ran off the screen. All of that reasoning is the module header above,
 * where it belongs; the hover states the numbers. tests/tooltip-runtime-length
 * caps the composed string.
 *
 * Split out of the cell so the merged Best Journal Play column
 * (js/laborer-journal-play.js) can reuse the prose verbatim while laying the
 * visible text out differently. Two renderings of one play must never explain
 * themselves differently.
 */
function selfFillTip(sf, bestJournal) {
  if (!sf || !sf.found) return _selfFillNoDataTip(sf && sf.reason);
  if (sf.kind === "craft" && typeof craftFillTip === "function") return craftFillTip(sf, bestJournal);

  let tip = tx("{hours} gathering at T{gather} fills this T{tier} journal; the laborer returns {payout} plus the empty journal — {rate} / h of your time.", "r_tip_selffill")
    .replace("{hours}", (typeof formatFillHours === "function") ? formatFillHours(sf.hours) : `${sf.hours.toFixed(1)} h`)
    .replace("{gather}", sf.gatherTier)
    .replace("{tier}", sf.journalTier)
    .replace("{payout}", formatSilver(sf.payout))
    .replace("{rate}", formatSilver(sf.silverPerHour));
  if (sf.city) {
    tip += " " + tx("Priced in {city}.", "r_tip_selffill_city").replace("{city}", sf.city);
  }
  tip += sf.idleHours > 0
    ? " " + tx("Slower than the 22h cycle: one laborer idles about {hours}h.", "r_tip_selffill_idle").replace("{hours}", Math.round(sf.idleHours))
    : " " + tx("Feeds about {n} laborers.", "r_tip_selffill_feeds").replace("{n}", sf.laborersFed >= 10 ? Math.round(sf.laborersFed) : sf.laborersFed.toFixed(1));
  // The other play the same fame could have run. NOT a cost of this one — see
  // the module header on why it is never subtracted from the figure above.
  if (sf.famePriced) {
    tip += " " + (sf.netSilverPerHour >= 0
      ? tx("Beats selling the journal full by {n} / h.", "r_tip_selffill_verdict_beats").replace("{n}", formatSilver(sf.netSilverPerHour))
      : tx("Sold full it would pay {n} / h more.", "r_tip_selffill_verdict_loses").replace("{n}", formatSilver(-sf.netSilverPerHour)));
  } else {
    tip += " " + tx("No journal margin priced, so nothing to compare it against.", "r_tip_selffill_fame_unpriced");
  }
  return tip;
}

/**
 * The self-fill cell, shared by the Laborers and Building Costs tables so the
 * two can never drift. `bestJournal` is what the buy-the-filled-journal play
 * decided — a tier, or the whole `{ journalTier, profit }` row object when the
 * caller has it; when the tiers differ, the cell says why.
 */
function selfFillCell(sf, bestJournal, emDash) {
  const dash = emDash || '<td class="silver-val" style="color:#6b7280;font-style:italic">—</td>';
  if (!sf || !sf.found) {
    if (!sf) return dash;
    return `<td class="cell-note" style="color:#6b7280;font-style:italic" title="${_selfFillNoDataTip(sf.reason)}">—</td>`;
  }
  // Crafting rows are counted in crafts, not hours, and have their own cell.
  if (sf.kind === "craft" && typeof craftFillCell === "function") return craftFillCell(sf, bestJournal);

  // The journal tier already leads the fill line, so the note is capacity and
  // where the payload is priced — the two things the head cannot carry.
  const note = `${_selfFillCapLabel(sf)}${sf.city ? ` @ ${sf.city}` : ""}`;
  const tip = selfFillTip(sf, bestJournal);

  return `<td class="silver-val cell-note" title="${tip}">${selfFillLines({
    silverPerHour: sf.silverPerHour,
    netSilverPerHour: sf.netSilverPerHour,
    silverPerFame: sf.silverPerFame,
    famePriced: sf.famePriced,
    journalTier: sf.journalTier,
    maxfame: sf.maxfame,
    hours: sf.hours,
    note,
  })}</td>`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    LABORER_CYCLE_HOURS,
    selfFillCapacity,
    laborerSelfFillPayout,
    computeLaborerSelfFill,
    selfFillLines,
    selfFillTip,
    selfFillCell,
    _selfFillCapLabel,
  };
}
