/**
 * The render pipeline: render order, the full and chunked table passes, the
 * rerender scheduler, and the spec-scoped headings.
 *
 * Split out of js/app.js (800-line limit). Plain globals, loaded before it.
 */

// Per-table cost of the last renderAllTables pass, in ms. Read by the boot log.
let renderPassCost = {};

/**
 * Time one table's renderer and record what it cost. A renderer that throws is
 * reported and skipped — one broken table has never been a reason to leave the
 * rest of the page empty.
 */
function timedRender(tableId, name, render) {
  const t = typeof performance !== "undefined" ? performance.now() : 0;
  try { render(); } catch (e) { console.error(`${name}:`, e); }
  if (typeof performance !== "undefined") {
    renderPassCost[tableId] = Math.round(performance.now() - t);
  }
}

// The draw order. Boards and the craft list are not here: they read the caches
// these fill, so they always come after (see RENDER_TAIL below).
//
// NOTE: tables with a ⚙ Specs panel don't need wrapping — their render
// functions are bound to their specialization scope once at startup by
// installSpecScopedRenderers() (js/spec-settings-panel.js), so the per-table
// scan buttons and the search-box fetches get the same levels this pass does.
const RENDER_ORDER = [
  "rolling-table",
  "crafting-table",
  "craft-planner-table",
  "flipping-table",
  "skins-trading-table",
  "transport-table",
  "consumable-table",
  "mounts-table",
  "faction-spending-table",
  "farming-table",
  "gathering-table",
  "journal-filling-table",
  "laborers-table",
  "buildings-table",
  "volume-table",
  "enchanting-table",
  "transmute-table",
  "rerolling-table",
];

/**
 * tableId → the call that draws it, against this pass's price map. One list, two
 * callers: the synchronous pass below and the chunked boot pass, which must draw
 * exactly the same tables the same way (js/render-schedule.js).
 */
function renderCalls(data) {
  return {
    "rolling-table": () => renderRollingTable(data),
    "crafting-table": () => renderCraftingTable(data),
    "craft-planner-table": () => renderCraftPlannerTable(data),
    "flipping-table": () => renderFlippingTable(data),
    "skins-trading-table": () => renderSkinsTradingTable(data),
    "transport-table": () => renderTransportTable(data),
    "consumable-table": () => renderConsumableTable(data),
    "mounts-table": () => renderMountsTable(data),
    "faction-spending-table": () => renderFactionSpendingTable(data),
    "farming-table": () => renderFarmingTable(data),
    "gathering-table": () => renderGatheringTable(data),
    "journal-filling-table": () => renderJournalFillingTable(data),
    "laborers-table": () => renderLaborersTable(data),
    "buildings-table": () => renderBuildingsTable(data),
    "volume-table": () => renderVolumeTable(data),
    "enchanting-table": () => renderEnchantingTable(data),
    "transmute-table": () => renderTransmuteTable(data),
    "rerolling-table": () => renderRerollingTable(lastQualityMarketData),
    "joined-summary-table": () => renderJoinedSummaryTable(),
    "joined-focus-table": () => renderJoinedFocusTable(),
    "bm-board-table": () => renderBlackMarketBoard(),
    // My Crafting List renders its entries through the source formatters above,
    // so it follows them. While the panel is VISIBLE it force-renders any source
    // it has entries in whose cache this pass skipped — empty (blank rows) or
    // merely stale (a price edit made in the list showing the old number). See
    // _clSourceState in js/render-craft-list.js; that catch-up was 5.7 s of a
    // measured cold boot, which is why the boot pass leaves it until last.
    "craft-list-table": () => {
      if (typeof renderCraftListTable === "function") renderCraftListTable();
    },
  };
}

