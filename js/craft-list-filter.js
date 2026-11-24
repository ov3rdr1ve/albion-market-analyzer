// My Crafting List — its own search box and picker row.
//
// Every other data table gets these from js/table-search.js: a free-text box
// plus Category ▸ Subcategory ▸ Tier ▸ Ench. ▸ Buy City ▸ Sell City ▸ Reset.
// The list was left out because it is not a flat table. It is a shell whose
// rows are per-source INNER tables (js/render-craft-list.js _clGroupTableHtml),
// and the generic pass reads `#<tableId> tbody` — the outer one — so it would
// hide whole groups wholesale instead of the rows inside them.
//
// So the pickers are the shared ones (injectFilterControls, so the list's row
// reads identically to every other table's and the Reset button comes along),
// and only the traversal is local: walk each group's inner rows, judge them
// with the same predicates the generic filter uses, and hide a group together
// with its label row once nothing inside it survives.
//
// THE CITY PICKS RE-PRICE, they do not filter. A list entry keeps the city its
// source table chose, so filtering on "Sell City: Lymhurst" could only keep the
// entries that already sold there and hid the rest. A moved pick re-renders the
// list instead (js/render-craft-list.js _clListState), pricing every entry at
// that city through its source table. Only an entry the pick cannot apply to —
// a source table with no city pick, or a craft city that cannot reach it — is
// still judged on the cities its row names.
//
// FILTERING IS A VIEW. The Totals row and the "Materials to Buy" board keep
// covering the WHOLE list while a filter is active — narrowing to one tier must
// not quietly change what the list says you need to buy. Same contract the
// Reset filters button documents in js/table-filters.js.

