/**
 * My Crafting List panel — the rows the user picked with the "+" column.
 *
 * Rows are NOT re-implemented here: each entry is rendered by its source
 * table's own formatter (tableState[tableId].formatter), then the resulting
 * <tr> is edited in the DOM — the "+" cell becomes a ✕, and a quantity and a
 * per-row total are appended. That is what makes a list row look and edit
 * exactly like the table row it came from: the price cells are the same
 * `.price-editable` cells, and the app-wide editor in js/app.js picks them up
 * wherever they sit in the document.
 *
 * Because columns differ per table, entries are grouped by source table and
 * each group gets its own column header, cloned from that table's <thead>.
 *
 * Economics (per-row totals, footer, the Materials to buy board) come from the
 * pure extractors in js/craft-list-materials.js.
 */

function _clFmt(n) {
  if (typeof formatSilver === "function") return formatSilver(n);
  return Math.round(Number(n) || 0).toLocaleString();
}

function _clEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/**
 * The list's own "Total Buy Cost" cell — what this row's quantity costs to buy.
 * Parked rows read "—" for the same reason their profit does: a 0 there would
 * read as "free", not as "not being run".
 *
 * A row that spends Faction Points (Faction Spending) also gets a second line:
 * the FP its quantity needs; an Energy Manipulator row, the Favor. Neither is
 * silver, so each sits beside the silver figure rather than inside it.
 */
function _clCostCell(cost, parked, fpTotal, favorTotal) {
  const tip = tx("Quantity × what one of these costs to buy — the same silver the footer totals",
    "r_cl_row_cost_tip");
  return `<td class="silver-val cl-row-cost" title="${_clEsc(tip)}">`
    + `${_clCostCellInner(cost, parked, fpTotal, favorTotal)}</td>`;
}

/**
 * The cost cell's contents alone — shared by the full render and the
 * keystroke refresh, so typing a quantity rescales the FP / Favor lines
 * instead of wiping them.
 */
function _clCostCellInner(cost, parked, fpTotal, favorTotal) {
  const fp = Number(fpTotal) || 0;
  const fpLine = (!parked && fp > 0)
    ? `<small class="cl-row-fp" style="color:#fbbf24;display:block;font-size:0.7rem" title="${_clEsc(
      tx("Faction Points this quantity needs: Qty × the FP one unit costs", "r_cl_row_fp_tip"))}">`
      + `${Math.round(fp).toLocaleString()} ${tx("FP", "r_fp")}</small>`
    : "";
  const favor = Number(favorTotal) || 0;
  const favorLine = (!parked && favor > 0)
    ? `<small class="cl-row-favor" style="color:#a78bfa;display:block;font-size:0.7rem" title="${_clEsc(
      tx("Favor this quantity needs at the Energy Manipulator: Qty × the Favor one unit costs", "r_cl_row_favor_tip"))}">`
      + `${Math.round(favor).toLocaleString()} ${tx("Favor", "r_favor")}</small>`
    : "";
  return `${parked ? "—" : _clFmt(cost)}${fpLine}${favorLine}`;
}

/**
 * One group's rows wrapped in their OWN table.
 *
 * Every group used to share a single <table>, and an HTML table sizes column N
 * from the widest cell in column N across the whole thing — so the Crafting
 * Planner's multi-line "Profit / Craft" and "Journal Fill" cells stretched the
 * Consumables group's "Margin" and "Pure Profit" to match, and the list ran far
 * off screen for no reason. The groups do not even share a column layout (they
 * have different column counts and different meanings), so the shared sizing
 * was never right; each group's cloned header only lined up with its own data
 * by accident.
 *
 * The outer table keeps its id and its single column — it is the layout shell
 * the band rows and the totals row live in. Each group table scrolls inside its
 * own wrapper, so one wide group no longer drags the others sideways.
 */
function _clGroupTableHtml(tableId, rowsHtml) {
  // data-cl-group carries the source table id: the inner tables have no id of
  // their own, and the delegated sort handler needs to know which group a
  // clicked header belongs to.
  return `<tr class="cl-group-row"><td class="cl-group-cell"><div class="cl-group-wrap">`
    + `<table class="data-table cl-inner" data-cl-group="${_clEsc(tableId)}">`
    + `<thead>${_clHeaderRow(tableId)}</thead>`
    + `<tbody>${rowsHtml}</tbody>`
    + `</table></div></td></tr>`;
}

