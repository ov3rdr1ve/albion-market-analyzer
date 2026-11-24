// Cheapest way to OBTAIN one artifact fragment — Rune, Soul, Relic or Avalonian
// Shard — for the tables that consume them (Artifact Rolling, the Crafting
// Planner's buy-and-enchant route).
//
// A fragment does not have to be bought as itself. Transmuting (Artifact Foundry
// or any crafting station) offers two moves, both already modelled for the
// Transmute table in js/data-transmute.js:
//   - type-up, 1:1, same tier, silver fee:  Rune → Soul → Relic → Avalonian Shard
//   - tier-up, 5:1, same family, no silver: 5× T5 Relic → 1× T6 Relic
//
// So the question is a small grid DP over tier 4..target × family Rune..target,
// the same shape getRawTransmuteSourcing (js/refining-transmute-substitute.js)
// solves for raw resources. Both predecessors of a node (one family down, one
// tier down) are resolved before the node, so one ascending sweep finds the
// minimum.
//
// Cost basis, per fragment:
//   perUnit = marketPerUnit × (1 + SETUP_FEE) + feePerUnit
// `marketPerUnit` is the silver that goes through the market (buyCount × the
// bought node's price) and pays the buy-order setup fee; `feePerUnit` is the
// transmute silver plus its station usage fee, which never does. Transmute
// silver takes the Global Discount like the Transmute table's rows
// (render-transmute.js _transmuteDiscounted).
//
// Public API:
//   parseFragmentId(id)                              -> { tier, family, index } | null
//   getFragmentSourcing(fragmentId, marketData, cities) -> route | null

const FRAGMENT_FAMILIES = ["RUNE", "SOUL", "RELIC", "SHARD_AVALONIAN"];
const FRAGMENT_ID_RE = /^T([4-8])_(RUNE|SOUL|RELIC|SHARD_AVALONIAN)$/;
// Tier-up ratio. Kept local as a fallback so the module parses without
// data-transmute.js; the live value is TRANSMUTE_MATERIAL_TIERUP_COUNT.
const FRAGMENT_TIERUP_COUNT_FALLBACK = 5;

function parseFragmentId(id) {
  const m = typeof id === "string" && id.match(FRAGMENT_ID_RE);
  if (!m) return null;
  return { tier: parseInt(m[1], 10), family: m[2], index: FRAGMENT_FAMILIES.indexOf(m[2]) };
}

function _fragmentTierUpCount() {
  return (typeof TRANSMUTE_MATERIAL_TIERUP_COUNT !== "undefined")
    ? TRANSMUTE_MATERIAL_TIERUP_COUNT : FRAGMENT_TIERUP_COUNT_FALLBACK;
}

// Cheapest priced buy of `id` across `cities`. An in-pool buy force owns the
// leaf: priced there, or the leaf is dead (the same rule as the planner's
// enchant route). A dead leaf can still be reached by transmuting up.
function _fragmentCheapestBuy(id, marketData, cities) {
  const data = marketData ? marketData[id] : undefined;
  const bounds = getIQRBounds(data || {});
  const force = (typeof getCityForce === "function") ? getCityForce(id, "buy") : null;
  if (force && cities.includes(force)) {
    const p = getBuyPrice(data, force, bounds, id);
    return p > 0 ? { price: p, city: force } : null;
  }
  let best = null;
  cities.forEach((c) => {
    const p = getBuyPrice(data, c, bounds, id);
    if (p > 0 && (!best || p < best.price)) best = { price: p, city: c };
  });
  return best;
}

// Silver + station fee of ONE type-up execution that arrives at family `to`.
function _fragmentTypeUpFee(from, to, tier) {
  const gross = (typeof getTransmuteSilverCost === "function")
    ? getTransmuteSilverCost(from, to, tier) : 0;
  if (!(gross > 0)) return null;
  const fee = (typeof applyGlobalDiscount === "function") ? applyGlobalDiscount(gross) : gross;
  // transmuteRouteStationFee derives nutrition from the GROSS silver and applies
  // the discount itself (calcStationFeeSilver).
  const stationFee = (typeof transmuteRouteStationFee === "function")
    ? transmuteRouteStationFee({ kind: "material", tier, silverCost: gross }) : 0;
  return { fee, stationFee };
}

function getFragmentSourcing(fragmentId, marketData, cities) {
  const target = parseFragmentId(fragmentId);
  if (!target || !Array.isArray(cities)) return null;
  const setup = (typeof SETUP_FEE === "number") ? SETUP_FEE : 0;
  const ratio = _fragmentTierUpCount();
  const nodeId = (t, f) => `T${t}_${FRAGMENT_FAMILIES[f]}`;
  const nodes = {};   // "t,f" -> route to that node
  const cost = (n) => n.marketPerUnit * (1 + setup) + n.feePerUnit;

  for (let t = 4; t <= target.tier; t++) {
    for (let f = 0; f <= target.index; f++) {
      const id = nodeId(t, f);
      let best = null;

      const m = _fragmentCheapestBuy(id, marketData, cities);
      if (m) {
        best = { buyId: id, buyCity: m.city, buyPrice: m.price, buyCount: 1,
          marketPerUnit: m.price, feePerUnit: 0, steps: [] };
      }
      const consider = (cand) => {
        if (!best || cost(cand) < cost(best)) best = cand;
      };

      // Type-up: one unit of the family below, same tier, plus the fee.
      const typePred = f > 0 ? nodes[`${t},${f - 1}`] : null;
      if (typePred) {
        const fees = _fragmentTypeUpFee(FRAGMENT_FAMILIES[f - 1], FRAGMENT_FAMILIES[f], t);
        if (fees) {
          consider({
            ...typePred,
            feePerUnit: typePred.feePerUnit + fees.fee + fees.stationFee,
            steps: typePred.steps.concat([{ fromId: nodeId(t, f - 1), toId: id, kind: "type",
              ratio: 1, fee: fees.fee, stationFee: fees.stationFee }]),
          });
        }
      }
      // Tier-up: `ratio` units of the tier below, same family, no silver.
      const tierPred = t > 4 ? nodes[`${t - 1},${f}`] : null;
      if (tierPred) {
        consider({
          ...tierPred,
          buyCount: tierPred.buyCount * ratio,
          marketPerUnit: tierPred.marketPerUnit * ratio,
          feePerUnit: tierPred.feePerUnit * ratio,
          steps: tierPred.steps.concat([{ fromId: nodeId(t - 1, f), toId: id, kind: "tier",
            ratio, fee: 0, stationFee: 0 }]),
        });
      }

      if (best) nodes[`${t},${f}`] = best;
    }
  }

  const end = nodes[`${target.tier},${target.index}`];
  if (!end) return null;
  const own = end.steps.length ? _fragmentCheapestBuy(fragmentId, marketData, cities) : null;
  return {
    source: end.steps.length ? "transmute" : "market",
    perUnit: cost(end),
    marketPerUnit: end.marketPerUnit,
    feePerUnit: end.feePerUnit,
    buyId: end.buyId,
    buyCity: end.buyCity,
    buyPrice: end.buyPrice,
    buyCount: end.buyCount,
    steps: end.steps,
    // The fragment's own listing (what a salvaged fragment sells for), even when
    // a transmute wins. 0 / null when the fragment itself is unlisted.
    marketPrice: end.steps.length ? (own ? own.price : 0) : end.buyPrice,
    marketCity: end.steps.length ? (own ? own.city : null) : end.buyCity,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { FRAGMENT_FAMILIES, parseFragmentId, getFragmentSourcing };
}
