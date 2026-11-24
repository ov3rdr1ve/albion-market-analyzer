/**
 * UI language state + string lookup (English / Spanish).
 *
 * Independent of the server/region switch (js/api.js): the Albion Online Data
 * Project serves prices keyed by raw item id with NO names, so language is a
 * purely client-side concern. Item display names are localized in
 * getItemDisplayName() (js/utils.js) via ITEM_NAMES_ES; static UI chrome is
 * localized here via UI_STRINGS (js/i18n-strings.js) + [data-i18n] attributes.
 *
 * MUST load before js/i18n-strings.js consumers, js/utils.js and every
 * render-*.js (see index.html).
 */
const LANG_STORAGE_KEY = "appLang";
const LANGUAGES = { en: "English", es: "Español" };
const DEFAULT_LANG = "en";

/** Normalize a stored/candidate lang key to a supported one. */
function resolveLang(key) {
  return key && LANGUAGES[key] ? key : DEFAULT_LANG;
}

/** Currently selected UI language key — read from localStorage (default en). */
function getLang() {
  let saved = null;
  try {
    saved = localStorage.getItem(LANG_STORAGE_KEY);
  } catch (e) { /* storage unavailable: keep default language */ }
  return resolveLang(saved);
}

/**
 * Persist the selected language. Returns true for a known key. The caller is
 * responsible for re-applying static strings + re-rendering the tables.
 */
function setLang(key) {
  if (!LANGUAGES[key]) return false;
  try {
    localStorage.setItem(LANG_STORAGE_KEY, key);
  } catch (e) { /* storage unavailable: choice lasts this session */ }
  return true;
}

/**
 * Translate a UI-chrome slug. Order: current-language string → English string →
 * the slug itself (so a missing key is visible but never crashes). `lang`
 * overrides the current selection (used by tests).
 *
 * English lives in the generated UI_STRINGS_EN (js/i18n-strings-en.js); Spanish
 * in the hand-authored, intentionally partial UI_STRINGS_ES (js/i18n-strings-es.js).
 * Any slug absent from UI_STRINGS_ES falls back to English.
 */
function t(slug, lang) {
  const L = resolveLang(lang || getLang());
  const es = typeof UI_STRINGS_ES !== "undefined" ? UI_STRINGS_ES : null;
  const en = typeof UI_STRINGS_EN !== "undefined" ? UI_STRINGS_EN : null;
  if (L === "es" && es && es[slug] != null) return es[slug];
  if (en && en[slug] != null) return en[slug];
  return slug;
}

/**
 * Translate an inline code literal: return the Spanish string for `slug` when
 * the language is es and it exists, otherwise the English text passed in.
 *
 * Used by render-*.js for dynamically built cell text (route labels, "no data",
 * empty states). Keeping the English INLINE means these need no entry in the
 * generated UI_STRINGS_EN and so survive its regeneration — only the ES overlay
 * lives in UI_STRINGS_ES.
 */
function tx(enText, slug) {
  if (getLang() === "es") {
    const es = typeof UI_STRINGS_ES !== "undefined" ? UI_STRINGS_ES : null;
    if (es && es[slug] != null) return es[slug];
  }
  return enText;
}

/**
 * Localized display name for a table row's NAME cell. Most render-*.js name
 * cells interpolate the catalog's English `.name` directly; wrap them as
 * dispName(id, row.name) so they pick up the Spanish name in es mode while
 * staying byte-identical in en mode (no regression): en returns the fallback
 * untouched; es routes through getItemDisplayName(id) (ITEM_NAMES_ES + enchant),
 * falling back to the English name if the id has no Spanish entry. Row-appended
 * decorations ([T6], badges) live outside this call and are preserved.
 */
function dispName(id, fallbackName) {
  if (
    getLang() === "es" &&
    id &&
    typeof getItemDisplayName === "function"
  ) {
    const n = getItemDisplayName(id);
    if (n) return n;
  }
  return fallbackName;
}

/**
 * Apply UI-chrome translations to static DOM under `root`:
 *   data-i18n         -> textContent
 *   data-i18n-title   -> title attribute (tooltips)
 *   data-i18n-ph      -> placeholder attribute
 *
 * The authored English is cached per element on first pass (into a dataset key)
 * so switching BACK to English restores it. This matters for ES-only slugs (not
 * in the generated EN map): for those t() returns the slug in en mode, and
 * without the cache we would leave the previously-set Spanish text in place.
 * Labels that wrap a child control put their text in an inner <span data-i18n>
 * so we never touch innerHTML.
 */
function applyStaticI18n(root) {
  if (typeof document === "undefined") return;
  const scope = root || document;
  const set = (el, attr, cacheKey, read, apply) => {
    const slug = el.getAttribute(attr);
    // Cache the authored English exactly once (before any overwrite).
    if (el.dataset[cacheKey] === undefined) el.dataset[cacheKey] = read();
    const en = el.dataset[cacheKey];
    const val = t(slug);
    // Translation found → use it; otherwise restore the cached English.
    apply(val !== slug ? val : en);
  };
  scope.querySelectorAll("[data-i18n]").forEach((el) => {
    set(el, "data-i18n", "i18nEn", () => el.textContent, (v) => (el.textContent = v));
  });
  // data-i18n-html: for a handful of long prose blocks that carry inline <em>/
  // <code> markup. Content is hardcoded, trusted (UI_STRINGS / the element's own
  // authored HTML) — never user input — so innerHTML is safe here.
  scope.querySelectorAll("[data-i18n-html]").forEach((el) => {
    set(el, "data-i18n-html", "i18nEnHtml", () => el.innerHTML, (v) => (el.innerHTML = v));
  });
  scope.querySelectorAll("[data-i18n-title]").forEach((el) => {
    set(el, "data-i18n-title", "i18nEnTitle", () => el.getAttribute("title") || "", (v) => el.setAttribute("title", v));
  });
  scope.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    set(el, "data-i18n-ph", "i18nEnPh", () => el.getAttribute("placeholder") || "", (v) => el.setAttribute("placeholder", v));
  });
  if (scope === document && document.documentElement) {
    document.documentElement.setAttribute("lang", getLang());
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    LANG_STORAGE_KEY,
    LANGUAGES,
    DEFAULT_LANG,
    resolveLang,
    getLang,
    setLang,
    t,
    tx,
    dispName,
    applyStaticI18n,
  };
}
