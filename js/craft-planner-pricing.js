// Crafting Planner — end-to-end economics for the "refine the ladder, craft the
// top item" vertical. A thin orchestration over the existing refining-chain
// pricing (getRefiningSourcing / pickCheapestFocusTier) and the same craft-route math
// the Crafting table uses, with two additions: crafting-journal fill value and a
// single best place to spend focus across the whole chain.
//
// Per-row model (focus-OFF cost basis; focus is a single most-profitable play):
//   1. Source each recipe material at the CHEAPER of buy-the-bar vs refine-it-
//      yourself (getRefiningSourcing, recursive up T3→T8). Refining profit shows
//      up as a lower input cost — `refineSavings` reports it vs all-market.
//   2. Craft cost = Σ sourced × count×(1−craftRRR) × (1+setup) + station fee.
//      Revenue = best zone-valid sell × (1−tax). craftProfit = revenue − cost.
//   3. Journal fill = crafting fame per craft × best journal silver-per-fame
//      (the crafting journal the profession fills, ±2-tier window).
//   4. combinedProfit = craftProfit + journal fill.
//   5. Focus buys extra RRR at exactly ONE place, and the place chosen is the one
//      that makes the END PRODUCT's profit highest: bestFocusStep is the winner of
//      re-pricing the row once per candidate — focus on the craft step, or focus on
//      refining one material the craft uses (cheapest ladder tier). Every candidate
//      feeds this craft; refining a material to SELL is a different business and is
//      not a candidate. With "Use Focus" on, the headline applies focus to that
//      single winning play only. The candidates are scored and ranked by the shared
//      standard in js/focus-play.js, the same one every other table's Silver/Focus
//      and Best Focus column now uses.
//
// Pure-ish: depends only on the same globals the Crafting/Refining tables use,
// so it is unit-testable with a stub sandbox (tests/craft-planner-pricing).

// Every chain this file builds opts into both raw-side substitutions: unlike the
// Refining / Transports table, the planner has no row-level raw of its own, so
// the chain is the ONLY place it can buy a cheaper node and transmute it up, or
// spend a faction heart on one of the raw units. Transmute is also the only way
// an enchanted material gets there at all — a refined id (T6_PLANKS_LEVEL2@2)
// doesn't transmute, the raw below it does. The heart applies at the chain's ROOT
// refine only. See _refineRawSourcing and buildRefiningChain in
// js/refining-chain-pricing.js.
const CP_CHAIN_OPTS = { transmuteRaw: true, heartRaw: true };

/**
 * The chain options for one row, including the table's Buy City pick.
 *
 * The pick is a scope, not a preference: while it is active every material this
 * row buys comes from that city (js/table-sell-city.js effectiveBuyCities), and
 * a pick the craft city cannot source from leaves an EMPTY pool, so the row
 * finds no material and falls through to its no-data branch rather than quietly
 * buying somewhere else.
 *
 * With no pick the returned object is CP_CHAIN_OPTS itself — same identity, same
 * numbers — so every other caller of the refining chain is untouched.
 */
function _cpChainOpts(craftCity) {
  if (typeof getTableBuyCity !== "function" || typeof effectiveBuyCities !== "function") {
    return CP_CHAIN_OPTS;
  }
  if (!getTableBuyCity("craft-planner-table")) return CP_CHAIN_OPTS;
  return {
    ...CP_CHAIN_OPTS,
    buyCities: effectiveBuyCities("craft-planner-table", craftCity, CITIES),
  };
}

// Artifact-style mats are consumed in full (no craft RRR return), bill no
// station-fee nutrition, and never count toward crafting fame. Mirrors
// isNonReturnableCraftMat in render-crafting.js — which documents why
// _SKILLBOOK_STANDARD and _MOUNTUPGRADE_ are spelled out rather than widened.
// The planner needs no combine-base patterns: it renders no combine rows.
//
// _SKILLBOOK_STANDARD is the Tome of Insight in the T4-T8 Satchels of Insight.
// items.xml flags it `maxreturnamount="0"` and gives it no `itemvalue` at all, so
// it is returned by nothing, adds no nutrition, and awards no fame.
function _cpNonReturnable(matId) {
  return matId.includes("ARTEFACT") || matId.includes("QUESTITEM_TOKEN") ||
    matId.includes("_FACTION_") || matId.includes("UNIQUE_GVGTOKEN") ||
    matId.includes("_FARM_") || matId.includes("_MOUNT_") ||
    matId.includes("_MOUNTUPGRADE_") || matId.includes("ALCHEMY_RARE") ||
    matId.includes("_SKILLBOOK_STANDARD");
}

/**
 * The row's sell-city pin, and whether this craft city can honour it.
 *
 * Committing a price override also pins the city it was typed at
 * (`setCityForce`, js/app.js) — that is what makes the typed number survive a
 * reload and a section-locked search. But a pin is a claim about where you will
 * SELL, and not every city is reachable: the Black Market is sellable from
 * Caerleon alone, and with Black/Red Zone Routes off royal <-> Caerleon hauling
 * is dead (isInvalidCrossRoute, js/utils.js).
 *
 * An unreachable pin used to be dropped in silence: the row sold somewhere else
 * at the market price, and since My Crafting List replays this row, the list
 * looked like it had lost the user's override — while the Caerleon-section row
 * of the same item, which CAN reach the Black Market, still showed it. So the
 * drop is reported instead of hidden.
 *
 * @returns {{city: string|null, dropped: string|null}} `city` is the pin to
 *   search (null = search every sell city), `dropped` is the pin that was asked
 *   for and cannot be used.
 */