function renderAllTables(data) {
  // Don't re-render while a price/volume editor is open — prevents API fetches
  // from destroying the editor mid-edit. Commit removes .pe-editing before calling this.
  if (document.querySelector(".pe-editing") || document.querySelector(".ve-editing")) return;

  // Defensive: reload overrides if in-memory state was lost
  if (Object.keys(priceOverrides).length === 0 && localStorage.getItem("priceOverrides")) {
    loadOverridesFromStorage();
  }
  if (Object.keys(volumeOverrides).length === 0 && localStorage.getItem("volumeOverrides")) {
    loadVolumeOverridesFromStorage();
  }
  if (Object.keys(cityForceOverrides).length === 0 && localStorage.getItem("cityForceOverrides")) {
    loadCityForcesFromStorage();
  }
  
  // Note: Removed the body position: fixed hack as it causes 1-screen scroll jump issues
  
  // A table nobody can see is not computed. This pass runs on every captured
  // price patch while the monitor is live, and with one section expanded the
  // collapsed tables were ~80% of its cost (js/render-gating.js). Skipped ones
  // are remembered and drawn when they are expanded.
  //
  // The joined summary is the exception: it reads its rows out of the source
  // tables' tableState caches, so while IT is open its sources are computed
  // even when collapsed.
  const summaryOpen = !isTableHidden("joined-summary-table")
    || !isTableHidden("joined-focus-table")
    || !isTableHidden("bm-board-table");
  // What this pass cost, per table. Boot reads it (js/boot-timing.js) to name the
  // expensive tables in its one log line: the pass is the longest thing the app
  // does, and without a breakdown every slow start looks the same.
  renderPassCost = {};
  // This pass supersedes anything the boot schedule or the async scheduler
  // still had queued.
  beginRenderPass();

  const calls = renderCalls(data);
  const draw = (tableId) => {
    if (isTableHidden(tableId) && !(summaryOpen && JOINED_SUMMARY_SOURCES.has(tableId))) {
      markTableDeferred(tableId);
      return;
    }
    timedRender(tableId, tableId, calls[tableId]);
    clearTableDeferred(tableId);
  };

  RENDER_ORDER.forEach((tableId) => {
    // Rerolling has no rows until a quality-aware scan has run.
    if (tableId === "rerolling-table" && !lastQualityMarketData) return;
    draw(tableId);
  });

  // MUST be last — projects over every source table's tableState[X].data cache,
  // so every other renderer must have populated its cache first.
  BOARD_TABLES.forEach((tableId) => {
    if (isTableHidden(tableId)) {
      markTableDeferred(tableId);
      return;
    }
    timedRender(tableId, tableId, calls[tableId]);
    clearTableDeferred(tableId);
  });

  timedRender(CRAFT_LIST_TABLE, "renderCraftListTable", calls[CRAFT_LIST_TABLE]);
}

/**
 * The boot pass: the same tables, drawn one per turn.
 *
 * Startup used to spend up to 19 s inside the synchronous pass above, with the
 * window on screen and frozen solid. Nearly all of it was work for tables the
 * user could not see — collapsed board feeders, and the craft list dragging the
 * Craft Planner along behind it. Here the plan is split into phases and the
 * thread is handed back to the browser between every table, so the visible ones
 * appear first and the app is usable while the rest fill in behind.
 *
 * @param {object} data                flat price map
 * @param {Function} [options.onPhase] called as each phase finishes (see
 *                                     js/render-schedule.js).
 */
