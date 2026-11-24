/**
 * Brecilien Travel Planner Fees reference table.
 *
 * Static per-tier rollup of the silver fee the Travel Planner charges to move
 * one unit of common Brecilien exit cargo (artifact crafting mats + special
 * tokens). Every number comes from brecilienExitCostPerUnit in
 * js/travel-cost.js — single source of truth — so changes to GMS, weights, or
 * fasttravelfactor overrides flow through automatically.
 *
 * Items covered:
 *   - Resources (raw & refined): the most-hauled cargo, and the only family
 *     whose fee scales with BOTH tier and enchant (fasttravelfactor doubles per
 *     enchant level, capped at 256). Raw and refined are identical at a given
 *     tier/enchant, so one row per enchant level (.0-.4) covers every family.
 *     Quality has no effect on the fee (resources can't be qualified anyway).
 *   - Artifact mats T4-T8: RELIC, SOUL, RUNE, SHARD_AVALONIAN, SHARD_CRYSTAL,
 *     SHARD_FIRE_DRAGON,
 *     ESSENCE, ESSENCE_POTION  (all share the artifact-mat weight schedule).
 *   - Special tokens: QUESTITEM_TOKEN_AVALON (Avalonian Energy, items.xml
 *     tier="6") and UNIQUE_GVGTOKEN_GENERIC (Siphoned Energy, tier="1"). Their
 *     fee is a single number (weight + fasttravelfactor are pinned per id, not
 *     derived from the tier), so it renders in the row's own tier column when
 *     that tier is on the T4-T8 axis and in the first column otherwise, with
 *     the tier printed next to the label.
 *
 * No market data dependency. Renders once on DOMContentLoaded, and replays via
 * the _staticRenderer hook when the table is expanded after a collapse (app.js
 * wipes the tbody on collapse to free DOM nodes).
 *
 * Reference-only: the APPLIED Brecilien exit fee was removed from every profit
 * table (legBrecilienCost always returns 0, regardless of the Black/Red Zone
 * route toggle). This table still shows the raw per-unit Travel Planner cost via
 * brecilienExitCostPerUnit so the numbers stay visible for reference.
 */

