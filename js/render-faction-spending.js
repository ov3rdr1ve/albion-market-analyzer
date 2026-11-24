/**
 * Faction Spending render module.
 *
 * Lists every FP-spendable item from the Faction Enlistment NPC alongside
 * its silver-equivalent value, computed silver/FP ratio, and best market.
 *
 * Categories (all sorted together by silver/FP descending):
 *  - Heart fragments — direct market sale (best sell across all cities)
 *  - Crests (T4–T8 × 5 royal cities) — direct market sale
 *  - Crafted faction capes (T4–T8, royal + Favor families) — crest → cape:
 *    spend the crest's FP/Favor, deduct the other recipe mats from the cape
 *    sale (js/faction-cape-craft.js)
 *  - Iron Campaign Chests — expected silver yield (default 76K, override per row)
 *    PLUS the contained Tomes of Insight (2× Grandmaster + 1× Master), valued by
 *    fame-equivalence against the tradeable Adept's Tome of Insight
 *  - Babies (T5/T8 × 6 cities) — direct market sale of the baby item
 *
 * Bronze/Silver/Gold campaign chests are excluded — those are monthly campaign
 * rewards, not buyable on demand at the NPC.
 *
 * Hearts can ALSO be used in T4+ refining as a substitute for the lower-tier
 * refined material (per wiki). Direct sale is the simpler valuation; the
 * refining-substitution path can yield more if local lower-tier prices are
 * elevated, but it's recipe-specific and out of scope for this table. A note
 * is rendered on the heart rows as a reminder.
 *
 * Baby rows additionally surface a collapsible breed-inputs sub-row exposing
 * every input (saddled mount price, food, saddler mats) as click-to-override
 * spans, so users can override breed inputs without jumping to the Mounts table.
 */
/**
 * Category cell text. Categories are stored in English (they are also filter
 * keys), so only the display is translated.
 */
function categoryLabel(category) {
  const slug = "cat_" + String(category).toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return typeof tx === "function" ? tx(category, slug) : category;
}

function getFactionSpendingItemIds() {
  const fpIds = Object.keys(FACTION_FP_COSTS);
  // Favor (Energy Manipulator) rows live in the same table, so their market
  // prices must be fetched in the same scan.
  const favorIds = (typeof getFavorSpendItemIds === "function") ? getFavorSpendItemIds() : [];
  // The tradeable Adept's Tome of Insight is needed to value the non-tradeable
  // tomes contained in the Iron Campaign Chests (by fame-equivalence).
  const tomeIds = (typeof TRADEABLE_TOME_ID !== "undefined") ? [TRADEABLE_TOME_ID] : [];
  // Crafted faction capes (crest → cape) + their non-crest recipe mats
  // (base capes, hearts, Mists/Avalon tokens); see js/faction-cape-craft.js.
  const capeIds = (typeof getFactionCapeCraftIds === "function") ? getFactionCapeCraftIds() : [];
  return Array.from(new Set([...fpIds, ...favorIds, ...tomeIds, ...capeIds]));
}

// Per-unit silver value of one fame point, derived from the cheapest market
// price of the tradeable Adept's Tome of Insight across all cities (the
// rational place to acquire equivalent fame). Returns 0 if unpriced.
function getTomeSilverPerFame(marketData) {
  if (typeof TRADEABLE_TOME_ID === "undefined" || typeof getBuyPrice !== "function") return 0;
  const fameOfTradeable = (typeof TOME_INSIGHT_FAME !== "undefined")
    ? TOME_INSIGHT_FAME[TRADEABLE_TOME_TIER] : 0;
  if (!fameOfTradeable) return 0;
  const itemData = marketData && marketData[TRADEABLE_TOME_ID];
  if (!itemData) return 0;
  const cities = (typeof CITIES !== "undefined") ? CITIES : [];
  let best = 0;
  for (const c of cities) {
    const p = getBuyPrice(itemData, c, null, TRADEABLE_TOME_ID);
    if (p > 0 && (best === 0 || p < best)) best = p;
  }
  return best > 0 ? best / fameOfTradeable : 0;
}

// Total silver value of the Tomes of Insight contained in one Iron Campaign
// Chest, valued by fame-equivalence against the tradeable Adept's Tome.
function getChestTomeValue(marketData) {
  if (typeof CHEST_TOME_CONTENTS === "undefined" || typeof TOME_INSIGHT_FAME === "undefined") return 0;
  const perFame = getTomeSilverPerFame(marketData);
  if (perFame <= 0) return 0;
  let totalFame = 0;
  for (const t of CHEST_TOME_CONTENTS) {
    const fame = TOME_INSIGHT_FAME[t.tier];
    if (fame) totalFame += fame * t.count;
  }
  return Math.round(totalFame * perFame);
}

// Read a fixed-yield chest's overrideable expected-silver yield. The yield is a
// single city-independent number (RNG loot value), but it's stored in the
// city-keyed override map, so we scan every city and return the first override
// found. This lets the user set the yield from whichever city they're in — the
// chest NPCs (Faction Enlistment / Energy Manipulator) stand in every city — and
// still read it back. The chest's item id is unique, so the key never collides
// with another chest regardless of which city it was saved under.
function getChestYieldOverride(chestId) {
  if (typeof getOverridePrice !== "function") return null;
  const cities = (typeof SELL_CITIES !== "undefined") ? SELL_CITIES
    : (typeof CITIES !== "undefined") ? CITIES : [];
  for (const c of cities) {
    const o = getOverridePrice(chestId, c);
    if (o !== null && o > 0) return o;
  }
  return null;
}

