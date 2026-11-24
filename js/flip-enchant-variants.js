// Enchant (.1–.4) variant rows for the Flipping table.
//
// The flip universe (getAllFlippingItems, js/utils.js) is BASE ids only — 2979
// items, of which ~1437 are enchantable equipment. Materialising every enchant
// level up front would triple the app's biggest table and its scan, so variants
// are generated ON DEMAND: a base row carries a ▶ toggle that reveals its .1–.4
// children, and the Ench. picker surfaces one level across the whole board.
// Their prices are fetched lazily (ensureFlipVariantPrices), which is why Scan
// Flipping keeps fetching base ids alone.
//
// This mirrors the Craft Planner (expandCraftPlannerItems /
// ensurePlannerVariantPrices in js/render-craft-planner.js) but gates at
// GENERATION time rather than computing five rows per item and hiding four:
// a flip row is a route search over city pairs, too expensive to throw away.

// Equipment id slots that enchant. Same shape as the planner's CP_EQUIP_SLOT_RE
// — including the `(?:_|$)`, without which plain `T*_BAG` and `T*_CAPE` (which
// carry nothing after the slot token) would lose their .1–.4 rows.
const FLIP_EQUIP_SLOT_RE = /^T\d+_(HEAD|ARMOR|SHOES|CAPEITEM|CAPE|BAG|MAIN|2H|OFF)(?:_|$)/;

/**
 * Does this flip item have a .1–.4 ladder?
 *
 * Equipment only, T4–T8: enchants start at T4, and the catalogue carries T2/T3
 * gear (js/gear.js) that has no enchanted form at all. An id that already
 * carries an `@` is a variant — the resource rows buildResourceFlipItems()
 * emits (`T4_WOOD_LEVEL1@1`) land here and must pass through untouched.
 */
function hasEnchantVariants(id) {
  const raw = String(id || "");
  if (raw.includes("@")) return false;
  // A crest (`T4_CAPEITEM_UNDEAD_BP`) is the blueprint of an enchantable cape
  // but is flat itself — items.xml ships no `_BP@n`, so a ladder here would only
  // add four rows that can never price. The cape it crafts keeps its own.
  if (raw.endsWith("_BP")) return false;
  if (!FLIP_EQUIP_SLOT_RE.test(raw)) return false;
  const tier = parseInt(raw.slice(1), 10);
  return tier >= 4 && tier <= 8;
}

/**
 * One enchant-level row for a base flip item.
 *
 * Equipment takes a plain `@n` id. The `_LEVELn@n` form is the AODP format for
 * REFINED RESOURCES only (see reference_aodp_refined_enchant_id_format) — and
 * flipping prices the item itself, never a recipe, so no material rule applies.
 */
function flipEnchantVariant(item, n) {
  const name = String(item.name || item.id);
  return {
    ...item,
    id: `${item.id}@${n}`,
    // "Elder's Bag [T8]" → "Elder's Bag [T8.1]", matching the planner's naming.
    name: name.replace(/\[T(\d+)\]/, `[T$1.${n}]`),
    baseId: item.id,
    enchantVariant: n,
  };
}

// The picker's raw value ("" = All, "0".."4") as a level, or 0 when it selects
// no enchant. ".0" is the base row itself, so it reveals nothing.
function _flipPickedLevel(enchSel) {
  const lvl = parseInt(enchSel, 10);
  return lvl >= 1 && lvl <= 4 ? lvl : 0;
}

/**
 * The Flipping table's row set: every base item, plus the enchant variants the
 * current expand state / Ench. pick / auto-reveal pass is asking to see.
 *
 * `expanded` defaults to the Flipping table's own expand set (js/sorting.js) and
 * `enchSel` to the live picker value, so the renderer can call this with no
 * options; both are injectable for tests.
 *
 * The third source is js/flip-auto-reveal.js: a base whose .1–.4 ladder holds a
 * PROFITABLE level shows that level without being asked, because a flip nobody
 * knows to look for is a flip nobody takes. An explicit Ench. pick overrides it
 * — the pick is the user narrowing the board on purpose, and quietly adding
 * other levels to it would read as the picker leaking.
 */
