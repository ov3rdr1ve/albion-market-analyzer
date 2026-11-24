/**
 * Test: renderAllTables() must call renderLaborersTable.
 *
 * Bug: the Laborers section was scanned + rendered exclusively from
 * scan-handlers.js (its own scan button), and `renderAllTables` — the path
 * the price-edit commit and other re-render triggers go through — never
 * touched it. Result: editing the Filled Cost or Empty Sell cell saved the
 * override + city-force correctly, but the cell never re-rendered. The
 * editor's <select>/<input>/buttons stayed in the DOM (with `.pe-editing`
 * removed but no innerHTML restoration), so the user saw a "stuck" editor
 * and the displayed value was stale.
 *
 * Black-box: load app.js's renderAllTables source and assert it contains
 * `renderLaborersTable(data)` alongside the other render-pass entries.
 * Source-string assertions are usually a weak signal, but here the bug was
 * specifically a missing line in a long call list — a string-level test
 * catches the regression without setting up a real DOM.
 *
 * Run: node tests/render-all-tables-includes-laborers.test.cjs
 */

const assert = require("assert");
const { appSource } = require("./helpers/app-source.cjs");
const fs = require("fs");
const path = require("path");

const appSrc = appSource();

// Extract just the renderAllTables function body so unrelated text in app.js
// (e.g. comments mentioning laborers elsewhere) can't satisfy the assertion.
const fnStart = appSrc.indexOf("function renderAllTables(data) {");
assert.ok(fnStart >= 0, "renderAllTables(data) must be defined in app.js");

// Walk braces to find matching close. Cheap manual scan — adequate for a
// curly-brace JavaScript function with no template literals in the way.
let depth = 0;
let fnEnd = -1;
for (let i = fnStart + "function renderAllTables(data) ".length; i < appSrc.length; i++) {
  const ch = appSrc[i];
  if (ch === "{") depth++;
  else if (ch === "}") {
    depth--;
    if (depth === 0) { fnEnd = i + 1; break; }
  }
}
assert.ok(fnEnd > fnStart, "renderAllTables body braces did not close");
const fnBody = appSrc.slice(fnStart, fnEnd);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("\n=== renderAllTables wiring ===");

// The per-table calls live in renderCalls(), and the order they run in is
// RENDER_ORDER — one list shared by the synchronous pass and the chunked boot
// pass (js/render-schedule.js), so neither can drift from the other.
const callsStart = appSrc.indexOf("function renderCalls(data) {");
assert.ok(callsStart >= 0, "renderCalls(data) must be defined in app.js");
const callsBody = appSrc.slice(callsStart, appSrc.indexOf("\n}", callsStart));
const orderStart = appSrc.indexOf("const RENDER_ORDER = [");
assert.ok(orderStart >= 0, "RENDER_ORDER must be declared in app.js");
const orderBody = appSrc.slice(orderStart, appSrc.indexOf("];", orderStart));

test("renderCalls maps laborers-table to renderLaborersTable(data)", () => {
  assert.match(
    callsBody,
    /"laborers-table":\s*\(\)\s*=>\s*renderLaborersTable\(data\)/,
    "renderCalls must draw renderLaborersTable(data) like its peers",
  );
});

test("laborers-table is in the draw order", () => {
  assert.ok(orderBody.includes('"laborers-table"'), "RENDER_ORDER must list laborers-table");
});

test("every gated renderer runs inside a try/catch", () => {
  const timedStart = appSrc.indexOf("function timedRender(tableId, name, render) {");
  assert.ok(timedStart >= 0, "timedRender must be defined in app.js");
  assert.match(
    appSrc.slice(timedStart, appSrc.indexOf("\n}", timedStart)),
    /try \{ render\(\); \} catch/,
    "timedRender must contain the per-table try/catch",
  );
});

test("renderAllTables guards against open editor (pe-editing / ve-editing)", () => {
  // Defensive: the early-return that prevents re-renders during an open
  // editor must remain — otherwise the laborer render call would destroy
  // an editor the user is mid-typing in.
  assert.match(
    fnBody,
    /\.pe-editing/,
    "renderAllTables must skip when .pe-editing is present",
  );
  assert.match(
    fnBody,
    /\.ve-editing/,
    "renderAllTables must skip when .ve-editing is present",
  );
});

test("Every render-pass peer is still wired (regression net)", () => {
  // If a future refactor accidentally drops one of these, the laborer fix
  // pattern (commit → renderAllTables) will silently break again.
  const peers = [
    "renderRollingTable(data)",
    "renderCraftingTable(data)",
    "renderFlippingTable(data)",
    "renderTransportTable(data)",
    "renderConsumableTable(data)",
    "renderMountsTable(data)",
    "renderFactionSpendingTable(data)",
    "renderFarmingTable(data)",
    "renderLaborersTable(data)",
    "renderVolumeTable(data)",
    "renderEnchantingTable(data)",
    "renderTransmuteTable(data)",
  ];
  for (const p of peers) {
    assert.ok(
      callsBody.includes(p),
      `renderCalls must call ${p}`,
    );
  }
  // …and each of those tables must actually be scheduled.
  const ids = [...callsBody.matchAll(/"([a-z-]+-table)":/g)].map((m) => m[1]);
  // The boards are not in RENDER_ORDER — they are appended from BOARD_TABLES,
  // which is read here rather than transcribed so a fourth board cannot fail
  // this net for the wrong reason.
  const scheduleSrc = fs.readFileSync(
    path.join(__dirname, "..", "js", "render-schedule.js"), "utf8",
  );
  const boardLine = scheduleSrc.match(/const BOARD_TABLES = \[([^\]]*)\]/);
  assert.ok(boardLine, "BOARD_TABLES not found in js/render-schedule.js");
  const scheduled = new Set([
    ...[...orderBody.matchAll(/"([a-z-]+-table)"/g)].map((m) => m[1]),
    ...[...boardLine[1].matchAll(/"([a-z-]+-table)"/g)].map((m) => m[1]),
    "craft-list-table",
  ]);
  for (const id of ids) {
    assert.ok(scheduled.has(id), `${id} has a renderer but is never drawn`);
  }
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