async function renderAllTablesBoot(data, { onPhase, onStep } = {}) {
  renderPassCost = {};
  const myPass = beginRenderPass();

  const calls = renderCalls(data);
  const steps = bootRenderSteps({
    order: RENDER_ORDER,
    isHidden: isTableHidden,
    summarySources: JOINED_SUMMARY_SOURCES,
    hasQuality: !!lastQualityMarketData,
    // The craft list catches an empty or stale source up INSIDE its own
    // renderer — one unbroken block, measured at 8.7 s
    // (js/render-craft-list.js). Boot used to leave it there, which froze the
    // window for all of it: no spinner turns on a thread that is rendering, and
    // nothing scrolls. Scheduling the same sources as steps splits work the list was
    // going to do anyway, so the browser gets a frame between each. Panel
    // collapsed, the list catches nothing up and this is pure cost — the same
    // condition planRerenderPass applies.
    listSources: (typeof craftListSourceTableIds === "function"
      && !isTableHidden(CRAFT_LIST_TABLE))
      ? craftListSourceTableIds()
      : [],
  });

  // Everything the plan leaves out is owed a render the moment it is expanded —
  // the same debt renderAllTables records for a table it skips.
  const planned = new Set(steps.map((s) => s.id));
  [...RENDER_ORDER, ...BOARD_TABLES].forEach((tableId) => {
    if (!planned.has(tableId)) markTableDeferred(tableId);
  });
  // Every table this pass is going to fill says so, in itself, before the pass
  // takes the thread. The "visible" phase used to be excluded because the boot
  // overlay covered it — with no splash and no overlay those are exactly the
  // tables the user is looking at, so they are the ones that most need to say
  // the app is working on them (js/table-loading-mark.js).
  if (typeof markTableLoading === "function") {
    steps
      .filter((s) => !isTableHidden(s.id))
      .forEach((s) => markTableLoading(s.id));
  }

  const started = typeof performance !== "undefined" ? performance.now() : 0;
  const result = await runRenderSteps(steps, {
    render: (tableId) => {
      timedRender(tableId, tableId, calls[tableId]);
      clearTableDeferred(tableId);
      // The render replaces the tbody, mark and all. This is for the one that
      // throws or draws in place — a loading row left spinning over a table
      // nothing is computing is worse than no mark at all.
      if (typeof tableLoadingDone === "function") tableLoadingDone(tableId);
    },
    yieldTo: yieldToBrowser,
    onStep: (step, index, total) => {
      if (typeof onStep === "function") onStep(step, index, total);
    },
    onPhase: (phase) => {
      // Timed as well as forwarded: "the app was usable after N ms" is the one
      // number this whole schedule exists to move.
      if (typeof performance !== "undefined") {
        console.info(`[boot] phase ${phase} done at ${Math.round(performance.now())}ms`);
      }
      if (typeof onPhase === "function") onPhase(phase);
    },
    // A scan or a captured price patch redraws everything anyway; finishing a
    // stale plan on top of it would only cost the user another freeze.
    cancelled: () => !isCurrentRenderPass(myPass),
  });

  if (typeof performance !== "undefined") {
    const ms = Math.round(performance.now() - started);
    console.info(
      `[boot] background tables: ${result.rendered} drawn in ${ms}ms` +
        (isCurrentRenderPass(myPass) ? "" : " (cut short by a redraw)"),
    );
  }
  return result;
}

/**
 * Which render pass is the current one.
 *
 * Every pass takes a token when it starts and checks between tables that it is
 * still the newest; anything that supersedes it (a scan, a price edit, a
 * captured price patch) just bumps the counter. A single boolean used to do
 * this, and could not: a cancelled pass A and a fresh pass B share one flag, so
 * B would read A's cancellation and stop itself.
 */
let renderPassSeq = 0;

function beginRenderPass() {
  return ++renderPassSeq;
}

function isCurrentRenderPass(token) {
  return token === renderPassSeq;
}

/**
 * Hand the thread back long enough for the browser to paint what the last table
 * produced. The frame callback alone is not enough — it runs before layout, so
 * the timeout inside it is what guarantees a finished frame.
 */
function yieldToBrowser() {
  const t = typeof performance !== "undefined" ? performance.now() : 0;
  const done = (resolve) => {
    // A frame that took this long is not a yield, it is a stall — worth a line,
    // because from the outside it looks exactly like a slow renderer.
    if (typeof performance !== "undefined" && performance.now() - t > 500) {
      console.info(`[boot] waited ${Math.round(performance.now() - t)}ms for a frame`);
    }
    resolve();
  };
  return new Promise((resolve) => {
    let settled = false;
    const once = () => {
      if (settled) return;
      settled = true;
      done(resolve);
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => setTimeout(once, 0));
    }
    // A window that is minimised or covered stops producing frames, and the
    // rest of the tables must not wait for one that is never coming.
    setTimeout(once, YIELD_FRAME_CAP_MS);
  });
}

/** How long a phase boundary will wait for a frame before moving on. */
const YIELD_FRAME_CAP_MS = 250;

