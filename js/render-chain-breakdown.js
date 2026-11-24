// Shared chain-tree HTML renderer. Used by render-consumables.js and
// render-transport.js to print the recursive "↳ Nx item @ price (from city)"
// breakdown under any row whose secondary mat is sourced via a craft/refine
// chain. Lives in its own file so callers can share it without coupling, and
// to keep render-consumables.js under the 800-line cap (CLAUDE.md).
//
// `chain` is the sourcing node shape produced by chain-pricing.js /
// refining-chain-pricing.js: { output, station, inputs[{ matId, count,
// sourcing: { perUnit, source, city?, chain?, travelFeePerUnit? } }], ... }.
// `consumedCount` is how many OUTPUT units the parent needs (already
// adjusted for the parent's RRR by the caller), so leaves scale to demand.
// Every level's wrapper carries class="chain-indent" and NO inline margin — one
// fixed inset per level, defined once in css/styles.css. The depth is already in
// the DOM (each level nests inside its parent), so a depth-scaled margin was
// counted twice and grew quadratically: a 4-deep chain reached 16+32+48+64 =
// 160px and squeezed the text into a ribbon. The `indent` parameter survives on
// both signatures because callers still pass it, but it no longer affects
// spacing.
//
// Breakdown for a transmute substitution: instead of buying `count` of a raw,
// buy `count` of a cheaper lower node and transmute each one up. Indented "↳"
// style like the chain lines, with an editable price span on the bought start so
// the user can override it like any other market leaf.
//
// Two callers: the Refining / Transports row (its own top-level raw) and the
// chain breakdown below (a raw leg inside a Craft Planner chain).
function transmuteSubstituteLines(transmute, count, indent) {
  const startName = getItemDisplayName(transmute.startId);
  const steps = (transmute.steps || [])
    .map((s) => `<div>↳ ${tx("transmute", "r_transmute_lower")} ${getItemDisplayName(s.fromId)} → ${getItemDisplayName(s.toId)} `
      + `<small style="color:#9ca3af">@ ${formatSilver(s.fee + s.stationFee)} ${tx("ea", "r_ea")}</small></div>`)
    .join("");
  return `<div class="chain-indent" style="color:#cbd5e1">`
    + `<div>↳ ${count}x ${startName} ${matPriceSpan(transmute.startId, transmute.startCity, transmute.startPrice)} `
    + `<small style="color:#9ca3af">(${tx("from", "r_from_lower")} ${transmute.startCity})</small></div>`
    + steps
    + `</div>`;
}

