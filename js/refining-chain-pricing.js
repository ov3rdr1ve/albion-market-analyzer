// Refining-chain pricing: recursive market-vs-chain sourcing for refined
// materials in the Refining/Transports table. Mirrors the consumables
// chain-pricing pattern (chain-pricing.js) but with refining-specific math:
//
//   chainCost = (marketPart*ratio + secCost*count) * (1 - rrr) * (1 + SETUP_FEE)
//             + feePart * (1 - rrr)                  // transmute silver + fees
//                                                    // inherited from below:
//                                                    // consumed, but never bought
//             + refineStationFeeSilver(producedId)   // nutrition scales with
//                                                    // tier AND enchant
//
// Public API:
//   getRefiningSourcing(matId, marketData, refineCity, useFocus, depth?)
//     -> { perUnit, feePerUnit, source: "market"|"chain", city?, chain? }
//
// FOCUS INVARIANT — a chain is always BUILT at base RRR. `useFocus` here means
// "would this ladder be run with focus at its own top step", not "spend focus at
// every rung": it is applied at depth 0 and nowhere below. Focus is a per-refine
// charge, so a T7 ladder discounted at all six rungs prices six focus spends for
// the cost of one — which is not a play anyone can run, and it leaks into the
// market-vs-chain gate below, chain-refining bars that should just be bought.
// The one-tier model lives in _chainCostWithFocusAtTier / pickCheapestFocusTier:
// build the ladder focus-off, let the picker name the tier, then re-price there.
// Every caller does exactly that (js/craft-planner-pricing.js _cpRefineFocusedSourcing,
// js/refining-route.js computeRefineRouteForCity), so in practice `useFocus` is
// false at every call site and the parameter exists only for the depth-0 contract.
//
// ChainNode shape:
//   { produces, output: 1, station, refineCity, rrr, focusCost, tier,
//     resourceType,
//     inputs: [
//       { matId: rawId,       count: rawRatio,         sourcing: {...} },
//       { matId: secondaryId, count: secondaryMatCount, sourcing: {...} },
//     ],
//     costPerOutput }
//
// Caerleon ↔ Royal split: in BMR-off mode, every chain leaf must be sourced
// from a city compatible with the refine city. City-force overrides are
// respected only when compatible (matches render-transport.js:30-31).
//
// Faction hearts: a heart stands in for ONE unit of the biome RAW resource in a
// T4+ refine (Treeheart→wood, etc.; RRR-exempt — fully consumed), via the helpers
// getHeartSubstitute / chooseRawWithHeart below.
//
// Two callers, two entry points. The Refining / Transports table substitutes on
// its OWN top-level raw (resolveRefineRawHeart, js/refining-route.js) and uses
// this chain only for the refine-the-secondary sub-tree, so the chain stays
// heart-free for it. The Crafting Planner has no row-level raw — the chain IS how
// it reaches one — so it opts in with `opts.heartRaw`, which applies a heart at
// the ROOT refine only (depth 0). Lower tiers refine cheaper raws where a heart
// rarely wins, and hearts are scarce. getRefiningChainIds pre-fetches each
// resource's heart id either way, so the price is on hand.

// Build the zone-compatible buy-city pool for a given refine city (Caerleon↔Royal
// split, Smuggler's Den unreachable — see isValidSourceCity in js/utils.js).
// `opts.buyCities` narrows the pool to a caller-supplied list — the Crafting
// Planner's Buy City pick (js/table-sell-city.js effectiveBuyCities). Absent, as
// it is for every other caller, the answer is unchanged: every zone-valid city.
function getValidBuyCitiesForRefine(refineCity, opts) {
  const all = (typeof isValidSourceCity !== "function")
    ? CITIES
    : CITIES.filter((c) => isValidSourceCity(c, refineCity));
  if (!opts || !Array.isArray(opts.buyCities)) return all;
  return all.filter((c) => opts.buyCities.includes(c));
}

