// Crafting Planner table — the vertical "refine the ladder → craft the top item"
// view. Reuses the Crafting catalogue (CRAFTING_ITEMS, base recipes only) but
// sources every material at the cheaper of buy-vs-refine, adds crafting-journal
// fill value, and advises the single most profitable place to spend focus.
//
// Economics live in js/craft-planner-pricing.js (computeCraftPlannerRow); the
// quality-map readers and Sell-cell quality notes live in js/craft-planner-quality.js.
// This file only builds the row set + HTML. The one-row-per-(item, section) decision
// (dedupeCraftPlannerRows + the alt-city summaries it attaches to each section's
// winner) lives in js/craft-planner-dedupe.js. Helpers borrowed from
// render-crafting.js (getSpecCraftCity, getNoSpecLabel, getCraftCandidates,
// getCraftingMaterials) and app.js (matPriceSpan, priceTd, formatSilver, getProfitClass).

// Wrap content in a click target that jumps to the Refining / Transports table
// row for a refined material (its T*_PLANKS / _METALBAR / _CLOTH … id). The
// shared handler below matches the transport row by its refined-id segment of
// data-row-key (rawId|refinedId|refineCity|variant), so we don't need to know the
// exact refine city or chain-vs-direct variant here.
function _cpJumpToRefine(refinedId, innerHtml) {
  return `<span class="cp-refine-jump" data-refined-id="${refinedId}" style="cursor:pointer">${innerHtml}</span>`;
}

// The ↗ that opens the refine in the Refining / Transports table.
//
// It used to wrap the WHOLE refine tag, which meant a self-refined material was
// the one material line in the cell with no way to set a price on it — clicking
// it navigated away instead. The tag body is a price now (see _cpMatLine) and
// only this arrow jumps.
function _cpRefineJumpArrow(refinedId) {
  return _cpJumpToRefine(
    refinedId,
    `<small style="color:#7ab8c4" title="${tx("Open this refine in the Refining / Transports table.", "r_tip_open_refine_row")}">↗</small>`,
  );
}

// One material line: count + name + per-unit price, tagged with how it's sourced
// (refined up the ladder vs bought as a bar). The refine tag is click-to-jump to
// that material's row in the Refining / Transports table.
// "(via transmute)" tag for a chain whose RAW leg is bought a node lower and
// transmuted up. It hangs off the refine tag rather than replacing it: the row
// still refines the bar, it just feeds that refine a produced raw.
function _cpTransmuteTag(chain) {
  const src = chain && chain.inputs && chain.inputs[0] && chain.inputs[0].sourcing;
  if (!src || src.source !== "transmute" || !src.transmute) return "";
  const t = src.transmute;
  const tip = tx(
    "Its raw is not bought at {raw}'s price: {start} is bought in {city} and transmuted up ({steps} step(s)) for {cost} ea.",
    "r_tip_planner_transmute",
  )
    .replace("{raw}", getItemDisplayName(chain.inputs[0].matId))
    .replace("{start}", getItemDisplayName(t.startId))
    .replace("{city}", t.startCity || "—")
    .replace("{steps}", (t.steps || []).length)
    .replace("{cost}", formatSilver(t.perUnit));
  return ` <small style="color:#c084fc" title="${tip}">(${tx("via transmute", "r_via_transmute")})</small>`;
}

// "(substitute — cheaper than X)" tag when a Crystallized token / decay twin
// fills an artifact slot instead of the artifact the recipe names. Same wording
// as the Crafting table's heart substitute so the two read alike.
function _cpSubstituteTag(s) {
  if (!s.origMatId || s.origMatId === s.matId) return "";
  const replaced = getItemDisplayName(s.origMatId);
  return ` <small style="color:#fbbf24" title="${tx("Fills the {raw} slot in this recipe — same craft, same focus, cheaper to buy.", "r_tip_mat_substitute").replace("{raw}", replaced)}">${tx("(substitute — cheaper than {raw})", "r_substitute_cheaper").replace("{raw}", replaced)}</small>`;
}

// The "best path: …" line printed under every material (js/render-craft-planner-paths.js).
// "" when that file is not loaded, so the cell degrades to its material lines.
function _cpBestPath(s, craftCity) {
  return (typeof cpBestPathLine === "function") ? cpBestPathLine(s, craftCity) : "";
}

// One material line, wrapped as a block: the material itself, then its
// "best path" line. Blocks, not <br>-joined text, so the two lines of a material
// stay together and the cell needs no separator markup.
function _cpMatLine(s, craftCity) {
  return `<div class="cp-mat-line">${_cpMatLineBody(s, craftCity)}`
    + `${_cpBestPath(s, craftCity)}</div>`;
}

// The Materials cell of a row the planner booked as bought-then-enchanted
// (row.enchantedVia, js/craft-planner-enchant-route.js). TWO lines instead of
// the craft-route material list — the @(n-1) base item and the rune/soul/relic —
// built on the same _cpMatLineBody markup so the price spans stay click-to-edit
// and the overrides keep working; then the enchant "best path" line under them.
function _cpEnchantViaCell(row) {
  const v = row.enchantedVia;
  const line = (matId, count, city, price) =>
    `<div class="cp-mat-line">${_cpMatLineBody(
      { matId, origMatId: matId, count, sourcing: { source: "market", city, perUnit: price } },
      row.craftCity,
    )}</div>`;
  // A transmuted mat line names the node actually bought, in the bought count.
  const ms = v.matSourcing;
  return line(v.baseId, 1, v.baseCity, v.basePrice)
    + line(ms ? ms.buyId : v.matId, ms ? v.matCount * ms.buyCount : v.matCount, v.matCity, v.matPrice)
    + ((typeof cpEnchantPathLine === "function") ? cpEnchantPathLine(v) : "");
}

