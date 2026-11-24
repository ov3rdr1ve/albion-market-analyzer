/**
 * The per-quality bid ladder printed under the Black Market board's Bid cell.
 *
 * The board collects plays from every feeder, and only two of them price a
 * specific quality: Flipping (js/flip-route-quality.js routes each quality's
 * book on its own) and Quality Rerolling (js/render-rerolling.js). Everything
 * else — Crafting, Enchanting, Transmute — is priced from the flat book, and
 * the flat book is the Normal quality ALONE (js/quality-flat-views.js: the
 * flat map is a quality-1 projection, never an aggregate). So a crafting play
 * on the board quotes the Normal bid and says nothing about the quality
 * premium the merchant is actually paying that day — the single biggest number
 * a Black Market play can be wrong by.
 *
 * bmQualityNote(row) is the answer, as the `note` HTML a price cell appends
 * (js/app.js priceTd): one line per quality whose book holds a live Black
 * Market quote, that quote and its age, and a marker on the quality the row's
 * own number is keyed under. A crafting row thus shows "the Normal bid I am
 * priced at — and the Black Market pays this much more for the Outstanding
 * one"; a flipping or rerolling row shows its own quality marked among the
 * rest. It prices NOTHING: every number is read back from the books the live
 * capture and the scans (js/bm-board-scan.js) already keep.
 *
 * Prices go through the app's own readers when they are loaded (getSellPrice /
 * getQualitySellPrice, js/utils.js) so a line quotes the same number the row's
 * cell was priced from — order mode and overrides included. A line whose
 * number is not the book's (the user pinned it) wears the ⚡ instead of an
 * age, by the same rule priceTd follows: the number is the user's, and any
 * book timestamp beside it would describe another price.
 *
 * The markup reuses the Flipping ladder's classes (qual-breakdown / qbrk-*,
 * css/styles.css) so the two ladders read as one idiom; the city column is
 * left out — every line here is the same city, which is the board's point.
 *
 * Loaded before js/render-bm-board.js.
 */

const BM_LADDER_CITY = "Black Market";

/** Qualities the Black Market's books can hold, ascending. */
const BM_LADDER_QUALITIES = [1, 2, 3, 4, 5];

/**
 * Quality names for the line tooltips. A deliberate local copy of
 * QUALITY_NAMES (js/data-rerolling.js) — that file is a top-level `const`,
 * which lives in the shared LEXICAL scope rather than on globalThis, and it
 * loads after this one — so `typeof QUALITY_NAMES` is a temporal-dead-zone
 * throw, not the "undefined" the usual guard expects. Same reason
 * js/render-flipping.js and js/flip-quality-breakdown.js carry their own.
 */
const BM_LADDER_QUALITY_NAMES = {
  1: "Normal", 2: "Good", 3: "Outstanding", 4: "Excellent", 5: "Masterpiece",
};

/** The book entry one quality's Black Market bid was captured into, or null. */
function bmLadderEntry(itemId, quality) {
  if (!itemId) return null;
  if (Number(quality) === 1) {
    return (typeof lastMarketData !== "undefined"
      ? lastMarketData?.[itemId]?.[BM_LADDER_CITY] : null)
      || (typeof lastQualityMarketData !== "undefined"
        ? lastQualityMarketData?.[itemId]?.[1]?.[BM_LADDER_CITY] : null)
      || null;
  }
  return (typeof lastQualityMarketData !== "undefined"
    ? lastQualityMarketData?.[itemId]?.[quality]?.[BM_LADDER_CITY] : null) || null;
}

/** The order-field price of an entry — the field getSellPrice would pick. */
function bmLadderRawPrice(entry) {
  if (!entry) return 0;
  // Selling INTO the Black Market, so this follows the sell toggle.
  const mode = typeof getOrderType === "function" ? getOrderType("sell") : "market";
  return entry[mode === "instant" ? "buy_price" : "sell_price"] || 0;
}

/**
 * One quality's Black Market price: the app's own reader where one is loaded
 * (so order mode and the user's overrides count), the raw book otherwise.
 * Zero means "no quote at this quality" — the same answer the pricing path
 * gives, so the ladder never shows a line the row could not have been priced
 * from.
 */
function bmLadderPrice(row, itemId, quality) {
  const raw = bmLadderRawPrice(bmLadderEntry(itemId, quality));
  if (quality === 1 && typeof getSellPrice === "function") {
    const book = typeof lastMarketData !== "undefined" ? lastMarketData?.[itemId] : undefined;
    return {
      price: getSellPrice(book, BM_LADDER_CITY, null, itemId,
        row && row.sellSideOverride ? "sell" : undefined),
      raw,
    };
  }
  if (quality > 1 && typeof getQualitySellPrice === "function") {
    const qd = typeof lastQualityMarketData !== "undefined" ? lastQualityMarketData : null;
    return { price: getQualitySellPrice(qd, itemId, quality, BM_LADDER_CITY), raw };
  }
  return { price: raw, raw };
}