// Where a refine of `resourceType` actually happens, given the city the caller
// is anchored to (the Refining table's own refine city, or the Crafting
// Planner's CRAFT city).
//
// The +40% local production bonus belongs to the refining STATION, and every
// city has one — nothing ties refining to where the bar is later crafted, and
// royal-to-royal hauling is free in this model, the same assumption the
// consumables butcher chain already makes (buy the animal cheapest, butcher in
// the spec city). Refining a bar for a Martlock axe in Martlock rather than
// Thetford threw away 58 PB worth of return rate.
//
// Falls back to the anchor when the resource has no spec city or the spec city
// is out of zone (Caerleon anchor with Black/Red Zone Routes off).
function getRefineCityFor(resourceType, anchorCity) {
  if (!resourceType || !anchorCity) return anchorCity;
  if (typeof CITY_REFINE_SPEC === "undefined") return anchorCity;
  const specCity = Object.keys(CITY_REFINE_SPEC).find(
    (city) => CITY_REFINE_SPEC[city] === resourceType,
  );
  if (!specCity || specCity === anchorCity) return anchorCity;
  if (typeof isValidSourceCity === "function" && !isValidSourceCity(specCity, anchorCity)) {
    return anchorCity;
  }
  return specCity;
}

// Per-unit Brecilien Travel Planner fee for hauling matId from `city` to the
// refine city. 0 when the fee isn't applicable (no Brecilien leg, or
// legBrecilienCost isn't loaded — e.g. in a stripped-down test sandbox).
function _brecilienFeePerUnit(matId, city, refineCity) {
  if (typeof legBrecilienCost !== "function") return 0;
  if (!city || !refineCity) return 0;
  return legBrecilienCost(city, refineCity, matId, 1);
}

// Find the cheapest market buy across cities compatible with refineCity.
// Ranks candidates by effective cost (price + per-unit Brecilien exit fee) so
// Brecilien only wins when it actually beats other royals after the haul,
// mirroring render-transport.js:99-136. Returns `travelFeePerUnit` so callers
// can fold the fee into chain cost without re-deriving geography.
// Honors a city-force override only when the forced city is compatible
// (mirrors render-transport.js:30-31); for forced picks the fee is reported
// but not used for ranking (the user pinned the source).
//
// `opts.minVolume` (default 0 — no gate, which is what every existing caller
// wants) skips a city whose 24h volume is below it, with the standard escape for
// a hand-edited price (js/utils.js:1120-1123). A PINNED city ignores the gate:
// the pin means "source it here". The Refining table passes its own MIN_VOLUME
// so the transmute substitute's leaves are gated exactly like its raw leg.
function findCheapestMarketBuyForRefine(matId, marketData, refineCity, opts) {
  const cities = getValidBuyCitiesForRefine(refineCity, opts);
  const minVolume = (opts && opts.minVolume) || 0;
  const itemData = marketData ? marketData[matId] : null;
  const bounds = (typeof getIQRBounds === "function") ? getIQRBounds(itemData) : { upper: Infinity };
  const forced = (typeof getCityForce === "function") ? getCityForce(matId, "buy") : null;
  // A pinned city still has to be one the caller allows: an explicit Buy City
  // pick outranks the pin a typed override left behind, exactly as the table's
  // sell pick outranks a sell pin (js/table-sell-city.js).
  const forceValid = forced && cities.includes(forced) &&
    (typeof isValidSourceCity !== "function" || isValidSourceCity(forced, refineCity));
  if (forceValid) {
    const p = getBuyPrice(itemData, forced, bounds, matId);
    const fee = _brecilienFeePerUnit(matId, forced, refineCity);
    return { city: forced, price: p > 0 ? p : 0, travelFeePerUnit: fee };
  }
  let bestEff = Infinity, bestPrice = 0, bestCity = null, bestFee = 0;
  for (const c of cities) {
    const p = getBuyPrice(itemData, c, bounds, matId);
    if (p <= 0) continue;
    if (minVolume > 0) {
      const vol = (itemData && itemData[c] && itemData[c].volume_24h) || 0;
      const edited = (typeof getOverridePrice === "function")
        && getOverridePrice(matId, c) !== null;
      if (vol < minVolume && !edited) continue;
    }
    const fee = _brecilienFeePerUnit(matId, c, refineCity);
    const eff = p + fee;
    if (eff < bestEff) {
      bestEff = eff;
      bestPrice = p;
      bestCity = c;
      bestFee = fee;
    }
  }
  return {
    city: bestCity,
    price: bestCity ? bestPrice : 0,
    travelFeePerUnit: bestCity ? bestFee : 0,
  };
}

