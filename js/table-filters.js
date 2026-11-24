// In-game-style per-table filter controls: Category ▸ Subcategory ▸ City.
//
// The Marketplace in Albion filters in the order Category ▸ Subcategory ▸ Tier ▸
// Enchantment ▸ Quality. js/table-search.js already owned the Tier and Enchant
// pickers (and the free-text box); this file adds the two category levels plus a
// City picker, and owns the shared plumbing both files use to build a <select>
// and to pull item ids out of a row key.
//
// Quality is deliberately NOT here: only the Rerolling table prices an item at
// more than one quality, and it already has its own quality picker. A global
// quality dropdown would filter nothing anywhere else.
//
// Matching rules
//   Category/Subcategory — read from the ids in the row's `data-row-key` via
//     getMarketCategory (js/data-item-categories.js, generated from items.xml).
//     Row keys carry the row's OWN items (product, raw→refined pair), never its
//     recipe materials, so a Plate Armor row does not answer to "Resources"
//     just because it consumes metal bars. A row matches when ANY of its ids
//     does — the raw/refined transport pair shares a category anyway, and being
//     forgiving here never hides a row the user was looking for.
//   City — the row's sell/buy cities are price-derived and deliberately absent
//     from row keys, so they come off the rendered row instead: the `data-city`
//     attributes the price-editable cells carry, the city-named segments of the
//     row key, and finally the rendered text.
//
// Both pickers prune themselves to the values the table currently HAS rows for
// (plus whatever is selected, so an active pick never vanishes) — same contract
// as the Crafting table's Station picker.

