/**
 * Test: EVERY scan button shows the same style + animation as the Refresh
 * Volume button — the `.scanning` CSS class (blue pulse + spinner) plus a
 * minimum-visible hold so quick fetches don't flash by.
 *
 * Background: only the Refresh Volume button used to add the `.scanning` class.
 * The other scan buttons (the 11 per-table buttons wired via wrapScanButton,
 * the Rerolling button, and the master "Scan Market Now" button) merely
 * swapped their text to "Scanning..." — no pulse, no spinner. This test pins
 * the shared animation across all of them.
 *
 * String-level assertions against the source, mirroring the approach in
 * refresh-volume-fetches.test.cjs (the handlers live in single blocks, so we
 * check the relevant calls appear).
 *
 * Run: node tests/scan-buttons-scanning-animation.test.cjs
 */

const assert = require("assert");
const { appSource } = require("./helpers/app-source.cjs");
const fs = require("fs");
const path = require("path");

// Row text runs through tx(english, slug); en-mode identity keeps assertions in English.
globalThis.tx = globalThis.tx || ((en) => en);

const scanSrc = fs.readFileSync(
  path.join(__dirname, "..", "js", "scan-handlers.js"),
  "utf8",
);
const appSrc = appSource();
const { readStyles } = require("./helpers/page-source.cjs");
const cssSrc = readStyles();

// Slice a brace-balanced block starting at the first occurrence of `marker`.
// `marker` should land on/just before the opening line of the construct; the
// returned slice runs from there to the matching close brace.
function sliceBlock(src, marker) {
  const start = src.indexOf(marker);
  assert.ok(start >= 0, `block marker not found: ${marker}`);
  let depth = 0;
  let seenBrace = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") { seenBrace = true; depth++; }
    else if (ch === "}") { depth--; if (seenBrace && depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`could not find end of block: ${marker}`);
}

const wrapBlock = sliceBlock(scanSrc, "function wrapScanButton(");
const runScanBlock = sliceBlock(appSrc, "const runScan = async ()");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// ─── Shared helper: wrapScanButton (covers all per-table scan buttons) ───────
console.log("\n=== wrapScanButton — shared .scanning animation ===");

test("adds the .scanning class on click", () => {
  assert.ok(
    /btn\.classList\.add\("scanning"\)/.test(wrapBlock),
    "wrapScanButton must add the .scanning class so the CSS pulse/spinner shows",
  );
});

test("removes the .scanning class in finally", () => {
  // Must clear on BOTH success and failure, hence in the finally block.
  assert.ok(
    /btn\.classList\.remove\("scanning"\)/.test(wrapBlock),
    "wrapScanButton must remove .scanning so the visual state clears on done/fail",
  );
  const removeIdx = wrapBlock.indexOf('classList.remove("scanning")');
  const finallyIdx = wrapBlock.indexOf("finally");
  assert.ok(
    finallyIdx >= 0 && removeIdx > finallyIdx,
    "the .scanning removal must live in the finally block (clears even on error)",
  );
});

test("honours a minimum-visible duration so fast fetches don't flash by", () => {
  assert.ok(
    /SCAN_MIN_VISIBLE_MS/.test(scanSrc),
    "should define a minimum-visible duration constant",
  );
  assert.ok(
    /setTimeout\([\s\S]{0,80}SCAN_MIN_VISIBLE_MS\s*-\s*elapsed/.test(wrapBlock),
    "should sleep for the remaining min-visible time after the fetch returns",
  );
});

test("still disables the button and shows 'Scanning...' text", () => {
  assert.ok(/btn\.disabled\s*=\s*true/.test(wrapBlock), "button disabled while in flight");
  // The label goes through tx("Scanning...", slug) so it localizes; the English
  // literal is still the source of truth for the en-mode text.
  assert.ok(
    /btn\.textContent\s*=\s*(tx\(\s*)?"Scanning\.\.\."/.test(wrapBlock),
    "shows Scanning... text",
  );
});

test("errors still surface via showFetchError (animation cleared in finally)", () => {
  assert.ok(/catch[\s\S]*showFetchError/.test(wrapBlock), "must report fetch errors");
});

// ─── Every per-table button is routed through the animated helper ───────────
console.log("\n=== All per-table scan buttons use wrapScanButton ===");

const WRAPPED_BUTTON_IDS = [
  "scan-rolling-btn",
  "scan-crafting-btn",
  "scan-flipping-btn",
  "scan-laborers-btn",
  "scan-transport-btn",
  "scan-consumable-btn",
  "scan-mounts-btn",
  "scan-faction-spending-btn",
  "scan-farming-btn",
  "scan-transmute-btn",
  "scan-enchanting-btn",
  "scan-rerolling-btn",
  "scan-journals-btn",
  "scan-bm-board-btn",
];

WRAPPED_BUTTON_IDS.forEach((id) => {
  test(`${id} is wired via wrapScanButton (inherits the animation)`, () => {
    const re = new RegExp(`wrapScanButton\\(\\s*["']${id}["']`);
    assert.ok(re.test(scanSrc), `${id} must be wired through wrapScanButton`);
  });
});

test("Rerolling no longer has its own standalone (un-animated) handler", () => {
  // It was previously a bespoke scanRerollBtn.addEventListener block with no
  // .scanning class. Folding it into wrapScanButton is what gives it the pulse.
  assert.ok(
    !/scanRerollBtn/.test(scanSrc),
    "the old standalone scanRerollBtn handler must be gone (now uses wrapScanButton)",
  );
});

// ─── Master "Scan Market Now" button (app.js) ───────────────────────────────
console.log("\n=== Scan Market Now (app.js) shares the animation ===");

test("runScan adds the .scanning class", () => {
  assert.ok(
    /scanBtn\.classList\.add\("scanning"\)/.test(runScanBlock),
    "the master scan button must add .scanning for the same pulse/spinner",
  );
});

test("runScan removes the .scanning class in finally", () => {
  assert.ok(
    /scanBtn\.classList\.remove\("scanning"\)/.test(runScanBlock),
    "the master scan button must clear .scanning when done",
  );
  const removeIdx = runScanBlock.indexOf('classList.remove("scanning")');
  const finallyIdx = runScanBlock.indexOf("finally");
  assert.ok(
    finallyIdx >= 0 && removeIdx > finallyIdx,
    "removal must be in finally so it clears even if the scan throws",
  );
});

// ─── The shared CSS animation actually exists ───────────────────────────────
console.log("\n=== .scanning CSS (pulse + spinner) is defined ===");

test("button.scanning pulses via the scanning-pulse keyframes", () => {
  assert.ok(/@keyframes\s+scanning-pulse/.test(cssSrc), "scanning-pulse keyframes must exist");
  assert.ok(
    /button\.scanning\s*\{[\s\S]*animation:\s*scanning-pulse/.test(cssSrc),
    "button.scanning must run the scanning-pulse animation",
  );
});

test("button.scanning shows a spinner via ::after", () => {
  assert.ok(
    /button\.scanning::after\s*\{[\s\S]*animation:\s*spin/.test(cssSrc),
    "button.scanning::after must render the spinning indicator",
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
