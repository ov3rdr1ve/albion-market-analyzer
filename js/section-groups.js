/**
 * Table group headers (css/table-groups.css).
 *
 * index.html wraps its 27 sections in <section class="tgroup"> blocks — Market,
 * Crafting, Upgrades, Production, Faction, Roads, Reference. This module makes
 * those group headers interactive:
 *
 *   • a count badge showing how many sections the group holds,
 *   • click / Enter / Space collapses the whole group,
 *   • the collapsed state persists per group in localStorage,
 *   • Collapse All / Expand All (js/app.js) fold and unfold every group.
 *
 * Group collapse is deliberately independent of the per-table collapse in
 * js/app.js: hiding a group does not touch each table's own collapsed flag or
 * its rendered rows, so reopening a group restores exactly what was there.
 *
 * A band holding a single section is unwrapped instead of drawn: its header
 * would only repeat that section's own <h2>, and folding it would duplicate
 * the table's own collapse. Such a group is marked `.solo`, its chrome hidden
 * by css/table-groups.css, and it is left out of group collapse entirely —
 * with no header there would be nothing to click to bring the body back.
 *
 * isFirstRun() lives here because this file loads before js/app.js: on a fresh
 * install every group AND every table starts collapsed, so the app opens as a
 * short index of what it can do instead of a wall of empty tables.
 */

const GROUP_COLLAPSE_KEY = "group-collapsed-";
const FIRST_RUN_KEY = "ui-defaults-applied";

/**
 * True the very first time the UI is built on this machine (nothing stored
 * yet). The answer is latched in a global so both callers — this module and
 * js/app.js's table wiring, which run in either order — see the same verdict
 * on that first load; the stored marker makes every later load return false.
 */
function isFirstRun() {
  if (typeof globalThis.__uiFirstRun === "boolean") return globalThis.__uiFirstRun;
  let first = false;
  try {
    first = !localStorage.getItem(FIRST_RUN_KEY);
    if (first) localStorage.setItem(FIRST_RUN_KEY, "1");
  } catch (e) {
    /* private mode / quota — treat as a returning user, nothing to restore */
  }
  globalThis.__uiFirstRun = first;
  return first;
}

function countGroupSections(group) {
  const body = group.querySelector(".tgroup-body");
  if (!body) return 0;
  // A section is either a plain <h2> heading or the gold chart's styled
  // .section-title <div> — which sits one level down, inside its own wrapper,
  // so it has to be matched as a descendant rather than a direct child.
  return (
    body.querySelectorAll(":scope > h2").length +
    body.querySelectorAll(".section-title").length
  );
}

function setGroupCollapsed(group, collapsed) {
  // A solo group has no header to click, so collapsing it would hide its table
  // with no way back — including from Collapse All.
  if (group.classList.contains("solo")) return;
  group.classList.toggle("collapsed", collapsed);
  const indicator = group.querySelector(".tgroup-indicator");
  if (indicator) indicator.textContent = collapsed ? "▶" : "▼";
  // Unfolding a band reveals several tables at once, and any of them may have
  // been skipped by the last redraw for being invisible (js/render-gating.js).
  if (!collapsed && typeof renderDeferredTablesIn === "function") {
    renderDeferredTablesIn(group, {
      data: typeof lastMarketData !== "undefined" ? lastMarketData : null,
      qualityData: typeof lastQualityMarketData !== "undefined" ? lastQualityMarketData : null,
    });
  }
  // Static panels (My Crafting List, the Fees Calculator) are not in the gating
  // registry, but they go just as stale behind a folded band — the craft list in
  // particular skips refreshing its source tables while it is invisible, so
  // unfolding must replay it. Deduped by function reference: the list panel puts
  // the SAME renderer on two tables (js/render-craft-list.js).
  if (!collapsed) {
    const seen = new Set();
    group.querySelectorAll("table.data-table").forEach((table) => {
      const render = table._staticRenderer;
      if (typeof render !== "function" || seen.has(render)) return;
      if (typeof isTableHidden === "function" && isTableHidden(table.id)) return;
      seen.add(render);
      try { render(); } catch (e) { console.error(`${table.id} static render:`, e); }
    });
  }
  const key = GROUP_COLLAPSE_KEY + group.dataset.group;
  try {
    if (collapsed) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch (e) {
    /* private mode / quota — collapsing still works, just not remembered */
  }
}

function setupSectionGroups() {
  document.querySelectorAll(".tgroup").forEach((group) => {
    const head = group.querySelector(".tgroup-head");
    if (!head) return;

    const count = countGroupSections(group);
    // One section is not a group. Unwrap it: no header, no badge, no collapse
    // handlers, and never a stored collapsed flag to restore.
    if (count <= 1) {
      group.classList.add("solo");
      group.classList.remove("collapsed");
      // The heading is dressed as the band, which clips its intro to one line.
      // Read the text on hover rather than storing it: the language switch
      // rewrites the heading, and a title copied now would keep the old words.
      const intro = group.querySelector("h2 small");
      if (intro && typeof intro.addEventListener === "function") {
        intro.addEventListener("pointerenter", () => {
          intro.title = (intro.textContent || "").trim();
        });
      }
      return;
    }
    if (count) {
      const badge = document.createElement("span");
      badge.className = "tgroup-count";
      badge.textContent = count;
      const indicator = head.querySelector(".tgroup-indicator");
      head.insertBefore(badge, indicator || null);
    }

    head.setAttribute("role", "button");
    head.setAttribute("tabindex", "0");

    let collapsed = isFirstRun();
    try {
      collapsed =
        collapsed ||
        localStorage.getItem(GROUP_COLLAPSE_KEY + group.dataset.group) === "1";
    } catch (e) {
      /* ignore */
    }
    // On a first run this also writes the flag, so the collapsed start is what
    // gets restored on the next load rather than a one-off.
    setGroupCollapsed(group, collapsed);

    const toggle = () => setGroupCollapsed(group, !group.classList.contains("collapsed"));

    head.addEventListener("click", (e) => {
      // Same guard as the per-table headings: never swallow a click meant for
      // a control someone parks in the header later.
      if (e.target.closest("button, input, select, textarea, label")) return;
      toggle();
    });
    head.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      toggle();
    });
  });
}

/** Open every group — used by app.js's "Expand All". */
function expandAllSectionGroups() {
  document
    .querySelectorAll(".tgroup")
    .forEach((group) => setGroupCollapsed(group, false));
}

/** Fold every group — used by app.js's "Collapse All". */
function collapseAllSectionGroups() {
  document
    .querySelectorAll(".tgroup")
    .forEach((group) => setGroupCollapsed(group, true));
}

// Guarded so the module can be required from the Node tests, where there is no
// document to wire until the fake DOM is installed.
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupSectionGroups);
  } else {
    setupSectionGroups();
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    setupSectionGroups,
    countGroupSections,
    setGroupCollapsed,
    expandAllSectionGroups,
    collapseAllSectionGroups,
    isFirstRun,
  };
}
