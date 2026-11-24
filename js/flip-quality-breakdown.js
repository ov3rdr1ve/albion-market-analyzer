/**
 * The per-quality ladder printed under a Flipping row's Buy Cost and Sell
 * Revenue cells.
 *
 * A flip is a matched PAIR: the row buys and sells one specific quality
 * (js/flip-route-quality.js). The router evaluates every quality the item is
 * priced at and keeps one, which used to mean the other four were reduced to a
 * grey "also Q2 609,999 · Q4 649,999" under the Buy cell — no city, no age, no
 * sell side, capped at two. A reader could see that other qualities existed and
 * could not tell what to do with any of them.
 *
 * So both cells now print the same list of qualities, in the same order, one
 * line each. Line N of Buy Cost and line N of Sell Revenue are the SAME
 * quality, which is the whole point: read across and you have the trade — buy
 * this quality in that city, sell it in this one. The quality the row itself
 * took wears a marker.
 *
 * The order is `byQuality`'s own (quality-ascending, the order qualityViewsFor
 * emits) and is never re-sorted — sorting one side by price would break the
 * alignment that makes the two cells readable together.
 *
 * Everything but the age is already on the `byQuality` entry. The age is read
 * here from the same quality-aware books priceTd reads (js/app.js), through the
 * same priceDateFor field picker (js/price-freshness.js), so a line's badge
 * describes the number beside it rather than the Normal book's clock.
 *
 * Loaded after js/flip-route-quality.js, before js/render-flipping.js.
 */

/**
 * Quality names for the line tooltips. A deliberate local copy — the twin in
 * js/render-flipping.js is a top-level `const`, which lives in the shared
 * LEXICAL scope rather than on globalThis, so `typeof` it from another file is
 * a temporal-dead-zone throw rather than the "undefined" the usual guard
 * expects.
 */
const QBRK_QUALITY_NAMES = {
  1: "Normal", 2: "Good", 3: "Outstanding", 4: "Excellent", 5: "Masterpiece",
};

/**
 * Shorter city labels, for the ladder only.
 *
 * A ladder line is one unbreakable run — wrapping it would slide the Buy and
 * Sell cells out of step — so the widest city decides how wide the column has
 * to be before anything truncates. "Black Market" alone is half again the width
 * of "Caerleon". Every cell that names a city on its own (the Route column, the
 * hover text here) still spells it out in full.
 */
const QBRK_CITY_SHORT = {
  "Black Market": "Black Mkt",
  "Fort Sterling": "Ft Sterling",
  "Smuggler's Den": "Smuggler's",
};

/** The ladder's label for a city. Unknown cities keep their own name. */
function qbrkCity(city) {
  return QBRK_CITY_SHORT[city] || city || "";
}

/** The market entry one leg of a `byQuality` pair was priced from, or null. */
function qbrkEntry(itemId, quality, city) {
  if (!itemId || !city) return null;
  if (Number(quality) === 1) {
    return (typeof lastMarketData !== "undefined" ? lastMarketData?.[itemId]?.[city] : null) || null;
  }
  return (typeof lastQualityMarketData !== "undefined"
    ? lastQualityMarketData?.[itemId]?.[quality]?.[city]
    : null) || null;
}

/**
 * The compact age badge for one line: `{label, color}` or null.
 *
 * " ago" is stripped — `formatPriceAge` builds that suffix as a literal rather
 * than through tx(), so dropping it costs no translation and buys the width the
 * city needs.
 *
 * A leg the user pinned has no market age at all: the number is theirs and any
 * book timestamp beside it describes something else. It says so with the same ⚡
 * priceTd uses, and the pin is read under the entry's own `viewId` (`ITEM#Q2`),
 * never the item id.
 */
