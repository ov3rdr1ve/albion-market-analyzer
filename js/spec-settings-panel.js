/**
 * ⚙ Specs panel — per-table Destiny Board specialization levels.
 *
 * Each focus-using table carries a `<button class="spec-settings-btn"
 * data-spec-scope="…">` in its <h2>. Clicking it opens this popover, listing the
 * Destiny Board nodes that table's items are covered by (js/focus-spec-nodes.js),
 * grouped by branch and collapsed. A node the user has not typed shows its
 * default — 100 for a mastery, 0 for a specialization (js/focus-spec.js
 * defaultSpecLevel) — and "All 100 (max spec)" is one click for a maxed
 * character.
 *
 * Levels are stored per scope (per table) — see js/focus-spec.js — so the
 * Crafting table can model a maxed crafter while Refining / Transports models a
 * half-levelled refiner.
 *
 * The popover is appended to <body>, NOT inside the <h2>: the collapsible-table
 * click handler in app.js only exempts controls it knows about, and a panel
 * living inside the heading would collapse the table on every click.
 */

// Which node branches each table's ⚙ shows. Static rather than derived from the
// rendered rows: a table's node set doesn't change with the filter, and the
// panel must open before any scan has happened.
const TABLE_SPEC_BRANCHES = {
  "crafting-table": ["gear", "tool", "cape"],
  "craft-planner-table": ["refine", "gear", "tool", "cape"],
  "transport-table": ["refine"],
  "consumable-table": ["cook", "alchemy"],
  "mounts-table": ["breeding"],
  "faction-spending-table": ["breeding"],
  "farming-table": ["farming", "breeding"],
};

const SPEC_BRANCH_LABELS = {
  refine: "Refining",
  gear: "Weapons & Armor",
  tool: "Tools & Gathering Gear",
  cape: "Capes & Bags",
  cook: "Cooking",
  alchemy: "Alchemy",
  breeding: "Breeding",
  farming: "Farming",
};

let _specPanel = null;
let _specPanelScope = null;

// Node names come from the game's localization dump ("Adept's Smelter", …) and
// land in both text and attribute positions, so they're escaped on the way in.
function escapeSpecHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function specNodeName(nodeId) {
  const node = typeof FOCUS_SPEC_NODES !== "undefined" ? FOCUS_SPEC_NODES[nodeId] : null;
  if (!node) return nodeId;
  const spanish = typeof getLang === "function" && getLang() === "es";
  return (spanish && node.nameEs) || node.name;
}

function specGroupName(groupId) {
  const group = typeof FOCUS_SPEC_GROUPS !== "undefined" ? FOCUS_SPEC_GROUPS[groupId] : null;
  if (!group) return groupId;
  const spanish = typeof getLang === "function" && getLang() === "es";
  return (spanish && group.nameEs) || group.name;
}

/**
 * The scope's nodes bundled into their specialization groups — the five tiers of
 * one refining resource, or a mastery node with its specialists — in branch
 * order, each group's rows in board order (refining tier / mastery first).
 */
function specGroupsForScope(scope) {
  if (typeof FOCUS_SPEC_NODES === "undefined") return [];
  const branches = TABLE_SPEC_BRANCHES[scope] || Object.keys(SPEC_BRANCH_LABELS);
  const byGroup = {};
  Object.keys(FOCUS_SPEC_NODES).forEach((nodeId) => {
    const node = FOCUS_SPEC_NODES[nodeId];
    if (branches.indexOf(node.branch) === -1) return;
    const groupId = node.group || nodeId;
    (byGroup[groupId] = byGroup[groupId] || { id: groupId, branch: node.branch, nodes: [] })
      .nodes.push(nodeId);
  });

  return Object.keys(byGroup)
    .map((groupId) => {
      const group = byGroup[groupId];
      group.nodes.sort((a, b) => {
        // The mastery node heads its own group (its specialists all share
        // order 0); refining tiers then sort T4→T8, everything else by name.
        if (a === group.id) return -1;
        if (b === group.id) return 1;
        const orderA = FOCUS_SPEC_NODES[a].order || 0;
        const orderB = FOCUS_SPEC_NODES[b].order || 0;
        if (orderA !== orderB) return orderA - orderB;
        return specNodeName(a) < specNodeName(b) ? -1 : 1;
      });
      return group;
    })
    .sort((a, b) => {
      if (a.branch !== b.branch) return branches.indexOf(a.branch) - branches.indexOf(b.branch);
      return specGroupName(a.id) < specGroupName(b.id) ? -1 : 1;
    });
}

