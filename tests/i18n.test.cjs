/**
 * Test: English / Spanish UI language switch.
 *
 * The app localizes two independent text bodies, both purely client-side (the
 * Albion Online Data Project serves prices keyed by raw id with NO names, so
 * language never touches the API):
 *   1. UI chrome  — UI_STRINGS_EN (generated) + UI_STRINGS_ES (hand, partial),
 *                   resolved by t() in js/i18n.js with an EN→slug fallback.
 *   2. Item names — ITEM_NAMES_ES (js/item-names-es.js) consulted first when the
 *                   language is "es", plus language-aware resource short names.
 *
 * Black-box over the exported helpers; localStorage is stubbed so no real
 * storage is touched. getItemDisplayName's full chain lives in js/utils.js
 * (no module.exports) and is verified in-browser, not here.
 *
 * Run: node tests/i18n.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

// ── Controllable localStorage stub (reset between tests) ─────────────────────
let _localStorage = {};
global.localStorage = {
  getItem(k) {
    return Object.prototype.hasOwnProperty.call(_localStorage, k)
      ? _localStorage[k]
      : null;
  },
  setItem(k, v) {
    _localStorage[k] = String(v);
  },
  removeItem(k) {
    delete _localStorage[k];
  },
};

function load(rel) {
  // Compile under the file's REAL path: js/i18n-strings-es.js requires its
  // part-2 table relatively, which only resolves from the real location.
  const full = path.join(__dirname, "..", rel);
  const src = fs.readFileSync(full, "utf8");
  const m = new Module(full);
  m.filename = full; // the constructor only sets id; require() resolves off this
  m.paths = Module._nodeModulePaths(path.dirname(full));
  m._compile(src, full);
  return m.exports;
}

// String tables must exist as globals BEFORE i18n.js's t() runs.
const { UI_STRINGS_EN } = load("js/i18n-strings-en.js");
const { UI_STRINGS_ES } = load("js/i18n-strings-es.js");
global.UI_STRINGS_EN = UI_STRINGS_EN;
global.UI_STRINGS_ES = UI_STRINGS_ES;

const i18n = load("js/i18n.js");
const { resolveLang, getLang, setLang, t, LANGUAGES, DEFAULT_LANG } = i18n;

// resource-names.js reads a global getLang() to pick its word map.
global.getLang = getLang;
const { resourceShortName } = load("js/resource-names.js");

const { ITEM_NAMES_ES } = load("js/item-names-es.js");
global.ITEM_NAMES_ES = ITEM_NAMES_ES;

// ── Tiny runner (mirrors the repo's other .cjs tests) ────────────────────────
let passed = 0,
  failed = 0;
function test(name, fn) {
  _localStorage = {}; // fresh storage (default language) per test
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

// ── Exports / metadata ───────────────────────────────────────────────────────
console.log("\n=== Exports & language catalog ===");

test("i18n.js exports the switch helpers", () => {
  ["resolveLang", "getLang", "setLang", "t", "applyStaticI18n"].forEach((fn) => {
    assert.strictEqual(typeof i18n[fn], "function", `${fn} must be exported`);
  });
  assert.strictEqual(DEFAULT_LANG, "en", "default language is English");
});

test("exactly English + Spanish are offered", () => {
  assert.deepStrictEqual(Object.keys(LANGUAGES).sort(), ["en", "es"]);
  assert.strictEqual(LANGUAGES.en, "English");
  assert.strictEqual(LANGUAGES.es, "Español");
});

// ── resolveLang (pure) ───────────────────────────────────────────────────────
console.log("\n=== resolveLang (key normalization) ===");
[
  ["en", "en"],
  ["es", "es"],
  [null, "en"],
  [undefined, "en"],
  ["", "en"],
  ["fr", "en"], // unsupported → default
  ["EN", "en"], // case-sensitive: unknown key → default
  [" es", "en"], // not trimmed → default
].forEach(([input, expected]) => {
  test(`resolveLang(${JSON.stringify(input)}) → ${expected}`, () => {
    assert.strictEqual(resolveLang(input), expected);
  });
});

// ── localStorage-backed selection ────────────────────────────────────────────
console.log("\n=== getLang / setLang (persistence) ===");

test("default with empty storage → en", () => {
  assert.strictEqual(getLang(), "en");
});

test("setLang('es') persists and is reflected by getLang", () => {
  assert.strictEqual(setLang("es"), true);
  assert.strictEqual(_localStorage.appLang, "es", "written to localStorage");
  assert.strictEqual(getLang(), "es");
});

test("setLang(invalid) returns false and leaves the default in place", () => {
  assert.strictEqual(setLang("de"), false);
  assert.strictEqual(getLang(), "en");
  assert.strictEqual(_localStorage.appLang, undefined, "garbage not persisted");
});

test("garbage already in storage → getLang falls back to en", () => {
  _localStorage.appLang = "klingon";
  assert.strictEqual(getLang(), "en");
});

test("selection survives a 'reload' (re-read of the same storage)", () => {
  setLang("es");
  assert.strictEqual(getLang(), "es");
  assert.strictEqual(getLang(), "es");
});

// ── t() — string lookup with EN→slug fallback ────────────────────────────────
console.log("\n=== t() (chrome translation + fallback) ===");

test("t() returns the Spanish string in es mode", () => {
  setLang("es");
  assert.strictEqual(t("sell"), "Vender");
  assert.strictEqual(t("profit_2"), "Beneficio");
});

test("t() returns English in en mode even when Spanish exists", () => {
  setLang("en");
  assert.strictEqual(t("sell"), "Sell");
  assert.strictEqual(t("profit_2"), "Profit");
});

test("t() falls back to English when a slug has no Spanish entry", () => {
  setLang("es");
  // ES currently covers every generated EN slug, so the fallback is exercised
  // with a slug injected for this test — it is the path any newly generated
  // string takes before its translation is written.
  const enOnly = "__en_only_fixture__";
  UI_STRINGS_EN[enOnly] = "English only";
  try {
    assert.strictEqual(UI_STRINGS_ES[enOnly], undefined, "fixture must not exist in ES");
    assert.strictEqual(t(enOnly), "English only");
  } finally {
    delete UI_STRINGS_EN[enOnly];
  }
});

test("t() returns the slug itself when it is unknown to both tables", () => {
  setLang("es");
  assert.strictEqual(t("__no_such_slug__"), "__no_such_slug__");
});

test("t(slug, lang) override ignores the persisted selection", () => {
  setLang("en");
  assert.strictEqual(t("sell", "es"), "Vender");
  assert.strictEqual(t("sell", "en"), "Sell");
});

// ── Resource short names (language-aware) ────────────────────────────────────
console.log("\n=== resourceShortName (localized, compact format kept) ===");

test("English resource words by default", () => {
  setLang("en");
  assert.strictEqual(resourceShortName("T6_PLANKS"), "T6 planks");
  assert.strictEqual(resourceShortName("T4_PLANKS_LEVEL2@2"), "T4.2 planks");
  assert.strictEqual(resourceShortName("T5_METALBAR@1"), "T5.1 bar");
});

test("Spanish resource words in es mode, same 'tier.ench word' shape", () => {
  setLang("es");
  assert.strictEqual(resourceShortName("T6_PLANKS"), "T6 tablones");
  assert.strictEqual(resourceShortName("T4_PLANKS_LEVEL2@2"), "T4.2 tablones");
  assert.strictEqual(resourceShortName("T5_METALBAR@1"), "T5.1 lingote");
  assert.strictEqual(resourceShortName("T8_STONEBLOCK"), "T8 bloque");
});

test("resourceShortName returns null for non-resource ids (both languages)", () => {
  setLang("es");
  assert.strictEqual(resourceShortName("T4_BAG"), null);
  assert.strictEqual(resourceShortName("QUESTITEM_TOKEN_MISTS"), null);
});

// ── ITEM_NAMES_ES (the generated Spanish name map) ───────────────────────────
console.log("\n=== ITEM_NAMES_ES (Spanish item-name data) ===");

test("map is populated for thousands of real ids", () => {
  assert.ok(
    Object.keys(ITEM_NAMES_ES).length > 5000,
    `expected >5000 ES names, got ${Object.keys(ITEM_NAMES_ES).length}`,
  );
});

test("known equipment id resolves to its ES-ES in-game name", () => {
  assert.strictEqual(ITEM_NAMES_ES["T4_2H_BOW"], "Arco del iniciado");
});

test("ES names differ from raw ids (real translations, not slugs)", () => {
  assert.notStrictEqual(ITEM_NAMES_ES["T4_2H_BOW"], "T4_2H_BOW");
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
