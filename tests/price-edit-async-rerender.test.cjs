/**
 * The price editor's commit path is asynchronous (js/app.js).
 *
 * Committing a price used to call renderAllTables() inline — one synchronous
 * block that froze the window for a second or more, with the popup still on
 * screen and the app dead to every click. It now hands the work to
 * js/render-async.js, which draws the same tables in phases.
 *
 * Three things about that switch are easy to undo by accident and expensive to
 * notice, so they are pinned here:
 *
 *   1. `_suppressSort` must be scoped to ONE renderer. It tells js/sorting.js
 *      to keep the previous row order, and the same flag is read when the user
 *      clicks a column header — so holding it across a yield would silently
 *      swallow a sort click made while the pass runs.
 *
 *   2. The cell must be restored on EVERY close path. The synchronous redraw
 *      used to wipe the tbody one statement later, so leaving the editor markup
 *      behind was harmless; now it would sit on screen for the whole pass, and
 *      the Escape path (which blanked the cell) would leave a hole.
 *
 *   3. The Quality-Rerolling-only branch, where lastMarketData is still null,
 *      must stay ungated — it is the only way a quality override ever shows.
 *
 * Source-level black box, the technique used by
 * tests/render-all-tables-includes-laborers.test.cjs: no DOM, no Electron, no
 * catalogs — the file itself is the fixture.
 *
 * Run: node tests/price-edit-async-rerender.test.cjs
 */

const assert = require("assert");
const { appSource } = require("./helpers/app-source.cjs");
const fs = require("fs");
const path = require("path");
const { readIndexHtml } = require("./helpers/page-source.cjs");

const appSrc = appSource();

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