// Price the faction heart for the given resourceType (Treeheart for wood, etc.).
// A heart stands in for ONE unit of the biome's RAW resource in a T4+ refine
// (wiki: "replace ... the main resource of the Biome"; e.g. one expensive 8.2
// fiber), of any tier/enchant. Priced at market via the same helper as any
// other leaf, so it honors the Caerleon↔Royal split, Brecilien exit fee and
// city-force. Returns null when the resource has no heart (Caerleon) or the
// heart has no usable price.
function getHeartSubstitute(resourceType, marketData, refineCity, opts) {
  const heartId = (typeof HEART_BY_RESOURCE !== "undefined")
    ? HEART_BY_RESOURCE[resourceType] : null;
  if (!heartId) return null;
  const m = findCheapestMarketBuyForRefine(heartId, marketData, refineCity, opts);
  if (!m.city || m.price <= 0) return null;
  return {
    perUnit: m.price,
    source: "heart",
    heartId,
    city: m.city,
    travelFeePerUnit: m.travelFeePerUnit || 0,
  };
}

// Whether a heart substitution is legal for this refine at all, independent of
// price. Three carve-outs, all from items.xml rather than the wiki:
//   • below T4 — the token swap exists only in the "Tier 4 and above" refining
//     recipes, so the T2/T3 steps at the bottom of the ladder buy raw outright.
//   • .4 / pristine — T*_<REFINED>_LEVEL4 carries a single craftingrequirements
//     block, while .0-.3 each carry a second one that swaps a raw for the token.
//   • enchanted RAW rock — it refines into PLAIN blocks and the Rockheart recipe
//     exists only for plain rock, so any rock raw with an enchant is out.
// Shared by the row-level path (resolveRefineRawHeart, js/refining-route.js) and
// the chain-level one below, so the two can never drift apart.
const HEART_MIN_TIER = 4;
function heartAllowedForRaw(resourceType, rawId) {
  const tierMatch = rawId && String(rawId).match(/^T(\d+)_/);
  if (!tierMatch || parseInt(tierMatch[1], 10) < HEART_MIN_TIER) return false;
  const enchMatch = rawId && String(rawId).match(/@(\d+)$/);
  const ench = enchMatch ? parseInt(enchMatch[1], 10) : 0;
  if (ench >= 4) return false;
  if (resourceType === "rock" && ench >= 1) return false;
  return true;
}

// Decide whether to replace ONE of the `rawRatio` RAW units with a faction heart
// in a refine. A market raw unit is RRR-eligible; the heart is RRR-EXEMPT (fully
// consumed), so the heart wins only when heartCost < rawUnitCost*(1-rrr). Returns
// the kept market-raw count, the heart's (non-returnable) silver cost + travel,
// and heart display info. The secondary is untouched (the heart never replaces
// the refined secondary — that was a Tier-3 input in T4 refines, which the wiki
// "Tier 4 and above" rule excludes).
function chooseRawWithHeart(rawPrice, heartSrc, rawRatio, rrr) {
  const out = { usedHeart: false, rawKeptCount: rawRatio, heartCost: 0, heartTravelTotal: 0, heart: null };
  if (!heartSrc || rawRatio < 1) return out;
  const heartEff = (heartSrc.perUnit || 0) + (heartSrc.travelFeePerUnit || 0);
  if (heartEff >= (rawPrice || 0) * (1 - rrr)) return out; // a raw unit is cheaper after RRR
  out.usedHeart = true;
  out.rawKeptCount = rawRatio - 1;
  out.heartCost = heartSrc.perUnit || 0;            // 1 unit, RRR-exempt (fee tracked separately)
  out.heartTravelTotal = heartSrc.travelFeePerUnit || 0;
  out.heart = { id: heartSrc.heartId, price: heartSrc.perUnit, city: heartSrc.city, count: 1 };
  return out;
}

