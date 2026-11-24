/**
 * My Crafting List — the faction-spending table's row extractor.
 *
 * Split out of js/craft-list-extractors.js for size (the 800-line limit) and
 * registered back into that file's CRAFT_LIST_EXTRACTORS registry — the same
 * wiring as the transport sibling (js/craft-list-extractors-transport.js):
 *
 *   browser   plain globals — this <script> loads after
 *             js/craft-list-extractors.js and registers itself below;
 *   Node      the shared helpers (_clMat, _clRow) live module-scoped in
 *             js/craft-list-extractors.js, so they are pulled onto globalThis
 *             from its exports and the extractor registers into its registry;
 *   sandbox   tests that concatenate the sources have everything as plain
 *             globals already, so the first branch below fires.
 *
 * Crests AND faction hearts are paid in Faction Points / Favor, not silver;
 * a cape row's silver inputs are only the base cape plus the non-FP tokens
 * (the Mists/Avalon quest tokens). The legacy shape reports no market inputs
 * (inputCost 0, materials []). A CRAFTED faction cape (js/faction-cape-craft.js)
 * is the exception: its row carries `silverMats`, those silver inputs priced by
 * the same cheapest-buy pass that produced the row's inputCost, so the lines
 * sum back to inputCost exactly. Those rows pass the real cost through and
 * shop the lines in the shared _clMat shape; every other row keeps the legacy
 * zero-cost shape. The *_BP crest and the T1_FACTION_* city hearts are never
 * among the lines — they are the FP / Favor denominators (js/
 * data-faction-fp-costs.js), consumed by the craft, not bought in silver.
 */

/**
 * A Baby row whose Best FP placement beats selling the baby raw is planned as
 * that breed: FP pays for the placement's inputs (the baby, the saddler's
 * hearts, or both) and EVERYTHING ELSE is bought in silver — the feed, the
 * saddler leather (at the row's return rate) and any FP-priced input the
 * placement leaves out. Before this the row always planned the raw sale, so
 * 72 bred T8 boars read a Total Buy Cost of 0 (a reported case, 2026-10-05).
 *
 *   inputCost  = the cycle's whole bought cost − what the placement saves
 *   unitProfit = the placement's cycle profit (what Best FP quotes)
 *
 * That cycle is the fully NURTURED one, so the row spends focus exactly like
 * its Breeding & Mounts twin: the nurture charge per day over the grow days,
 * worth the nurture slice of the offspring chance. Without it the row had no
 * focus cost, so the list drew no "10k" button under its quantity (a reported case,
 * 2026-10-07) and never billed the budget for it. An unfunded baby forfeits
 * the nurture gain but buys nothing extra — nurture costs focus, not silver.
 *
 * Returns null when the raw sale is the better use (or nothing is scored).
 */
function _fsBreedPlan(r) {
  const bd = r.breedData;
  const best = bd && bd.bestFpPlay;
  if (!best || !(best.silverPerFp > (Number(r.silverPerFp) || 0))) return null;
  const fpPaid = new Set(Array.isArray(best.items)
    ? best.items.map((it) => it.itemId) : [best.itemId]);
  const lines = [];
  const babyBuy = bd.babyBuy || {};
  if (!fpPaid.has(r.itemId)) lines.push(_clMat(r.itemId, 1, babyBuy.city, babyBuy.price));
  const feed = bd.feed;
  if (feed && feed.id && Number(feed.pieces) > 0) {
    lines.push(_clMat(feed.id, feed.pieces, feed.city || bd.saddlerCity, feed.price));
  }
  ((bd.recipe && bd.recipe.materials) || []).forEach((m) => {
    if (m.matId === bd.grownId || fpPaid.has(m.matId)) return;
    const priced = (bd.saddlerMatPrices && bd.saddlerMatPrices[m.matId]) || {};
    if (priced.isProduced) return;
    lines.push(_clMat(m.matId, _clEffCount(m.matId, m.count, bd.saddlerRrr),
      priced.city || bd.saddlerCity, priced.price));
  });
  const inputCost = Math.max(0, (Number(bd.totalInputCost) || 0) - (Number(best.silverSaved) || 0));
  const nurtureFocus = Number(bd.nurtureFocusCost) || 0;
  const days = Math.max(1, Math.floor(Number(bd.maxNurtures) || 1));
  const delta = Math.max(0, Number(bd.nurtureProfitDelta) || 0);
  const focus = nurtureFocus > 0 ? {
    focusCost: nurtureFocus / days,
    focusDays: days,
    focusProfitDelta: delta / days,
    unitProfitNoFocus: best.cycleProfit - delta,
    laborerProfitNoFocus: best.cycleProfit - delta,
    inputCostNoFocus: inputCost,
  } : {};
  return {
    sellCity: bd.sellCity,
    sellPrice: bd.sellPrice,
    inputCost,
    // The FP the placement pays: the baby, the saddler's hearts, or both.
    fpCost: Number(best.fpCost) || 0,
    unitProfit: best.cycleProfit,
    ...focus,
    materials: lines,
  };
}

function factionSpendingTableRow(r) {
  const breed = _fsBreedPlan(r);
  if (breed) {
    return _clRow({
      tableId: "faction-spending-table",
      itemId: r.itemId,
      itemName: r.name || r.itemId,
      ...breed,
    });
  }
  // Rows without silverMats (pure FP / Favor rows, legacy stored shapes) keep
  // the legacy zero-cost shape; _clRow normalizes the passed-through cost.
  const silverMats = (Array.isArray(r.silverMats) && r.silverMats.length > 0)
    ? r.silverMats : [];
  return _clRow({
    tableId: "faction-spending-table",
    itemId: r.itemId,
    itemName: r.name || r.itemId,
    sellCity: r.sellCity,
    sellPrice: r.sellPrice,
    inputCost: silverMats.length ? r.inputCost : 0,
    fpCost: r.fpCost,
    favorCost: r.favorCost,
    unitProfit: r.netSilver,
    materials: silverMats.map((m) => _clMat(m.matId, m.count, m.city, m.perUnit)),
  });
}

// Browser / concatenated sandbox: the registry and the shared helpers are
// plain globals from js/craft-list-extractors.js — register straight into it.
if (typeof CRAFT_LIST_EXTRACTORS !== "undefined") {
  CRAFT_LIST_EXTRACTORS["faction-spending-table"] = factionSpendingTableRow;
// Node: pull the shared helpers and the registry out of the sibling module.
} else if (typeof require === "function" && typeof globalThis !== "undefined") {
  try {
    const base = require("./craft-list-extractors.js");
    globalThis._clMat = base._clMat;
    globalThis._clRow = base._clRow;
    globalThis._clEffCount = base._clEffCount;
    base.CRAFT_LIST_EXTRACTORS["faction-spending-table"] = factionSpendingTableRow;
  } catch (e) { /* loaded bare without the sibling */ }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { factionSpendingTableRow, _fsBreedPlan };
}
