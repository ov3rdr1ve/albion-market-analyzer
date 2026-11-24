/**
 * "Jump to →" — reveal a board row's source row and hand it back to be scrolled.
 *
 * The boards are a projection: a row's own editable cells live in its feeder
 * table, and this link is the route there. So a jump that lands on the table top
 * — or on nothing — is what makes the boards feel read-only. Four reasons it did:
 *
 *   a. the table sits in a folded `.tgroup` band. The old guard only tested the
 *      table's own display, but a banded table has display "" while its whole
 *      section is hidden. isTableHidden (js/render-gating.js) already counts all
 *      three kinds of hidden; the jump did not.
 *   b. the target is an enchant variant. Crafting / Consumables / Craft Planner
 *      drop `@n` rows from the DOM unless the BASE id is expanded
 *      (js/sorting.js COLLAPSE_VARIANT_TABLES), so there was no row to find.
 *   c. an active per-table filter has the row at display:none, and
 *      scrollIntoView on a hidden element is a silent no-op — the click just
 *      appeared to do nothing.
 *   d. Faction Spending rows have an empty getRowKey, so `tr[data-row-key=""]`
 *      matched nothing. Those rows never landed at all.
 *
 * Each step changes what is in the DOM, so the lookup has to come last:
 * band → table → variants → filter → find.
 *
 * Collaborators are injected (`deps`) rather than read off globals, so the whole
 * reveal sequence is testable against a fake document.
 */

/**
 * Collaborators, injected or looked up.
 *
 * The lookups are BARE identifiers, not `globalThis.x`. A top-level `const` /
 * `let` in a classic script goes into the global lexical scope, which is not the
 * same thing as a property of globalThis — `globalThis.COLLAPSE_VARIANT_TABLES`
 * and `globalThis.expandedCraftItems` are both undefined at runtime even though
 * the names resolve fine. Reading them off globalThis made jbRevealVariant a
 * silent no-op, so an enchanted craft still jumped to a row that was not in the
 * DOM. `typeof` keeps the bare reference safe when the file is loaded in Node.
 */
function _jbjDeps(deps = {}) {
  return {
    doc: deps.doc || (typeof document !== "undefined" ? document : null),
    setGroupCollapsed: deps.setGroupCollapsed
      || (typeof setGroupCollapsed === "function" ? setGroupCollapsed : null),
    // The target table's own expand set (js/sorting.js keeps one per table).
    // An injected `expandedCraftItems` set stands in for every table.
    expandedFor: deps.expandedFor
      || (deps.expandedCraftItems ? () => deps.expandedCraftItems : null)
      || (typeof expandedCraftItemsFor === "function" ? expandedCraftItemsFor : null),
    collapseVariantTables: deps.collapseVariantTables
      || (typeof COLLAPSE_VARIANT_TABLES !== "undefined" ? COLLAPSE_VARIANT_TABLES : null),
    updateTableDisplay: deps.updateTableDisplay
      || (typeof updateTableDisplay === "function" ? updateTableDisplay : null),
    // The Craft Planner's scan skips enchanted ids and fetches them lazily, so
    // a revealed @n row there is empty until this has run. js/app.js makes the
    // same call from the manual expand handler.
    ensureVariantPrices: deps.ensureVariantPrices
      || (typeof ensurePlannerVariantPrices === "function" ? ensurePlannerVariantPrices : null),
  };
}

function _jbjEscape(s) {
  return (typeof CSS !== "undefined" && CSS.escape) ? CSS.escape(String(s)) : String(s);
}

/** Unfold the `.tgroup` band around a table. Replays any tables deferred inside it. */
function jbRevealBand(table, d) {
  const group = (table && typeof table.closest === "function") ? table.closest(".tgroup") : null;
  if (!group || !group.classList || !group.classList.contains("collapsed")) return false;
  if (!d.setGroupCollapsed) return false;
  d.setGroupCollapsed(group, false);
  return true;
}

/**
 * Expand the table's own collapse by clicking its <h2>. That handler is the one
 * place that knows to recompute a DEFERRED table rather than replay a stale
 * cache (js/app.js), which is exactly what a jump wants.
 */
function jbRevealTable(tableId, table, d) {
  const wrap = table.parentElement;
  const collapsed = (table.style && table.style.display === "none")
    || (wrap && wrap.style && wrap.style.display === "none");
  if (!collapsed) return false;

  const owner = jbTableHeading(tableId, table, d);
  if (!owner) return false;
  owner.click();
  return true;
}

/**
 * The <h2> that toggles a table.
 *
 * Every table is `<h2>` then `<div class="table-wrap"><table id=…>`, siblings
 * inside the band body — so the heading is one hop back from the wrap. The
 * forward scan below is the fallback for anything laid out differently, and it
 * is only a fallback: scanning forward from EVERY h2 matches the first heading
 * on the page whose sibling chain happens to reach the table, which for a table
 * late in a band is some earlier, unrelated section. Clicking that one collapsed
 * a different table and left the jump target still hidden.
 */
function jbTableHeading(tableId, table, d) {
  let n = table;
  while (n) {
    const prev = n.previousElementSibling;
    if (prev && prev.tagName === "H2") return prev;
    n = n.parentElement;
    if (n && n.classList && n.classList.contains("tgroup")) break;
  }
  const h2s = [...d.doc.querySelectorAll("h2")];
  return h2s.find((h) => {
    let s = h.nextElementSibling;
    while (s) {
      if (s === table || s.querySelector?.(`#${tableId}`)) return true;
      s = s.nextElementSibling;
    }
    return false;
  }) || null;
}