function _cpMatLineBody(s, craftCity) {
  const name = getItemDisplayName(s.matId);
  const src = s.sourcing || {};
  // A transmute never sources a planner MATERIAL directly (refined bars don't
  // transmute) — it lives on the raw leg inside the chain below. This branch is
  // here so a future transmutable material can't silently fall into the market
  // branch and render "(from undefined)".
  if (src.source === "transmute" && src.transmute) {
    return `${s.count}x ${name} ${matPriceSpan(src.transmute.startId, src.transmute.startCity, src.transmute.startPrice || 0)}`
      + ` <small style="color:#c084fc">(${tx("via transmute", "r_via_transmute")} ${tx("from", "r_from_lower")} ${src.transmute.startCity})</small>`;
  }
  if (src.source === "chain" && src.chain) {
    const rt = src.chain.resourceType || "";
    // When focus is being spent on THIS material's refine (focusTier set), mark it
    // so the row's "spend focus here" play lines up with the material line.
    const focusNote = src.focusTier
      ? ` <b class="profit-low" title="${tx("Your focus is spent on this refine (T{tier}), lowering the crafted item's cost", "r_tip_focus_on_refine").replace("{tier}", src.focusTier)}">(${tx("focus", "r_focus")} ⚡)</b>`
      : "";
    // The tag is click-to-override, not click-to-navigate: the number it quotes
    // is what the self-refine costs, and the thing worth correcting beside it is
    // the market price of the bar that refine is beating. So the body opens the
    // price editor for THIS material (buy side, at the craft city) and only the
    // trailing ↗ still jumps to the Refining / Transports row.
    // data-raw-price is 0 on purpose: the number shown here is the REFINE cost,
    // not the bar's market price, and the editor prefills its inputs from the
    // live price map anyway (buildCityOptions, js/price-edit-dropdown.js).
    const tag = `<span class="price-editable" data-item-id="${s.matId}" data-city="${craftCity || ""}" data-raw-price="0" data-city-list="buy" style="cursor:pointer" title="${tx("Refined yourself up the {type} ladder (cheaper than buying the bar). Click to set what the bar itself costs at {city}.", "r_tip_self_refined").replace("{type}", rt).replace("{city}", craftCity || "")}"><small style="color:#7ab8c4;text-decoration:underline dotted">(${tx("refine", "r_refine_lower")} ${rt} ▲ @ ${formatSilver(src.perUnit)} ${tx("ea", "r_ea")})</small></span>`;
    return `${s.count}x ${name} ${tag}${_cpRefineJumpArrow(s.matId)}${_cpTransmuteTag(src.chain)}${focusNote}`;
  }
  const city = src.city || craftCity;
  return `${s.count}x ${name} ${matPriceSpan(s.matId, city, src.perUnit || 0)}${city ? ` <small style="color:#9ca3af">(${tx("from", "r_from_lower")} ${city})</small>` : ""}${_cpSubstituteTag(s)}`;
}

// Best Focus cell: the focus placement that leaves THIS row's end product most
// profitable — either the craft step, or refining one material the craft uses
// (cheapest ladder tier, the bar then used in the craft). Every candidate feeds
// this craft, so the cell can never contradict the Materials column.
//
// Rendering is the shared focusPlayCell (js/focus-play.js) that every table's
// Best Focus column uses. Two planner-specific parts:
//
//  • a refine play's label jumps to that refine's Refining / Transports row.
//  • the play's delta and its focus are quoted PER CRAFT. Every candidate this
//    table enumerates feeds one craft, so profitDelta is the cost removed from
//    one craft — but a refine play's own `focusCost` is a SINGLE refine of a
//    single unit, and the craft runs that step once per ladder step per unit it
//    consumes. Dividing the per-craft delta by it inflated the /focus rate, and
//    the kind's default "/refine" label made a per-craft figure read per-refine.
//    row.focusPerCraft is the honest total (_cpFocusPerCraft — the same divisor
//    Profit / 10k Focus uses), so pass it and force the /craft unit.
function _cpFocusCell(step, focusPerCraft) {
  return focusPlayCell(step, {
    linkRefine: _cpJumpToRefine,
    unit: "/craft",
    focusPerExecution: focusPerCraft,
  });
}

// Profit / 10k Focus cell: the row's FOCUS-ON profit per craft × the whole
// crafts a full 10,000-focus bar buys under the winning play (both figures come
// from computeCraftPlannerRow). A row that can take no focus renders a dash —
// "no focus play here" is not the same answer as "a bar earns 0".
// The quoted profit is focusCombinedProfit, not the headline combinedProfit:
// with Use Focus off the headline is the focus-off baseline, and this column
// prices a focus bar, so it never follows the checkbox.
function _cpPer10kPerCraft(row) {
  return row.focusCombinedProfit != null ? row.focusCombinedProfit : row.combinedProfit;
}

// A bar's crafts for the tooltip — "0.77" when one craft outruns the bar.
function _cpBarCrafts(n) {
  return (typeof formatBarCrafts === "function") ? formatBarCrafts(n) : String(n);
}

function _cpPer10kCell(row) {
  if (row.profitPer10kFocus == null || !(row.focusPerCraft > 0)) {
    const why = (!row.enchantedVia && typeof noFocusPlayTip === "function") ? noFocusPlayTip(row.item.id, row.tier) : "";
    return `<td style="color:#6b7280;font-style:italic"${why ? ` title="${why}"` : ""}>—</td>`;
  }
  const cls = row.profitPer10kFocus > 0 ? "profit-low" : "profit-negative";
  const tip = tx("{profit} profit/craft (after mat costs) × {crafts} crafts ({focus} focus ea)", "r_p10k_craft_tip")
    .replace("{profit}", formatSilver(_cpPer10kPerCraft(row)))
    .replace("{crafts}", _cpBarCrafts(row.craftsPer10kFocus))
    .replace("{focus}", Math.round(row.focusPerCraft).toLocaleString());
  return `<td class="silver-val ${cls}" title="${tip}">${formatSilver(row.profitPer10kFocus)}${(typeof gatheredPer10kSmallHtml === "function" ? gatheredPer10kSmallHtml(row.profitPer10kFocusGathered, row.profitFocusOnGathered) : "")}</td>`;
}

