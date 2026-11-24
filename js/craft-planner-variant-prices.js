// Lazy on-demand pricing for the Crafting Planner's enchant (.1–.4) variants.
//
// Split out of js/render-craft-planner.js, which had grown past the repo's
// 800-line cap. It is a self-contained job: decide which @n ids are still
// unpriced, fetch exactly those, merge them into lastMarketData and ask for a
// redraw. Nothing here builds a row or a cell.
//
// Loaded after js/render-craft-planner.js in index.html: it calls
// expandCraftPlannerItems / renderCraftPlannerTable from there, and hangs its
// picker hook off window.tableFilterHooks.

// ─── Lazy on-demand pricing for enchant (.1–.4) variants ────────────────────
// The planner scan skips @n ids for speed (see getCraftPlannerItemIds), so a
// freshly filtered/expanded enchant row starts unpriced. When the user drills
// into an enchant level (the picker) or expands a base row, fetch JUST the
// missing variant output + enchanted-material prices, merge them into
// lastMarketData, and re-render — filling those rows without paying the full
// ~3× variant scan cost up front. Already-priced ids are skipped, and an
// in-flight guard keeps a rapid picker change from firing duplicate fetches.
const _cpVariantFetchInFlight = new Set();

// Every market id the given variant set needs priced: each variant output plus
// its (already-enchanted) material lines. `enchLevel` targets one level across
// all gear; `baseId` targets one base item's four variants (used on expand).
function _cpCollectVariantIds({ enchLevel, baseId } = {}) {
  if (typeof expandCraftPlannerItems !== "function" || typeof CRAFTING_ITEMS === "undefined") return [];
  const want = expandCraftPlannerItems(CRAFTING_ITEMS).filter((it) => {
    const id = String(it.id);
    if (!id.includes("@")) return false;
    if (baseId) return id.replace(/@\d+$/, "") === baseId;
    if (enchLevel) return id.endsWith("@" + enchLevel);
    return false;
  });
  const ids = new Set();
  const addChain = (matId) => {
    if (typeof getRefiningChainIds !== "function") return;
    // Same gate the planner prices with (CP_CHAIN_OPTS): the ladder below an
    // enchanted bar AND the transmute grid its raw leg can be reached through.
    // Without these the .1-.4 rows can only ever buy the bar — the chain and
    // the transmute both read zeros and drop out.
    getRefiningChainIds(matId, undefined, { transmuteRaw: true }).forEach((x) => ids.add(x));
  };
  want.forEach((it) => {
    ids.add(it.id);
    if (it.matId) { ids.add(it.matId); addChain(it.matId); }
    (it.materials || []).forEach((m) => { ids.add(m.matId); addChain(m.matId); });
  });
  return [...ids];
}

async function ensurePlannerVariantPrices(opts = {}) {
  if (typeof fetchPricesBatch !== "function") return;
  const key = opts.baseId ? "base:" + opts.baseId : "ench:" + (opts.enchLevel || 0);
  if (_cpVariantFetchInFlight.has(key)) return;
  const md = (typeof lastMarketData !== "undefined" && lastMarketData) || {};
  const missing = _cpCollectVariantIds(opts).filter((id) => !(id in md));
  if (missing.length === 0) return; // nothing new to price — no fetch
  _cpVariantFetchInFlight.add(key);
  const btn = (typeof document !== "undefined") ? document.getElementById("scan-craft-planner-btn") : null;
  if (btn) btn.classList.add("scanning"); // reuse the scan pulse as a loading cue
  try {
    const data = await fetchPricesBatch(missing);
    if (typeof lastMarketData === "undefined" || !lastMarketData) lastMarketData = {};
    applyScanPatch(lastMarketData, data);
    // Through the scheduler, not straight into the renderer: this one is the
    // app's longest block, and it lands while the user is still working the
    // pickers. The async pass draws this table first and hands the thread back
    // between slices (js/render-async.js); the direct call is the fallback for
    // when there is no scheduler to ask.
    if (typeof scheduleRerender !== "function"
        || !scheduleRerender("planner-variant-prices", { priorityTableId: "craft-planner-table" })) {
      renderCraftPlannerTable(lastMarketData);
    }
  } catch (e) {
    console.error("[craft-planner] lazy variant price fetch failed:", e);
  } finally {
    _cpVariantFetchInFlight.delete(key);
    if (btn) btn.classList.remove("scanning");
  }
}

// Wire the enchant picker → lazy fetch. table-search.js calls window.
// tableFilterHooks[tableId] after a filter change; only .1–.4 need a fetch
// (.0 / All are base rows the main scan already priced).
if (typeof window !== "undefined") {
  window.ensurePlannerVariantPrices = ensurePlannerVariantPrices;
  window.tableFilterHooks = window.tableFilterHooks || {};
  window.tableFilterHooks["craft-planner-table"] = function () {
    const el = document.getElementById("enchfilter-craft-planner-table");
    const lvl = el && el.value ? parseInt(el.value, 10) : 0;
    if (lvl >= 1 && lvl <= 4) ensurePlannerVariantPrices({ enchLevel: lvl });
  };
}
