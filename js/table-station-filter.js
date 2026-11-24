// The Crafting table's Station picker (Warrior's Forge / Hunter's Lodge / Mage's
// Tower / Toolmaker / …).
//
// Split out of js/table-search.js, which had grown past the repo's 800-line cap:
// this is the one picker that is not generic — every other control filters on
// something every table has (text, tier, enchant, category, city), while the
// station only means anything on a table that renders one row per craft.
//
// Same shape as js/table-filters.js: a plain classic script that publishes one
// namespace object, so the browser reaches it through `window.tableStationFilter`
// and Node through require().

(function () {
  const filters =
    (typeof window !== "undefined" && window.tableFilters) ||
    (typeof require === "function" ? require("./table-filters.js") : {});
  const { buildFilterSelect, idsFromRowKey } = filters;

  function stationFilterId(tableId) {
    return "stationfilter-" + tableId;
  }

  // Tables that also get a crafting-station picker (Warrior's Forge / Hunter's
  // Lodge / Mage's Tower / Toolmaker / …). Only the Crafting table renders one
  // row per craft, so it is the only place the pick is meaningful.
  const STATION_FILTER_TABLES = new Set(["crafting-table"]);

  // Station for one <tr>: the renderer stamps `data-station` (js/render-crafting.js
  // via getCraftStation), and we fall back to classifying the ids in the row key
  // so a row that predates the attribute still filters.
  function rowStation(tr) {
    const attr =
      (tr && typeof tr.getAttribute === "function" && tr.getAttribute("data-station")) || "";
    if (attr) return attr;
    const byId = typeof getCraftStationForId === "function" ? getCraftStationForId : null;
    if (!byId) return "";
    const key =
      (tr && typeof tr.getAttribute === "function" && tr.getAttribute("data-row-key")) || "";
    for (const id of idsFromRowKey(key)) {
      const st = byId(id);
      if (st) return st;
    }
    return "";
  }

  function rowPassesStation(tr, stationSel) {
    if (!stationSel) return true;
    return rowStation(tr) === stationSel;
  }

  // Keep the picker honest: only offer stations the table currently HAS rows for
  // (the crafting scan carries no cook/alchemist rows — meals and potions have
  // their own table), plus whatever is selected so the active pick never
  // disappears from under the user. No-op outside a real DOM.
  function syncStationOptions(tableId, present) {
    const sel = document.getElementById(stationFilterId(tableId));
    if (!sel || typeof document.createElement !== "function" || !sel.options) return;
    const stations = typeof CRAFT_STATIONS !== "undefined" ? CRAFT_STATIONS : [];
    const keep = stations
      .map((s) => s.key)
      .filter((k) => present.has(k) || k === sel.value);
    const current = Array.from(sel.options).map((o) => o.value).filter(Boolean);
    if (current.length === keep.length && current.every((k, i) => k === keep[i])) return;
    const picked = sel.value;
    while (sel.options.length > 1) sel.remove(1);
    keep.forEach((k) => {
      const op = document.createElement("option");
      op.value = k;
      const label = stations.find((s) => s.key === k).label;
      op.textContent = stationLabel(label);
      op.setAttribute("data-i18n", stationSlug(label));
      sel.appendChild(op);
    });
    sel.value = picked;
  }

  /** Slug for a crafting-station name: "Warrior's Forge" → station_warriors_forge. */
  function stationSlug(label) {
    return "station_" + String(label).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "_");
  }

  /** Crafting-station name in the current language (keys stay English). */
  function stationLabel(label) {
    if (typeof tx !== "function" || !label) return label;
    return tx(label, stationSlug(label));
  }

  // Append a Station picker after `ref`. Options come from CRAFT_STATIONS
  // (js/data-craft-stations.js) so the list and the classifier can never drift
  // apart.
  function injectStationControl(tableId, input, onChange) {
    if (!input || !input.parentNode) return input;
    if (document.getElementById(stationFilterId(tableId))) return input;
    const stations = typeof CRAFT_STATIONS !== "undefined" ? CRAFT_STATIONS : [];
    if (!stations.length) return input;
    const label = typeof t === "function" ? t("station") : "Station";
    const sel = buildFilterSelect(
      stationFilterId(tableId),
      label === "station" ? "Station" : label,
      stations.map((s) => ({ value: s.key, label: stationLabel(s.label), slug: stationSlug(s.label) })),
      "station",
    );
    sel.addEventListener("change", onChange);
    sel.addEventListener("click", (e) => e.stopPropagation());
    input.parentNode.insertBefore(sel, input.nextSibling);
    return sel;
  }

  const api = {
    stationFilterId,
    STATION_FILTER_TABLES,
    rowStation,
    rowPassesStation,
    syncStationOptions,
    stationSlug,
    stationLabel,
    injectStationControl,
  };

  if (typeof window !== "undefined") window.tableStationFilter = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