/** The body of a top-level `function name(` … up to its closing brace. */
function fnBody(name) {
  const start = appSrc.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must be defined in app.js`);
  const end = appSrc.indexOf("\n}", start);
  assert.ok(end > start, `${name} must be a top-level function`);
  return appSrc.slice(start, end);
}

/** The body of a `const name = ` arrow function, up to its `};`. */
function arrowBody(name) {
  const start = appSrc.indexOf(`const ${name} = `);
  assert.ok(start >= 0, `${name} must be defined in app.js`);
  const end = appSrc.indexOf("\n    };", start);
  assert.ok(end > start, `${name} must be an indented arrow function`);
  return appSrc.slice(start, end);
}

// ── the commit path ────────────────────────────────────────────────────────

test("the edit path schedules a pass instead of rendering everything inline", () => {
  const body = arrowBody("rerenderAfterEdit");
  assert.match(body, /scheduleRerender\(\s*"price-edit"/, "calls scheduleRerender");
  assert.ok(!/renderAllTables\(/.test(body), "no synchronous full pass");
});

test("the edited table is named, so it is drawn before all the others", () => {
  assert.match(arrowBody("rerenderAfterEdit"), /priorityTableId:/);
});

test("the row anchor is re-applied on every phase, not once", () => {
  const body = arrowBody("rerenderAfterEdit");
  assert.match(body, /createAnchorRestorer\(/, "uses js/scroll-anchor.js");
  assert.match(body, /onPhase:/, "hooked to the phases");
  // The hook also carries the pending-edit mark now (js/pending-edit-mark.js),
  // so match the call rather than the exact one-line arrow it used to be.
  assert.match(body, /onPhase:[\s\S]*reapply\(\)/, "re-applied per phase");
});

test("the old inline anchor helpers are gone — one implementation only", () => {
  assert.ok(!/const restoreAnchor = /.test(appSrc), "restoreAnchor was extracted");
  assert.ok(!/CSS\.escape\(a\.key\)/.test(appSrc), "the inline selector build is gone");
});

test("every close path puts the cell back", () => {
  // commit(), Escape and the ✗ clear button. Three call sites, no conditions on
  // whether a redraw happened — that is the whole point.
  const calls = appSrc.match(/restoreCell\(/g) || [];
  assert.ok(calls.length >= 4, `restoreCell defined and called at least 3× (saw ${calls.length})`);
  assert.ok(!/td\.innerHTML = "";/.test(appSrc), "Escape no longer blanks the cell");
});

test("the restore is unconditional — no `&& !rerendered` left anywhere", () => {
  assert.ok(!/!rerendered/.test(appSrc), "no rerender-conditional cell restore");
});

test("closing for another editor asks for the redraw the abort skipped", () => {
  const start = appSrc.indexOf("closeQuietly: () => {");
  assert.ok(start >= 0, "closeQuietly must exist");
  const body = appSrc.slice(start, appSrc.indexOf("\n      },", start));
  assert.match(body, /scheduleRerender\(\s*"editor-closed"/);
});

// ── the popup never outlives its close path ────────────────────────────────
//
// The popup is a DOM child of the edited cell, and the craft list harvests
// live rows by cloneNode (js/render-craft-list.js _clHeldRows). Any close path
// that leaves the markup behind — a re-render detached the cell, the class was
// stripped before the restore — parks the editor's inputs (one of them
// defaulting to "0") in that cache, and the next mid-pass render re-injects
// them as a phantom input.

test("the popup carries a stable class any sweeper can find", () => {
  assert.match(appSrc, /container\.className = "pe-popup"/);
});

test("restoreCell removes the popup before anything can bail out", () => {
  const body = arrowBody("restoreCell");
  const rm = body.indexOf("container.remove()");
  assert.ok(rm >= 0, "the popup node is removed explicitly");
  const bail = body.indexOf("if (!td.isConnected) return;");
  assert.ok(bail >= 0, "a detached cell still skips the markup swap");
  assert.ok(rm < bail, "but the popup is gone BEFORE that bail-out");
  assert.ok(!/querySelector\("select"\)/.test(body),
    "the silent no-editor guard is gone — cleanup is unconditional");
});

test("the orphan sweep finds popups by markup, not only by class", () => {
  assert.ok(
    appSrc.includes('document.querySelectorAll("td.price-editable select, td .pe-popup")'),
    "the orphan sweep covers class-less popup leftovers",
  );
});

test("the craft list closes any open editor before it harvests rows", () => {
  const clSrc = fs.readFileSync(path.join(__dirname, "..", "js", "render-craft-list.js"), "utf8");
  assert.ok(clSrc.includes("function _clCloseOpenEditors("), "a close-editor sweep exists");
  const fnStart = clSrc.indexOf("function renderCraftListTable(");
  const harvest = clSrc.indexOf("_clHeldRows(", fnStart);
  const sweepCall = clSrc.indexOf("_clCloseOpenEditors(", fnStart);
  assert.ok(sweepCall > -1 && sweepCall < harvest, "called before _clHeldRows");
});

test("the held-row harvest reverts editors by markup, not just the class marker", () => {
  const clSrc = fs.readFileSync(path.join(__dirname, "..", "js", "render-craft-list.js"), "utf8");
  const fn = clSrc.indexOf("function _clHeldRows(");
  const body = clSrc.slice(fn, clSrc.indexOf("\n}", fn));
  assert.match(body, /\.pe-popup/, "popup markup is looked for directly");
  assert.match(body, /_oldHtml != null/, "restore needs the saved markup");
  assert.match(body, /querySelectorAll\("\.pe-popup"\)[\s\S]*remove/,
    "no _oldHtml: the popup is stripped instead of cached");
});

// ── no change, no pass ─────────────────────────────────────────────────────
//
// A pass is seconds of work across every open table. The editor opens on a
// click and closes on a dozen gestures, most of which store nothing at all —
// reading a cell's order book and clicking away, pressing Escape, clearing a
// cell that carried no override. Each of those used to raise the
// "Recalculating…" pill for numbers that could not have moved.

test("the commit path compares what is STORED, before and after", () => {
  const body = arrowBody("persistOverrides");
  assert.match(body, /const before = storedSnapshot\(/, "snapshots before writing");
  assert.match(body, /changed: storedSnapshot\([\s\S]*!== before/, "reports whether it moved");
});

test("the snapshot covers both order fields, the pin and both city forces", () => {
  const body = arrowBody("storedSnapshot");
  assert.match(body, /getOverrideField\(id, selectedCity, "buy"\)/);
  assert.match(body, /getOverrideField\(id, selectedCity, "sell"\)/);
  assert.match(body, /getOverrideUse/);
  assert.match(body, /getCityForce\(id, "buy"\)/);
  assert.match(body, /getCityForce\(id, "sell"\)/);
});

test("commit redraws only when the commit actually changed something", () => {
  const body = arrowBody("commit");
  assert.match(body, /const \{ changed \} = persistOverrides\(/);
  // The pass is asked for inside the try, the cell restored in the finally —
  // a throwing persist must not strand the popup (see
  // tests/price-editor-close-paths.test.cjs).
  assert.match(body, /if \(changed\)/);
  assert.match(body, /\} finally \{/);
  assert.match(body, /restoreCell\(rerendering\)/);
});

test("Escape stores nothing, so it redraws nothing", () => {
  const start = appSrc.indexOf('if (ev.key === "Escape")');
  assert.ok(start >= 0, "the Escape branch must exist");
  const body = appSrc.slice(start, appSrc.indexOf("\n      }", start));
  assert.match(body, /restoreCell\(false\)/, "the cell still comes back");
  assert.ok(!/rerenderAfterEdit\(\)/.test(body), "no pass for a cancel");
});

test("the clear button redraws only when it really deleted an override", () => {
  const start = appSrc.indexOf('clearBtn.addEventListener("click"');
  assert.ok(start >= 0, "the clear handler must exist");
  const body = appSrc.slice(start, appSrc.indexOf("\n    });", start));
  assert.match(body, /if \(clearOverridePriceAllCities\(id\)\) removed = true/);
  assert.match(body, /if \(clearCityForce\(id, s\)\) removed = true/);
  assert.match(body, /if \(removed\)/);
  assert.match(body, /\} finally \{/);
  assert.match(body, /restoreCell\(rerendering\)/);
});

test("the two clear helpers report whether they deleted anything", () => {
  const utilsSrc = ["utils", "utils-item-ids", "utils-overrides", "utils-focus-fees"].map((n) => fs.readFileSync(path.join(__dirname, "..", "js", n + ".js"), "utf8")).join("\n");
  const all = utilsSrc.slice(utilsSrc.indexOf("function clearOverridePriceAllCities("));
  assert.match(all.slice(0, 300), /return false;[\s\S]*return true;/,
    "clearOverridePriceAllCities reports the delete");
  const force = utilsSrc.slice(utilsSrc.indexOf("function clearCityForce("));
  assert.match(force.slice(0, 400), /return true;[\s\S]*return false;/,
    "clearCityForce reports the delete");
});

test("a quiet close asks for a pass only on a real change or a real debt", () => {
  const start = appSrc.indexOf("closeQuietly: () => {");
  const body = appSrc.slice(start, appSrc.indexOf("\n      },", start));
  assert.match(body, /deferredTableIds\(\)\.length > 0/, "reads the deferred ledger");
  assert.match(body, /if \(changed \|\| owed\) \{/);
  assert.match(body, /scheduleRerender\("editor-closed", owed \? \{\} : \{ itemIds: touched \}\)/,
    "a debt widens the pass; a plain quiet commit stays scoped to the item");
});

// ── the marks only claim work that is happening ────────────────────────────

test("a request parked behind an open editor takes the marks down", () => {
  const start = appSrc.indexOf("initRenderScheduler({");
  assert.ok(start >= 0, "the scheduler is installed in app.js");
  const body = appSrc.slice(start, appSrc.indexOf("\n  });", start));
  assert.match(body, /onHeld: \(\) => clearRecalcCellMark\(\)/);
});

test("a pass marks the tables it planned, scoped to the items that moved", () => {
  const start = appSrc.indexOf("initRenderScheduler({");
  const body = appSrc.slice(start, appSrc.indexOf("\n  });", start));
  assert.match(body, /onPassStart: \(\{ tableIds, itemIds \}\) => beginRecalcCellMark\(\{ tableIds, itemIds \}\)/);
  assert.match(body, /onTableDrawn: \(tableId\) => recalcCellMarkTableDone\(tableId\)/,
    "and a drawn table stops claiming to be pending");
});

test("the price-edit pass is asked with the items the commit touched", () => {
  assert.match(arrowBody("rerenderAfterEdit"), /itemIds,/,
    "the scope is handed to scheduleRerender");
  assert.match(appSrc, /const rerenderAfterEdit = \(itemIds\) =>/);
});

// ── sort suppression ───────────────────────────────────────────────────────

test("_suppressSort is scoped to a single renderer, never held across a yield", () => {
  const body = fnBody("drawOneTable");
  assert.match(body, /_suppressSort = true/);
  assert.match(body, /finally \{\s*\n\s*_suppressSort = false;/, "cleared in a finally");
  assert.ok(!/await/.test(body), "the synchronous path stays synchronous");
});

test("a chunked renderer suppresses only its paint, never its compute", () => {
  // The compute spans yields, during which the user may click a column header.
  // Only the single DOM write at the end is wrapped.
  const body = fnBody("drawOneTableChunked");
  assert.match(body, /paint: \(write\) => \{/);
  const paint = body.slice(body.indexOf("paint: (write)"), body.indexOf("},", body.indexOf("paint: (write)")));
  assert.match(paint, /_suppressSort = true/);
  assert.match(paint, /finally \{ _suppressSort = false; \}/);
  assert.ok(!/await/.test(paint), "no yield inside the suppressed window");
});

test("only the two draw helpers touch _suppressSort", () => {
  // A third writer would mean one pass could clear the flag under another.
  const sets = appSrc.match(/_suppressSort = true/g) || [];
  assert.strictEqual(sets.length, 2, `drawOneTable and drawOneTableChunked (saw ${sets.length})`);
  const drawStart = appSrc.indexOf("function drawOneTable(");
  const chunkedEnd = appSrc.indexOf("\n}", appSrc.indexOf("async function drawOneTableChunked("));
  const outside = appSrc.slice(0, drawStart) + appSrc.slice(chunkedEnd);
  assert.ok(!/_suppressSort = true/.test(outside), "both setters are inside the draw helpers");
});

// ── the plan ───────────────────────────────────────────────────────────────

test("the quality-only branch is hand-built and ungated", () => {
  const body = fnBody("planRerenderPass");
  const quality = body.slice(0, body.indexOf("const calls = renderCalls(lastMarketData)"));
  assert.match(quality, /lastQualityMarketData/, "the quality map is the trigger");
  assert.match(quality, /rerolling-table/, "rerolling is in the plan");
  assert.match(quality, /joined-summary-table/, "so is the summary that reads it");
  assert.ok(!/isTableHidden/.test(quality), "never gated on visibility");
});

test("a null price map means no pass at all", () => {
  assert.match(fnBody("planRerenderPass"), /if \(!lastQualityMarketData\) return null;/);
});

test("the normal branch reuses the boot planner, with the edited table first", () => {
  const body = fnBody("planRerenderPass");
  assert.match(body, /bootRenderSteps\(\{/);
  assert.match(body, /first: priorityTableId \? \[priorityTableId\] : \[\]/);
  assert.match(body, /isHidden: isTableHidden/, "same gating as renderAllTables");
  assert.match(body, /summarySources: JOINED_SUMMARY_SOURCES/);
});

test("tables the plan leaves out are still marked as owed", () => {
  assert.match(fnBody("planRerenderPass"), /markTableDeferred\(tableId\)/);
});

test("the craft list's sources are scheduled, not left inside its renderer", () => {
  // Measured: renderCraftListTable catching its sources up is 8.7 s in ONE
  // synchronous block — the longest freeze in the app, and the reason the
  // async pass was still visibly hanging until these became steps.
  const body = fnBody("planRerenderPass");
  assert.match(body, /craftListSourceTableIds\(\)/);
  assert.match(body, /listSources,/, "handed to the schedule");
  assert.match(body, /!isTableHidden\(CRAFT_LIST_TABLE\)/, "only while the panel is open");
});

// ── the wiring ─────────────────────────────────────────────────────────────

test("the scheduler is given the same open-editor guard renderAllTables has", () => {
  const body = fnBody("installRenderScheduler");
  assert.match(body, /\.pe-editing/);
  assert.match(body, /\.ve-editing/);
});

test("the pass token is a counter, not a boolean", () => {
  assert.match(appSrc, /function beginRenderPass\(\) \{\s*\n\s*return \+\+renderPassSeq;/);
  assert.ok(!/bootRenderCancelled/.test(appSrc), "the old shared boolean is gone");
});

test("boot cancels on the same token as everything else", () => {
  assert.match(fnBody("renderAllTablesBoot"), /cancelled: \(\) => !isCurrentRenderPass\(myPass\)/);
});

test("the marks are cleared only when a pass really finished", () => {
  const body = fnBody("installRenderScheduler");
  assert.match(body, /if \(superseded\) return;/, "a superseded pass must not clear the marks");
  assert.match(body, /clearRecalcCellMark\(\)/);
  assert.match(body, /pe-pending/, "and sweeps any cell still dimmed");
});

test("the scheduler is installed before anything can ask for a redraw", () => {
  const install = appSrc.indexOf("installRenderScheduler();");
  const domReady = appSrc.indexOf('document.addEventListener("DOMContentLoaded"');
  assert.ok(install > domReady, "installed inside DOMContentLoaded");
  assert.ok(
    install < appSrc.indexOf("loadOverridesFromStorage();", domReady),
    "and before the startup work that can trigger a redraw",
  );
});

test("the three new modules are actually loaded by the page", () => {
  const html = readIndexHtml();
  ["js/scroll-anchor.js", "js/recalc-cell-mark.js", "js/render-async.js"].forEach((src) => {
    assert.ok(html.includes(`src="${src}"`), `${src} is in index.html`);
  });
  // render-async reads RERENDER_PHASES out of render-schedule at load time.
  assert.ok(
    html.indexOf('src="js/render-schedule.js"') < html.indexOf('src="js/render-async.js"'),
    "render-schedule.js loads first",
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