// Persisted UI state — which baby rows have their breed-inputs sub-row open.
// Survives re-renders triggered by overrides.
const _expandedBreedBabies = new Set();

// Build a babyId → enriched breed data lookup from the already-computed mounts
// table data. Mounts render before faction-spending in app.js, so the data
// is populated by the time we read it. Per babyId we keep whichever breeding
// variant (royal vs caerleon) has the highest silverPerFp.
function getBreedDataByBaby() {
  const map = {};
  if (typeof tableState === "undefined") return map;
  const mountsData = tableState["mounts-table"]?.data;
  if (!Array.isArray(mountsData)) return map;
  mountsData.forEach((r) => {
    if (!r.recipe || !r.item?.babyId) return;
    const babyId = r.item.babyId;
    // Rank variants by whichever currency this baby is bought in: FP babies by
    // silver/FP, Favor babies (Brecilien owls) by silver/Favor. Comparing on the
    // max keeps the best variant regardless of currency.
    const ratio = Math.max(r.silverPerFp || 0, r.silverPerFavor || 0);
    const cur = map[babyId];
    if (!cur || ratio > Math.max(cur.silverPerFp || 0, cur.silverPerFavor || 0)) {
      map[babyId] = {
        silverPerFp: r.silverPerFp || 0,
        silverPerFavor: r.silverPerFavor || 0,
        sellItemId: r.sellItemId,
        sellPrice: r.sellPot?.price || 0,
        sellCity: r.sellPot?.city || "",
        feed: r.feed || null,
        feedCost: r.feedCost || 0,
        recipe: r.recipe,
        saddlerMatPrices: r.saddlerMatPrices,
        saddlerCity: r.saddlerCity,
        saddlerRrr: r.saddlerRrr,
        saddlerFocusCost: r.saddlerFocusCost || 0,
        saddlerProfitPerFocus: r.saddlerProfitPerFocus || 0,
        breedingProfitPerFocus: r.profitPerFocus || 0,
        nurtureFocusCost: r.focusCost || 0,
        // The nurture play on its own: what the focus adds to one cycle and how
        // many daily charges the ladder takes. My Crafting List bills a bred
        // baby per day off these, the same as a Breeding & Mounts row.
        nurtureProfitDelta: r.nurtureProfitDelta || 0,
        maxNurtures: (r.meta && r.meta.maxNurtures) || 0,
        // Cycle profit with every FP-priced input (baby + hearts) added back —
        // basis for the "profit / 10k focus (FP inputs)" column.
        fpAdjustedProfit: r.fpAdjustedProfit || 0,
        // Focus-ON twin — the per-10k-focus column rides on this so it stays a
        // benchmark instead of tracking the "Use Focus" checkbox.
        fpAdjustedProfitFocusOn: r.fpAdjustedProfitFocusOn || 0,
        // FP placements (baby, saddler hearts) and the one that buys the most
        // silver per FP — the "Best FP" line of the S/FP (Bred) cell.
        fpPlays: r.fpPlays || [],
        bestFpPlay: r.bestFpPlay || null,
        // The silver side of the breed plan (My Crafting List / Qty columns):
        // the baby's buy leg and the cycle's whole bought cost, so a row that
        // pays FP for only some inputs still buys the rest.
        babyBuy: r.buyMat ? { city: r.buyMat.city, price: r.buyMat.price || 0 } : null,
        totalInputCost: r.totalInputCost || 0,
        grownId: r.item.grownId,
        section: r.section,
        // Masterpiece bonus passthrough — annotation rendered in S/FP (Bred) cell.
        mpSilverPerFp: r.mpSilverPerFp || 0,
        mpSilverPerFavor: r.mpSilverPerFavor || 0,
        mpSellCity: r.mpSellCity || null,
        mpSellPrice: r.mpSellPrice || 0,
        mpRevenuePerCycle: r.mpRevenuePerCycle || 0,
      };
    }
  });
  return map;
}

function buildFactionSpendRow(itemId, marketData, opts) {
  const fpCost = getFpCost(itemId);
  if (fpCost <= 0) return null;

  const cities = opts.tradeable ? CITIES : [opts.openCity];
  let sellCity = opts.openCity || "Thetford";
  let sellPrice = 0;

  if (opts.tradeable) {
    // The sell city must be reachable from the faction NPC's city (where you
    // spend the FP) without crossing black/red zones — unless the user opted
    // into those routes. Passing the item's source faction city as the route
    // origin lets findBestSellCity apply isInvalidCrossRoute; otherwise a
    // royal-sourced crest/heart/baby would be valued in Caerleon even with
    // Black/Red Zone Routes disabled (a Royal↔Caerleon hop).
    const sourceCity = (typeof getItemFaction === "function")
      ? getItemFaction(itemId)
      : null;
    const best = findBestSellCity(marketData, itemId, cities, 0, sourceCity);
    if (best.city && best.price > 0) {
      sellCity = best.city;
      sellPrice = best.price;
    }
  } else if (opts.fixedYield) {
    sellPrice = getChestYieldOverride(itemId) || opts.fixedYield;
  }

  const grossSilver = sellPrice;
  // bonusValue (e.g. fame-valued tomes inside a chest) rides on top of the
  // overrideable silver loot, untaxed — it isn't sold on the market.
  const bonusValue = opts.bonusValue || 0;
  const netSilver = opts.tradeable
    ? netSilverAfterFees(grossSilver, true)
    : grossSilver + bonusValue; // chest yields are already-liquidated silver, no market fees
  const silverPerFp = calculateSilverPerFp(netSilver, fpCost);
  const dailyVol = opts.tradeable
    ? (marketData[itemId]?.[sellCity]?.volume_24h || 0)
    : 0;

  return {
    itemId,
    name: opts.displayName || getItemDisplayName(itemId),
    category: opts.category,
    currency: "FP",
    fpCost,
    favorCost: 0,
    silverPerFavor: 0,
    sellCity,
    sellPrice: grossSilver,
    bonusValue,
    netSilver,
    silverPerFp,
    breedSilverPerFp: opts.breedData ? (opts.breedData.silverPerFp || 0) : 0,
    breedData: opts.breedData || null,
    dailyVol,
    note: opts.note || "",
    tradeable: !!opts.tradeable,
  };
}

