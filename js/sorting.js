// --- UI Rendering and Sorting ---

function isTableCollapsed(tableId) {
  // Delegate: per-table collapse hides the wrapping .table-wrap and group
  // collapse folds the .tgroup band, so reading the <table>'s own display —
  // which is what this used to do — reported "expanded" for a table that was
  // nowhere on screen, and every collapsed table paid for a full DOM build.
  if (typeof isTableHidden === "function") return isTableHidden(tableId);
  const el = document.getElementById(tableId);
  return !!(el && el.style.display === "none");
}

// Which base items have their enchant variants (@1-@4) expanded, PER TABLE.
// The same base id lists in Crafting, Consumables, the Craft Planner and
// Flipping; one shared set opened it in all four at once (and the planner's
// variants came up unpriced — only the clicked table fetches them).
// expandedCraftItems is the Crafting table's own set (the name predates the
// split); every other table gets its own from expandedCraftItemsFor().
const expandedCraftItems = new Set();
const _expandedVariantSets = new Map([["crafting-table", expandedCraftItems]]);
function expandedCraftItemsFor(tableId) {
  const id = tableId || "crafting-table";
  if (!_expandedVariantSets.has(id)) _expandedVariantSets.set(id, new Set());
  return _expandedVariantSets.get(id);
}

// Tables whose enchant variant (@n) rows are collapsed under an expandable base.
/**
 * Is this row an ENCHANT VARIANT — a .1/.2/.3 form that nests under a base row
 * in the same table?
 *
 * Asked of the ROW, not sniffed from the id, because an @n suffix does not
 * always mean "enchant". Dragon Sanctuary Waystones carry their difficulty
 * D1-D4 as enchantment levels, so their marketplace ids end in @1..@4 with no
 * base row to nest under; js/data-waystones.js flags them topLevelVariant and
 * they stay where they belong, at the top level. Same principle the Flipping
 * table already applies to its resource _LEVELn@n rows.
 */
function isEnchantVariantRow(row) {
  const item = row && row.item;
  if (!item || typeof item.id !== "string") return false;
  if (item.topLevelVariant) return false;
  return item.id.includes("@");
}

const COLLAPSE_VARIANT_TABLES = new Set([
  "crafting-table",
  "consumable-table",
  "craft-planner-table",
]);

// Live value ("" = All, else "0".."4") of a table's injected enchant picker
// (see table-search.js). Used so an active enchant filter can surface the
// matching @n variants even when their base row isn't expanded — otherwise the
// picker would render an empty table (the collapse filter hides every variant).
function activeEnchantFilter(tableId) {
  if (typeof document === "undefined") return "";
  const el = document.getElementById("enchfilter-" + tableId);
  return (el && el.value) || "";
}

// True when `itemId` is an enchant variant (@n) that the active enchant picker
// for `tableId` is asking to show, regardless of its base's expand state.
function variantMatchesEnchantFilter(itemId, tableId) {
  const enchSel = activeEnchantFilter(tableId);
  if (!enchSel) return false;
  const m = String(itemId).match(/@(\d+)/);
  return !!m && m[1] === enchSel;
}

const LOCAL_STORAGE_KEY = "albionMarketSortState";
/** One-shot: drops the old throughput pin off the top board. See loadSortState. */
const TOP_BOARD_SORT_MIGRATION_KEY = "topBoardSortMigrated";

