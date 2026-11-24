// Generic per-table free-text filter + in-game-style tier/enchant pickers.
//
// Mirrors the volume table's search box for (almost) every other data table:
// type into the box in a table's <h2> header and non-matching rows hide in
// place. Unlike the volume filter (which knows the volume row-object shape and
// can also match the hidden market id), this works on the RENDERED DOM text, so
// it needs zero per-table knowledge — you search exactly what you see.
//
// Matching is case-insensitive and AND-combined across whitespace-separated
// terms ("t6 martlock bag" must match all three), same semantics as
// filterVolumeRows.
//
// Alongside the text box each table also grows two dropdowns — Tier (T1–T8) and
// Enchant (.0–.4) — mirroring the in-game market's tier/enchant selectors. They
// AND with the text query. Tier/enchant per row are read from the item id in the
// row's `data-row-key` (e.g. "T6_2H_BOW@4|Martlock" → tier 6, enchant 4), with a
// visible-text fallback ("T4.2") for rows whose key holds no game id (transmute).
// The controls are injected at runtime next to each search box, so no render
// file or index.html header needs editing.
//
// Structural rows (royal/caerleon section dividers, rolling group headers, the
// brecilien group-label rows) stay visible only when at least one data row
// inside them survives the filter — so a header never lingers over an empty
// group. Nesting levels (rolling: category ⊃ roll-type) are resolved with a
// small stack so a category header stays whenever ANY descendant matches while
// a sibling roll-type header does not inherit another group's match.
//
// #rolling-table is in the box but its rows are collapse-owned: see
// COLLAPSE_OWNED_TABLES below — an active query owns display and shows matches
// through folded groups; without one applyRollingCollapsed keeps its folds and
// the pickers only hide rows on top of them.
//
// Excluded by design:
//   • #volume-table          — keeps its own object-level filter (matches id too)
//   • .breed-detail-row      — faction-spending toggles these open/closed via
//                              inline display; we never touch them so the toggle
//                              stays authoritative

