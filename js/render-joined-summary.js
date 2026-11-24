/**
 * The two Top-10 boards at the top of the page.
 *
 *   #joined-summary-table  Top 10 Pure Profit        — silver per play
 *   #joined-focus-table    Top 10 Profit / 10k Focus — silver per focus bar
 *
 * Both project over every source profit table's `tableState[<id>].data` cache
 * (js/joined-summary-sources.js says which field means what per table),
 * normalize the winners into one flat row shape, and rank them GLOBALLY: the
 * same category may hold several rows, or none.
 *
 * This replaced a single board that showed one row per table ranked by
 * `pureProfit × dailyVol`. Throughput survives as an informational column on
 * the profit board; it is no longer what decides the order.
 *
 * Ranking is deliberately two-stage. Normalizing every source row would build
 * tens of thousands of objects on every redraw — Flipping alone caches ~2900
 * items, and this runs on each captured price patch. So each table is ranked on
 * its OWN rows first and only its top 10 are normalized. That is exact: a
 * global top 10 can never hold more than 10 rows from one table.
 *
 * No API calls of its own — cached source data only. Refreshes whenever
 * renderAllTables() runs, which is the last call after every other source
 * render, so the caches are always populated first.
 *
 * Per-table scan buttons do NOT trigger renderAllTables, so the boards stay
 * partially stale until the main "Scan Market Now" or any setting toggle.
 * Acceptable tradeoff per project design notes.
 */

const JOINED_TOP_N = 10;

// Column counts, matching the <thead>s in index.html. The detail row spans the
// whole board, and the two boards are not the same width.
const JOINED_PROFIT_COLS = 10;
const JOINED_FOCUS_COLS = 11;

// In the browser these files are plain scripts sharing one global scope and
// JOINED_SOURCES / _jsCategoryLabel are simply there. Under Node (the tests)
// each file is its own module, so they have to be asked for by name.
const _jsSources = (typeof require !== "undefined")
  ? require("./joined-summary-sources.js")
  : null;
const _jsDetail = (typeof require !== "undefined")
  ? require("./joined-summary-detail.js")
  : null;
function joinedSources() {
  return _jsSources ? _jsSources.JOINED_SOURCES : JOINED_SOURCES;
}
function joinedCategoryText(category) {
  if (_jsSources) return _jsSources._jsCategoryLabel(category);
  return typeof _jsCategoryLabel === "function" ? _jsCategoryLabel(category) : category;
}
/** The detail-panel helpers (js/joined-summary-detail.js), or null under a partial load. */
function joinedDetail() {
  if (_jsDetail) return _jsDetail;
  return (typeof jbDetailKey === "function")
    ? { jbDetailKey, jbDetailToggle, jbDetailRowHtml }
    : null;
}

// ─── Pickers ────────────────────────────────────────────────────────────────

/**
 * The `n` highest-scoring rows, best first. Rows scoring 0 or less are dropped
 * — the boards are opportunity lists, not a census.
 * Stable: equal scores keep their input order.
 */
function pickTopNBy(rows, score, n = JOINED_TOP_N) {
  const scored = [];
  (rows || []).forEach((r) => {
    if (!r) return;
    const value = score(r);
    if (!Number.isFinite(value) || value <= 0) return;
    scored.push({ row: r, value, at: scored.length });
  });
  scored.sort((a, b) => (b.value - a.value) || (a.at - b.at));
  return scored.slice(0, n);
}

// Kept for the old one-row-per-table behaviour the extractor tests still pin.
function pickTopByThroughput(rows, getProfit, getVol) {
  let best = null;
  for (const r of rows) {
    if (!r) continue;
    const profit = getProfit(r);
    const vol = getVol(r);
    if (!Number.isFinite(profit) || profit <= 0) continue;
    if (!Number.isFinite(vol) || vol <= 0) continue;
    const score = profit * vol;
    if (best === null || score > best._score ||
        (score === best._score && profit > best._profit)) {
      best = { row: r, _score: score, _profit: profit, _vol: vol };
    }
  }
  return best;
}

function pickTopByProfit(rows, getProfit, syntheticVol) {
  let best = null;
  for (const r of rows) {
    if (!r) continue;
    const profit = getProfit(r);
    if (!Number.isFinite(profit) || profit <= 0) continue;
    if (best === null || profit > best._profit) {
      best = { row: r, _score: profit * syntheticVol, _profit: profit, _vol: syntheticVol };
    }
  }
  return best;
}