const defaultSortState = {
  "crafting-table": { sortCol: "margin", sortDir: "desc", secondarySortCol: null, secondarySortDir: "asc" },
  "craft-planner-table": { sortCol: "combined", sortDir: "desc", secondarySortCol: null, secondarySortDir: "asc" },
  "flipping-table": { sortCol: "margin", sortDir: "desc", secondarySortCol: null, secondarySortDir: "asc" },
  "skins-trading-table": { sortCol: "margin", sortDir: "desc", secondarySortCol: null, secondarySortDir: "asc" },
  "transport-table": { sortCol: "margin", sortDir: "desc", secondarySortCol: null, secondarySortDir: "asc" },
  "consumable-table": { sortCol: "margin", sortDir: "desc", secondarySortCol: null, secondarySortDir: "asc" },
  "volume-table": { sortCol: "totalVol", sortDir: "desc", secondarySortCol: null, secondarySortDir: "asc" },
  "rolling-table": { sortCol: "margin", sortDir: "desc", secondarySortCol: null, secondarySortDir: "asc" },
  "mounts-table": { sortCol: "margin", sortDir: "desc", secondarySortCol: null, secondarySortDir: "asc" },
  "faction-spending-table": { sortCol: "silverPerFp", sortDir: "desc", secondarySortCol: null, secondarySortDir: "asc" },
  "farming-table": { sortCol: "profitPerDay", sortDir: "desc", secondarySortCol: null, secondarySortDir: "asc" },
  "gathering-table": { sortCol: "silverPerHour", sortDir: "desc", secondarySortCol: null, secondarySortDir: "asc" },
  "journal-filling-table": { sortCol: "silverPer1kFame", sortDir: "desc", secondarySortCol: null, secondarySortDir: "asc" },
  "enchanting-table": { sortCol: "margin", sortDir: "desc", secondarySortCol: null, secondarySortDir: "asc" },
  "rerolling-table": { sortCol: "margin", sortDir: "desc", secondarySortCol: null, secondarySortDir: "asc" },
  "transmute-table": { sortCol: "margin", sortDir: "desc", secondarySortCol: null, secondarySortDir: "asc" },
  "laborers-table": { sortCol: "profit", sortDir: "desc", secondarySortCol: null, secondarySortDir: "asc" },
  // A cost board, not a profit table: cheapest first is the useful default.
  "buildings-table": { sortCol: "totalCost", sortDir: "asc", secondarySortCol: null, secondarySortDir: "asc" },
  // The two Top-10 boards are already ranked when they arrive; the default
  // sort simply agrees with the ranking so the table reads top-down.
  "joined-summary-table": { sortCol: "profit", sortDir: "desc", secondarySortCol: null, secondarySortDir: "asc" },
  "joined-focus-table": { sortCol: "profitPer10kFocus", sortDir: "desc", secondarySortCol: null, secondarySortDir: "asc" },
  "bm-board-table": { sortCol: "profit", sortDir: "desc", secondarySortCol: null, secondarySortDir: "asc" },
};

// Saved state is MERGED onto the defaults, never substituted for them. A blob
// written before a table existed has no entry for it, and returning that blob
// raw left the newer table with no sortCol at all — getSortValue(row, undefined)
// returns 0 for every row, so the table rendered in build order and its default
// sort looked broken until the user clicked a header. Per-table merge means a
// table added tomorrow still gets its default from anyone's old blob.
function loadSortState() {
  const merged = JSON.parse(JSON.stringify(defaultSortState));
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      Object.keys(parsed || {}).forEach((tableId) => {
        const entry = parsed[tableId];
        if (entry && typeof entry === "object") {
          merged[tableId] = { ...(merged[tableId] || {}), ...entry };
        }
      });
    }
  } catch (e) {
    console.warn("Failed to load sort state", e);
  }
  // The top board used to BE the throughput ranking, so every existing blob
  // pins that column. It is still there to sort by, but the rows arriving are
  // now the ten most PROFITABLE — leaving the pin in place would order a
  // profit board by a column it was not built from.
  //
  // Flagged rather than done by value: a user who picks Throughput again after
  // the migration means it, and resetting them on every launch would be a bug
  // rather than a fix.
  try {
    if (localStorage.getItem(TOP_BOARD_SORT_MIGRATION_KEY) !== "1") {
      if (merged["joined-summary-table"]?.sortCol === "throughput") {
        merged["joined-summary-table"] = { ...defaultSortState["joined-summary-table"] };
      }
      localStorage.setItem(TOP_BOARD_SORT_MIGRATION_KEY, "1");
    }
  } catch (e) {
    /* private mode: the board just opens on whatever was saved */
  }
  return merged;
}

const savedSorts = loadSortState();

