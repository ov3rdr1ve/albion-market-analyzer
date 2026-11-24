// Transmute substitution for the RAW input of a refine (Refining/Transports table).
//
// A refine consumes `rawRatio` units of a biome raw (e.g. 5x 8.4 fiber). Pristine
// and high-enchant raws are thin and expensive, while the node one step below is
// often cheap: buying THAT and transmuting it up can beat buying the raw outright.
//
//   perUnit = startMarketPrice + startBrecilienExitFee
//           + Σ transmuteSilver(step) + Σ stationUsageFee(step)
//
// Two differences from the faction-heart substitute (refining-chain-pricing.js):
//   - the transmuted raw IS a raw, so it is RRR-eligible (the heart is consumed);
//   - it replaces ALL rawRatio units, not just one.
// Both live at the row level (render-transport.js); the refine-the-secondary chain
// stays market-sourced on its raw leg.
//
// Fee tables, the tier/enchant grid and the nutrition model come from
// data-transmute.js — this file only searches the grid for the cheapest way to
// ARRIVE at a given raw, whereas the Transmute table searches for the most
// profitable way to LEAVE one.
//
// Public API:
//   parseTransmuteNode(id)        -> { family, tier, enchant } | null
//   getRawTransmuteSourcing(rawId, marketData, refineCity, opts) -> route | null
//   resolveRefineRawSource(rawId, marketPrice, marketCity, refineCity, marketData, opts)
//                                 -> { perUnit, feePerUnit, transmute }
//   getRawTransmuteIds(rawId, out)-> Set of every grid node id (scan pre-fetch)
//
// `opts.minVolume` gates the DP's market leaves the way the caller gates its own
// buy legs — see getRawTransmuteSourcing.

// Only the five raw resource families transmute. Refined ids (PLANKS/METALBAR/…),
// faction tokens and gear never match, so they get no substitution.
const TRANSMUTE_NODE_RE = /^T([2-8])_(WOOD|ORE|FIBER|HIDE|ROCK)(?:_LEVEL([1-4])@[1-4])?$/;

function parseTransmuteNode(id) {
  const m = typeof id === "string" && id.match(TRANSMUTE_NODE_RE);
  if (!m) return null;
  return { family: m[2], tier: parseInt(m[1], 10), enchant: m[3] ? parseInt(m[3], 10) : 0 };
}

// Fee for the single step that ARRIVES at (tier, enchant), or null when the game
// has no such transmute. Stone has a tier-up table of its own and no enchant axis
// at all — enchanted rock exists and trades, but it cannot be transmuted.
function transmuteStepFee(family, kind, tier, enchant) {
  if (kind === "tier") {
    if (family === "ROCK") return enchant === 0 ? (TRANSMUTE_STONE_TIERUP_COST[tier] ?? null) : null;
    return TRANSMUTE_TIERUP_COST[tier]?.[enchant] ?? null;
  }
  if (family === "ROCK") return null;
  return TRANSMUTE_ENCHANTUP_COST[tier]?.[enchant] ?? null;
}

// Station usage fee for one transmute step. Wood/ore/fiber/hide steps read the
// measured per-step grid (transmuteStepNutrition); stone falls back to the linear
// silver model. Keyed by the RESULTING (tier, enchant) — the coords the DP is
// arriving at — so it matches the Transmute table row for the same step.
function transmuteStepStationFee(family, kind, resultTier, resultEnchant, fee) {
  if (typeof calcStationFeeSilver !== "function") return 0;
  const nutrition = (typeof transmuteStepNutrition === "function")
    ? transmuteStepNutrition(kind, resultTier, resultEnchant, family, fee)
    : (typeof transmuteNutrition === "function" ? transmuteNutrition(fee) : 0);
  return calcStationFeeSilver(resultTier, 1, nutrition);
}

