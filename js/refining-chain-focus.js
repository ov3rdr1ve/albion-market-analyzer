// Shared "focus lands on exactly ONE tier of a refining ladder" helpers.
//
// The refining chain in js/refining-chain-pricing.js is always BUILT at base
// RRR — no node is ever priced as if focus were spent there. Focus is layered on
// afterwards, at a single tier, by _chainCostWithFocusAtTier / pickCheapestFocusTier.
// This file carries the two questions that model raises for the callers:
//
//   refinesPerOutputAtTier — "how many refine actions at T_focus does ONE unit of
//     the ladder's output cost?" The Profit / 10k Focus divisor needs it: a focus
//     bar buys floor(10000/focusCost) REFINES, and only when the focused tier is
//     the ladder's top is that also the number of OUTPUTS.
//
//   chainMarketLeafDemand — "what does the ladder actually BUY to make N units?"
//     The 10k Focus Mats shopping list needs it: a chain-refined intermediate is
//     produced, not purchased, so listing it would send the user to buy a bar the
//     route already told them to refine.
//
// Both walk the same ChainNode tree (shape documented in refining-chain-pricing.js)
// and both take the focused tier so the return-rate they assume matches the cost
// basis the row was priced with. `focusTier === undefined` means "use whatever RRR
// the node was built with", which is how the Crafting Planner has always called
// _cpRefinesPerUnitAtTier — its chains are focus-off, so node.rrr IS the base rate.

// Return rate in force at `node` under a one-tier focus model.
function _chainNodeRrr(node, focusTier) {
  if (focusTier === undefined || typeof getRefineRRR !== "function") return node.rrr || 0;
  return getRefineRRR(node.refineCity, node.resourceType, node.tier === focusTier);
}

// The chain-sourced secondary of `node`, or null when the secondary is bought
// (or absent, as at the T2 bottom of the ladder).
function _chainSubNode(node) {
  const sec = node && node.inputs && node.inputs[1];
  return (sec && sec.sourcing && sec.sourcing.source === "chain") ? sec.sourcing.chain : null;
}

/**
 * How many refine actions at `tier` one unit of the chain's output costs.
 *
 * 1 at the top of the ladder; each step down multiplies by the secondary's count
 * net of the parent refine's return rate — a returned bar is never re-refined,
 * which is exactly the consumption _chainCostWithFocusAtTier prices. 0 when the
 * tier is not a chain step (the material is bought at that level).
 *
 * @param {object|null} chain - root ChainNode
 * @param {number} tier - the tier focus is spent at
 * @param {number} [focusTier] - see _chainNodeRrr
 * @returns {number} refines at `tier` per unit of `chain.produces`
 */
function refinesPerOutputAtTier(chain, tier, focusTier) {
  let n = 1;
  for (let node = chain; node; ) {
    if (node.tier === tier) return n;
    const sec = node.inputs && node.inputs[1];
    const sub = _chainSubNode(node);
    if (!sub) return 0;
    n *= sec.count * (1 - _chainNodeRrr(node, focusTier));
    node = sub;
  }
  return 0;
}

/**
 * What the ladder BUYS to produce `outputs` units of its top item.
 *
 * Every input that is not itself chain-refined is a purchase: each node's raw leg,
 * a market-sourced secondary, and the faction heart. RRR-eligible inputs are
 * counted net of the return rate at their own node (the same (1-rrr) the cost math
 * applies); a `noReturn` input — the heart — is counted whole. A transmute leg is
 * listed as the node the route actually buys (`transmute.startId`), not the raw the
 * recipe names, which is produced.
 *
 * @param {object|null} chain - root ChainNode
 * @param {number} outputs - units of chain.produces to make
 * @param {number} [focusTier] - see _chainNodeRrr
 * @returns {Map<string, number>} matId -> units to buy
 */
function chainMarketLeafDemand(chain, outputs, focusTier) {
  const demand = new Map();
  if (!chain || !(outputs > 0)) return demand;
  const add = (matId, units) => {
    if (!matId || !(units > 0)) return;
    demand.set(matId, (demand.get(matId) || 0) + units);
  };

  const walk = (node, units) => {
    if (!node || !(units > 0)) return;
    const rrr = _chainNodeRrr(node, focusTier);
    (node.inputs || []).forEach((inp) => {
      const src = inp.sourcing || {};
      // A heart is fully consumed, so RRR never gives one back.
      const consumed = inp.noReturn ? units * inp.count : units * inp.count * (1 - rrr);
      if (src.source === "chain") {
        walk(src.chain, consumed);
      } else if (src.source === "transmute") {
        add((src.transmute && src.transmute.startId) || inp.matId, consumed);
      } else {
        add(inp.matId, consumed);
      }
    });
  };
  walk(chain, outputs);
  return demand;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { refinesPerOutputAtTier, chainMarketLeafDemand };
}