const tableState = {
  "crafting-table": {
    data: [],
    formatter: null,
    ...savedSorts["crafting-table"],
  },
  "craft-planner-table": {
    data: [],
    formatter: null,
    // Fall back to the default when an older saved sort-state predates this table.
    ...(savedSorts["craft-planner-table"] || defaultSortState["craft-planner-table"]),
  },
  "flipping-table": {
    data: [],
    formatter: null,
    ...savedSorts["flipping-table"],
  },
  "skins-trading-table": {
    data: [],
    formatter: null,
    ...savedSorts["skins-trading-table"],
  },
  "transport-table": {
    data: [],
    formatter: null,
    ...savedSorts["transport-table"],
  },
  "consumable-table": {
    data: [],
    formatter: null,
    ...savedSorts["consumable-table"],
  },
  "volume-table": {
    data: [],
    formatter: null,
    ...savedSorts["volume-table"],
  },
  "rolling-table": {
    data: [],
    formatter: null,
    ...savedSorts["rolling-table"],
  },
  "mounts-table": {
    data: [],
    formatter: null,
    ...savedSorts["mounts-table"],
  },
  "faction-spending-table": {
    data: [],
    formatter: null,
    ...savedSorts["faction-spending-table"],
  },
  "farming-table": {
    data: [],
    formatter: null,
    ...savedSorts["farming-table"],
  },
  "gathering-table": {
    data: [],
    formatter: null,
    ...savedSorts["gathering-table"],
  },
  "journal-filling-table": {
    data: [],
    formatter: null,
    // Fall back to the default when an older saved sort-state predates this table.
    ...(savedSorts["journal-filling-table"] || defaultSortState["journal-filling-table"]),
  },
  "enchanting-table": {
    data: [],
    formatter: null,
    ...savedSorts["enchanting-table"],
  },
  "rerolling-table": {
    data: [],
    formatter: null,
    ...savedSorts["rerolling-table"],
  },
  "transmute-table": {
    data: [],
    formatter: null,
    ...savedSorts["transmute-table"],
  },
  "laborers-table": {
    data: [],
    formatter: null,
    ...savedSorts["laborers-table"],
  },
  "buildings-table": {
    data: [],
    formatter: null,
    // Fall back to the default when an older saved sort-state predates this table.
    ...(savedSorts["buildings-table"] || defaultSortState["buildings-table"]),
  },
  "joined-summary-table": {
    data: [],
    formatter: null,
    ...savedSorts["joined-summary-table"],
  },
  "joined-focus-table": {
    data: [],
    formatter: null,
    // Fall back to the default when an older saved sort-state predates this table.
    ...(savedSorts["joined-focus-table"] || defaultSortState["joined-focus-table"]),
  },
  "bm-board-table": {
    data: [],
    formatter: null,
    ...(savedSorts["bm-board-table"] || defaultSortState["bm-board-table"]),
  },
};

// Every table in tableState, not a hand-written list: the list had drifted and
// silently dropped the Crafting Planner and the Laborers table, so a sort chosen
// there was forgotten on the next launch while every other table remembered.
function saveCurrentSortState() {
  const toSave = {};
  Object.keys(tableState).forEach((tableId) => {
    const state = tableState[tableId];
    if (!state) return;
    toSave[tableId] = {
      sortCol: state.sortCol,
      sortDir: state.sortDir,
      secondarySortCol: state.secondarySortCol,
      secondarySortDir: state.secondarySortDir,
    };
  });
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(toSave));
}

// When true, updateTableDisplay preserves the previous row order instead of re-sorting.
// Set around override-triggered re-renders so the user's view stays stable.
let _suppressSort = false;


