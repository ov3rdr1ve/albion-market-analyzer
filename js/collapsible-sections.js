/**
 * Collapsible sections: every <h2> folds its own table (or, for a table-less
 * tool like the FP calculator, its own block), plus Collapse / Expand All.
 *
 * Split out of js/app.js (800-line limit). Plain globals, loaded before it.
 */

const tableCollapsers = [];

function setupCollapsibleTables() {
  const addIndicator = (h2) => {
    const indicator = document.createElement("span");
    indicator.style.cssText =
      "font-size:0.75em;color:#9ca3af;margin-left:8px;font-weight:400";
    h2.appendChild(indicator);
    h2.style.cursor = "pointer";
    h2.style.userSelect = "none";
    return indicator;
  };
  // Fresh install: start every section collapsed (isFirstRun, js/section-groups.js)
  // so the page opens as an index of sections rather than a wall of empty
  // tables. setCollapsed persists the flag, so it survives the next load.
  const startCollapsed = (key) =>
    (typeof isFirstRun === "function" && isFirstRun())
    || localStorage.getItem(`table-collapsed-${key}`) === "1";
  const onToggle = (h2, isCollapsed, setCollapsed) => {
    h2.addEventListener("click", (e) => {
      // Ignore clicks that land on an interactive control living in the header
      // (Refresh/Scan buttons, the volume search box, the faction <select> and
      // its wrapping <label>). Without this, focusing the search input or
      // opening the faction dropdown bubbles up and toggles the collapse,
      // minimizing the table out from under the user.
      if (e.target.closest("button, input, select, textarea, label")) return;
      setCollapsed(!isCollapsed());
    });
  };

  // A heading whose content holds no data table of its own (the Faction Point
  // Calculator) collapses its OWN block — every sibling up to the next <h2> —
  // under its own key: the block's data-collapse-key, else its id. A block
  // with neither stays put rather than borrowing another section's table.
  const setupBlock = (h2, block) => {
    const keyed = block.find((el) => el.dataset?.collapseKey || el.id);
    if (!keyed) return;
    const key = keyed.dataset?.collapseKey || keyed.id;
    const parts = block.map((el) => ({ el, display: el.style.display }));
    const indicator = addIndicator(h2);
    let collapsed = false;
    const setCollapsed = (on) => {
      collapsed = on;
      parts.forEach(({ el, display }) => { el.style.display = on ? "none" : display; });
      indicator.textContent = on ? " ▶" : " ▼";
      if (on) localStorage.setItem(`table-collapsed-${key}`, "1");
      else localStorage.removeItem(`table-collapsed-${key}`);
    };
    tableCollapsers.push(setCollapsed);
    setCollapsed(startCollapsed(key));
    onToggle(h2, () => collapsed, setCollapsed);
  };

  document.querySelectorAll("h2").forEach((h2) => {
    // Walk this heading's OWN siblings (never past the next <h2>) looking for
    // a <table> or a wrapper div that contains one. A data-collapse-key block
    // is a self-contained tool: whatever tables it renders inside are its own
    // layout, not a data table to bind to.
    let sibling = h2.nextElementSibling;
    let tableEl = null;
    const between = [];
    while (sibling && sibling.tagName !== "H2") {
      if (sibling.dataset?.collapseKey) break;
      if (sibling.tagName === "TABLE") { tableEl = sibling; break; }
      const inner = sibling.querySelector?.("table");
      if (inner) { tableEl = inner; break; }
      between.push(sibling);
      sibling = sibling.nextElementSibling;
    }
    if (!tableEl) {
      const block = [];
      for (let el = h2.nextElementSibling; el && el.tagName !== "H2"; el = el.nextElementSibling) {
        block.push(el);
      }
      setupBlock(h2, block);
      return;
    }
    // Toggle visibility on the wrapper if there is one (so the empty box
    // doesn't remain), otherwise on the table itself.
    const collapseTarget = sibling.tagName === "TABLE" ? tableEl : sibling;
    // Controls parked between the heading and its table (the Roads route and
    // add-portal forms) belong to the section, so they hide with it — otherwise
    // a collapsed section leaves stray inputs floating under the heading. The
    // walk never crosses another <h2>, so everything here is ours.
    // Remember each element's own inline display so re-expanding restores it
    // (these carry `display:flex` in the style attribute; clearing it would
    // fall back to whatever the stylesheet says).
    const extras = between.map((el) => ({ el, display: el.style.display }));

    const tableId = tableEl.id;
    const indicator = addIndicator(h2);

    const setCollapsed = (collapsed) => {
      collapseTarget.style.display = collapsed ? "none" : "";
      extras.forEach(({ el, display }) => {
        el.style.display = collapsed ? "none" : display;
      });
      indicator.textContent = collapsed ? " ▶" : " ▼";
      if (collapsed) {
        localStorage.setItem(`table-collapsed-${tableId}`, "1");
        // Free DOM nodes to reduce memory
        const tbody = tableEl.querySelector("tbody");
        if (tbody) tbody.innerHTML = "";
      } else {
        localStorage.removeItem(`table-collapsed-${tableId}`);
        // Skipped by the last renderAllTables because it was hidden: its cache
        // is older than the prices in hand, so recompute rather than replay it.
        if (typeof renderDeferredTable === "function"
            && renderDeferredTable(tableId, { data: lastMarketData, qualityData: lastQualityMarketData })) {
          return;
        }
        // Re-render from cached data
        if (tableState[tableId] && tableState[tableId].data && tableState[tableId].data.length > 0) {
          updateTableDisplay(tableId);
        } else if (typeof tableEl._staticRenderer === "function") {
          // Static reference tables (no tableState entry) register their
          // renderer on the table element; replay it so the tbody we wiped
          // when collapsing comes back.
          try { tableEl._staticRenderer(); } catch (e) { console.error("staticRenderer:", e); }
        }
      }
    };

    tableCollapsers.push(setCollapsed);
    setCollapsed(startCollapsed(tableId));
    onToggle(h2, () => collapseTarget.style.display === "none", setCollapsed);
  });
}

function collapseAll() {
  // Capture rolling subgroup keys BEFORE collapsing outer tables — fn(true)
  // wipes each table's tbody to free DOM, after which the query below finds
  // nothing and the subtables would re-render expanded next time.
  document
    .querySelectorAll("#rolling-table tbody tr[data-header-cat]")
    .forEach((row) => {
      rollingCatCollapsed.add(row.dataset.headerCat);
    });
  document
    .querySelectorAll("#rolling-table tbody tr[data-header-roll]")
    .forEach((row) => {
      rollingRollCollapsed.add(
        `${row.dataset.rollCat}:${row.dataset.headerRoll}`,
      );
    });
  saveRollingCollapsed();
  refreshRollingRowDisplay();
  tableCollapsers.forEach((fn) => fn(true));
  // Fold the group bands too, so "Collapse All" leaves the page as the short
  // index of sections it is meant to be (js/section-groups.js).
  if (typeof collapseAllSectionGroups === "function") collapseAllSectionGroups();
}

function expandAll() {
  // Expanding every table is a lie if the band it sits in is still folded, so
  // open the groups too (js/section-groups.js).
  if (typeof expandAllSectionGroups === "function") expandAllSectionGroups();
  tableCollapsers.forEach((fn) => fn(false));
  rollingCatCollapsed.clear();
  rollingRollCollapsed.clear();
  saveRollingCollapsed();
  refreshRollingRowDisplay();
}