function cpSellPin(itemId, craftCity) {
  const forced = (typeof getCityForce === "function") ? getCityForce(itemId, "sell") : null;
  if (!forced) return { city: null, dropped: null };
  const unreachable = (typeof isInvalidCrossRoute === "function")
    && isInvalidCrossRoute(craftCity, forced);
  return unreachable ? { city: null, dropped: forced } : { city: forced, dropped: null };
}

function _cpEnchantOf(id) {
  const m = id && id.match(/@(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}

// Cheapest market buy of `id` across a city pool (override + IQR aware).
function _cpCheapestBuy(id, marketData, cities) {
  const bounds = getIQRBounds(marketData[id]);
  let bestP = 0, bestC = null;
  cities.forEach((c) => {
    const p = getBuyPrice(marketData[id], c, bounds, id);
    if (p > 0 && (bestC === null || p < bestP)) { bestP = p; bestC = c; }
  });
  return { price: bestC ? bestP : 0, city: bestC };
}

// Best zone-valid sell of `id` reachable from craftCity.
function _cpBestSell(id, marketData, craftCity) {
  const bounds = getIQRBounds(marketData[id]);
  let bestP = 0, bestC = null;
  SELL_CITIES.forEach((c) => {
    if (typeof isInvalidCrossRoute === "function" && isInvalidCrossRoute(craftCity, c)) return;
    const p = getSellPrice(marketData[id], c, bounds, id);
    if (p > bestP) { bestP = p; bestC = c; }
  });
  return { price: bestC ? bestP : 0, city: bestC };
}

// Value of filling the crafting journal this craft feeds. Returns the best
// journal (highest silver-per-fame in the ±2-tier window) and the extra silver
// earned per craft = famePerCraft × silverPerFame. Null when the craft maps to
// no journal (e.g. gathering gear / food). `nonArtifactMatCount` may be passed in
// to avoid recomputing it.
function getCraftJournalFill(item, materials, craftCity, marketData, nonArtifactMatCount) {
  const slug = (typeof getCraftJournalSlug === "function") ? getCraftJournalSlug(item) : null;
  if (!slug) return null;

  let matCount = nonArtifactMatCount;
  if (matCount == null) {
    matCount = 0;
    materials.forEach((m) => { if (!_cpNonReturnable(m.matId)) matCount += m.count; });
  }
  const famePerCraft = getCraftingFamePerCraft(item, matCount, _cpEnchantOf(item.id));
  if (famePerCraft <= 0) return { slug, famePerCraft: 0, bestJournal: null, extraSilverPerCraft: 0 };

  const tier = getTierFromId(item.id);
  const cands = getCraftPlannerJournalCandidates(slug, tier);
  const buyCities = (typeof getValidBuyCitiesForRefine === "function")
    ? getValidBuyCitiesForRefine(craftCity, _cpChainOpts(craftCity)) : CITIES;

  let best = null;
  cands.forEach((c) => {
    const empty = _cpCheapestBuy(c.emptyId, marketData, buyCities);
    const full = _cpBestSell(c.fullId, marketData, craftCity);
    if (empty.price <= 0 || full.price <= 0) return;
    const spf = (full.price * (1 - PREMIUM_TAX) - empty.price) / c.maxfame;
    if (!best || spf > best.silverPerFame) {
      best = {
        tier: c.tier, emptyId: c.emptyId, fullId: c.fullId,
        emptyCost: empty.price, emptyCity: empty.city,
        fullGross: full.price, fullCity: full.city,
        maxfame: c.maxfame, silverPerFame: spf,
      };
    }
  });

  const extra = best && best.silverPerFame > 0 ? famePerCraft * best.silverPerFame : 0;
  // One craft never fills a journal, so the journal's whole margin is split
  // across the crafts it takes to fill one. `extra` above is that same split
  // expressed per fame; this is the count the column reports so the division is
  // visible rather than implied.
  const craftsToFill = best && typeof getCraftsToFillJournal === "function"
    ? getCraftsToFillJournal(famePerCraft, best.maxfame)
    : 0;
  return { slug, famePerCraft, bestJournal: best, extraSilverPerCraft: extra, craftsToFill };
}

// Focus value of the CRAFT step: one option is to spend focus on the craft itself
// (raising craft RRR so fewer returnable materials are consumed). Reported as
// silver saved per craft ÷ the craft's focus cost, via the SAME
// marginalSilverPerFocus the Crafting table's "Silver/Focus" column uses
// (js/refining-route.js) — the two tables answer the same question about the same
// step, so they share the formula rather than each carrying a copy that can drift.
// Returns null when the craft has no focus cost (or is a no-return combine).
// `craftRRRbase` is the focus-off RRR.
function _cpCraftFocusStep(item, sourced, craftCity, tier, craftRRRbase) {
  const craftFocusCost = (typeof getCraftFocusCost === "function") ? getCraftFocusCost(item.id, tier) : 0;
  if (craftFocusCost <= 0 || item.noReturn) return null;
  const craftRRRfocus = getCraftRRR(craftCity, item.craftType, true);
  let rrrEligibleMatCost = 0;
  let setupExemptCost = 0;
  sourced.forEach((s) => {
    if (s.isArtifact) return;
    const perUnit = (s.sourcing && s.sourcing.perUnit > 0) ? s.sourcing.perUnit : 0;
    const fee = (s.sourcing && s.sourcing.source === "market") ? (s.sourcing.travelFeePerUnit || 0) : 0;
    rrrEligibleMatCost += (perUnit + fee) * s.count;
    // Self-refined materials carry station-fee/transmute silver, which is saved
    // along with the material but never paid a market setup fee.
    setupExemptCost += ((s.sourcing && s.sourcing.feePerUnit) || 0) * s.count;
  });
  const spf = marginalSilverPerFocus(
    rrrEligibleMatCost, craftRRRbase, craftRRRfocus, craftFocusCost, setupExemptCost);
  if (spf <= 0) return null;
  return { kind: "craft", tier, focusCost: craftFocusCost, silverPerFocus: spf,
           silverSaved: spf * craftFocusCost };
}

// Focus value of REFINING one material the craft USES. Focus only buys extra
// RRR, so its worth is `baseline − focusedCost` per unit, where the baseline is
// what the row already pays for that material (`opts.baselineUnit`: the cheaper
// of buying the bar and refining it without focus). Scaled by (1+SETUP_FEE)
// because the craft pays setup on materials.
//
// The ladder tier is picked by pickCheapestFocusTier — lowest resulting cost,
// not best silver-per-focus — because the planner's objective is the end
// product's profit and the craft's revenue is fixed. A tier that is efficient
// per focus point but saves almost nothing loses here, correctly.
//
// This used to score a second play as well: refine the material and SELL it,
// baselined against the best price in ANY city. That let cross-city market
// arbitrage win a column labelled "focus value" — Elder's Bed reported
// "Refine T8 planks (sell, not used here) · 275.2/focus" while the row still
// self-refined those planks and booked the saving. Refining to sell is a
// different business from this pipeline and is no longer a candidate; the
// Refining / Transports table is where that play belongs.
//
// Returns the winning tier + the ladder chain so the caller can re-price the
// material self-refined-with-focus. Null for a non-refinable / unpriced
// material, or when focus saves nothing against what the row already pays.
function getRefineFocusValue(matId, marketData, refineCity, opts) {
  if (typeof buildRefiningChain !== "function" || typeof pickCheapestFocusTier !== "function") return null;
  const chainOpts = _cpChainOpts(refineCity);
  const chain = buildRefiningChain(matId, marketData, refineCity, false, 0, chainOpts);
  if (!chain) return null;

  // What the caller pays per unit today. Callers that don't track it (the
  // standalone/refining-side callers) get the same answer worked out here.
  let paidPerUnit = (opts && opts.baselineUnit > 0) ? opts.baselineUnit : 0;
  if (paidPerUnit <= 0) {
    const bar = (typeof findCheapestMarketBuyForRefine === "function")
      ? findCheapestMarketBuyForRefine(matId, marketData, refineCity, chainOpts) : { price: 0 };
    paidPerUnit = bar && bar.price > 0 ? bar.price + (bar.travelFeePerUnit || 0) : Infinity;
  }

  const pf = pickCheapestFocusTier(chain);
  if (!pf || !(pf.focusCost > 0)) return null;
  // The baseline is a market buy (setup-eligible); the focused refine is not, apart
  // from its own market legs — `pf.fee` is its station-fee/transmute silver, which
  // pays no setup. Charging setup on the whole difference overstated the saving.
  const pfFee = pf.fee || 0;
  const savedPerUnit = (paidPerUnit - (pf.totalCost - pfFee)) * (1 + SETUP_FEE) - pfFee;
  if (!(savedPerUnit > 0)) return null;

  // The winning tier is a step INSIDE the ladder, which is often below the
  // material's own tier (a T6 block ladder refines a T5 block on the way). Carry
  // the id actually produced at that step so the column can name the refine the
  // user is being told to run, not the material the ladder tops out at.
  let focusItemId = matId;
  for (let node = chain; node; ) {
    if (node.tier === pf.tier) { focusItemId = node.produces; break; }
    const sec = node.inputs[1];
    node = (sec && sec.sourcing.source === "chain") ? sec.sourcing.chain : null;
  }
  return {
    kind: "refine", matId, focusItemId, resourceType: chain.resourceType, chain,
    tier: pf.tier, focusCost: pf.focusCost,
    // Per unit of material — the row-level figure the column ranks on is
    // profitDelta, set by computeCraftPlannerRow after re-pricing the craft.
    silverSaved: savedPerUnit,
    silverPerFocus: savedPerUnit / pf.focusCost,
  };
}
// Legacy alias (tests / other callers): identical to getRefineFocusValue.
const getRefineSellFocus = getRefineFocusValue;

// Cheapest sourcing for a material when focus is applied to its refine at `tier`:
// self-refine (chain cost with focus at that tier) vs buy the bar, whichever is
// cheaper. Used only for the material the planner decides to spend focus refining,
// so a high silver/focus refine that is nonetheless absolutely dearer than the bar
// (e.g. artificially pricey raws) still falls back to buying. `chain` may be passed
// to avoid rebuilding it.
function _cpRefineFocusedSourcing(matId, marketData, craftCity, tier, chain) {
  const chainOpts = _cpChainOpts(craftCity);
  const c = chain || ((typeof buildRefiningChain === "function") ? buildRefiningChain(matId, marketData, craftCity, false, 0, chainOpts) : null);
  const market = (typeof findCheapestMarketBuyForRefine === "function")
    ? findCheapestMarketBuyForRefine(matId, marketData, craftCity, chainOpts) : { price: 0 };
  const marketEff = market.price > 0 ? market.price + (market.travelFeePerUnit || 0) : 0;
  if (!c || typeof chainSilverCostWithFocusAtTier !== "function") {
    return { perUnit: market.price > 0 ? market.price : 0, feePerUnit: 0, source: "market", city: market.city, travelFeePerUnit: market.travelFeePerUnit || 0 };
  }
  // {cost, fee} when available: `fee` is the setup-exempt slice the craft above
  // must not multiply by (1 + SETUP_FEE).
  const focused = (typeof _chainCostWithFocusAtTier === "function")
    ? _chainCostWithFocusAtTier(c, tier)
    : { cost: chainSilverCostWithFocusAtTier(c, tier), fee: 0 };
  const focusedCost = focused.cost;
  if (marketEff > 0 && marketEff <= focusedCost) {
    return { perUnit: market.price, feePerUnit: 0, source: "market", city: market.city, travelFeePerUnit: market.travelFeePerUnit || 0 };
  }
  return { perUnit: focusedCost, feePerUnit: focused.fee || 0, source: "chain", chain: c, city: null, focusTier: tier };
}

// How many refine actions at `tier` one unit of the chain's output takes. Shared
// with the Refining / Transports table, which needs the same number to turn a
// focus bar's worth of REFINES into finished OUTPUTS — see refinesPerOutputAtTier
// in js/refining-chain-focus.js. The planner's chains are built focus-off, so
// omitting the focusTier argument (node.rrr is already the base rate) keeps this
// call exactly what it always was.
function _cpRefinesPerUnitAtTier(chain, tier) {
  if (typeof refinesPerOutputAtTier !== "function") return 0;
  return refinesPerOutputAtTier(chain, tier);
}

// Focus points ONE craft of this row burns under the winning play. A craft play
// burns the craft's own focus cost once; a refine play burns its refine's focus
// cost once per focused refine the craft needs — the units of that material the
// craft consumes (net of craft RRR) × the refines per unit at the focused tier.
// This is what makes the planner's 10k-focus figure comparable to the Crafting
// table's: both answer "profit from one full 10,000-focus bar run on this row".
function _cpFocusPerCraft(play, materials, craftRRR) {
  if (!play || !(play.focusCost > 0)) return 0;
  if (play.kind !== "refine") return play.focusCost;
  const m = (materials || []).find((x) => x.matId === play.matId);
  if (!m) return 0;
  const perUnit = play.chain ? _cpRefinesPerUnitAtTier(play.chain, play.tier) : 1;
  if (!(perUnit > 0)) return 0;
  const units = m.count * (1 - (craftRRR || 0));
  const focus = play.focusCost * perUnit * units;
  return focus > 0 ? focus : 0;
}

// The single best place to spend a focus point across the WHOLE planner — the
// highest silver-per-focus among every row's own bestFocusStep. `rows` are
// computeCraftPlannerRow results (no-data rows are skipped). Kept for callers that
// want a table-wide headline; the per-row column renders bestFocusStep directly.
//
// Ranks on profitDelta ÷ row.focusPerCraft, NOT the play's own `silverPerFocus`.
// Both of a row's candidates remove cost from one craft, but a refine play's
// `focusCost` is a SINGLE refine of a single unit while the craft runs that step
// once per ladder step per unit it consumes — so play.silverPerFocus overstates a
// refine by exactly that multiple and would beat every craft play here for the
// wrong reason. _cpFocusPerCraft is the honest denominator, and the same one the
// Best Focus cell (js/render-craft-planner.js _cpFocusCell) and Profit / 10k Focus
// already use. The winning play object is returned untouched.
function computeCraftPlannerGlobalFocus(rows, marketData) {
  let best = null, bestRate = 0;
  (rows || []).forEach((row) => {
    if (!row || row.noData) return;
    const cand = row.bestFocusStep;
    if (!cand) return;
    const per = row.focusPerCraft > 0 ? row.focusPerCraft : cand.focusCost;
    const rate = per > 0 ? cand.profitDelta / per : 0;
    if (rate > 0 && rate > bestRate) { best = cand; bestRate = rate; }
  });
  return best;
}

// Detect a user price override anywhere in the row (materials, their chains, or
// the sell) so the "show overrides only" filter behaves. `enchantedVia` is the
// booked buy-and-enchant acquisition: when set the row buys the @(n-1) item and
// the rune/soul/relic INSTEAD of its craft materials, so the enchant legs are
// what is checked (a stale override on a craft leg the row no longer buys must
// not flag the row).
function _cpHasOverride(item, sourced, sellCity, enchantedVia) {
  if (typeof getOverridePrice !== "function") return false;
  if (sellCity && getOverridePrice(item.id, sellCity) !== null) return true;
  if (enchantedVia) {
    return getOverridePrice(enchantedVia.baseId, enchantedVia.baseCity) !== null ||
      getOverridePrice(
        enchantedVia.matSourcing ? enchantedVia.matSourcing.buyId : enchantedVia.matId,
        enchantedVia.matCity,
      ) !== null;
  }
  for (const s of sourced) {
    if (s.sourcing && s.sourcing.source === "chain") {
      if (typeof chainHasOverride === "function" && chainHasOverride(s.sourcing.chain)) return true;
    } else if (s.sourcing && s.sourcing.source === "transmute" && s.sourcing.transmute) {
      // The priceable leaf is the node the route BUYS, not the id it produces.
      const t = s.sourcing.transmute;
      if (getOverridePrice(t.startId, t.startCity) !== null) return true;
    } else if (s.sourcing && s.sourcing.city) {
      if (getOverridePrice(s.matId, s.sourcing.city) !== null) return true;
    }
  }
  return false;
}

// Source every recipe material and total the per-craft input cost. Focus is a
// single most-profitable play, passed as `focus`:
//   • null                          → everything focus-off (cheaper of buy vs self-refine).
//   • { kind:"craft" }              → craft RRR uses focus (fewer mats consumed); mats still focus-off.
//   • { kind:"refine", matId, tier }→ that ONE material is self-refined with focus at `tier`
//                                     (cheaper of that focused refine vs buying the bar); everything
//                                     else focus-off. The refined bar is USED in the craft, lowering
//                                     its cost — it is never sold.
// Also returns the parallel all-market cost so the caller can report refining savings.
function _cpPriceMaterials(item, materials, marketData, craftCity, focus) {
  const tier = getTierFromId(item.id);
  const craftFocusOn = !!(focus && focus.kind === "craft");
  const craftRRR = item.noReturn ? 0 : getCraftRRR(craftCity, item.craftType, craftFocusOn);
  const chainOpts = _cpChainOpts(craftCity);

  const sourced = [];
  let inputCost = 0, allMarketCost = 0, nonArtifactMatCount = 0, allAvailable = true;
  materials.forEach((m) => {
    const isArtifact = _cpNonReturnable(m.matId);
    // A focus play is only ever placed on a refinable bar, and nothing that
    // refines has a substitute — so the focused arm prices the material itself.
    const focused = !!(focus && focus.kind === "refine" && focus.matId === m.matId);
    const sourceOne = (candId) => (focused
      ? _cpRefineFocusedSourcing(candId, marketData, craftCity, focus.tier)
      : getRefiningSourcing(candId, marketData, craftCity, false, 0, chainOpts));
    const effOf = (s) => (s && s.perUnit > 0
      ? s.perUnit + (s.source === "market" ? (s.travelFeePerUnit || 0) : 0)
      : Infinity);

    // An artifact slot also accepts a Crystallized token of the same tier (and,
    // on three gear lines, an expiring decay twin) — same recipe, same focus.
    // Price every candidate and buy the cheapest, the way the Crafting table
    // already does (render-crafting.js); otherwise the two tables report
    // different costs for the very same craft. The material's own id is first,
    // so it keeps the slot on a tie.
    const candidates = (!focused && typeof getCraftMatCandidates === "function")
      ? getCraftMatCandidates(m.matId) : [m.matId];
    let winnerId = m.matId;
    let src = sourceOne(m.matId);
    let bestEff = effOf(src);
    // A dead forced buy city on the material itself kills the row: the force
    // means "source it here", not "source something else instead".
    const forcedDead = bestEff === Infinity &&
      (typeof getCityForce === "function") && !!getCityForce(m.matId, "buy");
    if (!forcedDead) {
      candidates.slice(1).forEach((candId) => {
        const alt = sourceOne(candId);
        const e = effOf(alt);
        if (e < bestEff) { bestEff = e; src = alt; winnerId = candId; }
      });
    }

    const market = (typeof findCheapestMarketBuyForRefine === "function")
      ? findCheapestMarketBuyForRefine(winnerId, marketData, craftCity, chainOpts) : { price: 0 };
    const perUnit = src && src.perUnit > 0 ? src.perUnit : 0;
    if (perUnit <= 0) allAvailable = false;
    const marketUnit = market && market.price > 0 ? market.price : perUnit;
    const fee = (src && src.source === "market") ? (src.travelFeePerUnit || 0) : 0;
    // Setup fee is a buy-order cost: a self-refined material's own station-fee and
    // transmute silver never went through the market, so it is held back from the
    // multiplier — exactly like this craft's station fee and recipe silver below.
    const exempt = ((src && src.feePerUnit) || 0) * (isArtifact ? m.count : m.count * (1 - craftRRR));
    const eff = isArtifact ? m.count : m.count * (1 - craftRRR);
    inputCost += ((perUnit + fee) * eff - exempt) * (1 + SETUP_FEE) + exempt;
    allMarketCost += marketUnit * eff * (1 + SETUP_FEE);
    if (!isArtifact) nonArtifactMatCount += m.count;
    // `matId` is what gets BOUGHT (and what the price cell edits); `origMatId`
    // is the recipe slot it fills — they differ only on a substitution.
    sourced.push({ matId: winnerId, origMatId: m.matId, count: m.count, isArtifact, sourcing: src });
  });

  const stationFee = calcStationFeeSilver(tier, nonArtifactMatCount, item.nutritionPerCraft);
  inputCost += stationFee;
  allMarketCost += stationFee;
  if (item.silverCost) {
    const recipeSilver =
      typeof applyGlobalDiscount === "function"
        ? applyGlobalDiscount(item.silverCost)
        : item.silverCost;
    inputCost += recipeSilver;
    allMarketCost += recipeSilver;
  }

  return { sourced, inputCost, allMarketCost, nonArtifactMatCount, craftRRR, allAvailable };
}

// Compute one planner row: refine + craft + journal + best focus play. Returns
// `{ noData:true }` (with enough context to render a clickable placeholder) when
// any material is unpriced or the item has no sell price.
//
// Focus is LIMITED (Premium regenerates only ~10k/day, capped at 30k), so it is
// modeled as a single play per row rather than a discount on every step. The row
// enumerates the candidate placements — all of which feed THIS craft —
//   • { kind:"craft" }  — focus the CRAFT step (raises craft RRR), and
//   • { kind:"refine" } — focus REFINING one material the craft uses (cheapest tier
//                         of its ladder; the refined bar is then USED in the craft),
//                         one candidate per returnable material
// re-prices the whole row for each, and keeps the one that leaves the END PRODUCT's
// profit highest. With "Use Focus" on the headline IS that winning candidate, so the
// Best Focus column, the Materials column and Profit/Craft can never disagree.
function computeCraftPlannerRow(item, materials, marketData, craftCity) {
  const tier = getTierFromId(item.id);
  const section = craftCity === "Caerleon" ? "caerleon" : "royal";
  const focusOn = (typeof isFocusEnabled === "function") && isFocusEnabled();
  // Carried on EVERY return below: a sell pin this craft city cannot reach is
  // the row's whole story, and a no-data row is exactly where the user is still
  // typing prices in. See cpSellPin.
  const sellPin = cpSellPin(item.id, craftCity);
  const sellPinDropped = sellPin.dropped;
  // The table's City pick outranks a per-item sell pin (js/table-sell-city.js).
  // Reported rather than silent for the same reason: My Crafting List replays
  // this row, so an override that stops applying has to say why. Null unless a
  // pick is actually overriding a pin.
  const sellPinFilteredTo = (typeof sellPinOverriddenByFilter === "function"
    && sellPinOverriddenByFilter("craft-planner-table", craftCity, sellPin.city))
    ? getTableSellCity("craft-planner-table")
    : null;

  // 1. Focus-OFF sourcing (cheaper of buy-bar vs self-refine per material).
  const baseline = _cpPriceMaterials(item, materials, marketData, craftCity, null);
  if (!baseline.allAvailable) {
    // WHY the row dead-ended: the materials with no quote in this craft city's
    // zone pool (Caerleon-only for a Caerleon craft). The alternatives block
    // prints them as click-to-edit price spans — see craft-planner-dedupe.js.
    return { noData: true, item, craftCity, craftType: item.craftType, tier, materials, sourcing: baseline.sourced, section, sellPinDropped, sellPinFilteredTo,
      noDataMats: baseline.sourced.filter((s) => !(s.sourcing && s.sourcing.perUnit > 0)).map((s) => s.matId),
      noDataNoSell: false };
  }

  // 2. Focus decision — re-price the row once per candidate placement and keep the
  //    one that leaves the end product's profit highest. Every candidate sells the
  //    same item into the same city (see step 4: the sell city that maximizes
  //    p×(1−tax) − travel does not depend on input cost), so "highest profit" is
  //    exactly "lowest input cost" and the candidates can be compared on cost alone
  //    without running the sell-city search once per candidate.
  const craftStep = _cpCraftFocusStep(item, baseline.sourced, craftCity, tier, baseline.craftRRR);
  const candidates = [];
  if (craftStep) candidates.push({ step: craftStep, directive: { kind: "craft" } });
  materials.forEach((m, i) => {
    if (_cpNonReturnable(m.matId)) return;
    // Price the refine against what this row ALREADY pays for the bar (the
    // focus-off sourcing it just picked), not against a self-refine it would
    // never run — see getRefineFocusValue.
    const src = baseline.sourced[i] && baseline.sourced[i].sourcing;
    const paid = src && src.perUnit > 0
      ? src.perUnit + (src.source === "market" ? (src.travelFeePerUnit || 0) : 0)
      : 0;
    const rv = getRefineFocusValue(m.matId, marketData, craftCity, { baselineUnit: paid });
    if (!rv) return;
    candidates.push({ step: rv, directive: { kind: "refine", matId: rv.matId, tier: rv.tier } });
  });

  // Score each placement by what it adds to the END PRODUCT's profit. Same
  // revenue either way, so that delta is exactly the input cost it removes.
  // pickBestFocusPlay then ranks on that delta (ties to the cheaper focus) —
  // the shared standard in js/focus-play.js.
  const plays = [];
  candidates.forEach((c) => {
    const priced = _cpPriceMaterials(item, materials, marketData, craftCity, c.directive);
    if (!priced.allAvailable) return;
    const play = makeFocusPlay({ ...c.step, profitDelta: baseline.inputCost - priced.inputCost });
    if (!play) return;
    play.priced = priced;
    plays.push(play);
  });
  const bestFocusStep = pickBestFocusPlay(plays);
  // The re-priced row rides along only until the winner is known; it must not
  // leak into the returned row (renderers and the settings bundle walk it).
  const winnerPriced = bestFocusStep ? bestFocusStep.priced : null;
  if (bestFocusStep) delete bestFocusStep.priced;

  // 3. Apply focus (when the toggle is on) to the winning candidate; otherwise the
  //    headline is the focus-off baseline and the column reports the winner as advice.
  const active = (focusOn && winnerPriced) ? winnerPriced : baseline;
  // `let` for the enchant candidate below: it can replace the craft input cost.
  let inputCost = active.inputCost;

  // 4. Best sell city (max net margin) reachable from craftCity, honoring the
  //    table's City pick first and the per-item force second (see
  //    effectiveSellCities in js/table-sell-city.js — with no pick active this
  //    is exactly the old `pin ?? every city`). An EMPTY list means a pick this
  //    craft city cannot reach: there is no honest sale, so the row falls
  //    through to the no-data branch below.
  const bounds = getIQRBounds(marketData[item.id]);
  const { city: pinnedSell } = cpSellPin(item.id, craftCity);
  const sellCities = (typeof effectiveSellCities === "function")
    ? effectiveSellCities("craft-planner-table", craftCity, pinnedSell, SELL_CITIES)
    : (pinnedSell ? [pinnedSell] : SELL_CITIES);
  // Tiered selection (plan.md), in _cpSelectSell (js/craft-planner-quality.js):
  // tier 1 is the cities with a real Normal (q1) ask and wins outright whenever
  // it is non-empty (sellQuality null); only a market with no Normal ask
  // anywhere falls back, to the LOWEST quality q2-5 that any searched city
  // offers, picked on margin within that tier alone and tagged sellQuality = q.
  // Null ⇒ no sale at any quality → the no-data branch below.
  const sell = _cpSelectSell(item.id, craftCity, sellCities, marketData, bounds);

  if (!sell) {
    // Materials all priced; the gap is the SELL side — no reachable market has
    // a quote (with routes off a Caerleon craft sells only at Caerleon / BM).
    // The input cost is still fully computable — the fee model needs no product
    // price — so the row carries the same `inputCost` a priced twin would show,
    // minus the sell-travel leg it has none of. (The enchant route below cannot
    // run here: it needs a sell city to beat the craft into.) The missing-
    // material no-data row above keeps no cost — an incomplete sum must not
    // display, which keeps the two no-data kinds distinguishable downstream.
    // Quality references (when the quality book holds any, _cpNoSellReferences
    // in js/craft-planner-quality.js) ride along so the Sell cell can explain
    // the emptiness — the row itself stays unpriced no-data. Omitted entirely
    // when there are none.
    const noSellRefs = _cpNoSellReferences(item.id, craftCity, sellCities);
    return { noData: true, item, craftCity, craftType: item.craftType, tier, materials, sourcing: active.sourced, section, sellPinDropped, sellPinFilteredTo,
      noDataMats: [], noDataNoSell: true, refineCraftCost: inputCost,
      ...(noSellRefs ? { noSellRefs } : {}) };
  }
  const { city: sellCity, price: sellPrice, travel: sellTravel, quality: sellQuality } = sell;

  // 4.5 Acquisition alternative: buy the @(n-1) item and enchant it up
  //     (js/craft-planner-enchant-route.js). The sell side above does not
  //     depend on the input cost (every candidate subtracts the same figure),
  //     so the enchant route is evaluated against the sell city already chosen.
  //     It wins when it is strictly cheaper than the craft route's input cost;
  //     a tie keeps the craft, which needs no market for a base item.
  const enchCand = (typeof computeEnchantAcquisition === "function")
    ? computeEnchantAcquisition(item, marketData, { craftCity, sellCity })
    : null;
  const enchantedVia = (enchCand && enchCand.cost < inputCost) ? enchCand : null;
  if (enchantedVia) {
    inputCost = enchantedVia.cost;
  }
  // The enchant route is a pure market buy: nothing is refined, so there is no
  // refining saving to report.
  const refineSavings = enchantedVia ? 0 : active.allMarketCost - active.inputCost;

  const craftProfit = sellPrice * (1 - PREMIUM_TAX) - (inputCost + sellTravel);
  // The same craft with NO focus anywhere on it. `baseline` is step 1 above, so
  // this costs nothing extra — and it is EXACT where arithmetic could not be: a
  // refine play moves a material from "buy the bar" to "refine it yourself",
  // which no difference of two return rates can reproduce. My Crafting List
  // prices the units past its focus budget with it (js/craft-list-focus-budget.js).
  // The enchant route uses no focus, so its no-focus twin IS the headline.
  const noFocusCraftProfit = enchantedVia
    ? craftProfit
    : sellPrice * (1 - PREMIUM_TAX) - (baseline.inputCost + sellTravel);

  // 4.95 The self-gathered twin (plan.md): the SAME craft with every GATHERABLE
  //    input at zero — a market bar and a self-refined chain alike (the chain's
  //    resource base is the player's own gathering), so the figure never moves
  //    with the bar price or with the market-vs-self-refine choice. Kept: the
  //    craft's station fee, recipe silver, the sell travel leg, and every
  //    non-gatherable input (_cpNonReturnable — artifacts, tokens, grown or
  //    bought-special inputs) at the price the row pays it, setup fee and all.
  //    Priced off the focus-OFF baseline, so re-pricing the winning craft
  //    cannot move it either: with the materials free there is no RRR slice
  //    left for focus to buy. It is the bare craft figure — no journal silver,
  //    exactly like craftProfit — even on an enchanted-via-station row, where
  //    it answers "the craft route, materials self-gathered".
  //
  //    Each gatherable term is subtracted WHOLE rather than re-derived at a
  //    zero resource basis inside the primary expression: that expression held
  //    its self-refine carve-out (`exempt`) out of the (1 + SETUP_FEE) bracket
  //    on the assumption the bracket covers the rest of what was paid, so
  //    feeding it a zero price would leave a phantom −exempt × SETUP_FEE
  //    instead of a clean zero. Same arithmetic the primary used, so what
  //    leaves is exactly what the gatherable terms put in.
  let sfKeptCost = baseline.inputCost;
  baseline.sourced.forEach((s) => {
    if (s.isArtifact) return;
    const src = s.sourcing || {};
    const perUnit = src.perUnit > 0 ? src.perUnit : 0;
    const fee = src.source === "market" ? (src.travelFeePerUnit || 0) : 0;
    const eff = s.count * (1 - baseline.craftRRR);
    const exempt = (src.feePerUnit || 0) * eff;
    sfKeptCost -= ((perUnit + fee) * eff - exempt) * (1 + SETUP_FEE) + exempt;
  });
  const selfFoundCraft = sellPrice * (1 - PREMIUM_TAX) - (sfKeptCost + sellTravel);

  // 5. Journal fill (focus-independent). Two mutually exclusive plays for the
  //    SAME journal, so each gets its own headline and they are never summed:
  //    • journal / combinedProfit        — sell the full journal, buy the next empty.
  //    • laborerJournal / laborerCombined — hand it to your own laborer, which
  //      returns refined loot AND the same journal, empty (no empty is ever
  //      bought, so journal market prices don't enter that figure at all).
  //    An enchanted-via-station row crafts nothing, so it fills no journal —
  //    both plays are null rather than stale craft-route numbers.
  const journal = enchantedVia ? null
    : getCraftJournalFill(item, materials, craftCity, marketData, active.nonArtifactMatCount);
  const journalExtra = journal ? journal.extraSilverPerCraft : 0;
  const combinedProfit = craftProfit + journalExtra;
  const laborerJournal = (!enchantedVia && typeof getLaborerJournalFill === "function")
    ? getLaborerJournalFill(item, materials, craftCity, marketData, active.nonArtifactMatCount)
    : null;
  const laborerCombinedProfit = craftProfit + (laborerJournal ? laborerJournal.extraSilverPerCraft : 0);

  // 6. A whole 10,000-focus bar spent on this row: headline profit per craft ×
  //    the whole crafts that bar buys under the winning focus placement. Null
  //    when the row can take no focus at all — a different answer from 0.
  //    Spending a bar IS focus-on play, so BOTH operands are the focus-on ones
  //    (winnerPriced), never `active` — with the checkbox off `active` is the
  //    focus-off baseline, which made the column move with the toggle.
  const focusPriced = winnerPriced || active;
  // An enchanted-via-station row spends no focus anywhere: every focus figure
  // is zeroed so the Best Focus / Profit-per-10k cells render their dash.
  // The bar is focus-on play, so the enchant-vs-craft choice it rides on is the
  // FOCUS-ON one: an enchant that only beats the UNfocused craft must not blank
  // the column with the checkbox off while the same row prices it with it on.
  const focusEnchanted = !!(enchCand && enchCand.cost < focusPriced.inputCost);
  const focusPerCraft = focusEnchanted ? 0
    : _cpFocusPerCraft(bestFocusStep, materials, focusPriced.craftRRR);
  // A fraction of one craft when a single craft costs more than the bar
  // (focusBarCrafts, js/calculations.js) — flooring read 0 on every T8 artifact.
  const craftsPer10kFocus = focusPerCraft > 0
    ? ((typeof focusBarCrafts === "function")
      ? focusBarCrafts(focusPerCraft)
      : Math.floor(10000 / focusPerCraft))
    : 0;
  // Same sell city and travel either way (step 4 above), so the focus-on craft
  // profit is the headline revenue less the focus-on input cost. The journal
  // fill is focus-independent and rides along unchanged.
  const focusCraftProfit = focusEnchanted
    ? sellPrice * (1 - PREMIUM_TAX) - (enchCand.cost + sellTravel)
    : sellPrice * (1 - PREMIUM_TAX) - (focusPriced.inputCost + sellTravel);
  // Journal fill follows the focus-on route too: a row booked as enchanted only
  // because focus is off still crafts (and fills a journal) in the focus-on world.
  const focusJournalExtra = focusEnchanted ? 0
    : (enchantedVia
      ? ((getCraftJournalFill(item, materials, craftCity, marketData, focusPriced.nonArtifactMatCount) || {})
        .extraSilverPerCraft || 0)
      : journalExtra);
  const focusCombinedProfit = focusCraftProfit + focusJournalExtra;
  const profitPer10kFocus = focusPerCraft > 0
    ? ((typeof calculateProfitPer10kFocus === "function")
      ? calculateProfitPer10kFocus(focusCombinedProfit, focusPerCraft)
      : focusCombinedProfit * craftsPer10kFocus)
    : null;

  return {
    noData: false,
    item, craftCity, craftType: item.craftType, tier, rrr: active.craftRRR,
    focusOn, focusWin: enchantedVia ? null : (bestFocusStep ? bestFocusStep.kind : null),
    materials, sourcing: active.sourced,
    // When the row is bought-then-enchanted, the whole input is a market buy.
    allMarketCost: enchantedVia ? enchantedVia.cost : active.allMarketCost,
    refineCraftCost: inputCost + sellTravel,
    refineSavings,
    brecilienFee: sellTravel,
    sellCity, sellPrice, sellPinDropped, sellPinFilteredTo,
    // The quality of the winning sale: null when it is a Normal (q1) ask — the
    // old default every consumer already handles — 2-5 when the fallback tier
    // priced the row off a Good+ ask (_cpSelectSell above). Purely
    // informational: no arithmetic downstream reads it, and whole-row consumers
    // ignore unknown keys.
    sellQuality,
    // 24h volume at the sell city, for the Sell header's "vol" sort. Through
    // getCityVol so a hand-typed volume counts exactly as the cell prints it.
    sellVol: (typeof getCityVol === "function") ? getCityVol(marketData, item.id, sellCity) : 0,
    craftProfit, journal, combinedProfit,
    // The self-gathered twin of craftProfit (plan.md): same sale, every
    // gatherable input at zero, station/recipe/travel/tax kept. Row-level —
    // the planner row has no marginInfo.
    selfFoundProfit: selfFoundCraft,
    laborerJournal, laborerCombinedProfit,
    // The focus-OFF twin of the three figures above, for a caller that can only
    // afford focus on part of a basket. Equal to them when the checkbox is off
    // (`active` IS the baseline then), so a consumer never has to ask which.
    noFocusCraftProfit,
    noFocusCombinedProfit: noFocusCraftProfit + journalExtra,
    noFocusLaborerCombinedProfit:
      noFocusCraftProfit + (laborerJournal ? laborerJournal.extraSilverPerCraft : 0),
    noFocusSourcing: baseline.sourced,
    noFocusRrr: baseline.craftRRR,
    bestFocusStep: enchantedVia ? null : bestFocusStep,
    focusPerCraft, craftsPer10kFocus, profitPer10kFocus,
    // Self-gathered twin of the bar: the bare self-gathered craft plus the
    // same journal play the bar books, so only the gatherable inputs differ.
    profitFocusOnGathered: focusPerCraft > 0 ? selfFoundCraft + focusJournalExtra : null,
    profitPer10kFocusGathered: (focusPerCraft > 0 && Number.isFinite(selfFoundCraft + focusJournalExtra))
      ? (selfFoundCraft + focusJournalExtra) * craftsPer10kFocus : null,
    // The buy-and-enchant acquisition, booked only when it beat the craft route.
    ...(enchantedVia ? { enchantedVia } : {}),
    // focusCraftProfit is the focus-ON craft profit with NO journal silver in it;
    // focusCombinedProfit is the same figure plus the sell-the-journal play. The
    // laborer play is the OTHER journal play, so its own 10k-focus figure has to
    // start from the bare craft — see _cpLaborerJournalCell in
    // js/render-craft-planner.js, which quotes it in that column's tooltip.
    focusCraftProfit, focusCombinedProfit,
    hasOverride: _cpHasOverride(item, active.sourced, sellCity, enchantedVia),
    section,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    computeCraftPlannerRow,
    getCraftJournalFill,
    getRefineFocusValue,
    getRefineSellFocus,
    computeCraftPlannerGlobalFocus,
    _cpFocusPerCraft,
    _cpRefinesPerUnitAtTier,
  };
}
