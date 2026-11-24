/**
 * The Black Market board: the best plays that END at the Black Market.
 *
 *   #bm-board-table   Black Market Opportunities — silver per play
 *
 * The Black Market is not a city you can buy in (isInvalidCrossRoute,
 * js/utils.js) — its book is one-way, and every table that reaches it reaches it
 * on the SELL leg. So "a Black Market opportunity" is exactly a play whose sell
 * city is the Black Market, wherever the goods came from: a flip, a craft, a
 * refine, a batch of potions.
 *
 * It is the same collector as the two Top-10 boards (js/render-joined-summary.js)
 * with one gate added, and the gate has to run BEFORE each feeder is ranked:
 * a Black Market play that is not in the top ten of its own table would
 * otherwise never be a candidate here. That is what `collectJoinedBoard`'s
 * `extraFilter` is for, and why each source names its sell-city field in
 * js/joined-summary-sources.js.
 *
 * Unlike the two Top-10s it is NOT capped. Those boards curate — ten plays out
 * of every table in the app. This one is already narrowed to a single
 * destination, so a cap would hide real Black Market plays rather than rank
 * them, and the question it answers is "what can I sell there", not "what are
 * the ten best things I could do today". Every PROFITABLE play is listed; a
 * play scoring zero or less is still dropped.
 *
 * One column is not on the other boards: the age of the Black Market price
 * itself. The board exists because a Black Market number can be quietly wrong —
 * the reported case was a row quoting a bid the player had personally sold into
 * — so the freshness of the number a play depends on is a column here, not a
 * detail hidden inside a cell.
 *
 * The second is Profit/Ox, borrowed from the Flipping table: every play on this
 * board ends somewhere you have to HAUL to, so silver per ox load ranks them
 * the way loading the ox actually does. See bmBoardOxLoad.
 *
 * Quality is on the board twice. The Item cell wears the Qn chip for the two
 * feeders that price one (Flipping, Quality Rerolling — flipQualityChip,
 * js/render-flipping.js); and the Bid cell carries a per-quality ladder
 * (js/bm-quality-ladder.js) for every feeder that does not — Crafting,
 * Enchanting and the rest price the Normal book alone, and the ladder is
 * where the merchant's premium for the higher qualities shows.
 *
 * Loaded after js/render-joined-summary.js, which it borrows every shared cell
 * from. Depends on js/price-freshness.js and, when the capture is running,
 * js/own-orders-view.js.
 */

/** The city this board is about. Never a buy city — see the header. */
const BM_BOARD_CITY = "Black Market";

/** Column count, for the detail row's colspan. */
const BM_BOARD_COLS = 12;

// Same bridge as js/render-joined-summary.js: in the browser these files share
// one global scope and every helper is simply there; under Node each file is
// its own module and has to be asked for by name.
const _bmBoard = (typeof require !== "undefined")
  ? require("./render-joined-summary.js")
  : null;
const _bmDetail = (typeof require !== "undefined")
  ? require("./joined-summary-detail.js")
  : null;
const _bmLadder = (typeof require !== "undefined")
  ? require("./bm-quality-ladder.js")
  : null;

/** The cells and the collector both boards already share. */
function bmBoardShared() {
  if (_bmBoard) return _bmBoard;
  return (typeof collectJoinedBoard === "function")
    ? {
      collectJoinedBoard, joinedCategoryCell, joinedInputCell, joinedSellCell,
      joinedVolCell, joinedJumpCell, joinedProfitClass,
    }
    : null;
}

/** The detail-panel helpers, or null under a partial load. */
function bmBoardDetail() {
  if (_bmDetail) return _bmDetail;
  return (typeof jbDetailKey === "function")
    ? { jbDetailKey, jbDetailToggle, jbDetailRowHtml }
    : null;
}

/** The per-quality bid ladder (js/bm-quality-ladder.js), or null. */
function bmBoardLadder() {
  if (_bmLadder) return _bmLadder;
  return (typeof bmQualityNote === "function" || typeof bmProfitQualityNote === "function")
    ? { bmQualityNote, bmProfitQualityNote }
    : null;
}

/** The market entry the Black Market leg of a row was priced from, or null. */
function bmBoardEntry(row) {
  const itemId = row && row.sellItemId;
  if (!itemId) return null;
  const quality = Number(row.sellQuality) || 1;
  if (quality === 1) {
    return (typeof lastMarketData !== "undefined"
      ? lastMarketData?.[itemId]?.[BM_BOARD_CITY] : null) || null;
  }
  return (typeof lastQualityMarketData !== "undefined"
    ? lastQualityMarketData?.[itemId]?.[quality]?.[BM_BOARD_CITY] : null) || null;
}