// Cheapest way to ARRIVE at the chain's raw leg. Market only by default; with
// `opts.transmuteRaw` a cheaper lower node of the same family plus the transmute
// silver + station fees can win instead (js/refining-transmute-substitute.js).
//
// The gate exists because the two tables reach their raws differently. The
// Refining / Transports table substitutes on its OWN top-level raw
// (refining-route.js) and uses this chain only for the refine-the-secondary
// sub-tree, so opening it there would change numbers nobody asked to change.
// The Crafting Planner has no row-level raw at all — the chain IS how it reaches
// one — so without this it could never offer a transmute, and an ENCHANTED
// planner material can be reached no other way: refined ids (T6_PLANKS_LEVEL2@2)
// don't transmute, only the raw below them does.
//
// The route's own Brecilien exit fee is already inside `perUnit`, so the returned
// sourcing carries travelFeePerUnit 0 — charging the haul again would double-count.
function _refineRawSourcing(rawId, marketData, refineCity, opts) {
  const market = findCheapestMarketBuyForRefine(rawId, marketData, refineCity, opts);
  const base = {
    perUnit: market.price,
    feePerUnit: 0,
    source: "market",
    city: market.city,
    travelFeePerUnit: market.travelFeePerUnit || 0,
  };
  if (!opts || !opts.transmuteRaw || typeof resolveRefineRawSource !== "function") return base;
  // Only the buy-city constraint travels into the transmute DP; the other opts
  // (minVolume, transmuteRaw, heartRaw) are the caller's own gates and the DP
  // has always applied its own.
  const r = resolveRefineRawSource(rawId, market.price, market.city, refineCity, marketData,
    (opts && Array.isArray(opts.buyCities)) ? { buyCities: opts.buyCities } : undefined);
  if (!r || !r.transmute) return base;
  return {
    perUnit: r.perUnit,
    // Transmute silver + step station fees: RRR-eligible, but not a market buy.
    feePerUnit: r.feePerUnit || 0,
    source: "transmute",
    city: r.transmute.startCity,
    travelFeePerUnit: 0,
    transmute: r.transmute,
  };
}