// ─── Feeder-cache fallback ───────────────────────────────────────────────────
// The S/FP (Bred) column, the breed-inputs sub-row and the baby Profit / 10k
// Focus read tableState["mounts-table"].data. Render gating skips collapsed
// tables and a fresh boot starts every table collapsed, so on the first render
// after a restart that cache can be empty — leaving every Baby row a dead "—" with no
// expand toggle to fix it by hand. Compute the feeder rows on demand here,
// exactly what Scan Faction Spending's handler already does first
// (js/scan-handlers.js). renderTableData skips DOM painting for collapsed
// tables, so this only pays for row math, and a feeder renderer that throws
// must never take this table down with it.
function ensureFactionSourceData(marketData) {
  if (!marketData || typeof tableState === "undefined") return;
  const feeders = [
    ["mounts-table", (typeof renderMountsTable === "function") ? renderMountsTable : null],
  ];
  for (const [tableId, render] of feeders) {
    if (typeof render !== "function") continue;
    const cached = tableState[tableId]?.data;
    if (Array.isArray(cached) && cached.length > 0) continue;
    try {
      render(marketData);
    } catch (e) {
      if (typeof console !== "undefined") console.error(`ensureFactionSourceData ${tableId}:`, e);
    }
  }
}

function buildFactionSpendingRows(marketData) {
  if (!marketData) return [];
  ensureFactionSourceData(marketData);
  const rows = [];

  // Hearts — direct sale, best of all cities
  const heartIds = [
    "T1_FACTION_SWAMP_TOKEN_1",
    "T1_FACTION_FOREST_TOKEN_1",
    "T1_FACTION_MOUNTAIN_TOKEN_1",
    "T1_FACTION_HIGHLAND_TOKEN_1",
    "T1_FACTION_STEPPE_TOKEN_1",
    "T1_FACTION_CAERLEON_TOKEN_1",
  ];
  heartIds.forEach((id) => {
    const r = buildFactionSpendRow(id, marketData, {
      tradeable: true,
      category: "Heart",
      note: tx("Also usable as T4+ refining substitute", "r_note_heart_refine"),
    });
    if (r) rows.push(r);
  });

  // Crests — T4..T8 × 5 royal cities. Brecilien crests are a Favor purchase
  // (Eralia Wayfarer), so they're built in the Favor section, not here.
  const crestCities = ["THETFORD", "LYMHURST", "BRIDGEWATCH", "FORTSTERLING", "MARTLOCK"];
  for (let t = 4; t <= 8; t++) {
    crestCities.forEach((c) => {
      const id = `T${t}_CAPEITEM_FW_${c}_BP`;
      const r = buildFactionSpendRow(id, marketData, {
        tradeable: true,
        category: `Crest T${t}`,
      });
      if (r) rows.push(r);
    });
  }

  // Iron Campaign Chests — open for fixed silver yield (user-overrideable) PLUS
  // the contained Tomes of Insight, valued by fame-equivalence vs the tradeable
  // Adept's Tome of Insight (market-driven, shared across all chests).
  if (typeof FACTION_CHESTS !== "undefined") {
    const tomeValue = (typeof getChestTomeValue === "function") ? getChestTomeValue(marketData) : 0;
    const fmt = (typeof formatSilver === "function") ? formatSilver : (n) => String(Math.round(n));
    const tomeNote = tomeValue > 0
      ? `+${fmt(tomeValue)} ${tx("from tomes (2× Grandmaster + 1× Master, valued vs Adept's Tome of Insight).", "r_note_chest_tomes")} `
      : "";
    FACTION_CHESTS.forEach((chest) => {
      const r = buildFactionSpendRow(chest.id, marketData, {
        tradeable: false,
        category: "Iron Chest",
        openCity: chest.city,
        displayName: chest.name,
        fixedYield: DEFAULT_CHEST_AVG_YIELD,
        bonusValue: tomeValue,
        note: `${tomeNote}${tx("Override silver yield by clicking the price (right-click)", "r_note_override_yield")}`,
      });
      if (r) rows.push(r);
    });
  }

  // Babies — T5 (3K FP) and T8 (50K FP) × 6 cities — direct sale
  const babyT5 = [
    ["T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY", "Thetford"],
    ["T5_FARM_DIREBOAR_FW_LYMHURST_BABY", "Lymhurst"],
    ["T5_FARM_RAM_FW_MARTLOCK_BABY", "Martlock"],
    ["T5_FARM_MOABIRD_FW_BRIDGEWATCH_BABY", "Bridgewatch"],
    ["T5_FARM_DIREBEAR_FW_FORTSTERLING_BABY", "Fort Sterling"],
    ["T5_FARM_GREYWOLF_FW_CAERLEON_BABY", "Caerleon"],
  ];
  const babyT8 = [
    ["T8_FARM_SWAMPDRAGON_FW_THETFORD_BABY", "Thetford"],
    ["T8_FARM_DIREBOAR_FW_LYMHURST_BABY", "Lymhurst"],
    ["T8_FARM_RAM_FW_MARTLOCK_BABY", "Martlock"],
    ["T8_FARM_MOABIRD_FW_BRIDGEWATCH_BABY", "Bridgewatch"],
    ["T8_FARM_DIREBEAR_FW_FORTSTERLING_BABY", "Fort Sterling"],
    ["T8_FARM_GREYWOLF_FW_CAERLEON_BABY", "Caerleon"],
  ];
  const breedDataByBaby = getBreedDataByBaby();
  [...babyT5, ...babyT8].forEach(([id]) => {
    const r = buildFactionSpendRow(id, marketData, {
      tradeable: true,
      category: id.startsWith("T5") ? "Baby T5" : "Baby T8",
      note: tx("Also usable as input to mount breeding chain", "r_note_baby_breeding"),
      breedData: breedDataByBaby[id] || null,
    });
    if (r) rows.push(r);
  });

  // Crafted faction capes — the FP-currency counterparties of the crest rows
  // just above (crest → cape: the cape row spends the crest's FP and deducts
  // the other recipe mats from the cape sale). Favor-crest capes are held back
  // so they land with the other Favor rows below; see js/faction-cape-craft.js.
  let capeFavorRows = [];
  if (typeof buildFactionCapeCraftRows === "function") {
    const cape = buildFactionCapeCraftRows(marketData);
    rows.push(...cape.fpRows);
    capeFavorRows = cape.favorRows;
  }

  // Energy Manipulator (Favor) rows — silver-per-Favor counterparts, in the
  // same table. Appended after the FP rows; see js/render-favor-spending.js.
  if (typeof buildFavorSpendingRows === "function") {
    rows.push(...buildFavorSpendingRows(marketData));
  }
  rows.push(...capeFavorRows);

  // Profit per 10k focus when the FP-bought baby is bred & saddled instead of
  // resold, with the baby costing 0 silver because it was paid for in FP. See
  // js/faction-focus-value.js. Hearts get none: a heart is not a focus play.
  rows.forEach((r) => {
    let info = null;
    if (r.breedData && typeof getBabyFpFocusValue === "function") {
      info = getBabyFpFocusValue(r.breedData);
    }
    r.fpFocusInfo = info;
    r.fpFocusPer10k = info ? info.per10k : 0;
  });

  // Faction filter — when a faction is selected in the UI dropdown, drop rows
  // whose source faction doesn't match. Empty string = "All factions" = no
  // filter. Favor rows carry their own vendor group in `favorFaction` (Energy
  // Manipulator / Smuggler's Den / The Antiquarian / Brecilien), so each Favor
  // vendor is selectable independently just like the royal FP factions.
  const factionFilter = (typeof document !== "undefined")
    ? (document.getElementById("faction-spending-filter")?.value || "")
    : "";
  let filteredRows = rows;
  if (factionFilter) {
    filteredRows = rows.filter((r) => {
      const f = r.currency === "Favor"
        ? (r.favorFaction || "Energy Manipulator")
        : ((typeof getItemFaction === "function") ? getItemFaction(r.itemId) : null);
      return f === factionFilter;
    });
  }

  filteredRows.sort((a, b) => b.silverPerFp - a.silverPerFp);
  return filteredRows;
}

