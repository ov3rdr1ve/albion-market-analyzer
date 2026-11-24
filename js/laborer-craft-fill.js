// The CRAFTING half of the laborer self-fill loop — the same play
// js/laborer-self-fill.js prices for gatherers, denominated in crafts.
//
//   fill the journal with the crafting fame you earn anyway → hand it to your
//   own laborer → 22h later collect the refined-resource loot AND THE SAME
//   JOURNAL BACK, empty.
//
// WHY NOT HOURS. The gathering column divides maxfame by a fame/HOUR estimate,
// which exists because gathering is a rate: swinging a pick for an hour yields a
// knowable amount of fame. Crafting has no cast time in Albion — you press the
// button and the craft resolves — so crafts/hour would be a number about the
// player's mouse, not the game. The honest denominator is the CRAFT:
//
//   crafts to fill = journal maxfame ÷ fame per craft
//
// THE FAME IS CHARGED FOR at the journal's MARGIN, exactly as on the gathering
// side: the alternative use of a point of crafting fame is filling the journal
// and SELLING it full, and that play must re-buy an empty every cycle to keep
// running. This loop never buys one — the laborer returns it — but the bill
// measures the alternative, not this loop's outgoings. The whole-full-sale
// reading survives as the pessimistic bound in the `*Full` fields, reported and
// never ranked. See getJournalFameBill (js/journal-fame-price.js).
//
// RANKING IS SILVER PER CRAFT — the play's own denominator, and the only one
// these rows have. It used to be silver per point of journal FAME, chosen so the
// crafting and gathering halves of the column would share a unit. They never
// really did: a point of fame is not one unit even among the gathering tiers
// (js/laborer-self-fill.js explains why), so the shared unit was an illusion
// that mis-ranked both halves. The two halves now each rank in their own unit
// and are BANDED rather than merged in the sort (js/laborer-journal-play.js).
// `profitPerCycle` (what one journal pays the laborer) and `silverPerFame` are
// both still computed and shown; neither ranks.
//
// A TRAP SPECIFIC TO THIS SIDE. On the gathering side a low-tier journal fills
// faster, so "many small journals" is a real play. Here it is not: fame per
// craft scales HARDER than journal maxfame (CRAFT_BASE_FAME_MULT is ×1395 at T8
// against ×270 at T6, on a similar material count), so a T8 crafting journal
// fills in FEWER presses than a T6 one — 2.5 against 3.1 for the Toolmaker —
// and pays far more per journal. There is no quantity trade to make; the tiers
// differ only in how well they monetise a point of fame. Regression-tested.
//
// FILL WINDOW: there isn't one. A crafting journal is filled only by crafts of
// its OWN tier (items.xml <craftitemfame><validitem> lists same-tier ids), so
// unlike the gathering journals there is no ±2 window to search — the candidate
// craft is pinned by the journal tier, and the only search is over journal tiers
// the laborer can hold. See [[project_craft_journal_fill_from_itemsxml]].
// The corollary worth stating outright, because it is the first thing anyone
// assumes: crafting T8 gear does NOT fill a T3 journal faster, it does not fill
// it at all. The low-tier play exists only as "craft at T3 to fill T3 journals",
// so the craft tier moves with the journal tier and the two cannot be traded off.
//
// The craft named per tier is the FASTEST filler — the one with the most
// non-artifact materials, since crafting fame is (material count × a per-tier
// multiplier). Enchanted crafts fill the same-tier journal faster still
// (enchant raises the effective fame tier), but they are deliberately not
// searched: the cell should quote a craft anyone can make.

// Gear catalogue to scan. GEAR_RECIPES is filtered to T4+ for the Crafting
// table; the T2/T3 journals need the unfiltered list, so prefer it when the
// browser has loaded js/gear.js.
function _lcfRecipes() {
  if (typeof GEAR_RECIPES_ALL !== "undefined") return GEAR_RECIPES_ALL;
  if (typeof GEAR_RECIPES !== "undefined") return GEAR_RECIPES;
  return [];
}

// Materials that award crafting fame — artifacts do not. Same classifier
// js/laborer-journal-value.js uses, and the same pattern fallback for Node.
function _lcfFameMats(materials) {
  const isArtifact = (matId) =>
    typeof isNonReturnableCraftMat === "function"
      ? isNonReturnableCraftMat(matId)
      : /ARTEFACT|QUESTITEM_TOKEN|_FACTION_|UNIQUE_GVGTOKEN|_FARM_|_MOUNT_|ALCHEMY_RARE/.test(matId);
  let n = 0;
  (materials || []).forEach((m) => { if (!isArtifact(m.matId)) n += m.count; });
  return n;
}