/**
 * Draw one table for an asynchronous pass.
 *
 * `_suppressSort` is set and cleared around this ONE renderer, never held
 * across a yield. It tells js/sorting.js to keep the previous row order so the
 * row being edited does not teleport — but the same flag is read when the user
 * clicks a column header, and an async pass hands the thread back between
 * tables. Holding it for the whole pass would silently ignore a sort click made
 * while the pass ran. Per-table is identical in effect (every renderer still
 * runs suppressed) and invisible to any event handler in between.
 */
function drawOneTable(tableId, calls, cancelled, itemIds = null) {
  const chunked = CHUNKED_RENDERERS[tableId];
  if (chunked) return drawOneTableChunked(tableId, chunked, cancelled, itemIds);
  _suppressSort = true;
  try {
    timedRender(tableId, tableId, calls[tableId]);
  } finally {
    _suppressSort = false;
  }
  clearTableDeferred(tableId);
}

/**
 * Renderers too big to be one step.
 *
 * A step in the schedule is a whole renderer, so a single one that runs for
 * seconds freezes the window no matter how the pass around it is arranged. The
 * Craft Planner (7.1 s measured, and My Crafting List drags it in on every
 * price edit even while the planner is collapsed) and Crafting (1.7 s) are the
 * two where that is true, so they compute their rows in slices instead,
 * yielding between them and writing the DOM once at the end. See
 * js/render-craft-planner.js and js/render-crafting-chunked.js.
 *
 * A chunked renderer is only used by an async pass. The synchronous
 * renderAllTables still calls the plain one through renderCalls().
 */
const CHUNKED_RENDERERS = {
  "crafting-table": (opts) => renderCraftingTableChunked(lastMarketData, opts),
  "craft-planner-table": (opts) => renderCraftPlannerTableChunked(lastMarketData, opts),
};

/**
 * Run a chunked renderer as one step, timed and sort-suppressed like any other.
 *
 * `cancelled` is the pass's own probe, handed down so a superseded pass stops
 * inside the renderer instead of at its edge — the Craft Planner is 7.1 s of
 * work, and a pass that has already lost the thread has no business finishing
 * it. And because a cancelled chunked renderer returns `false` WITHOUT
 * painting, its deferral must be kept: clearing it unconditionally marked the
 * table clean while it was still showing the previous pass's rows, which the
 * user then had to collapse and re-expand to fix.
 */
async function drawOneTableChunked(tableId, chunked, cancelled = () => false, itemIds = null) {
  const started = typeof performance !== "undefined" ? performance.now() : 0;
  let painted;
  try {
    painted = (await chunked({
      yieldTo: yieldToBrowser,
      cancelled,
      // The ids a data-refresh pass moved; a renderer that can recompute only
      // the rows reading them does (js/craft-planner-row-cache.js).
      itemIds,
      // Only the DOM write is suppressed: the flag is global and the compute
      // above it spans yields, during which the user may click a header.
      paint: (write) => {
        _suppressSort = true;
        try { write(); } finally { _suppressSort = false; }
      },
    })) !== false;
  } catch (e) {
    console.error(`${tableId}:`, e);
    painted = false;
  }
  if (typeof performance !== "undefined") {
    renderPassCost[tableId] = Math.round(performance.now() - started);
  }
  if (painted) clearTableDeferred(tableId);
  else markTableDeferred(tableId);
  return painted;
}

/**
 * Plan the re-render that follows a price edit or a header toggle.
 *
 * Same tables, same gating and the same deferred-table bookkeeping as
 * renderAllTables — the difference is that the steps come back as a plan for
 * js/render-async.js to run a piece at a time instead of all at once.
 *
 * @param {string|null} priorityTableId  the edited table, drawn before the rest
 * @returns {{steps: object[], plannedIds: string[], render: Function}|null}
 */
