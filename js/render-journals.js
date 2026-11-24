/**
 * Journal Filling — which journal tier + type pays best to fill while gathering.
 *
 * While gathering you earn base fame, which passively fills any journal you
 * carry. Buy an EMPTY journal, fill it with fame you'd earn anyway, sell the
 * FULL one: profit per journal = full_sell_net − empty_buy, and the binding
 * constraint is FAME (each tier's `maxfame`). So the ranking metric is
 * silver-per-fame; the Gathering table also turns it into an "extra silver/hour"
 * using an estimated base-fame/hour (data-journals.js).
 *
 * This module exposes two things:
 *   • pickBestJournal(...)         — the single best journal a Gathering row can
 *     fill (respecting the ±2-tier fill window), used by render-gathering.js.
 *   • renderJournalFillingTable(…) — a standalone companion table listing every
 *     gathering/trophy journal × tier ranked by Silver / 1k Fame, so you can
 *     scan exactly which tier wins.
 *
 * Pricing mirrors the Gathering table: full journal via findBestSellCity, empty
 * via findBestBuyCity, order-type & Black/Red-Zone section split honoured. The
 * pure per-journal math is calcJournalEconomics (calculations.js); the catalogue
 * + fame/hour tunables are in data-journals.js.
 */

// Human label for a journal kind (used in the Type column + tooltips).
const JOURNAL_KIND_LABEL = { gathering: "Gathering", trophy: "Trophy", general: "General" };

// Price one candidate journal across a section's cities and fold in the
// per-fame economics. `type`/`gatherTier` only set the estimated base-fame/hour
// (used for extra-silver/hour); they don't affect the silver-per-fame ranking.
//
// A journal row is a SALE (the full journal) and a PURCHASE (the empty one), and
// the two Pricing Model toggles move independently — so `minVol` gates the sale
// and `minVolBuy` the purchase. It defaults to `minVol`, keeping every caller
// that still passes one number on the old linked behaviour.
function priceJournalCandidate(marketData, cand, sellCities, buyCities, minVol, type, gatherTier, minVolBuy = minVol) {
  const full = findBestSellCity(marketData, cand.fullId, sellCities, minVol);
  const empty = findBestBuyCity(marketData, cand.emptyId, buyCities, minVolBuy);
  const baseFamePerHour = (typeof getBaseFamePerHour === "function" && type != null)
    ? getBaseFamePerHour(type, gatherTier) : 0;
  const econ = calcJournalEconomics({
    emptyCost: empty.price || 0,
    fullGross: full.price || 0,
    maxfame: cand.maxfame,
    baseFamePerHour,
  });
  return {
    ...cand,
    fullCity: full.city, fullGross: full.price || 0,
    emptyCity: empty.city, emptyCost: empty.price || 0,
    baseFamePerHour,
    ...econ, // fullNet, marginPerJournal, silverPerFame, extraSilverPerHour
    priced: (full.price || 0) > 0 && (empty.price || 0) > 0,
  };
}

// Highest silver-per-fame among priced, profitable candidates (null if none).
function bestOfCandidates(marketData, cands, sellCities, buyCities, minVol, type, gatherTier, minVolBuy = minVol) {
  let best = null;
  for (const cand of cands) {
    const p = priceJournalCandidate(marketData, cand, sellCities, buyCities, minVol, type, gatherTier, minVolBuy);
    if (!p.priced || p.marginPerJournal <= 0) continue;
    if (!best || p.silverPerFame > best.silverPerFame) best = p;
  }
  return best;
}

/**
 * Best journal to fill while gathering profession `type` at `gatherTier`,
 * restricted to the tiers that activity can actually fill ([max(2,T-2)..T] —
 * a journal fills from its tier up to +2 higher). Highest silver-per-fame among
 * priced, profitable candidates. Returns null when nothing is priced/profitable
 * (e.g. tracking, or a thin market).
 */
function pickBestJournal(marketData, type, gatherTier, sellCities, buyCities, minVol, minVolBuy = minVol) {
  const cands = (typeof getJournalCandidates === "function")
    ? getJournalCandidates(type, gatherTier) : [];
  return bestOfCandidates(marketData, cands, sellCities, buyCities, minVol, type, gatherTier, minVolBuy);
}

/**
 * Globally best journal for profession `type` across ALL tiers (ignoring the
 * fill window). Lets the Gathering column flag when a lower tier ranks higher
 * per fame than the one you can fill at the current gathering tier — matching
 * the companion table's ranking. gatherTier only sets the (unused-for-ranking)
 * base-fame/hour estimate.
 */