/**
 * The freshness cell for the Black Market number.
 *
 * Three things it can say, in order of how much they matter:
 *   gone   the book has been read since without this order in it,
 *   yours  it is the player's own standing order,
 *   an age otherwise — the same badge the price cells print.
 *
 * A play whose price is gone or is the player's own is not routed at all any
 * more (js/flip-route.js), so on a live capture this column mostly prints ages;
 * it still names the other two because a feeder that does its own pricing can
 * put one on the board, and a silent one would be the original bug again.
 */
function bmBoardAgeCell(row) {
  const itemId = row && row.sellItemId;
  const quality = Number(row?.sellQuality) || 1;
  const entry = bmBoardEntry(row);
  const t = (en, key) => (typeof tx === "function" ? tx(en, key) : en);
  if (itemId && typeof isOwnMarketPrice === "function"
    && isOwnMarketPrice(itemId, quality, BM_BOARD_CITY, "sell", row.sellPrice)) {
    return `<td style="color:#9e8840">${t("yours", "r_price_yours")}</td>`;
  }
  if (typeof bookEmptySince === "function" && bookEmptySince(entry, "sell")) {
    return `<td style="color:#c96a6a">${t("gone", "r_price_gone")}</td>`;
  }
  const dateStr = typeof priceDateFor === "function" ? priceDateFor(entry, "sell") : null;
  const age = typeof formatPriceAge === "function" ? formatPriceAge(dateStr) : null;
  if (!age) return `<td style="color:#6b7280;font-style:italic">—</td>`;
  return `<td style="color:${age.color}">${age.label}</td>`;
}

/**
 * Profit for one full Transport Ox load of this play's sold item, or null.
 *
 * The same question the Flipping table's Profit/Ox column answers
 * (js/render-flipping.js), asked of a board row: silver per HAUL rather than
 * per play, so a fat margin on something heavy stops reading like a fat margin
 * on something you can move by the hundred. Every play here ends at the Black
 * Market, so every one of them is a haul.
 *
 * Null in two cases, and both print an em dash rather than a number:
 *   - no sell item id — a Laborers cycle sells a MIX, which has no per-unit
 *     weight to divide an ox load by;
 *   - `sellUnits: null` (js/joined-summary-sources.js) — the row's pureProfit
 *     is a per-cycle / per-campaign aggregate. Multiplying THAT by
 *     items-per-load would inflate it by the batch size.
 *
 * getItemWeight (js/travel-cost.js) always answers with kilograms: the
 * extracted items.xml table, then the resource / journal / trophy / artifact
 * schedules, then a gear-class estimate. So no source has to carry a weight.
 */
function bmBoardOxLoad(row) {
  if (!row || !row.sellItemId || !row.sellUnits) return null;
  if (typeof getItemWeight !== "function" || typeof calculateOxLoad !== "function") return null;
  const weight = getItemWeight(row.sellItemId);
  const load = calculateOxLoad((row.pureProfit || 0) / row.sellUnits, weight);
  return load.itemsPerLoad > 0 ? load : null;
}

/** The predicate for "the Black Market deals in this at all", or null. */
function bmBoardTradable() {
  if (typeof isBlackMarketTradable === "function") return isBlackMarketTradable;
  if (typeof require !== "undefined") {
    try { return require("./black-market-items.js").isBlackMarketTradable; }
    catch (e) { /* partial load */ }
  }
  return null;
}

/**
 * Is the thing this play SELLS something the Black Market buys?
 *
 * The merchant's book is the mob loot table read backwards — equipment only
 * (js/black-market-items.js). js/utils.js already refuses to price a Black
 * Market leg for anything else, which is what stops a row being built; this is
 * the second line, for a feeder that prices itself and hands the board a row
 * with the Black Market already named on it. The reported case was "sell
 * Potatoes [T6 Ingredient] at the Black Market", a play that does not exist.
 *
 * A row with no sell item id (a Laborers cycle sells a MIX) is kept: there is
 * no single item to judge, and its feeder chose the city.
 */
function bmBoardSellable(row) {
  const tradable = bmBoardTradable();
  if (!tradable || !row || !row.sellItemId) return true;
  return tradable(row.sellItemId);
}

