/**
 * The "+" column every profit table carries as its first cell.
 *
 * Clicking it toggles that row on My Crafting List (js/craft-list-store.js).
 * The button is the row's whole identity: `data-table-id` + `data-row-key`,
 * the same pair the list stores — no row object travels through the DOM.
 *
 * The click never triggers a full renderAllTables: it flips this one cell and
 * repaints the list panel, so sort order, scroll position and the price editor
 * are all left alone.
 */

/** Tables that offer the "+" — every profit table (see js/craft-list-materials.js). */
const CRAFT_LIST_TABLES = [
  "crafting-table",
  "craft-planner-table",
  "transport-table",
  "consumable-table",
  "rolling-table",
  "flipping-table",
  "skins-trading-table",
  "enchanting-table",
  "transmute-table",
  "rerolling-table",
  "gathering-table",
  "farming-table",
  "mounts-table",
  "laborers-table",
  "journal-filling-table",
  "buildings-table",
  "faction-spending-table",
];

function _addBtnEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/**
 * The leading cell of a data row. `row` is the source row object; the row key
 * comes from the table's own getRowKey so the list and the table agree on
 * identity even after a re-sort.
 */
function addTd(tableId, row) {
  const rowKey = (typeof getRowKey === "function") ? getRowKey(row, tableId) : "";
  return addTdForKey(tableId, rowKey);
}

/** addTd for callers that already hold the row key (the list panel, tests). */
function addTdForKey(tableId, rowKey) {
  const on = (typeof hasCraftListEntry === "function") && hasCraftListEntry(tableId, rowKey);
  const label = on ? "✓" : "+";
  const title = on
    ? tx("On My Crafting List — click to remove", "r_cl_remove_from_list")
    : tx("Add to My Crafting List", "r_cl_add_to_list");
  return `<td class="cell-add"><button type="button" class="add-row-btn${on ? " is-added" : ""}"`
    + ` data-add-row="1" data-table-id="${_addBtnEsc(tableId)}" data-row-key="${_addBtnEsc(rowKey)}"`
    + ` title="${title}">${label}</button></td>`;
}

/**
 * Tables whose row key does NOT start with an item id — rolling keys on
 * `section|cat|artId`, transmute on `tier|label|section` (js/sorting.js). Their
 * first segment ("royal", "5") would be stored as a bogus matcher that either
 * never matches or matches the wrong row, so they get no fallback at all.
 */
const _ADD_BTN_NO_ID_PREFIX = new Set(["rolling-table", "transmute-table"]);

/**
 * The item id behind a row key, read off the source table's cached row. The
 * list keeps it as its LAST-RESORT matcher, behind the exact key and the
 * city-independent identity (js/craft-list-store.js craftListIdentity). Falls
 * back to the key's first segment where that really is the item id, and to ""
 * where it is not — an empty matcher is skipped, a wrong one is not.
 */
function _addBtnItemId(tableId, rowKey) {
  try {
    const rows = (typeof tableState !== "undefined" && tableState[tableId]?.data) || [];
    const row = rows.find((r) => getRowKey(r, tableId) === rowKey);
    const extracted = row && typeof extractCraftListRow === "function"
      ? extractCraftListRow(tableId, row)
      : null;
    if (extracted && extracted.itemId) return extracted.itemId;
  } catch (e) { /* fall through */ }
  if (_ADD_BTN_NO_ID_PREFIX.has(tableId) || !CRAFT_LIST_TABLES.includes(tableId)) return "";
  return rowKey.split("|")[0];
}

// ─── Delegated click handler (idempotent module-init) ───────────────────────
(function _initAddRowButtons() {
  if (typeof document === "undefined") return;
  if (document._addRowBtnInit) return;
  document._addRowBtnInit = true;
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-add-row]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const tableId = btn.getAttribute("data-table-id") || "";
    const rowKey = btn.getAttribute("data-row-key") || "";
    if (!tableId || !rowKey) return;
    const nowOn = toggleCraftListEntry({ tableId, rowKey, itemId: _addBtnItemId(tableId, rowKey) });

    // Repaint every copy of this button (the source table and, when the row is
    // shown there too, the list panel) instead of re-rendering the table.
    // Row keys carry | and @ — match by attribute read rather than a selector
    // so no escaping scheme has to be trusted.
    [...document.querySelectorAll(`[data-add-row][data-table-id="${tableId}"]`)]
      .filter((el) => el.getAttribute("data-row-key") === rowKey)
      .forEach((el) => {
        el.classList.toggle("is-added", nowOn);
        el.textContent = nowOn ? "✓" : "+";
        el.title = nowOn
          ? tx("On My Crafting List — click to remove", "r_cl_remove_from_list")
          : tx("Add to My Crafting List", "r_cl_add_to_list");
      });

    if (typeof renderCraftListTable === "function") renderCraftListTable();
  });
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = { CRAFT_LIST_TABLES, addTd, addTdForKey };
}