function qbrkAge(itemId, entry, side) {
  const city = side === "buy" ? entry.buyCity : entry.sellCity;
  // A one-sided quote has no city on the side it lacks, and there is no book to
  // date. The cell prints an em dash there; a badge beside it would be a date
  // for a price that does not exist.
  if (!city) return null;
  const viewId = entry.viewId || itemId;
  if (typeof getOverrideField === "function" && getOverrideField(viewId, city, side) != null) {
    return { label: "⚡", color: "#9e8840" };
  }
  const book = qbrkEntry(itemId, entry.quality, city);
  const dateStr = typeof priceDateFor === "function" ? priceDateFor(book, side) : null;
  const age = typeof formatPriceAge === "function" ? formatPriceAge(dateStr) : null;
  if (!age) return null;
  return { label: age.label.replace(" ago", ""), color: age.color };
}

/**
 * Why a line's number must not be traded on, or null.
 *
 * The ladder used to print price, city and age and nothing else, so the two
 * numbers a route is not allowed to use looked exactly like the ones it is:
 *
 *   gone   the book was READ without this order in it (bookEmptySince,
 *          js/price-freshness.js). Kept and shown, because a missing order is
 *          evidence and not proof — but not routed.
 *   yours  the player's own standing order. The reported Black Market case:
 *          the row's best sell price was the player's own listing, so the
 *          profit was booked against themselves and closing the order changed
 *          nothing on the board.
 *
 * It replaces the age badge rather than crowding in beside it: "gone" already
 * says the timestamp beside it describes a price that is no longer there.
 */
function qbrkStatus(itemId, entry, side) {
  const city = side === "buy" ? entry.buyCity : entry.sellCity;
  if (!city) return null;
  const viewId = entry.viewId || itemId;
  if (typeof getOverrideField === "function" && getOverrideField(viewId, city, side) != null) return null;
  const price = side === "buy" ? entry.buyPrice : entry.sellPrice;
  const t = (en, key) => (typeof tx === "function" ? tx(en, key) : en);
  if (typeof isOwnMarketPrice === "function"
    && isOwnMarketPrice(itemId, entry.quality, city, side, price)) {
    return { label: t("yours", "r_price_yours"), color: "#9e8840", cls: "qbrk-yours" };
  }
  const book = qbrkEntry(itemId, entry.quality, city);
  if (typeof bookEmptySince === "function" && bookEmptySince(book, side)) {
    return { label: t("gone", "r_price_gone"), color: "#c96a6a", cls: "qbrk-gone" };
  }
  return null;
}