// Inline click-to-edit price span for a journal's full (sell) / empty (buy)
// price — same override plumbing as the material price spans, so editing it and
// committing re-renders the row with the new journal economics.
function _cpJournalPriceSpan(itemId, city, price, side) {
  const has = (typeof getOverridePrice === "function") && getOverridePrice(itemId, city) !== null;
  const ind = has ? ` <span class="ov-mark" style="color:#9e8840;font-size:0.7rem" title="${tx("Price overridden", "r_price_overridden")}">⚡</span>` : "";
  const style = has ? "color:#9e8840;" : "";
  const disp = price > 0 ? formatSilver(price) : tx("no data", "r_no_data");
  const what = side === "sell"
    ? tx("full journal sell", "r_full_journal_sell")
    : tx("empty journal buy", "r_empty_journal_buy");
  return `<span class="price-editable" data-item-id="${itemId}" data-city="${city || ""}" data-raw-price="${price}" data-city-list="${side}" style="cursor:pointer;text-decoration:underline dotted;${style}" title="${tx("Click to override the {what} price", "r_tip_override_journal_price").replace("{what}", what)}">${disp}${ind}</span>`;
}

// For a no-data row, find the best AVAILABLE sell (city, price) so the sell cell
// can show a real number when the only blocker is an unpriced material. Falls
// back to the craft city at price 0 so the cell is still editable ("no data —
// click to set") when the item has no sell price anywhere.
//
// NOTE: distinct name from craft-planner-pricing.js's `_cpBestSell(id, md, city)`.
// Both files share the browser global scope; a shared name let whichever script
// loaded last clobber the other — which silently broke journal-fill pricing
// (getCraftJournalFill called this with an id and got item-shaped garbage back).
function _cpRowBestSell(item, craftCity, marketData) {
  const data = marketData && marketData[item.id];
  const bounds = (typeof getIQRBounds === "function") ? getIQRBounds(data) : null;
  // Honour a REACHABLE sell pin, exactly as the priced branch does (cpSellPin,
  // js/craft-planner-pricing.js). Without this the no-data cell searched every
  // city and could quote a different one from the row right above it — the same
  // pin, honoured in one branch and ignored in the other.
  const pin = (typeof cpSellPin === "function") ? cpSellPin(item.id, craftCity) : { city: null };
  const all = (typeof SELL_CITIES !== "undefined") ? SELL_CITIES : [];
  // Same precedence the priced branch uses: the table's City pick first, the
  // per-item pin second (js/table-sell-city.js). Without this a no-data row
  // would quote a city the rest of the filtered table is not selling in.
  const cities = (typeof effectiveSellCities === "function")
    ? effectiveSellCities("craft-planner-table", craftCity, pin.city, all)
    : (pin.city ? [pin.city] : all);
  // The fallback city is what an unpriced cell offers to edit, so it follows the
  // same narrowing: one candidate means the pick (or the pin) owns the cell.
  let best = { city: (cities.length === 1 ? cities[0] : null) || pin.city || craftCity, price: 0 };
  cities.forEach((sc) => {
    if (typeof isInvalidCrossRoute === "function" && isInvalidCrossRoute(craftCity, sc)) return;
    const p = (typeof getSellPrice === "function") ? getSellPrice(data, sc, bounds, item.id) : 0;
    if (p > best.price) best = { city: sc, price: p };
  });
  return best;
}

/**
 * The line under a sell price when the row had to drop the user's sell-city pin.
 *
 * Typing a price pins the city it was typed at (setCityForce, js/app.js). A pin
 * at a city this craft cannot reach — the Black Market from anywhere but
 * Caerleon, or across the royal/Caerleon line with Black/Red Zone Routes off —
 * cannot be used, and the row falls back to a reachable market price with no ⚡.
 * That is correct, but it was silent, and My Crafting List replays this row: an
 * override typed on the Caerleon row of an item looked like it had vanished
 * from the royal row sitting on the list.
 *
 * The same line covers the other way a pin stops applying: the table's City
 * pick outranks it while active (js/table-sell-city.js), which is a temporary
 * view choice rather than a broken route, so it gets its own wording.
 *
 * @param {string|null} pinCity  row.sellPinDropped
 * @param {string} craftCity
 * @param {string|null} filteredTo  row.sellPinFilteredTo — the active City pick
 * @returns {string} HTML, or "" when nothing was dropped
 */
function _cpSellPinNote(pinCity, craftCity, filteredTo) {
  if (filteredTo) {
    const ftext = tx("filtered to {city} — your pin is not applied", "r_cp_sell_pin_filtered")
      .replace("{city}", filteredTo);
    const ftip = tx(
      "The table's City filter is showing every row priced at {city}. Set it back to All to sell where each row pays best, pin included.",
      "r_cp_sell_pin_filtered_tip",
    ).replace("{city}", filteredTo);
    return `<br><small style="color:#9e8840;font-size:0.7rem" title="${ftip}">⚠ ${ftext}</small>`;
  }
  if (!pinCity) return "";
  const text = tx("pinned at {pin} — cannot sell there from {city}", "r_cp_sell_pin_dropped")
    .replace("{pin}", pinCity)
    .replace("{city}", craftCity || "—");
  const tip = tx(
    "Pinned at {pin}, which this craft city cannot reach, so the row sells at the market price. Caerleon reaches the Black Market; other pins need Routes on.",
    "r_cp_sell_pin_dropped_tip",
  ).replace("{pin}", pinCity);
  return `<br><small style="color:#9e8840;font-size:0.7rem" title="${tip}">⚠ ${text}</small>`;
}