// ─── Board assembly ─────────────────────────────────────────────────────────

/**
 * Board identity for one normalized row.
 *
 * getRowKey returns "" for tables whose rows carry no id (faction spending),
 * and with ten rows per table that would collapse them onto one key — the jump
 * link would land on the wrong row and the sort cache would shuffle them. The
 * name+route fallback is unique wherever the source key is not.
 */
function joinedRowKey(row) {
  return `${row.tableId}|${row.rowKey || `${row.itemName}|${row.routeLabel}`}`;
}

/**
 * Collect one board: rank each feeder's own rows, normalize its top N, merge,
 * dedupe, and take the global top N.
 *
 * @param {(src:object) => ((row:object) => number)|null} metricFor
 *   the score for this board given a source descriptor, or null to skip the
 *   table entirely (the focus board skips every table that spends no focus).
 * @param {(row:object, src:object, sourceRow:object) => object} [decorate]
 *   extra fields the board's own columns need.
 * @param {(row:object, src:object) => boolean} [extraFilter]
 *   an additional gate on the feeder's OWN rows. It runs before ranking on
 *   purpose: the Black Market board (js/render-bm-board.js) needs the best BM
 *   plays, and a BM play that is not in its own table's top ten would never
 *   reach the board if the filtering happened after.
 * @param {{perSource?:number, global?:number}} [limits]
 *   how many rows a feeder may contribute and how many the board holds. Both
 *   default to ten, which is what makes the two boards Top-10s. The Black
 *   Market board passes Infinity for both: it is filtered to one destination
 *   already, so capping it would hide real plays rather than curate them.
 *   Rows scoring zero or less are dropped either way (pickTopNBy) — an
 *   uncapped board is every PROFITABLE play, not a census.
 */
function collectJoinedBoard(metricFor, decorate, extraFilter, limits = {}) {
  const perSource = limits.perSource ?? JOINED_TOP_N;
  const globalLimit = limits.global ?? JOINED_TOP_N;
  if (typeof tableState === "undefined") return [];
  const candidates = [];
  for (const [tableId, src] of Object.entries(joinedSources())) {
    const srcRows = tableState[tableId]?.data;
    if (!Array.isArray(srcRows) || srcRows.length === 0) continue;
    const metric = metricFor(src);
    if (!metric) continue;
    try {
      const rows = srcRows.filter((r) => r
        && (!src.filter || src.filter(r))
        && (!extraFilter || extraFilter(r, src)));
      pickTopNBy(rows, metric, perSource).forEach(({ row, value }) => {
        const out = src.normalize(row);
        out.throughput = (out.pureProfit || 0) * (out.dailyVol || 0);
        candidates.push(decorate ? decorate(out, src, row, value) : out);
      });
    } catch (e) {
      console.error(`joined-summary source failed for ${tableId}:`, e);
    }
  }

  // The royal / Caerleon split renders one source item as two rows; on a board
  // that no longer splits by section (sorting.js) both would show, one above
  // the other, saying nearly the same thing. Keep the better.
  const byKey = new Map();
  candidates.forEach((row) => {
    const key = joinedRowKey(row);
    const held = byKey.get(key);
    if (!held || (row._score || 0) > (held._score || 0)) byKey.set(key, row);
  });

  const ranked = [...byKey.values()]
    .sort((a, b) => (b._score || 0) - (a._score || 0));
  return Number.isFinite(globalLimit) ? ranked.slice(0, globalLimit) : ranked;
}

/** Board A: every feeder, ranked by pure silver profit. */
function collectTopProfitRows() {
  return collectJoinedBoard(
    (src) => src.profit,
    (out, src, row) => {
      out._score = out.pureProfit || 0;
      return out;
    },
  );
}

/**
 * Board B: the five focus-spending tables, ranked by silver per 10k focus.
 * A table whose `focus` reader returns null for every row contributes nothing
 * — see the denominator note in js/joined-summary-sources.js.
 */
function collectTopFocusRows() {
  return collectJoinedBoard(
    (src) => (src.focus ? (r) => (src.focus(r)?.per10k ?? 0) : null),
    (out, src, row) => {
      const focus = src.focus(row) || { cost: 0, per10k: 0 };
      out.focusCost = focus.cost;
      out.profitPer10kFocus = focus.per10k;
      // The per-10k figure multiplies the FOCUS-ON profit (every feeder
      // publishes it as `profitFocusOn`), whatever the Use Focus box says. The
      // board's Profit cell and its "profit × plays" tooltip have to quote that
      // same operand — `marginInfo.profit` follows the checkbox, and with the
      // box off it paired a focus-off profit with a focus-on per-10k figure.
      if (Number.isFinite(row.profitFocusOn)) out.pureProfit = row.profitFocusOn;
      out._score = focus.per10k;
      return out;
    },
  );
}

