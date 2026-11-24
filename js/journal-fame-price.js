// What a point of journal fame is WORTH ON THE MARKET, per journal tier.
//
// Every self-fill play in this app spends fame it treats as free, on the
// reasoning that you were gathering (or crafting) anyway. That is true of the
// ACTIVITY but not of the FAME: a point of fame has exactly one alternative use,
// and it is a paid one — fill the journal and SELL it full instead of feeding it
// to your laborer, then buy another empty to carry on. That is the Journal
// Filling table's whole play, and its margin per journal is therefore the price
// tag on the fame that filled it:
//
//   pricePerFame = (full sell, net of tax − empty buy) ÷ maxfame
//
// Per TIER, from the live market, with no tunable in it. This is the number that
// makes a T3 row and a T8 row comparable at all: they do not merely take
// different amounts of fame, their fame is worth different silver.
//
// `emptyFree` DROPS THE EMPTY LEG:
//
//   pricePerFame = (full sell, net of tax) ÷ maxfame
//
// That is the value of the journal LIQUIDATED — sold full and never replaced.
// The self-fill loops report it as their pessimistic bound and, when no empty
// trades at a tier, fall back to it so that tier is still billed something. They
// do NOT rank on it: see getJournalFameBill at the foot of this file for why the
// empty belongs to the alternative play even though the self-fill loop never
// buys one. Callers should reach for getJournalFameBill rather than choosing a
// flag by hand — it returns both readings and names the one it ranked.
//
// Netting it off a self-fill payout turns the column from "what does this play
// gross" into "is feeding the laborer better than selling the journal" — the
// marginal question this repo asks everywhere else ([[project_focus_value_is_marginal]]).
//
// TWO RULES THE MATHS MUST KEEP:
//  • A NEGATIVE MARGIN IS NOT A NEGATIVE PRICE. When the full journal sells for
//    less than an empty one costs, nobody sells it — the alternative use is
//    worth nothing, so the price floors at 0. Letting it go negative would pay
//    the self-fill play a bonus for a bad journal market.
//  • UNPRICED IS 0, AND SAYS SO. A journal tier with no market data prices its
//    fame at 0 and reports hasData:false, so the caller can show a gross figure
//    and label it gross rather than blanking the row.
//
// The sales tax on the full sell is the app-wide PREMIUM_TAX, applied by
// calcJournalEconomics so this file and the Journal Filling table can never
// disagree about what a full journal nets.

// Cache per marketData object: the price of a (slug, tier)'s fame is the same
// for every row that asks, and computeLaborerSelfFill asks once per candidate
// tier per city. Keyed on the marketData identity so a fresh scan can never be
// answered from a stale entry.
//
// Identity alone is not enough: the app's price map is one object MUTATED in
// place by captures, overrides and toggles, so a cache that outlives a render
// pass answers with a price the map no longer holds. Each bucket is stamped with
// the render pass it was filled in (see below), and resetJournalFamePriceCache
// drops everything at once.
let _jfpCache = (typeof WeakMap !== "undefined") ? new WeakMap() : null;

/** Forget every cached fame price. Called at the start of each render pass. */
function resetJournalFamePriceCache() {
  _jfpCache = (typeof WeakMap !== "undefined") ? new WeakMap() : null;
}

// The full journal is SOLD and the empty one is BOUGHT, and the two Pricing
// Model toggles move independently, so each leg asks for its own gate.
function _jfpMinVol(side) {
  const mode = (typeof getOrderType === "function") ? getOrderType(side) : "market";
  return mode === "market" ? 25 : 0;
}

/**
 * Market price of one point of fame for the `slug` journal at `tier`.
 *
 * `maxfame` is passed in rather than looked up because the crafting journals
 * (WARRIOR/HUNTER/MAGE/TOOLMAKER) keep their fame schedule in the craft-planner
 * catalogue, not in JOURNAL_FAME — the caller already holds the right one.
 * `cities` defaults to every laborer city.
 * `emptyFree` prices the fame at the whole full sell instead of the margin, for
 * the self-fill loops that never buy an empty journal — see the module header.
 *
 * Always returns an object:
 *   { pricePerFame, margin, fullGross, fullNet, emptyCost, fullCity, emptyCity,
 *     maxfame, hasData }
 */