// slug|tier → fastest-filling craft, built once. The Laborers table asks for
// this 4 laborers × 7 tiers × 7 rows deep, and the catalogue is thousands of
// recipes; without the index that is a full scan per cell.
let _lcfIndex = null;
function _lcfBuildIndex() {
  const index = {};
  if (typeof getCraftJournalForItem !== "function") return index;
  _lcfRecipes().forEach((item) => {
    const hit = getCraftJournalForItem(item.id);
    if (!hit || !hit.maxfame) return;
    // Base (unenchanted) crafts only — an @n id would fill the same journal at a
    // higher effective fame tier, which is a different, gated play.
    if (/@\d+$/.test(item.id)) return;
    const mats = _lcfFameMats(item.materials);
    if (mats <= 0) return;
    const famePerCraft = (typeof getCraftingFamePerCraft === "function")
      ? getCraftingFamePerCraft(item, mats, 0) : 0;
    if (!(famePerCraft > 0)) return;
    const key = `${hit.slug}|${hit.tier}`;
    const prev = index[key];
    if (prev && prev.famePerCraft >= famePerCraft) return;
    index[key] = {
      itemId: item.id,
      itemName: item.name || item.id,
      matCount: mats,
      famePerCraft,
      maxfame: hit.maxfame,
      crafts: (typeof getCraftsToFillJournal === "function")
        ? getCraftsToFillJournal(famePerCraft, hit.maxfame)
        : hit.maxfame / famePerCraft,
    };
  });
  return index;
}

/**
 * The craft that fills a `slug` journal of `tier` in the fewest presses.
 * Returns null when the slug is not a crafting journal, the tier has no journal
 * (T1), or no recipe in the catalogue fills it.
 */
function getCraftFillCandidate(slug, tier) {
  if (!slug || !(tier > 0)) return null;
  if (!_lcfIndex) _lcfIndex = _lcfBuildIndex();
  const hit = _lcfIndex[`${slug}|${tier}`];
  return hit ? { ...hit } : null;
}

/**
 * The best self-fill play for one CRAFTING laborer row.
 *
 * Mirrors computeLaborerSelfFill's contract so the shared cell can render either
 * without knowing which it got: always returns an object, `found` false carries a
 * `reason` of "no-spec" | "not-a-craft-journal" | "no-craft-data" | "no-price-data".
 * `kind` is "craft", against the gathering path's "gather".
 */