// Render a sell-side editable span for the saddled mount price. Mirrors
// matPriceSpan but with data-city-list="sell" and no "@ ... ea" prefix.
function _saddledPriceSpan(itemId, city, price) {
  const hasOverride = typeof getOverridePrice === "function" && getOverridePrice(itemId, city) !== null;
  const indicator = hasOverride
    ? ' <span class="ov-mark" style="color:#9e8840;font-size:0.75rem" title="${tx("Price overridden", "r_price_overridden")}">⚡</span>'
    : "";
  const overrideStyle = hasOverride ? "color:#9e8840;" : "";
  const display = price > 0 ? formatSilver(price) : tx("no data", "r_no_data");
  return `<span class="price-editable" data-item-id="${itemId}" data-city="${city || ""}" data-raw-price="${price}" data-city-list="sell" style="cursor:pointer;text-decoration:underline dotted;${overrideStyle}" title="Click to override saddled mount sell price">${display}${indicator}</span>`;
}

/**
 * "Best FP" line under a Baby row's S/FP (Bred) ratio — the FP counterpart of
 * the Crafting Planner's Best Focus cell. A breeding cycle can take FP in more
 * than one place (the baby, the saddler's hearts, or both); this names the
 * placement whose FP earns the most silver per point, the cycle profit it
 * leaves, and that rate. Every placement is listed in the hover. Scoring lives
 * in pickBestFpPlay (js/faction-focus-value.js); the plays in js/render-mounts.js.
 * Empty when no placement can be scored.
 */
function _fpItemName(itemId, count) {
  const name = (typeof getItemDisplayName === "function") ? getItemDisplayName(itemId) : itemId;
  return count > 1 ? `${count}× ${name}` : name;
}

function _fpPlayName(p) {
  if (Array.isArray(p.items)) return p.items.map((it) => _fpItemName(it.itemId, it.count)).join(" + ");
  return _fpItemName(p.itemId, p.count);
}