function getJournalFamePrice({ slug, tier, maxfame, marketData, cities, emptyFree } = {}) {
  const none = {
    pricePerFame: 0, margin: 0, fullGross: 0, fullNet: 0, emptyCost: 0,
    fullCity: null, emptyCity: null, maxfame: maxfame || 0, hasData: false,
  };
  if (!slug || !(tier > 0) || !(maxfame > 0) || !marketData) return none;
  if (typeof findBestSellCity !== "function" || typeof findBestBuyCity !== "function") return none;

  const list = (cities && cities.length)
    ? cities
    : ((typeof _laborerCityCandidates === "function") ? (_laborerCityCandidates().cities || []) : []);

  // The flag is part of the key: the same journal has two legitimate fame prices
  // (paid-empty for the Journal Filling play, free-empty for the self-fill loops)
  // and one must never be served from the other's entry. So is the CITY LIST —
  // the self-fill loops ask per city (a journal bought and sold where the
  // laborer works), and a one-city answer must never be served from the
  // all-cities entry or the arbitrage comes back through the cache.
  const key = `${slug}|${tier}|${emptyFree ? "F" : "P"}|${list.join(",")}`;
  const fullId = `T${tier}_JOURNAL_${slug}_FULL`;
  const emptyId = `T${tier}_JOURNAL_${slug}_EMPTY`;
  // Named before the cache is consulted: a hit reads no market data, and the
  // Crafting Planner's row cache must still learn this row depends on them.
  if (typeof recordPriceDependency === "function") recordPriceDependency(fullId, emptyId);
  let bucket = null;
  if (_jfpCache) {
    // A bucket lives for one render pass (js/app.js renderPassSeq): every
    // change to the price map schedules a pass, so a bucket from an older pass
    // may hold a price the map no longer has.
    const epoch = (typeof renderPassSeq !== "undefined") ? renderPassSeq : 0;
    bucket = _jfpCache.get(marketData);
    if (!bucket || bucket.epoch !== epoch) {
      bucket = new Map();
      bucket.epoch = epoch;
      _jfpCache.set(marketData, bucket);
    }
    const hit = bucket.get(key);
    if (hit) return hit;
  }

  const full = findBestSellCity(marketData, fullId, list, _jfpMinVol("sell"));
  const empty = findBestBuyCity(marketData, emptyId, list, _jfpMinVol("buy"));
  const fullGross = (full && full.price) || 0;
  const emptyCost = (empty && empty.price) || 0;

  // Which legs must price depends on which play the fame is being valued for.
  // Paid-empty: both — a full journal with no empty to replace it is not the
  // alternative play, since that play buys an empty every cycle. Free-empty: the
  // full sell alone, because nothing is bought.
  if (!(fullGross > 0) || (!emptyFree && !(emptyCost > 0))) {
    if (bucket) bucket.set(key, none);
    return none;
  }

  // calcJournalEconomics owns the sales tax, so passing 0 for the empty gives the
  // free-empty price without this file ever knowing the tax rate.
  const paidEmpty = emptyFree ? 0 : emptyCost;
  const econ = (typeof calcJournalEconomics === "function")
    ? calcJournalEconomics({ emptyCost: paidEmpty, fullGross, maxfame })
    : { fullNet: fullGross, marginPerJournal: fullGross - paidEmpty, silverPerFame: (fullGross - paidEmpty) / maxfame };

  const out = {
    // Floored at 0 — see the module header.
    pricePerFame: Math.max(0, econ.silverPerFame),
    margin: econ.marginPerJournal,
    fullGross,
    fullNet: econ.fullNet,
    // What the play actually pays for an empty — 0 when the laborer returns it.
    emptyCost: paidEmpty,
    fullCity: full.city || null,
    emptyCity: emptyFree ? null : (empty.city || null),
    maxfame,
    hasData: true,
  };
  if (bucket) bucket.set(key, out);
  return out;
}