(function () {
  // Pull every game-id-looking token out of a data-row-key. Row keys are
  // per-table and mix ids with non-id segments (mode words, city names, section
  // flags, transition labels), so a regex for the id shape is far more robust
  // than split("|")[0]: "acquire|T8_JOURNAL_HIDE_FULL" → [T8_JOURNAL_HIDE_FULL],
  // "T4_ORE|T4_METALBAR|Thetford|" → [T4_ORE, T4_METALBAR]. Matches ALL-CAPS
  // underscore-joined tokens with an optional @n enchant suffix; lowercase
  // sections and single-word city names never match.
  const ID_TOKEN_RE = /[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?:@\d)?/g;
  function idsFromRowKey(key) {
    return String(key || "").match(ID_TOKEN_RE) || [];
  }

  function categoryFilterId(tableId) {
    return "catfilter-" + tableId;
  }
  function subcategoryFilterId(tableId) {
    return "subcatfilter-" + tableId;
  }
  // Three city pickers, and which one a table gets depends on its rows.
  //
  //   cityfilter-*      the combined pick — matches EITHER side. Kept for the
  //                     Volume table, whose rows name one market (where the
  //                     liquidity is) rather than a buy→sell route.
  //   buycityfilter-*   \ the split pick, for every route table. A row that buys
  //   sellcityfilter-*  / in Martlock and sells in Caerleon answers to both, and
  //                       constraining one side no longer drags the other in.
  function cityFilterId(tableId) {
    return "cityfilter-" + tableId;
  }
  function buyCityFilterId(tableId) {
    return "buycityfilter-" + tableId;
  }
  function sellCityFilterId(tableId) {
    return "sellcityfilter-" + tableId;
  }

  function getAttr(el, name) {
    return (el && typeof el.getAttribute === "function" && el.getAttribute(name)) || "";
  }

  // ── Category ────────────────────────────────────────────────────────────────

  /** Every {category, subcategory} the row's own ids resolve to (deduped). */
  function rowCategoryPairs(tr) {
    const lookup = typeof getMarketCategory === "function" ? getMarketCategory : null;
    if (!lookup) return [];
    const out = [];
    const seen = new Set();
    for (const id of idsFromRowKey(getAttr(tr, "data-row-key"))) {
      const hit = lookup(id);
      if (!hit) continue;
      const key = hit.category + "|" + hit.subcategory;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(hit);
    }
    return out;
  }

  /** catSel/subSel are raw <select> values ("" = All). */
  function rowPassesCategory(tr, catSel, subSel) {
    if (!catSel && !subSel) return true;
    const pairs = rowCategoryPairs(tr);
    if (pairs.length === 0) return false; // uncategorised row, explicit pick active
    return pairs.some(
      (p) =>
        (!catSel || p.category === catSel) && (!subSel || p.subcategory === subSel),
    );
  }

  // ── City ────────────────────────────────────────────────────────────────────

  /** Market names this app prices in, most specific spellings first. */
  function knownCities() {
    if (typeof SELL_CITIES !== "undefined" && Array.isArray(SELL_CITIES)) return SELL_CITIES;
    return [
      "Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock",
      "Bridgewatch", "Brecilien", "Smuggler's Den", "Black Market",
    ];
  }

  /**
   * Cities this row is about.
   *
   * With no `side`: reads, in order, the `data-city` attributes the
   * price-editable cells carry, the city-named segments of the row key, and the
   * rendered text. All three are unioned — a row that buys in one city and sells
   * in another answers to both picks.
   *
   * With a `side` ("buy" / "sell"): reads ONLY the price cells tagged for that
   * order book (`data-city-list`, the same attribute the price editor uses to
   * decide which dropdown to build — js/app.js matPriceSpan / priceTd). The two
   * fallbacks above cannot be used here because neither a row key nor rendered
   * text carries a side, so a table whose rows have no side-tagged price cells
   * simply offers no split picker (syncSelectOptions hides one with nothing to
   * offer). That is the trade for being able to constrain the sides separately.
   */
  function rowCities(tr, side) {
    const found = new Set();
    const selector = side ? `[data-city][data-city-list="${side}"]` : "[data-city]";
    if (tr && typeof tr.querySelectorAll === "function") {
      tr.querySelectorAll(selector).forEach((el) => {
        const c = getAttr(el, "data-city");
        if (c) found.add(c);
      });
    }
    if (side) return found;
    const cities = knownCities();
    const segments = new Set(
      String(getAttr(tr, "data-row-key")).split("|").map((s) => s.trim()).filter(Boolean),
    );
    cities.forEach((c) => {
      if (segments.has(c)) found.add(c);
    });
    if (found.size === 0) {
      const text = (tr && tr.textContent) || "";
      cities.forEach((c) => {
        if (text.includes(c)) found.add(c);
      });
    }
    return found;
  }

  function rowPassesCity(tr, citySel) {
    if (!citySel) return true;
    return rowCities(tr).has(citySel);
  }

  /**
   * On a table whose City pick RE-PRICES its rows, the pick has already been
   * honoured at build time — every row names the picked city. Filtering the
   * rendered rows on top of that is at best a no-op and at worst a second,
   * disagreeing gate that hides the very rows the re-pricing just produced
   * (a "no data" row names no city at all). So the DOM pass stands down.
   */
  function cityFilterOwnedByReprice(tableId) {
    return typeof tableRepricesOnCityPick === "function" && tableRepricesOnCityPick(tableId);
  }

  function rowPassesBuyCity(tr, citySel, tableId) {
    if (!citySel || cityFilterOwnedByReprice(tableId)) return true;
    return rowCities(tr, "buy").has(citySel);
  }

  function rowPassesSellCity(tr, citySel, tableId) {
    if (!citySel || cityFilterOwnedByReprice(tableId)) return true;
    return rowCities(tr, "sell").has(citySel);
  }

  // ── <select> plumbing (shared with js/table-search.js) ──────────────────────

  const SELECT_STYLE =
    "font-size:0.8rem;padding:3px 6px;background:#1f2937;color:#e5e7eb;border:1px solid #4b5563;border-radius:3px";

  /** Build one styled <select> whose leading "All" option is labelled `labelText`. */
  function buildFilterSelect(id, labelText, options, labelSlug) {
    const sel = document.createElement("select");
    sel.id = id;
    sel.className = "table-filter-select";
    sel.setAttribute("aria-label", labelText);
    sel.style.cssText = SELECT_STYLE;
    const all = document.createElement("option");
    all.value = "";
    all.textContent = labelText;
    if (labelSlug) all.setAttribute("data-i18n", labelSlug);
    sel.appendChild(all);
    options.forEach((o) => {
      const op = document.createElement("option");
      op.value = o.value;
      op.textContent = o.label;
      // Built once in JS, so a language switch has to re-label them: the slug
      // lets applyStaticI18n repaint the option without a rebuild.
      if (o.slug) op.setAttribute("data-i18n", o.slug);
      sel.appendChild(op);
    });
    if (typeof applyStaticI18n === "function") applyStaticI18n(sel);
    return sel;
  }

  /**
   * Replace a select's options (keeping its leading "All") with `options`,
   * preserving the current pick. No-op when the option list is already right, so
   * this is safe to call on every filter pass.
   *
   * A picker with nothing to offer hides itself: these controls are injected on
   * every table, but a table of city bonuses has no categories and a table of
   * zone tiers has no cities. Hiding beats listing an empty dropdown, and the
   * control comes back by itself the moment a render gives it options.
   */
  function syncSelectOptions(sel, options) {
    if (!sel || !sel.options || typeof document === "undefined" ||
        typeof document.createElement !== "function") return;
    // NEVER while the user has this list open. Chromium keeps focus on a
    // <select> for as long as its popup is up, so "focused" is the only signal
    // there is — and removing the <option> nodes underneath an open popup makes
    // the browser close it, which is what "clicking the city droplist won't let
    // me pick anything" was: a re-render landing mid-click. The options are
    // remembered and applied the moment focus leaves.
    if (typeof sel.addEventListener === "function"
        && (sel.ownerDocument || document).activeElement === sel) {
      sel._pendingOptions = options;
      if (!sel._optionSyncQueued) {
        sel._optionSyncQueued = true;
        const replay = () => {
          sel.removeEventListener("blur", replay);
          sel._optionSyncQueued = false;
          const pending = sel._pendingOptions;
          sel._pendingOptions = null;
          if (pending) syncSelectOptions(sel, pending);
        };
        sel.addEventListener("blur", replay);
      }
      return;
    }
    if (sel.style) sel.style.display = options.length || sel.value ? "" : "none";
    const wanted = options.map((o) => o.value);
    const current = Array.from(sel.options).map((o) => o.value).filter(Boolean);
    if (current.length === wanted.length && current.every((v, i) => v === wanted[i])) return;
    const picked = sel.value;
    while (sel.options.length > 1) sel.remove(1);
    options.forEach((o) => {
      const op = document.createElement("option");
      op.value = o.value;
      op.textContent = o.label;
      sel.appendChild(op);
    });
    // Keep the active pick even when it just left the "present" set, so the
    // options list can never yank a filter out from under the user.
    sel.value = picked;
    if (sel.value !== picked && picked) {
      const op = document.createElement("option");
      op.value = picked;
      op.textContent = picked;
      sel.appendChild(op);
      sel.value = picked;
    }
  }

  /**
   * Narrow the Category + Subcategory options to what `pairs` (every category
   * pair seen on a data row this pass) contains. The subcategory list follows
   * the active category pick; with no category picked it lists every
   * subcategory present, labelled with its category so "Other" is never
   * ambiguous.
   */
  function syncCategoryOptions(tableId, pairs, catSel) {
    const tree = typeof MARKET_CATEGORY_TREE !== "undefined" ? MARKET_CATEGORY_TREE : [];
    if (!tree.length) return;
    const cats = new Set();
    const subs = new Set();
    pairs.forEach((p) => {
      cats.add(p.category);
      if (p.subcategory && (!catSel || p.category === catSel)) {
        subs.add(p.category + "|" + p.subcategory);
      }
    });
    const catEl = document.getElementById(categoryFilterId(tableId));
    if (catEl) {
      syncSelectOptions(
        catEl,
        tree.filter((c) => cats.has(c.key)).map((c) => ({ value: c.key, label: c.label })),
      );
    }
    const subEl = document.getElementById(subcategoryFilterId(tableId));
    if (subEl) {
      const opts = [];
      tree.forEach((c) => {
        c.subs.forEach((s) => {
          if (!subs.has(c.key + "|" + s.key)) return;
          opts.push({ value: s.key, label: catSel ? s.label : `${c.label} · ${s.label}` });
        });
      });
      syncSelectOptions(subEl, opts);
    }
  }

  /**
   * Narrow the City options to the cities this table's rows actually name.
   *
   * Except on a table whose pick RE-PRICES its rows (js/table-sell-city.js):
   * there every sell city is offered, because pruning would mean a city that
   * currently wins no row can never be picked — which is exactly the Black
   * Market case the re-pricing exists for.
   */
  function syncCityOptions(tableId, present) {
    const el = document.getElementById(cityFilterId(tableId));
    if (!el) return;
    const all = typeof sellCityOptionsFor === "function" ? sellCityOptionsFor(tableId) : null;
    const cities = all && all.length
      ? all.slice()
      : knownCities().filter((c) => present.has(c));
    syncSelectOptions(el, cities.map((c) => ({ value: c, label: c })));
  }

  /**
   * The same, for one side of a route table.
   *
   * The SELL picker inherits the "offer every sell city, never prune" rule above
   * on a table that re-prices from it — that is the Black Market case the
   * re-pricing exists for, and pruning would make a city that currently wins no
   * row unpickable. The BUY picker always prunes: nothing re-prices from it, so
   * an option that matches no row is an option that can only ever empty the
   * table.
   */
  function syncSideCityOptions(tableId, side, present) {
    const el = document.getElementById(
      side === "buy" ? buyCityFilterId(tableId) : sellCityFilterId(tableId),
    );
    if (!el) return;
    // A re-pricing table must offer every city on the leg it re-prices, not just
    // the ones its rendered rows already name — pruning means a city that wins
    // no row today can never be picked, which is exactly the case the
    // re-pricing exists for (js/table-sell-city.js).
    // Referenced through `typeof` because js/table-sell-city.js is a separate
    // classic script: if it failed to load, a bare identifier would throw here.
    const optionsFor =
      side === "sell"
        ? (typeof sellCityOptionsFor === "function" ? sellCityOptionsFor : null)
        : (typeof buyCityOptionsFor === "function" ? buyCityOptionsFor : null);
    const all = optionsFor ? optionsFor(tableId) : null;
    const cities = all && all.length
      ? all.slice()
      : knownCities().filter((c) => present.has(c));
    syncSelectOptions(el, cities.map((c) => ({ value: c, label: c })));
  }

  // ── Injection ───────────────────────────────────────────────────────────────

  /**
   * Wire a select so changing it filters and clicking it never collapses the <h2>.
   *
   * `click` only. A `mousedown` listener on a <select> sits directly in the path
   * of the browser opening its own option list, and it bought nothing here: both
   * collapse handlers that could have swallowed the event (the per-table <h2> in
   * js/app.js and the section-group head in js/section-groups.js) already bail on
   * a `select` target before toggling anything.
   */
  function wireSelect(sel, onChange) {
    sel.addEventListener("change", onChange);
    sel.addEventListener("click", (e) => e.stopPropagation());
  }

  /**
   * Insert the Category + Subcategory pickers right after `ref`, returning the
   * last element inserted so the caller can keep chaining. Idempotent.
   */
  function injectCategoryControls(tableId, ref, onChange) {
    if (!ref || !ref.parentNode) return ref;
    if (document.getElementById(categoryFilterId(tableId))) return ref;
    const label = (en, slug) => (typeof tx === "function" ? tx(en, slug) : en);
    // Seeded from the whole taxonomy, not left empty. An empty option list makes
    // syncSelectOptions hide the picker, and the pass that would fill it needs
    // rendered rows — which a collapsed (or never-scanned) table does not have,
    // so the control was missing from exactly the headers the user had not
    // opened yet. Seed now, prune on the first pass that sees data rows. Same
    // shape as the Station picker (js/table-station-filter.js).
    const tree = typeof MARKET_CATEGORY_TREE !== "undefined" ? MARKET_CATEGORY_TREE : [];
    if (!tree.length) return ref;
    const catOpts = tree.map((c) => ({ value: c.key, label: c.label }));
    const subOpts = [];
    tree.forEach((c) => {
      c.subs.forEach((s) => {
        // Labelled with its category while no category is picked, exactly as
        // syncCategoryOptions relabels them later.
        subOpts.push({ value: s.key, label: `${c.label} · ${s.label}` });
      });
    });
    const cat = buildFilterSelect(
      categoryFilterId(tableId), label("Category", "r_cat_filter"), catOpts, "r_cat_filter",
    );
    const sub = buildFilterSelect(
      subcategoryFilterId(tableId), label("Subcategory", "r_subcat_filter"), subOpts, "r_subcat_filter",
    );
    let cursor = ref;
    [cat, sub].forEach((sel) => {
      wireSelect(sel, onChange);
      cursor.parentNode.insertBefore(sel, cursor.nextSibling);
      cursor = sel;
    });
    return cursor;
  }

  // ── Reset filters ───────────────────────────────────────────────────────────
  //
  // Distinct from the "Clear overrides" button next to it (js/table-overrides.js):
  // this one touches NO stored data. It empties the table's search box and puts
  // every picker back to "All" — the state the table renders in on a fresh load.
  //
  // "Every picker" means every <select> in the table's <h2> that has an "All"
  // option (value ""), not just the ones injected here: the Rerolling transition
  // picker and the Faction Spending faction picker are hand-written in
  // index.html and are just as much filters. Ours are reset silently and the
  // caller's onChange runs once at the end (one re-render, not six); the
  // hand-written ones own their own listeners, so they get a real `change`.

  function clearFiltersButtonId(tableId) {
    return "clear-filters-" + tableId;
  }

  function resetTableFilters(input, onChange) {
    if (input) input.value = "";
    const heading = input && input.parentNode;
    if (heading && typeof heading.querySelectorAll === "function") {
      heading.querySelectorAll("select").forEach((sel) => {
        const opts = Array.from(sel.options || []);
        if (!opts.some((o) => o.value === "") || sel.value === "") return;
        sel.value = "";
        const ours =
          sel.classList && typeof sel.classList.contains === "function"
            ? sel.classList.contains("table-filter-select")
            : false;
        if (ours) return;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    if (typeof onChange === "function") onChange();
  }

  /**
   * Insert the "Reset filters" button right after `ref` (so it closes the row of
   * pickers it resets). Idempotent.
   */
  function injectClearFiltersButton(tableId, input, ref, onChange) {
    if (!ref || !ref.parentNode || typeof document === "undefined") return ref;
    if (document.getElementById(clearFiltersButtonId(tableId))) return ref;
    const label = (en, slug) => (typeof tx === "function" ? tx(en, slug) : en);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = clearFiltersButtonId(tableId);
    btn.className = "clear-filters-btn";
    btn.textContent = "✕ " + label("Reset filters", "reset_table_filters");
    btn.title = label(
      "Empty this table's search box and set every picker back to All. Nothing you typed into a price, volume or city is touched.",
      "reset_table_filters_tip",
    );
    // Title only — the label carries a "✕ " prefix applyStaticI18n would eat.
    btn.setAttribute("data-i18n-title", "reset_table_filters_tip");
    btn.addEventListener("click", (e) => {
      e.stopPropagation(); // never toggle the collapsible <h2>
      resetTableFilters(input, onChange);
    });
    btn.addEventListener("mousedown", (e) => e.stopPropagation());
    ref.parentNode.insertBefore(btn, ref.nextSibling);
    return btn;
  }

  /**
   * The cities a picker offers before anything has rendered: the table's own
   * fixed list when its pick re-prices the rows (js/table-sell-city.js), else
   * every market this app prices in. The first pass over real rows prunes it —
   * seeding only decides what the header shows until then.
   */
  function seedCities(tableId, side) {
    const optionsFor =
      side === "buy"
        ? (typeof buyCityOptionsFor === "function" ? buyCityOptionsFor : null)
        : side === "sell"
          ? (typeof sellCityOptionsFor === "function" ? sellCityOptionsFor : null)
          : null;
    const all = optionsFor ? optionsFor(tableId) : null;
    // The BUY fallback is CITIES, not knownCities(): the Black Market posts bids
    // only, so seeding it as a place to buy from offers a leg that cannot exist.
    const fallback =
      side === "buy" && typeof CITIES !== "undefined" && Array.isArray(CITIES)
        ? CITIES
        : knownCities();
    return (all && all.length ? all.slice() : fallback).map((c) => ({ value: c, label: c }));
  }

  /** Insert one city picker right after `ref`. Idempotent. */
  function _injectCitySelect(id, labelEn, slug, ref, onChange, options) {
    if (!ref || !ref.parentNode) return ref;
    if (document.getElementById(id)) return ref;
    const label = typeof tx === "function" ? tx(labelEn, slug) : labelEn;
    const sel = buildFilterSelect(id, label, options || [], slug);
    wireSelect(sel, onChange);
    ref.parentNode.insertBefore(sel, ref.nextSibling);
    return sel;
  }

  /** The combined City picker — matches either side. Volume table only. */
  function injectCityControl(tableId, ref, onChange) {
    return _injectCitySelect(
      cityFilterId(tableId), "City", "r_city_filter", ref, onChange, seedCities(tableId),
    );
  }

  /** "Buy City" — the market the row's inputs come from. */
  function injectBuyCityControl(tableId, ref, onChange) {
    return _injectCitySelect(
      buyCityFilterId(tableId), "Buy City", "r_buy_city_filter", ref, onChange,
      seedCities(tableId, "buy"),
    );
  }

  /** "Sell City" — the market the row's product goes to. */
  function injectSellCityControl(tableId, ref, onChange) {
    return _injectCitySelect(
      sellCityFilterId(tableId), "Sell City", "r_sell_city_filter", ref, onChange,
      seedCities(tableId, "sell"),
    );
  }

  const api = {
    ID_TOKEN_RE,
    idsFromRowKey,
    categoryFilterId,
    subcategoryFilterId,
    cityFilterId,
    buyCityFilterId,
    sellCityFilterId,
    rowCategoryPairs,
    rowPassesCategory,
    knownCities,
    rowCities,
    rowPassesCity,
    rowPassesBuyCity,
    rowPassesSellCity,
    SELECT_STYLE,
    buildFilterSelect,
    syncSelectOptions,
    syncCategoryOptions,
    syncCityOptions,
    syncSideCityOptions,
    seedCities,
    injectCategoryControls,
    injectCityControl,
    injectBuyCityControl,
    injectSellCityControl,
    clearFiltersButtonId,
    resetTableFilters,
    injectClearFiltersButton,
  };

  if (typeof window !== "undefined") window.tableFilters = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