/** Group table + row key: two different sources can use the same key. */
function _clHeldKey(tableId, rowKey) {
  return `${tableId}\u0000${rowKey}`;
}

/**
 * The rows the LAST render drew, by group and row key, so a row whose source is
 * momentarily unresolved can be re-drawn as it was instead of collapsing to a
 * placeholder (see _clPlaceholderRow).
 *
 * Placeholders are not harvested: a "scan X to fill this row" row holds nothing
 * worth keeping. A row already held IS harvested, so it survives a burst of
 * passes rather than only the first.
 */
function _clHeldRows(tbody) {
  const held = new Map();
  if (!tbody || typeof tbody.querySelectorAll !== "function") return held;
  tbody.querySelectorAll("table.cl-inner").forEach((table) => {
    const groupId = (typeof table.getAttribute === "function"
      && table.getAttribute("data-cl-group")) || "";
    const body = table.tBodies && table.tBodies[0];
    if (!body) return;
    Array.prototype.forEach.call(body.rows, (tr) => {
      const key = typeof tr.getAttribute === "function" ? tr.getAttribute("data-row-key") : null;
      if (!key) return;
      const cls = (tr.className || "").split(/\s+/);
      if (cls.includes("cl-pending") || cls.includes("cl-missing")) return;
      // Marked on a CLONE — the live row is about to be replaced, and writing
      // the class onto it would flag rows that were never carried over.
      // cl-held lets the next pass tell a carried row from a computed one.
      const copy = typeof tr.cloneNode === "function" ? tr.cloneNode(true) : tr;

      // No open editor may reach the cache: a mid-pass render re-emits held rows
      // verbatim (_clPlaceholderRow), so cached popup markup is the phantom
      // input the user keeps seeing after a cancel. Detected by MARKUP, not by
      // the .pe-editing marker alone — a close path that lost its cell (a
      // re-render detached it) leaves the popup behind with the class already
      // stripped. cloneNode does not copy the _oldHtml expando, so it is read
      // off the original cell while it is still there.
      const origTds = typeof tr.querySelectorAll === "function" ? tr.querySelectorAll("td") : [];
      const copyTds = typeof copy.querySelectorAll === "function" ? copy.querySelectorAll("td") : [];
      origTds.forEach((origTd, i) => {
        const clonedTd = copyTds[i];
        if (!clonedTd) return;
        const marked = !!(origTd.classList && typeof origTd.classList.contains === "function"
          && origTd.classList.contains("pe-editing"));
        const hasPopup = typeof origTd.querySelector === "function"
          && !!origTd.querySelector(".pe-popup");
        if (!marked && !hasPopup) return;
        if (origTd._oldHtml != null) {
          clonedTd.innerHTML = origTd._oldHtml;
        } else if (typeof clonedTd.querySelectorAll === "function") {
          clonedTd.querySelectorAll(".pe-popup").forEach((n) => {
            if (typeof n.remove === "function") n.remove();
          });
        }
        if (clonedTd.classList && typeof clonedTd.classList.remove === "function") {
          clonedTd.classList.remove("pe-editing");
        }
        if (clonedTd.style) clonedTd.style.position = "";
      });
      if (copy.classList) copy.classList.add("cl-held");
      held.set(_clHeldKey(groupId, key), copy.outerHTML);
    });
  });
  return held;
}

/**
 * A row whose source table has no matching (or no scanned) row yet.
 *
 * Two different situations wear the same empty row, and telling them apart is
 * the whole point:
 *
 *   nothing has been computed yet and nothing is coming — the user has never
 *   scanned this table, so "scan X to fill this row" is exactly the next step,
 *   and it is worth a sentence because it asks for something;
 *
 *   the app is computing this very row — at boot (js/boot-state.js) or during
 *   the pass a price edit kicked off (js/render-async.js). That one asks for
 *   nothing, so it says nothing: it wears the same spinning ring every other
 *   waiting table in the app wears (js/table-loading-mark.js). It used to spell
 *   out "Computing… this row fills when X is done.", which was a sentence per
 *   row telling the user to wait — and telling them to press a button there,
 *   as the panel did before that, is telling them to redo work already in
 *   flight (js/render-schedule.js).
 */
