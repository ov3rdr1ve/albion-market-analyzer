/**
 * Boot timing.
 *
 * What is left of js/app-loader.js once the splash it drove is gone. The app no
 * longer hides its startup behind anything — the window opens on the real page
 * and each table boot is computing wears its own loading row
 * (js/table-loading-mark.js) — so there is no overlay to show, no status line to
 * write and no watchdog to uncover a boot that wedged. Nothing can strand the
 * user behind a curtain that is not there.
 *
 * The measuring survived because it is the only thing that answers "why was that
 * start slow". Loaded NOT deferred, at the top of the body, so its evaluation
 * time is the top of the document and the stages below are measured from
 * navigation start.
 *
 * Contract:
 *   bootStage(label)  — name a phase of boot; its cost runs until the next one.
 *   bootFinish()      — print the one summary line. Idempotent.
 */

let bootDone = false;

// Wall clock of this script's evaluation, i.e. the top of the document. Timed
// from navigation start (performance.now()'s zero) so the number includes the
// window opening and the HTML being parsed down to here.
const bootT0 = typeof performance !== "undefined" ? performance.now() : 0;
let bootTDom = null;
// Every stage boot announced, with the clock reading at the moment it was
// announced. The summary turns them into per-stage costs, which is the only way
// to see which one is the slow one.
const bootStages = [];

function bootMs() {
  return typeof performance !== "undefined" ? performance.now() : 0;
}

/** Name a phase of boot. No-op once the summary has been printed. */
function bootStage(label) {
  if (bootDone) return;
  bootStages.push({ label, t: bootMs() });
}

/**
 * One line, at the end, naming where the time went.
 *
 * The parts answer different questions: how long the document took to parse
 * down to this script and on to DOMContentLoaded (this script runs at the top
 * of it, DOMContentLoaded after — the catalog scripts no longer sit in that
 * window, they are injected after first paint by js/catalog-loader.js and read
 * through catalogsState() below), and how long building and hydrating the
 * tables took on top. Those numbers decide whether the catalogs are ever worth
 * bundling.
 */
function bootFinish() {
  if (bootDone) return;
  bootDone = true;
  try {
    const end = bootMs();
    const parts = [`document ${Math.round(bootT0)}ms`];
    if (bootTDom !== null) {
      parts.push(`dom ${Math.round(bootTDom - bootT0)}ms`);
    }
    // The catalog window as the loader itself measured it — outside
    // DOMContentLoaded now, so it gets its own reading.
    const cats = typeof catalogsState === "function" ? catalogsState() : null;
    if (cats && cats.done && typeof cats.readyMs === "number") {
      const failed = cats.failed.length ? ` (${cats.failed.length} failed)` : "";
      parts.push(`catalogs ${Math.round(cats.readyMs)}ms${failed}`);
    }
    // Each stage runs until the next one is announced, the last until now.
    bootStages.forEach((stage, i) => {
      const until = i + 1 < bootStages.length ? bootStages[i + 1].t : end;
      parts.push(`${String(stage.label).replace(/[…:]\s*$/, "")} ${Math.round(until - stage.t)}ms`);
    });
    parts.push(`total ${Math.round(end)}ms`);
    console.info(`[boot] ${parts.join(" · ")}`);

    // The render pass is one stage but twenty tables, and the slow start is
    // always two or three of them (js/app.js renderPassCost).
    const cost = typeof renderPassCost !== "undefined" ? renderPassCost : null;
    if (cost && Object.keys(cost).length) {
      const worst = Object.entries(cost)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([id, ms]) => `${id} ${ms}ms`);
      console.info(`[boot] slowest tables: ${worst.join(" · ")}`);
    }
  } catch (e) {
    /* a diagnostic must never break boot */
  }
}

// Marks the end of the document parse — NOT the catalogs any more: they load
// after first paint (js/catalog-loader.js) and report their own reading
// through catalogsState(). Registered here, at the top of the document, so the
// mark is taken however boot turns out.
if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("DOMContentLoaded", () => {
    bootTDom = typeof performance !== "undefined" ? performance.now() : 0;
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { bootStage, bootFinish };
}