(function () {
  const search =
    (typeof window !== "undefined" && window.tableSearchInternals) ||
    (typeof require === "function" ? require("./table-search.js") : {});
  const filters =
    (typeof window !== "undefined" && window.tableFilters) ||
    (typeof require === "function" ? require("./table-filters.js") : {});

  const TABLE_ID = "craft-list-table";
  const INPUT_ID = "search-" + TABLE_ID;

  /** Read live off the DOM so a repaint re-applies the current picks. */
  function pickerValue(id) {
    if (typeof document === "undefined") return "";
    const el = document.getElementById(id);
    return (el && el.value) || "";
  }

  /**
   * Every group in the list, as `{ wrapper, label, rows }`.
   *
   * `wrapper` is the `tr.cl-group-row` holding one source table; `label` is the
   * `tr.cl-group` heading directly above it. They hide and show together — a
   * heading left standing over an emptied group reads as a broken filter.
   */
  function craftListGroups() {
    if (typeof document === "undefined") return [];
    const table = document.getElementById(TABLE_ID);
    if (!table || typeof table.querySelectorAll !== "function") return [];
    return Array.from(table.querySelectorAll("tr.cl-group-row")).map((wrapper) => ({
      wrapper,
      label: wrapper.previousElementSibling || null,
      // The group's own body rows only: "tbody tr" also reached the
      // tr.cl-colhead of the nested table's <thead>.
      rows: Array.from(wrapper.querySelectorAll(":scope table.cl-inner > tbody > tr")),
      headers: Array.from(wrapper.querySelectorAll("tr.cl-colhead")),
    }));
  }

  /**
   * One leg of the list's City pick. A row re-priced at the pick
   * (data-cl-repriced-<side>, set by js/render-craft-list.js) honours it by
   * construction; any other row is judged on the cities its cells name, as the
   * generic filter does.
   */
  function rowPassesListCity(tr, side, citySel) {
    if (!citySel) return true;
    const repriced = tr && typeof tr.getAttribute === "function"
      ? tr.getAttribute(`data-cl-repriced-${side}`)
      : null;
    if (repriced === citySel) return true;
    return filters.rowCities(tr, side).has(citySel);
  }

  /**
   * Apply the active query + pickers to the list. Safe to call after every
   * render — no input, or no list on screen, and it is a no-op.
   */
  function applyCraftListFilter() {
    if (typeof document === "undefined") return;
    const input = document.getElementById(INPUT_ID);
    if (!input) return;

    const q = (input.value || "").trim().toLowerCase();
    const terms = q ? q.split(/\s+/).filter(Boolean) : [];
    const tierSel = pickerValue(search.tierFilterId(TABLE_ID));
    const enchSel = pickerValue(search.enchFilterId(TABLE_ID));
    const stationSel = pickerValue(search.stationFilterId(TABLE_ID));
    const catSel = pickerValue(filters.categoryFilterId(TABLE_ID));
    const subSel = pickerValue(filters.subcategoryFilterId(TABLE_ID));
    const buyCitySel = pickerValue(filters.buyCityFilterId(TABLE_ID));
    const sellCitySel = pickerValue(filters.sellCityFilterId(TABLE_ID));

    // A moved City pick re-prices the whole list, which is a re-render, not a
    // DOM pass. The render ends by calling back in here, where nothing has moved
    // any more. Both detectors run: each records what its picker reads now.
    const sellMoved = typeof sellCityFilterChanged === "function"
      && sellCityFilterChanged(TABLE_ID, sellCitySel);
    const buyMoved = typeof buyCityFilterChanged === "function"
      && buyCityFilterChanged(TABLE_ID, buyCitySel);
    if (sellMoved || buyMoved) {
      // Re-pricing every source is seconds of work: hand it to the async
      // scheduler (loading mark, one source per step, a frame between them).
      // requestTableRender is not used — its outer-table text filter would hide
      // whole groups. With no scheduler coming, render inline as before.
      const scheduled = typeof scheduleRerender === "function"
        && scheduleRerender("city-pick", { priorityTableId: TABLE_ID });
      if (!scheduled && typeof renderCraftListTable === "function") renderCraftListTable();
      return;
    }

    const filtering =
      terms.length > 0 || tierSel !== "" || enchSel !== "" || stationSel !== "" ||
      catSel !== "" || subSel !== "" || buyCitySel !== "" || sellCitySel !== "";

    // Collected across ALL groups, so a picker offers what the whole list holds
    // rather than whichever group happened to be walked last.
    const catPairsPresent = [];
    const stationsPresent = new Set();
    const buyCitiesPresent = new Set();
    const sellCitiesPresent = new Set();
    // Data rows this pass walked. An empty list is not evidence that the
    // pickers have nothing to offer, and pruning on it would blank the option
    // lists they are seeded with and hide them — same guard the generic pass
    // applies (js/table-search.js applyTableSearchFilter).
    let dataRows = 0;

    craftListGroups().forEach(({ wrapper, label, rows, headers }) => {
      let anyVisible = false;
      // A panel row (the Craft Planner's open "paths" row) has no identity of
      // its own — it inherits the data row above it rather than matching on its
      // own text, exactly as the generic pass treats it.
      let lastVisible = false;
      // A column header is never a filter target; undo any earlier hide.
      headers.forEach((h) => { h.style.display = ""; });
      rows.forEach((tr) => {
        const kind = search.classifyRow(tr);
        if (kind.skip) return;
        if (kind.follows) {
          tr.style.display = lastVisible ? "" : "none";
          return;
        }
        if (!kind.data) return; // no structural headers inside a group table
        dataRows++;
        if (typeof search.rowStation === "function") {
          const st = search.rowStation(tr);
          if (st) stationsPresent.add(st);
        }
        catPairsPresent.push(...filters.rowCategoryPairs(tr));
        filters.rowCities(tr, "buy").forEach((c) => buyCitiesPresent.add(c));
        filters.rowCities(tr, "sell").forEach((c) => sellCitiesPresent.add(c));

        const visible =
          search.rowMatches(tr, terms) &&
          search.rowPassesTierEnch(tr, tierSel, enchSel) &&
          search.rowPassesStation(tr, stationSel) &&
          filters.rowPassesCategory(tr, catSel, subSel) &&
          rowPassesListCity(tr, "buy", buyCitySel) &&
          rowPassesListCity(tr, "sell", sellCitySel);
        tr.style.display = visible ? "" : "none";
        lastVisible = visible;
        if (visible) anyVisible = true;
      });

      // With nothing filtering an empty group can only mean an empty list, and
      // the panel has its own message for that — never hide on an idle filter.
      const showGroup = !filtering || anyVisible;
      wrapper.style.display = showGroup ? "" : "none";
      if (label && label.classList && label.classList.contains("cl-group")) {
        label.style.display = showGroup ? "" : "none";
      }
    });

    if (dataRows === 0) return;
    if (typeof filters.syncCategoryOptions === "function") {
      filters.syncCategoryOptions(TABLE_ID, catPairsPresent, catSel);
    }
    if (typeof filters.syncSideCityOptions === "function") {
      filters.syncSideCityOptions(TABLE_ID, "buy", buyCitiesPresent);
      filters.syncSideCityOptions(TABLE_ID, "sell", sellCitiesPresent);
    }
    if (typeof search.syncStationOptions === "function") {
      search.syncStationOptions(TABLE_ID, stationsPresent);
    }
  }

  /**
   * Wire the box and inject the pickers. Idempotent — same shape as the panel's
   * own module-init in js/render-craft-list.js.
   *
   * No Enter-to-fetch here: a list row is drawn by its SOURCE table's formatter
   * from that table's own data, so there is nothing for searchFetchForTable to
   * go and fetch on this table's behalf.
   */
  function setupCraftListFilter() {
    if (typeof document === "undefined") return;
    const input = document.getElementById(INPUT_ID);
    if (!input || input._clFilterBound) return;
    input._clFilterBound = true;
    input.addEventListener("input", applyCraftListFilter);
    // The collapsible <h2> toggles on click; focusing the box must not fold the
    // panel shut underneath the user.
    input.addEventListener("click", (e) => e.stopPropagation());
    if (typeof search.injectFilterControls === "function") {
      search.injectFilterControls(TABLE_ID, input, applyCraftListFilter);
    }
    applyCraftListFilter();
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", setupCraftListFilter);
    } else {
      setupCraftListFilter();
    }
  }

  const api = { TABLE_ID, INPUT_ID, craftListGroups, applyCraftListFilter, setupCraftListFilter, rowPassesListCity };
  if (typeof window !== "undefined") {
    window.craftListFilter = api;
    window.applyCraftListFilter = applyCraftListFilter;
    window.setupCraftListFilter = setupCraftListFilter;
  }
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