function _clPlaceholderRow(entry, held) {
  const name = (typeof getItemDisplayName === "function" && entry.itemId)
    ? getItemDisplayName(entry.itemId)
    : (entry.itemId || entry.rowKey);
  const label = craftListTableLabel(entry.tableId);
  const working = (typeof isBootFilling === "function" && isBootFilling())
    || (typeof isRerenderBusy === "function" && isRerenderBusy());
  // Mid-pass, the row this one replaces is the better report: it holds the last
  // numbers, and js/recalc-cell-mark.js is already dimming and spinning them.
  // Swapping in this placeholder instead threw those cells away and left one
  // sentence spanning the group — measured at 238px narrower than the row it
  // replaced, so the group table stepped in and back out on every pass. Only
  // while work is in flight: once it is not, an unresolved row really has
  // nothing behind it, and "scan X" is the honest thing to say.
  if (working) {
    const kept = held && held.get(_clHeldKey(entry.tableId, entry.rowKey));
    if (kept) return kept;
  }
  // The row's own five cells are remove / Qty / Cost / Total / name, so the last
  // one fills whatever the group's header row has left. Never more: an over-long
  // colspan adds columns that are not there, and the .row-fluid wrapper is what
  // stops what is inside from sizing the ones that are (css/styles.css).
  const span = Math.max(1, _clGroupColCount(entry.tableId) - 5);
  // Working: the ring, with the sentence only as the label a screen reader
  // hears. Not working: the sentence itself, because it asks for something.
  const cell = working
    ? `<td colspan="${span}">`
      + `<span class="row-fluid row-computing" role="status" aria-label="`
      + `${_clEsc(tx("Computing… this row fills when {table} is done.", "r_cl_row_computing")
        .replace("{table}", label))}"></span></td>`
    : `<td colspan="${span}" style="color:#6b7280;font-style:italic">`
      + `<span class="row-fluid row-note">`
      + `${tx("Not priced yet — scan {table} to fill this row.", "r_cl_row_unpriced")
        .replace("{table}", label)}</span></td>`;
  const parked = !(entry.qty > 0) ? " cl-qty-zero" : "";
  return `<tr class="${working ? "cl-pending" : "cl-missing"}${parked}" data-row-key="${_clEsc(entry.rowKey)}">`
    + `<td class="cell-add">${_clRemoveBtn(entry)}</td>`
    + _clQtyCell(entry)
    + _clCostCell(0, true)
    + `<td class="silver-val cl-row-total">—</td>`
    + `<td class="cell-item">${_clEsc(name)}</td>`
    + cell
    + `</tr>`;
}

/**
 * Keep only the entry's own data row (plus any rows AFTER it) of a source
 * formatter's output, and return it.
 *
 * A stateful formatter (Artifact Rolling) PREPENDS group-header rows
 * (`data-header-cat` / `data-header-roll`) to the first row of each group. The
 * list renders one entry at a time, so those headers are noise — and grafting
 * the list cells onto them left the real row with its source "+" cell. The data
 * row is the first <tr> carrying `data-row-key` or a `td.cell-add`; everything
 * before it, and any header row, is dropped. Falls back to the first row.
 */
function _clIsolateDataRow(temp) {
  const rows = Array.from(temp.children || []);
  // A minimal DOM (the renderer tests' stubs) can't inspect rows: take the first.
  if (!rows.length || typeof rows[0].hasAttribute !== "function") return temp.firstElementChild;
  const isHeader = (r) => r.hasAttribute("data-header-cat") || r.hasAttribute("data-header-roll");
  const isData = (r) => !isHeader(r) && (r.hasAttribute("data-row-key") || !!r.querySelector("td.cell-add"));
  const data = rows.find(isData) || rows[0];
  const at = rows.indexOf(data);
  rows.forEach((r, i) => { if (i < at || (i > at && isHeader(r))) r.remove(); });
  return data;
}

/**
 * Render one entry through its source formatter and graft on the list's own
 * cells. Returns an HTML string (the caller joins them), or the placeholder
 * when the row can't be found.
 */