/**
 * Reveal an enchant variant row. The toggle is keyed on the BASE id — adding the
 * variant id would expand nothing. Mirrors the [data-expand-craft] handler.
 */
function jbRevealVariant(tableId, itemId, d) {
  if (!itemId || !itemId.includes("@")) return false;
  if (!d.collapseVariantTables || !d.collapseVariantTables.has(tableId)) return false;
  if (!d.expandedFor) return false;
  const baseId = itemId.replace(/@\d+$/, "");
  d.expandedFor(tableId).add(baseId);
  // Revealing a Craft Planner variant is not enough to SEE one: the planner's
  // scan skips enchanted ids on purpose and fetches them on demand, so the row
  // would appear with no prices. Fire-and-forget, exactly as the manual expand
  // handler does it (js/app.js) — the caller re-looks-up once it lands.
  if (tableId === "craft-planner-table" && d.ensureVariantPrices) {
    try { d.ensureVariantPrices({ baseId }); } catch (e) { /* offline: the row still reveals */ }
  }
  if (d.updateTableDisplay) d.updateTableDisplay(tableId);
  return true;
}

/**
 * Clear the table's free-text filter. The user asked for one specific row; an
 * unrelated filter left on is the difference between landing and appearing to
 * do nothing. Only touched when it actually holds a query.
 */
function jbClearFilter(tableId, d) {
  const input = d.doc.getElementById(`search-${tableId}`);
  if (!input || !input.value) return false;
  input.value = "";
  if (typeof input.dispatchEvent === "function") {
    // The filter re-runs on `input`, not on the value assignment.
    const evt = (typeof Event === "function") ? new Event("input", { bubbles: true }) : { type: "input" };
    input.dispatchEvent(evt);
  }
  return true;
}

/**
 * The row itself, by three keys in descending confidence.
 *
 *   1. the row key,
 *   2. an item id ON THE ROW element,
 *   3. an item id anywhere inside the table.
 *
 * Step 2 exists because step 3 takes the first match in document order, and
 * plenty of tables print an item id inside a cell: the Craft Planner's material
 * lines and journal cells both do, and a combine cape's material line is
 * literally another row's item id — so a jump aimed at that cape landed on an
 * earlier row's Materials column. A row-level match cannot be an inline span
 * belonging to someone else.
 *
 * Step 1 does not always apply. The Crafting table keys `id|craftCity`, and the
 * planner keeps ONE row per item under whichever craft city pays more (it keys
 * on the bare item id for exactly that reason) — so a board row's key cannot be
 * carried across, and the item id is what matches.
 */
function jbFindTarget(tableId, rowKey, itemId, d) {
  if (rowKey) {
    const byKey = d.doc.querySelector(`#${tableId} tr[data-row-key="${_jbjEscape(rowKey)}"]`);
    if (byKey) return byKey;
  }
  if (itemId) {
    const id = _jbjEscape(itemId);
    const byRow = d.doc.querySelector(`#${tableId} tr[data-item-id="${id}"]`);
    if (byRow) return byRow;
    const cell = d.doc.querySelector(`#${tableId} [data-item-id="${id}"]`);
    // Resolve to the ROW — the match is on a cell or an inline price span.
    if (cell) return (typeof cell.closest === "function" ? cell.closest("tr") : null) || cell;
  }
  return null;
}

/**
 * Reveal everything in the way, then return the target row (or null, and the
 * caller falls back to the table itself).
 *
 * @param {{tableId:string, rowKey?:string, itemId?:string}} target
 * @param {object} [deps] injected collaborators — see _jbjDeps
 */
function jbJumpTo({ tableId, rowKey, itemId }, deps) {
  const d = _jbjDeps(deps);
  if (!d.doc || !tableId) return null;
  const table = d.doc.getElementById(tableId);
  if (!table) return null;

  jbRevealBand(table, d);
  jbRevealTable(tableId, table, d);
  jbRevealVariant(tableId, itemId, d);
  jbClearFilter(tableId, d);

  return jbFindTarget(tableId, rowKey, itemId, d);
}

/**
 * The first target that resolves to a row.
 *
 * A board row may name a table that is a better destination than the one it was
 * collected from — a Crafting play jumps to the Craft Planner, where its
 * materials can be refined or transmuted rather than merely priced. The planner
 * does not hold every crafted item, and its own Sell/Buy city picks can hide the
 * one it does hold, so the feeder's own table stays behind it as a fallback.
 *
 * Each target is REVEALED as it is tried, so a fallback that is never needed
 * costs an unfold of a band the user probably wanted open anyway. Nothing is
 * reset: a filter the user set on the planner stays set, and the jump lands on
 * the fallback instead of fighting it.
 *
 * @param {Array<{tableId:string, rowKey?:string, itemId?:string}>} targets
 * @returns {{target:Element|null, tableId:string|null}} the row and the table it
 *   was found in; `target` null means nothing matched and `tableId` names the
 *   first target, which is where the caller should scroll.
 */
function jbJumpToFirst(targets, deps) {
  const list = (targets || []).filter((t) => t && t.tableId);
  if (!list.length) return { target: null, tableId: null };
  for (const t of list) {
    const found = jbJumpTo(t, deps);
    if (found) return { target: found, tableId: t.tableId };
  }
  return { target: null, tableId: list[0].tableId };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    jbRevealBand,
    jbRevealTable,
    jbTableHeading,
    jbRevealVariant,
    jbClearFilter,
    jbFindTarget,
    jbJumpTo,
    jbJumpToFirst,
  };
}