// Recursively price a chain rooted at matId. Returns null when any required
// raw leaf has no price (caller falls back to market). Depth guard 5 to
// prevent accidental cycles in future data edits.
//
// `opts` is `{ transmuteRaw, heartRaw }` — see _refineRawSourcing and the heart
// block further down.
function buildRefiningChain(matId, marketData, refineCity, useFocus, depth, opts) {
  const d = depth || 0;
  if (d > 5) return null;
  const recipe = REFINING_RECIPES[matId];
  if (!recipe || recipe.tier < MIN_CHAIN_TIER) return null;

  // The station's city, which is not necessarily the caller's. Resolution is
  // idempotent (the spec city resolves to itself) and a ladder never changes
  // resource type on the way down, so handing `refineAt` to the recursion below
  // keeps every node of one chain in the same city.
  const refineAt = getRefineCityFor(recipe.resourceType, refineCity);
  // Depth 0 only — see the FOCUS INVARIANT at the top of this file. Focus is a
  // per-refine charge, so it can be spent at one step of a ladder, never at all
  // of them; the sub-tree below is always priced at base RRR.
  const rrr = getRefineRRR(refineAt, recipe.resourceType, useFocus && d === 0);
  const stationFee = refineStationFeeSilver(matId);

  // Raw input — market, or a transmute route when the caller opted in. An
  // unlisted raw only kills the chain when there is no transmute route either
  // (the same relaxation refining-route.js makes at row level).
  const rawSrc = _refineRawSourcing(recipe.rawId, marketData, refineAt, opts);
  if (rawSrc.perUnit <= 0) return null;

  // Secondary input — recursive (market vs chain). A T2 refine has none: it is
  // the bottom of the ladder and consumes raw only (refining-chain-recipes.js).
  const secSrc = recipe.secondaryMatId
    ? getRefiningSourcing(recipe.secondaryMatId, marketData, refineAt, false, d + 1, opts)
    : null;
  if (recipe.secondaryMatId && (!secSrc || secSrc.perUnit <= 0)) return null;

  // Effective per-unit prices include the Brecilien Travel Planner exit fee
  // when a market leaf is sourced from Brecilien. The fee scales with units
  // consumed, so it gets the same (1-rrr) discount as the raw price itself.
  // Chain-sourced secondaries already include any deeper Brecilien fees in
  // their costPerOutput, so secTravelFeePerUnit is 0 for those.
  //
  const rawTravelFeePerUnit = rawSrc.travelFeePerUnit || 0;
  const secTravelFeePerUnit = secSrc && secSrc.source === "market" ? (secSrc.travelFeePerUnit || 0) : 0;
  const rawEff = rawSrc.perUnit + rawTravelFeePerUnit;

  // Heart substitution, opt-in via `opts.heartRaw` and only at the ROOT refine.
  //
  // The gate mirrors _refineRawSourcing's: the Refining / Transports table
  // substitutes on its OWN top-level raw (refining-route.js) and uses this chain
  // only for the refine-the-secondary sub-tree, so opening it there would change
  // numbers nobody asked to change. The Crafting Planner has no row-level raw —
  // the chain IS how it reaches one — so without this it could never use a heart.
  //
  // Depth 0 only: a heart replaces one raw unit wherever it is spent, so it earns
  // most at the refine with the dearest raw, which is the root. Lower chain tiers
  // refine cheaper raws where a heart rarely wins, and letting every level claim
  // one would spend hearts the player does not have.
  const heartSub = (opts && opts.heartRaw && d === 0
      && typeof heartAllowedForRaw === "function"
      && heartAllowedForRaw(recipe.resourceType, recipe.rawId)
      && typeof getHeartSubstitute === "function")
    ? chooseRawWithHeart(
        rawEff, getHeartSubstitute(recipe.resourceType, marketData, refineAt, opts),
        recipe.rawRatio, rrr)
    : null;
  const rawCount = heartSub && heartSub.usedHeart ? heartSub.rawKeptCount : recipe.rawRatio;
  // The heart is fully consumed, so it sits OUTSIDE the (1-rrr) discount — but
  // it is still a buy-side purchase and pays the setup fee (calculations.js).
  const heartNonReturnable = heartSub && heartSub.usedHeart
    ? heartSub.heartCost + heartSub.heartTravelTotal : 0;

  const rawCost = rawEff * rawCount;
  const secCost = secSrc ? (secSrc.perUnit + secTravelFeePerUnit) * recipe.secondaryMatCount : 0;

  // Part of the input cost that was never bought at market: this step's transmute
  // silver and every station fee inherited from the sub-chain. It is consumed like
  // the rest (so it keeps the (1-rrr) discount) but pays no buy-order setup fee.
  // `feePerOutput` carries the same figure — plus THIS refine's station fee —
  // up to the parent step, so the exemption survives the whole ladder.
  const feeCost = (rawSrc.feePerUnit || 0) * rawCount
    + (secSrc ? (secSrc.feePerUnit || 0) * recipe.secondaryMatCount : 0);
  const silverCost =
    ((rawCost + secCost - feeCost) * (1 - rrr) + heartNonReturnable) * (1 + SETUP_FEE)
    + feeCost * (1 - rrr) + stationFee;
  const feePerOutput = feeCost * (1 - rrr) + stationFee;

  const inputs = [{ matId: recipe.rawId, count: rawCount, sourcing: rawSrc }];
  if (secSrc) {
    inputs.push({
      matId: recipe.secondaryMatId,
      count: recipe.secondaryMatCount,
      sourcing: secSrc,
    });
  }
  if (heartSub && heartSub.usedHeart) {
    inputs.push({
      matId: heartSub.heart.id,
      count: 1,
      noReturn: true,
      replacesMatId: recipe.rawId,
      sourcing: {
        perUnit: heartSub.heart.price,
        source: "heart",
        city: heartSub.heart.city,
        travelFeePerUnit: heartSub.heartTravelTotal,
      },
    });
  }

  return {
    produces: matId,
    output: 1,
    station: `Refine ${recipe.resourceType} at ${refineAt}`,
    refineCity: refineAt,
    rrr,
    focusCost: getFocusCost(matId, recipe.tier, "refining"),
    tier: recipe.tier,
    resourceType: recipe.resourceType,
    inputs,
    costPerOutput: silverCost,
    feePerOutput,
  };
}

// Public entry. Picks the cheaper of market vs chain. depth is internal.
//
// Market results surface `travelFeePerUnit` so the parent chain step folds it
// into its own cost basis (see buildRefiningChain). The market-vs-chain
// comparison uses the market's effective per-unit cost (price + Brecilien
// exit fee) — otherwise a cheap-but-Brecilien market price would falsely beat
// a chain whose internal sourcing already accounts for the fee.
function getRefiningSourcing(matId, marketData, refineCity, useFocus, depth, opts) {
  const d = depth || 0;
  const market = findCheapestMarketBuyForRefine(matId, marketData, refineCity, opts);
  const marketFee = market.travelFeePerUnit || 0;
  const marketEff = market.price > 0 ? market.price + marketFee : 0;
  // A market leaf is a pure buy: none of it is setup-exempt.
  const asMarket = () => ({
    perUnit: market.price, feePerUnit: 0, source: "market",
    city: market.city, travelFeePerUnit: marketFee,
  });
  const recipe = REFINING_RECIPES[matId];
  if (!recipe || recipe.tier < MIN_CHAIN_TIER) return asMarket();
  const chain = buildRefiningChain(matId, marketData, refineCity, useFocus, d, opts);
  if (!chain) return asMarket();
  // Treat market.price === 0 as "not available" so chain wins by default.
  if (marketEff > 0 && marketEff <= chain.costPerOutput) return asMarket();
  return {
    perUnit: chain.costPerOutput,
    feePerUnit: chain.feePerOutput || 0,
    source: "chain", city: null, chain,
  };
}