/**
 * Applied to the COLLECTED rows rather than inside `extraFilter`: the sell item
 * id only exists once a row is normalized, and normalize runs on the top N, not
 * on every feeder row. This board is uncapped, so filtering after the collect
 * drops exactly the same rows and costs nothing extra.
 */
function bmBoardDropUntradable(rows) {
  return rows.filter(bmBoardSellable);
}

/** Every PROFITABLE play, from any table, that sells at the Black Market. */
function collectBlackMarketRows() {
  const shared = bmBoardShared();
  if (!shared || typeof shared.collectJoinedBoard !== "function") return [];
  return bmBoardDropUntradable(shared.collectJoinedBoard(
    (src) => src.profit,
    (out) => {
      out._score = out.pureProfit || 0;
      // On the row, not in the cell: the Profit/Ox column is sortable, and
      // sorting reads fields off the row long before it is rendered.
      out.oxLoad = bmBoardOxLoad(out);
      // The per-quality bid ladder under the Bid cell and Pure Profit cell:
      // what the merchant pays for every quality of this item, and the
      // corresponding pure profit, with the row's own number marked.
      const ladder = bmBoardLadder();
      out.sellNote = ladder ? ladder.bmQualityNote(out) : "";
      out.profitNote = ladder ? ladder.bmProfitQualityNote(out) : "";
      return out;
    },
    (row, src) => (typeof src.sellCity === "function"
      ? src.sellCity(row) === BM_BOARD_CITY
      : false),
    { perSource: Infinity, global: Infinity },
  ));
}

/** One board row: 12 columns. */
function formatBmBoardRow(row, _rowIdx) {
  const shared = bmBoardShared();
  if (!shared) return "";
  const profitClass = shared.joinedProfitClass(row);
  const detail = bmBoardDetail();
  const detailKey = detail ? detail.jbDetailKey("bm-board-table", row) : "";
  const toggle = detail ? `${detail.jbDetailToggle(detailKey)} ` : "";
  const marginCell = row.marginPct != null
    ? `<td class="${profitClass}">${row.marginPct.toFixed(2)}%</td>`
    : `<td style="color:#6b7280;font-style:italic">—</td>`;
  const oxDisplay = row.oxLoad
    ? `<td class="silver-val ${profitClass}">${formatSilver(row.oxLoad.profitPerLoad)}</td>`
    : `<td style="color:#6b7280;font-style:italic">—</td>`;
  const throughputDisplay = row.volIsUnknown
    ? `${formatSilver(row.throughput)} <small style="color:#9ca3af;font-style:italic" title="${row.note || ""}">(${row.note || "vol unknown"})</small>`
    : formatSilver(row.throughput);
  // The chip names the quality the row's number is keyed under. The Black
  // Market bids per quality (js/flip-route-quality.js), so a Good bid without
  // the chip reads as a Normal one.
  const chip = typeof flipQualityChip === "function" ? flipQualityChip(row) : "";

  return `
      <tr data-category="${row.category}">
        ${shared.joinedCategoryCell(row, "A {category} play that sells at the Black Market. Jump opens it in its own table.", "r_tip_bm_board")}
        <td class="cell-text">${toggle}${row.itemName}${chip}</td>
        <td><small>${row.buyCity || "—"}</small></td>
        ${shared.joinedInputCell(row)}
        ${shared.joinedSellCell(row)}
        ${bmBoardAgeCell(row)}
        ${marginCell}
        <td class="silver-val ${profitClass}"><b>${formatSilver(row.pureProfit)}</b>${row.profitNote || ""}</td>
        ${oxDisplay}
        <td class="silver-val ${profitClass}">${throughputDisplay}</td>
        ${shared.joinedVolCell(row)}
        ${shared.joinedJumpCell(row)}
      </tr>${detail ? detail.jbDetailRowHtml(row, detailKey, BM_BOARD_COLS) : ""}`;
}

function renderBlackMarketBoard() {
  if (typeof tableState === "undefined") return;
  if (typeof renderTableData !== "function") return;
  renderTableData("bm-board-table", collectBlackMarketRows(), formatBmBoardRow);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    collectBlackMarketRows, formatBmBoardRow, bmBoardAgeCell, bmBoardEntry,
    bmBoardOxLoad, bmBoardSellable, bmBoardDropUntradable,
    renderBlackMarketBoard, BM_BOARD_COLS, BM_BOARD_CITY,
  };
}
