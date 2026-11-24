/**
 * Display size: the app zoom factor.
 *
 * The widest tables run to 17 columns (My Crafting List clones its source
 * table's header and prepends three of its own), and .table-wrap only gives
 * them a horizontal scrollbar — it cannot make them FIT. Zoom plus the
 * always-on compact density (<body class="compact"> in index.html) can.
 *
 * Zoom goes through the main process (webContents.setZoomFactor over the
 * `app:setZoom` IPC) rather than a CSS transform, so hit-testing, scrollbars
 * and the price-editor popups all stay correct. Outside Electron there is no
 * bridge and the control simply does nothing.
 *
 * The factor is per machine but travels in the settings bundle
 * (js/settings-transfer.js TRANSFER_PREF_KEYS) — a user who set 80% once
 * expects the next install to open the same way.
 */

const APP_ZOOM_KEY = "appZoom";
/** What Electron will accept without the UI falling apart at either end. */
const APP_ZOOM_MIN = 0.5;
const APP_ZOOM_MAX = 1.5;
/** The steps the Ctrl shortcuts walk; the <select> offers the same values. */
const APP_ZOOM_STEPS = [0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25];

/** A stored/typed factor coerced into range. Anything unusable reads as 1. */
function normalizeZoomFactor(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(APP_ZOOM_MAX, Math.max(APP_ZOOM_MIN, n));
}

/** The step above/below `factor`; clamps at the ends rather than wrapping. */
function stepZoomFactor(factor, direction) {
  const cur = normalizeZoomFactor(factor);
  if (direction === 0) return 1;
  // Nearest step first, so a hand-imported 0.83 still moves sensibly.
  let idx = 0;
  APP_ZOOM_STEPS.forEach((s, i) => {
    if (Math.abs(s - cur) < Math.abs(APP_ZOOM_STEPS[idx] - cur)) idx = i;
  });
  const next = idx + (direction > 0 ? 1 : -1);
  if (next < 0 || next >= APP_ZOOM_STEPS.length) return APP_ZOOM_STEPS[idx];
  return APP_ZOOM_STEPS[next];
}

function appZoomStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch (e) {
    return null;
  }
}

/** The main-process bridge (preload.js), or null on a plain page. */
function appZoomBridge() {
  const b = (typeof window !== "undefined" && window.appZoom) || null;
  return b && typeof b.set === "function" ? b : null;
}

/** Push a factor to the window and remember it. Returns what was applied. */
function applyZoomFactor(value) {
  const factor = normalizeZoomFactor(value);
  const bridge = appZoomBridge();
  if (bridge) {
    try {
      const r = bridge.set(factor);
      if (r && typeof r.catch === "function") r.catch(() => {});
    } catch (e) { /* no window to zoom — the preference still sticks */ }
  }
  const store = appZoomStorage();
  if (store) {
    try { store.setItem(APP_ZOOM_KEY, String(factor)); } catch (e) { /* quota */ }
  }
  return factor;
}

/**
 * Wire the zoom picker and restore what was saved. Idempotent — a
 * second call re-syncs the widgets rather than binding twice.
 */
function initDisplaySizeControls() {
  if (typeof document === "undefined") return;
  const store = appZoomStorage();
  const zoomSel = document.getElementById("app-zoom");

  const savedZoom = normalizeZoomFactor(store ? store.getItem(APP_ZOOM_KEY) : null);

  if (zoomSel) {
    zoomSel.value = String(savedZoom);
    // A hand-edited value that is not one of the options leaves the <select>
    // blank; show the nearest step instead of an empty box.
    if (!zoomSel.value) zoomSel.value = String(stepZoomFactor(savedZoom, 0));
    if (!zoomSel._displaySizeBound) {
      zoomSel._displaySizeBound = true;
      zoomSel.addEventListener("change", () => { applyZoomFactor(zoomSel.value); });
    }
  }
  applyZoomFactor(savedZoom);

  // Ctrl+= / Ctrl+- / Ctrl+0, the shortcuts every browser has trained the user
  // to reach for. Electron's own zoom shortcuts are off (no menu), so without
  // these they do nothing at all.
  if (!document._displaySizeKeysBound) {
    document._displaySizeKeysBound = true;
    document.addEventListener("keydown", (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      let direction = null;
      if (e.key === "+" || e.key === "=") direction = 1;
      else if (e.key === "-" || e.key === "_") direction = -1;
      else if (e.key === "0") direction = 0;
      if (direction === null) return;
      e.preventDefault();
      const cur = normalizeZoomFactor(store ? store.getItem(APP_ZOOM_KEY) : 1);
      const next = applyZoomFactor(stepZoomFactor(cur, direction));
      const sel = document.getElementById("app-zoom");
      if (sel) sel.value = String(next);
    });
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDisplaySizeControls);
  } else {
    initDisplaySizeControls();
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    APP_ZOOM_KEY,
    APP_ZOOM_MIN,
    APP_ZOOM_MAX,
    APP_ZOOM_STEPS,
    normalizeZoomFactor,
    stepZoomFactor,
    applyZoomFactor,
    initDisplaySizeControls,
  };
}