// Recompute chain silver cost assuming focus is applied at exactly one tier
// (focusOnTier). All other tiers use base RRR. Used by the focus-tier
// picker in render-transport.js to find the most profitable single tier
// to spend focus on within a chain.
//
// Mirrors buildRefiningChain's fee handling: market leaves carry
// `travelFeePerUnit` and that fee is added to the per-unit cost (so it scales
// with units consumed and gets the same (1-rrr) discount as the raw price).
// Chain-sourced sub-trees recurse — their own fees are already baked into
// their costPerOutput.
function chainSilverCostWithFocusAtTier(chain, focusOnTier) {
  return _chainCostWithFocusAtTier(chain, focusOnTier).cost;
}

// Same walk, returning the setup-exempt component alongside the cost so a parent
// step can hold it back from its own setup fee — the re-priced twin of
// buildRefiningChain's `feePerOutput`. Public callers want the cost alone.
function _chainCostWithFocusAtTier(chain, focusOnTier) {
  const useFocusHere = chain.tier === focusOnTier;
  const rrr = getRefineRRR(chain.refineCity, chain.resourceType, useFocusHere);

  const rawInput = chain.inputs[0];
  const rawFee = (rawInput.sourcing && rawInput.sourcing.travelFeePerUnit) || 0;
  const rawCost = (rawInput.sourcing.perUnit + rawFee) * rawInput.count;
  let feeCost = ((rawInput.sourcing && rawInput.sourcing.feePerUnit) || 0) * rawInput.count;

  // A T2 refine has no secondary at all (bottom of the ladder), so inputs[1] can
  // be absent — same shape _chainCostGathered already allows for.
  const secInput = chain.inputs[1];
  let secPerUnit = 0;
  if (secInput) {
    if (secInput.sourcing.source === "chain" && secInput.sourcing.chain) {
      const sub = _chainCostWithFocusAtTier(secInput.sourcing.chain, focusOnTier);
      secPerUnit = sub.cost;
      feeCost += sub.fee * secInput.count;
    } else {
      const secFee = (secInput.sourcing && secInput.sourcing.travelFeePerUnit) || 0;
      secPerUnit = secInput.sourcing.perUnit + secFee;
      feeCost += ((secInput.sourcing && secInput.sourcing.feePerUnit) || 0) * secInput.count;
    }
  }
  const secCost = secPerUnit * (secInput ? secInput.count : 0);

  // A heart leg (root refines only) is RRR-exempt, so more RRR from focus never
  // discounts it — it rides outside the (1-rrr) bracket at every focus tier.
  const heartInput = chain.inputs.find((i) => i.sourcing && i.sourcing.source === "heart");
  const heartCost = heartInput
    ? ((heartInput.sourcing.perUnit || 0) + (heartInput.sourcing.travelFeePerUnit || 0)) * heartInput.count
    : 0;

  const stationFee = refineStationFeeSilver(chain.produces);
  return {
    cost: ((rawCost + secCost - feeCost) * (1 - rrr) + heartCost) * (1 + SETUP_FEE)
        + feeCost * (1 - rrr) + stationFee,
    fee: feeCost * (1 - rrr) + stationFee,
  };
}

