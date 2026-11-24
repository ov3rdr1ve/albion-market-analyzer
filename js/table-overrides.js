// Per-table "Clear overrides" button.
//
// The header's Clear Settings button wipes every manually entered value in the
// app at once. That is the wrong granularity when only one table's numbers have
// gone stale — re-typing the other 200 is not a realistic alternative, so people
// simply never clear anything. This button clears the manual data belonging to
// ONE table and leaves the rest alone.
//
// "Belonging to" = the item ids that table's rows are keyed on. Both sources are
// used, because neither alone is complete:
//   • `data-row-key` on each <tr> — the row's OWN items (product, raw→refined
//     pair). Present even on rows with no editable cell.
//   • `data-item-id` on each price-editable cell — the ids the user can actually
//     click, including material cells the row key never names.
//
// All three manual stores are cleared for those ids, matching the header
// button's definition of "manually entered": prices, volumes and pinned
// buy/sell cities. Quality-rerolling overrides live under the synthetic key
// `ID#Qn` (utils.js qualityOverrideKey), so an id matches its own `#Q` keys too.

(function () {
  const filters =
    (typeof window !== "undefined" && window.tableFilters) ||
    (typeof require === "function" ? require("./table-filters.js") : {});
  const idsFromRowKey = filters.idsFromRowKey || (() => []);

  /** Runtime string: English inline, Spanish from the UI_STRINGS_ES overlay. */
  function TX(en, slug) {
    return typeof tx === "function" ? tx(en, slug) : en;
  }

  /**
   * Does `storedKey` belong to `ids`? Exact match, or the `ID#Qn` synthetic key
   * the Quality Rerolling table stores its per-quality overrides under.
   */
  function keyBelongsTo(storedKey, ids) {
    if (ids.has(storedKey)) return true;
    const hash = storedKey.indexOf("#Q");
    return hash > 0 && ids.has(storedKey.slice(0, hash));
  }

  /**
   * Count the manual values held for `ids` across the three stores.
   * Pure — the stores are passed in so this is testable without globals.
   *
   * @param {Set<string>} ids
   * @param {{prices?: object, volumes?: object, cityForces?: object}} stores
   * @returns {number} one per (item, city) price, one per (item, city) volume,
   *   one per pinned side.
   */
  function countTableOverrides(ids, stores) {
    let n = 0;
    const perCity = (map) => {
      for (const [key, cities] of Object.entries(map || {})) {
        if (!keyBelongsTo(key, ids) || !cities || typeof cities !== "object") continue;
        n += Object.keys(cities).length;
      }
    };
    perCity(stores.prices);
    perCity(stores.volumes);
    for (const [key, sides] of Object.entries(stores.cityForces || {})) {
      if (!keyBelongsTo(key, ids) || !sides || typeof sides !== "object") continue;
      n += Object.keys(sides).length;
    }
    return n;
  }

  /**
   * Delete every manual value held for `ids`, in place. Returns how many were
   * removed (the same number countTableOverrides reported for the same input).
   */
  function clearTableOverrides(ids, stores) {
    const removed = countTableOverrides(ids, stores);
    [stores.prices, stores.volumes, stores.cityForces].forEach((map) => {
      if (!map) return;
      Object.keys(map).forEach((key) => {
        if (keyBelongsTo(key, ids)) delete map[key];
      });
    });
    return removed;
  }

  /** Every item id one table's rendered rows are keyed on or expose for editing. */
  function tableItemIds(tableId) {
    const ids = new Set();
    if (typeof document === "undefined" || !document.querySelectorAll) return ids;
    document.querySelectorAll(`#${tableId} tr[data-row-key]`).forEach((tr) => {
      idsFromRowKey(tr.getAttribute("data-row-key")).forEach((id) => ids.add(id));
    });
    document.querySelectorAll(`#${tableId} [data-item-id]`).forEach((el) => {
      const id = el.getAttribute("data-item-id");
      if (id) ids.add(id);
    });
    return ids;
  }

  /** The live stores, read at click time so a settings import is picked up. */
  function liveStores() {
    return {
      prices: typeof priceOverrides !== "undefined" ? priceOverrides : {},
      volumes: typeof volumeOverrides !== "undefined" ? volumeOverrides : {},
      cityForces: typeof cityForceOverrides !== "undefined" ? cityForceOverrides : {},
    };
  }

  function persistStores() {
    if (typeof saveOverridesToStorage === "function") saveOverridesToStorage();
    if (typeof saveVolumeOverridesToStorage === "function") saveVolumeOverridesToStorage();
    if (typeof saveCityForcesToStorage === "function") saveCityForcesToStorage();
  }

  /**
   * Clear one table's manual values, asking first. Overrides are hand-typed and
   * unrecoverable, so the confirm names the count and the table.
   */
  function clearOverridesForTable(tableId, tableLabel) {
    const ids = tableItemIds(tableId);
    const stores = liveStores();
    const n = countTableOverrides(ids, stores);
    if (n === 0) {
      alert(TX("No manually entered prices, volumes or pinned cities in this table.", "clear_table_overrides_none"));
      return 0;
    }
    const question = TX(
      "Clear {n} manually entered value(s) in {table}? This cannot be undone.",
      "clear_table_overrides_confirm",
    )
      .replace("{n}", String(n))
      .replace("{table}", tableLabel || tableId);
    if (!confirm(question)) return 0;
    clearTableOverrides(ids, stores);
    persistStores();
    if (typeof scheduleRerender === "function") {
      scheduleRerender("clear-overrides");
    } else if (typeof renderAllTables === "function"
      && typeof lastMarketData !== "undefined" && lastMarketData) {
      renderAllTables(lastMarketData);
    }
    return n;
  }

  /** Human name for a table, from its <h2> heading's first text span. */
  function tableLabelFor(tableId, ref) {
    const heading = ref && typeof ref.closest === "function" ? ref.closest("h2") : null;
    const span = heading && heading.querySelector ? heading.querySelector("span") : null;
    const text = span && span.textContent ? span.textContent.trim() : "";
    return text || tableId;
  }

  function clearButtonId(tableId) {
    return "clear-overrides-" + tableId;
  }

  /**
   * The collapse chevron the section wiring appends to a table's <h2>, if it has
   * one. Everything injected into the heading has to land BEFORE it, or the
   * chevron stops reading as the row's end marker.
   */
  function collapseIndicatorIn(heading) {
    if (!heading || !heading.children) return null;
    const last = heading.children[heading.children.length - 1];
    return last && last.tagName === "SPAN" && !last.id && !last.className ? last : null;
  }

  /**
   * Put the button at the end of the table's <h2> — after every filter picker,
   * since it is an action rather than a filter, but before the collapse
   * chevron. Idempotent.
   */
  function injectClearOverridesButton(tableId, ref) {
    if (!ref || !ref.parentNode || typeof document === "undefined") return null;
    if (document.getElementById(clearButtonId(tableId))) return null;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = clearButtonId(tableId);
    btn.className = "clear-overrides-btn";
    // "Clear" alone read as a filter reset next to the pickers — say what it
    // deletes (the neighbouring "✕ Reset filters" button is the view-only one).
    btn.textContent = "↺ " + TX("Clear overrides", "clear_table_overrides_btn");
    btn.title = TX(
      "Clear the manually entered prices, volumes and pinned cities for this table's items. Other tables keep theirs.",
      "clear_table_overrides_tip",
    );
    btn.setAttribute("data-i18n-title", "clear_table_overrides_tip");
    btn.addEventListener("click", (e) => {
      e.stopPropagation(); // never toggle the collapsible <h2>
      clearOverridesForTable(tableId, tableLabelFor(tableId, ref));
    });
    btn.addEventListener("mousedown", (e) => e.stopPropagation());
    const heading = ref.parentNode;
    heading.insertBefore(btn, collapseIndicatorIn(heading));
    return btn;
  }

  const api = {
    keyBelongsTo,
    countTableOverrides,
    clearTableOverrides,
    tableItemIds,
    clearOverridesForTable,
    clearButtonId,
    injectClearOverridesButton,
  };

  if (typeof window !== "undefined") {
    window.tableOverrides = api;
    window.injectClearOverridesButton = injectClearOverridesButton;
  }
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