function _bestFpLineHtml(bd) {
  const best = bd && bd.bestFpPlay;
  if (!best) return "";
  const lines = (bd.fpPlays || [])
    .filter((p) => p && p.fpCost > 0 && p.silverSaved > 0 && p.cycleProfit > 0)
    .map((p) => `${_fpPlayName(p)}: ${formatSilver(p.cycleProfit)} / ${formatSilver(p.fpCost)} FP = ${(p.cycleProfit / p.fpCost).toFixed(2)}/FP`);
  const tip = tx("Where FP earns the most in this chain: cycle profit with those inputs paid in FP (the rest bought), per FP. Paying for everything is the S/FP (Bred) figure.", "r_best_fp_tip")
    + "\n" + lines.join("\n");
  return `<small style="display:block;font-size:0.7rem;color:#9ca3af" title="${tip}">${tx("Best FP", "r_best_fp")}: `
    + `<span style="color:#e5e7eb;text-decoration:underline dotted">${_fpPlayName(best)}</span> `
    + `<b class="profit-low">+${formatSilver(best.cycleProfit)}</b>${tx("/cycle", "r_per_cycle")} · `
    + `<b class="profit-low">${best.silverPerFp.toFixed(2)}</b>/FP</small>`;
}

/**
 * The table's own column count, for the full-width detail row's colspan.
 *
 * Read rather than written down: a colspan that outruns the header invents
 * anonymous columns, and this table has gained columns twice.
 */
function _fsColCount() {
  // Guarded on the METHOD, not on `document`: the renderer tests stub a minimal
  // document with only the handful of calls they need on it.
  if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") {
    return 12;
  }
  return document.querySelectorAll("#faction-spending-table thead th").length || 12;
}

/**
 * The expanded ▾ sub-row under a Baby row.
 *
 * Its cell spans the whole table, so the grid inside is wrapped in .row-fluid
 * (css/styles.css): the table is `width: max-content`, and the grid's old fixed
 * tracks demanded ~960px from that cell — opening one sub-row shoved every real
 * column sideways and closing it snapped them back.
 */