// The Journal Fill cell: the extra silver per craft + the editable full/empty
// journal prices. When the journal has no market price yet, still render
// editable "no data" prices (defaulting to the craft city + craft-tier journal)
// so the user can set the filled-journal price to make the column live.
function _cpJournalCell(row) {
  const j = row.journal;
  if (!j || !j.slug) return '<span style="color:#6b7280;font-style:italic">—</span>';

  if (j.bestJournal && j.extraSilverPerCraft > 0) {
    const b = j.bestJournal;
    const crafts = j.craftsToFill > 0 ? j.craftsToFill : 0;
    // Spell out the division: one craft is worth a FRACTION of the journal,
    // never a whole one. margin ÷ crafts-to-fill is exactly what the figure is.
    const margin = b.fullGross * (1 - PREMIUM_TAX) - b.emptyCost;
    // Written as the division rather than a silver-per-fame rate: the rate
    // rounds to "1/fame" on most rows and hides the fact that one craft only
    // ever fills a fraction of a journal.
    const tip = crafts
      ? `Fills the ${_cpTitleCase(j.slug)} journal (T${b.tier}). ${Math.round(b.maxfame).toLocaleString()} fame fills it and this craft awards ${Math.round(j.famePerCraft).toLocaleString()}, so ${crafts.toFixed(1)} crafts per journal: ${formatSilver(margin)} margin (full sold after tax − empty bought) ÷ ${crafts.toFixed(1)} = ${formatSilver(j.extraSilverPerCraft)} per craft.`
      : `Fills the ${_cpTitleCase(j.slug)} journal (T${b.tier}).`;
    const sub = crafts ? ` · ${crafts.toFixed(1)} crafts/journal` : "";
    return `<span class="profit-low" title="${tip}">${formatSilver(j.extraSilverPerCraft)}</span>`
      + `<br><small style="color:#9ca3af">${_cpTitleCase(j.slug)} T${b.tier}${sub}: full ${_cpJournalPriceSpan(b.fullId, b.fullCity, b.fullGross, "sell")} · empty ${_cpJournalPriceSpan(b.emptyId, b.emptyCity, b.emptyCost, "buy")}</small>`;
  }

  // No priced journal yet — offer editable prices at the craft-tier journal.
  const fullId = `T${row.tier}_JOURNAL_${j.slug}_FULL`;
  const emptyId = `T${row.tier}_JOURNAL_${j.slug}_EMPTY`;
  return `<span style="color:#6b7280;font-style:italic">—</span>`
    + `<br><small style="color:#9ca3af">${_cpTitleCase(j.slug)} T${row.tier}: full ${_cpJournalPriceSpan(fullId, row.craftCity, 0, "sell")} · empty ${_cpJournalPriceSpan(emptyId, row.craftCity, 0, "buy")}</small>`;
}

// A quantity of returned goods, e.g. 3.5 units. The laborer's return is an
// expected value over its loot table, so it is fractional on purpose and must
// not be rounded to a whole item.
function _cpLaborerQty(n) {
  if (!(n > 0)) return "0";
  return n >= 10 ? String(Math.round(n)) : String(Number(n.toFixed(2)));
}

// What the laborer actually hands back for one journal, one clause per refined
// material. Tooltip-only: it runs to several materials × the enchant spread, and
// putting it on screen would add lines to every journal-filling row in the table.
// Unpriced lines are dropped — an unpriced return is not a free one, it is a gap.
function _cpLaborerMixText(best) {
  const priced = ((best && best.lines) || []).filter((l) => l.silver > 0);
  if (!priced.length) return "";
  return priced
    .map((l) => `${_cpLaborerQty(l.qty)}x ${getItemDisplayName(l.itemId)} ${formatSilver(l.silver)}`)
    .join(" · ");
}

// The Laborer Journal cell: the SAME journal as the Journal Fill column, but
// worked by your own laborer instead of sold — it comes back empty with the
// loot, so no empty is ever bought and no journal price appears here.
//
// Three lines, because this column IS the laborer play (it has no row of its
// own): the row's profit under the play, what the play adds per craft and whose
// journal it is, then the same figure in the laborer's own unit — one journal's
// payout, the yield it runs at, and how many crafts fill it. The refined mix and
// the play's 10k-focus bar are in the tooltip.
function _cpLaborerJournalCell(row) {
  const j = row.laborerJournal;
  if (!j || !j.bestJournal || !(j.extraSilverPerCraft > 0)) {
    const why = j
      ? tx("No priced refined output for this profession's laborer yet.", "r_laborer_journal_no_price")
      : tx("This craft fills no crafting journal.", "r_laborer_journal_none");
    return `<span style="color:#6b7280;font-style:italic" title="${why}">—</span>`;
  }
  const b = j.bestJournal;
  const crafts = (typeof getCraftsToFillJournal === "function")
    ? getCraftsToFillJournal(j.famePerCraft, b.maxfame)
    : 0;
  const sellExtra = row.journal ? (row.journal.extraSilverPerCraft || 0) : 0;
  const verdict = j.extraSilverPerCraft >= sellExtra
    ? tx("Beats selling the journal.", "r_laborer_beats_selling")
    : tx("Selling the journal pays more.", "r_laborer_loses_to_selling");
  const mix = _cpLaborerMixText(b);
  const mixTip = mix
    ? " " + tx("Returns {mix}.", "r_cp_laborer_mix_tip").replace("{mix}", mix)
    : "";
  // The play's own focus bar. focusCraftProfit, NOT focusCombinedProfit: the
  // latter carries the journal SALE, which this play never makes. Same guarded
  // shape computeCraftPlannerRow uses for profitPer10kFocus.
  const barPerCraft = row.focusCraftProfit != null ? row.focusCraftProfit + j.extraSilverPerCraft : null;
  const bar = (row.focusPerCraft > 0 && barPerCraft != null)
    ? ((typeof calculateProfitPer10kFocus === "function")
      ? calculateProfitPer10kFocus(barPerCraft, row.focusPerCraft)
      : barPerCraft * (row.craftsPer10kFocus || 0))
    : null;
  const barTip = bar != null
    ? " " + tx("A 10,000-focus bar spent this way is worth {bar}.", "r_cp_laborer_bar_tip")
      .replace("{bar}", formatSilver(bar))
    : "";
  const tip = tx(
    "Craft profit {profit} + {extra} laborer value: {fame} fame/craft fills a {laborer} T{tier} journal ({maxfame}); a T8 returns {payout} at {yield}×. {verdict}",
    "r_cp_laborer_journal_tip",
  )
    .replace("{profit}", formatSilver(row.craftProfit))
    .replace("{extra}", formatSilver(j.extraSilverPerCraft))
    .replace("{fame}", Math.round(j.famePerCraft).toLocaleString())
    .replace("{laborer}", _cpTitleCase(j.slug))
    .replace("{tier}", b.tier)
    .replace("{maxfame}", b.maxfame.toLocaleString())
    .replace("{yield}", b.yield.toFixed(3))
    .replace("{payout}", formatSilver(b.payout))
    .replace("{verdict}", verdict);
  const perJournal = tx("{payout} / journal · {yield}× · {crafts} crafts", "r_cp_laborer_per_journal")
    .replace("{payout}", formatSilver(b.payout))
    .replace("{yield}", b.yield != null ? b.yield.toFixed(2) : "—")
    .replace("{crafts}", crafts > 0 ? crafts.toFixed(1) : "—");
  const cls = row.laborerCombinedProfit > 0 ? "profit-low" : "profit-negative";
  return `<span class="${cls}" title="${tip}${mixTip}${barTip}">${formatSilver(row.laborerCombinedProfit)}</span>`
    + `<br><small style="color:#9ca3af">+${formatSilver(j.extraSilverPerCraft)} ${tx("/craft", "r_per_craft_unit")} · ${_cpTitleCase(j.slug)} T${b.tier}</small>`
    + `<br><small style="color:#7ab8c4">${perJournal}</small>`;
}

