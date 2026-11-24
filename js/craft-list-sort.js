/**
 * My Crafting List — per-group sort state and comparator.
 *
 * The list renders one inner table per source table (js/render-craft-list.js),
 * and those groups do not share a column layout, so each one sorts on its own
 * column: state is keyed by tableId, not by the list.
 *
 * Source columns are NOT re-implemented here. A cloned header carries the source
 * table's own `data-sort`, and the comparison is delegated to compareRows()
 * (js/sorting.js) — so "Margin" in the list orders rows exactly as "Margin" does
 * in the table the rows came from. Only the columns the list prints ITSELF are
 * compared here: the three it adds (Qty, Total Buy Cost, Total Profit), and
 * Profit / 10k Focus, which it re-bases on the planned quantity
 * (js/craft-list-per10k.js) — delegating that one sorted on the source row's
 * bare figure, so the order disagreed with the numbers on screen.
 */

const CRAFT_LIST_SORT_KEY = "albionCraftListSort";

/** No column = the order rows were added, which is the list's default view. */
const CRAFT_LIST_NO_SORT = { sortCol: null, sortDir: "desc" };

/** Test seam, mirroring js/craft-list-store.js: null = memory only. */
let _clSortStorage;
let _clSorts = null;

function setCraftListSortStorage(storage) {
  _clSortStorage = storage;
  _clSorts = null; // re-read from the new storage on next use
}

function clSortStorage() {
  if (_clSortStorage !== undefined) return _clSortStorage;
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch (e) {
    return null; // private mode / no DOM
  }
}

/**
 * The saved `{ [tableId]: {sortCol, sortDir} }` map. Anything unreadable is
 * dropped rather than repaired — the fallback is insertion order, which is a
 * correct view of the list, so there is nothing to salvage.
 */
function loadCraftListSorts() {
  if (_clSorts) return _clSorts;
  _clSorts = {};
  const storage = clSortStorage();
  if (!storage) return _clSorts;
  try {
    const parsed = JSON.parse(storage.getItem(CRAFT_LIST_SORT_KEY) || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      Object.keys(parsed).forEach((tableId) => {
        const e = parsed[tableId];
        if (!e || typeof e !== "object" || !e.sortCol) return;
        _clSorts[tableId] = {
          sortCol: String(e.sortCol),
          sortDir: e.sortDir === "asc" ? "asc" : "desc",
        };
      });
    }
  } catch (e) {
    console.warn("Failed to load the crafting list sort", e);
  }
  return _clSorts;
}

function saveCraftListSorts() {
  const storage = clSortStorage();
  if (!storage) return;
  try {
    storage.setItem(CRAFT_LIST_SORT_KEY, JSON.stringify(_clSorts || {}));
  } catch (e) {
    console.warn("Failed to save the crafting list sort", e);
  }
}

function craftListSortFor(tableId) {
  return loadCraftListSorts()[tableId] || { ...CRAFT_LIST_NO_SORT };
}

/**
 * Apply a header click. Same semantics as the app-wide binder in js/app.js: a
 * new column opens on desc (biggest first is what a profit list is read for),
 * clicking the active column flips it.
 */
function setCraftListSort(tableId, col) {
  const sorts = loadCraftListSorts();
  const cur = sorts[tableId];
  sorts[tableId] = (cur && cur.sortCol === col)
    ? { sortCol: col, sortDir: cur.sortDir === "asc" ? "desc" : "asc" }
    : { sortCol: col, sortDir: "desc" };
  saveCraftListSorts();
  return sorts[tableId];
}

/** Columns whose printed value the list computes itself. */
const CRAFT_LIST_OWN_COLS = new Set(["qty", "clTotal", "clCost", "profitPer10kFocus"]);

/**
 * The row's figure under the focus-budget split, when the renderer attached it
 * (`item.profit` / `item.cost`, js/render-craft-list.js) — that is what the
 * cell prints. A bare item (no allocation) falls back to unit × quantity.
 */
function _clSortSplit(item, field, unitField, qty) {
  const v = Number(item[field]);
  if (item[field] !== undefined && item[field] !== null && Number.isFinite(v)) return v;
  return ((item.extracted && item.extracted[unitField]) || 0) * qty;
}

/**
 * The value a list-owned column prints for one item. `null` = the cell prints
 * no number ("—"), which the comparator sinks in both directions.
 */
function craftListOwnValue(item, col) {
  const qty = Number(item.entry && item.entry.qty) || 0;
  if (col === "qty") return qty;
  if (col === "clTotal") return _clSortSplit(item, "profit", "unitProfit", qty);
  if (col === "clCost") return _clSortSplit(item, "cost", "inputCost", qty);
  if (col === "profitPer10kFocus") {
    const base = item.row ? item.row.profitPer10kFocus : null;
    // A breeding row prints its focus-only bar as is (js/render-craft-list.js).
    if (typeof combinedPer10k !== "function" || (item.row && item.row.isBreeding)) {
      return (base === null || base === undefined || !Number.isFinite(Number(base))) ? null : Number(base);
    }
    return combinedPer10k(base, _clSortSplit(item, "profit", "unitProfit", qty), !(qty > 0));
  }
  return undefined;
}

/**
 * Sort one group's resolved items — `{ entry, row, extracted }` as
 * renderCraftListTable builds them. Returns a NEW array; the stored list keeps
 * its own order, which is what an un-sorted group renders.
 *
 * Rows with no source row (the "not priced yet" placeholders) sink to the
 * bottom in BOTH directions: they have no value in any column, and reading
 * their absence as 0 would float them over real losses on an asc sort.
 */
function sortCraftListRows(items, tableId, state) {
  const list = Array.isArray(items) ? items.slice() : [];
  if (!state || !state.sortCol) return list;
  const own = CRAFT_LIST_OWN_COLS.has(state.sortCol);

  // Index-carrying decoration keeps the sort stable across engines: equal rows
  // stay in the order the user added them.
  return list
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const aMissing = !a.item.row;
      const bMissing = !b.item.row;
      if (aMissing || bMissing) {
        if (aMissing && bMissing) return a.i - b.i;
        return aMissing ? 1 : -1;
      }
      let cmp;
      if (own) {
        const va = craftListOwnValue(a.item, state.sortCol);
        const vb = craftListOwnValue(b.item, state.sortCol);
        // A "—" cell has no number: bottom in BOTH directions, like the
        // placeholders above — reading it as -Infinity floated it up on asc.
        if (va === null || vb === null) {
          if (va === null && vb === null) return a.i - b.i;
          return va === null ? 1 : -1;
        }
        cmp = va - vb;
        if (state.sortDir === "desc") cmp = -cmp;
      } else if (typeof compareRows === "function") {
        cmp = compareRows(a.item.row, b.item.row, state, tableId);
      } else {
        cmp = 0;
      }
      if (!cmp || Number.isNaN(cmp)) return a.i - b.i;
      return cmp;
    })
    .map((d) => d.item);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CRAFT_LIST_SORT_KEY,
    setCraftListSortStorage,
    loadCraftListSorts,
    craftListSortFor,
    setCraftListSort,
    sortCraftListRows,
  };
}