function planRerenderPass(priorityTableId, itemIds = null) {
  // Quality Rerolling can be scanned on its own: its button only fills
  // lastQualityMarketData, and lastMarketData stays null. Hand-built and
  // UNGATED, exactly as the synchronous fallback was — routing it through the
  // gated planner would silently drop the update whenever the table is
  // collapsed, and a quality override would not show until a reload.
  if (!lastMarketData) {
    if (!lastQualityMarketData) return null;
    const calls = renderCalls(null);
    return {
      steps: [
        { id: "rerolling-table", phase: "edited" },
        { id: "joined-summary-table", phase: "boards" },
        { id: "bm-board-table", phase: "boards" },
      ],
      plannedIds: [],
      render: (tableId, cancelled) => drawOneTable(tableId, calls, cancelled, itemIds),
    };
  }

  const calls = renderCalls(lastMarketData);

  // My Crafting List catches its stale sources up inside its own renderer —
  // one 8.7 s block on a measured price map, by far the longest thing the app
  // does. Handing the same tables to the schedule splits that block into steps
  // it can yield between; by the time the list is drawn they are all fresh and
  // it returns almost immediately. Only while the panel is visible: collapsed,
  // the list does not catch anything up, so pre-computing would be pure cost.
  const listSources = (typeof craftListSourceTableIds === "function"
    && !isTableHidden(CRAFT_LIST_TABLE))
    ? craftListSourceTableIds()
    : [];

  const steps = bootRenderSteps({
    order: RENDER_ORDER,
    isHidden: isTableHidden,
    summarySources: JOINED_SUMMARY_SOURCES,
    hasQuality: !!lastQualityMarketData,
    first: priorityTableId ? [priorityTableId] : [],
    listSources,
  });

  // Everything the plan leaves out is owed a render the moment it is expanded —
  // the same debt renderAllTables records for a table it skips.
  const planned = new Set(steps.map((s) => s.id));
  [...RENDER_ORDER, ...BOARD_TABLES].forEach((tableId) => {
    if (!planned.has(tableId)) markTableDeferred(tableId);
  });

  // With a City pick on the list, each source also pays its re-price in its OWN
  // step, right after it draws, so the list step is a _clRepricedCache hit
  // instead of one unbroken block over every source.
  const warmable = new Set(listSources);
  const warm = (tableId) => {
    if (!warmable.has(tableId) || typeof _clWarmRepriced !== "function") return;
    try { _clWarmRepriced(tableId); } catch (e) { console.error(`${tableId} (list re-price):`, e); }
  };

  return {
    steps,
    plannedIds: [...planned],
    render: (tableId, cancelled) => {
      const before = typeof tableState !== "undefined" && tableState[tableId]
        ? tableState[tableId].data : null;
      const drawing = drawOneTable(tableId, calls, cancelled, itemIds);
      const fresh = () => typeof tableState !== "undefined" && tableState[tableId]
        && tableState[tableId].data !== before;
      // A chunked renderer hands its rows over after the first await; warming
      // before then would price the PREVIOUS rows. When the rows are already new
      // (plain renderer, or a chunked one that finished synchronously) warm now,
      // inside this step.
      if (!drawing || typeof drawing.then !== "function" || fresh()) warm(tableId);
      if (drawing && typeof drawing.then === "function") {
        return drawing.then((value) => {
          if (value !== false && !(cancelled && cancelled())) warm(tableId);
          return value;
        });
      }
      return drawing;
    },
  };
}

/**
 * Wire the asynchronous re-render. Called once at startup; after this every
 * price edit and header toggle goes through scheduleRerender() instead of
 * freezing the window inside renderAllTables().
 */