// Equipment id slots that enchant (0–4). Furniture (_FURNITUREITEM_), hideout
// kits (UNIQUE_*), and consumables have no enchant ladder, so they stay a single
// base row. CAPEITEM (faction/smuggler/avalon combine capes) enchants too — its
// .n is a combine of an enchanted base cape (T*_CAPE@n) + crest + token; listed
// before CAPE so it wins the alternation on `T*_CAPEITEM_...`.
//
// The slot token may END the id: `T4_BAG` and `T4_CAPE` carry nothing after it,
// unlike `T4_BAG_INSIGHT` or `T4_HEAD_CLOTH_SET1`. Requiring a trailing `_` left
// plain bags and capes without their .1–.4 rows even though both enchant in-game
// and the Crafting table has always shown them.
const CP_EQUIP_SLOT_RE = /^T\d+_(HEAD|ARMOR|SHOES|CAPEITEM|CAPE|BAG|MAIN|2H|OFF)(?:_|$)/;

// Does this catalogue row have a .1–.4 ladder? The slot alone does not decide
// it: enchants exist from T4 up, and the catalogue now carries T2/T3 gear
// (js/gear.js), which has no enchanted form at all. Mirrors the tier gate the
// Crafting table and the scan already apply (render-crafting.js, utils.js).
function cpHasEnchantVariants(id) {
  const raw = String(id || "");
  if (!CP_EQUIP_SLOT_RE.test(raw)) return false;
  const tier = parseInt(raw.slice(1), 10);
  return tier >= 4 && tier <= 8;
}
// Refined resources that carry an enchant level — only these get the _LEVELn@n
// suffix; artifacts/tokens in a recipe stay flat.
const CP_REFINED_RES_RE = /_(CLOTH|LEATHER|METALBAR|PLANKS|STONEBLOCK)$/;
// Combine inputs that never enchant: artifacts, faction crests/tokens, rare
// remains, tomes. Everything else tiered (e.g. the base cape T*_CAPE that feeds
// a faction cape) enchants with the equipment @n format. Mirrors the crafting
// table's mat-enchant rule (render-crafting.js) so the two never drift.
const CP_FLAT_MAT_RE = /ARTEFACT|_BP|TOKEN|_FACTION_|ALCHEMY_RARE|SKILLBOOK/;

function _cpEnchantMatId(matId, n) {
  // AODP refined-enchant id format: T4_CLOTH → T4_CLOTH_LEVEL2@2 (see the
  // reference_aodp_refined_enchant_id_format note — @n alone returns zeros).
  if (CP_REFINED_RES_RE.test(matId)) return `${matId}_LEVEL${n}@${n}`;
  // Any other tiered equipment combine input (base cape of a faction cape, base
  // armor of a royal piece) → equipment @n. Crest/token/artifact/tome stay flat.
  if (/^T\d+_/.test(matId) && !CP_FLAT_MAT_RE.test(matId)) return `${matId}@${n}`;
  return matId;
}

// Clone a base equipment recipe into its enchant-n (.1–.4) variant: enchant the
// output id, the primary resource matId, and any resource lines in materials[].
function _cpEnchantVariant(item, n) {
  const v = { ...item, id: `${item.id}@${n}`, matId: _cpEnchantMatId(item.matId, n) };
  v.name = item.name.replace(/\[T(\d+)\]/, `[T$1.${n}]`);
  if (item.materials && item.materials.length) {
    v.materials = item.materials.map((m) => ({ ...m, matId: _cpEnchantMatId(m.matId, n) }));
  }
  return v;
}

// Furniture a house of the stored tier cannot hold. A building takes furniture
// of its OWN tier or lower and nothing above, so a T8 bed is not a plan for a T6
// house — see js/house-tier.js, which owns the preference and defaults to T8 so
// nothing is hidden until the user names a smaller house. Every _FURNITUREITEM_
// row in the catalogue (beds, tables, chests, repair kits, Trophy Shark) is an
// indoor placeable and answers to the same rule.
//
// Only the ROWS are filtered: getCraftPlannerItemIds still scans every id, so
// raising the house tier again shows priced rows rather than blank ones.
function _cpUnplaceableFurniture(id) {
  if (!/_FURNITUREITEM_/.test(String(id))) return false;
  if (typeof getHouseTier !== "function" || typeof getTierFromId !== "function") return false;
  return getTierFromId(id) > getHouseTier();
}