/** The hover text for one line: both legs named, and what the pair is worth. */
function qbrkTitle(entry) {
  const name = QBRK_QUALITY_NAMES[entry.quality] || `Quality ${entry.quality}`;
  const money = (n) => (typeof formatSilver === "function" ? formatSilver(n) : String(Math.round(n)));
  const t = (en, key) => (typeof tx === "function" ? tx(en, key) : en);
  // A one-sided quote is named for what it IS — a price nobody is on the other
  // side of — rather than dressed up as a pair with a zero leg.
  if (entry.routable === false) {
    const parts = [];
    if (entry.buyCity) {
      parts.push(`${name}: ${t("buy", "r_qbrk_buy")} ${entry.buyCity} ${money(entry.buyPrice)}`);
    }
    if (entry.sellCity) {
      parts.push(`${name}: ${t("sell", "r_qbrk_sell")} ${entry.sellCity} ${money(entry.sellPrice)}`);
    }
    parts.push(entry.sellCity && !entry.buyCity
      ? t("nobody is asking at this quality, so it is not a flip", "r_qbrk_bid_only")
      : t("no matching order at this quality, so it is not a flip", "r_qbrk_one_sided"));
    return parts.join(" · ").replace(/"/g, "&quot;");
  }
  const parts = [
    `${name}: ${t("buy", "r_qbrk_buy")} ${entry.buyCity} ${money(entry.buyPrice)}`,
    `${t("sell", "r_qbrk_sell")} ${entry.sellCity} ${money(entry.sellPrice)}`,
    `${t("profit", "r_qbrk_profit")} ${money(entry.profit || 0)}`,
  ];
  if (entry.datable === false) {
    parts.push(t("no timestamp, so this quality cannot take the row", "r_qbrk_undated"));
  }
  return parts.join(" · ").replace(/"/g, "&quot;");
}

/**
 * One side's quality ladder, as HTML appended under a price cell.
 *
 * @param {object} row   a Flipping row (buildFlipRowData, js/render-flipping.js)
 * @param {"buy"|"sell"} side  which leg's price and city each line prints
 * @returns {string} HTML, or "" when there is nothing to compare
 *
 * A single ROUTABLE quality renders nothing: that row is exactly what it was
 * before this existed, which is the overwhelming majority of the board — the
 * price cell already prints that quality's number.
 *
 * A single UNROUTABLE one renders, and that is not a cosmetic choice: a
 * one-sided quote (js/flip-route-quality.js flipQualityOneSided) is the only
 * price such a row has anywhere, the cell above it prints 0, and suppressing
 * the line is what made a captured Black Market bid of 3,850,938 invisible
 * behind a bare "no data" row.
 */
function flipQualityBreakdown(row, side) {
  if (!row || !Array.isArray(row.byQuality) || !row.byQuality.length) return "";
  const onlyRoutable = row.byQuality.length === 1 && row.byQuality[0].routable !== false;
  if (onlyRoutable) return "";
  // A cell whose every line would be an em dash says nothing at all — the case
  // is a row priced only by bids, whose Buy Cost ladder is five dashes in a
  // column. The other cell still carries the whole list.
  const cityOf = (entry) => (side === "buy" ? entry.buyCity : entry.sellCity);
  if (!row.byQuality.some(cityOf)) return "";
  const itemId = row.item ? row.item.id : null;
  const money = (n) => (typeof formatSilver === "function" ? formatSilver(n) : String(Math.round(n)));
  const lines = row.byQuality.map((entry) => {
    const price = side === "buy" ? entry.buyPrice : entry.sellPrice;
    const city = side === "buy" ? entry.buyCity : entry.sellCity;
    const taken = !row.noData && entry.quality === row.quality;
    // The two flags are exclusive on purpose. "Undated" means a quality that
    // could take the row and may not, for want of a timestamp; an unroutable
    // quote could never take it whatever its clock said, so wearing both would
    // dim it for a reason that does not apply to it.
    const unroutable = entry.routable === false;
    const status = qbrkStatus(itemId, entry, side);
    const cls = `qbrk-line${taken ? " qbrk-take" : ""}`
      + `${!unroutable && entry.datable === false ? " qbrk-undated" : ""}`
      + `${unroutable ? " qbrk-unroutable" : ""}`
      + `${status ? ` ${status.cls}` : ""}`;
    const age = status || qbrkAge(itemId, entry, side);
    const ageSpan = age
      ? `<span class="qbrk-age" style="color:${age.color}">${age.label}</span>`
      : "";
    const marker = taken ? "▸" : "";
    // The side a one-sided quote does not have prints an em dash. A 0 there
    // would read as "somebody is bidding nothing", which is the opposite of
    // "nobody is bidding".
    const priceText = city ? money(price) : "—";
    // The city is the only part allowed to truncate when the column is tight
    // (css/styles.css) — a clipped age would leave a price no one can judge.
    return `<div class="${cls}" title="${qbrkTitle(entry)}">`
      + `<span class="qbrk-q">${marker}Q${entry.quality}</span>`
      + `<span class="qbrk-price">${priceText}</span>`
      + `<span class="qbrk-city">${qbrkCity(city)}</span>${ageSpan}</div>`;
  });
  return `<div class="qual-breakdown">${lines.join("")}</div>`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    QBRK_QUALITY_NAMES, QBRK_CITY_SHORT, qbrkCity, qbrkEntry, qbrkAge, qbrkStatus,
    qbrkTitle, flipQualityBreakdown,
  };
}