/** The tooltip for one line: the quality, its bid, and whose number it is. */
function bmLadderTitle(quality, price, pinned) {
  const name = BM_LADDER_QUALITY_NAMES[quality] || `Quality ${quality}`;
  const money = typeof formatSilver === "function" ? formatSilver(price) : String(Math.round(price));
  const t = (en, key) => (typeof tx === "function" ? tx(en, key) : en);
  const parts = [`${name}: ${money}`, pinned
    ? t("your price", "r_price_yours")
    : t("bid", "r_bm_ladder_bid")];
  return parts.join(" · ").replace(/"/g, "&quot;");
}

/** The tooltip for one Pure Profit breakdown line. */
function bmLadderProfitTitle(quality, profit) {
  const name = BM_LADDER_QUALITY_NAMES[quality] || `Quality ${quality}`;
  const money = typeof formatSilver === "function" ? formatSilver(profit) : String(Math.round(profit));
  const t = (en, key) => (typeof tx === "function" ? tx(en, key) : en);
  const parts = [`${name}: ${money}`, t("Pure Profit", "pure_profit")];
  return parts.join(" · ").replace(/"/g, "&quot;");
}

/**
 * The ladder as HTML, appended under the Bid cell's number.
 *
 * @param {object} row  a normalized board row (js/joined-summary-sources.js):
 *   `sellItemId` is the item whose books are read; the marked quality is the
 *   row's own — `quality` (a flipping row) or `sellQuality` (any board row),
 *   defaulting to Normal, which is what every flat-priced feeder is keyed
 *   under. `sellSideOverride` (Flipping) makes the Normal line read the sell
 *   ORDER field directly, exactly as its own cell does.
 * @returns {string} HTML, or "" when there is nothing to compare
 */
function bmQualityNote(row) {
  const itemId = row && row.sellItemId;
  if (!itemId) return "";
  const taken = Number((row.quality ?? row.sellQuality) || 1);
  const lines = [];
  for (const quality of BM_LADDER_QUALITIES) {
    const { price, raw } = bmLadderPrice(row, itemId, quality);
    if (!(price > 0)) continue;
    const entry = bmLadderEntry(itemId, quality);
    // A number that is not the book's has no market age: the user's own price
    // wears the ⚡ priceTd uses, and no timestamp describes it.
    const pinned = typeof getSellPrice === "function"
      && Number(price) !== Number(raw);
    const age = pinned
      ? { label: "⚡", color: "#9e8840" }
      : (typeof formatPriceAge === "function"
        ? formatPriceAge(typeof priceDateFor === "function"
          ? priceDateFor(entry, "sell") : entry?.buy_date)
        : null);
    const takenLine = quality === taken;
    const cls = `qbrk-line${takenLine ? " qbrk-take" : ""}${pinned ? " qbrk-yours" : ""}`;
    const ageSpan = age
      ? `<span class="qbrk-age" style="color:${age.color}">${age.label}</span>`
      : "";
    lines.push(`<div class="${cls}" title="${bmLadderTitle(quality, price, pinned)}">`
      + `<span class="qbrk-q">${takenLine ? "▸" : ""}Q${quality}</span>`
      + `<span class="qbrk-price">${typeof formatSilver === "function"
        ? formatSilver(price) : String(Math.round(price))}</span>${ageSpan}</div>`);
  }
  if (lines.length < 1) return "";
  return `<div class="qual-breakdown">${lines.join("")}</div>`;
}

/**
 * The profit quality breakdown as HTML, appended under the Pure Profit cell.
 *
 * Quotes the exact pure profit calculated for every quality the item has a bid for,
 * marking the row's taken quality.
 *
 * @param {object} row a normalized board row
 * @returns {string} HTML, or "" when no quotes exist
 */
function bmProfitQualityNote(row) {
  const itemId = row && row.sellItemId;
  if (!itemId) return "";
  const taken = Number((row.quality ?? row.sellQuality) || 1);
  const lines = [];
  const taxRate = (typeof PREMIUM_TAX !== "undefined") ? PREMIUM_TAX : 0.065;
  const units = (row.sellUnits && row.sellUnits > 0) ? row.sellUnits : 1;
  const basePrice = Number(row.sellPrice) || 0;
  const baseProfit = Number(row.pureProfit) || 0;

  for (const quality of BM_LADDER_QUALITIES) {
    const { price } = bmLadderPrice(row, itemId, quality);
    if (!(price > 0)) continue;
    const takenLine = quality === taken;
    const profit = takenLine
      ? baseProfit
      : (basePrice > 0
        ? Math.round(baseProfit + (price - basePrice) * units * (1 - taxRate))
        : Math.round(price * units * (1 - taxRate) - (Number(row.inputCost) || 0)));
    const cls = `qbrk-line${takenLine ? " qbrk-take" : ""}`;
    const title = bmLadderProfitTitle(quality, profit);
    lines.push(`<div class="${cls}" title="${title}">`
      + `<span class="qbrk-q">${takenLine ? "▸" : ""}Q${quality}</span>`
      + `<span class="qbrk-price">${typeof formatSilver === "function"
        ? formatSilver(profit) : String(Math.round(profit))}</span></div>`);
  }
  if (lines.length < 1) return "";
  return `<div class="qual-breakdown">${lines.join("")}</div>`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    bmQualityNote, bmProfitQualityNote, bmLadderEntry, bmLadderPrice,
    bmLadderRawPrice, bmLadderTitle, bmLadderProfitTitle,
    BM_LADDER_QUALITIES, BM_LADDER_QUALITY_NAMES,
  };
}