// ─── Row formatters ─────────────────────────────────────────────────────────

/**
 * The Input Cost cell.
 *
 * For ten of the twelve feeders this number is an AGGREGATE — every material's
 * count × unit price, plus the setup, station, recipe and haul fees. There is no
 * single per-unit price to write back, so it uses the shared read-only cell and
 * points at where a price IS pinnable (js/app.js aggregateCostTd). Flipping is
 * the exception: its input cost is literally `r.buy.price`, one unit, one city,
 * so it gets the same side-specific editor its own table renders
 * (render-flipping.js:115).
 */
function joinedInputCell(row) {
  if (row.buyItemId && row.inputCost > 0 && typeof priceTd === "function") {
    return priceTd(row.inputCost, row.buyItemId, row.buyCity, "buy",
      "silver-val", false, null, true);
  }
  if (row.inputCost > 0) {
    return typeof aggregateCostTd === "function"
      ? aggregateCostTd(row.inputCost, "silver-val")
      : `<td class="silver-val">${formatSilver(row.inputCost)}</td>`;
  }
  // FP / Favor rows spend a non-silver currency with no market inputs — the
  // parenthetical names WHICH one, so a Favor row is not misread as FP.
  const gated = row.note === "FP-gated" ? "(FP)"
    : row.note === "Favor-gated" ? "(Favor)"
    : "—";
  return `<td style="color:#6b7280;font-style:italic">${gated}</td>`;
}

/**
 * The Best Sell Price cell — click-to-edit wherever the number is a real
 * per-unit market price. `sellItemId` is null when it is not (a Laborers row
 * outside trophy mode prices a multi-item payload per cycle), and that is the
 * whole opt-out: no special case here, and no override under a key nothing reads.
 *
 * Deliberately NOT gated on `sellPrice > 0`: priceTd renders "no data — click to
 * set" at price 0 and stays editable, so the price test only ever removed the
 * editor in the one case it exists for. A missing sell city falls back to the
 * row's own buy city, then to the first sell city, so the editor never opens on
 * `data-city="null"`.
 */
function joinedSellCell(row) {
  if (row.sellItemId && typeof priceTd === "function") {
    // showCity mirrors what the feeder renders: Enchanting, Transmute and
    // Rerolling carry the sell city in the cell because their Source column
    // names a different one.
    const showCity = row.tableId === "enchanting-table"
      || row.tableId === "transmute-table"
      || row.tableId === "rerolling-table";
    const city = row.sellCity || row.buyCity
      || (typeof SELL_CITIES !== "undefined" && SELL_CITIES[0]) || "";
    // `sellNote` (optional HTML) prints under the number — the Black Market
    // board's per-quality bid ladder (js/bm-quality-ladder.js) is the one
    // producer; the Top-10 boards and every feeder leave it unset.
    return priceTd(row.sellPrice, row.sellItemId, city, "sell",
      "silver-val", showCity, row.sellQuality ?? null, !!row.sellSideOverride,
      row.sellNote || "");
  }
  return `<td class="silver-val">${formatSilver(row.sellPrice)}</td>`;
}

/** The cells both boards share, in column order, as one HTML string. */
function joinedCommonCells(row, profitClass, detailKey) {
  const marginCell = row.marginPct != null
    ? `<td class="${profitClass}">${row.marginPct.toFixed(2)}%</td>`
    : `<td style="color:#6b7280;font-style:italic">—</td>`;

  const detail = joinedDetail();
  const toggle = detail ? `${detail.jbDetailToggle(detailKey)} ` : "";

  return `
        <td>${toggle}${row.itemName}</td>
        <td><small>${row.routeLabel}</small></td>
        ${joinedInputCell(row)}
        ${joinedSellCell(row)}
        ${marginCell}`;
}

function joinedCategoryCell(row, tipEn, tipSlug) {
  const label = joinedCategoryText(row.category);
  const tip = tx(tipEn, tipSlug).split("{category}").join(label);
  return `<td><span class="cat-badge cat-${row.tableId}" title="${tip}">${label}</span></td>`;
}

