// On-demand price fetch from a table's search box (the Enter key).
//
// The companion to js/table-search.js: that file decides which RENDERED rows a
// query shows, this one decides which items the query should PRICE. A freshly
// loaded, unscanned table has no rows to reveal, so Enter instead reads the
// table's catalog (the same id-collection functions its Scan button uses) plus
// the ids of the rows already on screen, fetches those items and their recipe
// materials, merges into the price store and re-renders — a targeted lookup
// instead of a full market scan.
//
// The fetch is capped (MAX_SEARCH_FETCH_ITEMS), so the ORDER of the candidates
// decides how many rows come back priced. See prioritizeFetchIds.
//
// Row-matching helpers (classifyRow / rowMatches / rowPassesTierEnch / …) are
// shared with the filter module, which publishes them on
// window.tableSearchInternals (module.exports under Node).

(function () {
  const shared =
    (typeof window !== "undefined" && window.tableSearchInternals) ||
    (typeof require === "function" ? require("./table-search.js") : {});
  const {
    RERENDER_ON_FILTER,
    searchInputId,
    tierFilterId,
    enchFilterId,
    categoryFilterId,
    subcategoryFilterId,
    buyCityFilterId,
    sellCityFilterId,
    classifyRow,
    rowMatches,
    rowPassesTierEnch,
    rowPassesCategory,
    rowPassesBuyCity,
    rowPassesSellCity,
    idsFromRowKey,
    catalogNameFor,
  } = shared;

  // ── On-demand single-item fetch from the search box ─────────────────────────
  //
  // A freshly loaded, unscanned table shows only a placeholder row — so pressing
  // Enter in its search box can't just "reveal" matching rows, there are none. We
  // instead: render the table (which materializes every catalog row as "no
  // data"), read the ids of the rows matching the query, fetch ONLY those items
  // (plus their recipe materials so profit columns compute), merge into
  // lastMarketData and re-render. The re-render re-applies the active filter, so
  // the user is left looking at their searched item priced live — without a full
  // market scan.

  // tableId → re-render callback. Only tables backed by fetchable market data
  // appear here; omitted tables (city bonuses / brecilien fees = no market data,
  // joined summary = derived) make Enter a no-op.
  function tableRenderers() {
    return {
      "crafting-table": () => renderCraftingTable(lastMarketData),
      "craft-planner-table": () => renderCraftPlannerTable(lastMarketData),
      "flipping-table": () => renderFlippingTable(lastMarketData),
      "skins-trading-table": () => renderSkinsTradingTable(lastMarketData),
      "transport-table": () => renderTransportTable(lastMarketData),
      "laborers-table": () => renderLaborersTable(lastMarketData),
      "buildings-table": () => renderBuildingsTable(lastMarketData),
      "consumable-table": () => renderConsumableTable(lastMarketData),
      "mounts-table": () => renderMountsTable(lastMarketData),
      "faction-spending-table": () => {
        // Mounts first so the breed silver/FP lookup is fresh (mirrors the
        // per-table scan handler).
        try { renderMountsTable(lastMarketData); } catch (e) { /* noop */ }
        renderFactionSpendingTable(lastMarketData);
      },
      "enchanting-table": () => renderEnchantingTable(lastMarketData),
      "transmute-table": () => renderTransmuteTable(lastMarketData),
      // The one table reading the quality store rather than lastMarketData.
      "rerolling-table": () => renderRerollingTable(lastQualityMarketData),
      "rolling-table": () => renderRollingTable(lastMarketData),
      "farming-table": () => renderFarmingTable(lastMarketData),
      "gathering-table": () => {
        renderGatheringTable(lastMarketData);
        try { renderJournalFillingTable(lastMarketData); } catch (e) { /* noop */ }
      },
      "journal-filling-table": () => renderJournalFillingTable(lastMarketData),
      "volume-table": () => renderVolumeTable(lastMarketData),
    };
  }

  // Tables one Enter-fetch redraws, so the marks cover every one of them.
  // Mirrors the two multi-table entries in tableRenderers() above.
  const SEARCH_FETCH_MARK_TABLES = {
    "faction-spending-table": ["mounts-table", "faction-spending-table"],
    "gathering-table": ["gathering-table", "journal-filling-table"],
  };

  function searchMarkTables(tableId) {
    return SEARCH_FETCH_MARK_TABLES[tableId] || [tableId];
  }

  // The scan buttons' marks, reused as they stand (js/scan-handlers.js): dim and
  // spin the value cells this fetch is about to replace, for as long as it runs.
  // The Enter path renders directly rather than through the scheduler, so
  // onPassStart never fires and nothing else reports it — and #loading-overlay
  // sits in the page header, off screen for anyone looking at a table.
  //
  // Looked up at press time like fireSearchFetch, so script order only has to
  // get the <script> tags right, not their internals. endScanMark keeps its own
  // isRerenderBusy guard, so a scheduler pass that started during the fetch owns
  // the marks and clears them itself.
  function beginSearchMark(tableId) {
    if (typeof beginScanMark === "function") beginScanMark(searchMarkTables(tableId));
  }
  function endSearchMark() {
    if (typeof endScanMark === "function") endScanMark();
  }

  // tableId → the full id universe of that table (reusing the same id-collection
  // functions the per-table scan buttons use, so the two never drift). We match
  // the search query against these ids' names to find what to fetch — the render
  // functions drop no-data rows, so an unscanned table has no DOM rows to read;
  // the catalog is the only reliable source of "what could this table show".
  function tableSources() {
    return {
      "crafting-table": getCraftingItemIds,
      "craft-planner-table": getCraftPlannerItemIds,
      // Flipping's SEARCH universe carries the @n variants its scan skips, so
      // "bag" + Ench. .3 can match T8_BAG@3 and fetch it on Enter (see
      // js/flip-enchant-variants.js).
      "flipping-table": getFlippingSearchIds,
      "skins-trading-table": getSkinsItemIds,
      "transport-table": getTransportItemIds,
      "laborers-table": getLaborersItemIds,
      "buildings-table": getBuildingsItemIds,
      "consumable-table": getConsumableItemIds,
      "mounts-table": getMountsItemIds,
      "faction-spending-table": getFactionSpendingItemIds,
      "enchanting-table": getAllEnchantItemIds,
      "transmute-table": getTransmuteItemIds,
      "rerolling-table": getQualityItemIds,
      "rolling-table": getRollingItemIds,
      "farming-table": getFarmingItemIds,
      "gathering-table": getGatheringItemIds,
      "journal-filling-table": getJournalItemIds,
      // The volume table has no dedicated catalog — it shows whatever the full
      // scan pulled. Its Enter-fetch targets the same universe the market scan
      // does, so a search like "hide" + T8 can fetch T8_HIDE on demand.
      "volume-table": getAllRequiredItemIds,
    };
  }

  // How to price one table's ids and where the result belongs. Every table but
  // one takes best-quality prices from fetchPricesBatch into lastMarketData.
  // Rerolling is the exception: it compares q1→q5 of the SAME item, so it reads
  // per-quality prices out of lastQualityMarketData (mirroring its scan button in
  // scan-handlers.js). Fetching/merging the default way leaves its renderer with
  // an empty store, which is what made Enter a no-op there.
  //   expand — grow the matched ids to their recipe materials before fetching.
  //     Off for rerolling: a reroll row prices one item at two qualities and
  //     never its mats, so expanding would fetch planks and runes at five
  //     qualities each for nothing.
  function fetcherFor(tableId) {
    if (tableId === "rerolling-table") {
      return {
        expand: false,
        fetch: (ids) => fetchPricesBatchWithQualities(ids, [1, 2, 3, 4, 5]),
        merge: (data) => {
          // app.js inits the store to null and only the scan button fills it, so
          // an Enter-fetch before any scan has to seed it.
          if (typeof lastQualityMarketData === "undefined" || !lastQualityMarketData) {
            lastQualityMarketData = {};
          }
          // applyQualityScanPatch rather than Object.assign: assign replaces a
          // whole ITEM, wiping the captured quality cells for it.
          applyQualityScanPatch(lastQualityMarketData, data);
        },
      };
    }
    return {
      expand: true,
      fetch: (ids) => fetchPricesBatch(ids),
      merge: (data) => {
        if (typeof lastMarketData === "undefined" || lastMarketData == null) lastMarketData = {};
        applyScanPatch(lastMarketData, data);
      },
    };
  }

  // Tier/enchant gate for a bare item id (dropdowns filter the catalog too).
  function idPassesTierEnch(id, tierSel, enchSel) {
    if (!tierSel && !enchSel) return true;
    let tier = null;
    let ench = 0;
    const tm = id.match(/T([1-8])_/);
    if (tm) tier = parseInt(tm[1], 10);
    const em = id.match(/@([0-4])(?:\D|$)/);
    if (em) ench = parseInt(em[1], 10);
    if (tierSel && tier !== parseInt(tierSel, 10)) return false;
    if (enchSel && ench !== parseInt(enchSel, 10)) return false;
    return true;
  }

  // Ids in `tableId`'s catalog whose id OR name matches every query term (and
  // passes the tier/enchant dropdowns). This is the set the Enter-fetch targets.
  //
  // Order matters because the result is capped (MAX_SEARCH_FETCH_ITEMS). The
  // catalogs emit each base id followed by its @n variants, which wastes the cap
  // on the tables that keep variants COLLAPSED until their base row is expanded
  // (RERENDER_ON_FILTER: crafting / consumables / craft planner) — "hammer"
  // priced 12 of 60 base hammers and every other row showed an empty Sell price
  // until a full Scan. For those tables bases come first, variants trail.
  //
  // Everywhere else the catalog order is left alone, because those tables SHOW
  // their variants: an enchanting row prices two adjacent levels (.1→.2), so
  // hoisting bases would fetch one end of every row and none of the other. An
  // explicit enchant pick narrows the set to one level, making this moot.
  // Same idea as idPassesTierEnch for the Category/Subcategory pickers: an id
  // with no items.xml shop category can never satisfy an explicit pick.
  function idPassesCategory(id, catSel, subSel) {
    if (!catSel && !subSel) return true;
    const hit = typeof getMarketCategory === "function" ? getMarketCategory(id) : null;
    if (!hit) return false;
    if (catSel && hit.category !== catSel) return false;
    if (subSel && hit.subcategory !== subSel) return false;
    return true;
  }

  function matchedCatalogIds(tableId, terms, tierSel, enchSel, catSel, subSel) {
    const src = tableSources()[tableId];
    if (typeof src !== "function") return [];
    let ids;
    try { ids = src() || []; } catch (e) { return []; }
    const out = [];
    const seen = new Set();
    for (const id of ids) {
      if (!id || seen.has(id)) continue;
      if (!idPassesTierEnch(id, tierSel, enchSel)) continue;
      if (!idPassesCategory(id, catSel || "", subSel || "")) continue;
      if (terms.length) {
        const hay = (id + " " + catalogNameFor(id)).toLowerCase();
        if (!terms.every((t) => hay.includes(t))) continue;
      }
      seen.add(id);
      out.push(id);
    }
    if (!RERENDER_ON_FILTER.has(tableId)) return out;
    // Stable partition: bases keep catalog order, variants trail in theirs.
    const bases = out.filter((id) => !id.includes("@"));
    const variants = out.filter((id) => id.includes("@"));
    return bases.concat(variants);
  }

  // Item ids of the currently-matching data rows for `tableId`. Reads the DOM
  // (so it honours exactly the same text + tier/enchant match as the filter),
  // deduping ids across rows.
  function matchedPrimaryIds(tableId, terms, tierSel, enchSel, catSel, subSel, buyCitySel, sellCitySel) {
    const tbody = document.querySelector(`#${tableId} tbody`);
    if (!tbody) return [];
    const out = new Set();
    Array.from(tbody.rows).forEach((tr) => {
      const kind = classifyRow(tr);
      if (!kind.data) return;
      if (!rowMatches(tr, terms)) return;
      if (!rowPassesTierEnch(tr, tierSel, enchSel)) return;
      if (!rowPassesCategory(tr, catSel || "", subSel || "")) return;
      if (!rowPassesBuyCity(tr, buyCitySel || "", tableId)) return;
      if (!rowPassesSellCity(tr, sellCitySel || "", tableId)) return;
      const key = (typeof tr.getAttribute === "function" && tr.getAttribute("data-row-key")) || "";
      idsFromRowKey(key).forEach((id) => out.add(id));
    });
    return Array.from(out);
  }

  // Grow a set of output ids to include the materials each one needs so profit
  // columns can compute, not just the sell price. Keyed entirely off the id (no
  // per-table wiring): crafting/consumable recipes (via the recipe cache),
  // consumable chain inputs, mount recipe materials, breeding sibling, the
  // transport raw⇄refined pair + its refining chain, farming seed⇄crop, and the
  // journal empty⇄full sibling. Synthetic ids (which the API 404s) are dropped.
  // Direct material ids for a craftable id, read from the in-memory catalogs
  // (gear/consumable/mount materials live on the catalog entry, NOT in
  // BUNDLED_RECIPES). Mirrors getCraftingItemIds' enchant rule so an @n variant
  // fetches the enchanted-resource / @n-combine-input prices its recipe needs.
  function catalogMaterialsFor(id) {
    const mats = new Set();
    const baseId = id.split("@")[0];
    const enchMatch = id.match(/@(\d)/);
    const ench = enchMatch ? enchMatch[1] : null;
    const addEntry = (entry) => {
      if (!entry) return;
      if (entry.matId) mats.add(entry.matId);
      (entry.materials || []).forEach((m) => mats.add(m.matId));
    };
    if (typeof CRAFTING_ITEMS !== "undefined") addEntry(CRAFTING_ITEMS.find((i) => i.id === baseId));
    if (typeof GEAR_RECIPES !== "undefined") addEntry(GEAR_RECIPES.find((g) => g.id === baseId));
    if (typeof CONSUMABLES !== "undefined") addEntry(CONSUMABLES.find((c) => c.id === baseId));
    if (typeof MOUNT_RECIPES !== "undefined") {
      const m = MOUNT_RECIPES.find((x) => x.id === baseId);
      if (m) m.materials.forEach((x) => mats.add(x.matId));
    }
    if (ench) {
      Array.from(mats).forEach((matId) => {
        if (/^T\d+_(LEATHER|CLOTH|METALBAR|PLANKS|STONEBLOCK)$/.test(matId)) {
          mats.add(matId + "_LEVEL" + ench + "@" + ench);
        } else if (/^T\d+_/.test(matId) &&
                   !/ARTEFACT|_BP|TOKEN|_FACTION_|ALCHEMY_RARE|SKILLBOOK/.test(matId)) {
          mats.add(matId + "@" + ench);
        }
      });
    }
    return Array.from(mats);
  }

  async function expandFetchIds(primaryIds) {
    const ids = new Set();
    const add = (x) => { if (x) ids.add(x); };
    for (const id of primaryIds) {
      if (!id) continue;
      add(id);
      // Catalog materials (gear / mount / consumable recipe inputs).
      catalogMaterialsFor(id).forEach(add);
      // Crafting / consumable recipe materials (BUNDLED_RECIPES-backed items).
      if (typeof fetchCraftingRecipe === "function") {
        try { await fetchCraftingRecipe(id); } catch (e) { /* noop */ }
      }
      const recipe = (typeof recipeCache !== "undefined") ? recipeCache[id] : null;
      if (recipe) recipe.forEach((m) => add(m.matId));
      // Consumable CHAIN_RECIPES inputs (raw meat → grown animal, fish chops → fish).
      if (typeof CHAIN_RECIPES !== "undefined" && CHAIN_RECIPES[id]) {
        const cr = CHAIN_RECIPES[id];
        if (Array.isArray(cr.options)) cr.options.forEach((o) => (o.inputs || []).forEach((m) => add(m.matId)));
        (cr.inputs || []).forEach((m) => add(m.matId));
      }
      // Mount recipe materials.
      if (typeof MOUNT_RECIPES !== "undefined") {
        const m = MOUNT_RECIPES.find((x) => x.id === id);
        if (m) m.materials.forEach((x) => add(x.matId));
      }
      // Breeding sibling (baby ⇄ grown) + the feed the row's grow/nurture cost is
      // priced from (findCheapestFeed scans every crop/herb/meat/chocolate id).
      if (typeof BREEDING_ITEMS !== "undefined") {
        const b = BREEDING_ITEMS.find((x) => x.babyId === id || x.grownId === id);
        if (b) {
          add(b.babyId); add(b.grownId);
          if (typeof getBreedingFeedIds === "function") getBreedingFeedIds().forEach(add);
        }
      }
      // Transport refining pair: raw ⇄ refined + secondary + the refining chain +
      // the row's substitution inputs (faction heart, via getRefiningChainIds; the
      // lower nodes the raw transmutes up from, via getRawTransmuteIds). Every
      // matching row is expanded — a plain block id like T6_STONEBLOCK is the
      // refined good of both the plain-rock row and each enchanted-rock alt row.
      if (typeof TRANSPORT_ITEMS !== "undefined") {
        TRANSPORT_ITEMS.filter((x) => x.rawId === id || x.refinedId === id).forEach((ti) => {
          add(ti.rawId); add(ti.refinedId); add(ti.secondaryMatId);
          if (typeof getRefiningChainIds === "function") {
            try { getRefiningChainIds(ti.refinedId).forEach(add); } catch (e) { /* noop */ }
          }
          if (typeof getRawTransmuteIds === "function") {
            try { getRawTransmuteIds(ti.rawId).forEach(add); } catch (e) { /* noop */ }
          }
        });
      }
      // Farming pair (seed/feed ⇄ harvested output), plus the grown animal a
      // pasture row feeds. Rows are { id, outputId, animalId? }.
      if (typeof FARMING_PRODUCTION !== "undefined") {
        FARMING_PRODUCTION.filter((x) => x.id === id || x.outputId === id || x.animalId === id)
          .forEach((f) => {
            add(f.id); add(f.outputId);
            if (f.animalId) add(f.animalId);
          });
      }
      // Enchantable equipment: the .0-.3 siblings the enchanting rows step
      // between, plus that tier's rune/soul/relic. The enchant mats never match
      // the query by name, so without this an enchanting search fetches the item
      // and still renders nothing (every row needs a mat price).
      if (typeof getEquipmentSlot === "function" && typeof getTierFromId === "function") {
        const baseId = id.split("@")[0];
        const tier = getTierFromId(baseId);
        if (getEquipmentSlot(baseId) && tier >= 4 && tier <= 8) {
          add(baseId);
          for (let lvl = 1; lvl <= 3; lvl++) add(`${baseId}@${lvl}`);
          ["RUNE", "SOUL", "RELIC"].forEach((m) => add(`T${tier}_${m}`));
        }
      }
      // Transmute counterparts: every transmute row prices a SOURCE and a
      // TARGET, but a query only ever names one of them — "relic" matches the
      // Relic ids, never the Soul that "Soul → Relic" starts from nor the
      // Avalonian Shard it ends at. Without the other end the row has no price
      // and gets dropped, so Enter would look like it did nothing. One hop only:
      // the ids a matched id directly transmutes to or from.
      if (typeof getTransmuteRecipes === "function") {
        try {
          getTransmuteRecipes().forEach((r) => {
            if (r.sourceId === id || r.targetId === id) { add(r.sourceId); add(r.targetId); }
          });
        } catch (e) { /* noop */ }
      }
      // Journal empty ⇄ full sibling (one row prices both).
      if (/_JOURNAL_/.test(id)) {
        add(id.replace(/_FULL$/, "_EMPTY"));
        add(id.replace(/_EMPTY$/, "_FULL"));
      }
    }
    return Array.from(ids).filter(
      (x) => !(typeof isSyntheticId === "function" && isSyntheticId(x)),
    );
  }

  let searchFetching = false;
  // The last "still unpriced" banner we raised, so a later press can retract it.
  let lastNotice = null;
  // Cap the fetch so a 1-character query ("t") can't fire a thousand-item
  // request that defeats the point of a targeted lookup. Sized to clear a whole
  // family in one press — the real catalogs hold 266 journals (Laborers), 227
  // leather items (Flipping), 219 leather crafts — because every id past the cap
  // renders as a row with an empty Sell price. api.js chunks at 150, so this is
  // two round trips for the primaries.
  const MAX_SEARCH_FETCH_ITEMS = 300;

  // The price store a table reads (rerolling keeps its own per-quality one, see
  // fetcherFor). Used to tell a priced id from an unpriced one.
  function priceStoreFor(tableId) {
    if (tableId === "rerolling-table") {
      return (typeof lastQualityMarketData !== "undefined" && lastQualityMarketData) || {};
    }
    return (typeof lastMarketData !== "undefined" && lastMarketData) || {};
  }

  // Visible data rows referencing at least one id the price store doesn't hold,
  // plus the ids themselves. The ids are what makes a repeated banner
  // diagnosable: a count alone cannot tell "the next press will fetch these"
  // from "the API has no data for these, so no number of presses will help".
  function unpricedVisibleRows(tableId) {
    const tbody = document.querySelector(`#${tableId} tbody`);
    if (!tbody) return { count: 0, ids: [] };
    const store = priceStoreFor(tableId);
    let count = 0;
    const ids = new Set();
    Array.from(tbody.rows).forEach((tr) => {
      if (tr.style.display === "none") return;
      if (!classifyRow(tr).data) return;
      const key = (typeof tr.getAttribute === "function" && tr.getAttribute("data-row-key")) || "";
      if (!key) return;
      const missing = idsFromRowKey(key).filter((id) => !store[id]);
      if (!missing.length) return;
      count++;
      missing.forEach((id) => ids.add(id));
    });
    return { count, ids: Array.from(ids) };
  }

  // Order the fetch candidates so the capped slice buys the most rows:
  //   1. ids the price store doesn't hold yet (a second Enter press then makes
  //      progress instead of re-fetching the first 300 — the row filter matches
  //      rendered TEXT, so "leather" shows 1006 crafting rows against a
  //      219-id catalog match and one press can never cover it),
  //   2. within that, bases before @n variants on the tables that keep variants
  //      collapsed (see matchedCatalogIds).
  // Both partitions are stable, so catalog order survives inside each group.
  function prioritizeFetchIds(tableId, ids, store) {
    const uniq = [];
    const seen = new Set();
    (ids || []).forEach((id) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      uniq.push(id);
    });
    const priced = (id) => !!(store && store[id]);
    const collapse = RERENDER_ON_FILTER.has(tableId);
    const rank = (id) => (priced(id) ? 2 : 0) + (collapse && id.includes("@") ? 1 : 0);
    const groups = [[], [], [], []];
    uniq.forEach((id) => groups[rank(id)].push(id));
    return groups[0].concat(groups[1], groups[2], groups[3]);
  }

  // Message for rows the filter shows but this press couldn't price, or null
  // when everything visible came back priced.
  //
  // `exhausted` — every leftover id was ALREADY asked for in this press and the
  // API returned nothing for it. Pressing Enter again then changes nothing, so
  // telling the user to press again is a lie that reads like a broken fetch.
  function unpricedRowsNotice(count, exhausted = false) {
    if (!count) return null;
    if (exhausted) {
      return (
        `${count} matching rows have no market data (nobody has listed them, or ` +
        `no scan has reached them). Nothing more to fetch for this search.`
      );
    }
    return (
      `${count} matching rows are still unpriced (the filter also matches material ` +
      `names). Press Enter again to fetch the next batch, or Scan for all of them.`
    );
  }

  // Message for the cap biting, or null when everything matched was fetched.
  // Broad queries in the big catalogs ("leather" hits 819 ids in the Volume
  // table) can't be served whole; saying so beats leaving the user to wonder why
  // some rows are still blank.
  function fetchCapNotice(matchedCount) {
    if (matchedCount <= MAX_SEARCH_FETCH_ITEMS) return null;
    return (
      `Search matched ${matchedCount} items — priced the first ${MAX_SEARCH_FETCH_ITEMS}. ` +
      `Narrow it with the Tier/Ench. pickers or a longer query.`
    );
  }

  // "Fetching 40 items…" beside the box the user typed into. #loading-overlay
  // says the same thing from the page header, next to the Language select, which
  // is off screen the moment a table is what you are looking at. Created on
  // first use and kept: the pickers are injected as siblings of the input
  // (js/table-search.js injectFilterControls), so that row is the right home.
  function searchFetchStatusEl(tableId) {
    const input = document.getElementById(searchInputId(tableId));
    if (!input || !input.parentNode) return null;
    const id = `search-fetch-status-${tableId}`;
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement("span");
      el.id = id;
      el.className = "search-fetch-status";
      input.parentNode.insertBefore(el, input.nextSibling);
    }
    return el;
  }

  // Enter handler: fetch prices for the items matching this table's search box.
  async function searchFetchForTable(tableId) {
    if (searchFetching) return;
    if (typeof fetchPricesBatch !== "function") return;
    const render = tableRenderers()[tableId];
    if (!render) return; // table not backed by fetchable market data

    const input = document.getElementById(searchInputId(tableId));
    const q = ((input && input.value) || "").trim().toLowerCase();
    const terms = q ? q.split(/\s+/).filter(Boolean) : [];
    const val = (id) => document.getElementById(id)?.value || "";
    const tierSel = val(tierFilterId(tableId));
    const enchSel = val(enchFilterId(tableId));
    const catSel = val(categoryFilterId(tableId));
    const subSel = val(subcategoryFilterId(tableId));
    // City narrows the on-screen rows but never the catalog: an id carries no
    // city, and a city pick alone would still mean "fetch everything".
    const buyCitySel = val(buyCityFilterId(tableId));
    const sellCitySel = val(sellCityFilterId(tableId));
    // No query at all → don't fetch the whole catalog.
    if (terms.length === 0 && !tierSel && !enchSel && !catSel && !subSel) return;

    // What this table COULD show that matches the query — read from the catalog,
    // since the renderers drop no-data rows and an unscanned table has none.
    // Union with the ids of the rows ALREADY on screen for this query: the row
    // filter matches rendered text (a crafting row matches "leather" through its
    // recipe), so the DOM holds matches the catalog lookup never names.
    const store = priceStoreFor(tableId);
    const matched = prioritizeFetchIds(
      tableId,
      matchedCatalogIds(tableId, terms, tierSel, enchSel, catSel, subSel).concat(
        matchedPrimaryIds(tableId, terms, tierSel, enchSel, catSel, subSel, buyCitySel, sellCitySel),
      ),
      store,
    );
    if (matched.length === 0) return; // nothing in this table's catalog matched
    const capped = matched.slice(0, MAX_SEARCH_FETCH_ITEMS);
    const capNotice = fetchCapNotice(matched.length);
    if (capNotice) console.warn(`[search-fetch] "${q}": ${capNotice}`);

    searchFetching = true;
    const fetchingText = `Fetching ${capped.length} item${capped.length > 1 ? "s" : ""}…`;
    const status = searchFetchStatusEl(tableId);
    if (status) status.textContent = fetchingText;
    const overlay = document.getElementById("loading-overlay");
    if (overlay) {
      overlay.classList.remove("hidden");
      overlay.textContent = fetchingText;
    }
    // Before the await, not after it: the fetch is the part worth reporting.
    beginSearchMark(tableId);
    try {
      const fetcher = fetcherFor(tableId);
      const fetchIds = fetcher.expand ? await expandFetchIds(capped) : capped;
      const data = await fetcher.fetch(fetchIds);
      fetcher.merge(data);
      // Same maps the scan buttons fill, so an Enter-fetch is kept the same way.
      if (typeof persistScanPrices === "function") persistScanPrices();
      render(); // re-render with live prices; updateTableDisplay re-applies the filter
      // The rows are drawn, so whatever is in them now is the new number. Not in
      // the finally: that runs after the notice work below, which would leave
      // fresh numbers spinning while it counts unpriced rows.
      endSearchMark();
      // Whatever the cap (or a text-only match) left behind renders as a row
      // with an empty Sell price — indistinguishable from a broken fetch, which
      // is exactly how the reported crafting bug looked. Say what happened.
      const { count: leftover, ids: leftoverIds } = unpricedVisibleRows(tableId);
      // `requested` = the ids this press actually asked the API for. A leftover
      // id inside it came back empty, so no further press can help.
      const requested = new Set(fetchIds);
      const exhausted = leftover > 0 && leftoverIds.every((id) => requested.has(id));
      const notice = unpricedRowsNotice(leftover, exhausted);
      if (leftover) {
        console.warn(
          `[search-fetch] "${q}": ${leftover} rows unpriced — ids:`,
          leftoverIds.map((id) => (requested.has(id) ? `${id} (no market data)` : id)),
        );
      }
      if (notice && typeof showFetchError === "function") {
        showFetchError(notice);
        lastNotice = notice;
      } else if (!notice) {
        // A follow-up press cleared the backlog — drop our own stale banner (and
        // only ours: a real API error banner must survive).
        const banner = document.getElementById("api-error-banner");
        if (banner && lastNotice && banner.textContent.includes(lastNotice)) banner.remove();
        lastNotice = null;
      }
    } catch (e) {
      endSearchMark();
      console.error("[search-fetch] failed:", e);
      if (typeof showFetchError === "function") showFetchError(e.message || "Search fetch failed");
    } finally {
      searchFetching = false;
      if (status) status.textContent = "";
      if (overlay) { overlay.classList.add("hidden"); overlay.textContent = "Fetching data..."; }
    }
  }

  if (typeof window !== "undefined") {
    window.searchFetchForTable = searchFetchForTable;
    // The Black Market board's scan button reuses this registry to work out
    // which feeder tables a targeted scan can have moved (js/bm-board-scan.js).
    // Published rather than duplicated so the two never drift.
    window.tableSources = tableSources;
    // My Crafting List reuses this registry to force-render a source table
    // whose row it holds but whose cache the last pass skipped (collapsed
    // band) — see js/render-craft-list.js.
    window.tableRenderers = tableRenderers;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      expandFetchIds,
      matchedPrimaryIds,
      matchedCatalogIds,
      fetcherFor,
      idPassesTierEnch,
      idPassesCategory,
      MAX_SEARCH_FETCH_ITEMS,
      fetchCapNotice,
      prioritizeFetchIds,
      unpricedRowsNotice,
      SEARCH_FETCH_MARK_TABLES,
      searchMarkTables,
    };
  }
})();