function installRenderScheduler() {
  if (typeof initRenderScheduler !== "function") return;
  initRenderScheduler({
    planPass: ({ priorityTableId, itemIds }) => planRerenderPass(priorityTableId, itemIds),
    runSteps: runRenderSteps,
    yieldTo: yieldToBrowser,
    beginPass: beginRenderPass,
    isCurrentPass: isCurrentRenderPass,
    canSchedule: () => !!(lastMarketData || lastQualityMarketData),
    // The same guard renderAllTables has always had: redrawing a tbody destroys
    // the editor sitting inside it.
    isEditorOpen: () =>
      !!document.querySelector(".pe-editing") || !!document.querySelector(".ve-editing"),
    markDeferred: markTableDeferred,
    markComputing: markTableComputing,
    // Parked behind an open price editor: no pass is drawing, so the marks
    // (which a superseded pass deliberately leaves up) have to come down until
    // one is.
    onHeld: () => clearRecalcCellMark(),
    // Dim and spin every number this pass is about to replace — scoped to the
    // items that actually moved when the caller named them (js/recalc-cell-mark.js).
    onPassStart: ({ tableIds, itemIds }) => beginRecalcCellMark({ tableIds, itemIds }),
    onTableDrawn: (tableId) => recalcCellMarkTableDone(tableId),
    onPassEnd: ({ superseded }) => {
      // A superseded pass is immediately followed by another one; clearing here
      // would strobe the marks through a burst of edits.
      if (superseded) return;
      // NOT here, one frame later. This runs the instant the last renderer has
      // written its tbody — before the browser has laid that out and painted
      // it, which on a page of ~80 000 nodes is itself a visible stall. Clearing
      // now takes the marks away exactly during the wait they exist to report:
      // the spinners stop, and only then do the numbers change.
      // yieldToBrowser resolves after a real frame (capped at 250 ms so a
      // minimised window still settles).
      yieldToBrowser().then(() => {
        // Another pass started inside that frame — it owns the marks now, and
        // its own end will clear them.
        if (isRerenderBusy()) return;
        // Anything still owed a render that the user can SEE is caught up here.
        // Expanding a table used to be the only place the deferred ledger was
        // ever drained, so a table that was already open when a pass was cut
        // short kept its stale numbers until it was collapsed and re-expanded.
        // Collapsed tables stay deferred — that gating is what makes them free.
        if (typeof drainVisibleDeferredTables === "function") {
          drainVisibleDeferredTables({
            data: lastMarketData,
            qualityData: lastQualityMarketData,
          });
        }
        clearRecalcCellMark();
        clearPendingEditMark();
        // Belt and braces: any cell marked before this module existed, or one
        // whose row lost its identity, is swept the old way.
        document.querySelectorAll(".pe-pending").forEach((el) => el.classList.remove("pe-pending"));
      });
    },
  });
}

/**
 * Say so, in the table itself, when a visible table is queued behind others.
 *
 * A thin name over js/table-loading-mark.js, which owns the rules (only over a
 * placeholder, never over real rows, never sizing a column) and draws the
 * spinning ring. Kept because the async re-render scheduler is wired to this
 * name (installRenderScheduler above) and the two paths want the same mark.
 */
function markTableComputing(tableId) {
  if (typeof markTableLoading === "function") markTableLoading(tableId);
}

// Reflect the ⚙ Specs state in the UI: each table's ⚙ button is marked when
// that table's scope has been customised. The Crafting heading no longer names
// a spec level at all — levels are adjustable per table, so the heading only
// says whether focus is on. Called by the panel (js/spec-settings-panel.js)
// after every level change.
function updateSpecHeadings() {
  const custom = (scope) =>
    typeof hasCustomSpec === "function" && hasCustomSpec(scope);

  const specsLabel = typeof t === "function" && t("specs") !== "specs" ? t("specs") : "⚙ Specs";
  document.querySelectorAll(".spec-settings-btn").forEach((button) => {
    const isCustom = custom(button.dataset.specScope);
    button.classList.toggle("is-custom", isCustom);
    button.textContent = isCustom ? `${specsLabel} *` : specsLabel;
  });

  const heading = document.getElementById("crafting-heading");
  const span = heading && heading.querySelector("span[data-i18n]");
  if (!span) return;
  const focusOn = typeof isFocusEnabled === "function" ? isFocusEnabled() : true;
  const slug = focusOn ? "crafting_w_focus" : "crafting_no_focus";
  const english = `Crafting (${focusOn ? "w/ Focus" : "No Focus"})`;
  span.dataset.i18n = slug;
  // js/i18n.js caches the element's English on first pass and restores it for any
  // slug a language table is missing — re-prime it, don't drop it (see the note
  // in updateFocusHeading).
  span.dataset.i18nEn = english;
  const translated = typeof t === "function" ? t(slug) : slug;
  span.textContent = translated === slug ? english : translated;
}