/**
 * The fame bill for filling one journal: `pricePerFame × maxfame`, i.e. the
 * margin you gave up by not selling it. Zero when the tier has no market data,
 * which is the safe direction — the caller then reports a gross figure.
 */
function getJournalFameCost(famePrice, maxfame) {
  if (!famePrice || !(famePrice.pricePerFame > 0) || !(maxfame > 0)) return 0;
  return famePrice.pricePerFame * maxfame;
}

/**
 * THE BILL EVERY SELF-FILL LOOP CHARGES, in both of its readings.
 *
 *   margin = full sell net of tax − empty buy   ← RANKED
 *   full   = full sell net of tax               ← reported BOUND
 *
 * WHY THE MARGIN IS THE RANKED ONE. The self-fill loop itself never buys an
 * empty journal — the laborer hands the same one back every cycle — and that is
 * still true. But the bill is not what the loop pays, it is what the ALTERNATIVE
 * play would have earned, and that play is "fill it and SELL it full". Sell the
 * journal and it is gone: to run the alternative again you buy another empty. So
 * the empty sits on the alternative's side of the ledger, exactly as it does in
 * the Journal Filling table, and the two plays compared per cycle differ by the
 * MARGIN. Charging the whole full sale instead double-counted the journal — it
 * valued the fame at a sale that also liquidates an asset the self-fill loop
 * keeps — which made buy-the-filled-journal beat self-fill by roughly an empty
 * journal's price on essentially every row.
 *
 * The whole full sale is still reported as `full`: it is the honest pessimistic
 * reading (liquidate the journal and never replace it), and the cells quote it
 * beside the ranked figure rather than picking one behind the user's back.
 *
 * `basis` says which reading the ranked figure came from:
 *   "margin" — both legs price. The normal case, and the ONLY one that bills.
 *   "full"   — the full journal trades but no empty does, so there is no margin
 *              to compute. The bill is 0 and `hasData` is false; `full` still
 *              carries the liquidation reading for the cell to quote. It used to
 *              fall back to that whole sale, on the reasoning that billing such
 *              a tier nothing would let it beat tiers billed in full. That
 *              reasoning belonged to a model where the bill decided the ranking;
 *              it no longer does (self-fill is ranked on its own payload, see
 *              js/laborer-self-fill.js), and charging a fabricated bill roughly
 *              twice the real margin is exactly what made the thinnest journal
 *              markets — fisherman empties above all — look unplayable.
 *   "none"   — the full journal has no price either, so the fame cannot be
 *              valued at all.
 *
 * Both legs come from getJournalFamePrice, so the floor-at-0 rule, the tax and
 * the per-marketData cache are shared — this is a resolver, not a second model.
 */
function getJournalFameBill({ slug, tier, maxfame, marketData, cities } = {}) {
  const margin = getJournalFamePrice({ slug, tier, maxfame, marketData, cities });
  const full = getJournalFamePrice({ slug, tier, maxfame, marketData, cities, emptyFree: true });
  const leg = (p) => ({
    pricePerFame: p.pricePerFame,
    cost: getJournalFameCost(p, maxfame),
    hasData: p.hasData,
  });
  const m = leg(margin);
  const f = leg(full);

  const basis = margin.hasData ? "margin" : (full.hasData ? "full" : "none");
  const ranked = basis === "margin" ? m : { pricePerFame: 0, cost: 0 };

  return {
    pricePerFame: ranked.pricePerFame,
    cost: ranked.cost,
    basis,
    // Only a real margin is a real bill. "full" means the comparison cannot be
    // made, not that it can be made pessimistically.
    hasData: basis === "margin",
    margin: m,
    full: f,
    // The underlying prices, for the cells that explain themselves.
    fullGross: full.fullGross || margin.fullGross || 0,
    fullNet: full.fullNet || margin.fullNet || 0,
    emptyCost: margin.emptyCost || 0,
    fullCity: full.fullCity || margin.fullCity || null,
    emptyCity: margin.emptyCity || null,
    maxfame: maxfame || 0,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getJournalFamePrice, getJournalFameCost, getJournalFameBill, resetJournalFamePriceCache };
}
