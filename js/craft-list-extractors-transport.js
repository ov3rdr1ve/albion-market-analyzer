/**
 * My Crafting List — the transport table's row extractor.
 *
 * Split out of js/craft-list-extractors.js for size (the 800-line limit) and
 * registered back into that file's CRAFT_LIST_EXTRACTORS registry, so every
 * existing require() and the browser's single registry keep working:
 *
 *   browser   plain globals — this <script> loads after
 *             js/craft-list-extractors.js and registers itself below;
 *   Node      the shared helpers (_clMat, _clRow, …) live module-scoped in
 *             js/craft-list-extractors.js, so they are pulled onto globalThis
 *             from its exports — the same bridge rrrWithoutFocus uses there —
 *             and the extractor registers into its registry;
 *   sandbox   tests that concatenate the sources have everything as plain
 *             globals already, so the first branch below fires.
 *
 * One refine: rawRatio raw units + (T3+) one lower-tier refined bar.
 */

function transportTableRow(r) {
  // Both return rates, walked over the same two lines: the raw the refine
  // consumes returns, the lower-tier bar it also consumes returns, and the
  // focus-off tail has to buy more of both.
  const matsAt = (rrr) => {
    const out = [];
    if (r.route?.rawId) {
      // `buyRawId` is the node actually bought — when a transmute route wins
      // it is a cheaper lower node, and buyRaw.city/.price already describe
      // THAT item (js/refining-route.js). The table's own cell uses it too.
      // Count still keys on route.rawId, same reason as _clRecipeMats.
      out.push(_clMat(
        r.buyRawId || r.route.rawId,
        _clEffCount(r.route.rawId, r.route.rawRatio || 1, rrr),
        r.buyRaw?.city, r.buyRaw?.price,
      ));
    }
    if (r.route?.secondaryMatId && r.route.secondaryMatCount > 0) {
      // The secondary's price and city live on r.secondaryMat
      // (js/render-transport.js): the market leg's book price and city, or —
      // when the plan refines the secondary itself — the chain's resolved
      // cost with NO city. That is exactly what the row's own cell renders
      // (matPriceSpan(secondaryMat.id, secondaryMat.city, secondaryMat.price)).
      // r.secondaryChain is a ChainNode (js/refining-chain-pricing.js): it
      // carries costPerOutput and inputs but NO perUnit and NO city, so
      // reading the price off it priced every transport secondary leg at 0 —
      // "no data" on the shopping board. A chain leg is marked "refine" (the
      // planner path's self-made marker): the plan MAKES it rather than buys
      // it, so the board must not read as "go buy T3 leather".
      out.push(_clMat(
        r.route.secondaryMatId, r.route.secondaryMatCount,
        r.secondaryMat?.city || r.refineCity, r.secondaryMat?.price,
        r.secondaryChain ? "refine" : "",
      ));
    }
    return out;
  };
  return _clRow({
    tableId: "transport-table",
    itemId: r.route?.refinedId,
    itemName: _clName(r.route?.refinedId),
    buyCity: r.buyRaw?.city,
    sellCity: r.sellRefined?.city,
    sellPrice: r.sellRefined?.price,
    inputCost: r.totalRawCost,
    unitProfit: r.marginInfo?.profit,
    // The refining table's self-gathered twin (plan.md — the "Profit Gathered"
    // basis) — read guarded, so a table that does not compute one (yet) passes
    // absence straight through.
    unitProfitSelfFound: r.marginInfo?.selfFoundProfit ?? r.selfFoundProfit,
    // `focusCost` on a refining row is one REFINE at the focused tier, and a
    // chain row runs several of those per finished OUTPUT — the unit its
    // profit and this list's quantities are both counted in. That is exactly
    // what refinesPerOutput converts, and what the row's own Profit / 10k
    // Focus column already divides by (js/render-transport.js).
    focusCost: (_clNum(r.focusCost, 0) * _clNum(r.refinesPerOutput, 1)) || 0,
    focusProfitDelta: r.focusProfitDelta,
    materials: matsAt(r.rrr),
    materialsNoFocus: matsAt(_clBaseRrr(r)),
  });
}

// Browser / concatenated sandbox: the registry and the shared helpers are
// plain globals from js/craft-list-extractors.js — register straight into it.
if (typeof CRAFT_LIST_EXTRACTORS !== "undefined") {
  CRAFT_LIST_EXTRACTORS["transport-table"] = transportTableRow;
// Node: pull the shared helpers and the registry out of the sibling module.
} else if (typeof require === "function" && typeof globalThis !== "undefined") {
  try {
    const base = require("./craft-list-extractors.js");
    globalThis._clMat = base._clMat;
    globalThis._clEffCount = base._clEffCount;
    globalThis._clName = base._clName;
    globalThis._clNum = base._clNum;
    globalThis._clBaseRrr = base._clBaseRrr;
    globalThis._clRow = base._clRow;
    base.CRAFT_LIST_EXTRACTORS["transport-table"] = transportTableRow;
  } catch (e) { /* loaded bare without the sibling */ }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { transportTableRow };
}