function expandFlipItems(items, opts = {}) {
  const expanded = opts.expanded
    || (typeof expandedCraftItemsFor === "function" ? expandedCraftItemsFor("flipping-table") : null)
    || (typeof expandedCraftItems !== "undefined" ? expandedCraftItems : null);
  const enchSel = opts.enchSel != null
    ? opts.enchSel
    : (typeof activeEnchantFilter === "function" ? activeEnchantFilter("flipping-table") : "");
  const picked = _flipPickedLevel(enchSel);
  // ANY pick counts, ".0" included: that one selects the base rows alone, and
  // an auto-revealed .1-.4 under it would read as the picker leaking. `picked`
  // cannot say so on its own — it is 0 both for ".0" and for no pick at all.
  const hasPick = enchSel !== "" && enchSel != null;
  const autoLevels = opts.autoLevels
    || ((id) => (typeof flipAutoRevealedLevels === "function" ? flipAutoRevealedLevels(id) : []));
  const out = [];
  for (const item of items) {
    out.push(item);
    if (!hasEnchantVariants(item.id)) continue;
    const isOpen = !!(expanded && typeof expanded.has === "function" && expanded.has(item.id));
    const auto = isOpen || hasPick ? [] : autoLevels(item.id);
    if (!isOpen && !picked && !auto.length) continue;
    // An expanded base shows the whole ladder even under a pick — the DOM-level
    // filter (rowPassesTierEnch) narrows what is visible, and re-collapsing on
    // a pick change would fight the toggle the user just clicked.
    const levels = isOpen ? [1, 2, 3, 4] : (picked ? [picked] : auto);
    levels.forEach((n) => out.push(flipEnchantVariant(item, n)));
  }
  return out;
}

/**
 * Market ids one reveal needs priced: `baseId` targets one item's four levels
 * (row expand), `enchLevel` one level across every enchantable base (picker).
 */
function flipVariantIds(opts = {}) {
  const items = typeof getAllFlippingItems === "function" ? getAllFlippingItems() : [];
  const levels = opts.enchLevel ? [opts.enchLevel] : [1, 2, 3, 4];
  const ids = [];
  items.forEach((item) => {
    if (opts.baseId && item.id !== opts.baseId) return;
    if (!hasEnchantVariants(item.id)) return;
    levels.forEach((n) => ids.push(`${item.id}@${n}`));
  });
  return ids;
}

/**
 * The id universe the search box targets: bases plus every enchant variant.
 *
 * Scan Flipping stays on getFlippingItemIds (bases only) — this is for the
 * Enter-fetch path (js/table-search-fetch.js), where typing "bag" with the
 * Ench. picker on .3 has to be able to MATCH `T8_BAG@3` before it can fetch it.
 * Memoized: the flip universe is rebuilt from a dozen catalogs on every call.
 */
let _flipSearchIdsCache = null;
function getFlippingSearchIds() {
  if (_flipSearchIdsCache) return _flipSearchIdsCache;
  const ids = [];
  (typeof getAllFlippingItems === "function" ? getAllFlippingItems() : []).forEach((item) => {
    ids.push(item.id);
    if (!hasEnchantVariants(item.id)) return;
    for (let n = 1; n <= 4; n++) ids.push(`${item.id}@${n}`);
  });
  _flipSearchIdsCache = ids;
  return ids;
}

// ─── Lazy on-demand pricing for the revealed variants ───────────────────────
// An in-flight guard keeps a rapid picker change from firing duplicate fetches;
// already-priced ids are skipped, so re-opening a row costs nothing.
const _flipVariantFetchInFlight = new Set();

async function ensureFlipVariantPrices(opts = {}) {
  if (typeof fetchPricesBatch !== "function") return;
  const key = opts.baseId ? "base:" + opts.baseId : "ench:" + (opts.enchLevel || 0);
  if (_flipVariantFetchInFlight.has(key)) return;
  const md = (typeof lastMarketData !== "undefined" && lastMarketData) || {};
  const missing = flipVariantIds(opts).filter((id) => !(id in md));
  if (missing.length === 0) return; // nothing new to price — no fetch
  _flipVariantFetchInFlight.add(key);
  const btn = (typeof document !== "undefined") ? document.getElementById("scan-flipping-btn") : null;
  if (btn) btn.classList.add("scanning"); // reuse the scan pulse as a loading cue
  try {
    const data = await fetchPricesBatch(missing);
    if (typeof lastMarketData === "undefined" || !lastMarketData) lastMarketData = {};
    applyScanPatch(lastMarketData, data);
    renderFlippingTable(lastMarketData);
  } catch (e) {
    console.error("[flipping] lazy variant price fetch failed:", e);
  } finally {
    _flipVariantFetchInFlight.delete(key);
    if (btn) btn.classList.remove("scanning");
  }
}

// Wire the enchant picker → lazy fetch. table-search.js calls
// window.tableFilterHooks[tableId] after a filter change; only .1–.4 need a
// fetch (.0 / All are base rows the scan already priced).
if (typeof window !== "undefined") {
  window.ensureFlipVariantPrices = ensureFlipVariantPrices;
  window.tableFilterHooks = window.tableFilterHooks || {};
  window.tableFilterHooks["flipping-table"] = function () {
    const el = document.getElementById("enchfilter-flipping-table");
    const lvl = el && el.value ? parseInt(el.value, 10) : 0;
    if (lvl >= 1 && lvl <= 4) ensureFlipVariantPrices({ enchLevel: lvl });
  };
}