function _clEntryRowHtml(entry, state, extracted, held, split) {
  const found = findCraftListRow(state, entry);
  const src = found.state || state;
  if (!found.row || !src || !src.formatter || typeof document === "undefined") {
    return _clPlaceholderRow(entry, held);
  }
  const temp = document.createElement("tbody");
  try {
    // A re-priced row (the list's City pick) is formatted with that pick
    // active, so any cell that reads the pick at format time agrees with the
    // numbers the row was built from.
    const fmt = () => src.formatter(found.row, found.idx);
    temp.innerHTML = (found.repriced && typeof withTableCityPicks === "function")
      ? withTableCityPicks(entry.tableId, found.repriced, fmt)
      : fmt();
  } catch (e) {
    console.error(`[craft-list] formatter failed for ${entry.tableId}:`, e);
    return _clPlaceholderRow(entry, held);
  }
  const tr = _clIsolateDataRow(temp);
  if (!tr) return _clPlaceholderRow(entry, held);
  // Which legs this row was re-priced on, for the list's filter
  // (js/craft-list-filter.js): those already honour the pick, and must not be
  // judged a second time on the cities their text happens to name.
  if (found.repriced && found.repriced.sell) tr.setAttribute("data-cl-repriced-sell", found.repriced.sell);
  if (found.repriced && found.repriced.buy) tr.setAttribute("data-cl-repriced-buy", found.repriced.buy);

  // Parked rows read "—", not "0": a zero total is a row that breaks even, and
  // this one is a row that is not being run at all.
  const parked = !(entry.qty > 0);
  const rowSplit = split || { fundedQty: entry.qty, unfundedQty: 0 };
  const rowProfit = _clRowProfit(extracted, rowSplit);
  const cls = parked ? "" : (rowProfit > 0 ? "profit-high" : (rowProfit < 0 ? "profit-negative" : ""));
  const listCells = `<td class="cell-add">${_clRemoveBtn(entry)}</td>`
    + _clQtyCell(entry, extracted)
    + _clCostCell(_clRowCost(extracted, rowSplit), parked,
      (Number(extracted && extracted.fpCost) || 0) * (Number(entry.qty) || 0),
      (Number(extracted && extracted.favorCost) || 0) * (Number(entry.qty) || 0))
    + `<td class="silver-val cl-row-total ${cls}">${parked ? "—" : _clFmt(rowProfit)}`
    + _clSelfFoundTotalLine(extracted, entry.qty, parked) + (typeof clPerDayLine === "function" ? clPerDayLine(found.row, rowProfit, parked) : "")
    + (typeof clFocusLossWarningLine === "function" ? clFocusLossWarningLine(found.row, extracted, entry, rowSplit, parked) : "")
    + `</td>`;

  // The source row's "+" cell is replaced by the four list cells (outerHTML,
  // so one cell becomes four) — keeping them at the left edge where they stay
  // visible on tables wide enough to scroll.
  // Re-base "Profit / 10k Focus" on the planned quantity — while the row still
  // has the SOURCE column layout, so the header index lines up (the graft below
  // turns one cell into four).
  // A breeding row's cell is the focus-ONLY gain of one bar (js/render-mounts.js),
  // which the planned quantity does not change: it stays exactly as its table
  // prints it, three lines included, instead of being added to Total Profit.
  if (typeof patchPer10kCell === "function" && !found.row.isBreeding) {
    patchPer10kCell(tr, entry.tableId, found.row.profitPer10kFocus, rowProfit, parked,
      found.row.profitPer10kFocusSelfFound, found.row.profitPer10kFocusGathered,
      clTwinProfits(extracted, rowSplit, entry.qty, rowProfit));
  }

  const addCell = tr.querySelector("td.cell-add");
  if (addCell) addCell.outerHTML = listCells;
  else tr.insertAdjacentHTML("afterbegin", listCells);

  // A formatter may emit MORE than one <tr>: the Crafting Planner appends its
  // open "paths" panel row after the data row (js/render-craft-planner.js). The
  // list used to return only the first row, so that panel silently vanished
  // here while it worked in the table itself. Keep every row, and widen the
  // trailing ones' colspan by the three columns the graft just added (one
  // td.cell-add became four cells).
  const extras = temp.children || [];
  for (let i = 1; i < extras.length; i++) {
    const cells = extras[i].querySelectorAll ? extras[i].querySelectorAll("td[colspan]") : [];
    cells.forEach((td) => {
      const n = parseInt(td.getAttribute("colspan"), 10) || 1;
      td.setAttribute("colspan", String(n + 3));
    });
  }
  return parked ? _clMarkParked(temp.innerHTML.trim()) : temp.innerHTML.trim();
}

/**
 * Tag the opening <tr> of a source-formatted row as parked.
 *
 * Done on the STRING, not through classList: the row markup is the source
 * table's formatter output and this function's only handle on it is the HTML it
 * returns — the <tr> element itself is thrown away a line later. Every formatter
 * in the app writes `class="…"` double-quoted; anything else is left alone
 * rather than risking a second class attribute.
 */