function getSortValue(row, col, tableId) {
  try {
  // Joined-summary rows are flat (normalized) — short-circuit so the rest of
  // this function (which knows about nested marginInfo / oxLoad / etc.)
  // doesn't need every column branched on the joined-table shape.
  // Crafting Planner rows have their own shape (combinedProfit, refineCraftCost,
  // sellPrice, journal, bestFocusStep) — short-circuit so the shared branches
  // below (which know crafting-table/transport-table shapes) don't mis-read it.
  // Tables with a shape of their own (craft-planner, buildings, joined-summary)
  // answer as a closed switch — js/sorting-values-tables.js.
  if (typeof getTableSpecificSortValue === "function") {
    const v = getTableSpecificSortValue(row, col, tableId);
    if (v !== undefined) return v;
  }

  if (col === "tier") return row.tier || 4;
  if (col === "slot") return row.slot || ""; // skins-trading-table
  if (col === "category") return row.category || "";
  if (col === "totalVol") return row.totalVol;
  if (col === "topCityVol") return row.topCityVol;
  if (col === "topCity") return row.topCity || "";

  if (col === "margin") return row.marginInfo ? row.marginInfo.margin : -999;
  if (col === "profit") {
    if (tableId === "rolling-table") return (row.sellRevenue || 0) - (row.rollCostSilver || 0);
    return row.marginInfo ? (row.marginInfo.profit || 0) : -Infinity;
  }
  if (col === "dailyVol") return row.dailyVol || 0;
  if (col === "sellVol") return row.sellVol || 0;
  if (col === "profitPerLoad") return row.oxLoad ? row.oxLoad.profitPerLoad : 0;
  if (col === "profitPerFocus") return row.profitPerFocus || 0;
  // Best Focus is chosen on what the winning play ADDS to the row's end product,
  // so the column sorts on that delta rather than on silver-per-focus (which the
  // Silver/Focus column beside it already sorts on). See js/focus-play.js.
  if (col === "bestFocus")
    return row.bestFocusPlay ? (row.bestFocusPlay.profitDelta || 0) : -Infinity;
  // Crafting table: Pure Profit + laborer-worked journal value. No-data rows
  // carry no figure at all — sort them to the bottom like the other profit cols.
  if (col === "profitWithLaborer")
    return row.profitWithLaborer != null ? row.profitWithLaborer : -Infinity;
  if (col === "profitPer10kFocus")
    return row.profitPer10kFocus != null ? row.profitPer10kFocus : -Infinity;
  if (col === "profitGatheredPer10kFocus")
    return row.profitGatheredPer10kFocus != null ? row.profitGatheredPer10kFocus : -Infinity;
  if (col === "silverPerFp") return row.silverPerFp || 0;
  if (col === "silverPerFavor") return row.silverPerFavor || 0;
  if (col === "babyRawSilverPerFp") return row.babyRawSilverPerFp || 0;
  if (col === "breedSilverPerFp") return row.breedSilverPerFp || 0;
  if (col === "fpCost") return row.fpCost || 0;
  if (col === "favorCost") return row.favorCost || 0;
  if (col === "sellPrice") return row.sellPrice || 0;
  if (col === "netSilver") return row.netSilver || 0;
  if (col === "category") return row.category || "";
  if (col === "sellCity") return row.sellCity || "";
  if (col === "focusMats") return row.focusMats || 0;
  if (col === "nurtureEv") return row.nurtureEv != null ? row.nurtureEv : -Infinity;
  if (col === "bonusCity") return (row.bonusCities && row.bonusCities[0]) || "zzzz"; // sort blanks to end
  if (col === "cycleHours") return row.cycleHours || 0;
  if (col === "totalSeedYield") return row.totalSeedYield || 0;
  if (col === "profitPerCycle") return row.profitPerCycle || 0;
  if (col === "profitPerDay") return row.profitPerDay || 0;
  // Gathering / Journal Filling / Laborers own columns — js/sorting-values-tables.js
  if (typeof getGatheringSortValue === "function") {
    const v = getGatheringSortValue(row, col);
    if (v !== undefined) return v;
  }

  if (col === "name") {
    if (tableId === "volume-table") return row.name;
    if (tableId === "gathering-table") return row.name || "";
    if (tableId === "transport-table") return getItemDisplayName(row.route.refinedId);
    if (tableId === "rolling-table")
      return `T${row.tier}_${row.rollType}_${row.artName}`;
    if (tableId === "enchanting-table")
      return row.item ? `${row.item.name}_${row.transitionLabel}` : "";
    if (tableId === "transmute-table")
      // Sort by what the row PRODUCES — matches the rendered Tier cell.
      return row.transition
        ? `T${row.targetTier != null ? row.targetTier : row.tier}.${row.targetEnch || 0}_${row.transition.label}`
        : "";
    if (tableId === "rerolling-table")
      return row.item ? `${row.item.name}_${row.transitionLabel}` : "";
    return row.item ? row.item.name : "";
  }

  if (col === "route") {
    if (tableId === "crafting-table")
      return `${row.craftCity}-${row.sellGear.city}`;
    if (tableId === "transport-table")
      return `${row.buyRaw.city}-${row.refineCity}-${row.sellRefined.city}`;
    if (tableId === "consumable-table")
      return `${row.craftCity || row.buyMat?.city}-${row.sellPot?.city}`;
    if (tableId === "mounts-table")
      return `${row.craftCity || row.buyMat?.city}-${row.sellPot?.city}`;
    if (tableId === "farming-table")
      return `${row.buySeed?.city}-${row.sellCrop?.city}`;
    if (tableId === "enchanting-table")
      return `${row.sourceCity}-${row.sellCity}`;
    if (tableId === "transmute-table")
      return `${row.buyCity}-${row.sellCity}`;
    if (tableId === "rerolling-table")
      return `${row.buyCity}-${row.sellCity}`;
    return `${row.buy.city}-${row.sell.city}`; // flipping uses buy/sell
  }

  if (col === "materials") {
    if (tableId === "crafting-table") {
      if (!row.item) return "";
      const matId = row.materials?.[0]?.matId || row.item?.matId || "";
      return getItemDisplayName(matId);
    }
    if (tableId === "transport-table")
      return row.route ? `${ITEM_NAMES_MAP[row.route.rawId] || row.route.rawId}-${row.buyRaw?.city}` : "";
    if (tableId === "consumable-table")
      return row.recipe ? row.recipe.map((m) => m.matId).join(",") : "";
    if (tableId === "mounts-table")
      return row.recipe ? row.recipe.map((m) => m.matId).join(",") : "";
  }

  if (col === "cost") {
    if (tableId === "crafting-table") return row.totalInputCost || 0;
    if (tableId === "transport-table") return row.totalRawCost;
    if (tableId === "consumable-table") return row.totalInputCost || 0;
    if (tableId === "mounts-table") return row.totalInputCost || 0;
    if (tableId === "farming-table") return row.totalInputCost || 0;
    if (tableId === "rolling-table") return row.rollCostSilver || 0;
    if (tableId === "enchanting-table") return row.totalInputCost || 0;
    if (tableId === "transmute-table") return row.totalInputCost || 0;
    if (tableId === "rerolling-table") return row.totalInputCost || 0;
    if (tableId === "laborers-table") return row.totalInputCost || 0;
    return row.buy ? row.buy.price * (1 + SETUP_FEE) : 0; // flipping cost
  }

  if (col === "emptyRevenue") {
    return row.emptyJournalPrice || 0;
  }

  if (col === "mode") return row.mode || "";
  if (col === "bestJournalProfit") return row.bestJournal ? row.bestJournal.profit : -Infinity;
  if (col === "contractBuyCost") return (row.rowContract && row.rowContract.buyPrice) || 0;
  if (col === "levelingPathProfit") return row.levelingPath ? row.levelingPath.netProfit : -Infinity;
  if (col === "breakevenCycles") {
    // 0/negative breakeven means "no contract data" or "unprofitable" — sort to bottom
    return row.breakevenCycles > 0 ? row.breakevenCycles : Infinity;
  }

  if (col === "revenue") {
    if (tableId === "crafting-table") return row.sellGear.price;
    if (tableId === "transport-table") return row.sellRefined.price;
    if (tableId === "consumable-table") return row.sellPot.price;
    if (tableId === "mounts-table") return row.sellPot?.price || 0;
    if (tableId === "farming-table") return row.sellCrop?.price || 0;
    if (tableId === "rolling-table") return row.bestSellPrice || 0;
    if (tableId === "enchanting-table") return row.sellPrice || 0;
    if (tableId === "transmute-table") return row.sellPrice || 0;
    if (tableId === "rerolling-table") return row.sellPrice || 0;
    // Payload / Cycle = gross per-cycle revenue. payloadRevenue is set for every
    // mode (trophy included); row.sell.price is only the per-unit payload price,
    // which mis-orders all non-trophy rows. Mirror the column's actual meaning.
    if (tableId === "laborers-table") return row.payloadRevenue || 0;
    return row.sell ? row.sell.price : 0; // flipping
  }
  return 0;
  } catch { return ""; }
}

