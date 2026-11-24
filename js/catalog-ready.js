/**
 * Waiting on the lazy catalogs (js/catalog-loader.js), shared by every panel
 * that paints on its own instead of through the boot sequence in js/app.js.
 *
 * The catalogs are injected after first paint, so a panel that renders at
 * DOMContentLoaded reads them before they exist: it either throws, prints a
 * "can't compute" / all-"—" table, or silently prices from fallbacks. Each such
 * panel shows showCatalogLoading() first and paints from whenCatalogsReady().
 *
 * Loaded early in index.html, before every panel that calls it.
 */

const CATALOG_LOADING_TEXT = "Loading catalogs…";

/**
 * Run `cb` once the catalogs have loaded (or failed — a failed load still
 * settles, and the panel should then say what it can).
 *
 * Panels can run BEFORE js/catalog-loader.js (index.html order), and the loader
 * assigns `catalogsReady` in a microtask after it runs, so the promise is looked
 * up at call time and re-checked on a timer until it exists (or is null: the
 * loader ran, its microtask has not). A page with no loader at all (tests, an
 * older build) runs `cb` at once — unless `present()` says the catalogs the
 * caller needs are still missing, in which case it keeps checking. After ~10s
 * of checks it gives up and runs `cb` anyway.
 */
function whenCatalogsReady(cb, opts = {}, tries = 0) {
  const ready = typeof catalogsReady !== "undefined" ? catalogsReady : undefined;
  if (ready && typeof ready.then === "function") {
    ready.then(cb, cb);
    return;
  }
  const present = typeof opts.present === "function" ? opts.present() : true;
  if ((ready === undefined && present) || tries >= 200) {
    cb();
    return;
  }
  setTimeout(() => whenCatalogsReady(cb, opts, tries + 1), 50);
}

/** The loading line, translated when i18n is loaded. */
function catalogLoadingText() {
  return typeof tx === "function" ? tx(CATALOG_LOADING_TEXT, "loading_catalogs") : CATALOG_LOADING_TEXT;
}

/**
 * Put a one-row loading state in a table's tbody, spanning its header. The
 * panel's real render replaces it.
 */
function showCatalogLoading(tableId) {
  if (typeof document === "undefined") return;
  const table = document.getElementById(tableId);
  const tbody = table && table.querySelector("tbody");
  if (!tbody) return;
  const head = table.querySelector("thead tr");
  const cols = (head && head.children && head.children.length) || 1;
  tbody.innerHTML = `<tr class="catalog-loading-row"><td colspan="${cols}" style="color:#9ca3af">${catalogLoadingText()}</td></tr>`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { whenCatalogsReady, showCatalogLoading, catalogLoadingText, CATALOG_LOADING_TEXT };
}
