/**
 * Every way the price editor can strand its popup on screen (js/app.js).
 *
 * Two reported bugs pin the contract here:
 *
 *   1. The city <select> was never wired into the close system. The popup
 *      closes on Escape (keydown) and on focus leaving the cell (blur →
 *      commitIfFocusLeaves), but those listeners were attached only to the
 *      four price inputs and the two buttons. Once focus sat on the city
 *      dropdown — open it, pick a city, click away — Escape did nothing,
 *      the click-away did nothing, and the async render pass stays gated
 *      on .pe-editing forever: a full-content phantom popup nothing
 *      dismisses except opening another price cell.
 *
 *   2. No close path was exception-safe. commit() sets _committing = true
 *      FIRST, then persists (localStorage writes throw on quota/security)
 *      and evaluates rerenderAfterEdit(...) as an ARGUMENT of restoreCell —
 *      so a throw skips the restore entirely and _committing blocks every
 *      retry. The popup sits there with dead controls.
 *
 * Source-level black box, the technique used by
 * tests/price-edit-async-rerender.test.cjs: no DOM, no Electron, no
 * catalogs — the file itself is the fixture.
 *
 * Run: node tests/price-editor-close-paths.test.cjs
 */

const assert = require("assert");
const { appSource } = require("./helpers/app-source.cjs");

const appSrc = appSource();

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

/** The body of a `const name = ` arrow function, up to its `};`. */
function arrowBody(name) {
  const start = appSrc.indexOf(`const ${name} = `);
  assert.ok(start >= 0, `${name} must be defined in app.js`);
  const end = appSrc.indexOf("\n    };", start);
  assert.ok(end > start, `${name} must be an indented arrow function`);
  return appSrc.slice(start, end);
}

/** A body is exception-safe for the popup when restoreCell runs in a finally. */
function assertRestoreInFinally(body, label) {
  const fin = body.indexOf("} finally {");
  assert.ok(fin >= 0, `${label} must have a finally block`);
  const restore = body.indexOf("restoreCell(", fin);
  assert.ok(restore >= 0, `${label} restores the cell inside the finally`);
  assert.ok(
    !/restoreCell\((changed|removed|rerendering) \? /.test(body),
    `${label} must not evaluate rerenderAfterEdit as a restoreCell argument`,
  );
}

// ── the city select is part of the close system ─────────────────────────────

test("the city select gets the same keydown/blur close wiring as the inputs", () => {
  assert.match(
    appSrc,
    /\[buyInput, sellInput, buyCheck, sellCheck, select\]\.forEach/,
    "select is in the keydown + blur wiring list",
  );
});

// ── no close path can strand the popup on a throw ───────────────────────────

test("commit() restores the cell even when persisting throws", () => {
  const body = arrowBody("commit");
  assert.match(body, /const \{ changed \} = persistOverrides\(/, "still persists");
  assert.match(body, /if \(changed\)/, "still redraws only on a real change");
  assertRestoreInFinally(body, "commit()");
});

test("closeQuietly() restores the cell even when persisting throws", () => {
  const start = appSrc.indexOf("closeQuietly: () => {");
  assert.ok(start >= 0, "closeQuietly must exist");
  const body = appSrc.slice(start, appSrc.indexOf("\n      },", start));
  assertRestoreInFinally(body, "closeQuietly()");
});

test("the clear button restores the cell even when clearing throws", () => {
  const start = appSrc.indexOf('clearBtn.addEventListener("click"');
  assert.ok(start >= 0, "the clear handler must exist");
  const body = appSrc.slice(start, appSrc.indexOf("\n    });", start));
  assert.match(body, /if \(clearOverridePriceAllCities\(id\)\) removed = true/);
  assertRestoreInFinally(body, "the clear handler");
});

test("no close path anywhere still evaluates the rerender inline", () => {
  assert.ok(
    !/restoreCell\((changed|removed) \? /.test(appSrc),
    "the argument-evaluated restoreCell pattern is gone",
  );
});

test("the popup cleanup helpers are still unconditional", () => {
  const body = arrowBody("restoreCell");
  const rm = body.indexOf("container.remove()");
  const bail = body.indexOf("if (!td.isConnected) return;");
  assert.ok(rm >= 0 && bail >= 0 && rm < bail, "popup removed before the bail-out");
});

// ── a row swap cannot orphan a live editor ──────────────────────────────────

test("updateSingleRow closes an open editor before it replaces the row", () => {
  const start = appSrc.indexOf("function updateSingleRow(");
  assert.ok(start >= 0, "updateSingleRow must be defined");
  const body = appSrc.slice(start, appSrc.indexOf("\n}", start));
  const sweep = body.indexOf(".pe-editing");
  const swap = body.indexOf("replaceWith(");
  assert.ok(sweep >= 0, "the row swap looks for an open editor");
  assert.ok(sweep < swap, "and closes it BEFORE the replaceWith");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
