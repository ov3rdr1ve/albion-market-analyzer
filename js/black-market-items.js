/**
 * What the Black Market will actually buy.
 *
 * The Black Market's book is not a market — it is the mob loot table read
 * backwards. A merchant standing in Caerleon buys the things that drop off
 * things you kill, and pays a premium because those items are about to be
 * handed back to the world as loot. So it deals in EQUIPMENT and nothing else:
 * no ore, no cloth, no journals, no seeds, no mounts, and — the reported bug —
 * no food.
 *
 * The board offered "sell Potatoes [T6 Ingredient] at the Black Market", which
 * is not a play that exists. Measured against a real saved scan of 9 873 items,
 * all 4 890 ids the Black Market genuinely quotes fall in the eight marketplace
 * categories below; not one consumable, resource, product, mount, farming item,
 * trophy or laborer contract carries a number there.
 *
 * Why the price gate was not enough: AODP answers the scan's fixed location
 * list for every id, so nearly every item comes back with a Black Market bucket
 * (js/bm-board-scan.js bmHasQuote). It is normally all zeroes and drops out on
 * its own. But a reading mis-attributed to location 3003 (js/market-locations.js),
 * a cell left over from an older shape, or a hand-typed override all put a
 * NUMBER in that bucket — and every table that lists the Black Market among its
 * sell cities will happily route to it. A price gate cannot tell those apart
 * from a real bid, so the gate is on the ITEM.
 *
 * Applied in js/utils.js (getSellPrice, getQualitySellPrice), which is the one
 * place every table's Black Market leg is priced through, and again in
 * js/render-bm-board.js so a feeder that prices itself cannot put a row on the
 * board either.
 *
 * Browser + Node. Depends on getMarketCategory (js/data-item-categories.js).
 */

/**
 * The marketplace categories the Black Market quotes — top-level keys from
 * MARKET_CATEGORY_TREE (js/data-item-categories.js).
 *
 * Top-level and not per-subcategory on purpose: the subcategories inside these
 * eight are all gear of one kind or another, and an id that has no Black Market
 * bid still has no price, so the price gate finishes the job. Listing
 * subcategories instead would mean editing this file every time the game adds
 * a weapon line.
 */
const BM_TRADED_CATEGORIES = new Set([
  "melee",        // axes, daggers, hammers, war gloves, maces, quarterstaves, spears, swords
  "magic",        // every staff line
  "ranged",       // bows, crossbows
  "offhand",      // shields, torches, books
  "armor",        // cloth / leather / plate head, chest, shoes
  "accessories",  // bags and capes, faction capes included
  "gatherergear", // gatherer sets and their backpacks
  "tools",        // gathering tools
]);

/** The category lookup, however this file was loaded. */
function bmCategoryLookup() {
  if (typeof getMarketCategory === "function") return getMarketCategory;
  if (typeof require !== "undefined") {
    try {
      return require("./data-item-categories.js").getMarketCategory;
    } catch (e) { /* partial load — fall through */ }
  }
  return null;
}

/**
 * Can this item be sold at the Black Market at all?
 *
 * @param {string} itemId  a real item id. A per-quality view key (`ID#Qn`,
 *   js/flip-route-quality.js) names the same item and is answered the same way.
 * @returns {boolean} false only for an item whose category is KNOWN and is not
 *   one of the eight. An id the map has never heard of passes, as does every id
 *   when the map itself is missing (a partial script load): this gate exists to
 *   remove rows that cannot be real, and a category map lagging an items.xml
 *   refresh must not silently delete genuine gear plays instead. Such an id
 *   still needs a Black Market price to appear anywhere, which is the gate that
 *   was already there.
 */
function isBlackMarketTradable(itemId) {
  if (!itemId || typeof itemId !== "string") return false;
  const lookup = bmCategoryLookup();
  if (typeof lookup !== "function") return true;
  const cat = lookup(itemId.split("#")[0]);
  if (!cat || !cat.category) return true;
  return BM_TRADED_CATEGORIES.has(cat.category);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { BM_TRADED_CATEGORIES, isBlackMarketTradable };
  // Browsers load this with a plain <script> tag, where the function is simply
  // in scope for every other file; mirror it for Node so the modules that probe
  // `typeof isBlackMarketTradable === "function"` behave the same.
  if (typeof globalThis !== "undefined") {
    globalThis.BM_TRADED_CATEGORIES = BM_TRADED_CATEGORIES;
    globalThis.isBlackMarketTradable = isBlackMarketTradable;
  }
}