// Per-output chain cost when the RAW resources are self-gathered instead of
// bought (the "Profit Gathered / 10k Focus" column). A chain refines the
// secondary from lower tiers, and every one of those steps eats raws too — so
// the gathered model has to zero them at every depth, not just at the row's own
// refine. What remains is the refined market leaf the chain bottoms out on
// (a bar is not gatherable), the setup fee on that remainder, and each step's
// station fee.
//
// `focusTier` names the ONE tier focus is spent at, exactly as
// _chainCostWithFocusAtTier does — the two must agree, or the gathered column
// would value a different play from the one the row shows. Omit it and the walk
// falls back to the node's stored rrr, which is the base rate a chain is always
// built with.
//
// A heart leg is deliberately charged at 0 here alongside the raws it stands in
// for: a heart is bought to dodge an expensive raw, and nobody buys one when
// their raws cost nothing.
function chainSilverCostGathered(chain, focusTier) {
  return _chainCostGathered(chain, focusTier).cost;
}

// {cost, fee} twin of the above: `fee` is the station-fee silver a lower step
// contributed, which the step above must keep outside its own setup fee.
function _chainCostGathered(chain, focusTier) {
  if (!chain) return { cost: 0, fee: 0 };
  const rrr = (focusTier === undefined)
    ? chain.rrr
    : getRefineRRR(chain.refineCity, chain.resourceType, chain.tier === focusTier);
  const secInput = chain.inputs[1];
  const secCount = secInput ? secInput.count : 0;
  let secPerUnit = 0, feeCost = 0;
  if (secInput) {
    if (secInput.sourcing.source === "chain" && secInput.sourcing.chain) {
      const sub = _chainCostGathered(secInput.sourcing.chain, focusTier);
      secPerUnit = sub.cost;
      feeCost = sub.fee * secCount;
    } else {
      secPerUnit = (secInput.sourcing.perUnit || 0) + (secInput.sourcing.travelFeePerUnit || 0);
    }
  }
  const secCost = secPerUnit * secCount;
  const stationFee = refineStationFeeSilver(chain.produces);
  return {
    cost: (secCost - feeCost) * (1 - rrr) * (1 + SETUP_FEE)
        + feeCost * (1 - rrr) + stationFee,
    fee: feeCost * (1 - rrr) + stationFee,
  };
}

// Find the chain tier where applying focus yields the highest silver-per-
// focus return. Implements the user's design rule: "focus spends on most
// profitable tier."
//
// Focus only buys extra RRR, so its value at a tier is the silver SAVED by
// turning focus on THERE (and nowhere else) — not the whole chain's profit.
// Ranking by total profit / focusCost was wrong: the chain's base margin is
// near-constant across tiers, so dividing it by the per-tier focus cost (which
// climbs ~9× from T4→T8) mechanically favored the lowest tier. Material value
// climbs faster than focus cost with tier, so the marginal metric correctly
// lands on the highest tier.
//
// For each chain node tier T_i:
//   baseline   = chainSilverCostWithFocusAtTier(rootChain, <no tier>) // focus off everywhere
//   chainCost_i = chainSilverCostWithFocusAtTier(rootChain, T_i)       // focus at T_i only
//   silverSaved_i = baseline − chainCost_i                            // RRR savings, propagated up
//   silverPerFocus_i = silverSaved_i / focusCost(T_i)
//
// `baselineOverride` (optional) replaces that focus-off baseline when the caller
// would not have self-refined at all. The Refining/Transports table always would
// — the row IS the refine — so it passes nothing and keeps the behavior above.
// The Crafting Planner would often just BUY the bar, and measuring against a
// focus-off refine nobody runs wildly overstated what focus buys there (a bar
// bought at 29,085 scored as if the alternative were a 42,181 self-refine).
//
// Returns { tier, focusCost, silverPerFocus, totalCost, focusOffCost } for the
// winning tier, or null when the chain has no node with a positive focus cost.
// (sellPrice is no longer needed — the metric is sale-independent.)
// The chain tier where applying focus (and nowhere else) leaves the lowest
// per-output cost — equivalently, the tier that makes the END PRODUCT most
// profitable, since the output's revenue is the same whichever tier you focus.
// This is the shared Silver/Focus objective (js/focus-play.js) applied to a
// refining ladder, and every caller uses it: the Refining / Transports row picks
// the tier of its own ladder, the Crafting Planner picks the tier of a material's
// ladder.
//
// Ranking by silver-per-focus instead was the earlier rule and is wrong for this
// objective: a low tier is often the most efficient per focus point while saving
// almost nothing in absolute silver, so the row was told to focus T4 when
// focusing T8 left the finished product several thousand silver richer. (Ranking
// by the chain's TOTAL profit ÷ focus cost was wrong for the opposite reason: the
// base margin is near-constant across tiers, so dividing it by a focus cost that
// climbs ~9× from T4→T8 mechanically favored the lowest tier.)
//
// For each chain node tier T_i:
//   focusOffCost = chainSilverCostWithFocusAtTier(rootChain, -1)  // focus nowhere
//   cost_i       = chainSilverCostWithFocusAtTier(rootChain, T_i) // focus at T_i only
//   silverSaved_i = focusOffCost − cost_i    // RRR saving, propagated up the ladder
// and the winner is argmax(silverSaved_i) = argmin(cost_i).
//
// Callers that would NOT have self-refined at all (the Crafting Planner often
// just buys the bar) must not baseline against focusOffCost — they compare
// `totalCost` against what they actually pay; see getRefineFocusValue.
//
// Returns { tier, focusCost, silverSaved, totalCost, focusOffCost } for the
// winning tier, or null when no node has a positive focus cost.
function pickCheapestFocusTier(chain) {
  if (!chain) return null;
  const focusOffCost = chainSilverCostWithFocusAtTier(chain, -1);
  let best = null;
  for (let node = chain; node; ) {
    if (node.focusCost > 0) {
      // `fee` rides along so a caller comparing totalCost against a MARKET price
      // can apply the setup fee to the market side only (see getRefineFocusValue).
      const { cost, fee } = _chainCostWithFocusAtTier(chain, node.tier);
      if (!best || cost < best.totalCost) {
        best = { tier: node.tier, focusCost: node.focusCost,
                 silverSaved: focusOffCost - cost, totalCost: cost, fee, focusOffCost };
      }
    }
    const sec = node.inputs[1];
    node = (sec && sec.sourcing.source === "chain") ? sec.sourcing.chain : null;
  }
  return best;
}

