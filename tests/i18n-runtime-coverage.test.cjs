/**
 * App-wide Spanish coverage guard.
 *
 * Two bodies of text have to be translated for the ES switch to be complete:
 *   1. static chrome  — every slug in the generated js/i18n-strings-en.js
 *   2. runtime text   — every slug any js/*.js passes to tx(englishText, slug)
 *      (or to the local T()/TX() wrappers, which are the same contract)
 *
 * Both are scanned from the shipped sources, so a new untranslated string fails
 * here rather than silently rendering English inside a Spanish page. Also
 * checks that `{placeholder}` tokens survive translation — the caller
 * substitutes them with .replace(), so a dropped token loses a number or city.
 *
 * Run: node tests/i18n-runtime-coverage.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const JS_DIR = path.join(ROOT, "js");
const { UI_STRINGS_EN } = require("../js/i18n-strings-en.js");
const { UI_STRINGS_ES } = require("../js/i18n-strings-es.js");
const { readIndexHtml } = require("./helpers/page-source.cjs");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

/** Every tx("english", "slug") / T(...) / TX(...) pair in the shipped js. */
function collectRuntimeStrings() {
  const found = new Map(); // slug -> { english, file }
  for (const file of fs.readdirSync(JS_DIR)) {
    if (!file.endsWith(".js") || file.startsWith("i18n-strings")) continue;
    const src = fs.readFileSync(path.join(JS_DIR, file), "utf8");
    const re = /\bT?tx?\(\s*("(?:[^"\\]|\\.)*")\s*,\s*"([a-z0-9_]+)"\s*\)/g;
    let m;
    while ((m = re.exec(src))) {
      if (found.has(m[2])) continue;
      let english;
      try { english = JSON.parse(m[1]); } catch { english = m[1]; }
      found.set(m[2], { english, file });
    }
  }
  return found;
}

const runtime = collectRuntimeStrings();

test("the scan finds the runtime strings at all", () => {
  assert.ok(runtime.size > 150, `only ${runtime.size} runtime slugs found — did the call shape change?`);
});

test("every runtime slug has a Spanish string", () => {
  const missing = [...runtime].filter(([slug]) => UI_STRINGS_ES[slug] == null)
    .map(([slug, info]) => `${slug} (${info.file})`);
  assert.deepStrictEqual(missing, [], `untranslated: ${missing.slice(0, 10).join(", ")}`);
});

test("every generated EN chrome slug has a Spanish string", () => {
  const missing = Object.keys(UI_STRINGS_EN).filter((k) => UI_STRINGS_ES[k] == null);
  assert.deepStrictEqual(missing, [], `untranslated: ${missing.slice(0, 10).join(", ")}`);
});

test("placeholders survive every runtime translation", () => {
  const broken = [];
  for (const [slug, { english }] of runtime) {
    const es = UI_STRINGS_ES[slug];
    if (typeof es !== "string") continue;
    const tokens = [...new Set(english.match(/\{[a-z]+\}/g) || [])];
    for (const token of tokens) {
      if (!es.includes(token)) broken.push(`${slug} lost ${token}`);
    }
  }
  assert.deepStrictEqual(broken, [], broken.slice(0, 10).join("; "));
});

test("no Spanish string is left as raw English", () => {
  // A copy-paste slip shows up as an identical string; a handful of terms are
  // legitimately identical in both languages, so only flag longer sentences.
  const suspicious = [];
  for (const [slug, { english }] of runtime) {
    const es = UI_STRINGS_ES[slug];
    if (typeof es === "string" && es === english && english.split(" ").length > 3) {
      suspicious.push(slug);
    }
  }
  assert.deepStrictEqual(suspicious, [], `untranslated copies: ${suspicious.join(", ")}`);
});

test("the ES table is assembled from all three parts", () => {
  const { UI_STRINGS_ES_EXTRA } = require("../js/i18n-strings-es-extra.js");
  const { UI_STRINGS_ES_ROWS } = require("../js/i18n-strings-es-rows.js");
  for (const [name, table] of [["extra", UI_STRINGS_ES_EXTRA], ["rows", UI_STRINGS_ES_ROWS]]) {
    const sample = Object.keys(table)[0];
    assert.ok(UI_STRINGS_ES[sample] != null, `${name} part not merged (${sample} missing)`);
  }
});

test("index.html loads the ES parts before the table that merges them", () => {
  const html = readIndexHtml();
  const extra = html.indexOf('src="js/i18n-strings-es-extra.js"');
  const rows = html.indexOf('src="js/i18n-strings-es-rows.js"');
  const main = html.indexOf('src="js/i18n-strings-es.js"');
  assert.ok(extra > -1 && rows > -1 && main > -1, "all three ES scripts must be loaded");
  assert.ok(extra < main && rows < main, "parts 2 and 3 must load before part 1 merges them");
});

test("no source file exceeds the 800-line cap", () => {
  const tooLong = [];
  for (const file of ["i18n-strings-es.js", "i18n-strings-es-extra.js", "i18n-strings-es-rows.js"]) {
    const lines = fs.readFileSync(path.join(JS_DIR, file), "utf8").split("\n").length;
    if (lines > 800) tooLong.push(`${file} (${lines})`);
  }
  assert.deepStrictEqual(tooLong, [], tooLong.join(", "));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
