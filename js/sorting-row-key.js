/**
 * Row identity — getRowKey, the one stable string that names a rendered row.
 *
 * Split out of js/sorting.js purely for file size (the repo caps source files at
 * 800 lines); it is pure lookup with no state and no DOM.
 *
 * Everything that has to find a row again after a re-render keys off this
 * string: restoreAnchor (keeping the viewport still when an override re-prices a
 * table), the per-table "show overrides only" filters, My Crafting List entries,
 * and the expand/collapse toggles. So the key must be built ONLY from
 * identifiers that survive a recompute — never from a price-derived value. The
 * winning buy/sell city is the classic trap: it shifts the moment an override
 * changes which city is cheapest, which re-keys the row mid-render and sends the
 * viewport (or the row's own position) somewhere else. Each case below documents
 * the fields it deliberately includes or leaves out.
 *
 * getSortValue stays in js/sorting.js; the default branch here calls it, which
 * is safe in both directions because both files are browser globals loaded
 * before any render.
 */

function getRowKey(row, tableId) {
  try {
    // Use stable identifiers that don't change when prices/routes are recomputed.
    // The computed sell/buy cities shift on override, so never include them in the key.
    switch (tableId) {
      case "crafting-table":
        return (row.item?.id || "") + "|" + (row.craftCity || "");
      case "craft-planner-table":
        // item id + zone section. The planner renders one row per (item,
        // section) — each section's best candidate, the royal rows and then the
        // Caerleon rows under the "Caerleon & Black Market Routes" divider, the
        // way the farming-table case below does (and sorting.js groups the
        // planner's enchant variants by base|section for exactly this). section
        // is the candidate's fixed zone side — a royal city can never become the
        // Caerleon craft — so it is stable across a re-pricing, while the
        // winning craft city WITHIN a section is price-derived and stays out:
        // keying on it re-keyed the surviving row whenever an override flipped
        // the winner, the scroll anchor (js/scroll-anchor.js) and the
        // pending-edit mark lost the row, and _suppressSort spliced it in as a
        // fresh row — the vertical jump on every planner price edit.
        return (row.item?.id || "") + "|" + (row.section || "");
      case "consumable-table":
        // section appended because no-data rows (margin -1) carry section but
        // NO craftCity — without it the royal + Caerleon no-data rows for one
        // item share `id|` and restoreAnchor jumps to the first (royal) match.
        // Data rows already differ by craftCity, so section is harmless there.
        return (row.item?.id || "") + "|" + (row.craftCity || "") + "|" + (row.section || "");
      case "mounts-table":
        if (row.isBreeding) return (row.item?.babyId || "") + "|" + (row.section || "");
        return (row.item?.id || "") + "|" + (row.craftCity || "");
      case "flipping-table":
        return (row.item?.id || row.item?.name || "") + "|" + (row.section || "");
      case "skins-trading-table":
        return row.item?.id || ""; // one stable row per skin
      case "buildings-table":
        // One row per building — the laborers/furniture half is columns on that
        // same row, not a second "fitted" row, so the building id is the key.
        return row.building?.id || "";

      case "transport-table":
        // variant ("chain"/"direct"/"") appended so a chain row and its paired
        // direct-refining comparison row (same item + refine city) get distinct
        // keys — otherwise they'd collide and restoreAnchor would jump rows.
        return (row.route?.rawId || "") + "|" + (row.route?.refinedId || "") + "|" + (row.refineCity || "") + "|" + (row.variant || "");
      case "farming-table":
        // section required — farming renders one royal + one Caerleon row per
        // crop (same item.id), so without it both share a key and editing the
        // Caerleon row scrolls the viewport up to the royal row.
        return (row.item?.id || row.item?.name || "") + "|" + (row.section || "");
      case "gathering-table":
        // rawId + section — both stable across an override re-render (the sell
        // city, which IS price-derived, is deliberately excluded).
        return (row.rawId || "") + "|" + (row.section || "");
      case "journal-filling-table":
        // fullId + section — stable across override re-renders (the priced
        // sell/buy cities are deliberately excluded, like gathering).
        return (row.fullId || "") + "|" + (row.section || "");
      case "enchanting-table":
        // section appended — royal + Caerleon render the same item+transition.
        return (row.item?.id || "") + "|" + (row.transitionLabel || "") + "|" + (row.section || "");
      case "transmute-table":
        // section appended — royal + Caerleon render the same tier+transition.
        return (row.tier || "") + "|" + (row.transition?.label || "") + "|" + (row.section || "");
      case "rolling-table":
        // The SAME (tier, rollType, artName) renders under BOTH the "Any"
        // category and its specific category (Warrior/Mage/Hunter), AND in
        // BOTH the royal and Caerleon sections — up to four DOM rows. section +
        // cat + artId make the key unique per rendered row and stable across an
        // override re-render (none of them are price-derived). Without it every
        // variant shared one key, so restoreAnchor's querySelector matched the
        // first one (the top "Any"/royal row) and scrolled the viewport to the
        // top. Mirrors the mounts-table breeding fix.
        // An Energy Manipulator exchange row is keyed by its FRAGMENT: its best
        // pick (artId) moves with prices, which would re-key it mid-render.
        return (row.section || "") + "|" + (row.cat || "") + "|" + (row.exchangeKey || row.artId || row.artName || "");
      case "rerolling-table":
        // section included so the royal and Caerleon rows of the same
        // item+transition get distinct keys (same scroll-jump class as rolling).
        return (row.item?.id || "") + "|" + (row.transitionLabel || "") + "|" + (row.section || "");
      case "faction-spending-table":
        // itemId is unique per row (crest/baby ids embed their city; Favor rows
        // are distinct ids) and never price-derived. Without this case the
        // default branch read row.item / row.buy — which faction rows lack — so
        // every row collapsed to "|", and _suppressSort's order-preservation
        // reverted the user's chosen sort (e.g. S/Favor) back to the build's
        // silver/FP order on any override re-render.
        return row.itemId || "";
      case "joined-summary-table":
      case "joined-focus-table":
      case "bm-board-table":
        // Ten rows per feeder now, so the source rowKey has to carry them
        // apart — and it is "" for tables whose rows have no id (faction
        // spending). joinedRowKey's name+route fallback is what keeps the jump
        // link and the sort cache pointing at the right row.
        return typeof joinedRowKey === "function"
          ? joinedRowKey(row)
          : (row.tableId || "") + "|" + (row.rowKey || row.itemName || "");
      case "volume-table":
        // Without a case of its own this fell to the default branch, which reads
        // `route` — `row.buy.city` for a volume row — threw, and the catch below
        // handed back "" for EVERY row. Nothing that keys off a row (the scroll
        // anchor, the pending-edit mark, _suppressSort's order cache) could tell
        // two rows apart. itemId survives a re-price and the City pick that
        // rebuilds the row at another city, which is this file's rule.
        return row.itemId || "";
      case "laborers-table":
        // item.id = `${mode}|${filledId}` — encodes laborer + tier + mode and
        // is fully stable across override re-renders. The default branch keys on
        // name|route, and route = `${buy.city}-${row.sell.city}`, which SHIFTS
        // when an override changes the winning city — so the edited row was
        // re-keyed and, under _suppressSort order-preservation, appended to the
        // bottom of the table (looking like the Profit/Cycle sort had broken).
        return row.item?.id || "";
      default: {
        // getSortValue lives in js/sorting.js and is a browser global resolved at
        // call time, so the two files can reference each other in either order.
        // Guarded so a Node caller that loads only this file gets "" rather than a
        // ReferenceError swallowed by the catch below.
        if (typeof getSortValue !== "function") return "";
        const name = getSortValue(row, "name", tableId);
        const route = getSortValue(row, "route", tableId);
        return name + "|" + route;
      }
    }
  } catch { return ""; }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getRowKey };
}
