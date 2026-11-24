/**
 * Test: collapsible-table headers must NOT collapse when the user interacts
 * with a control that lives inside the <h2> (Refresh/Scan buttons, the volume
 * search input, the faction <select> + its wrapping <label>).
 *
 * Regression: the header click handler originally exempted only <button>, so
 * focusing the volume search box or opening the faction dropdown bubbled up and
 * toggled the collapse — minimizing the table out from under the user. The fix
 * widens the exemption to all interactive header controls.
 *
 * jsdom isn't vendored here, so this asserts the exemption selector at the
 * source level (same style as refresh-volume-fetches.test.cjs). The live
 * click-bubbling behavior was verified separately in-browser.
 *
 * Run: node tests/header-controls-no-collapse.test.cjs
 */

const assert = require("assert");
const { appSource } = require("./helpers/app-source.cjs");

const src = appSource();

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// Grab the h2 click handler registered in setupCollapsibleTables.
const handlerMatch = src.match(/h2\.addEventListener\(\s*"click"[\s\S]*?\}\s*\)\s*;/);
assert.ok(handlerMatch, "could not locate the h2 click handler in app.js");
const handler = handlerMatch[0];

// The exemption guard: `if (e.target.closest("…")) return;`
const exemptMatch = handler.match(/\.closest\(\s*"([^"]+)"\s*\)/);
assert.ok(exemptMatch, "header click handler must guard with e.target.closest(<selector>)");
const exemptTokens = exemptMatch[1].split(",").map((s) => s.trim()).filter(Boolean);

console.log("\n=== header click exemption covers interactive controls ===");
// Every control type that can appear inside a collapsible <h2> must be exempt.
// button → Refresh/Scan; input → volume search; select → faction filter;
// label → the faction <select>'s wrapper; textarea → future-proofing.
["button", "input", "select", "textarea", "label"].forEach((tag) => {
  test(`exempts <${tag}>`, () => {
    assert.ok(
      exemptTokens.includes(tag),
      `clicking a <${tag}> in a header must not collapse the table — add "${tag}" to the closest() guard`,
    );
  });
});

console.log("\n=== regression + feature preservation ===");

test("the old button-only exemption is gone", () => {
  // `closest("button")` with nothing else would re-introduce the bug.
  assert.ok(
    !/\.closest\(\s*"button"\s*\)/.test(handler),
    "handler must not exempt ONLY <button> (that was the original bug)",
  );
});

test("guard returns early (does not fall through to collapse)", () => {
  assert.ok(
    /\.closest\([^)]*\)\s*\)\s*return\s*;/.test(handler),
    "the closest() guard must `return;` so exempt clicks skip the collapse toggle",
  );
});

test("non-control clicks still toggle the collapse", () => {
  assert.ok(
    /setCollapsed\(/.test(handler),
    "handler must still call setCollapsed for title clicks — collapse feature must survive",
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