function _renderBreedDetailRow(row) {
  if (!row.breedData) return "";
  const isOpen = _expandedBreedBabies.has(row.itemId);
  const display = isOpen ? "table-row" : "none";
  const bd = row.breedData;

  // Baby (input) — sell-side silver price + FP alternative annotation. The
  // sell price matches what's shown in the main row (used by S/FP Raw).
  const babyName = (typeof ITEM_NAMES_MAP !== "undefined" && ITEM_NAMES_MAP[row.itemId])
    || (typeof getItemDisplayName === "function" ? getItemDisplayName(row.itemId) : row.itemId);
  const babyFpNote = row.fpCost > 0
    ? ` <small style="color:#9ca3af">(or ${row.fpCost.toLocaleString()} FP from NPC)</small>`
    : (row.favorCost > 0
        ? ` <small style="color:#9ca3af">(or ${row.favorCost.toLocaleString()} Favor from Eralia Wayfarer)</small>`
        : "");
  const babyHtml = `1× ${babyName} ${_saddledPriceSpan(row.itemId, row.sellCity, row.sellPrice)}${babyFpNote}`;

  // Saddled mount sell price — name + city + editable price
  const saddledName = (typeof getItemDisplayName === "function" && getItemDisplayName(bd.sellItemId))
    || (typeof ITEM_NAMES_MAP !== "undefined" && ITEM_NAMES_MAP[bd.sellItemId]) || bd.sellItemId;
  const saddledHtml = `${saddledName} @ ${bd.sellCity || "?"} ${_saddledPriceSpan(bd.sellItemId, bd.sellCity, bd.sellPrice)}`;

  // Food
  let foodHtml = `<small style="color:#9ca3af">${tx("no food / no data", "r_no_food_no_data")}</small>`;
  if (bd.feed && bd.feed.id) {
    const foodName = (typeof getItemDisplayName === "function" && getItemDisplayName(bd.feed.id))
      || (typeof ITEM_NAMES_MAP !== "undefined" && ITEM_NAMES_MAP[bd.feed.id]) || bd.feed.id;
    const pieces = bd.feed.pieces || 0;
    foodHtml = `${pieces}× ${foodName} ${matPriceSpan(bd.feed.id, bd.feed.city || bd.saddlerCity, bd.feed.price || 0, { foodMode: true })}`;
  }

  // Saddler mats — exclude the grown-mount input (produced in-house). FP-priced
  // mats (hearts) are tradeable on the market too, so render their silver buy
  // price as an editable span with the FP alternative shown as an annotation.
  // RRR/focus annotation mirrors render-mounts.js:562-568 — refined mats
  // (leather/cloth/etc.) show effective count after the saddler return rate;
  // hearts/artifacts show "(no return)". Updates live when "Use Focus" toggles
  // because bd.saddlerRrr is read off the focus-aware mounts row data.
  let matsHtml = `<small style="color:#9ca3af">${tx("no recipe", "r_no_recipe")}</small>`;
  if (bd.recipe && bd.saddlerMatPrices) {
    const lines = bd.recipe.materials
      .filter((m) => m.matId !== bd.grownId)
      .map((m) => {
        const name = (typeof ITEM_NAMES_MAP !== "undefined" && ITEM_NAMES_MAP[m.matId])
          || (typeof getItemDisplayName === "function" ? getItemDisplayName(m.matId) : m.matId);
        const fpPer = typeof getFpCost === "function" ? getFpCost(m.matId) : 0;
        const { price, city } = bd.saddlerMatPrices[m.matId] || { price: 0, city: bd.saddlerCity };
        const fpNote = fpPer > 0
          ? ` <small style="color:#9ca3af">(or ${fpPer.toLocaleString()} FP each)</small>`
          : "";
        const eligible = typeof isRrrEligible === "function" ? isRrrEligible(m.matId) : false;
        const saddlerRrr = bd.saddlerRrr || 0;
        const effectiveCount = eligible ? (m.count * (1 - saddlerRrr)).toFixed(1) : m.count.toString();
        const consumedTag = eligible
          ? ` <small style="color:#9ca3af">(~${effectiveCount}x ${tx("consumed", "r_consumed")})</small>`
          : ` <small style="color:#9ca3af">(${tx("no return", "r_no_return")})</small>`;
        return `${m.count}× ${name} ${matPriceSpan(m.matId, city || bd.saddlerCity, price)}${fpNote}${consumedTag}`;
      });
    if (lines.length) matsHtml = lines.join("<br>");
  }

  // Focus efficiency — two silver/focus benchmarks for the bred path:
  //   Breeding (nurture mastery): marginal silver per nurture focus point —
  //     extra offspring chance × offspring value ÷ total nurture focus.
  //   Saddling (craft RRR): marginal silver per saddler focus point —
  //     (RRR_focus_on − RRR_focus_off) × eligible-mat cost ÷ focus per craft.
  // Both are constant across the Use-Focus toggle (they're "what does focus
  // buy you here?" benchmarks). Hidden when no nurture data and no recipe.
  const breedSpf = bd.breedingProfitPerFocus || 0;
  const saddleSpf = bd.saddlerProfitPerFocus || 0;
  const nurtureFp = bd.nurtureFocusCost || 0;
  const saddleFp = bd.saddlerFocusCost || 0;
  const fmtSpf = (n) => n > 0 ? n.toFixed(2) : "—";
  const breedSpfClass = breedSpf >= 20 ? "profit-high"
                      : breedSpf >= 10 ? "profit-low"
                      : breedSpf > 0   ? "profit-negative" : "";
  const saddleSpfClass = saddleSpf >= 20 ? "profit-high"
                       : saddleSpf >= 10 ? "profit-low"
                       : saddleSpf > 0   ? "profit-negative" : "";
  const breedTitle = nurtureFp > 0
    ? `Marginal silver per nurture focus point (${nurtureFp.toLocaleString()} focus per full cycle, at your ⚙ Specs levels)`
    : tx("No nurture data", "r_no_nurture_data");
  const saddleTitle = saddleFp > 0
    ? `Marginal silver from saddler RRR per focus point (${saddleFp.toLocaleString()} focus per craft at ${bd.saddlerCity || "?"})`
    : tx("No saddler recipe", "r_no_saddler_recipe");
  const focusEffHtml = `
    <div title="${breedTitle}">${tx("Breeding (nurture)", "r_breeding_nurture")}: <b class="${breedSpfClass}">${fmtSpf(breedSpf)}</b> <small style="color:#9ca3af">${tx("silver/focus", "r_silver_per_focus")}</small></div>
    <div title="${saddleTitle}">${tx("Saddling (craft)", "r_saddling_craft")}: <b class="${saddleSpfClass}">${fmtSpf(saddleSpf)}</b> <small style="color:#9ca3af">${tx("silver/focus", "r_silver_per_focus")}</small></div>
  `;

  return `
    <tr class="breed-detail-row" data-baby-id="${row.itemId}" style="display:${display}">
      <td colspan="${_fsColCount()}" class="breed-detail-cell">
        <div class="row-fluid"><div class="breed-detail-grid">
          <div class="breed-detail-section">
            <div class="breed-detail-label">${tx("Baby (per cycle)", "r_baby_per_cycle")}</div>
            <div>${babyHtml}</div>
          </div>
          <div class="breed-detail-section">
            <div class="breed-detail-label">${tx("Saddled mount sell price", "r_saddled_sell_price")}</div>
            <div>${saddledHtml}</div>
          </div>
          <div class="breed-detail-section">
            <div class="breed-detail-label">${tx("Food per cycle", "r_food_per_cycle")}</div>
            <div>${foodHtml}</div>
          </div>
          <div class="breed-detail-section">
            <div class="breed-detail-label">${tx("Saddler materials (per saddled mount)", "r_saddler_materials")}</div>
            <div>${matsHtml}</div>
          </div>
          <div class="breed-detail-section">
            <div class="breed-detail-label">${tx("Focus efficiency", "r_focus_efficiency")}</div>
            <div>${focusEffHtml}</div>
          </div>
        </div></div>
      </td>
    </tr>
  `;
}

