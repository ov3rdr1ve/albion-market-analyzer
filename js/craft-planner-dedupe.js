// Crafting Planner — the one-row-per-(item, section) decision.
//
// _cpRowsForItem (js/render-craft-planner.js) builds one candidate row per
// craft city; this file decides which of them the board shows: each zone
// section's highest-profit PRICED candidate. The Caerleon section renders
// under the shared "Caerleon & Black Market Routes" divider
// (renderTableData, js/sorting.js) — the same farming-table layout every other
// sectioned table gets. A real route beats a no-data placeholder; among real
// rows the higher combined profit wins.
//
// A section with no priced candidate still contributes its no-data candidates
// as rows: the profitability gate (js/sorting.js) hides them from the default
// view, while Show All and a matching search query reveal them — a row this
// file drops can never be searched back (see table-search-reveal.js). Each dead
// section's winner also donates its blocker summaries to the surviving
// section's alternatives, where the default view reads them.
//
// The candidates that lost within a section are the only record of the OTHER
// craft cities that side of the zone line could build the item in, and the row
// alone cannot say why it picked the one it did. Keeping a summary of them lets
// the panel show the same-zone alternative beside the winner. Summaries only:
// whole rows carry their sourcing trees, and the planner is the app's largest
// table.

function dedupeCraftPlannerRows(rowData) {
  const isNoData = (r) => r.noData;
  const byItem = new Map();
  rowData.forEach((row) => {
    const key = `${row.item.id}`;
    if (!byItem.has(key)) byItem.set(key, []);
    byItem.get(key).push(row);
  });

  const keep = new Set();
  byItem.forEach((rows) => {
    const sections = new Map();
    rows.forEach((r) => {
      const s = r.section || "royal";
      if (!sections.has(s)) sections.set(s, []);
      sections.get(s).push(r);
    });
    const winners = new Map();
    sections.forEach((cands, s) => {
      const priced = cands.filter((r) => !isNoData(r));
      if (priced.length) {
        winners.set(s, priced.reduce((a, b) =>
          ((b.combinedProfit || 0) > (a.combinedProfit || 0) ? b : a)));
      }
    });
    // Neither side priced anywhere: every candidate is a placeholder. They all
    // stay — the gate hides them in the default view, and Show All / a matching
    // query reveal each section's blockers.
    if (winners.size === 0) {
      rows.forEach((r) => {
        if (r.altCityRows === undefined) r.altCityRows = [];
        keep.add(r);
      });
      return;
    }
    winners.forEach((winner, s) => {
      const alts = [];
      sections.forEach((cands, cs) => {
        if (cs === s) {
          // Same side of the zone line: every other candidate, priced or not —
          // this branch only runs when the winner is priced, so a sparse
          // same-side twin stays visible with its blocker named.
          cands.forEach((r) => { if (r !== winner) alts.push(r); });
        } else if (!winners.has(cs)) {
          // The other side priced nothing: its no-data candidates (usually the
          // Caerleon twin) surface here with their blocker named, instead of a
          // dead section row — AND they stay in the row set as their own
          // gate-hidden placeholder rows, so Show All or a matching search
          // query puts the dead section's blockers on the board.
          cands.forEach((r) => {
            if (isNoData(r)) { alts.push(r); keep.add(r); }
          });
        }
      });
      // Priced alternatives sort by profit; the no-data ones follow,
      // alphabetical for a stable order.
      const priced = alts.filter((a) => !a.noData)
        .sort((a, b) => (b.combinedProfit || 0) - (a.combinedProfit || 0));
      const missing = alts.filter((a) => a.noData)
        .sort((a, b) => String(a.craftCity).localeCompare(String(b.craftCity)));
      winner.altCityRows = [...priced, ...missing].map(craftCitySummary);
      keep.add(winner);
    });
  });
  return rowData.filter((r) => keep.has(r));
}

/** The few fields the alternatives block prints, lifted off a losing candidate. */
function craftCitySummary(row) {
  return {
    craftCity: row.craftCity || "",
    section: row.section || "",
    combinedProfit: row.combinedProfit || 0,
    sellCity: row.sellCity || "",
    buyCities: cpMatBuyCities(row),
    // A candidate that never priced quotes no profit — it names its blocker
    // instead: the materials with no quote in its zone pool, or the absence of
    // any reachable sell market (computeCraftPlannerRow sets one of the two).
    noData: !!row.noData,
    noDataMats: row.noDataMats || [],
    noDataNoSell: !!row.noDataNoSell,
  };
}

/**
 * Distinct market cities a row's materials are bought in, first-seen order.
 *
 * A self-refined material carries no city of its own — `source: "chain"` means
 * the buying happens further down, at the chain's leaves — so the walk has to
 * descend. Reading only the top level reported "no buy cities" for exactly the
 * rows the alternatives block exists to explain: an item whose every material
 * is refined from raws bought somewhere else.
 *
 * Chain nodes are `{ inputs: [{ matId, count, sourcing }] }` and nest to the
 * bottom of the refining ladder (js/refining-chain-pricing.js).
 */
function cpMatBuyCities(row) {
  const out = [];
  const visit = (src) => {
    if (!src) return;
    if (src.city && !out.includes(src.city)) out.push(src.city);
    const inputs = src.chain && src.chain.inputs;
    if (Array.isArray(inputs)) inputs.forEach((i) => visit(i.sourcing));
  };
  (row.sourcing || []).forEach((s) => visit(s.sourcing));
  return out;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { dedupeCraftPlannerRows, craftCitySummary, cpMatBuyCities };
}