// Shared row comparator for the active sort (primary column + direction, with
// the secondary column as a tiebreaker). Used by both the normal full sort and
// the suppress-sort path that splices freshly-appeared rows into place.
function compareRows(a, b, state, tableId) {
  let valA = getSortValue(a, state.sortCol, tableId);
  let valB = getSortValue(b, state.sortCol, tableId);

  let cmp;
  if (typeof valA === "string" && typeof valB === "string") {
    cmp = valA.localeCompare(valB);
  } else {
    cmp = valA - valB;
  }
  if (state.sortDir === "desc") cmp = -cmp;

  if (cmp === 0 && state.secondarySortCol) {
    let sA = getSortValue(a, state.secondarySortCol, tableId);
    let sB = getSortValue(b, state.secondarySortCol, tableId);
    if (typeof sA === "string" && typeof sB === "string") {
      cmp = sA.localeCompare(sB);
    } else {
      cmp = sA - sB;
    }
    if (state.secondarySortDir === "desc") cmp = -cmp;
  }
  return cmp;
}

function updateTableDisplay(tableId) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  if (!tbody) return;

  const scrollY = window.scrollY;

  const state = tableState[tableId];
  if (!state.data || state.data.length === 0) { tbody.innerHTML = ""; return; }

  // Reset group-header tracker for rolling-table before each render pass
  if (state._resetGroup) state._resetGroup();

  const showAll = document.getElementById("show-all-items")?.checked;
  // A typed query is an explicit request for THOSE items, so it has to be read
  // BEFORE the gate below rather than after the render: applyTableSearchFilter
  // (js/table-search.js) only ever hides painted rows, so a row this filter
  // drops can never be searched back into view. See js/table-search-reveal.js.
  const revealTerms = (typeof tableSearchTerms === "function")
    ? tableSearchTerms(tableId)
    : [];
  const revealsRow = (row) => (typeof rowRevealedBySearch === "function")
    && rowRevealedBySearch(row, tableId, revealTerms);
  let profitableRows = showAll
    ? state.data.slice()
    : state.data.filter(
        (row) =>
          // A row the search box names by id or item name is shown whatever its
          // margin or missing prices — the planner draws a no-data row with
          // editable price cells, which is exactly what the user needs to see.
          revealsRow(row) ||
          // Over-MAX_MARGIN_PERCENT routes (see isSuspectMargin) are bad market
          // data far more often than a real 6x play — but they are MARKED, not
          // hidden. Hiding was wrong twice over: the row disappeared with
          // nothing left to click to correct the stale listing behind it, and an
          // item that vanishes reads as missing data rather than as a warning.
          // The ⚠ badge on the margin cell (suspectMarginBadge) carries it now,
          // so the gate below judges the row on its margin alone.
          (tableId === "volume-table" ||
          tableId === "faction-spending-table" ||
          // Top-10 board rows are pre-curated (already ranked, already
          // positive) and use a flat marginPct field, not marginInfo. Always
          // show them.
          tableId === "joined-summary-table" ||
          tableId === "joined-focus-table" ||
          tableId === "bm-board-table" ||
          // Gathering rows have no buy→sell margin — show any with market
          // data (no-data rows reappear under "Show All").
          (tableId === "gathering-table" && row.sellPrice > 0) ||
          // Journal Filling rows use silver/fame, not marginInfo — show any
          // priced, profitable journal (others return under "Show All").
          (tableId === "journal-filling-table" && row.priced && row.journalMargin > 0) ||
          // Crafting Planner rows use combinedProfit, not marginInfo — show any
          // priced, profitable craft (no-data + losses return under "Show All").
          (tableId === "craft-planner-table" && !row.noData && row.combinedProfit >= 0) ||
          // Skins are illiquid collectibles — show any skin with a market
          // listing (even a single city / zero volume); no-data rows return
          // under Show All.
          (tableId === "skins-trading-table" && row.hasData) ||
          // Building Costs is a cost board with no margin at all — show every
          // fully priced building (unpriced ones return under "Show All").
          (tableId === "buildings-table" && row.hasData) ||
          // A Flipping enchant row only exists because the user expanded its
          // base or picked its level (js/flip-enchant-variants.js), so keep it
          // even unpriced — otherwise the reveal reads as a broken toggle. The
          // flag is set per ROW, not sniffed from the id, so the resource
          // _LEVELn@n rows keep answering to the normal no-data rule.
          (tableId === "flipping-table" && row.enchantVariant) ||
          // A Flipping row whose only reading is one-sided — a Black Market bid
          // with nobody asking — routes at no quality and so carries the -1
          // no-route margin. It still has a price to show, in the quality
          // ladder (js/flip-quality-breakdown.js), and dropping it here is what
          // hid every captured Black Market bid behind a bare "no data" row.
          (tableId === "flipping-table" && row.byQuality && row.byQuality.length > 0) ||
          row.hasOverride ||
          row.hasNoFragData ||
          row.hasNoArtData ||
          (row.marginInfo && row.marginInfo.margin >= 0) ||
          // Always keep variants of expanded craft/consumable/craft-planner
          // items (even with no data) so the user can review every enchant level.
          // Also keep variants an active enchant picker is asking to show, so
          // filtering to .1–.4 surfaces them without the base being expanded.
          (COLLAPSE_VARIANT_TABLES.has(tableId) &&
            isEnchantVariantRow(row) &&
            (expandedCraftItemsFor(tableId).has(row.item.id.replace(/@\d+$/, "")) ||
              variantMatchesEnchantFilter(row.item.id, tableId)))),
      );

  // Crafting + Consumables + Craft-Planner tables: hide enchant variants unless
  // their base item is expanded IN THIS TABLE (expandedCraftItemsFor), so one
  // toggle handler works for every table without opening the others.
  if (COLLAPSE_VARIANT_TABLES.has(tableId)) {
    profitableRows = profitableRows.filter((row) => {
      const itemId = row.item?.id || "";
      if (!isEnchantVariantRow(row)) return true;
      const baseId = itemId.replace(/@\d+$/, "");
      // Show a variant when its base is expanded OR the enchant picker selects
      // its level — the latter lets .1–.4 filtering work without expanding.
      return expandedCraftItemsFor(tableId).has(baseId) || variantMatchesEnchantFilter(itemId, tableId);
    });
  }

  if (tableId === "rolling-table") {
    // Preserve group structure (cat → tier → rollType); sort within groups by name or margin
    const rtOrder = ["Rune", "Soul", "Relic", "Avalonian", "Crystal", "Dragon"];
    const catOrd = ["Any", "Warrior", "Mage", "Hunter", "Exchange"];
    profitableRows.sort((a, b) => {
      const co = catOrd.indexOf(a.cat) - catOrd.indexOf(b.cat);
      if (co !== 0) return co;
      if (a.tier !== b.tier) return a.tier - b.tier;
      const ro = rtOrder.indexOf(a.rollType) - rtOrder.indexOf(b.rollType);
      if (ro !== 0) return ro;
      if (state.sortCol === "name") {
        return state.sortDir === "asc"
          ? a.artName.localeCompare(b.artName)
          : b.artName.localeCompare(a.artName);
      }
      return b.margin - a.margin;
    });
  } else {
    // Normal sort — also used as fallback when _suppressSort is active but
    // the row set changed (new rows appeared / old rows disappeared).
    let preserved = false;
    if (_suppressSort && state._sortedKeys) {
      const keyOrder = new Map(state._sortedKeys.map((k, i) => [k, i]));
      // Keep previously-shown rows in their cached display order so the row the
      // user is editing doesn't teleport (the whole point of _suppressSort).
      // Rows that appeared THIS render — e.g. an override priced a route into
      // existence — are spliced into their correct sorted slot instead of being
      // dumped at the bottom. Appending them ignored their sort value, so a
      // high-profit override row landed below low-profit rows and the active
      // sort looked broken. See tests/suppress-sort-new-rows.
      const known = [];
      const fresh = [];
      for (const r of profitableRows) {
        (keyOrder.has(getRowKey(r, tableId)) ? known : fresh).push(r);
      }
      known.sort(
        (a, b) =>
          keyOrder.get(getRowKey(a, tableId)) - keyOrder.get(getRowKey(b, tableId)),
      );
      if (fresh.length > 0) {
        // Order fresh rows among themselves, then insert each before the first
        // known row it out-ranks under the active sort.
        fresh.sort((a, b) => compareRows(a, b, state, tableId));
        for (const nr of fresh) {
          let i = 0;
          while (i < known.length && compareRows(known[i], nr, state, tableId) <= 0) i++;
          known.splice(i, 0, nr);
        }
      }
      profitableRows = known;
      preserved = true;
    }
    if (!preserved) {
      profitableRows.sort((a, b) => compareRows(a, b, state, tableId));
    }
  }

  // Crafting + Consumables tables: group expanded variant rows directly below
  // their base item so .1/.2/.3 read as a children of the .0 base instead of
  // floating to the top by margin. Sort variants by enchant level ascending so
  // they read .1 → .3 under each base.
  //
  // Crafting groups by (baseId, craftCity) — both are always set for gear.
  // Consumables group by (baseId, section) instead because no-data variants
  // don't carry craftCity, only the section they belong to (royal/caerleon).
  // Flipping also nests rows nobody expanded: js/flip-auto-reveal.js puts a
  // profitable .1-.4 on the board by itself, and gating the nesting on
  // the table's expand set alone would scatter those children across the board by
  // margin, orphaned from the base they belong to.
  const hasFlipVariantRows = tableId === "flipping-table"
    && profitableRows.some((row) => row.enchantVariant);
  if ((tableId === "crafting-table" || tableId === "consumable-table"
       || tableId === "craft-planner-table" || tableId === "flipping-table")
      && (expandedCraftItemsFor(tableId).size > 0 || hasFlipVariantRows)) {
    const groupKey = (row) => {
      const base = (row.item?.id || "").replace(/@\d+$/, "");
      // Consumables + craft-planner dedupe/group by section (no-data variants
      // carry section, not craftCity); crafting groups by craftCity. Flipping
      // splits royal / Caerleon the same way, and carries the base id on the
      // row because stripping @n off a resource variant (T4_WOOD_LEVEL1@1)
      // names a base that does not exist.
      const dim = (tableId === "crafting-table") ? (row.craftCity || "") : (row.section || "");
      return (tableId === "flipping-table" ? (row.baseId || base) : base) + "|" + dim;
    };
    // What counts as a child row. Flipping asks the ROW, not the id: its
    // resource _LEVELn@n rows are top-level entries with no base to nest under,
    // and treating them as variants would exile them to the orphan tail.
    const isVariantRow = (row) => (tableId === "flipping-table")
      ? !!row.enchantVariant
      : isEnchantVariantRow(row);
    const variants = [];
    const bases = [];
    for (const row of profitableRows) {
      if (isVariantRow(row)) variants.push(row);
      else bases.push(row);
    }
    if (variants.length > 0) {
      const variantsByBase = new Map();
      for (const v of variants) {
        const key = groupKey(v);
        if (!variantsByBase.has(key)) variantsByBase.set(key, []);
        variantsByBase.get(key).push(v);
      }
      // Within each base group, order by enchant level ascending so children
      // read 1 → 2 → 3 under the parent base.
      for (const list of variantsByBase.values()) {
        list.sort((a, b) => {
          const la = parseInt((a.item.id.match(/@(\d+)$/) || [0, 0])[1], 10);
          const lb = parseInt((b.item.id.match(/@(\d+)$/) || [0, 0])[1], 10);
          return la - lb;
        });
      }
      profitableRows = [];
      const consumed = new Set();
      for (const row of bases) {
        profitableRows.push(row);
        const key = groupKey(row);
        const vs = variantsByBase.get(key);
        if (vs && !consumed.has(key)) {
          profitableRows.push(...vs);
          consumed.add(key);
        }
      }
      // Append any orphan variants whose base row was filtered out (e.g.,
      // base unprofitable). Without this, expanding a row whose base has
      // negative margin would silently drop the variants the user wanted.
      for (const [key, vs] of variantsByBase.entries()) {
        if (!consumed.has(key)) profitableRows.push(...vs);
      }
    }
  }

  // Volume table: apply its search box + pickers on top of the sort (the reader
  // of those controls lives in js/render-volume.js). Filtering here rather than
  // in renderVolumeTable keeps state.data the full row set, so "Refresh Volume"
  // still refetches every visible item and clearing the box restores all rows
  // without a rescan.
  if (tableId === "volume-table" && typeof applyVolumeTableFilters === "function") {
    profitableRows = applyVolumeTableFilters(profitableRows);
  }

  // Cache sorted row keys for order preservation on next override re-render
  state._sortedKeys = profitableRows.map(r => getRowKey(r, tableId));

  const shouldSplit = !isBlackRedZoneEnabled()
    && tableId !== "volume-table"
    && tableId !== "joined-summary-table"
    && tableId !== "joined-focus-table"
    && tableId !== "bm-board-table";

  // Pre-build index map to avoid O(n²) indexOf lookups during rendering
  const indexMap = new Map(state.data.map((r, i) => [r, i]));
  const safeFormat = (r) => { try { return state.formatter(r, indexMap.get(r) ?? 0); } catch { return ""; } };

  // Lock tbody height before replacing innerHTML to prevent scroll jump
  tbody.style.minHeight = tbody.offsetHeight + "px";

  if (shouldSplit) {
    const royalRows = profitableRows.filter(
      (r) => !r.section || r.section === "royal",
    );
    const caerleonRows = profitableRows.filter((r) => r.section === "caerleon");

    if (royalRows.length === 0 && caerleonRows.length === 0) {
      const colCount = document.querySelectorAll(`#${tableId} th`).length;
      tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center; color:#9ca3af; font-style:italic; padding: 2rem;"><span class="row-fluid">${tx("No profitable loops found right now.", "r_no_profitable_loops")}</span></td></tr>`;
      tbody.style.minHeight = "";
      window.scrollTo(0, scrollY);
      return;
    }

    const colCount = document.querySelectorAll(`#${tableId} th`).length;
    let html = royalRows.map(safeFormat).join("");
    if (caerleonRows.length > 0) {
      if (state._resetGroup) state._resetGroup();
      html += `<tr class="section-divider"><td colspan="${colCount}"><span class="row-fluid row-note">&#x2694; ${tx("Caerleon &amp; Black Market Routes", "r_caerleon_bm_routes")}</span></td></tr>`;
      html += caerleonRows.map(safeFormat).join("");
    }
    tbody.innerHTML = html;
  } else {
    if (profitableRows.length === 0) {
      const colCount = document.querySelectorAll(`#${tableId} th`).length;
      const emptyMsg = tableId === "volume-table"
        ? tx("No items match your filter.", "r_no_items_match_filter")
        : tx("No profitable loops found right now.", "r_no_profitable_loops");
      tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center; color:#9ca3af; font-style:italic; padding: 2rem;"><span class="row-fluid">${emptyMsg}</span></td></tr>`;
      tbody.style.minHeight = "";
      window.scrollTo(0, scrollY);
      return;
    }

    tbody.innerHTML = profitableRows.map(safeFormat).join("");
  }
  if (state._postRender) state._postRender();

  // Ensure the header styling is completely up to date (syncs on first render too)
  // A sub-key inside a header (data-sort-sub) carries its own arrow.
  const header = document.querySelector(
    `#${tableId} th[data-sort="${state.sortCol}"], #${tableId} [data-sort-sub="${state.sortCol}"]`,
  );
  if (header) {
    document
      .querySelectorAll(`#${tableId} th, #${tableId} [data-sort-sub]`)
      .forEach((t) => t.classList.remove("sort-asc", "sort-desc"));
    header.classList.add(`sort-${state.sortDir}`);
  }
  // Re-apply this table's free-text search box (if any) to the freshly rendered
  // rows. No-op for tables without one (volume keeps its own object filter).
  if (typeof applyTableSearchFilter === "function") applyTableSearchFilter(tableId);
  tbody.style.minHeight = "";
  window.scrollTo(0, scrollY);
}

