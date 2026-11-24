/**
 * What the Top-10 boards read out of, table by table.
 *
 * Each source describes ONE feeder table in four parts:
 *   profit(row)    → pure silver profit, the Top 10 Pure Profit metric,
 *   focus(row)     → {cost, per10k} or null when the table spends no focus,
 *   filter(row)    → drop placeholder / unpriced rows before ranking,
 *   normalize(row) → the flat board row (see formatJoinedRow).
 *
 * Splitting these out of js/render-joined-summary.js keeps both files inside
 * the 800-line ceiling, and it puts every "which field holds the profit for
 * THIS table" decision in one place — they are all different, and that was the
 * bulk of the old file.
 *
 * ── Why only five tables have a focus metric ──────────────────────────────
 * `profitPer10kFocus` = profit × floor(10000 / focusCost) (calculations.js) is
 * published by Crafting, Transport/Refining, Consumables, Farming and Mounts.
 * Faction Spending is the one table that spends a currency and still stays off
 * the focus board: its `fpFocusPer10k` is FP-denominated, a different currency
 * from a focus bar, so ranking it against the others would be meaningless and
 * the number on the board has to match the number the Jump link lands on.
 * Farming also publishes a MARGINAL rate (`profitPerFocus` = profitDelta /
 * focusCost, js/focus-play.js) for its own Silver/Focus column — the board
 * reads the per-10k field, never that one. The remaining six tables spend no
 * focus at all.
 *
 * ── Why every normalize() also publishes a sell item id ───────────────────
 * `itemName` is a display string — localized, tier-tagged, sometimes two fields
 * glued together. It cannot key a price override. So each source also publishes
 * the identity behind its Best Sell Price cell:
 *
 *   sellItemId        the id, or null to leave the cell read-only,
 *   sellQuality       the quality the price is keyed under (Flipping and
 *                     Rerolling — the two feeders that price one; every other
 *                     feeder prices the flat book, which is Normal alone),
 *   sellSideOverride  the ⚡ marker tracks this cell's own order field
 *                     (Flipping, whose two cells show both sides at once).
 *   sellUnits         how many of that item one play's profit covers — 1 for
 *                     every table whose play is a single item, null for the
 *                     three whose profit is a per-cycle aggregate. It is what
 *                     the Black Market board's Profit/Ox multiplies (or
 *                     refuses to), and it lives here for the same reason the
 *                     ids do: only the feeder knows what one of its plays is.
 *
 * Each one is copied from the FEEDER's own priceTd call for the same number
 * (file:line on each) — a board cell that keyed differently from the table its
 * Jump link lands on would store an override visible in only one of the two.
 */

/** Category badge text. Categories stay English internally (row identity). */
function _jsCategoryLabel(category) {
  if (typeof tx !== "function" || !category) return category;
  const slug = "cat_" + String(category).toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return tx(category, slug);
}

/** The source row's own key, with a fallback — see the rowKey note below. */
function _jsRowKey(row, tableId) {
  return typeof getRowKey === "function" ? getRowKey(row, tableId) : "";
}

/** Standard focus reader for the four tables that publish a per-10k figure. */
function _jsFocus(r) {
  const cost = Number(r && r.focusCost) || 0;
  const per10k = Number(r && r.profitPer10kFocus) || 0;
  // A zero focus cost is "this craft spends no focus", not "worth nothing" —
  // calculateProfitPer10kFocus returns 0 for both, so the two must be told
  // apart here or a combine craft would rank as the worst focus play there is.
  if (cost <= 0 || !Number.isFinite(per10k) || per10k <= 0) return null;
  return { cost, per10k };
}

/**
 * The city a play SELLS in, read off the feeder's own row.
 *
 * The Black Market board (js/render-bm-board.js) has to filter on it BEFORE a
 * feeder's rows are ranked — a Black Market play that is not in its table's own
 * top ten would otherwise never reach the board at all. That rules out reading
 * it off the normalized row, which is produced after ranking, so each source
 * names its sell-city field once here, beside the normalize() that uses it.
 */

/**
 * A laborers row's payload item id, or null when the payload is a mix.
 * LABORER_MODE lives in js/data-laborers.js; without it (the Node tests that
 * don't load the catalog) no row can be proven to be in trophy mode, so none is.
 */
function _jsTrophyId(r) {
  if (typeof LABORER_MODE === "undefined") return null;
  return (r.mode === LABORER_MODE.TROPHY && r.trophyId) ? r.trophyId : null;
}

