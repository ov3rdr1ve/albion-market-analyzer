// Does a row's own IDENTITY match the text a user typed into this table's
// search box? One question, one file — read by js/sorting.js so that a typed
// query can REVEAL rows the profitability gate would otherwise drop.
//
// Why this exists. applyTableSearchFilter (js/table-search.js) runs AFTER the
// render, over painted <tr> elements, so it can only set display:none. A row
// that updateTableDisplay already filtered out of the render pass is not in the
// DOM at all, and no query can bring it back. That is what hid 13 of the 15
// "Master's … Cape" rows: their crest has no market listing, computeCraftPlannerRow
// returns { noData: true }, and js/sorting.js drops it unless the global "Show
// All" box is ticked. Typing a name is an explicit request for those items, so
// the gate has to know about the query BEFORE it filters.
//
// IDENTITY, not rendered text, on purpose. The DOM pass matches the whole row's
// textContent (every recipe line included), which is a strict superset of what
// is matched here — so every row this reveals also survives that pass, while a
// row that matched only through one of its materials is not resurrected whole.

// Terms currently typed into `tableId`'s search box, lowercased. Empty array
// when there is no box, nothing typed, or the caller is the volume table, which
// keeps its own object-level filter (applyVolumeTableFilters) and already
// bypasses the profitability gate outright.
function tableSearchTerms(tableId) {
  if (!tableId || tableId === "volume-table") return [];
  if (typeof document === "undefined" || !document.getElementById) return [];
  const input = document.getElementById(`search-${tableId}`);
  if (!input) return [];
  const q = String(input.value || "").trim().toLowerCase();
  if (!q) return [];
  return q.split(/\s+/).filter(Boolean);
}

// Everything about a row that names WHICH item it is: its stable row key, the
// raw id, the catalogue name, and the localized display name. Deliberately no
// prices, cities or recipe text.
function _rowIdentityHaystack(row, tableId) {
  const parts = [];
  const push = (s) => { if (s) parts.push(String(s)); };
  if (typeof getRowKey === "function") {
    try { push(getRowKey(row, tableId)); } catch { /* keyless row — the id below still names it */ }
  }
  const item = row && row.item;
  if (item) {
    push(item.id);
    push(item.name);
    if (item.id && typeof getItemDisplayName === "function") {
      try { push(getItemDisplayName(item.id)); } catch { /* name map absent in a test sandbox */ }
    }
  }
  return parts.join(" ").toLowerCase();
}

// True when EVERY term appears in the row's identity — the same AND-of-terms
// rule rowMatches (js/table-search.js) applies to the rendered row, so the two
// can never disagree about a row they both see. No terms → false: with an empty
// box the gate must behave exactly as it always has.
function rowRevealedBySearch(row, tableId, terms) {
  if (!row || !Array.isArray(terms) || terms.length === 0) return false;
  const hay = _rowIdentityHaystack(row, tableId);
  if (!hay) return false;
  return terms.every((t) => hay.includes(t));
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { tableSearchTerms, rowRevealedBySearch };
}