function computeLaborerCraftFill({ spec, marketData, city, laborerTier, onlyTier } = {}) {
  const none = (reason) => ({
    found: false, kind: "craft", reason, journalTier: null, crafts: 0, payout: 0,
    profitPerCycle: 0,
    silverPerFame: 0, silverPerCraft: 0, famePerCraft: 0, itemId: null, itemName: null,
    yield: 1, city: null, candidateTiers: [],
    famePrice: 0, fameCost: 0, netPayout: 0, netSilverPerCraft: 0, netSilverPerFame: 0,
    famePriced: false, fameBasis: "none",
    fameCostFull: 0, netPayoutFull: 0, netSilverPerCraftFull: 0, netSilverPerFameFull: 0,
  });

  const slug = spec && spec.journalSlug;
  if (!slug || !city) return none("no-spec");
  const craftSlugs = (typeof CRAFT_JOURNAL_SLUGS !== "undefined") ? CRAFT_JOURNAL_SLUGS : [];
  if (!craftSlugs.includes(slug)) return none("not-a-craft-journal");

  const tiers = (typeof LABORER_TIERS !== "undefined") ? LABORER_TIERS : [2, 3, 4, 5, 6, 7, 8];
  const candidates = [];
  tiers.forEach((t) => {
    // A laborer can never take a journal above its own tier.
    if (laborerTier != null && t > laborerTier) return;
    if (onlyTier != null && t !== onlyTier) return;
    const craft = getCraftFillCandidate(slug, t);
    if (!craft) return;
    candidates.push({ tier: t, craft });
  });
  const candidateTiers = candidates.map((c) => c.tier);
  if (candidates.length === 0) return { ...none("no-craft-data"), candidateTiers };

  // Every laborer city, not just the row's — see _selfFillCities in
  // js/laborer-self-fill.js for why the row's Route city is the wrong constraint.
  const cities = (typeof _selfFillCities === "function") ? _selfFillCities(city) : [city];

  let best = null;
  candidates.forEach(({ tier, craft }) => {
    cities.forEach((c) => {
      // The payload is the laborer's, not the crafter's — same revenue model the
      // row's own Profit / Cycle uses, so the two can never disagree about what a
      // journal returns. No journal is bought or sold here, so nothing else enters.
      const payout = (typeof laborerSelfFillPayout === "function")
        ? laborerSelfFillPayout(spec, marketData, c, tier, laborerTier)
        : { revenue: 0, hasData: false, yield: 1 };
      if (!payout.hasData) return;
      // What this tier's crafting fame could have sold for: the same market bill
      // the gathering side quotes (js/journal-fame-price.js) — the journal's
      // MARGIN, because the alternative play sells it full and re-buys an empty
      // to run again — priced IN THE CITY THE PAYLOAD IS EARNED IN, so it is not
      // a cross-city arbitrage measured against single-city revenue.
      // `bill.full` is the same journal liquidated, kept as the bound.
      const bill = (typeof getJournalFameBill === "function")
        ? getJournalFameBill({ slug, tier, maxfame: craft.maxfame, marketData, cities: [c] })
        : { pricePerFame: 0, cost: 0, hasData: false, basis: "none", full: { cost: 0 } };
      const fameCost = bill.cost || 0;
      const fameCostFull = (bill.full && bill.full.cost) || 0;
      // Ranked on silver per CRAFT — this side's own unit, and GROSS: the loop
      // buys no journal, so the payload IS the profit and it cannot be negative.
      // Same tie rules as computeLaborerSelfFill: strict `>` over ascending tiers
      // so the lower journal keeps a tie, and the caller's city leads `cities` so
      // a cross-city tie does not wander.
      const silverPerFame = payout.revenue / craft.maxfame;
      const silverPerCraft = craft.crafts > 0 ? payout.revenue / craft.crafts : 0;
      const netPayout = payout.revenue - fameCost;
      const netSilverPerCraft = craft.crafts > 0 ? netPayout / craft.crafts : 0;
      const netPayoutFull = payout.revenue - fameCostFull;
      if (!best || silverPerCraft > best.silverPerCraft) {
        best = {
          journalTier: tier,
          city: c,
          crafts: craft.crafts,
          famePerCraft: craft.famePerCraft,
          maxfame: craft.maxfame,
          itemId: craft.itemId,
          itemName: craft.itemName,
          matCount: craft.matCount,
          payout: payout.revenue,
          yield: payout.yield,
          // Reported, never ranked: this play measured AGAINST selling the
          // journal full instead. May be negative, which says the market pays
          // more for the journal than the laborer pays for its contents.
          netPayout,
          netSilverPerCraft,
          netSilverPerFame: craft.maxfame > 0 ? netPayout / craft.maxfame : 0,
          famePrice: bill.pricePerFame,
          fameCost,
          famePriced: !!bill.hasData,
          fameBasis: bill.basis,
          // The pessimistic bound — fame charged at the WHOLE full sale, journal
          // never replaced. Reported in the tooltip, never ranked.
          fameCostFull,
          netPayoutFull,
          netSilverPerCraftFull: craft.crafts > 0 ? netPayoutFull / craft.crafts : 0,
          netSilverPerFameFull: craft.maxfame > 0 ? netPayoutFull / craft.maxfame : 0,
          // THE RANKED FIGURES, and the face of the cell. See the module header.
          silverPerCraft,
          silverPerFame,
          profitPerCycle: payout.revenue,
        };
      }
    });
  });
  if (!best) return { ...none("no-price-data"), candidateTiers };

  return { found: true, kind: "craft", reason: null, candidateTiers, ...best };
}

// ── the cell ──────────────────────────────────────────────────────────────

// "2.6 crafts" / "214 crafts" — a fraction below ten, because a T8 journal
// really does fill in under three presses and "3 crafts" would round away the
// only interesting digit.
function formatCraftCount(crafts) {
  if (!(crafts > 0)) return "";
  if (crafts < 10) return `${crafts.toFixed(1)}`;
  return `${Math.round(crafts).toLocaleString()}`;
}

function _lcfSilver(n) {
  return (typeof formatSilver === "function") ? formatSilver(n) : Math.round(n).toLocaleString();
}