function renderChainBreakdown(chain, consumedCount, indent) {
  if (!chain) return "";
  const pad = indent || 1;
  const batches = consumedCount / chain.output;
  const stationLabel = chain.station === "butcher" ? tx("butcher", "r_station_butcher")
                     : chain.station === "mill" ? tx("mill", "r_station_mill")
                     : chain.station === "cook" ? tx("cook", "r_station_cook")
                     : chain.station === "alchemist" ? tx("alchemist", "r_station_alchemist")
                     : typeof chain.station === "string" && chain.station.startsWith("Refine ")
                       ? `${tx("Refine", "r_refine")} ${chain.station.slice("Refine ".length)}`
                       : chain.station;
  // Refining chain headers read "(1.00x refine wood at FS; 1 output ea)" —
  // grammatically awkward as "...batches" so the suffix is dropped.
  const isRefine = typeof chain.station === "string" && chain.station.startsWith("Refine ");
  const outputSuffix = `${chain.output} ${tx("output ea", "r_output_ea")}`;
  const headerSuffix = isRefine ? `; ${outputSuffix}` : ` ${tx("batches", "r_batches")}; ${outputSuffix}`;
  const lines = chain.inputs.map((inp) => {
    const name =
      (typeof getItemDisplayName === "function" && getItemDisplayName(inp.matId)) ||
      (typeof ITEM_NAMES_MAP !== "undefined" && ITEM_NAMES_MAP[inp.matId]) ||
      inp.matId;
    const totalCount = inp.count * batches;
    const subSrc = inp.sourcing || { perUnit: 0, source: "market" };
    // A faction heart is bought at market like any leaf — it just happens to be
    // standing in for a raw unit — so it gets the same city label and editable
    // price span, and only the tag below marks it as a substitution.
    const isBoughtLeaf = subSrc.source === "market" || subSrc.source === "heart";
    const cityTag = isBoughtLeaf && subSrc.city
      ? ` <small style="color:#9ca3af">(${tx("from", "r_from_lower")} ${subSrc.city})</small>`
      : "";
    // Editable price span — clicking opens the override dialog. Uses the
    // matPriceSpan helper so behavior matches every other ingredient cell
    // (saves the override under matId+city). Only attached to market leaves
    // — chain sub-tree leaves carry their own editable spans further down.
    const priceTag = (isBoughtLeaf && typeof matPriceSpan === "function")
      ? ` ${matPriceSpan(inp.matId, subSrc.city || "", subSrc.perUnit || 0)}`
      : (typeof formatSilver === "function" && subSrc.perUnit > 0
          ? ` <small style="color:#9ca3af">@ ${formatSilver(subSrc.perUnit)} ${tx("ea", "r_ea")}</small>`
          : "");
    const feedTag = inp.isFeed
      ? ` <small style="color:#9ca3af">(${tx("feed", "r_feed")})</small>`
      : "";
    // A transmuted raw is PRODUCED, not bought: its own id has no price to show
    // and no city to buy it in. Name it, tag it, then expand into the node that
    // IS bought plus each upgrade step.
    const transmuteTag = subSrc.source === "transmute" && subSrc.transmute
      ? ` <small style="color:#fbbf24" title="${tx("Cheaper to buy {item} and transmute it up than to buy this raw ({price} vs market). The transmuted raw is a normal raw — the resource return rate still applies to it.", "r_tip_via_transmute").replace("{item}", getItemDisplayName(subSrc.transmute.startId)).replace("{price}", formatSilver(subSrc.perUnit))}">${tx("(via transmute)", "r_via_transmute")}</small>`
      : "";
    // A heart replaces ONE unit of the raw named in `replacesMatId`, and is fully
    // consumed (no resource return). Same wording as the Refining / Transports
    // table's heartSubstituteLine so the two tables read alike.
    const heartTag = subSrc.source === "heart"
      ? ` <small style="color:#fbbf24" title="${tx("Faction heart stands in for 1x {raw} — cheaper than the raw (heart is consumed; no resource return)", "r_tip_heart_substitute").replace("{raw}", getItemDisplayName(inp.replacesMatId || ""))}">${tx("(substitute — cheaper than {raw})", "r_substitute_cheaper").replace("{raw}", getItemDisplayName(inp.replacesMatId || ""))}</small>`
      : "";
    let line = `↳ ${totalCount.toFixed(totalCount < 10 ? 2 : 1)}x ${name}${priceTag}${cityTag}${feedTag}${transmuteTag}${heartTag}`;
    if (subSrc.source === "chain" && subSrc.chain) {
      line += renderChainBreakdown(subSrc.chain, totalCount, pad + 1);
    } else if (subSrc.source === "transmute" && subSrc.transmute
               && typeof transmuteSubstituteLines === "function") {
      line += transmuteSubstituteLines(
        subSrc.transmute, totalCount.toFixed(totalCount < 10 ? 2 : 1), pad + 1);
    }
    return line;
  });
  const header = `<small style="color:#9ca3af">(${batches.toFixed(2)}x ${stationLabel}${headerSuffix})</small>`;
  return `<div class="chain-indent" style="color:#cbd5e1">${header}<br>${lines.join("<br>")}</div>`;
}