// Cheapest all-in cost to ARRIVE at `rawId`, either by buying it (market) or by
// buying a lower node of the same family and transmuting up. Solved as a small
// grid DP over tier 4..target × enchant 0..target: both predecessors of a node
// (one tier down, one enchant down) are resolved before the node itself, so a
// single ascending sweep finds the minimum. Market leaves are priced through
// findCheapestMarketBuyForRefine, inheriting the Caerleon↔Royal split, the
// Brecilien exit fee and city-force overrides.
//
// Returns null when the raw is cheapest bought directly (no substitution) or when
// no route is priced at all. Otherwise the winning route, cheapest path first.
//
// `opts.minVolume` is passed straight through to every leaf lookup, so a caller
// that gates its own raw buy on 24h volume gates the substitution's start nodes
// on the same number — otherwise a thin listing the caller would never buy could
// still trigger "buy the node below and transmute it up". Callers that gate
// nothing (the chain path, and through it the Crafting Planner) omit it.
function getRawTransmuteSourcing(rawId, marketData, refineCity, opts) {
  const target = parseTransmuteNode(rawId);
  if (!target || typeof findCheapestMarketBuyForRefine !== "function") return null;
  // The transmute grid starts at T4: below it the game has no transmute at all.
  if (target.tier < 4) return null;

  const { family } = target;
  const key = (t, e) => `${t},${e}`;
  const nodes = {};   // key -> { cost, city, produced, viaKey, step }

  for (let t = 4; t <= target.tier; t++) {
    for (let e = 0; e <= target.enchant; e++) {
      const id = transmuteResourceId(family, t, e);
      let best = Infinity, city = null, produced = false, viaKey = null, step = null;

      const m = findCheapestMarketBuyForRefine(id, marketData, refineCity, opts);
      if (m.city && m.price > 0) {
        best = m.price + (m.travelFeePerUnit || 0);
        city = m.city;
      }

      const relax = (predKey, kind) => {
        const pred = nodes[predKey];
        if (!pred) return;
        const fee = transmuteStepFee(family, kind, t, e);
        if (fee == null) return;
        const stationFee = transmuteStepStationFee(family, kind, t, e, fee);
        const cost = pred.cost + fee + stationFee;
        if (cost >= best) return;
        best = cost; city = pred.city; produced = true; viaKey = predKey;
        step = { fromId: transmuteResourceId(family, ...(kind === "tier" ? [t - 1, e] : [t, e - 1])),
                 toId: id, fee, stationFee };
      };
      if (t > 4) relax(key(t - 1, e), "tier");
      if (e > 0) relax(key(t, e - 1), "enchant");

      if (best < Infinity) nodes[key(t, e)] = { cost: best, city, produced, viaKey, step };
    }
  }

  const end = nodes[key(target.tier, target.enchant)];
  if (!end || !end.produced) return null;

  // Walk back to the bought start, collecting the steps in reverse.
  const steps = [];
  let n = end;
  while (n.produced) {
    steps.unshift(n.step);
    n = nodes[n.viaKey];
  }
  const startId = steps[0].fromId;
  const startMarket = findCheapestMarketBuyForRefine(startId, marketData, refineCity, opts);
  const transmuteCost = steps.reduce((s, x) => s + x.fee + x.stationFee, 0);

  return {
    perUnit: end.cost,
    source: "transmute",
    startId,
    startCity: n.city,
    startPrice: startMarket.price || 0,
    startTravelFeePerUnit: startMarket.travelFeePerUnit || 0,
    steps,
    transmuteCost,
  };
}

// Pick how one unit of the refine's raw is obtained: straight market buy, or the
// transmute route when that lands cheaper. `marketPrice`/`marketCity` are the raw's
// own best buy as already found by the caller; its Brecilien exit fee is added here
// so the comparison is effective-cost vs effective-cost (the transmute route's fee
// is already inside its perUnit).
//
// Returns `perUnit` on the SAME basis the caller's market path uses — the raw's
// sticker price when the market wins (its travel is charged separately, per kept
// unit), the all-in per-unit cost when the transmute wins (travel already inside).
//
// `feePerUnit` is the part of `perUnit` that was never a market purchase — the
// transmute silver and its station fees. It is RRR-eligible like the rest of the
// unit cost, but it pays no market setup fee, so every caller that applies
// SETUP_FEE has to hold it back (see calculateTransportMargin / buildRefiningChain).
function resolveRefineRawSource(rawId, marketPrice, marketCity, refineCity, marketData, opts) {
  const t = getRawTransmuteSourcing(rawId, marketData, refineCity, opts);
  const market = { perUnit: marketPrice || 0, feePerUnit: 0, transmute: null };
  if (!t) return market;

  const marketFee = (marketCity && typeof legBrecilienCost === "function")
    ? legBrecilienCost(marketCity, refineCity, rawId, 1) : 0;
  const marketEff = marketPrice > 0 ? marketPrice + marketFee : Infinity;
  if (marketEff <= t.perUnit) return market;
  return { perUnit: t.perUnit, feePerUnit: t.transmuteCost || 0, transmute: t };
}

// Every grid node the substitution search can read, so a scan (or a search-box
// single-item fetch) pre-fetches their prices. Without this the DP sees zeros and
// silently never substitutes.
function getRawTransmuteIds(rawId, out) {
  const set = out || new Set();
  const target = parseTransmuteNode(rawId);
  if (!target || target.tier < 4) return set;
  for (let t = 4; t <= target.tier; t++) {
    for (let e = 0; e <= target.enchant; e++) {
      if (target.family === "ROCK" && e > 0) continue;   // stone has no enchant transmute
      set.add(transmuteResourceId(target.family, t, e));
    }
  }
  return set;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    parseTransmuteNode,
    transmuteStepFee,
    getRawTransmuteSourcing,
    resolveRefineRawSource,
    getRawTransmuteIds,
  };
}
