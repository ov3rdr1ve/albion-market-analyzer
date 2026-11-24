/**
 * My Crafting List — the panel's delegated event wiring.
 *
 * Split out of js/render-craft-list.js when that file hit the repo's 800-line
 * cap. Everything here is delegated on `document`, because the panel's rows are
 * rebuilt from scratch on every repaint: header sorting, the ✕ remove buttons,
 * the per-row quantity box, the laborer headcount and the focus budget.
 *
 * Loaded AFTER js/render-craft-list.js — the handlers call renderCraftListTable
 * and _clRefreshTotalsOnly, which are function declarations and so reach this
 * file through the global scope.
 */

// ─── Panel wiring (idempotent module-init) ──────────────────────────────────
(function _initCraftListPanel() {
  if (typeof document === "undefined") return;
  if (document._craftListInit) return;
  document._craftListInit = true;

  const attach = () => {
    const table = document.getElementById("craft-list-table");
    // Collapsing the panel wipes the tbody; app.js's expand handler restores
    // tables that expose a _staticRenderer (same trick as the Fees Calculator).
    if (table) table._staticRenderer = renderCraftListTable;
    const mats = document.getElementById("craft-list-mats-table");
    if (mats) mats._staticRenderer = renderCraftListTable;

    const clearBtn = document.getElementById("cl-clear-all");
    if (clearBtn && !clearBtn._clBound) {
      clearBtn._clBound = true;
      clearBtn.addEventListener("click", () => {
        if (typeof getCraftList === "function" && getCraftList().length === 0) return;
        if (typeof confirm === "function"
            && !confirm(tx("Clear My Crafting List?", "r_cl_confirm_clear"))) return;
        clearCraftList();
        renderCraftListTable();
        // The "+" buttons still showing ✓ live in the source tables.
        document.querySelectorAll("[data-add-row].is-added").forEach((el) => {
          el.classList.remove("is-added");
          el.textContent = "+";
        });
      });
    }
    renderCraftListTable();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", attach);
  else attach();

  // Header sorting. Delegated, unlike the app-wide binder in js/app.js, which
  // binds th.sortable once at DOMContentLoaded over the static HTML — these
  // headers are rebuilt on every repaint. That binder also reads
  // th.closest("table").id, which is empty on the inner tables, so it cannot
  // collide with this one.
  document.addEventListener("click", (e) => {
    const th = e.target.closest("#craft-list-table th.sortable[data-sort]");
    if (!th) return;
    const table = th.closest("[data-cl-group]");
    if (!table) return;
    setCraftListSort(table.getAttribute("data-cl-group"), th.getAttribute("data-sort"));
    renderCraftListTable();
  });

  // Remove buttons (delegated: the rows are rebuilt on every repaint).
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cl-remove]");
    if (!btn) return;
    e.preventDefault();
    const tableId = btn.getAttribute("data-table-id");
    const rowKey = btn.getAttribute("data-row-key");
    removeCraftListEntry(tableId, rowKey);
    [...document.querySelectorAll(`[data-add-row][data-table-id="${tableId}"]`)]
      .filter((el) => el.getAttribute("data-row-key") === rowKey)
      .forEach((el) => { el.classList.remove("is-added"); el.textContent = "+"; });
    renderCraftListTable();
  });

  // The "10k" button beside a quantity box: fill in what one focus bar buys.
  // The count is computed at render (js/craft-list-qty-focus.js) and carried on
  // the button, so the click needs no market data. Totals + materials only,
  // like a typed quantity — the row itself does not change.
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cl-qty-focus]");
    if (!btn) return;
    e.preventDefault();
    const tableId = btn.getAttribute("data-table-id");
    const rowKey = btn.getAttribute("data-row-key");
    const qty = btn.getAttribute("data-cl-qty-focus");
    setCraftListQty(tableId, rowKey, qty);
    // _clRefreshTotalsOnly deliberately leaves every quantity box alone, so the
    // field is written here or it would keep showing the old number.
    // The "10k" chip sits in the qty cell; the focus-loss warning (js/craft-list-focus-loss-warning.js)
    // sits in Total Profit, so the box is looked up on the row.
    const cell = btn.closest("tr") || btn.closest("td");
    const input = cell && cell.querySelector("[data-cl-qty]");
    const list = (typeof getCraftList === "function") ? getCraftList() : [];
    const entry = list.find((x) => x.tableId === tableId && x.rowKey === rowKey);
    if (input && entry) input.value = entry.qty;
    _clRefreshTotalsOnly();
  });

  /**
   * Commit what the quantity box holds, then show back what was stored.
   *
   * An UNFINISHED expression is refused rather than committed. `96+` reaches
   * the store as an unreadable quantity, which it reads as "one of these" — so
   * an Enter one character early would silently throw the plan away and leave a
   * 1 behind. The field falls back to the quantity that is already stored
   * instead. Plain garbage ("abc") keeps its old meaning; only arithmetic that
   * is mid-typing is held back.
   */
  const commitQty = (input) => {
    const tableId = input.getAttribute("data-table-id");
    const rowKey = input.getAttribute("data-row-key");
    const unfinished = typeof isQtyExpression === "function"
      && typeof parseQtyExpression === "function"
      && isQtyExpression(input.value)
      && parseQtyExpression(input.value) === null;
    if (!unfinished) setCraftListQty(tableId, rowKey, input.value);
    const list = (typeof getCraftList === "function") ? getCraftList() : [];
    const entry = list.find((x) => x.tableId === tableId && x.rowKey === rowKey);
    if (entry && String(entry.qty) !== input.value) input.value = entry.qty;
    _clRefreshTotalsOnly();
  };

  // Quantity edits: recompute the totals + the materials board only, so the
  // input the user is typing in is never replaced mid-keystroke.
  //
  // A half-typed expression is NOT committed. `96+96` passes through `96+` on
  // its way in, and `96+` is not a quantity — committing the `96` before it
  // would drop the second stack the moment the field lost focus. Arithmetic
  // therefore waits for Enter or blur; a plain number still lands per keystroke,
  // which is what makes the totals track a typed digit.
  document.addEventListener("input", (e) => {
    const input = e.target.closest("[data-cl-qty]");
    if (!input) return;
    if (typeof isQtyExpression === "function" && isQtyExpression(input.value)) return;
    setCraftListQty(input.getAttribute("data-table-id"), input.getAttribute("data-row-key"), input.value);
    _clRefreshTotalsOnly();
  });

  // Enter commits the expression. Bound explicitly rather than left to the
  // browser's own `change`-on-Enter: the field is inside no form, and the panel
  // has to answer the keystroke whether or not the value changed.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const input = e.target.closest && e.target.closest("[data-cl-qty]");
    if (!input) return;
    e.preventDefault();
    commitQty(input);
  });
  // Blur (and the browser's own Enter, where it fires one). Same commit: an
  // expression is evaluated here, and the field is normalized to what was
  // actually stored (0/blank/1e9 → the stored qty).
  document.addEventListener("change", (e) => {
    const input = e.target.closest("[data-cl-qty]");
    if (!input) return;
    commitQty(input);
  });

  // Laborer headcount: back-solve the quantities from how many laborers you
  // have. On `change` only — this one repaints the whole panel (every quantity
  // moves), which would yank the box out from under a keystroke on `input`.
  document.addEventListener("change", (e) => {
    const box = e.target.closest("[data-cl-laborers]");
    if (!box) return;
    const changes = scaleCraftListToLaborers(_clSolverEntries(), box.value);
    changes.forEach((c) => setCraftListQty(c.tableId, c.rowKey, c.qty));
    // Repaint even with nothing to change: the box has to fall back to the count
    // the list actually fills rather than keep whatever was typed into it.
    renderCraftListTable();
  });

  // Focus budget. Totals + materials only, like a quantity edit — the rows
  // themselves do not change, only how much of each one the budget can focus,
  // and repainting them would yank the box out from under the keystroke.
  document.addEventListener("change", (e) => {
    const box = e.target.closest("[data-cl-focus-budget]");
    if (!box) return;
    setCraftListFocusBudget(box.value);
    // _clRefreshTotalsOnly rewrites the whole totals cell, so the box comes back
    // as a new node already carrying the normalized value — a blank or a
    // negative shows as the number that was actually stored.
    _clRefreshTotalsOnly();
  });
})();