// Per-unit ingredient breakdown for a consumable craft row. Extracted from
// render-consumables.js to keep it under the 800-line cap (CLAUDE.md). Each
// ingredient is shown at its PER-UNIT amount (batch count / recipeOutput) with a
// post-RRR "consumed" annotation and the non-focus-craftable chain-bonus tag.
// Reads ITEM_NAMES_MAP / getItemDisplayName / matPriceSpan / formatSilver /
// renderChainBreakdown from globals.
//
// Every ingredient reads as a flat market buy: one line, one price, one city.
// The chain sub-tree that used to be inlined here whenever making an ingredient
// beat buying it now lives in the "alternative routes" panel below the row
// (js/render-consumable-alt-routes.js) — this cell answers what the potion
// costs, that panel answers whether to run a pasture. The one exception is an
// ingredient with no market listing at all: the chain is then the row's actual
// price, so its tree stays here where the leaves are editable.
function renderConsumableIngredients({ recipe, matBestPrices, rrr, recipeOutput, chainBonusBreakdown, focusCost, matAltChains, rowKey }) {
  const fmtCount = (n) => (Number.isInteger(n) ? String(n) : (+n.toFixed(2)).toString());
  const lines = recipe
    .map((m) => {
      const name =
        ITEM_NAMES_MAP[m.matId] || getItemDisplayName(m.matId) || m.matId;
      const { price, city, sourcing } = matBestPrices[m.matId] || {
        price: 0,
        city: "?",
        sourcing: null,
      };
      const perUnitCount = m.count / recipeOutput;
      const effectiveCount = (m.noReturn ? perUnitCount : perUnitCount * (1 - rrr)).toFixed(1);
      const isChain = sourcing?.source === "chain";
      const fromTag = isChain
        ? ` <small style="color:#fbbf24" title="${tx("Not listed on any market this route can buy from, so the row is priced at what it costs to make — the breakdown below.", "r_tip_unlisted_via_chain")}">${tx("(not listed — via chain)", "r_not_listed_via_chain")}</small>`
        : (city
            ? ` <small style="color:#9ca3af">(${tx("from", "r_from_lower")} ${city})</small>`
            : "");
      // Surface ingredients that are chain-craftable but NOT focus-craftable
      // (no craftingfocus in items.xml — e.g. T1_FISHCHOPS). Their chain savings
      // flow into THIS row's silver/focus numerator since the game won't let you
      // spend focus on them directly. Without this tag the boost is invisible.
      const bonusEntry = (chainBonusBreakdown || []).find((b) => b.matId === m.matId);
      const nonFocusTag = bonusEntry
        ? ` <small style="color:#a78bfa" title="${tx("Uses non-focus-craftable consumable — {savings} silver chain savings per batch flow into this recipe's silver/focus column", "r_tip_non_focus_consumable").replace("{savings}", formatSilver(bonusEntry.savings))}${focusCost > 0 ? "" : " " + tx("(silver/focus stays '—' because THIS recipe itself has no focus cost, but the bonus is real)", "r_tip_non_focus_no_cost")}">${tx("(uses non-focus-craftable consumable)", "r_uses_non_focus_consumable")}</small>`
        : "";
      // Ordinary cook recipes refund some of each ingredient via city RRR, so we
      // surface the post-refund "consumed" count. Crafts with no input refund
      // (butcher, fish sauce) show a "(no RRR refund)" tag instead.
      const consumedTag = m.noReturn
        ? ` <small style="color:#9ca3af" title="${tx("No resource return refund on this input (butcher / fish sauce — every unit is fully consumed)", "r_tip_no_rrr_refund")}">${tx("(no RRR refund)", "r_no_rrr_refund")}</small>`
        : ` <small style="color:#9ca3af">(~${effectiveCount}x ${tx("consumed", "r_consumed")})</small>`;
      const head = `${fmtCount(perUnitCount)}x ${name} ${matPriceSpan(m.matId, city, price)}${fromTag}${nonFocusTag}${consumedTag}`;
      if (!isChain) return head;
      // Pre-multiply chain leaves by the actual amount consumed so the user sees
      // concrete totals, not per-unit ratios.
      const consumedCount = m.noReturn ? perUnitCount : perUnitCount * (1 - rrr);
      return `${head}${renderChainBreakdown(sourcing.chain, consumedCount)}`;
    })
    .join("<br>");
  return `${lines}${consumableAltRoutesToggle(matAltChains, rowKey)}`;
}

// The "▸ alternative routes" affordance, mirroring the Craft Planner's
// "▸ best path" (js/render-craft-planner.js). Rendered inside the Ingredients
// cell because the ingredients are what it re-prices. Absent when no ingredient
// is cheaper to make than to buy — there is nothing to open.
function consumableAltRoutesToggle(matAltChains, rowKey) {
  if (!rowKey || !matAltChains || !matAltChains.length) return "";
  if (typeof consumableOpenAltRows === "undefined") return "";
  const open = consumableOpenAltRows.has(rowKey);
  const label = tx("alternative routes", "r_cons_alt_routes");
  const tip = tx(
    "Ingredients you could make yourself instead of buying. The row above buys them all at market; this shows what each chain costs and adds to the profit.",
    "r_tip_cons_alt_toggle",
  );
  return `<br><span class="cp-paths-toggle" data-cons-alt-toggle="${rowKey}" title="${tip}">${open ? "▾" : "▸"} ${label}</span>`;
}

// Node test harness export (inert in the browser, which uses globals).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { renderChainBreakdown, renderConsumableIngredients, consumableAltRoutesToggle };
}
