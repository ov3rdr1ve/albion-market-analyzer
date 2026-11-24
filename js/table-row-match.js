// How the generic table filter (js/table-search.js) READS one rendered <tr>:
// its tier/enchant, its structural kind (data row, group header, detail panel),
// and whether it matches a typed query. Pure predicates over a row, no display
// writes — table-search.js decides what to hide.
//
// Loaded after js/table-filters.js (idsFromRowKey) and before js/table-search.js.

(function () {
  const { idsFromRowKey } =
    (typeof window !== "undefined" && window.tableFilters) ||
    (typeof require === "function" ? require("./table-filters.js") : {});

  // Pull the tier (1–8, or null when unknown) and enchant (0–4) for one <tr>.
  // Primary source: the game id at the head of `data-row-key`. Fallback: the
  // rendered "T4.2"/"T4" text (transmute keys are a bare tier number).
  function parseRowTierEnchant(tr) {
    const getAttr = (a) =>
      (tr && typeof tr.getAttribute === "function" && tr.getAttribute(a)) || "";
    // A renderer may pin what the pickers should match, overriding key + text.
    // Transmute uses it so a row filters by the product it MAKES, not the node
    // it buys (a "4 → 5 → 6" chain is a T6 row).
    const pinnedTier = getAttr("data-filter-tier");
    if (pinnedTier) {
      return {
        tier: parseInt(pinnedTier, 10),
        ench: parseInt(getAttr("data-filter-ench") || "0", 10) || 0,
      };
    }
    const key = getAttr("data-row-key");
    // Most keys lead with the row's item id; some lead with a section/mode word
    // ("royal|Any|T4_ARTEFACT_…" on rolling, "acquire|T8_JOURNAL_…"), so fall
    // back to the first id-shaped token anywhere in the key before the text.
    let id = key.split("|")[0] || "";
    if (!/T[1-8]_/.test(id)) {
      const fromKey = (idsFromRowKey(key) || []).find((x) => /T[1-8]_/.test(x));
      if (fromKey) id = fromKey;
    }
    let tier = null;
    let ench = 0;
    const tm = id.match(/T([1-8])_/);
    if (tm) tier = parseInt(tm[1], 10);
    const em = id.match(/@([0-4])(?:\D|$)/); // enchanted ids end _LEVELn@n
    if (em) ench = parseInt(em[1], 10);
    if (tier === null) {
      const txt = (tr && tr.textContent) || "";
      const dm = txt.match(/\bT([1-8])(?:\.([0-4]))?/);
      if (dm) {
        tier = parseInt(dm[1], 10);
        if (dm[2] != null) ench = parseInt(dm[2], 10);
      }
    }
    return { tier, ench };
  }

  // tierSel/enchSel are the raw <select> values: "" = All, else "1".."8" / "0".."4".
  function rowPassesTierEnch(tr, tierSel, enchSel) {
    if (!tierSel && !enchSel) return true;
    const { tier, ench } = parseRowTierEnchant(tr);
    if (tierSel && tier !== parseInt(tierSel, 10)) return false;
    if (enchSel && ench !== parseInt(enchSel, 10)) return false;
    return true;
  }

  // Classify a <tr>:
  //   { skip: true }    → leave its display entirely alone (toggle-owned rows)
  //   { follows: true } → a panel belonging to the data row above it: take that
  //                       row's visibility, never match the query on its own
  //   { level: n }      → structural header/divider at nesting level n (0 = top)
  //   { data: true }    → an ordinary data row, matched against the query
  //
  // `follows` is not `skip`: a panel whose parent the filter hid must go with it,
  // and text inside a panel must not rescue a parent that does not match.
  function classifyRow(tr) {
    if (tr.classList.contains("jb-detail-row")) return { follows: true }; // top-10 boards
    if (tr.classList.contains("cp-paths-row")) return { follows: true }; // craft planner + consumables alt routes
    if (tr.classList.contains("breed-detail-row")) return { skip: true };
    if (tr.hasAttribute("data-header-cat")) return { level: 0 }; // rolling category
    if (tr.classList.contains("section-divider")) return { level: 0 }; // royal/caerleon
    if (tr.classList.contains("bf-group-row")) return { level: 0 }; // brecilien group label
    if (tr.hasAttribute("data-header-roll")) return { level: 1 }; // rolling roll-type
    return { data: true };
  }

  // Display name for matching. getItemDisplayName resolves the localized/English
  // name (utils.js); fall back to the raw id so ids are always searchable.
  // resourceSearchAliases appends the family synonyms + proper name so a raw whose
  // display label is "4 rock" is still found by "stone" (likewise metal/leather/
  // lumber) — the same aliases the rendered rows expose.
  function catalogNameFor(id) {
    let name = id;
    try {
      if (typeof getItemDisplayName === "function") name = getItemDisplayName(id) || id;
    } catch (e) { /* noop */ }
    try {
      if (typeof resourceSearchAliases === "function") {
        const alias = resourceSearchAliases(id);
        if (alias) name += " " + alias;
      }
    } catch (e) { /* noop */ }
    return name;
  }

  // The ids in a row-key plus their catalog names, lowercased. Cached because it
  // runs per row on every keystroke. Names are language-dependent
  // (getItemDisplayName prefers ITEM_NAMES_ES when getLang() is "es"), so the
  // active language is part of the key — otherwise switching to ES keeps
  // matching the English names cached before the switch.
  const _keyHayCache = new Map();
  function rowKeyHaystack(key) {
    if (!key) return "";
    const lang = (typeof getLang === "function" && getLang()) || "";
    const cacheKey = `${lang}|${key}`;
    let hay = _keyHayCache.get(cacheKey);
    if (hay === undefined) {
      hay = idsFromRowKey(key)
        .map((id) => `${id} ${catalogNameFor(id)}`)
        .join(" ")
        .toLowerCase();
      _keyHayCache.set(cacheKey, hay);
    }
    return hay;
  }

  // A row matches when every term appears in its rendered text OR in its own ids
  // / their catalog names. The id side matters because the Enter-fetch matches
  // `id + getItemDisplayName(id)` (matchedCatalogIds) while a row only renders a
  // label, and the two disagree: a journal row reads "Wood [Gathering]" but its
  // item is named "T4 Wood Journal (Empty)". Text-only matching meant "journal"
  // fetched 28 journals and then hid every row. Keeping both haystacks aligned is
  // what guarantees that anything Enter can fetch, the filter can show.
  function rowMatches(tr, terms) {
    if (terms.length === 0) return true;
    const key =
      (tr && typeof tr.getAttribute === "function" && tr.getAttribute("data-row-key")) || "";
    const hay = `${(tr.textContent || "").toLowerCase()} ${rowKeyHaystack(key)}`;
    return terms.every((t) => hay.includes(t));
  }


  const api = {
    parseRowTierEnchant,
    rowPassesTierEnch,
    classifyRow,
    catalogNameFor,
    rowMatches,
  };

  if (typeof window !== "undefined") {
    window.tableRowMatch = api;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