function renderFactionSpendingTable(marketData) {
  const rows = buildFactionSpendingRows(marketData);
  renderTableData("faction-spending-table", rows, (row) => {
    const isFavor = row.currency === "Favor";
    const ratioClass = row.silverPerFp >= 20 ? "profit-high"
                     : row.silverPerFp >= 10 ? "profit-low"
                     : "profit-negative";
    // Shared silver/unit color thresholds (same scale as silver/FP).
    const effClass = (v) => v >= 20 ? "profit-high" : v >= 10 ? "profit-low" : "profit-negative";

    // FP and Favor are different currencies, so each row fills only its own
    // cost + efficiency pair and shows "—" in the other's columns.
    const fpCostCell = isFavor
      ? `<td title="${tx("Not an FP purchase", "r_not_fp_purchase")}">—</td>`
      : `<td class="silver-val">${formatSilver(row.fpCost)}</td>`;
    const favorCostCell = isFavor
      ? `<td class="silver-val">${formatSilver(row.favorCost)}</td>`
      : `<td title="${tx("Not a Favor purchase", "r_not_favor_purchase")}">—</td>`;
    const sfpCell = isFavor
      ? `<td title="${tx("Not an FP purchase", "r_not_fp_purchase")}">—</td>`
      : `<td class="silver-val ${ratioClass}">${row.silverPerFp.toFixed(2)}</td>`;
    // Fame-valued rows (non-tradable Tomes of Insight) report fame-per-Favor in
    // the S/Favor column instead of silver/Favor; they have no market price or
    // net silver, so those cells render an em dash.
    const isFame = isFavor && row.metric === "fame";
    const sFavorCell = !isFavor
      ? `<td title="${tx("Not a Favor purchase", "r_not_favor_purchase")}">—</td>`
      : isFame
        ? `<td class="silver-val" title="${tx("Combat fame ÷ Favor cost (non-tradable fame book — fame, not silver)", "r_fame_per_favor_tip")}">${Math.round(row.famePerFavor).toLocaleString()} <small style="color:#9ca3af">${tx("fame/Fav", "r_fame_per_fav")}</small></td>`
        : (row.silverPerFavor > 0
            ? `<td class="silver-val ${effClass(row.silverPerFavor)}" title="${tx("Net silver ÷ Favor cost (150 Favor = 1 Siphoned Energy)", "r_silver_per_favor_tip")}">${row.silverPerFavor.toFixed(2)}</td>`
            : `<td title="${tx("No silver/Favor — set the chest yield or scan for token/mount prices", "r_no_silver_per_favor")}"><small style="color:#9ca3af;font-style:italic">—</small></td>`);

    const sellCellHtml = isFame
      ? `<td title="${tx("Non-tradable fame book — no market price", "r_fame_book_no_price")}"><small style="color:#9ca3af;font-style:italic">—</small></td>`
      : row.tradeable
        ? priceTd(row.sellPrice, row.itemId, row.sellCity)
        : `<td class="silver-val price-editable" data-item-id="${row.itemId}" data-city="${row.sellCity}" data-raw-price="${row.sellPrice}" data-city-list="sell" style="cursor:pointer" title="${tx("Click to override expected silver yield (set it from any city)", "r_override_chest_yield")}">${formatSilver(row.sellPrice)}</td>`;
    const netCell = isFame
      ? `<td title="${tx("No silver value — fame book", "r_no_silver_fame_book")}"><small style="color:#9ca3af;font-style:italic">—</small></td>`
      : `<td class="silver-val">${formatSilver(row.netSilver)}</td>`;
    const noteHtml = row.note ? `<small style="color:#9ca3af;font-size:0.7rem">${row.note}</small>` : "";

    // For Baby rows, surface the corresponding breed-chain silver/FP so the
    // user can pick raw vs breed at a glance. Non-baby categories show "—".
    //
    // Every breedable baby (breedData present) gets the expand toggle — even
    // when silverPerFp is 0 because the thinly-traded saddled mount has no
    // market price. Without the toggle the user can't reach the breed-inputs
    // sub-row to set that price by hand, so the column would be a dead "—".
    // Once they override the saddled price it bypasses the volume gate and the
    // value computes on the next render.
    let breedCell = `<td title="${tx("Breeding only applies to Baby rows", "r_breeding_baby_only")}">—</td>`;
    if (row.mountInputs) {
      // Energy Mount rows reuse this otherwise-empty column to surface the
      // deducted base mount + mats cost and an expand toggle for the per-input
      // override breakdown (see _renderMountInputDetailRow).
      const mi = row.mountInputs;
      const isOpen = (typeof _expandedMountInputs !== "undefined") && _expandedMountInputs.has(row.itemId);
      const togglePill = `<button class="mount-input-toggle" data-mount-id="${row.itemId}" title="${tx("Show/hide base mount + mats cost", "r_toggle_base_mount_cost")}" style="margin-left:6px;background:none;border:1px solid #3e5e82;color:#9ca3af;cursor:pointer;border-radius:3px;padding:0 5px;font-size:0.75rem;line-height:1.3">${isOpen ? "▴" : "▾"}</button>`;
      const costLabel = mi.inputsKnown
        ? `<span title="${tx("Base mount + mats deducted from the mount sale", "r_base_mount_deducted")}">inputs −${formatSilver(mi.inputCost)}</span>`
        : `<span style="color:#f59e0b" title="${tx("Some input prices missing — net is overstated until you set them", "r_inputs_missing_tip")}">⚠ ${tx("inputs incomplete", "r_inputs_incomplete")}</span>`;
      breedCell = `<td class="silver-val">${costLabel}${togglePill}</td>`;
    } else if (row.breedData) {
      const isOpen = _expandedBreedBabies.has(row.itemId);
      const togglePill = `<button class="breed-toggle" data-baby-id="${row.itemId}" title="${tx("Show/hide breed inputs (saddled mount, food, mats)", "r_toggle_breed_inputs")}" style="margin-left:6px;background:none;border:1px solid #3e5e82;color:#9ca3af;cursor:pointer;border-radius:3px;padding:0 5px;font-size:0.75rem;line-height:1.3">${isOpen ? "▴" : "▾"}</button>`;
      // Favor babies (Brecilien owls) compare breed-vs-raw in silver/Favor; FP
      // babies in silver/FP. Pick the metric that matches the row's currency.
      const breedRatio = isFavor ? (row.breedSilverPerFavor || 0) : (row.breedSilverPerFp || 0);
      const rawRatio = isFavor ? (row.silverPerFavor || 0) : (row.silverPerFp || 0);
      const perCur = isFavor ? "Favor" : "FP";
      if (breedRatio > 0) {
        const breedClass = breedRatio >= 20 ? "profit-high"
                         : breedRatio >= 10 ? "profit-low"
                         : "profit-negative";
        const better = breedRatio > rawRatio ? "breed" : "raw";
        const arrow = better === "breed"
          ? `<small style="color:#5e9e78">▲ ${tx("breed wins", "r_breed_wins")}</small>`
          : `<small style="color:#9e8840">▼ ${tx("raw wins", "r_raw_wins")}</small>`;
        // Masterpiece annotation — per acquisition currency (FP or Favor);
        // shown only when the MP price is known and lifts the ratio.
        const mpSpf = isFavor
          ? (row.breedData?.mpSilverPerFavor || 0)
          : (row.breedData?.mpSilverPerFp || 0);
        const mpAnnotation = (mpSpf > 0 && mpSpf > breedRatio)
          ? `<small style="color:#9ca3af;display:block;font-size:0.7rem" title="MP @ ${row.breedData.mpSellCity}: ${formatSilver(row.breedData.mpSellPrice)} × 0.1% MP chance = +${formatSilver(row.breedData.mpRevenuePerCycle)}/cycle">→ ${mpSpf.toFixed(2)} incl. MP</small>`
          : "";
        const bestFpHtml = isFavor ? "" : _bestFpLineHtml(row.breedData);
        breedCell = `<td class="silver-val ${breedClass}" title="${tx("Silver per {cur} if you nurture & saddle the baby instead of selling raw", "r_breed_ratio_tip").replace("{cur}", perCur)}">${breedRatio.toFixed(2)} ${arrow}${togglePill}${mpAnnotation}${bestFpHtml}</td>`;
      } else {
        breedCell = `<td title="${tx("No saddled-mount market price — expand to set the breed inputs by hand", "r_no_saddled_price")}"><small style="color:#9ca3af;font-style:italic">${tx("no data", "r_no_data")}</small>${togglePill}</td>`;
      }
    }

    // Profit / 10k Focus — value of USING the FP-bought baby in the breeding
    // chain with the baby itself costing 0 silver.
    let fpFocusCell = `<td title="${tx("No focus-consuming use path for this item", "r_no_focus_use_path")}">—</td>`;
    const ff = row.fpFocusInfo;
    if (ff) {
      const cls = ff.per10k > 0 ? "profit-low" : "profit-negative";
      const title = tx("Baby free (bought with FP): {profit} profit/breed cycle × {cycles} cycles ({focus} nurture focus ea)", "r_fp_focus_baby_tip")
        .replace("{profit}", formatSilver(ff.profitPerCycle)).replace("{cycles}", ff.cycles.toLocaleString())
        .replace("{focus}", formatFocusCost(ff.focusCost));
      fpFocusCell = `<td class="silver-val ${cls}" title="${title}">${formatSilver(ff.per10k)}</td>`;
    }

    const mainRow = `
      <tr data-row-key="${getRowKey(row, "faction-spending-table")}">
        ${addTdForKey("faction-spending-table", getRowKey(row, "faction-spending-table"))}
        <td class="cell-item">${row.name}${noteHtml ? "<br>" + noteHtml : ""}</td>
        <td>${categoryLabel(row.category)}</td>
        <td>${row.sellCity}</td>
        ${fpCostCell}
        ${favorCostCell}
        ${sellCellHtml}
        ${netCell}
        ${sfpCell}
        ${sFavorCell}
        ${breedCell}
        ${fpFocusCell}
      </tr>
    `;

    const mountDetail = (typeof _renderMountInputDetailRow === "function")
      ? _renderMountInputDetailRow(row) : "";
    return mainRow + _renderBreedDetailRow(row) + mountDetail;
  });
}