function pickGlobalBestJournal(marketData, type, gatherTier, sellCities, buyCities, minVol, minVolBuy = minVol) {
  const cands = (typeof getProfessionJournalCandidates === "function")
    ? getProfessionJournalCandidates(type) : [];
  return bestOfCandidates(marketData, cands, sellCities, buyCities, minVol, type, gatherTier, minVolBuy);
}

function renderJournalFillingTable(marketData) {
  const orderType = (side) => (typeof getOrderType === "function") ? getOrderType(side) : "market";
  const minVol = orderType("sell") === "market" ? 25 : 0;
  const minVolBuy = orderType("buy") === "market" ? 25 : 0;

  const sections = isBlackRedZoneEnabled()
    ? [{ name: undefined, sellCities: SELL_CITIES }]
    : [
        { name: "royal", sellCities: ROYAL_CITIES },
        { name: "caerleon", sellCities: ["Caerleon", "Black Market"] },
      ];

  const catalogue = getAllJournalRows();
  const rows = [];

  sections.forEach(({ name: sectionName, sellCities }) => {
    catalogue.forEach((cand) => {
      // The Fill Speed column prices the fame/hour at the header's Gathering
      // Tier ("Match journal tier" by default, which is what this table used
      // before the column existed). The per-fame headline is unaffected — the
      // rate only scales extraSilverPerHour.
      const gatherTier = (typeof resolveGatherTier === "function")
        ? resolveGatherTier(cand.tier) : cand.tier;
      const p = priceJournalCandidate(marketData, cand, sellCities, sellCities, minVol, cand.type, gatherTier, minVolBuy);
      const fill = (typeof resolveJournalFill === "function")
        ? resolveJournalFill({
            type: cand.type, journalTier: cand.tier,
            maxfame: cand.maxfame, gatherTierOverride: gatherTier,
          })
        : { gatherTier, hours: 0, fillable: false, reason: null };
      const dailyVol = (typeof getOverrideVolume === "function"
        ? getOverrideVolume(cand.fullId, p.fullCity)
        : null) ?? (marketData[cand.fullId]?.[p.fullCity]?.volume_24h || 0);
      // The other buyer for a filled journal: your own laborer. Same loop the
      // Laborers table ranks, priced per journal here (js/journal-laborer-payload.js).
      const laborerPlay = (typeof computeJournalLaborerPlay === "function")
        ? computeJournalLaborerPlay({
            slug: cand.slug, tier: cand.tier, marketData,
            city: p.fullCity || sellCities[0],
          })
        : null;
      rows.push({
        ...p,
        section: sectionName,
        name: p.label,
        typeLabel: JOURNAL_KIND_LABEL[p.kind] || p.kind,
        fameToFill: p.maxfame,
        journalMargin: p.marginPerJournal,
        silverPer1kFame: p.silverPerFame * 1000,
        fillHours: fill.hours,
        fillGatherTier: fill.gatherTier,
        fillable: fill.fillable,
        fillReason: fill.reason,
        // Sort key. A journal you cannot fill at this gathering tier earns
        // nothing per hour, so it sorts to the bottom rather than nowhere.
        journalFillPerHour: (fill.fillable && p.priced && p.marginPerJournal > 0)
          ? p.extraSilverPerHour : 0,
        laborerPlay,
        // Sort keys. An unpriced payload scores 0 rather than sinking the row
        // below journals that genuinely pay a laborer nothing.
        laborerPayload: (laborerPlay && laborerPlay.hasData) ? laborerPlay.payload : 0,
        laborerAdvantage: (laborerPlay && laborerPlay.hasData && laborerPlay.sellPriced)
          ? laborerPlay.advantage : 0,
        // The column's own sort key: payload per hour of the gathering that
        // fills it, at the header's Gathering Tier. A journal that tier cannot
        // fill earns nothing per hour, so it scores 0 and sinks — same rule as
        // journalFillPerHour above, which is the sell-it-full rate over the very
        // same hours.
        laborerPerHour: (fill.fillable && laborerPlay && laborerPlay.hasData && fill.hours > 0)
          ? laborerPlay.payload / fill.hours : 0,
        dailyVol,
        hasOverride: (typeof getOverridePrice === "function")
          && getOverridePrice(cand.fullId, p.fullCity) !== null,
      });
    });
  });

  renderTableData("journal-filling-table", rows, (row) => {
    const rowKey = getRowKey(row, "journal-filling-table");
    const dim = '<span style="color:#6b7280;font-style:italic">—</span>';

    const marginCell = row.priced
      ? `<span class="${row.journalMargin > 0 ? "" : "loss"}" style="${row.journalMargin > 0 ? "" : "color:#9e5858"}">${formatSilver(row.journalMargin)}</span>`
      : dim;
    const per1kCell = row.priced && row.journalMargin > 0
      ? `<b>${formatSilver(row.silverPer1kFame)}</b>`
      : dim;
    const per1kClass = getProfitClass(row.priced && row.journalMargin > 0 ? 25 : -1);

    const typeTip = row.kind === "general"
      ? tx("General Trophy journal — fills from ANY fame you earn, so it competes with the profession journal for the same fame.", "r_tip_journal_general")
      : row.kind === "trophy"
      ? tx("{profession} journal — fills from this profession's fame; turned into a Trophy by a laborer. Needs more fame than the resource journal but often sells for more.", "r_tip_journal_trophy")
          .replace("{profession}", row.label)
      : tx("{profession} resource journal — fills from this profession's fame; turned into raw resources by a laborer.", "r_tip_journal_resource")
          .replace("{profession}", row.label);
    const per1kTip = tx("All-in silver per 1,000 base fame = (full sell after 6.5% tax − empty buy) ÷ fame-to-fill × 1,000. Fame is the constraint, so this is the ranking number.", "r_tip_silver_per_1k_fame");
    const fameTip = tx("Base fame needed to fill this journal (items.xml maxfame). Only base fame counts — premium bonus fame does not fill journals.", "r_tip_fame_to_fill");

    // Fill Speed / Max Profit — the half the per-fame ranking leaves out. Hours
    // come from the header's Gathering Tier, and the rate is the SAME
    // extraSilverPerHour calcJournalEconomics already returns (margin ÷ hours),
    // so the two lines can never disagree.
    const fillCell = _journalFillCell(row);
    // The alternative buyer, in the per-journal unit the rest of this table uses.
    const laborerCell = (typeof journalLaborerCell === "function")
      ? journalLaborerCell(row.laborerPlay, { hours: row.fillable ? row.fillHours : 0 })
      : '<td class="silver-val">—</td>';

    return `
    <tr data-row-key="${rowKey}">
      ${addTdForKey("journal-filling-table", rowKey)}
      <td class="cell-item">${row.name} <small style="color:#9ca3af" title="${typeTip}">[${row.typeLabel}]</small></td>
      <td>T${row.tier}</td>
      <td title="${typeTip}">${row.typeLabel}</td>
      ${priceTd(row.emptyCost, row.emptyId, row.emptyCity, "buy", "silver-val", true)}
      ${priceTd(row.fullGross, row.fullId, row.fullCity, "sell", "silver-val", true)}
      <td class="silver-val">${marginCell}</td>
      <td title="${fameTip}">${row.fameToFill.toLocaleString()}</td>
      <td class="silver-val ${per1kClass}" title="${per1kTip}">${per1kCell}</td>
      ${fillCell}
      ${laborerCell}
    </tr>`;
  });
}