function _clMarkParked(html) {
  const m = html.match(/^<tr\b[^>]*>/i);
  if (!m) return html;
  const tag = m[0];
  const marked = /\sclass="/.test(tag)
    ? tag.replace(/\sclass="/, ' class="cl-qty-zero ')
    : (/\sclass=/.test(tag) ? tag : tag.replace(/^<tr/i, '<tr class="cl-qty-zero"'));
  return marked + html.slice(tag.length);
}

/*
 * The footer line and the Materials to Buy board moved to
 * js/render-craft-list-footer.js when this file reached the 800-line limit:
 * _clTotalsCellHtml, _clFocusHtml, _clLaborersHtml and _clRenderMaterials all
 * live there now. They stay plain globals, so the calls below are unchanged.
 *
 * The column header row went the same way for the same reason:
 * js/render-craft-list-header.js holds _clTh, _clHeaderRow and _clGroupColCount.
 */

/**
 * Close any open price editor before the rows below are rebuilt.
 *
 * The popup lives inside its cell (js/app.js), and a rebuild swaps every row —
 * an editor left open would be detached mid-gesture, its close path would find
 * the cell gone and skip the restore, and the next harvest would cache the
 * popup as row markup (the phantom input bug). Closing first keeps the harvest
 * clean; closeQuietly persists what the user typed, same as clicking another
 * cell does.
 */
function _clCloseOpenEditors() {
  if (typeof document === "undefined" || !document.querySelectorAll) return;
  document.querySelectorAll("td.pe-editing").forEach((td) => {
    if (typeof td._closeEditor === "function") td._closeEditor();
    td.classList.remove("pe-editing");
  });
  // Popups whose editor closure is already gone (class stripped, markup left).
  document.querySelectorAll("td .pe-popup").forEach((n) => {
    const td = typeof n.closest === "function" ? n.closest("td") : null;
    if (td && td._oldHtml != null) td.innerHTML = td._oldHtml;
    else if (typeof n.remove === "function") n.remove();
  });
}

/** Repaint the whole panel from the store. Safe to call on every render pass. */
function renderCraftListTable() {
  if (typeof document === "undefined") return;
  const tbody = document.querySelector("#craft-list-table tbody");
  if (!tbody) return;
  // Before anything is read or cloned: an open editor must never be harvested.
  _clCloseOpenEditors();

  const list = (typeof getCraftList === "function") ? getCraftList() : [];
  const countEl = document.getElementById("cl-count");
  if (countEl) countEl.textContent = `(${list.length})`;
  const clearBtn = document.getElementById("cl-clear-all");
  if (clearBtn) clearBtn.hidden = list.length === 0;
  const warnEl = document.getElementById("cl-save-warning");
  if (warnEl) {
    warnEl.hidden = !(typeof craftListSaveFailedFlag === "function" && craftListSaveFailedFlag());
  }

  if (!list.length) {
    // colspan 1: the shell table has ONE column (its band rows, group tables and
    // totals all sit in it). The 12 this used to claim invented eleven more.
    tbody.innerHTML = `<tr><td colspan="1" class="cl-empty">`
      + `<span class="row-fluid row-note">`
      + `${tx('Nothing on the list yet — click the "+" on any row to add it.', "r_cl_empty")}`
      + `</span></td></tr>`;
    _clRenderMaterials([]);
    return;
  }

  // Read BEFORE anything is replaced: what is on screen right now is what a
  // momentarily unresolved row falls back to instead of a placeholder.
  const held = _clHeldRows(tbody);

  // Resolve first, ALLOCATE second, sort third, render fourth. The focus budget
  // is a property of the whole basket — which rows get the focus depends on
  // every other row's silver-per-focus — so no row's own total can be drawn
  // until every row has been resolved.
  //
  // The allocation runs over the rows in the order they were ADDED — the order
  // the live quantity path allocates in (_clRefreshTotalsOnly) — so a header
  // click can never move focus between two tied rows. It used to run over the
  // SORTED rows, and the sort could not see the split at all: Total Profit,
  // Total Buy Cost and the re-based Profit / 10k Focus print split figures, so
  // they ordered against their own cells. Now each item carries its split
  // figures into the sort (js/craft-list-sort.js). Groups keep the order their
  // first row was added.
  const summaryEntries = [];
  const groups = [];
  const byTable = new Map();
  list.forEach((entry) => {
    if (!byTable.has(entry.tableId)) {
      const g = { tableId: entry.tableId, state: _clListState(entry.tableId), items: [] };
      byTable.set(entry.tableId, g);
      groups.push(g);
    }
    const group = byTable.get(entry.tableId);
    const found = findCraftListRow(group.state, entry);
    const extracted = found.row ? extractCraftListRow(entry.tableId, found.row) : null;
    // -1 marks a row with nothing to allocate — it renders as a placeholder.
    let at = -1;
    if (extracted) {
      at = summaryEntries.length;
      summaryEntries.push({ ...extracted, qty: entry.qty });
    }
    group.items.push({ entry, row: found.row, extracted, at });
  });

  const allocation = _clAllocate(summaryEntries);
  // No allocator (a bare load without js/craft-list-focus-budget.js) means no
  // budget: every unit is focused, which is what the list did before there was
  // one. `at` is -1 for a row that resolved to nothing — it renders as a
  // placeholder and never reads this.
  // Rows are priced STANDALONE (each as if it alone had the whole budget); only
  // the footer and the materials board use the shared `allocation`.
  const rowAllocation = _clAllocateRows(summaryEntries);
  const rowSplitAt = (at, qty) => (rowAllocation && rowAllocation.splits[at])
    || { fundedQty: qty, unfundedQty: 0 };

  const html = [];
  groups.forEach((group) => {
    group.items.forEach((it) => {
      it.split = rowSplitAt(it.at, it.entry.qty);
      it.profit = _clRowProfit(it.extracted, it.split);
      it.cost = _clRowCost(it.extracted, it.split);
    });
    const sorted = (typeof sortCraftListRows === "function")
      ? sortCraftListRows(group.items, group.tableId, craftListSortFor(group.tableId))
      : group.items;
    html.push(`<tr class="cl-group"><td>${_clEsc(craftListTableLabel(group.tableId))}</td></tr>`);
    const rows = sorted.map((it) => _clEntryRowHtml(it.entry, group.state, it.extracted, held, it.split));
    html.push(_clGroupTableHtml(group.tableId, rows.join("")));
  });

  html.push(`<tr class="cl-totals"><td>`
    + _clTotalsCellHtml(summarizeCraftList(summaryEntries, allocation), list.length)
    + `</td></tr>`);

  tbody.innerHTML = html.join("");
  _clRenderMaterials(summaryEntries, allocation);
  // The rows above are brand new nodes, so the active query has to be re-applied
  // to them — same "safe after every render" contract applyTableSearchFilter has
  // for every other table. Deliberately AFTER the materials board: filtering is
  // a view, and the shopping list covers the whole list either way.
  if (typeof applyCraftListFilter === "function") applyCraftListFilter();
}

/**
 * List entries with their identity AND their fill rate, for the back-solver.
 * Uses the same source lookup as the totals, so the fill rates it solves from
 * are the ones on screen.
 */
function _clSolverEntries() {
  const list = (typeof getCraftList === "function") ? getCraftList() : [];
  const states = new Map();
  const out = [];
  list.forEach((entry) => {
    if (!states.has(entry.tableId)) states.set(entry.tableId, _clListState(entry.tableId));
    const found = findCraftListRow(states.get(entry.tableId), entry);
    if (!found.row) return;
    const extracted = extractCraftListRow(entry.tableId, found.row);
    if (!extracted) return;
    out.push({
      tableId: entry.tableId, rowKey: entry.rowKey,
      qty: entry.qty, laborerFill: extracted.laborerFill,
    });
  });
  return out;
}

/** Totals + materials only — leaves the row DOM (and focus) untouched. */
function _clRefreshTotalsOnly() {
  const list = (typeof getCraftList === "function") ? getCraftList() : [];
  const entries = [];
  // Same source lookup the row renderer uses — reading tableState directly here
  // meant a stale/collapsed source never got caught up, so the footer and the
  // materials board disagreed with the rows above them. Memoised because this
  // runs on every keystroke in a quantity field and visits each table twice.
  const _states = new Map();
  const stateFor = (tid) => {
    if (!_states.has(tid)) _states.set(tid, _clListState(tid));
    return _states.get(tid);
  };
  // Where each list entry landed in `entries`, so the allocation's positional
  // splits can be read back per row below.
  const indexOfEntry = new Map();
  list.forEach((entry) => {
    const state = stateFor(entry.tableId);
    const found = findCraftListRow(state, entry);
    if (!found.row) return;
    const extracted = extractCraftListRow(entry.tableId, found.row);
    if (!extracted) return;
    indexOfEntry.set(_clHeldKey(entry.tableId, entry.rowKey), entries.length);
    entries.push({ ...extracted, qty: entry.qty });
  });

  // One typed digit can move which rows the budget covers, so the split is
  // rebuilt here too — the footer, the per-row totals and the shopping board
  // below all have to agree about it.
  const allocation = _clAllocate(entries);
  // Per-row cells use the standalone split; footer + materials stay shared.
  const rowAllocation = _clAllocateRows(entries);
  const totals = summarizeCraftList(entries, allocation);
  const totalsRow = document.querySelector("#craft-list-table tbody tr.cl-totals");
  if (totalsRow) {
    const cell = totalsRow.querySelector("td");
    if (cell) cell.innerHTML = _clTotalsCellHtml(totals, list.length);
  }

  // Per-row totals track the quantity being typed.
  document.querySelectorAll("#craft-list-table [data-cl-qty]").forEach((input) => {
    const tableId = input.getAttribute("data-table-id");
    const rowKey = input.getAttribute("data-row-key");
    const entry = list.find((x) => x.tableId === tableId && x.rowKey === rowKey);
    const state = stateFor(tableId);
    const found = entry ? findCraftListRow(state, entry) : { row: null };
    const extracted = found.row ? extractCraftListRow(tableId, found.row) : null;
    const row = input.closest("tr");
    const cell = row?.querySelector(".cl-row-total");
    const costCell = row?.querySelector(".cl-row-cost");
    if (!cell || !extracted || !entry) return;
    const parked = !(entry.qty > 0);
    // Dim on the keystroke, not on the next full repaint — this path exists
    // precisely so the field the user is typing in is never replaced.
    if (row.classList) row.classList.toggle("cl-qty-zero", parked);
    const at = indexOfEntry.get(_clHeldKey(tableId, rowKey));
    const split = (rowAllocation && at !== undefined && rowAllocation.splits[at])
      || { fundedQty: entry.qty, unfundedQty: 0 };
    const profit = _clRowProfit(extracted, split);
    // Rebuild BOTH lines: the headline and, when the source table prices a
    // self-gathered twin, the dimmed qty-scaled line under it — with the
    // twin's own tooltip re-substituted, so no stale value survives.
    const selfFoundLine = _clSelfFoundTotalLine(extracted, entry.qty, parked) + (typeof clPerDayLine === "function" ? clPerDayLine(found.row, profit, parked) : "")
      + (typeof clFocusLossWarningLine === "function" ? clFocusLossWarningLine(found.row, extracted, entry, split, parked) : "");
    if (selfFoundLine) cell.innerHTML = (parked ? "—" : _clFmt(profit)) + selfFoundLine;
    else cell.textContent = parked ? "—" : _clFmt(profit);
    cell.className = "silver-val cl-row-total "
      + (parked ? "" : (profit > 0 ? "profit-high" : (profit < 0 ? "profit-negative" : "")));
    // Guarded on its own: a row drawn before this column existed (a held row
    // carried over mid-pass) has a profit cell and no cost cell.
    if (costCell) {
      costCell.innerHTML = _clCostCellInner(_clRowCost(extracted, split), parked,
        (Number(extracted.fpCost) || 0) * (Number(entry.qty) || 0),
        (Number(extracted.favorCost) || 0) * (Number(entry.qty) || 0));
    }
    // Same reason the two cells above are updated here: this column carries the
    // planned quantity, so it must move with the field being typed.
    if (typeof refreshPer10kCell === "function") {
      refreshPer10kCell(row, profit, parked, clTwinProfits(extracted, split, entry.qty, profit));
    }
  });

  _clRenderMaterials(entries, allocation);
}

if (typeof module !== "undefined" && module.exports) {
  const source = require("./render-craft-list-source.js");
  module.exports = {
    renderCraftListTable,
    findCraftListRow: source.findCraftListRow,
    craftListTableLabel: source.craftListTableLabel,
    craftListSourceTableIds: source.craftListSourceTableIds,
    _clSourceState: source._clSourceState,
    _clListState: source._clListState,
    _clRefreshTotalsOnly,
    _clSolverEntries,
    _clCostCell,
    _clCostCellInner,
  };
}