// Expand the catalogue into the planner's row set: drop any hand-written @n
// entries (regenerated here so there are no duplicates) and any furniture the
// house cannot hold, then for each enchantable equipment recipe emit its base
// row plus .1–.4 variants.
function expandCraftPlannerItems(catalog) {
  const bases = catalog.filter(
    (i) => !String(i.id).includes("@") && !_cpUnplaceableFurniture(i.id));
  return bases.flatMap((item) =>
    cpHasEnchantVariants(item.id)
      ? [item, ...[1, 2, 3, 4].map((n) => _cpEnchantVariant(item, n))]
      : [item]
  );
}

// First-column name cell with the Crafting-table expand affordance: an
// enchantable base equipment row gets a ▶/▼ toggle (keyed to
// data-expand-table="craft-planner-table" so app.js's shared handler collapses
// its .1–.4 children); an enchant variant row indents under its base.
function _cpNameTd(item) {
  const isVariant = String(item.id).includes("@");
  const hasVariants = !isVariant && cpHasEnchantVariants(item.id);
  const icon = hasVariants
    ? `<span data-expand-craft="${item.id}" data-expand-table="craft-planner-table" style="cursor:pointer;margin-right:4px;color:#7ab8c4">${(typeof expandedCraftItemsFor === "function" ? expandedCraftItemsFor("craft-planner-table").has(item.id) : (typeof expandedCraftItems !== "undefined" && expandedCraftItems.has(item.id))) ? "▼" : "▶"}</span>`
    : "";
  const style = isVariant ? ' style="padding-left:1.5em;color:#b0b8c4"' : "";
  return `<td class="cell-item"${style}>${icon}${dispName(item.id, item.name)}</td>`;
}

/** Every candidate row for one catalog item. The unit of work of this table. */
function _cpRowsForItem(item, marketData, bmrOn) {
  const materials = getCraftingMaterials(item);
  const specCity = getSpecCraftCity(item.craftType);
  const candidates = getCraftCandidates(specCity, bmrOn);
  // With a City pick active the table prices every row at that city
  // (js/table-sell-city.js). A craft city that cannot reach it has no honest
  // row to show — the Black Market is sellable from Caerleon alone, so a BM
  // pick leaves exactly the Caerleon section, which is where those routes have
  // always lived. Skipped BEFORE the row is computed: this renderer is the
  // app's longest block, and a dropped section is the cheap half of the pass.
  const pick = (typeof getTableSellCity === "function")
    ? getTableSellCity("craft-planner-table") : null;
  const reachable = pick
    ? candidates.filter((cc) =>
      !(typeof isInvalidCrossRoute === "function" && isInvalidCrossRoute(cc, pick)))
    : candidates;
  // Same rule for the Buy City pick, which sources every material for the row
  // (js/table-sell-city.js effectiveBuyCities): a craft city that cannot buy
  // from the pick has no honest row either, and dropping it here saves the
  // pricing pass rather than letting it discover the empty pool per material.
  const buyPick = (typeof getTableBuyCity === "function")
    ? getTableBuyCity("craft-planner-table") : null;
  const sourceable = buyPick
    ? reachable.filter((cc) =>
      typeof isValidSourceCity !== "function" || isValidSourceCity(buyPick, cc))
    : reachable;
  return sourceable.map((cc) => computeCraftPlannerRow(item, materials, marketData, cc));
}

// Per-item rows + the price ids they read, so a captured price recomputes only
// the rows that read it (js/craft-planner-row-cache.js). Null when that file is
// not loaded; the renderers then compute every row, as they always did.
const _cpRowCache = (typeof createPlannerRowCache === "function") ? createPlannerRowCache() : null;

// The row builder for one pass. `itemIds` = the ids a data-refresh pass moved;
// null for a full pass, which also stops the old cache being trusted until this
// pass commits — a full pass that is cancelled must not leave it valid.
function _cpRowBuilder(items, marketData, bmrOn, itemIds) {
  if (!_cpRowCache || typeof plannerRowBuilder !== "function") return null;
  const deferred = typeof isTableDeferred === "function" && isTableDeferred("craft-planner-table");
  const dirtyIds = (Array.isArray(itemIds) && !deferred) ? itemIds : null;
  if (!dirtyIds) _cpRowCache.valid = false;
  return plannerRowBuilder(items, marketData, (item, md) => _cpRowsForItem(item, md, bmrOn), {
    cache: _cpRowCache,
    dirtyIds,
    settings: (typeof plannerSettingsSignature === "function") ? plannerSettingsSignature("craft-planner-table") : "",
  });
}

function renderCraftPlannerTable(marketData) {
  const bmrOn = isBlackRedZoneEnabled();
  const items = expandCraftPlannerItems(CRAFTING_ITEMS);
  const builder = _cpRowBuilder(items, marketData, bmrOn, null);
  if (!builder) {
    const rowData = items.flatMap((item) => _cpRowsForItem(item, marketData, bmrOn));
    _cpPaintRows(dedupeCraftPlannerRows(rowData), marketData);
    return;
  }
  while (!builder.done()) builder.step();
  const result = builder.result();
  _cpPaintRows(dedupeCraftPlannerRows(result.rows), marketData);
  commitPlannerRowCache(_cpRowCache, result);
}

/**
 * The same table, computed in slices with the thread handed back between them.
 *
 * This renderer is the longest single block in the app — 7.1 s measured on a
 * real price map — and My Crafting List pulls it in on every price edit even
 * when the planner itself is collapsed, because a list entry has to show the
 * current number. Splitting it inside the render schedule is not possible: a
 * step is one renderer. So the split happens here, over the item loop, which is
 * a pure map and therefore safe to interrupt.
 *
 * The DOM is touched once at the end, exactly as the synchronous version does,
 * so a half-finished pass never puts half a table on screen.
 *
 * @param {object}   marketData
 * @param {object}   [options]
 * @param {Function} [options.yieldTo]   () => Promise, hands back a frame
 * @param {number}   [options.budgetMs]  work per slice before yielding
 * @param {Function} [options.cancelled] () => boolean, checked between slices
 * @param {Function} [options.paint]     wraps the single DOM write
 * @param {Function} [options.now]
 * @param {string[]|null} [options.itemIds]  ids a data-refresh pass moved: only
 *   the rows that read them are recomputed. Null recomputes every row.
 * @returns {Promise<boolean>} false if it was cancelled before painting
 */