/** The fields every normalize() fills in the same way. */
function _jsBase(r, tableId, category) {
  return {
    category,
    tableId,
    marginPct: r.marginInfo?.margin ?? null,
    dailyVol: r.dailyVol ?? 0,
    volIsUnknown: false,
    note: "",
    rowKey: _jsRowKey(r, tableId),
    hasOverride: !!r.hasOverride,
    // Where "Jump to →" goes. A board row is COLLECTED from one table and may
    // be best READ in another: a crafting play lands on the Craft Planner,
    // where its materials can be refined or transmuted instead of merely
    // priced. Defaults to the feeder's own table, which is what eleven of the
    // twelve want. `jumpFallbackTableId` is tried when the primary holds no row
    // for the item — see jbJumpToFirst (js/joined-summary-jump.js).
    jumpTableId: tableId,
    jumpRowKey: null,
    jumpFallbackTableId: null,
    // Overridden per source below wherever the sell price is a real per-unit
    // market price. Left as-is, the cell renders read-only.
    sellItemId: null,
    sellQuality: null,
    sellSideOverride: false,
    // How many sold units one play's pureProfit covers. 1 for every table
    // whose play is one item; null where the profit is a per-cycle /
    // per-campaign aggregate the board cannot split (Farming, Laborers,
    // Artifact Rolling). The Black Market board's Profit/Ox reads it, and
    // prints an em dash rather than inflating a batch figure by the items
    // that fit in an ox.
    sellUnits: 1,
  };
}

