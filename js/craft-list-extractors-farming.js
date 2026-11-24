/**
 * My Crafting List — the farming table's row extractor.
 *
 * Split out of js/craft-list-extractors.js for size (the 800-line limit) and
 * registered back into that file's CRAFT_LIST_EXTRACTORS registry — the same
 * wiring as js/craft-list-extractors-faction.js (browser: plain globals, this
 * <script> loads after js/craft-list-extractors.js; Node: the shared helpers are
 * pulled onto globalThis from its exports; sandbox: concatenated sources already
 * have everything as globals).
 */

// ONE HARVESTED OUTPUT — one crop, egg or milk. Cost, price and profit are
// all per output on the source row, so focus and the seed line have to be
// too: the list scales every field by a crop quantity, and the row's own
// `focusCost` is the whole 22h CYCLE's watering focus. Billing that per crop
// read 1,875,000 focus for a 15,000-potato basket that really spends 23,148.
//
// `seedsPerOutput` is net of the seed return, the same convention
// _clEffCount applies to a craft's return rate — a plot at or above 100%
// yield re-seeds itself, buys nothing, and lists no seed line at all rather
// than a "0x" one. Both fields come from js/render-farming.js; a row without
// them contributes 0 rather than falling back to the per-cycle figure.
//
// The seed line has TWO sizes, because watering is a term in the seed-yield
// sum (js/calculations.js calcFarmingEconomics): a watered plot is at or
// above 100% return and buys nothing, a dry one is below it and buys. So the
// units the focus budget cannot cover buy STRICTLY MORE seeds than the ones
// it can — which is what materialsNoFocus is for
// (js/craft-list-materials.js). A row that carries no dry figure keeps the
// funded line for both, which is the behaviour before the split existed.
function farmingTableRow(r) {
  const seeds = Number(r.seedsPerOutput) || 0;
  const seedsDry = Number(r.seedsPerOutputNoFocus) || 0;
  // A row that does not carry the dry figure at all (an older stored shape)
  // omits the key entirely, so _clRow falls back to the funded line rather
  // than to an empty board.
  const dryLine = r.seedsPerOutputNoFocus === undefined || r.seedsPerOutputNoFocus === null
    ? {}
    : {
      materialsNoFocus: r.item?.id && seedsDry > 0
        ? [_clMat(r.item.id, seedsDry, r.buySeed?.city, r.buySeed?.price)]
        : [],
    };
  return _clRow({
    tableId: "farming-table",
    itemId: r.item?.outputId || r.item?.id,
    itemName: _clName(r.item?.outputId || r.item?.id, r.item?.name),
    buyCity: r.buySeed?.city,
    sellCity: r.sellCrop?.city,
    sellPrice: r.sellCrop?.price,
    inputCost: r.totalInputCost,
    unitProfit: r.marginInfo?.profit,
    focusCost: r.focusPerOutput,
    // Watering is a yield play: an unfunded output is simply not watered, so
    // it earns less AND re-seeds less. The profit side is this delta; the
    // seed side is materialsNoFocus below.
    focusProfitDelta: _clNum(r.focusProfitPerOutput, 0),
    materials: r.item?.id && seeds > 0
      ? [_clMat(r.item.id, seeds, r.buySeed?.city, r.buySeed?.price)]
      : [],
    ...dryLine,
  });
}

// Browser / concatenated sandbox: the registry and the shared helpers are
// plain globals from js/craft-list-extractors.js — register straight into it.
if (typeof CRAFT_LIST_EXTRACTORS !== "undefined") {
  CRAFT_LIST_EXTRACTORS["farming-table"] = farmingTableRow;
// Node: pull the shared helpers and the registry out of the sibling module.
} else if (typeof require === "function" && typeof globalThis !== "undefined") {
  try {
    const base = require("./craft-list-extractors.js");
    globalThis._clMat = base._clMat;
    globalThis._clRow = base._clRow;
    globalThis._clName = base._clName;
    globalThis._clNum = base._clNum;
    base.CRAFT_LIST_EXTRACTORS["farming-table"] = farmingTableRow;
  } catch (e) { /* loaded bare without the sibling */ }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { farmingTableRow };
}