async function renderCraftPlannerTableChunked(marketData, {
  yieldTo = async () => {},
  budgetMs = 100,
  cancelled = () => false,
  paint = (fn) => fn(),
  now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  itemIds = null,
} = {}) {
  const bmrOn = isBlackRedZoneEnabled();
  const items = expandCraftPlannerItems(CRAFTING_ITEMS);
  const builder = _cpRowBuilder(items, marketData, bmrOn, itemIds);

  // Each slice re-enters the table's own spec scope: a yield's withSpecScope
  // finally has already restored the ambient scope, and an unscoped step would
  // price focus at the empty scope's default levels. Guarded like the other
  // optional collaborators above; only the synchronous per-item work is
  // wrapped, never across an await.
  const inScope = (fn) => (typeof withSpecScope === "function")
    ? withSpecScope("craft-planner-table", fn)
    : fn();
  const rowData = [];
  let sliceStart = now();
  for (let i = 0; i < items.length; i++) {
    if (builder) inScope(() => builder.step());
    else rowData.push(...inScope(() => _cpRowsForItem(items[i], marketData, bmrOn)));
    if (now() - sliceStart >= budgetMs && i + 1 < items.length) {
      await yieldTo();
      if (cancelled()) return false;
      sliceStart = now();
    }
  }

  const result = builder ? builder.result() : null;
  paint(() => _cpPaintRows(dedupeCraftPlannerRows(result ? result.rows : rowData), marketData));
  if (result) commitPlannerRowCache(_cpRowCache, result);
  return true;
}

/** The single DOM write, shared by both paths above. */
function _cpPaintRows(rows, marketData) {
  // Reroll EV is a display-side enrichment of the sell leg: it never feeds the
  // row's craft economics, so it is computed here rather than in pricing. It
  // must live on the ROW (not just the cell) because the column is sortable
  // (js/sorting-values-tables.js reads row.rerollEv); dash rows carry null.
  rows.forEach((r) => {
    r.rerollEv = (r.item && r.sellCity && typeof computeRerollEvUplift === "function")
      ? computeRerollEvUplift(r.item.id, r.sellCity) : null;
  });
  renderTableData("craft-planner-table", rows, (row) => {
    const rowKey = getRowKey(row, "craft-planner-table");
    const item = row.item;

    if (row.noData) {
      // Render the materials and sell cells as editable price spans (not dead
      // dashes) so the user can fill in the missing prices that are blanking the
      // row — setting either re-sources/re-renders the row live. Prefer the
      // sourced material lines (clickable @-price spans); fall back to plain
      // names only if sourcing is somehow absent.
      const matsHtml = (row.sourcing && row.sourcing.length)
        ? row.sourcing.map((s) => _cpMatLine(s, row.craftCity)).join("")
        : row.materials.map((m) => `${m.count}x ${getItemDisplayName(m.matId)}`).join("<br>");
      const sell = _cpRowBestSell(item, row.craftCity, marketData);
      const dim = '<td style="color:#6b7280;font-style:italic">—</td>';
      // data-item-id on the ROW, not only inside the cells: a board's "Jump to"
      // aims a crafting play here by item id, and the Materials and Journal
      // cells print item ids of their own — a combine cape's material line is
      // literally another row's id — so a cell-level match can land on the
      // wrong row (jbFindTarget, js/joined-summary-jump.js).
      return `
      <tr data-row-key="${rowKey}" data-item-id="${item.id}">
        ${addTdForKey("craft-planner-table", rowKey)}
        ${_cpNameTd(item)}
        ${routeCityCell([
          // No sell leg: this row has no route yet, and the Sell cell beside it
          // already offers the click that fixes that.
          {
            label: tx("Refine+Craft", "r_refine_craft"),
            city: row.craftCity || "—",
            suffix: getNoSpecLabel(row.craftCity, item.craftType),
          },
        ], { style: "color:#6b7280;font-style:italic" })}
        <td class="cell-mats">${matsHtml}</td>
        ${(typeof aggregateCostTd === "function")
          ? aggregateCostTd(row.refineCraftCost)
          // Cost-carrying no-data rows (all materials priced, no reachable sell
          // — refineCraftCost, js/craft-planner-pricing.js) render the same
          // read-only aggregate cell the priced rows do; aggregateCostTd falls
          // back to this dash when the figure is missing (missing-material
          // rows carry none), so the two no-data kinds stay distinguishable.
          : dim}
      ${priceTd(sell.price, item.id, sell.city, "sell", "silver-val", false, null, false,
        _cpSellPinNote(row.sellPinDropped, row.craftCity, row.sellPinFilteredTo) + _cpNoSellRefsNote(row.noSellRefs))}
        ${rerollEvCell(item.id, sell.city)}
        ${dim}${dim}${dim}${dim}${dim}
      </tr>`;
    }

    // An enchanted-via-station row buys two things (the @(n-1) base + the
    // enchant mat) instead of its craft material list — see _cpEnchantViaCell.
    const matsHtml = row.enchantedVia
      ? _cpEnchantViaCell(row)
      : row.sourcing.map((s) => _cpMatLine(s, row.craftCity)).join("");

    const margin = row.refineCraftCost > 0 ? (row.combinedProfit / row.refineCraftCost) * 100 : 0;
    const combinedClass = getProfitClass(margin);

    // Profit breakout: refining profit is folded into the craft cost, so split the
    // combined figure into pure-craft (buy the bars) + refining + journal so the
    // user sees where each silver comes from. pureCraft = craftProfit − refineSavings.
    const refineProfit = row.refineSavings > 0 ? row.refineSavings : 0;
    const pureCraft = row.craftProfit - refineProfit;
    const journalExtra = row.journal ? (row.journal.extraSilverPerCraft || 0) : 0;
    const parts = [`craft ${formatSilver(pureCraft)}`];
    if (refineProfit > 0.5) parts.push(`refine ${formatSilver(refineProfit)}`);
    if (journalExtra > 0.5) parts.push(`journal ${formatSilver(journalExtra)}`);
    const profitBreakout = parts.length > 1
      ? `<br><small style="color:#9ca3af" title="Combined = pure craft profit (buying refined bars) + refining profit (folded into the lower material cost) + journal fill">= ${parts.join(" + ")}</small>`
      : "";

    // The self-gathered twin (plan.md, row.selfFoundProfit from
    // js/craft-planner-pricing.js): the same craft with every gatherable input
    // at zero, dimmed under the combined headline with its own tooltip — the
    // same slug the pureProfitTd cells use. This cell is inline (the headline
    // is the COMBINED figure with the breakout above), so the line is built
    // here instead; guarded so a sandbox that lifts this renderer without
    // js/self-found-profit.js renders byte-identical to before.
    const selfFoundLine = (typeof selfFoundSmallHtml === "function"
        && typeof row.selfFoundProfit === "number" && isFinite(row.selfFoundProfit))
      ? selfFoundSmallHtml(row.selfFoundProfit,
          tx("Same craft, materials self-gathered (inputs at zero cost, fees and taxes kept): sell × (1 − market tax) − kept silver = {value}", "r_selffound_tip")
            .replace("{value}", formatSilver(row.selfFoundProfit)))
      : "";

    // Cost cell = refine+craft input cost. Refining savings are surfaced in the
    // Profit breakout (= craft + refine + journal), so no sub-line here. Read
    // only — it is a sum, so no single per-unit override inverts it; the
    // editable per-unit cells are in the Materials column (aggregateCostTd).
    const costCell = aggregateCostTd(row.refineCraftCost);

    return `
    <tr data-row-key="${rowKey}" data-item-id="${item.id}">
      ${addTdForKey("craft-planner-table", rowKey)}
      ${_cpNameTd(item)}
      ${routeCityCell([
        { city: row.craftCity, suffix: getNoSpecLabel(row.craftCity, item.craftType) },
        { city: row.sellCity, itemId: item.id, side: "sell", price: row.sellPrice, quality: row.sellQuality > 1 ? row.sellQuality : null },
      ], { trailing: brecilienFeeBadge(row.brecilienFee) })}
      <td class="cell-mats">${matsHtml}</td>
      ${costCell}
      ${priceTd(row.sellPrice, item.id, row.sellCity, "sell", "silver-val", false, row.sellQuality > 1 ? row.sellQuality : null, false,
        _cpSellPinNote(row.sellPinDropped, row.craftCity, row.sellPinFilteredTo) + _cpSellQualityNote(row.sellQuality))}
      ${rerollEvCell(item.id, row.sellCity)}
      <td class="silver-val cell-note ${combinedClass}">${formatSilver(row.combinedProfit)}${profitBreakout}${selfFoundLine}</td>
      <td class="silver-val cell-note">${_cpJournalCell(row)}</td>
      <td class="silver-val cell-note">${_cpLaborerJournalCell(row)}</td>
      ${_cpPer10kCell(row)}
      <td class="cell-note">${_cpFocusCell(row.bestFocusStep, row.focusPerCraft)}</td>
    </tr>`;
  });
}