const JOINED_SOURCES = {
  "flipping-table": {
    category: "Flipping",
    sellCity: (r) => r.sell?.city || "",
    profit: (r) => r?.marginInfo?.profit ?? 0,
    focus: () => null,
    normalize: (r) => ({
      ..._jsBase(r, "flipping-table", "Flipping"),
      itemName: `${dispName(r.item.id, r.item.name)} [T${r.tier}]`,
      buyCity: r.buy?.city || "",
      sellCity: r.sell?.city || "",
      routeLabel: `${r.buy?.city || "?"} → ${r.sell?.city || "?"}`,
      inputCost: r.buy?.price ?? 0,
      sellPrice: r.sell?.price ?? 0,
      pureProfit: r.marginInfo.profit,
      // render-flipping.js:115-116 — both cells are side-specific, and both are
      // unit prices, so Flipping is the one table whose "input cost" is
      // editable too (everywhere else that column is an aggregate).
      sellItemId: r.item?.id || null,
      // The quality the router won at (js/render-flipping.js:41, priced per
      // quality by js/flip-route-quality.js — the Black Market's books are
      // per-quality). Normal stays null on purpose, mirroring the flipping
      // table's own priceTd call (render-flipping.js:317): quality 1 IS the
      // flat book, and publishing it would retarget the override key and the
      // Bid Age cell at the usually-absent [1] shelf of the quality map.
      sellQuality: (r.quality && r.quality !== 1) ? r.quality : null,
      sellSideOverride: true,
      buyItemId: r.item?.id || null,
    }),
  },

  "crafting-table": {
    category: "Crafting",
    sellCity: (r) => r.sellGear?.city || "",
    profit: (r) => r?.marginInfo?.profit ?? 0,
    focus: _jsFocus,
    normalize: (r) => ({
      ..._jsBase(r, "crafting-table", "Crafting"),
      itemName: dispName(r.item?.id, r.item?.name || r.item?.id || "?"),
      buyCity: r.craftCity || "",
      sellCity: r.sellGear?.city || "",
      routeLabel: `${tx("Craft", "r_craft")}: ${r.craftCity || "?"} → ${tx("Sell", "r_sell")}: ${r.sellGear?.city || "?"}`,
      inputCost: r.totalInputCost ?? 0,
      sellPrice: r.sellGear?.price ?? 0,
      pureProfit: r.marginInfo.profit,
      sellItemId: r.item?.id || null,           // render-crafting.js:735
      // Crafting cells carry `sellVol`, not `dailyVol`.
      dailyVol: r.sellVol ?? 0,
      // The Crafting table prices every material at the market and stops. The
      // Craft Planner is where the same play shows what it is really worth:
      // per-material sourcing (buy / refine / focused refine / transmute), the
      // refine-vs-buy saving, the journal and laborer columns, the paths panel.
      // No row key travels with it — the planner keys `id|section` and renders
      // one row per (item, section). The board's Jump matches on the item id,
      // so it lands on whichever section sorts first.
      jumpTableId: "craft-planner-table",
      jumpRowKey: "",
      jumpFallbackTableId: "crafting-table",
    }),
  },

  "transport-table": {
    category: "Transport / Refining",
    sellCity: (r) => r.sellRefined?.city || "",
    profit: (r) => r?.marginInfo?.profit ?? 0,
    focus: _jsFocus,
    normalize: (r) => ({
      ..._jsBase(r, "transport-table", "Transport / Refining"),
      itemName:
        (typeof ITEM_NAMES_MAP !== "undefined" && ITEM_NAMES_MAP[r.route?.refinedId]) ||
        (typeof getItemDisplayName === "function" && getItemDisplayName(r.route?.refinedId)) ||
        r.route?.refinedId || "Refined",
      buyCity: r.buyRaw?.city || "",
      sellCity: r.sellRefined?.city || "",
      routeLabel: `${r.buyRaw?.city || "?"} → ${r.refineCity || "?"} → ${r.sellRefined?.city || "?"}`,
      inputCost: r.totalRawCost ?? 0,
      sellPrice: r.sellRefined?.price ?? 0,
      pureProfit: r.marginInfo.profit,
      // render-transport.js:565 — the `_refined` fallback is a real, read-back
      // key for routes whose refined id is not in the catalog. Keep it verbatim
      // or an override typed on the board lands under a different id.
      sellItemId: r.route
        ? (r.route.refinedId || (r.route.rawId ? r.route.rawId + "_refined" : null))
        : null,
    }),
  },

  "consumable-table": {
    category: "Consumables",
    sellCity: (r) => r.sellPot?.city || "",
    profit: (r) => r?.marginInfo?.profit ?? 0,
    focus: _jsFocus,
    normalize: (r) => ({
      ..._jsBase(r, "consumable-table", "Consumables"),
      itemName: r.item?.name || r.item?.id || "?",
      buyCity: r.buyMat?.city || r.craftCity || "",
      sellCity: r.sellPot?.city || "",
      routeLabel: r.isFlip
        ? `${tx("Flip", "r_flip")}: ${r.buyMat?.city || "?"} → ${r.sellPot?.city || "?"}`
        : `${tx("Craft", "r_craft")}: ${r.craftCity || "?"} → ${tx("Sell", "r_sell")}: ${r.sellPot?.city || "?"}`,
      inputCost: r.totalInputCost ?? 0,
      sellPrice: r.sellPot?.price ?? 0,
      pureProfit: r.marginInfo.profit,
      sellItemId: r.item?.id || null,           // render-consumables.js:689,772
    }),
  },

  "mounts-table": {
    category: "Breeding & Mounts",
    sellCity: (r) => r.sellPot?.city || "",
    profit: (r) => r?.marginInfo?.profit ?? 0,
    focus: _jsFocus,
    normalize: (r) => ({
      ..._jsBase(r, "mounts-table", "Breeding & Mounts"),
      itemName: (r.item?.name || r.item?.id || "?") +
        (r.isBreeding ? tx(" (Bred)", "r_bred_paren") : tx(" (Craft)", "r_craft_paren_sp")),
      buyCity: r.craftCity || r.buyMat?.city || "",
      sellCity: r.sellPot?.city || "",
      routeLabel: r.isBreeding
        ? `${tx("Breed", "r_breed")}: ${r.buyMat?.city || "?"} → ${r.sellPot?.city || "?"}`
        : `${tx("Craft", "r_craft")}: ${r.craftCity || "?"} → ${tx("Sell", "r_sell")}: ${r.sellPot?.city || "?"}`,
      inputCost: r.totalInputCost ?? 0,
      sellPrice: r.sellPot?.price ?? 0,
      pureProfit: r.marginInfo.profit,
      // render-mounts.js:757 — plain item id. A saddled mount's masterpiece
      // price is sourced separately (lastMpMarketData) but is NOT quality-keyed
      // in the override store, so no sellQuality here.
      sellItemId: r.item?.id || null,
    }),
  },

  "farming-table": {
    category: "Farming",
    sellCity: (r) => r.sellCrop?.city || "",
    profit: (r) => r?.marginInfo?.profit ?? 0,
    // Farming publishes the throughput figure (watered cycle × cycles a bar
    // buys), so it ranks on the same scale as the crafting tables. Its marginal
    // profitPerFocus stays a column-only figure — see the file header.
    focus: _jsFocus,
    normalize: (r) => ({
      ..._jsBase(r, "farming-table", "Farming"),
      itemName: r.item?.name || r.item?.id || "?",
      buyCity: r.buySeed?.city || "",
      sellCity: r.sellCrop?.city || "",
      // The plot is its own city now (seeds are carried in), so it is named
      // whenever it is not the city the seed came from — js/farming-row-econ.js.
      routeLabel: `Seed: ${r.buySeed?.city || "?"}${
        r.farmCity && r.farmCity !== r.buySeed?.city ? ` → Farm: ${r.farmCity}` : ""
      } → Crop: ${r.sellCrop?.city || "?"}`,
      inputCost: r.totalInputCost ?? 0,
      sellPrice: r.sellCrop?.price ?? 0,
      pureProfit: r.marginInfo.profit,
      // render-farming.js:152 — the CROP is sold; `item.id` is the seed that is
      // bought, and keying the sell cell on it would overwrite the seed price.
      sellItemId: r.item?.outputId || null,
      // A farming row's profit is the whole CYCLE, over plotsPerCycle plots, not one
      // crop — so it carries no per-unit figure for the Black Market board to haul.
      sellUnits: null,
    }),
  },

  "enchanting-table": {
    category: "Enchanting",
    sellCity: (r) => r.sellCity || r.bestSellCity || "",
    profit: (r) => r?.marginInfo?.profit ?? 0,
    focus: () => null,
    normalize: (r) => ({
      ..._jsBase(r, "enchanting-table", "Enchanting"),
      itemName: `${r.item?.name || r.item?.id || "?"} ${r.transitionLabel || ""}`.trim(),
      buyCity: r.sourceCity || r.bestSourceCity || "",
      sellCity: r.sellCity || r.bestSellCity || "",
      routeLabel: `${r.sourceCity || r.bestSourceCity || "?"} → ${r.sellCity || r.bestSellCity || "?"}`,
      inputCost: r.totalInputCost ?? 0,
      sellPrice: r.sellPrice ?? r.bestSellPrice ?? 0,
      pureProfit: r.marginInfo.profit,
      sellItemId: r.targetId || null,           // render-enchanting.js:194
    }),
  },

  "transmute-table": {
    category: "Transmute",
    sellCity: (r) => r.sellCity || "",
    profit: (r) => r?.marginInfo?.profit ?? 0,
    focus: () => null,
    normalize: (r) => ({
      ..._jsBase(r, "transmute-table", "Transmute"),
      itemName: `T${r.tier} ${r.transition ? `${r.transition.from || ""} → ${r.transition.to || ""}` : ""}`.trim(),
      buyCity: r.buyCity || "",
      sellCity: r.sellCity || "",
      routeLabel: `${r.buyCity || "?"} → ${r.sellCity || "?"}`,
      inputCost: r.totalInputCost ?? 0,
      sellPrice: r.sellPrice ?? 0,
      pureProfit: r.marginInfo.profit,
      sellItemId: r.targetId || null,           // render-transmute.js:349
    }),
  },

  "rerolling-table": {
    category: "Quality Rerolling",
    sellCity: (r) => r.sellCity || "",
    profit: (r) => r?.marginInfo?.profit ?? 0,
    focus: () => null,
    normalize: (r) => ({
      ..._jsBase(r, "rerolling-table", "Quality Rerolling"),
      itemName: `${r.item?.name || r.item?.id || "?"} ${r.transitionLabel || ""}`.trim(),
      buyCity: r.buyCity || "",
      sellCity: r.sellCity || "",
      routeLabel: `${r.buyCity || "?"} → ${r.sellCity || "?"}`,
      inputCost: r.totalInputCost ?? 0,
      sellPrice: r.sellPrice ?? 0,
      pureProfit: r.marginInfo.profit,
      // render-rerolling.js:181 — the price is per QUALITY, stored under the
      // synthetic `<id>#Qn` key (utils.js qualityOverrideKey). The sell side is
      // the transition's target quality.
      sellItemId: r.item?.id || null,
      sellQuality: r.transition?.to ?? null,
    }),
  },

  "rolling-table": {
    category: "Artifact Rolling",
    sellCity: (r) => r.bestSellCity || r.sellCity || "",
    // No marginInfo and no dailyVol; placeholder rows carry no market data.
    filter: (r) => !r.hasNoFragData && !r.hasNoArtData,
    profit: (r) => (r.sellRevenue || 0) - (r.rollCostSilver || 0),
    focus: () => null,
    normalize: (r) => ({
      ..._jsBase(r, "rolling-table", "Artifact Rolling"),
      itemName: `${r.artName || r.artId || "?"} (T${r.tier || "?"} ${r.cat || ""} ${r.rollType || ""})`.trim(),
      buyCity: r.fragBuyCity || "",
      sellCity: r.bestSellCity || r.sellCity || "",
      routeLabel: `${r.fragBuyCity || "?"} (frag) → ${r.bestSellCity || r.sellCity || "?"}`,
      inputCost: r.rollCostSilver ?? 0,
      sellPrice: r.bestSellPrice ?? r.sellPrice ?? 0,
      marginPct: r.margin ?? null,
      pureProfit: (r.sellRevenue || 0) - (r.rollCostSilver || 0),
      sellItemId: r.artId || null,              // render-rolling.js:465
      // Profit here is a roll CAMPAIGN's, spread over however many artifacts it melds.
      sellUnits: null,
      dailyVol: 0,
      volIsUnknown: true,
      note: "vol unknown",
    }),
  },

  "faction-spending-table": {
    category: "Faction Spending",
    sellCity: (r) => r.sellCity || "",
    // Only tradeable rows: a chest pays silver directly and has no market.
    filter: (r) => r.tradeable === true,
    // Energy Mount rows (Favor-backed battle mounts) rank by their all-in
    // pureProfitSilver — netSilver there is Favor-denominated and leaves the
    // thousands of Siphoned Energy unpriced, which would put a basilisk on the
    // board with a ~40M "profit" that assumes the energy was free. Every other
    // row spends a currency (FP / Favor) with no silver purchase, so its own
    // netSilver is already the honest board figure.
    profit: (r) => (r.mountInputs ? (r.pureProfitSilver ?? 0) : (r.netSilver ?? 0)),
    // fpFocusPer10k is FP-denominated, not focus — see the file header.
    focus: () => null,
    normalize: (r) => {
      const isMount = !!r.mountInputs;
      const isFavor = !r.fpCost && r.favorCost > 0;
      return {
        ..._jsBase(r, "faction-spending-table", "Faction Spending"),
        itemName: r.name || r.itemId || "?",
        buyCity: "",
        sellCity: r.sellCity || "",
        routeLabel: isMount
          ? `${(r.favorCost || 0).toLocaleString()} Favor + mount + mats → ${r.sellCity || "?"}`
          : r.fpCost
            ? `${r.fpCost} FP → ${r.sellCity || "?"}`
            : `${(r.favorCost || 0).toLocaleString()} Favor → ${r.sellCity || "?"}`,
        inputCost: isMount ? (r.mountInputs.pureInputCost ?? 0) : 0,
        sellPrice: r.sellPrice ?? 0,
        marginPct: null,
        pureProfit: isMount ? (r.pureProfitSilver ?? 0) : r.netSilver,
        note: isMount ? "energy + mount + mats" : (isFavor ? "Favor-gated" : "FP-gated"),
        hasOverride: false,
        // render-faction-spending.js:511. The reward is bought with Favour, so
        // there is no buy-side price to edit — only what it sells for.
        sellItemId: r.itemId || null,
      };
    },
  },

  "laborers-table": {
    category: "Laborers",
    sellCity: (r) => r.sell?.city || "",
    // margin === -1 is _buildRow's no-route placeholder.
    filter: (r) => r.marginInfo && r.marginInfo.margin !== -1,
    profit: (r) => r.marginInfo?.profit ?? 0,
    focus: () => null,
    normalize: (r) => ({
      ..._jsBase(r, "laborers-table", "Laborers"),
      itemName: `${r.item?.name || "?"} (${r.mode || ""})`,
      buyCity: r.buy?.city || "",
      sellCity: r.sell?.city || "",
      routeLabel: r.buy?.city && r.sell?.city
        ? `Buy: ${r.buy.city} → Run/Sell: ${r.sell.city}`
        : tx("no data", "r_no_data"),
      inputCost: r.totalInputCost ?? 0,
      sellPrice: r.sell?.price ?? 0,
      pureProfit: r.marginInfo.profit,
      // render-laborers.js:494-500 — only a TROPHY laborer's payload is a single
      // item with a per-unit price. Every other mode returns a multi-item mix
      // priced per cycle, which no single override can invert, so it stays read
      // -only exactly as it does in the Laborers table itself.
      sellItemId: _jsTrophyId(r),
      // A laborer cycle hands back many items at once (even in trophy mode), so its
      // profit is per CYCLE and cannot be multiplied by items-per-ox-load.
      sellUnits: null,
      dailyVol: 1,
      volIsUnknown: true,
      note: "per cycle",
    }),
  },
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { JOINED_SOURCES, _jsCategoryLabel, _jsFocus };
}