function joinedVolCell(row) {
  return row.volIsUnknown
    ? `<td style="color:#6b7280;font-style:italic">—</td>`
    : `<td>${(row.dailyVol || 0).toLocaleString()}</td>`;
}

// data-item-id is the SECONDARY locator: Faction Spending's getRowKey returns ""
// (the reason joinedRowKey has a name+route fallback), so the row key alone can
// never find those rows in their own table. See js/joined-summary-jump.js.
//
// The destination is the row's own `jumpTableId`, not the table it was collected
// from — a crafting play goes to the Craft Planner, where its materials can be
// refined or transmuted rather than merely priced (js/joined-summary-sources.js).
// `data-fallback-table` is where the click lands when the primary holds no row
// for the item.
function joinedJumpCell(row) {
  const attr = (v) => String(v == null ? "" : v).replace(/"/g, "&quot;");
  const target = row.jumpTableId || row.tableId;
  const key = row.jumpRowKey == null ? (row.rowKey || "") : row.jumpRowKey;
  const fallback = row.jumpFallbackTableId
    ? ` data-fallback-table="${attr(row.jumpFallbackTableId)}"`
    : "";
  return `<td><a class="joined-jump" href="#${attr(target)}" data-target-table="${attr(target)}" data-row-key="${attr(key)}" data-item-id="${attr(row.sellItemId)}"${fallback}>${tx("Jump to", "r_jump_to")} →</a></td>`;
}

function joinedProfitClass(row) {
  return row.marginPct != null
    ? getProfitClass(row.marginPct)
    : (row.pureProfit > 0 ? "profit-high" : "profit-low");
}

/** The expanded source row under a board row, or "" — js/joined-summary-detail.js. */
function joinedDetailRow(boardTableId, row, detailKey, colSpan) {
  const detail = joinedDetail();
  return detail ? detail.jbDetailRowHtml(row, detailKey, colSpan) : "";
}

/** Board A row: 10 columns. */
function formatJoinedRow(row, _rowIdx) {
  const profitClass = joinedProfitClass(row);
  const throughputDisplay = row.volIsUnknown
    ? `${formatSilver(row.throughput)} <small style="color:#9ca3af;font-style:italic" title="${row.note || ""}">(${row.note || "vol unknown"})</small>`
    : formatSilver(row.throughput);
  const detail = joinedDetail();
  const detailKey = detail ? detail.jbDetailKey("joined-summary-table", row) : "";

  return `
      <tr data-category="${row.category}">
        ${joinedCategoryCell(row, "One of the ten most profitable {category} plays on the board. Jump opens it in its own table.", "r_tip_top_profit")}
        ${joinedCommonCells(row, profitClass, detailKey)}
        <td class="silver-val ${profitClass}"><b>${formatSilver(row.pureProfit)}</b></td>
        <td class="silver-val ${profitClass}">${throughputDisplay}</td>
        ${joinedVolCell(row)}
        ${joinedJumpCell(row)}
      </tr>${joinedDetailRow("joined-summary-table", row, detailKey, JOINED_PROFIT_COLS)}`;
}

/** Board B row: 11 columns — Throughput out, Focus Cost + Profit/10k in. */
function formatJoinedFocusRow(row, _rowIdx) {
  const profitClass = joinedProfitClass(row);
  const focusTip = tx(
    "{profit} profit × {plays} plays ({focus} focus each)", "r_tip_focus_math",
  )
    .replace("{profit}", formatSilver(row.pureProfit))
    .replace("{plays}", (typeof formatBarCrafts === "function" ? formatBarCrafts((typeof focusBarCrafts === "function" ? focusBarCrafts(row.focusCost) : Math.floor(10000 / row.focusCost))) : (typeof focusBarCrafts === "function" ? focusBarCrafts(row.focusCost) : Math.floor(10000 / row.focusCost)).toLocaleString()))
    .replace("{focus}", formatFocusCost(row.focusCost));
  const detail = joinedDetail();
  const detailKey = detail ? detail.jbDetailKey("joined-focus-table", row) : "";

  return `
      <tr data-category="${row.category}">
        ${joinedCategoryCell(row, "One of the ten best {category} uses of a focus bar. Jump opens it in its own table.", "r_tip_top_focus")}
        ${joinedCommonCells(row, profitClass, detailKey)}
        <td class="silver-val ${profitClass}">${formatSilver(row.pureProfit)}</td>
        <td>${formatFocusCost(row.focusCost)}</td>
        <td class="silver-val ${profitClass}" title="${focusTip}"><b>${formatSilver(row.profitPer10kFocus)}</b></td>
        ${joinedVolCell(row)}
        ${joinedJumpCell(row)}
      </tr>${joinedDetailRow("joined-focus-table", row, detailKey, JOINED_FOCUS_COLS)}`;
}

// ─── Top-level renderers ────────────────────────────────────────────────────

function renderJoinedSummaryTable() {
  if (typeof tableState === "undefined") return;
  if (typeof renderTableData !== "function") return;
  renderTableData("joined-summary-table", collectTopProfitRows(), formatJoinedRow);
}

function renderJoinedFocusTable() {
  if (typeof tableState === "undefined") return;
  if (typeof renderTableData !== "function") return;
  renderTableData("joined-focus-table", collectTopFocusRows(), formatJoinedFocusRow);
}

// ─── Jump-to-row click handler (idempotent module-init) ─────────────────────
(function _initJoinedJump() {
  if (typeof document === "undefined") return;
  if (document._joinedJumpInit) return;
  document._joinedJumpInit = true;
  document.addEventListener("click", (e) => {
    const link = e.target.closest("a.joined-jump");
    if (!link) return;
    e.preventDefault();
    const tableId = link.getAttribute("data-target-table");
    const rowKey = link.getAttribute("data-row-key");
    const itemId = link.getAttribute("data-item-id");
    const fallbackTableId = link.getAttribute("data-fallback-table");
    if (!tableId) return;

    const tbl = document.getElementById(tableId);
    if (!tbl) return;

    // Unfold the band, expand the table, reveal @n variants, clear the filter —
    // in that order, because each step changes what is in the DOM. The row
    // lookup happens last, inside jbJumpTo (js/joined-summary-jump.js).
    //
    // Two destinations, tried in order: the row's own target, then the table it
    // was collected from. A crafting play aims at the Craft Planner, which does
    // not hold every crafted item and whose own city picks can hide the one it
    // does — and a jump must never reset a filter the user set, so it lands on
    // the Crafting table instead of fighting it.
    const targets = [{ tableId, rowKey, itemId }];
    if (fallbackTableId && fallbackTableId !== tableId) {
      targets.push({ tableId: fallbackTableId, rowKey: "", itemId });
    }

    const land = (target, landedTable) => {
      // One timer, after the reveals: a table that was just expanded lays out on
      // the next frame, so scrolling immediately lands on the wrong offset.
      setTimeout(() => {
        (target || landedTable || tbl).scrollIntoView({ behavior: "smooth", block: "center" });
        if (target) {
          target.style.outline = "2px solid #5e9e78";
          setTimeout(() => { target.style.outline = ""; }, 1800);
        }
      }, 60);
    };

    if (typeof jbJumpToFirst !== "function") { land(null, tbl); return; }

    // The primary alone first. The Craft Planner paints in chunks and fetches
    // its enchanted prices asynchronously, so a row that WILL exist may not be
    // in the DOM yet — falling through to the fallback immediately would send a
    // perfectly good jump to the wrong table. Two short re-looks cover the paint
    // and the fetch; only then does the fallback get its turn.
    const primary = jbJumpToFirst([targets[0]]);
    if (primary.target || targets.length === 1) {
      land(primary.target, document.getElementById(primary.tableId) || tbl);
      return;
    }

    let tries = 0;
    const retry = () => {
      tries++;
      const found = (typeof jbFindTarget === "function")
        ? jbFindTarget(tableId, rowKey, itemId, { doc: document })
        : null;
      if (found) { land(found, tbl); return; }
      if (tries < 2) { setTimeout(retry, 250); return; }
      const settled = jbJumpToFirst(targets);
      land(settled.target, document.getElementById(settled.tableId) || tbl);
    };
    setTimeout(retry, 150);
  });
})();

// ─── Test exports ───────────────────────────────────────────────────────────
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    JOINED_TOP_N,
    pickTopNBy,
    pickTopByThroughput,
    pickTopByProfit,
    joinedRowKey,
    collectJoinedBoard,
    collectTopProfitRows,
    collectTopFocusRows,
    formatJoinedRow,
    formatJoinedFocusRow,
    renderJoinedSummaryTable,
    renderJoinedFocusTable,
    joinedCommonCells,
    joinedCategoryCell,
    joinedVolCell,
    joinedJumpCell,
    joinedProfitClass,
    JOINED_PROFIT_COLS,
    JOINED_FOCUS_COLS,
    joinedDetailRow,
    joinedInputCell,
    joinedSellCell,
  };
}
