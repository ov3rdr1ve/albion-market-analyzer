
// NOTE the "market" prefix on every name here: utils.js already owns a
// getItemCategory(), which returns this app's own coarse row label ("Resource",
// "Gear", "Journal"). These are the GAME's Marketplace taxonomy and must never
// shadow it — the browser shares one global scope, so a collision would silently
// break the volume table's Category column.

/**
 * Base id for a game id: strip the tier prefix, _LEVELn and the @n enchant.
 *
 * Also strips a journal's `_EMPTY`/`_FULL`: items.xml keys a journal by its
 * carried form (`T2_JOURNAL_WOOD`) while the market trades the two suffixed
 * ids, so without this every journal row answered no category pick at all.
 * Journals are the only family carrying those suffixes.
 */
function marketCategoryBaseId(id) {
  return String(id || "")
    .replace(/^T[1-8]_/, "")
    .replace(/@\d+$/, "")
    .replace(/_LEVEL\d+$/, "")
    .replace(/_(EMPTY|FULL)$/, "");
}

/**
 * Marketplace category/subcategory for one game id.
 * @returns {{category: string, subcategory: string}|null} null when items.xml
 *   lists no shop category for it (skins, roads rows, synthetic ids) — such a
 *   row simply never matches an explicit category pick.
 */
function getMarketCategory(id) {
  const packed = MARKET_CATEGORY_BY_BASE[marketCategoryBaseId(id)];
  if (!packed) return null;
  const i = packed.indexOf("|");
  return i < 0
    ? { category: packed, subcategory: "" }
    : { category: packed.slice(0, i), subcategory: packed.slice(i + 1) };
}

/** Display label for a category key ("armor" → "Armor"), or the key itself. */
function getMarketCategoryLabel(key) {
  const c = MARKET_CATEGORY_TREE.find((x) => x.key === key);
  return c ? c.label : key;
}

/** Display label for a subcategory key, searched across every category. */
function getMarketSubcategoryLabel(key) {
  for (const c of MARKET_CATEGORY_TREE) {
    const s = c.subs.find((x) => x.key === key);
    if (s) return s.label;
  }
  return key;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    MARKET_CATEGORY_TREE,
    MARKET_CATEGORY_BY_BASE,
    marketCategoryBaseId,
    getMarketCategory,
    getMarketCategoryLabel,
    getMarketSubcategoryLabel,
  };
  // Browsers load this with a plain <script> tag; mirror the globals for Node so
  // the modules that probe `typeof getMarketCategory === "function"` behave the same.
  if (typeof globalThis !== "undefined") {
    globalThis.MARKET_CATEGORY_TREE = MARKET_CATEGORY_TREE;
    globalThis.MARKET_CATEGORY_BY_BASE = MARKET_CATEGORY_BY_BASE;
    globalThis.getMarketCategory = getMarketCategory;
    globalThis.getMarketCategoryLabel = getMarketCategoryLabel;
    globalThis.getMarketSubcategoryLabel = getMarketSubcategoryLabel;
  }
}