(function () {
  // The Category / Subcategory / City pickers and the shared <select> + row-key
  // plumbing live in js/table-filters.js (loaded before this file in the browser).
  const filters =
    (typeof window !== "undefined" && window.tableFilters) ||
    (typeof require === "function" ? require("./table-filters.js") : {});
  const stationFilter =
    (typeof window !== "undefined" && window.tableStationFilter) ||
    (typeof require === "function" ? require("./table-station-filter.js") : {});
  const {
    parseRowTierEnchant,
    rowPassesTierEnch,
    classifyRow,
    catalogNameFor,
    rowMatches,
  } =
    (typeof window !== "undefined" && window.tableRowMatch) ||
    (typeof require === "function" ? require("./table-row-match.js") : {});
  const { searchRevealNeedsRepaint, scheduleSearchRevealRepaint } =
    (typeof window !== "undefined" && window.tableSearchRevealRepaint) ||
    (typeof require === "function" ? require("./table-search-reveal-repaint.js") : {});
  const {
    stationFilterId,
    STATION_FILTER_TABLES,
    rowStation,
    rowPassesStation,
    syncStationOptions,
    injectStationControl,
  } = stationFilter;
  const {
    idsFromRowKey,
    buildFilterSelect,
    categoryFilterId,
    subcategoryFilterId,
    cityFilterId,
    buyCityFilterId,
    sellCityFilterId,
    rowCategoryPairs,
    rowPassesCategory,
    rowCities,
    rowPassesBuyCity,
    rowPassesSellCity,
    syncCategoryOptions,
    syncSideCityOptions,
    injectCategoryControls,
    injectCityControl,
    injectBuyCityControl,
    injectSellCityControl,
    injectClearFiltersButton,
  } = filters;

  // Every data table that should get a generic search box. Each entry's input
  // is expected at id `search-<tableId>` (added in index.html).
  const SEARCHABLE_TABLES = [
    "joined-summary-table",
    "joined-focus-table",
    "bm-board-table",
    "crafting-table",
    "craft-planner-table",
    "flipping-table",
    "skins-trading-table",
    "transport-table",
    "laborers-table",
    "buildings-table",
    "consumable-table",
    "mounts-table",
    "faction-spending-table",
    "enchanting-table",
    "transmute-table",
    "rerolling-table",
    "rolling-table",
    "farming-table",
    "gathering-table",
    "journal-filling-table",
    "city-bonuses-table",
    "black-zone-bonuses-table",
    "black-zone-locations-table",
    "brecilien-fees-table",
    "roads-zones-table",
    "roads-portals-table",
  ];

  // Tables that get NO tier/enchant control (their rows aren't tiered — city
  // bonuses are one row per city). Everything else in SEARCHABLE_TABLES does.
  const TIER_ENCHANT_EXCLUDE = new Set([
    "city-bonuses-table",
    "black-zone-bonuses-table",
    "black-zone-locations-table",
    // Roads rows are zones and portals: the "tier" they show is a zone tier
    // written as a bare number, and a picker reading "T5" out of the rendered
    // text would match resource names instead.
    "roads-zones-table",
    "roads-portals-table",
  ]);

  // Tables that get the Tier picker but NOT the enchant one, because their rows
  // are tiered yet have no enchant level at all. A building is T1-T8 and that is
  // it — offering ".0-.4" there is a control that can only ever empty the table.
  const ENCHANT_EXCLUDE = new Set([
    "buildings-table",
  ]);

  // Tables that get NO Category/Subcategory pickers. Those options come from an
  // item's items.xml shopcategory, so a table whose rows are not market items has
  // nothing to offer: the buildings table showed a single "Other" entry that hid
  // every row when picked.
  const CATEGORY_EXCLUDE = new Set([
    "buildings-table",
  ]);

  // Tables whose rows are not market items at all — reference tables (city and
  // black-zone bonuses, zone lists, Brecilien fees) and the Roads tables, which
  // render captured portal data. They get neither Category/Subcategory nor a
  // City picker: with the pickers now SEEDED from the catalogs rather than
  // filled by the first render, an unlisted table would show a full city
  // droplist that can only ever empty it. Kept apart from CATEGORY_EXCLUDE,
  // which holds the buildings table: that one has no categories but does carry
  // buy-side price cells, so it keeps its Buy City pick.
  // Tables whose rows ARE market items but tag no price cell with a side
  // (`data-city-list`), so the split Buy/Sell City pickers can never read a city
  // off them: the Black Market board sells everything to one market and prints
  // its buy city as text. They were already hidden there — this keeps them out
  // of the header from the start rather than letting the first render remove
  // them.
  const NO_SIDE_CITY_TABLES = new Set(["bm-board-table"]);

  const NO_MARKET_ROW_TABLES = new Set([
    "city-bonuses-table",
    "black-zone-bonuses-table",
    "black-zone-locations-table",
    "brecilien-fees-table",
    "roads-zones-table",
    "roads-portals-table",
  ]);

  // Tables that filter their ROW OBJECTS before rendering instead of hiding
  // rendered <tr>s. The volume table is the only one: its Category/Subcategory/
  // City pickers are read and its option lists synced by applyVolumeTableFilters
  // (js/render-volume.js), off the row objects' itemId. This DOM pass must keep
  // its hands off both — a volume row key is "<display name>|<route>" and holds
  // no game id, so category matching here would find nothing and hide every row
  // the object filter had just kept.
  const OBJECT_FILTERED_TABLES = new Set(["volume-table"]);

  // Tables whose row display is normally owned by a per-group collapse, not by
  // this filter. Rolling is the only one: its category ⊃ roll-type headers hide
  // their rows via applyRollingCollapsed (js/app.js). Two owners of
  // `style.display` fight, so ownership is decided per pass — while a typed
  // query is active the filter owns display (a match shows even if its group is
  // folded, which is what "search" has to mean). Otherwise the collapse applier
  // owns it: idle, it alone paints; with only pickers active (tier, category,
  // city) the pickers can hide more rows but never unfold a minimized group.
  const COLLAPSE_OWNED_TABLES = new Map([["rolling-table", "applyRollingCollapsed"]]);

  function collapseApplierFor(tableId) {
    const name = COLLAPSE_OWNED_TABLES.get(tableId);
    if (!name || typeof window === "undefined") return null;
    return typeof window[name] === "function" ? window[name] : null;
  }

  // Tables whose enchant variant (@n) rows are collapsed at render time (see
  // sorting.js). For these the ENCHANT picker must RE-RENDER (not just re-filter
  // the DOM), so the collapse filter re-runs and reads the new enchant value —
  // otherwise a hidden variant row can never come back.
  //
  // Only the enchant one. Every other picker changes which rows are SHOWN, never
  // which rows EXIST — variantMatchesEnchantFilter (js/sorting.js) is the sole
  // picker updateTableDisplay reads — and a re-render is one unbroken
  // synchronous block: state.formatter over every row, then a whole
  // tbody.innerHTML replacement, seconds on a real price map. A native <select>
  // popup needs that same thread, so paying it for a Tier, Category or City pick
  // froze the picker the user was still holding open. See onFilterChange.
  const RERENDER_ON_FILTER = new Set([
    "crafting-table",
    "consumable-table",
    "craft-planner-table",
  ]);

  // Tables whose enchant variant rows are GENERATED on demand rather than
  // computed-then-hidden (js/flip-enchant-variants.js). updateTableDisplay only
  // replays the cached row set, which cannot contain a variant that has never
  // been built — so a tier/enchant pick has to re-run the renderer itself.
  const RERENDER_RENDERER_ON_FILTER = new Set(["flipping-table"]);

  // Last enchant value each of those tables rendered at. Every picker shares one
  // onFilterChange, so without this a Category or Tier pick would pay for a full
  // re-render it does not need — only a moved ENCHANT pick changes which variant
  // rows exist.
  const _lastEnchSel = {};
  function enchFilterMoved(tableId) {
    const el = document.getElementById(enchFilterId(tableId));
    const val = (el && el.value) || "";
    // `|| ""`: a table nobody has touched has no remembered value, and reading
    // undefined would report the first pick of "All" as a MOVE — one full
    // re-render per table per session, for a value that never changed.
    if ((_lastEnchSel[tableId] || "") === val) return false;
    _lastEnchSel[tableId] = val;
    return true;
  }

  /**
   * Recompute a re-pricing table when its City pick moved.
   *
   * These tables keep one sell city per row, so filtering alone could only ever
   * surface rows that already chose the pick (the Black Market case — see
   * js/table-sell-city.js, which owns the list). Their row builders read the
   * pick, so it needs a real recompute, not a DOM pass.
   *
   * Runs the table's own renderer (js/render-gating.js TABLE_RENDERERS) against
   * the current price map; the renderer ends in updateTableDisplay →
   * applyTableSearchFilter, so the rest of the pass is unchanged. Returns true
   * when it drew, so the caller can skip the cheap path it replaces.
   *
   * Reads the SELL picker: re-pricing moves where the row sells, which is what
   * js/table-sell-city.js models. The Buy City picker is a plain DOM filter.
   */
  function repriceOnCityChange(tableId) {
    if (typeof tableRepricesOnCityPick !== "function" || !tableRepricesOnCityPick(tableId)) return false;
    if (typeof sellCityFilterChanged !== "function") return false;
    // An object-filtered table (the Volume one) carries the COMBINED picker
    // `cityfilter-*`, not the split pair: reading the sell id there found no
    // element, so the detector read "" forever and no pick reached the renderer.
    const objectFiltered = OBJECT_FILTERED_TABLES.has(tableId);
    const sellEl = document.getElementById(
      objectFiltered ? cityFilterId(tableId) : sellCityFilterId(tableId),
    );
    const buyEl = objectFiltered ? null : document.getElementById(buyCityFilterId(tableId));
    // BOTH detectors run unconditionally — they double as "record what the
    // picker reads now", so short-circuiting on the first `true` would leave the
    // other side's remembered value stale and swallow its next change.
    const sellMoved = sellCityFilterChanged(tableId, (sellEl && sellEl.value) || "");
    const buyMoved =
      typeof buyCityFilterChanged === "function"
        ? buyCityFilterChanged(tableId, (buyEl && buyEl.value) || "")
        : false;
    if (!sellMoved && !buyMoved) return false;
    return requestTableRender(tableId);
  }

  /**
   * Redraw a table for a pick, WITHOUT freezing the window.
   *
   * runTableRenderer below calls the table's own renderer in one unbroken block
   * — 7.1 s for the Crafting Planner on a real price map — and the click that
   * asked for it is a `change` on a <select>, so the picker the user is holding
   * open is exactly what the freeze eats. The async pass (js/render-async.js)
   * draws the same table first, hands the thread back between slices and reports
   * progress in the pill, so ask for that whenever there is a scheduler to ask.
   *
   * The DOM-level filter still runs immediately: the pass is a repaint of the
   * numbers, and the rows on screen should follow the other pickers now rather
   * than a second later.
   *
   * Falls back to the direct call when scheduleRerender says no pass is coming
   * (before the first scan, and in the Node tests, where there is no scheduler).
   */
  function requestTableRender(tableId) {
    if (typeof scheduleRerender === "function"
        && scheduleRerender("city-pick", { priorityTableId: tableId })) {
      applyTableSearchFilter(tableId);
      return true;
    }
    return runTableRenderer(tableId);
  }

  /**
   * Re-run a table's own renderer (js/render-gating.js TABLE_RENDERERS) against
   * the current price map. Returns true when it drew.
   *
   * A top-level function declaration DOES land on window; a top-level `let`
   * does not (js/app.js declares lastMarketData that way), so the price map has
   * to be read as a bare identifier or it reads undefined and this silently
   * never re-renders. See project_global_lexical_scope_not_globalthis.
   */
  function runTableRenderer(tableId) {
    const w = typeof window !== "undefined" ? window : null;
    const fnName = (typeof TABLE_RENDERERS !== "undefined") ? TABLE_RENDERERS[tableId] : null;
    const render = fnName && w && typeof w[fnName] === "function" ? w[fnName] : null;
    const data = (typeof lastMarketData !== "undefined") ? lastMarketData : null;
    if (!render || !data) return false;
    try {
      render(data);
    } catch (e) {
      console.error(`[table-filters] re-render ${tableId}:`, e);
      return false;
    }
    return true;
  }

  // What a tier/enchant/city picker change should do for `tableId`: a moved City
  // pick re-prices (above); the collapse tables re-render their cached rows
  // (which re-applies the search filter at the end); everything else just
  // re-runs the DOM-level filter.
  function onFilterChange(tableId) {
    if (repriceOnCityChange(tableId)) {
      const repriceHooks = (typeof window !== "undefined" && window.tableFilterHooks) || null;
      const repriceHook = repriceHooks && repriceHooks[tableId];
      if (typeof repriceHook === "function") repriceHook();
      return;
    }
    // Read once and share it: the detector doubles as "record what the picker
    // reads now", so calling it in both branches would swallow the next move.
    const enchMoved = enchFilterMoved(tableId);
    if (RERENDER_RENDERER_ON_FILTER.has(tableId) && enchMoved
        && requestTableRender(tableId)) {
      // the renderer ends in updateTableDisplay -> applyTableSearchFilter
    } else if (RERENDER_ON_FILTER.has(tableId) && enchMoved
        && typeof updateTableDisplay === "function") {
      updateTableDisplay(tableId);
    } else {
      applyTableSearchFilter(tableId);
    }
    // Optional per-table hook — e.g. the craft planner lazy-fetches prices for
    // the enchant level just picked, then re-renders when they arrive.
    const hooks = (typeof window !== "undefined" && window.tableFilterHooks) || null;
    const hook = hooks && hooks[tableId];
    if (typeof hook === "function") hook();
  }

  function searchInputId(tableId) {
    // The volume table predates the generic search box and keeps its own input
    // id (#volume-search); every other table follows the search-<tableId> scheme.
    if (tableId === "volume-table") return "volume-search";
    return "search-" + tableId;
  }
  function tierFilterId(tableId) {
    return "tierfilter-" + tableId;
  }
  function enchFilterId(tableId) {
    return "enchfilter-" + tableId;
  }

  // Re-apply the active query for one table against its currently rendered rows.
  // Safe to call after every (re)render — no input or no tbody → no-op.
  function applyTableSearchFilter(tableId) {
    const input = document.getElementById(searchInputId(tableId));
    if (!input) return;
    const tbody = document.querySelector(`#${tableId} tbody`);
    if (!tbody) return;

    const q = (input.value || "").trim().toLowerCase();
    const terms = q ? q.split(/\s+/).filter(Boolean) : [];

    // Tier/enchant dropdown state (empty = "All"). Read live from the DOM so a
    // re-render re-applies the current picks with zero extra state to sync.
    const tierEl = document.getElementById(tierFilterId(tableId));
    const enchEl = document.getElementById(enchFilterId(tableId));
    const tierSel = (tierEl && tierEl.value) || "";
    const enchSel = (enchEl && enchEl.value) || "";
    const stationEl = document.getElementById(stationFilterId(tableId));
    const stationSel = (stationEl && stationEl.value) || "";
    const objectFiltered = OBJECT_FILTERED_TABLES.has(tableId);
    const catEl = objectFiltered ? null : document.getElementById(categoryFilterId(tableId));
    const subEl = objectFiltered ? null : document.getElementById(subcategoryFilterId(tableId));
    const buyCityEl = objectFiltered ? null : document.getElementById(buyCityFilterId(tableId));
    const sellCityEl = objectFiltered ? null : document.getElementById(sellCityFilterId(tableId));
    const catSel = (catEl && catEl.value) || "";
    const subSel = (subEl && subEl.value) || "";
    const buyCitySel = (buyCityEl && buyCityEl.value) || "";
    const sellCitySel = (sellCityEl && sellCityEl.value) || "";
    // A structural header defaults to visible only when NOTHING is filtering;
    // once any picker is active it must earn its visibility from a surviving
    // descendant, else it lingers over an emptied group.
    const filtering =
      terms.length > 0 || tierSel !== "" || enchSel !== "" || stationSel !== "" ||
      catSel !== "" || subSel !== "" || buyCitySel !== "" || sellCitySel !== "";

    const rows = Array.from(tbody.rows);

    // visible[i] === undefined marks a skip row we must not touch.
    const visible = new Array(rows.length);
    const kinds = rows.map(classifyRow);

    // Stack of open structural headers, innermost on top. A header resolves to
    // visible once any data row in its scope matches; closing a header bubbles
    // its visibility up to the enclosing header (so parents light up too).
    const stack = [];
    const closeTo = (level) => {
      while (stack.length && stack[stack.length - 1].level >= level) {
        const h = stack.pop();
        visible[h.idx] = h.hasVisible;
        if (h.hasVisible && stack.length) {
          stack[stack.length - 1].hasVisible = true;
        }
      }
    };

    const stationsPresent = new Set();
    const catPairsPresent = [];
    const buyCitiesPresent = new Set();
    const sellCitiesPresent = new Set();
    // How many DATA rows this pass actually saw. Zero means the tbody is empty
    // — a table that has never been scanned, or one whose rows were wiped when
    // it collapsed (js/app.js setCollapsed) — and an empty tbody is not
    // evidence that the table has no categories or cities. Pruning on it would
    // blank the seeded option lists and hide the pickers again, which is the
    // bug the seeding fixes.
    let dataRows = 0;
    // The data row a panel row belongs to — the one directly above it.
    let lastDataIdx = -1;
    rows.forEach((tr, i) => {
      const kind = kinds[i];
      if (kind.skip) return; // breed-detail-row etc. — untouched
      if (kind.follows) {
        // Inherit, never match: the panel's own text is not what is filtered on.
        // A panel with no data row above it (shouldn't happen) stays hidden.
        visible[i] = lastDataIdx >= 0 ? visible[lastDataIdx] : false;
        return;
      }
      if (kind.data) {
        lastDataIdx = i;
        dataRows++;
        if (stationEl) {
          const st = rowStation(tr);
          if (st) stationsPresent.add(st);
        }
        if (catEl || subEl) catPairsPresent.push(...rowCategoryPairs(tr));
        if (buyCityEl) rowCities(tr, "buy").forEach((c) => buyCitiesPresent.add(c));
        if (sellCityEl) rowCities(tr, "sell").forEach((c) => sellCitiesPresent.add(c));
        const m =
          rowMatches(tr, terms) &&
          rowPassesTierEnch(tr, tierSel, enchSel) &&
          rowPassesStation(tr, stationSel) &&
          rowPassesCategory(tr, catSel, subSel) &&
          rowPassesBuyCity(tr, buyCitySel, tableId) &&
          rowPassesSellCity(tr, sellCitySel, tableId);
        visible[i] = m;
        if (m && stack.length) stack[stack.length - 1].hasVisible = true;
        return;
      }
      // structural header — close any siblings/deeper headers first
      closeTo(kind.level);
      stack.push({ idx: i, level: kind.level, hasVisible: !filtering });
    });
    closeTo(-1); // flush remaining headers

    if (dataRows > 0) {
      if (stationEl) syncStationOptions(tableId, stationsPresent);
      if (catEl || subEl) syncCategoryOptions(tableId, catPairsPresent, catSel);
      if (buyCityEl) syncSideCityOptions(tableId, "buy", buyCitiesPresent);
      if (sellCityEl) syncSideCityOptions(tableId, "sell", sellCitiesPresent);
    }

    // Collapse-owned table with no typed query: the folds stay authoritative.
    // Idle, display is handed straight back. With a picker active, the applier
    // paints its folds on a clean slate and the picker's hides are ANDed on top,
    // so a Sell City pick narrows the table without unfolding minimized groups.
    const restore = terms.length === 0 ? collapseApplierFor(tableId) : null;
    if (restore) {
      if (filtering) {
        rows.forEach((tr, i) => {
          if (!kinds[i].skip) tr.style.display = "";
        });
      }
      restore();
      if (filtering) {
        rows.forEach((tr, i) => {
          if (!kinds[i].skip && !visible[i]) tr.style.display = "none";
        });
      }
      return;
    }

    rows.forEach((tr, i) => {
      if (kinds[i].skip) return;
      tr.style.display = visible[i] ? "" : "none";
    });
  }
  // Insert Tier + Enchant dropdowns immediately after `ref`, wiring `onChange`
  // to re-filter, and return the last element inserted so the caller can keep
  // chaining pickers in in-game order. Idempotent: skips if already injected.
  // `ref` lives inside the collapsible <h2>, so stop click/mousedown from
  // bubbling to its toggle.
  function injectTierEnchantControls(tableId, input, onChange, tierOnly) {
    if (!input || !input.parentNode) return input;
    if (document.getElementById(tierFilterId(tableId))) return input;
    const tierOpts = [];
    for (let ti = 1; ti <= 8; ti++) tierOpts.push({ value: String(ti), label: "T" + ti });
    const enchOpts = [];
    for (let e = 0; e <= 4; e++) enchOpts.push({ value: String(e), label: "." + e });
    const tierLabel = typeof t === "function" ? t("tier") : "Tier";
    const tierSel = buildFilterSelect(tierFilterId(tableId), tierLabel, tierOpts, "tier");
    const enchSel = buildFilterSelect(enchFilterId(tableId), tx("Ench.", "r_ench_filter"), enchOpts, "r_ench_filter");
    let ref = input;
    // `click` only — see wireSelect in js/table-filters.js for why a mousedown
    // listener must not sit on a <select> that has to open its own option list.
    (tierOnly ? [tierSel] : [tierSel, enchSel]).forEach((sel) => {
      sel.addEventListener("change", onChange);
      sel.addEventListener("click", (e) => e.stopPropagation());
      ref.parentNode.insertBefore(sel, ref.nextSibling);
      ref = sel;
    });
    return ref;
  }

  // Every picker for one table, laid out left-to-right in the order the in-game
  // Marketplace uses: Category ▸ Subcategory ▸ Tier ▸ Enchantment, then the two
  // this app adds (City, and Station on the Crafting table). Each injector
  // returns the element it inserted last so the next one lands after it; a
  // picker that has nothing to offer hides itself on the first filter pass.
  function injectFilterControls(tableId, input, onChange) {
    let ref = input;
    const marketRows = !NO_MARKET_ROW_TABLES.has(tableId);
    if (marketRows && !CATEGORY_EXCLUDE.has(tableId)) {
      ref = injectCategoryControls(tableId, ref, onChange);
    }
    if (!TIER_ENCHANT_EXCLUDE.has(tableId)) {
      ref = injectTierEnchantControls(tableId, ref, onChange, ENCHANT_EXCLUDE.has(tableId));
    }
    // The Volume table names ONE market per row — where the liquidity is — so it
    // keeps the combined pick. Every other table describes a buy→sell route, and
    // constraining one end of it used to drag the other in.
    if (OBJECT_FILTERED_TABLES.has(tableId)) {
      ref = injectCityControl(tableId, ref, onChange);
    } else if (marketRows && !NO_SIDE_CITY_TABLES.has(tableId)) {
      ref = injectBuyCityControl(tableId, ref, onChange);
      ref = injectSellCityControl(tableId, ref, onChange);
    }
    if (STATION_FILTER_TABLES.has(tableId)) {
      ref = injectStationControl(tableId, ref, onChange);
    }
    // Closes the picker row. Kept separate from the "Clear overrides" button that
    // follows it: one resets what you are LOOKING at, the other deletes data you
    // TYPED. They were easy to confuse while a single "↺ Clear" sat among the
    // pickers looking like a filter reset.
    if (typeof injectClearFiltersButton === "function") {
      ref = injectClearFiltersButton(tableId, input, ref, onChange);
    }
    return ref;
  }

  // Tables that price nothing, so there is no manual price/volume/city to clear:
  // reference tables (city + black-zone bonuses, zone lists, Brecilien fees) and
  // the Roads tables, which read captured portal data rather than the market. A
  // "Clear overrides" button there can only ever report "nothing to clear", so it
  // is not injected at all.
  const NO_OVERRIDE_TABLES = new Set([
    "city-bonuses-table",
    "black-zone-bonuses-table",
    "black-zone-locations-table",
    "brecilien-fees-table",
    "roads-zones-table",
    "roads-portals-table",
  ]);

  // The per-table "Clear overrides" button lives in js/table-overrides.js and is
  // published as a global there; look it up at setup time so script order only
  // has to get the <script> tags right, not their internals.
  function injectClearOverridesButton(tableId, input) {
    if (NO_OVERRIDE_TABLES.has(tableId)) return;
    const fn = typeof window !== "undefined" ? window.injectClearOverridesButton : null;
    if (typeof fn === "function") fn(tableId, input);
  }

  // The Enter-fetch lives in js/table-search-fetch.js and is published as a
  // global there; look it up at press time so script order can't matter.
  function fireSearchFetch(tableId) {
    const fn = typeof window !== "undefined" ? window.searchFetchForTable : null;
    if (typeof fn === "function") fn(tableId);
  }

  function setupTableSearch() {
    SEARCHABLE_TABLES.forEach((tableId) => {
      const input = document.getElementById(searchInputId(tableId));
      if (!input) return;
      input.addEventListener("input", () => {
        applyTableSearchFilter(tableId);
        scheduleSearchRevealRepaint(tableId);
      });
      // Enter → fetch prices for just the matched items (no full scan). No-op on
      // tables not backed by fetchable market data (see tableRenderers).
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          fireSearchFetch(tableId);
        }
      });
      // Belt-and-suspenders: the <h2> collapse handler already ignores clicks on
      // inputs, but stop the click here too so focusing the box can never toggle
      // the table closed underneath the user.
      input.addEventListener("click", (e) => e.stopPropagation());
      injectFilterControls(tableId, input, () => onFilterChange(tableId));
      injectClearOverridesButton(tableId, input);
    });

    // The volume table keeps its own object-level filter (#volume-search →
    // filterVolumeRows), so it isn't in SEARCHABLE_TABLES. Give it the same
    // tier/enchant pickers, wired to re-run its render path (which reads the
    // selects live in updateTableDisplay/filterVolumeRows).
    const volInput = document.getElementById("volume-search");
    if (volInput) {
      injectFilterControls("volume-table", volInput, () => {
        // A moved City pick REBUILDS the rows at that city (js/table-sell-city.js)
        // and cannot be served by re-filtering what is already on screen. Every
        // other picker still takes the cheap object-filter pass below.
        if (repriceOnCityChange("volume-table")) return;
        if (typeof updateTableDisplay === "function") updateTableDisplay("volume-table");
      });
      injectClearOverridesButton("volume-table", volInput);
      // Enter → fetch the matched catalog items (e.g. "hide" + T8 → T8_HIDE) so a
      // search finds rows the full scan never pulled, matching every other table.
      volInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          fireSearchFetch("volume-table");
        }
      });
    }
  }

  // Row-matching internals the Enter-fetch module reuses, so the two agree on
  // what "this row matches the query" means (see table-search-fetch.js).
  const internals = {
    RERENDER_ON_FILTER,
    onFilterChange,
    // My Crafting List builds the same picker row over its own grouped markup
    // (js/craft-list-filter.js) — it needs the injector, not just the predicates.
    injectFilterControls,
    rowStation,
    syncStationOptions,
    repriceOnCityChange,
    searchInputId,
    tierFilterId,
    enchFilterId,
    stationFilterId,
    STATION_FILTER_TABLES,
    classifyRow,
    rowMatches,
    searchRevealNeedsRepaint,
    scheduleSearchRevealRepaint,
    rowPassesTierEnch,
    rowPassesStation,
    rowPassesCategory,
    rowPassesBuyCity,
    rowPassesSellCity,
    categoryFilterId,
    subcategoryFilterId,
    buyCityFilterId,
    sellCityFilterId,
    idsFromRowKey,
    catalogNameFor,
    NO_MARKET_ROW_TABLES,
    NO_SIDE_CITY_TABLES,
  };

  if (typeof window !== "undefined") {
    window.applyTableSearchFilter = applyTableSearchFilter;
    window.setupTableSearch = setupTableSearch;
    window.tableSearchInternals = internals;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Object.assign({}, internals, {
      applyTableSearchFilter,
      searchRevealNeedsRepaint,
      scheduleSearchRevealRepaint,
      SEARCHABLE_TABLES,
      NO_OVERRIDE_TABLES,
      COLLAPSE_OWNED_TABLES,
      parseRowTierEnchant,
    });
  }
})();
