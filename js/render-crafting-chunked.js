/**
 * The Crafting table, computed in slices.
 *
 * A step in the render schedule is one whole renderer, so a renderer that runs
 * for seconds freezes the window however carefully the pass around it is
 * arranged. Crafting is the second of the two tables where that is true: 1.7 s
 * measured on a real price map, over ~1450 gear recipes expanded to their @1-@4
 * variants and evaluated against every candidate city.
 *
 * The item loop is a pure map — no shared state, nothing half-written — so it
 * is safe to interrupt. This walks it in time slices, handing the thread back
 * between them, and writes the DOM once at the end exactly as the synchronous
 * path does: a cancelled pass leaves the previous table on screen rather than
 * half of a new one.
 *
 * Both paths go through the same two helpers in js/render-crafting.js
 * (buildCraftingTableItems, craftingRowsForItem) and the same paint, so they
 * cannot drift apart. Its own file only because render-crafting.js is already
 * near the 800-line cap.
 */

/** Work done between yields. About two frames — enough that the yields are cheap. */
const CRAFTING_CHUNK_BUDGET_MS = 100;

/**
 * @param {object}   marketData
 * @param {object}   [options]
 * @param {Function} [options.yieldTo]   () => Promise, hands back a frame
 * @param {number}   [options.budgetMs]  work per slice before yielding
 * @param {Function} [options.cancelled] () => boolean, checked between slices
 * @param {Function} [options.paint]     wraps the single DOM write
 * @param {Function} [options.now]
 * @returns {Promise<boolean>} false if it was cancelled before painting
 */
async function renderCraftingTableChunked(marketData, {
  yieldTo = async () => {},
  budgetMs = CRAFTING_CHUNK_BUDGET_MS,
  cancelled = () => false,
  paint = (fn) => fn(),
  now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
} = {}) {
  const items = buildCraftingTableItems();

  // Each slice re-enters the table's own spec scope: a yield's withSpecScope
  // finally has already restored the ambient scope (none, at the scheduler call
  // site), and an unscoped read would price focus at the empty scope's default
  // levels. Guarded — this file also runs standalone in tests. Only the
  // synchronous per-item work is wrapped, never across an await.
  const inScope = (fn) => (typeof withSpecScope === "function")
    ? withSpecScope("crafting-table", fn)
    : fn();
  const rowData = [];
  let sliceStart = now();
  for (let i = 0; i < items.length; i++) {
    rowData.push(...inScope(() => craftingRowsForItem(items[i], marketData)));
    if (now() - sliceStart >= budgetMs && i + 1 < items.length) {
      await yieldTo();
      if (cancelled()) return false;
      sliceStart = now();
    }
  }

  paint(() => paintCraftingRows(dedupeCraftingRows(rowData), marketData));
  return true;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { CRAFTING_CHUNK_BUDGET_MS, renderCraftingTableChunked };
}
