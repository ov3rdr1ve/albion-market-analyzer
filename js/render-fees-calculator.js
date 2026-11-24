/**
 * Fees Calculator (top-of-page tool) + Saved Trades comparison table.
 *
 * The form lets the user enter buy/sell price + quantity + per-side order
 * type (Instant vs Market Order) and see the net silver after Albion's
 * market fees. They can also tag a trade with an Item/Note + City/Route
 * and "Save Row" to stash it in the comparison table below.
 *
 * Fee rules. Same model as the profit tables (js/calculations.js SETUP_FEE /
 * PREMIUM_TAX), except that those follow the header's single Pricing Model
 * radio while this form takes the two sides independently:
 *   - Buy Instant:  no fee          (buy_cost = price × qty)
 *   - Buy Market:   +2.5 % setup    (buy_cost = price × qty × 1.025)
 *   - Sell Instant: -salesTax        (revenue = price × qty × (1 - tax))
 *   - Sell Market:  -salesTax -2.5 % (revenue = price × qty × (1 - tax - 0.025))
 * Sales tax: 4 % with Premium, 8 % without.
 *
 * Pure helpers (calculateFees, buildSavedRow, appendRow, removeRow,
 * summarizeTrades) are exported via module.exports for the node test harness.
 */
(function () {
  "use strict";

  const SETUP_FEE_RATE = 0.025;
  const PREMIUM_TAX = 0.04;
  const NON_PREMIUM_TAX = 0.08;
  const LS_KEY = "feesCalculatorState";
  const LS_SAVED_KEY = "feesCalculatorSavedRows";

  // ── pure helpers (no DOM, no globals) ────────────────────────────────────

  function calculateFees(opts) {
    const buyPrice = Math.max(0, Number(opts.buyPrice) || 0);
    const sellPrice = Math.max(0, Number(opts.sellPrice) || 0);
    const quantity = Math.max(0, Number(opts.quantity) || 0);
    const buyMode = opts.buyMode === "instant" ? "instant" : "market";
    const sellMode = opts.sellMode === "instant" ? "instant" : "market";
    const salesTaxRate = opts.premium === false ? NON_PREMIUM_TAX : PREMIUM_TAX;

    const buyGross = buyPrice * quantity;
    const buySetupFee = buyMode === "market" ? buyGross * SETUP_FEE_RATE : 0;
    const buyCost = buyGross + buySetupFee;

    const sellGross = sellPrice * quantity;
    const sellSalesTax = sellGross * salesTaxRate;
    const sellSetupFee = sellMode === "market" ? sellGross * SETUP_FEE_RATE : 0;
    const sellRevenue = sellGross - sellSalesTax - sellSetupFee;

    const netProfit = sellRevenue - buyCost;
    const profitPerItem = quantity > 0 ? netProfit / quantity : 0;
    const marginPct = buyCost > 0 ? (netProfit / buyCost) * 100 : 0;

    return {
      buyGross, buySetupFee, buyCost,
      sellGross, sellSalesTax, sellSetupFee, sellRevenue,
      netProfit, profitPerItem, marginPct, salesTaxRate,
      buyMode, sellMode,
    };
  }

  function makeId() {
    return `row_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // Snapshot a form state into a saved-row record. We persist both the inputs
  // (so "Load" can re-populate the form) and the calculated outputs (so the
  // comparison table doesn't have to recompute and stays consistent even if
  // fee constants change later).
  function buildSavedRow(state, idFn) {
    const r = calculateFees(state);
    const newId = (idFn || makeId)();
    return {
      id: newId,
      savedAt: Date.now(),
      name: String(state.name || "").trim(),
      city: String(state.city || "").trim(),
      buyPrice: Math.max(0, Number(state.buyPrice) || 0),
      sellPrice: Math.max(0, Number(state.sellPrice) || 0),
      quantity: Math.max(0, Number(state.quantity) || 0),
      buyMode: r.buyMode,
      sellMode: r.sellMode,
      premium: state.premium !== false,
      buyCost: r.buyCost,
      sellRevenue: r.sellRevenue,
      netProfit: r.netProfit,
      marginPct: r.marginPct,
      salesTaxRate: r.salesTaxRate,
    };
  }

  function appendRow(row, list) {
    return Array.isArray(list) ? [...list, row] : [row];
  }

  function removeRow(id, list) {
    return Array.isArray(list) ? list.filter((r) => r.id !== id) : [];
  }

  // Replace the row with matching id (keeping its position) — used by "Edit"
  // so saving an edited trade updates it in place instead of appending a
  // duplicate. Non-mutating; leaves the list unchanged if the id isn't found.
  function updateRow(id, newRow, list) {
    return Array.isArray(list) ? list.map((r) => (r.id === id ? newRow : r)) : [];
  }

  function summarizeTrades(list) {
    const base = { count: 0, totalBuyCost: 0, totalRevenue: 0, totalProfit: 0 };
    if (!Array.isArray(list)) return base;
    return list.reduce((acc, r) => ({
      count: acc.count + 1,
      totalBuyCost: acc.totalBuyCost + (Number(r.buyCost) || 0),
      totalRevenue: acc.totalRevenue + (Number(r.sellRevenue) || 0),
      totalProfit: acc.totalProfit + (Number(r.netProfit) || 0),
    }), base);
  }

  // ── DOM wiring (browser only) ────────────────────────────────────────────

  function fmt(n) {
    if (!isFinite(n)) return "0";
    return Math.round(n).toLocaleString();
  }

  function sign(v) {
    return v >= 0 ? "+" : "";
  }

  function profitClass(p) {
    if (p > 0) return "fc-positive";
    if (p < 0) return "fc-negative";
    return "";
  }

  function modeAbbr(m) {
    return m === "instant" ? "I" : "M";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function readState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function writeState(state) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
  }
  function readSaved() {
    try {
      const raw = localStorage.getItem(LS_SAVED_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch { return []; }
  }
  function writeSaved(list) {
    try { localStorage.setItem(LS_SAVED_KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
  }

  function attach() {
    const root = document.getElementById("fees-calculator");
    if (!root) return;

    const get = (id) => root.querySelector(`#${id}`);
    const els = {
      name: get("fc-name"),
      city: get("fc-city"),
      buyPrice: get("fc-buy-price"),
      sellPrice: get("fc-sell-price"),
      quantity: get("fc-quantity"),
      buyInstant: get("fc-buy-instant"),
      buyMarket: get("fc-buy-market"),
      sellInstant: get("fc-sell-instant"),
      sellMarket: get("fc-sell-market"),
      premium: get("fc-premium"),
      save: get("fc-save-row"),
      clearForm: get("fc-clear-form"),
      clearAll: get("fc-clear-all"),
      tbody: get("fc-saved-tbody"),
      tfoot: get("fc-saved-tfoot"),
      countEl: get("fc-saved-count"),
    };

    // id of the saved row currently bound to the form via "Edit" (null = not
    // editing; the next "Save Row" appends a new row). When set, "Save Row"
    // updates that row in place instead.
    let editingId = null;

    // restore form state
    const saved = readState();
    if (saved) {
      if (saved.name != null) els.name.value = saved.name;
      if (saved.city != null) els.city.value = saved.city;
      if (saved.buyPrice != null) els.buyPrice.value = saved.buyPrice;
      if (saved.sellPrice != null) els.sellPrice.value = saved.sellPrice;
      if (saved.quantity != null) els.quantity.value = saved.quantity;
      if (saved.buyMode === "instant") els.buyInstant.checked = true;
      else els.buyMarket.checked = true;
      if (saved.sellMode === "instant") els.sellInstant.checked = true;
      else els.sellMarket.checked = true;
      els.premium.checked = saved.premium !== false;
    }

    function readForm() {
      return {
        name: els.name.value,
        city: els.city.value,
        buyPrice: Number(els.buyPrice.value) || 0,
        sellPrice: Number(els.sellPrice.value) || 0,
        quantity: Number(els.quantity.value) || 0,
        buyMode: els.buyInstant.checked ? "instant" : "market",
        sellMode: els.sellInstant.checked ? "instant" : "market",
        premium: els.premium.checked,
      };
    }

    function refreshResults() {
      const state = readForm();
      writeState(state);
      const r = calculateFees(state);
      const taxPct = (r.salesTaxRate * 100).toFixed(0);

      const silverWord = tx("silver", "r_silver");
      get("fc-buy-cost").textContent = `${fmt(r.buyCost)} ${silverWord}`;
      get("fc-buy-detail").textContent = r.buySetupFee > 0
        ? `${tx("gross", "r_gross")} ${fmt(r.buyGross)} + ${tx("setup", "r_setup")} ${fmt(r.buySetupFee)} (2.5%)`
        : `${tx("gross", "r_gross")} ${fmt(r.buyGross)} ${tx("(no fees — instant buy)", "r_no_fees_instant_buy")}`;

      get("fc-sell-revenue").textContent = `${fmt(r.sellRevenue)} ${silverWord}`;
      const sellParts = [
        `${tx("gross", "r_gross")} ${fmt(r.sellGross)}`,
        `− ${tx("tax", "r_tax")} ${fmt(r.sellSalesTax)} (${taxPct}%)`,
      ];
      if (r.sellSetupFee > 0) sellParts.push(`− ${tx("setup", "r_setup")} ${fmt(r.sellSetupFee)} (2.5%)`);
      get("fc-sell-detail").textContent = sellParts.join(" ");

      const netEl = get("fc-net-profit");
      netEl.textContent = `${sign(r.netProfit)}${fmt(r.netProfit)} ${tx("silver", "r_silver")}`;
      netEl.className = `fc-result-value ${profitClass(r.netProfit)}`;

      const perEl = get("fc-profit-per-item");
      perEl.textContent = state.quantity > 0
        ? `${sign(r.profitPerItem)}${fmt(r.profitPerItem)}`
        : "—";
      perEl.className = `fc-inline-value ${profitClass(r.netProfit)}`;

      const marginEl = get("fc-margin");
      marginEl.textContent = r.buyCost > 0
        ? `${sign(r.marginPct)}${r.marginPct.toFixed(2)}%`
        : "—";
      marginEl.className = `fc-inline-value ${profitClass(r.netProfit)}`;
    }

    function rowHtml(row) {
      const modeStr = `${modeAbbr(row.buyMode)}/${modeAbbr(row.sellMode)}`;
      const marginStr = row.buyCost > 0
        ? `${sign(row.marginPct)}${row.marginPct.toFixed(2)}%`
        : "—";
      const trCls = row.id === editingId ? ' class="fc-row-editing"' : "";
      return `<tr data-row-id="${escapeHtml(row.id)}"${trCls}>
        <td class="fc-cell-name">${row.name ? escapeHtml(row.name) : '<span class="fc-muted">${tx("(unnamed)", "r_unnamed")}</span>'}</td>
        <td class="fc-cell-city">${row.city ? escapeHtml(row.city) : '<span class="fc-muted">—</span>'}</td>
        <td class="fc-num">${fmt(row.buyPrice)}</td>
        <td class="fc-num">${fmt(row.sellPrice)}</td>
        <td class="fc-num">${fmt(row.quantity)}</td>
        <td class="fc-mode-cell" title="Buy ${row.buyMode} / Sell ${row.sellMode}${row.premium ? " · Premium" : " · No Premium"}">${modeStr}${row.premium ? "" : "*"}</td>
        <td class="fc-num">${fmt(row.buyCost)}</td>
        <td class="fc-num">${fmt(row.sellRevenue)}</td>
        <td class="fc-num ${profitClass(row.netProfit)}"><strong>${sign(row.netProfit)}${fmt(row.netProfit)}</strong></td>
        <td class="fc-num ${profitClass(row.netProfit)}">${marginStr}</td>
        <td class="fc-row-actions">
          <button type="button" class="fc-row-btn fc-row-edit" data-act="edit" data-id="${escapeHtml(row.id)}" title="${tx("Edit this row — saving updates it in place", "r_tip_edit_row")}">✎</button>
          <button type="button" class="fc-row-btn" data-act="load" data-id="${escapeHtml(row.id)}" title="${tx("Load a copy into the calculator — saving adds a new row", "r_tip_load_row")}">↺</button>
          <button type="button" class="fc-row-btn fc-row-del" data-act="del" data-id="${escapeHtml(row.id)}" title="${tx("Delete this saved row", "r_tip_delete_row")}">✕</button>
        </td>
      </tr>`;
    }

    function renderSaved() {
      const list = readSaved();
      els.countEl.textContent = `(${list.length})`;
      els.clearAll.hidden = list.length === 0;
      if (list.length === 0) {
        els.tbody.innerHTML = `<tr><td colspan="11" class="fc-saved-empty">${tx('No saved trades yet — fill in the calculator and click "+ Save Row".', "r_no_saved_trades")}</td></tr>`;
        els.tfoot.innerHTML = "";
        return;
      }
      els.tbody.innerHTML = list.map(rowHtml).join("");
      const s = summarizeTrades(list);
      els.tfoot.innerHTML = `<tr class="fc-totals-row">
        <td colspan="6">${tx("Totals", "r_totals")} (${s.count} ${s.count === 1 ? tx("row", "r_row") : tx("rows", "r_rows")})</td>
        <td class="fc-num">${fmt(s.totalBuyCost)}</td>
        <td class="fc-num">${fmt(s.totalRevenue)}</td>
        <td class="fc-num ${profitClass(s.totalProfit)}"><strong>${sign(s.totalProfit)}${fmt(s.totalProfit)}</strong></td>
        <td></td><td></td>
      </tr>`;
    }

    function loadIntoForm(row) {
      els.name.value = row.name || "";
      els.city.value = row.city || "";
      els.buyPrice.value = row.buyPrice || "";
      els.sellPrice.value = row.sellPrice || "";
      els.quantity.value = row.quantity || 0;
      if (row.buyMode === "instant") els.buyInstant.checked = true;
      else els.buyMarket.checked = true;
      if (row.sellMode === "instant") els.sellInstant.checked = true;
      else els.sellMarket.checked = true;
      els.premium.checked = row.premium !== false;
      refreshResults();
    }

    function clearForm() {
      els.name.value = "";
      els.city.value = "";
      els.buyPrice.value = "";
      els.sellPrice.value = "";
      els.quantity.value = 1;
      els.buyMarket.checked = true;
      els.sellMarket.checked = true;
      els.premium.checked = true;
      exitEditing();        // no-op when not editing
      refreshResults();
      els.name.focus();
    }

    // Enter edit mode: bind the form to row `id` so the next "Save Row"
    // updates it in place. Relabels the action buttons and re-renders the
    // table so the edited row gets highlighted.
    function setEditing(id) {
      editingId = id;
      els.save.textContent = tx("✓ Update Row", "r_update_row");
      els.save.classList.add("fc-updating");
      els.clearForm.textContent = tx("Cancel Edit", "r_cancel_edit");
      renderSaved();
    }

    // Leave edit mode and restore the default button labels. Guarded so it is
    // a safe no-op (and won't re-render) when we aren't actually editing.
    function exitEditing() {
      if (!editingId) return;
      editingId = null;
      els.save.textContent = "+ Save Row";
      els.save.classList.remove("fc-updating");
      els.clearForm.textContent = "Clear Form";
      renderSaved();
    }

    // Save the current form: append a new row, or — when editing — update the
    // bound row in place (same id, same position) instead of duplicating it.
    els.save.addEventListener("click", () => {
      const state = readForm();
      if (state.buyPrice === 0 && state.sellPrice === 0) return; // nothing to save
      const list = readSaved();
      if (editingId && list.some((r) => r.id === editingId)) {
        const updated = buildSavedRow(state, () => editingId); // keep the same id
        writeSaved(updateRow(editingId, updated, list));
        exitEditing(); // re-renders with the row no longer highlighted
      } else {
        writeSaved(appendRow(buildSavedRow(state), list));
        renderSaved();
      }
    });

    els.clearForm.addEventListener("click", clearForm);

    els.clearAll.addEventListener("click", () => {
      if (readSaved().length === 0) return;
      if (typeof confirm === "function" && !confirm("Clear all saved trades?")) return;
      writeSaved([]);
      renderSaved();
    });

    // Delegated handler for per-row edit/load/delete buttons
    els.tbody.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button[data-act]");
      if (!btn) return;
      const id = btn.dataset.id;
      const list = readSaved();
      const row = list.find((r) => r.id === id);
      if (!row) return;
      const act = btn.dataset.act;
      if (act === "del") {
        writeSaved(removeRow(id, list));
        if (editingId === id) exitEditing(); // editing target removed → leave edit mode
        else renderSaved();
      } else if (act === "load") {
        // Load a detached copy: cancel any active edit so saving adds a new row.
        exitEditing();
        loadIntoForm(row);
      } else if (act === "edit") {
        // Bind the form to this row; the next "Save Row" updates it in place.
        loadIntoForm(row);
        setEditing(id);
        els.name.focus({ preventScroll: true });
        if (typeof root.scrollIntoView === "function") {
          root.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    });

    // Live recompute on any form change
    ["input", "change"].forEach((ev) => {
      root.addEventListener(ev, (e) => {
        // Ignore events from the saved-trades table (buttons in tbody)
        if (els.tbody.contains(e.target) || els.tfoot.contains(e.target)) return;
        refreshResults();
      });
    });

    refreshResults();
    renderSaved();

    // The "Fees Calculator" <h2> in index.html sits directly before this
    // section, so app.js's setupCollapsibleTables() treats the whole tool as a
    // collapsible block keyed on the inner #fc-saved-table. That handler wipes
    // the table's <tbody> on collapse and, on expand, only restores tables that
    // expose a _staticRenderer (we have no tableState entry). Register
    // renderSaved as ours — mirroring render-brecilien-fees / render-city-bonuses
    // — so collapsing→expanding (or reloading while collapsed) rebuilds the
    // saved trades instead of leaving them blank until the next Save/Edit/Delete.
    const savedTable = document.getElementById("fc-saved-table");
    if (savedTable) savedTable._staticRenderer = renderSaved;
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", attach);
    } else {
      attach();
    }
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      calculateFees,
      buildSavedRow,
      appendRow,
      removeRow,
      updateRow,
      summarizeTrades,
      SETUP_FEE_RATE,
      PREMIUM_TAX,
      NON_PREMIUM_TAX,
    };
  }
})();