// Map a journal slug to its in-game crafting profession name (EN-US item names):
// WARRIOR → Blacksmith, HUNTER → Fletcher, MAGE → Imbuer, TOOLMAKER → Tinker.
const _CP_JOURNAL_PROFESSION = {
  WARRIOR: "Blacksmith", HUNTER: "Fletcher", MAGE: "Imbuer", TOOLMAKER: "Tinker",
};
function _cpTitleCase(s) {
  if (!s) return "";
  return _CP_JOURNAL_PROFESSION[s] || (s.charAt(0) + s.slice(1).toLowerCase());
}

// ─── Jump-to-refining click handler (idempotent module-init) ────────────────
// Clicking a refine tag in the Materials column, or a refine step in the Best
// Focus column, scrolls the Refining / Transports table to that material's row
// and pulses it — the same scroll+highlight UX the joined-summary "Jump to"
// links use. Matches the transport row by the refined-id segment of its
// data-row-key (rawId|refinedId|refineCity|variant), so it lands on whichever
// refine city / chain-vs-direct variant renders first for that material.
(function _initCpRefineJump() {
  if (typeof document === "undefined") return;
  if (document._cpRefineJumpInit) return;
  document._cpRefineJumpInit = true;
  document.addEventListener("click", (e) => {
    const el = e.target.closest(".cp-refine-jump");
    if (!el) return;
    e.preventDefault();
    const refinedId = el.getAttribute("data-refined-id");
    if (!refinedId) return;

    const tbl = document.getElementById("transport-table");
    if (!tbl) return;

    // Expand the Refining section if it's collapsed (re-uses the h2 toggle).
    if (tbl.style.display === "none" ||
        (tbl.parentElement && tbl.parentElement.style.display === "none")) {
      const h2s = [...document.querySelectorAll("h2")];
      const owner = h2s.find((h) => {
        let s = h.nextElementSibling;
        while (s) {
          if (s === tbl || s.querySelector?.("#transport-table")) return true;
          s = s.nextElementSibling;
        }
        return false;
      });
      if (owner) owner.click();
    }

    // Scroll the matching refined row into view (or the table top if no row for
    // this material rendered — e.g. only the planner was scanned). Pulse it green.
    setTimeout(() => {
      const rows = [...tbl.querySelectorAll("tr[data-row-key]")];
      const target = rows.find(
        (r) => (r.getAttribute("data-row-key") || "").split("|")[1] === refinedId,
      );
      (target || tbl).scrollIntoView({ behavior: "smooth", block: "center" });
      if (target) {
        target.style.outline = "2px solid #5e9e78";
        setTimeout(() => { target.style.outline = ""; }, 1800);
      }
    }, 60);
  });
})();
