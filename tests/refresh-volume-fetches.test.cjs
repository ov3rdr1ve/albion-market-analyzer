/**
 * Test: "Refresh Volume" button must actually fetch fresh prices+history
 * before re-rendering. Previously the click handler only called
 * renderVolumeTable(lastMarketData) with no fetch, so clicking the button
 * had no visible effect (the volume numbers never changed because the
 * underlying data was identical).
 *
 * String-level assertion against js/scan-handlers.js — the wiring lives in
 * a single block (`scan-volume-btn`) so we just check the relevant calls
 * appear in the right order.
 *
 * Run: node tests/refresh-volume-fetches.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(
  path.join(__dirname, "..", "js", "scan-handlers.js"),
  "utf8",
);

function sliceVolumeBlock(src) {
  const marker = 'document.getElementById("scan-volume-btn")';
  const start = src.indexOf(marker);
  assert.ok(start >= 0, "scan-volume-btn block must exist");
  let depth = 0;
  let braceStart = -1;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") { if (braceStart < 0) braceStart = i; depth++; }
    else if (ch === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error("could not find end of scan-volume-btn block");
}

const block = sliceVolumeBlock(src);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("\n=== scan-handlers.js — Refresh Volume actually refetches ===");

test("click handler is async (await needed for fetch)", () => {
  assert.ok(
    /addEventListener\("click",\s*async/.test(block),
    "click listener must be async to await the fetch",
  );
});

test("handler calls fetchPricesBatch on click", () => {
  assert.ok(
    block.includes("fetchPricesBatch("),
    "Refresh Volume must invoke fetchPricesBatch — otherwise no new data is pulled",
  );
});

test("fetched ids come from the volume table's cached rows", () => {
  // Browser measurement: refetching all 9k lastMarketData keys took 90+s.
  // The handler must scope the fetch to items visible in the volume table
  // (tableState["volume-table"].data) — typically a few hundred items.
  assert.ok(
    /tableState\["volume-table"\]\?\.data/.test(block),
    "handler must read items from tableState['volume-table'].data, not the whole lastMarketData",
  );
  assert.ok(
    /\.map\(\(r\)\s*=>\s*r\.itemId\)/.test(block),
    "should project the cached rows down to itemIds before fetching",
  );
});

test("falls back to lastMarketData keys only if the cache is empty", () => {
  // Safety net for the very first click before renderVolumeTable cached
  // anything — without a fallback we'd send an empty fetch.
  assert.ok(
    /Object\.keys\(lastMarketData\)/.test(block),
    "must have a fallback to lastMarketData keys when no cached rows exist",
  );
  assert.ok(
    /idsFromTable[\s\S]{0,80}length\s*>\s*0[\s\S]{0,80}Object\.keys\(lastMarketData\)/.test(block),
    "fallback should only kick in when the cached row list is empty",
  );
});

test("fetched data is merged back into lastMarketData", () => {
  // applyScanPatch (captured-prices-store.js) is Object.assign plus a fold of
  // the monitor's captures back on top, so a scan can't erase captured cities.
  assert.ok(
    /applyScanPatch\(lastMarketData,\s*data\)/.test(block),
    "fresh price+history must overwrite the stale entries in lastMarketData",
  );
});

test("renderVolumeTable runs after the fetch", () => {
  const fetchIdx = block.indexOf("fetchPricesBatch(");
  const renderIdx = block.indexOf("renderVolumeTable(");
  assert.ok(fetchIdx >= 0 && renderIdx >= 0, "both calls must exist");
  assert.ok(
    fetchIdx < renderIdx,
    "render must come AFTER fetch — otherwise we render stale data again",
  );
});

test("button is disabled during the in-flight fetch", () => {
  assert.ok(
    /volBtn\.disabled\s*=\s*true/.test(block),
    "button should be disabled while scanning to prevent double-clicks",
  );
});

test("button text shows progress and is restored on finish", () => {
  assert.ok(
    /volBtn\.textContent\s*=\s*"Scanning\.\.\."/.test(block),
    "show 'Scanning...' while the fetch is in flight",
  );
  assert.ok(
    /volBtn\.textContent\s*=\s*"Refresh Volume"/.test(block),
    "restore 'Refresh Volume' label when done",
  );
});

test("button gets a .scanning class for the CSS pulse/spinner", () => {
  // Text alone flashes by too fast on small fetches. The .scanning class drives
  // a CSS pulse + spinner that makes the active state unmissable.
  assert.ok(
    /volBtn\.classList\.add\("scanning"\)/.test(block),
    "must add the .scanning class so the CSS spinner shows",
  );
  assert.ok(
    /volBtn\.classList\.remove\("scanning"\)/.test(block),
    "must remove .scanning in finally so the visual state clears on done/fail",
  );
});

test("fast fetches honour a minimum-visible duration", () => {
  // Without this, a 100ms fetch flashes the spinner so briefly the user
  // genuinely can't see it. Hold the scanning state for ~700ms minimum.
  assert.ok(
    /MIN_VISIBLE_MS/.test(block),
    "should define a minimum-visible duration constant",
  );
  assert.ok(
    /setTimeout\([\s\S]{0,80}MIN_VISIBLE_MS\s*-\s*elapsed/.test(block),
    "should sleep for the remaining min-visible time after the fetch returns",
  );
});

test("fetch errors surface via showFetchError instead of failing silently", () => {
  assert.ok(
    /catch[\s\S]*showFetchError/.test(block),
    "must call showFetchError on failure — otherwise the user sees a stuck 'Scanning...' button",
  );
});

test("button is enabled up front (no longer gated behind a prior scan)", () => {
  // Previously gated via `volBtn.disabled = !lastMarketData`, which left the
  // button a silent dead end on a fresh page. It is now always clickable.
  assert.ok(
    /volBtn\.disabled\s*=\s*false/.test(block),
    "button must start enabled so a first click does something",
  );
  assert.ok(
    !/volBtn\.disabled\s*=\s*!lastMarketData/.test(block),
    "the old `disabled = !lastMarketData` gate must be gone",
  );
});

test("with no data, click bootstraps a full market scan", () => {
  // The self-sufficient behavior: a click before any scan must kick off the
  // same full scan as "Scan Market Now" (which renders the volume table),
  // rather than returning early and doing nothing.
  assert.ok(
    /if\s*\(\s*!lastMarketData\s*\)\s*\{/.test(block),
    "handler must branch on the no-data case (not just early-return)",
  );
  assert.ok(
    /window\.runMarketScan|getElementById\("scan-trigger"\)/.test(block),
    "no-data branch must invoke the full market scan (runMarketScan / scan-trigger)",
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