(function () {
  const TIERS = [4, 5, 6, 7, 8];

  // Tiered artifact-mat families. Display label + items.xml base id stem.
  const TIERED_ITEMS = [
    { label: "Relic", stem: "RELIC" },
    { label: "Soul", stem: "SOUL" },
    { label: "Rune", stem: "RUNE" },
    { label: "Avalonian Shard", stem: "SHARD_AVALONIAN" },
    { label: "Crystal Shard", stem: "SHARD_CRYSTAL" },
    { label: "Fire Dragon Scales", stem: "SHARD_FIRE_DRAGON" },
    { label: "Essence", stem: "ESSENCE" },
    { label: "Essence Potion", stem: "ESSENCE_POTION" },
  ];

  // Special tokens — one fee each, no per-tier schedule. Tiers are the real
  // items.xml values; Siphoned Energy (T1) falls below the T4-T8 axis, so its
  // value goes in the first column and the label carries the tier tag.
  const SPECIAL_ITEMS = [
    { label: "Avalonian Energy", id: "QUESTITEM_TOKEN_AVALON", tier: 6 },
    { label: "Siphoned Energy", id: "UNIQUE_GVGTOKEN_GENERIC", tier: 1 },
  ];

  // Raw + refined resources. Their fee scales with both tier and enchant (the
  // fasttravelfactor doubles per enchant level, capped at 256), and raw vs
  // refined are identical at a given tier/enchant — so one row per enchant
  // level covers every resource family. PLANKS is the representative id;
  // brecilienExitCostPerUnit reads the enchant off the _LEVELn@n suffix.
  const RESOURCE_ENCHANTS = [
    { label: "Plain (.0)", ench: 0 },
    { label: "Uncommon (.1)", ench: 1 },
    { label: "Rare (.2)", ench: 2 },
    { label: "Exceptional (.3)", ench: 3 },
    { label: "Pristine (.4)", ench: 4 },
  ];

  function _resourceId(tier, ench) {
    return ench ? `T${tier}_PLANKS_LEVEL${ench}@${ench}` : `T${tier}_PLANKS`;
  }

  // Read the cost helper lazily — globals in the browser, require() in tests.
  function _exitCostFn() {
    if (typeof brecilienExitCostPerUnit === "function") {
      return brecilienExitCostPerUnit;
    }
    return null;
  }

  function _formatFee(n) {
    if (!Number.isFinite(n) || n <= 0) return '<span style="color:#6b7280">—</span>';
    if (n < 10) return n.toFixed(2);
    if (n < 100) return n.toFixed(1);
    return Math.round(n).toLocaleString();
  }

  function _emDash() {
    return '<span style="color:#6b7280">—</span>';
  }

  /**
   * Build payload for the renderer. Pure — caller injects the cost function
   * so tests can use the live module export instead of patching globals.
   * Returns: [{ label, fees: { 4, 5, 6, 7, 8 } }, ...]
   *   - Tiered rows: each tier → cost in silver, or null if mat doesn't exist
   *     at that tier (artifact mats are T4-T8 only, so all 5 are populated).
   *   - Special rows: only fees[4] is populated; other tiers are null and
   *     render as em-dash placeholders.
   */
  function buildBrecilienFeeRows(opts) {
    const costFn = (opts && opts.exitCostPerUnit) || _exitCostFn();
    const rows = [];

    // Resources first — most-hauled cargo; one row per enchant level since raw
    // and refined share the same fee at a given tier/enchant.
    rows.push({ kind: "group", label: "Resources — raw & refined (same fee; scales with enchant)" });
    RESOURCE_ENCHANTS.forEach((e) => {
      const fees = {};
      TIERS.forEach((tier) => {
        const id = _resourceId(tier, e.ench);
        fees[tier] = costFn ? costFn(id) : null;
      });
      rows.push({ kind: "resource", label: e.label, fees });
    });

    rows.push({ kind: "group", label: "Artifact materials & special tokens" });
    TIERED_ITEMS.forEach((item) => {
      const fees = {};
      TIERS.forEach((tier) => {
        const id = `T${tier}_${item.stem}`;
        fees[tier] = costFn ? costFn(id) : null;
      });
      rows.push({ kind: "tiered", label: item.label, fees });
    });

    SPECIAL_ITEMS.forEach((item) => {
      const fees = { 4: null, 5: null, 6: null, 7: null, 8: null };
      const col = TIERS.includes(item.tier) ? item.tier : TIERS[0];
      fees[col] = costFn ? costFn(item.id) : null;
      rows.push({ kind: "special", label: item.label, tier: item.tier, fees, special: true });
    });

    return rows;
  }

  /**
   * Row labels are stored in English (they double as row identity in the
   * tests); only the display passes through the language table.
   */
  function _label(en) {
    if (typeof tx !== "function" || !en) return en;
    const slug = "bf_" + String(en).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/_+$/, "");
    return tx(en, slug);
  }

  function renderRow(row) {
    if (row.kind === "group") {
      return `<tr class="bf-group-row"><td class="bf-group" colspan="${TIERS.length + 1}">${_label(row.label)}</td></tr>`;
    }
    const cells = TIERS.map((tier) => {
      const v = row.fees[tier];
      return `<td class="bf-fee">${v == null ? _emDash() : _formatFee(v)}</td>`;
    }).join("");
    // Tier tag rides outside the translated label so the i18n slug stays stable.
    const tierTag = row.tier ? ` [T${row.tier}]` : "";
    return `<tr><td class="bf-label">${_label(row.label)}${tierTag}</td>${cells}</tr>`;
  }

  function renderBrecilienFeesTable() {
    const tbody = document.querySelector("#brecilien-fees-table tbody");
    if (!tbody) return;
    const rows = buildBrecilienFeeRows();
    tbody.innerHTML = rows.map(renderRow).join("");
    // Static table — not driven by updateTableDisplay, so re-apply its own
    // search box here whenever it re-renders (load / expand / route toggle).
    if (typeof window !== "undefined" && typeof window.applyTableSearchFilter === "function") {
      window.applyTableSearchFilter("brecilien-fees-table");
    }
  }

  if (typeof window !== "undefined") {
    window.renderBrecilienFeesTable = renderBrecilienFeesTable;
    window.buildBrecilienFeeRows = buildBrecilienFeeRows;
    document.addEventListener("DOMContentLoaded", () => {
      // The fees read ITEM_WEIGHTS / ITEM_FT_FACTORS (js/data-weights.js), an
      // injected catalog that lands after first paint. Painting at parse-end
      // priced every row from the fallback formula instead — wait for it.
      const paint = () => {
        try {
          renderBrecilienFeesTable();
          const tbl = document.getElementById("brecilien-fees-table");
          if (tbl) tbl._staticRenderer = renderBrecilienFeesTable;
        } catch (e) {
          console.error("renderBrecilienFeesTable:", e);
        }
      };
      if (typeof showCatalogLoading === "function") showCatalogLoading("brecilien-fees-table");
      if (typeof whenCatalogsReady === "function") whenCatalogsReady(paint);
      else paint();
    });
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      buildBrecilienFeeRows,
      renderRow,
      TIERS,
      TIERED_ITEMS,
      SPECIAL_ITEMS,
      RESOURCE_ENCHANTS,
    };
  }
})();