// ─── Faction filter dropdown ─────────────────────────────────────────────────
// Re-render the Faction Spending table when the user changes the faction
// dropdown. Re-uses the cached marketData from the last scan so the filter
// applies instantly without a network round-trip.
(function _initFactionFilter() {
  if (typeof document === "undefined") return;
  if (document._factionFilterInit) return;
  document._factionFilterInit = true;
  const select = document.getElementById("faction-spending-filter");
  if (!select) return;
  select.addEventListener("change", () => {
    if (typeof lastMarketData !== "undefined" && lastMarketData) {
      renderFactionSpendingTable(lastMarketData);
    }
  });
})();

// ─── Toggle handler for breed-inputs sub-row ────────────────────────────────
// Idempotent module-init. Listens for clicks on .breed-toggle anywhere in the
// document and toggles the corresponding details row's visibility.
(function _initBreedToggle() {
  if (typeof document === "undefined") return;
  if (document._breedToggleInit) return;
  document._breedToggleInit = true;
  document.addEventListener("click", (e) => {
    const toggle = e.target.closest(".breed-toggle");
    if (!toggle) return;
    e.stopPropagation();
    const babyId = toggle.getAttribute("data-baby-id");
    if (!babyId) return;
    const detailRow = document.querySelector(
      `.breed-detail-row[data-baby-id="${CSS.escape(babyId)}"]`
    );
    if (!detailRow) return;
    const isOpen = detailRow.style.display !== "none";
    if (isOpen) {
      detailRow.style.display = "none";
      _expandedBreedBabies.delete(babyId);
      toggle.textContent = "▾";
    } else {
      detailRow.style.display = "table-row";
      _expandedBreedBabies.add(babyId);
      toggle.textContent = "▴";
    }
  });
})();