// The three-line body of a crafting row's self-fill cell — the same shape as
// selfFillLines() in js/laborer-self-fill.js, with the craft count standing in
// for that side's fame-to-fill: how well the journal monetises a point of your
// fame, which journal it is and what fills it, and where the payload is priced.
//
// The fill line names the tier TWICE on purpose — "T3 journal · 15 T3 crafts". A
// bare "T3 · 15 crafts" beside a T8 laborer row read as "15 of my T8 crafts",
// which is the one thing this loop cannot mean: a crafting journal only takes
// fame from crafts of its own tier.
//
// The face is the PAYLOAD per press and is never negative — nothing is bought to
// run this loop. What the journal would have fetched sold full is a comparison
// with a different play and gets its own line, same as the gathering side.
function craftFillLines({ journalTier, crafts, silverPerCraft, netSilverPerCraft, silverPerFame, famePriced, city } = {}) {
  const count = formatCraftCount(crafts);
  if (!count || !(silverPerCraft > 0)) return "";
  const perFame = silverPerFame != null && Number.isFinite(silverPerFame)
    ? ` · ${_lcfSilver(silverPerFame * 1000)} ${tx("/ 1k fame", "r_selffill_per_kfame")}`
    : "";
  const head = `<strong style="color:#1f9d55">${_lcfSilver(silverPerCraft)} ${tx("/ craft", "r_selffill_per_craft")}</strong>`;
  const fill = `<br><small style="color:#9ca3af">T${journalTier} ${tx("journal", "r_selffill_journal")} · ${count} T${journalTier} ${tx("crafts", "r_selffill_crafts")}${perFame}</small>`;
  const vs = (famePriced && netSilverPerCraft != null && Number.isFinite(netSilverPerCraft))
    ? `<br><small style="color:#9ca3af">${netSilverPerCraft >= 0
        ? tx("beats selling it by {n} / craft", "r_craftfill_beats_market").replace("{n}", _lcfSilver(netSilverPerCraft))
        : tx("sells for {n} / craft more", "r_craftfill_market_wins").replace("{n}", _lcfSilver(-netSilverPerCraft))}</small>`
    : "";
  const where = city ? `<br><small style="color:#9ca3af">${city}</small>` : "";
  return `${head}${fill}${vs}${where}`;
}

/**
 * A CRAFTING self-fill play as one tooltip string: the presses it costs, what
 * the laborer gives back, and the rate — in two sentences.
 *
 * `bestJournal` is the buy-the-filled-journal verdict — a tier, or the whole
 * `{ journalTier, profit }` when the caller has it. It is only used to name a
 * disagreeing tier; the reason the two plays disagree (the buy play can take any
 * tier at market, this one only the tier you craft at) is the module header's
 * subject, not the hover's.
 *
 * Kept to two sentences on purpose — this used to append nine, composing to
 * ~2,600 characters. tests/tooltip-runtime-length caps the composed string.
 *
 * Split out of the cell so the merged Best Journal Play column
 * (js/laborer-journal-play.js) reuses this prose verbatim.
 */
function craftFillTip(cf, bestJournal) {
  const bestTier = (bestJournal && typeof bestJournal === "object") ? bestJournal.journalTier : bestJournal;

  // "of ITS OWN tier" is the one misread worth pre-empting on the face: higher
  // crafts do not fill a lower journal faster, they do not fill it at all.
  let tip = tx("{crafts} T{tier} crafts of {item} ({fame} fame each) fill this journal; the laborer returns {payout} at {yield}% yield plus the empty journal — {rate} / craft.", "r_tip_craftfill")
    .replace("{crafts}", formatCraftCount(cf.crafts))
    .replace("{item}", cf.itemName)
    .replace("{fame}", Math.round(cf.famePerCraft).toLocaleString())
    .replace(/\{tier\}/g, cf.journalTier)
    .replace("{yield}", +((cf.yield || 1) * 100).toFixed(1))
    .replace("{payout}", _lcfSilver(cf.payout))
    .replace("{rate}", _lcfSilver(cf.silverPerCraft));

  if (cf.city) {
    tip += " " + tx("Priced in {city}.", "r_tip_selffill_city").replace("{city}", cf.city);
  }
  if (cf.famePriced) {
    tip += " " + (cf.netSilverPerCraft >= 0
      ? tx("Beats selling the journal full by {n} / craft.", "r_tip_craftfill_verdict_beats").replace("{n}", _lcfSilver(cf.netSilverPerCraft))
      : tx("Sold full it would pay {n} / craft more.", "r_tip_craftfill_verdict_loses").replace("{n}", _lcfSilver(-cf.netSilverPerCraft)));
  } else {
    tip += " " + tx("No journal margin priced, so nothing to compare it against.", "r_tip_craftfill_fame_unpriced");
  }
  if (bestTier != null && bestTier !== cf.journalTier) {
    tip += " " + tx("Buying filled names T{best} instead.", "r_tip_craftfill_vs_best")
      .replace("{best}", bestTier);
  }
  return tip;
}

/** Rendered by selfFillCell when the row's journal is a crafting one. */
function craftFillCell(cf, bestJournal) {
  return `<td class="silver-val cell-note" title="${craftFillTip(cf, bestJournal)}">${craftFillLines(cf)}</td>`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getCraftFillCandidate,
    computeLaborerCraftFill,
    formatCraftCount,
    craftFillLines,
    craftFillTip,
    craftFillCell,
  };
}