// The Fill Speed / Max Profit cell. Rows the current Gathering Tier cannot fill
// get an em-dash naming the reason rather than a misleading number — a T8
// gatherer genuinely cannot put fame into a T5 journal.
function _journalFillCell(row) {
  const dim = '<span style="color:#6b7280;font-style:italic">—</span>';
  if (!row.fillable) {
    let tip;
    if (row.fillReason === "out-of-window") {
      const lo = Math.max(2, row.fillGatherTier - 2);
      tip = tx("Gathering at T{gather} fills only T{lo}–T{gather} journals, and this one sits outside that window.", "r_tip_fill_out_of_window")
        .replace(/\{gather\}/g, row.fillGatherTier)
        .replace("{lo}", lo);
    } else if (row.fillReason === "no-fame-schedule") {
      tip = tx("No fame schedule for this journal, so there is no fill time to estimate.", "r_tip_fill_no_schedule");
    } else {
      tip = tx("No base fame/hour estimate exists for the fame that fills this journal.", "r_tip_fill_no_rate");
    }
    return `<td class="cell-note" title="${tip}">${dim}</td>`;
  }
  const tip = tx("About {hours} of gathering at T{gather} fills this journal ({fame} base fame at ~{rate} fame/h). Margin ÷ that time is the silver/hour shown.", "r_tip_fill_speed")
    .replace("{hours}", formatFillHours(row.fillHours))
    .replace("{gather}", row.fillGatherTier)
    .replace("{fame}", row.fameToFill.toLocaleString())
    .replace("{rate}", Math.round(row.baseFamePerHour).toLocaleString());
  const rate = row.priced ? row.extraSilverPerHour : null;
  return `<td class="silver-val cell-note" title="${tip}">${fillSpeedLines({ hours: row.fillHours, ratePerHour: rate })}</td>`;
}
