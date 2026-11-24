/**
 * Test: user-facing text carries no developer-only detail.
 *
 * The UI had leaked build/maintenance notes into the screen: a build script
 * command ("regenerate with node scripts/gen-roads-zones.cjs"), an internal id
 * pattern (UNIQUE_UNLOCK_…_VANITY_…), a patch number, and a status badge that
 * said "browser build". A regular user should never see any of it.
 *
 * Black-box over the shipped text: scan the files that produce on-screen
 * strings (index.html, the i18n tables, the renderers that write UI text) for
 * developer-only patterns. Source-code comments are stripped first — they are
 * not on screen.
 *
 * Run: node tests/ui-no-dev-strings.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { readIndexHtml } = require("./helpers/page-source.cjs");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

/** Strip // and block comments (JS) and <!-- --> comments (HTML). */
function stripComments(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

// Files whose text reaches the screen.
const UI_FILES = [
  "index.html",
  "js/i18n-strings-en.js",
  "js/i18n-strings-es.js",
  "js/render-roads.js",
];

// Developer-only patterns, with the user-facing reason each is banned.
const BANNED = [
  [/\bnode scripts\//, "a shell command to run a build script"],
  [/gen-roads-zones\.cjs/, "the name of a generator script"],
  [/\.cjs\b/, "a source file name"],
  [/browser build|desktop build/i, "an internal build-variant name"],
  [/UNIQUE_UNLOCK_|_VANITY_/, "a raw internal item id pattern"],
  [/\bpatch \d+\.\d+/i, "a game patch build number"],
  [/Catalog missing/i, "an internal data-file error"],
];

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("\n=== no developer-only text in the UI ===");

UI_FILES.forEach((file) => {
  const text = stripComments(file === "index.html" ? readIndexHtml() : read(file));
  BANNED.forEach(([pattern, why]) => {
    test(`${file} shows no ${why}`, () => {
      const hit = text.match(pattern);
      assert.ok(
        !hit,
        `${file} still shows ${why}: "${hit && hit[0]}" — rewrite it in plain user language`,
      );
    });
  });
});

console.log("\n=== the surrounding copy survived the cleanup ===");

const html = readIndexHtml();
[
  ["black zone refining note", /Refining in the Outlands is flat/],
  ["roads zone reference note", /406 roads zones with tier/],
  ["Brecilien portal legend", /marks a Brecilien portal/],
  ["skins note", /the only marketable form of skins/],
  ["live portals note", /Portals expire 12-24h/],
].forEach(([label, pattern]) => {
  test(`${label} is still on screen`, () => {
    assert.ok(pattern.test(html), `${label} must not be deleted, only de-jargoned`);
  });
});

test("the empty portals table still tells the user what to do", () => {
  const roads = stripComments(read("js/render-roads.js"));
  assert.ok(
    /Add portals by hand/.test(roads),
    "the empty-state hint must still explain that portals are added by hand",
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