/** Every node this scope's ⚙ lists, mastery and specialization alike. */
function specNodeIdsForScope(scope) {
  return specGroupsForScope(scope).reduce((ids, group) => ids.concat(group.nodes), []);
}

// ── rendering ──────────────────────────────────────────────────────────────

function buildSpecPanel() {
  const panel = document.createElement("div");
  panel.className = "spec-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="spec-panel-head">
      <strong class="spec-panel-title">${tx("Specialization", "specialization")}</strong>
      <span class="spec-panel-sub"></span>
      <button type="button" class="spec-panel-close" title="${tx("Close", "r_close")}">&times;</button>
    </div>
    <div class="spec-panel-tools">
      <input type="search" class="spec-panel-filter" placeholder="${tx("Filter nodes… e.g. sword", "r_filter_nodes")}" autocomplete="off" />
      <label class="spec-panel-setall">${tx("Set all", "r_set_all")}
        <input type="number" class="spec-panel-setall-input" min="0" max="100" step="5" placeholder="0-100" />
      </label>
      <button type="button" class="spec-panel-max" title="${tx("Sets every node to 100 — the whole branch maxed.", "r_all_max_tip")}">${tx("All 100 (max spec)", "r_all_max")}</button>
      <button type="button" class="spec-panel-reset" title="${tx("Back to the defaults: masteries 100, every specialization 0 — the starting point for typing in only the levels you actually have.", "r_reset_defaults_tip")}">${tx("Reset", "r_reset_defaults")}</button>
    </div>
    <div class="spec-panel-body"></div>
    <div class="spec-panel-foot">
      ${tx("A node you have not typed counts as 0 — 100 only for the mastery heading each group. Lower levels cost more focus: cost = base × 0.5 ^ (Σ bonus × 100 × level ÷ 10,000).", "r_spec_foot")}
    </div>`;
  document.body.appendChild(panel);

  panel.querySelector(".spec-panel-close").addEventListener("click", closeSpecPanel);
  panel.querySelector(".spec-panel-filter").addEventListener("input", (e) => {
    filterSpecPanel(panel, e.target.value);
  });
  panel.querySelector(".spec-panel-reset").addEventListener("click", () => {
    resetSpecLevels(_specPanelScope);
    refreshSpecPanelValues(panel, _specPanelScope);
    applySpecChange();
  });
  panel.querySelector(".spec-panel-max").addEventListener("click", () => {
    setAllSpecLevels(_specPanelScope, SPEC_LEVEL_MAX, TABLE_SPEC_BRANCHES[_specPanelScope]);
    refreshSpecPanelValues(panel, _specPanelScope);
    applySpecChange();
  });
  panel.querySelector(".spec-panel-setall-input").addEventListener("change", (e) => {
    const value = e.target.value;
    if (value === "") return;
    setAllSpecLevels(_specPanelScope, value, TABLE_SPEC_BRANCHES[_specPanelScope]);
    e.target.value = "";
    refreshSpecPanelValues(panel, _specPanelScope);
    applySpecChange();
  });

  // Two delegated listeners instead of ~600 — the rows are rebuilt on every open.
  panel.querySelector(".spec-panel-body").addEventListener("change", (e) => {
    const groupInput = e.target.closest("input.spec-group-setall");
    if (groupInput) {
      const value = groupInput.value;
      if (value === "") return;
      const section = groupInput.closest(".spec-group");
      const nodeIds = [...section.querySelectorAll("input.spec-node-level")]
        .map((input) => input.dataset.node);
      setSpecLevelsFor(_specPanelScope, nodeIds, value);
      groupInput.value = "";
      refreshSpecPanelValues(panel, _specPanelScope);
      applySpecChange();
      return;
    }
    const input = e.target.closest("input.spec-node-level");
    if (!input) return;
    setSpecLevel(_specPanelScope, input.dataset.node, input.value);
    input.value = getSpecLevel(_specPanelScope, input.dataset.node);
    input.closest(".spec-node-row").classList.toggle(
      "is-custom", Number(input.value) !== defaultSpecLevel(input.dataset.node));
    updateSpecPanelSummary(panel, _specPanelScope);
    applySpecChange();
  });
  panel.querySelector(".spec-panel-body").addEventListener("click", (e) => {
    const toggle = e.target.closest(".spec-group-toggle");
    if (toggle) toggle.closest(".spec-group").classList.toggle("is-open");
  });

  return panel;
}

function renderSpecPanelRows(panel, scope) {
  const body = panel.querySelector(".spec-panel-body");
  // The node catalogue is injected after first paint (js/catalog-loader.js), and
  // the ⚙ buttons are live before it lands: an empty list under "nothing typed"
  // read as a scope with no nodes. Say it is loading, and fill the panel in if
  // it is still open when the catalogue arrives.
  if (typeof FOCUS_SPEC_NODES === "undefined") {
    const text = typeof catalogLoadingText === "function" ? catalogLoadingText() : "Loading catalogs…";
    body.innerHTML = `<div class="spec-panel-loading" style="color:#9ca3af;padding:8px">${text}</div>`;
    panel.querySelector(".spec-panel-sub").textContent = "";
    if (!panel._awaitingCatalogs && typeof whenCatalogsReady === "function") {
      panel._awaitingCatalogs = true;
      whenCatalogsReady(() => {
        panel._awaitingCatalogs = false;
        if (!panel.hidden && _specPanelScope) renderSpecPanelRows(panel, _specPanelScope);
      }, { present: () => typeof FOCUS_SPEC_NODES !== "undefined" });
    }
    return;
  }
  const groups = specGroupsForScope(scope);
  let lastBranch = null;

  body.innerHTML = groups
    .map((group) => {
      const rows = group.nodes
        .map((nodeId) => {
          const level = getSpecLevel(scope, nodeId);
          const name = escapeSpecHtml(specNodeName(nodeId));
          return `<label class="spec-node-row${level !== defaultSpecLevel(nodeId) ? " is-custom" : ""}" data-name="${
            name.toLowerCase()
          }">
            <span class="spec-node-name">${name}</span>
            <input type="number" class="spec-node-level" data-node="${nodeId}"
                   min="0" max="100" step="5" value="${level}" />
          </label>`;
        })
        .join("");

      // A branch caption only when the scope spans several (Crafting lists
      // weapons/armor, tools and capes; Refining is one branch, no caption).
      const caption = group.branch !== lastBranch && groups.some((g) => g.branch !== group.branch)
        ? `<div class="spec-branch-caption">${escapeSpecHtml(
            SPEC_BRANCH_LABELS[group.branch] || group.branch
          )}</div>`
        : "";
      lastBranch = group.branch;

      // A lone group opens expanded; otherwise the panel opens as a short index.
      const open = groups.length === 1 ? " is-open" : "";
      const groupName = escapeSpecHtml(specGroupName(group.id));
      return `${caption}<section class="spec-group${open}" data-group="${group.id}" data-name="${
        groupName.toLowerCase()
      }">
          <div class="spec-group-head">
            <button type="button" class="spec-group-toggle">
              <span class="spec-group-name">${groupName}</span>
              <span class="spec-group-count">${group.nodes.length}</span>
            </button>
            <input type="number" class="spec-group-setall" data-group="${group.id}"
                   min="0" max="100" step="5" placeholder="all"
                   title="Set every node in this specialization to one level" />
          </div>
          <div class="spec-group-rows">${rows}</div>
        </section>`;
    })
    .join("");

  updateSpecPanelSummary(panel, scope);
}

// The scrolling body loses width to its scrollbar, so a row's level box stops
// short of the toolbar's right edge. Its width is browser/OS specific, so it's
// measured here and fed back to the CSS as --spec-gutter, which pads the head,
// tools and foot by the same amount. `scrollbar-gutter: stable` keeps the value
// correct once measured, however short the filtered list gets.
function measureSpecPanelGutter(panel) {
  const body = panel.querySelector(".spec-panel-body");
  const gutter = body.offsetWidth - body.clientWidth;
  panel.style.setProperty("--spec-gutter", `${gutter > 0 ? gutter : 0}px`);
}

// Re-read the stored levels into the existing rows. Cheaper than rebuilding the
// markup, and it keeps the open groups and the filter box as the user left them.
function refreshSpecPanelValues(panel, scope) {
  panel.querySelectorAll("input.spec-node-level").forEach((input) => {
    const level = getSpecLevel(scope, input.dataset.node);
    input.value = level;
    input.closest(".spec-node-row").classList.toggle(
      "is-custom", level !== defaultSpecLevel(input.dataset.node));
  });
  updateSpecPanelSummary(panel, scope);
}

// The header line. It always states how many nodes are STILL on their default,
// because that is the assumption a partially-specced player cannot otherwise
// see: type two cooking levels and the other eight are counted at whatever the
// default says, with nothing on screen to say so.
function updateSpecPanelSummary(panel, scope) {
  const scopeNodes = specNodeIdsForScope(scope);
  const custom = Object.keys(getSpecLevels(scope)).filter(
    (nodeId) => scopeNodes.indexOf(nodeId) !== -1
  ).length;
  const atDefault = Math.max(0, scopeNodes.length - custom);
  panel.querySelector(".spec-panel-sub").textContent = custom
    ? tx("{set} set · {max} at default", "r_spec_nodes_set")
        .replace("{set}", custom).replace("{max}", atDefault)
    : tx("nothing typed — masteries 100, specializations 0", "r_spec_all_max");
}

// Matching a GROUP name ("fiber refining") keeps all of its nodes, so a user can
// pull up a whole specialization; otherwise rows match on their own name.
function filterSpecPanel(panel, query) {
  const needle = String(query || "").trim().toLowerCase();
  panel.querySelectorAll(".spec-group").forEach((group) => {
    const groupHit = !!needle && group.dataset.name.indexOf(needle) !== -1;
    let visible = 0;
    group.querySelectorAll(".spec-node-row").forEach((row) => {
      const hit = !needle || groupHit || row.dataset.name.indexOf(needle) !== -1;
      row.hidden = !hit;
      if (hit) visible++;
    });
    group.hidden = visible === 0;
    if (needle) group.classList.add("is-open");
  });
  // Hide a branch caption whose whole run of groups filtered out.
  panel.querySelectorAll(".spec-branch-caption").forEach((caption) => {
    let next = caption.nextElementSibling;
    let anyVisible = false;
    while (next && next.classList.contains("spec-group")) {
      if (!next.hidden) anyVisible = true;
      next = next.nextElementSibling;
    }
    caption.hidden = !anyVisible;
  });
}

// ── open / close / apply ───────────────────────────────────────────────────

function openSpecPanel(button) {
  const scope = button.dataset.specScope;
  if (!_specPanel) _specPanel = buildSpecPanel();
  if (!_specPanel.hidden && _specPanelScope === scope) return closeSpecPanel();

  _specPanelScope = scope;
  _specPanel.querySelector(".spec-panel-title").textContent =
    (typeof t === "function" ? t("specialization") : "Specialization");
  _specPanel.querySelector(".spec-panel-filter").value = "";
  renderSpecPanelRows(_specPanel, scope);
  _specPanel.hidden = false;
  measureSpecPanelGutter(_specPanel); // only measurable once the panel is shown

  const rect = button.getBoundingClientRect();
  const top = window.scrollY + rect.bottom + 6;
  const left = Math.max(
    8,
    Math.min(window.scrollX + rect.left, window.scrollX + window.innerWidth - 360)
  );
  _specPanel.style.top = `${top}px`;
  _specPanel.style.left = `${left}px`;
}

function closeSpecPanel() {
  if (_specPanel) _specPanel.hidden = true;
}

// Re-price every table: scopes are independent, but a single render pass is
// simpler (and fast enough) than teaching each renderer to run alone. Through
// the scheduler (js/render-async.js), so dragging a level slider does not lock
// the window up on every step.
function applySpecChange() {
  if (typeof updateSpecHeadings === "function") updateSpecHeadings();
  if (typeof scheduleRerender === "function") {
    scheduleRerender("spec-change");
    return;
  }
  if (typeof lastMarketData !== "undefined" && lastMarketData &&
      typeof renderAllTables === "function") {
    renderAllTables(lastMarketData);
  }
}

/**
 * Apply one level to every scoped table at once — the header "All Specs" box.
 *
 * "reset" is the undo for this control: it replays the levels recorded from the
 * ⚙ panels (js/focus-spec.js, specLevelsMine). It never wipes a hand-typed
 * level — a profile that only ever used the ⚙ panels gets its levels back
 * untouched — and it is repeatable, since the record is not consumed.
 *
 * The apply itself writes with recording off: it is the thing Reset undoes, so
 * a global 0/100 must not be mistaken for a level the user typed.
 */
function setAllTablesSpecLevels(level) {
  if (level === "reset") {
    if (typeof restoreMySpecLevels === "function") restoreMySpecLevels();
  } else {
    const apply = () => Object.keys(TABLE_SPEC_BRANCHES).forEach((scope) => {
      // Branch-filtered so each scope's stored map stays as sparse as the panel
      // would write it; the seven scopes' branches cover every node anyway.
      setAllSpecLevels(scope, level, TABLE_SPEC_BRANCHES[scope]);
    });
    if (typeof withoutSpecRecording === "function") withoutSpecRecording(apply);
    else apply();
  }
  if (_specPanel && !_specPanel.hidden && _specPanelScope) {
    refreshSpecPanelValues(_specPanel, _specPanelScope);
  }
  applySpecChange();
}

// Which renderer belongs to which scope. Bound ONCE at startup (below) instead
// of at each call site: these renderers are invoked from three places — the full
// renderAllTables pass, the per-table "Scan X" buttons (js/scan-handlers.js) and
// the search-box Enter fetch (js/table-search-fetch.js) — and all three must see
// the same specialization levels.
const SPEC_SCOPED_RENDERERS = {
  renderCraftingTable: "crafting-table",
  renderCraftPlannerTable: "craft-planner-table",
  renderTransportTable: "transport-table",
  renderConsumableTable: "consumable-table",
  renderMountsTable: "mounts-table",
  renderFactionSpendingTable: "faction-spending-table",
  renderFarmingTable: "farming-table",
};

function installSpecScopedRenderers() {
  if (typeof withSpecScope !== "function") return;
  Object.keys(SPEC_SCOPED_RENDERERS).forEach((name) => {
    const original = globalThis[name];
    if (typeof original !== "function" || original.__specScoped) return;
    const scope = SPEC_SCOPED_RENDERERS[name];
    const wrapped = function (...args) {
      return withSpecScope(scope, () => original.apply(this, args));
    };
    wrapped.__specScoped = true;
    globalThis[name] = wrapped;
  });
}

function setupSpecSettingsButtons() {
  installSpecScopedRenderers();
  document.querySelectorAll(".spec-settings-btn").forEach((button) => {
    button.addEventListener("click", (e) => {
      e.stopPropagation(); // never bubble into the h2 collapse handler
      openSpecPanel(button);
    });
  });
  document.addEventListener("click", (e) => {
    if (!_specPanel || _specPanel.hidden) return;
    if (e.target.closest(".spec-panel") || e.target.closest(".spec-settings-btn")) return;
    closeSpecPanel();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSpecPanel();
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupSpecSettingsButtons);
  } else {
    setupSpecSettingsButtons();
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TABLE_SPEC_BRANCHES, SPEC_BRANCH_LABELS, SPEC_SCOPED_RENDERERS,
    specGroupsForScope, specNodeIdsForScope, setAllTablesSpecLevels,
  };
}