// Walk the chain tree and check if any market leaf has a user override.
// Used by render-transport.js to set hasOverride on chain rows so the
// "show all" filter behaves correctly.
function chainHasOverride(chain) {
  if (!chain) return false;
  for (const inp of chain.inputs) {
    if (inp.sourcing.source === "chain") {
      if (chainHasOverride(inp.sourcing.chain)) return true;
    } else if (inp.sourcing.source === "transmute") {
      // The leaf the user can actually price here is the node the route BUYS,
      // not the raw the recipe names — that one is produced, never purchased.
      const t = inp.sourcing.transmute || {};
      if (typeof getOverridePrice === "function" &&
          getOverridePrice(t.startId, t.startCity) !== null) return true;
    } else if (inp.sourcing.source === "market") {
      if (typeof getOverridePrice === "function" &&
          getOverridePrice(inp.matId, inp.sourcing.city) !== null) return true;
    }
  }
  return false;
}

// Walk the chain recipe tree and collect every matId that needs market
// data. Called by getAllRequiredItemIds (utils.js) so intermediate-tier
// raws are pre-fetched in the API batch — without this, chain leaves
// would have no market data and chain pricing would silently return 0.
function getRefiningChainIds(matId, out, opts) {
  const set = out || new Set();
  const r = REFINING_RECIPES[matId];
  if (!r || r.tier < MIN_CHAIN_TIER) return set;
  set.add(r.rawId);
  // T2 refines from raw alone — no secondary id to fetch, and adding a null here
  // would put a bogus entry in the scan batch.
  if (r.secondaryMatId) set.add(r.secondaryMatId);
  // Every node the raw-transmute DP can read. Without these prices it sees
  // zeros and silently never substitutes, so the id set has to grow with the
  // gate that turns the substitution on.
  if (opts && opts.transmuteRaw && typeof getRawTransmuteIds === "function") {
    getRawTransmuteIds(r.rawId, set);
  }
  // The faction heart that can substitute for one raw unit of this resource, so
  // its market price is pre-fetched on every scan path (global + transport-only).
  // Gated by the same rule the substitution itself uses, so the T2/T3 steps do
  // not pull a heart price nothing can spend.
  if (typeof HEART_BY_RESOURCE !== "undefined" && HEART_BY_RESOURCE[r.resourceType]
      && (typeof heartAllowedForRaw !== "function" || heartAllowedForRaw(r.resourceType, r.rawId))) {
    set.add(HEART_BY_RESOURCE[r.resourceType]);
  }
  if (REFINING_RECIPES[r.secondaryMatId]) getRefiningChainIds(r.secondaryMatId, set, opts);
  return set;
}
