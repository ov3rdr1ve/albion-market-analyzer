/**
 * Crafted faction capes as Faction Spending rows.
 *
 * Every crest row in the table has a crafted counterpart: the faction cape you
 * make from that crest at the cape station (recipe: base cape + crest + faction
 * hearts / tokens — js/gear-capes.js). Crafting CONSUMES the crest, so the cape
 * row spends the crest's currency: FP for the royal-city ladders, Favor for the
 * Avalon / Smuggler / Demon / Brecilien crests. Its net silver is the cape sale
 * after market fees minus the market cost of the other recipe inputs, which
 * puts "sell the crest raw" and "craft it into a cape" side by side in the same
 * silver-per-FP (or per-Favor) sort.
 *
 *   S/FP(cape) = (capeSale × (1 − fees) − Σ inputCost) / (crestFpCost + heartsFp)
 *
 * The note lists all three recipe materials — base cape, crest, hearts/tokens —
 * but the crest AND the royal city hearts are shown with their currency price
 * ("1× Adept's Lymhurst Crest (400 FP)", "1× T1_FACTION_FOREST_TOKEN_1
 * (3,000 FP)") rather than a buy city: both are Faction-Point purchases
 * (js/data-faction-fp-costs.js), the denominator above and not part of
 * Σ inputCost. Charging them in silver too would double-count them. The
 * Favor families' Mists/Avalon quest tokens carry no FACTION_FP_COSTS entry —
 * they stay silver market buys like the base cape.
 *
 * A missing SILVER input price never inflates the net silently: the row is
 * flagged inputsKnown=false and its note warns that inputs are incomplete
 * (same contract as the Favor mount rows). FP-priced mats need no market price
 * and never flip the flag.
 *
 * Row shape mirrors buildFactionSpendRow / _baseFavorRow so the shared
 * Faction Spending renderer lays them in without changes: breed + focus
 * columns render "—" and the faction dropdown filters capes like their crests
 * (royal capes via getItemFaction, Favor capes via favorFaction).
 *
 * Data + pure math: recipes from GEAR_CAPES, crest costs from
 * FACTION_FP_COSTS / FAVOR_CREST_FAMILIES (js/data-favor-costs.js).
 */

// Royal cities whose crests sit on the FP ladder — same set as the crest rows
// (render-faction-spending.js). Brecilien is a Favor vendor, not FP.
const FACTION_CAPE_ROYAL_CITIES = ["THETFORD", "LYMHURST", "BRIDGEWATCH", "FORTSTERLING", "MARTLOCK"];

// "T4_CAPEITEM_FW_LYMHURST" → "T4_CAPEITEM_FW_LYMHURST_BP"
function _capeCrestId(capeId) {
  return capeId + "_BP";
}

function _capeRecipe(capeId) {
  if (typeof GEAR_CAPES === "undefined" || !Array.isArray(GEAR_CAPES)) return null;
  return GEAR_CAPES.find((r) => r && r.id === capeId) || null;
}

// Every item id the Faction Spending scan must price so the crafted-cape rows
// compute: the 45 capes plus every non-crest recipe mat (base capes, faction
// hearts, Mists/Avalon tokens). Crest ids are already in the scan (they're
// spendable rows themselves), so they're not duplicated here.
function getFactionCapeCraftIds() {
  const ids = new Set();
  FACTION_CAPE_ROYAL_CITIES.forEach((c) => {
    for (let t = 4; t <= 8; t++) ids.add(`T${t}_CAPEITEM_FW_${c}`);
  });
  if (typeof FAVOR_CREST_FAMILIES !== "undefined") {
    FAVOR_CREST_FAMILIES.forEach((fam) => {
      for (let t = 4; t <= 8; t++) ids.add(`T${t}_${fam.idStem}`);
    });
  }
  Array.from(ids).forEach((capeId) => {
    const recipe = _capeRecipe(capeId);
    if (!recipe) return;
    const crestId = _capeCrestId(capeId);
    recipe.materials.forEach((m) => {
      if (m.matId && m.matId !== crestId) ids.add(m.matId);
    });
  });
  return Array.from(ids);
}

// Cheapest acquisition cost for a craft input across every city — the ask under
// Instant, a buy order under Market Orders (getBuyPrice). Overrides are
// consulted even when the item has no market data at all, mirroring
// _favorCheapestBuyCity (js/render-favor-spending.js), so a hand-priced input
// never silently vanishes from the net. Returns { price, city }.
function _capeCheapestBuy(marketData, itemId) {
  const cities = (typeof CITIES !== "undefined") ? CITIES : [];
  const data = (marketData && marketData[itemId]) || null;
  let bestPrice = 0, bestCity = "";
  cities.forEach((c) => {
    const ov = (typeof getOverridePrice === "function") ? getOverridePrice(itemId, c) : null;
    const p = (ov !== null && ov > 0) ? ov : (data ? getBuyPrice(data, c, null, itemId) : 0);
    if (p > 0 && (bestPrice === 0 || p < bestPrice)) { bestPrice = p; bestCity = c; }
  });
  return { price: bestPrice, city: bestCity };
}

function _capeDisplayName(capeId, recipe) {
  if (typeof ITEM_NAMES_MAP !== "undefined" && ITEM_NAMES_MAP[capeId]) return ITEM_NAMES_MAP[capeId];
  if (typeof getItemDisplayName === "function") return getItemDisplayName(capeId);
  return (recipe && recipe.name) || capeId;
}

// Sum the market cost of a cape's silver inputs. Returns
// { inputCost, inputsKnown, partsHtml, silverMats, fpExtra } — partsHtml names
// each input and its buy city for the row note (cheapest city per input,
// override-aware). silverMats carries those same inputs as structured shopping
// lines ({ matId, count, city, perUnit }), priced by the very cheapest-buy
// lookups that produced inputCost — so the lines always sum back to inputCost
// exactly. An unpriced input is excluded from inputCost, so it is excluded
// here too (same contract, no invented pricing).
//
// Currency-purchased mats never enter either: the crest (_BP) is paid in
// FP / Favor (its cost is the caller's crestLabel), and any other mat with a
// FACTION_FP_COSTS entry — the royal city-heart fragments — is a Faction-Point
// purchase too. Both are listed in partsHtml with their currency price
// instead of a buy city (exactly like the crest annotation) and stay out of
// inputCost / inputsKnown: the row already pays for them in the currency that
// divides the net (see the header). Their FP cost is returned as fpExtra
// (Σ count × getFpCost, crest excluded) so the royal caller can fold it into
// the row's fpCost denominator.
function _capeInputCost(marketData, capeId, crestLabel) {
  const recipe = _capeRecipe(capeId);
  const crestId = _capeCrestId(capeId);
  let inputCost = 0;
  let inputsKnown = true;
  let fpExtra = 0;
  const parts = [];
  const silverMats = [];
  (recipe ? recipe.materials : []).forEach((m) => {
    if (!m.matId) return;
    if (m.matId === crestId) {
      const crestName = (typeof getItemDisplayName === "function")
        ? getItemDisplayName(crestId) : crestId;
      parts.push(`${m.count || 1}× ${crestName}${crestLabel ? ` (${crestLabel})` : ""}`);
      return;
    }
    const fp = (typeof getFpCost === "function") ? getFpCost(m.matId) : 0;
    if (fp > 0) {
      const fmt = (typeof formatSilver === "function") ? formatSilver : (n) => String(n);
      parts.push(`${m.count || 1}× ${m.matId} (${fmt(fp)} FP)`);
      fpExtra += (m.count || 1) * fp;
      return;
    }
    const { price, city } = _capeCheapestBuy(marketData, m.matId);
    if (price > 0) {
      inputCost += price * (m.count || 1);
      silverMats.push({ matId: m.matId, count: m.count || 1, city, perUnit: price });
      const name = (typeof getItemDisplayName === "function")
        ? getItemDisplayName(m.matId) : m.matId;
      parts.push(`${m.count || 1}× ${name} @ ${city || "?"}`);
    } else {
      inputsKnown = false;
    }
  });
  return { inputCost, inputsKnown, partsHtml: parts.join(", "), silverMats, fpExtra };
}

// Shared cape-row skeleton: best reachable sale minus craft inputs. Currency
// fields (fpCost / favorCost, silverPerFp / silverPerFavor) are filled by the
// royal / favor callers below.
function _buildCapeCraftRow(capeId, marketData, routeOrigin, crestLabel) {
  const recipe = _capeRecipe(capeId);
  if (!recipe) return null;
  const cities = (typeof CITIES !== "undefined") ? CITIES : [];

  const best = (typeof findBestSellCity === "function")
    ? findBestSellCity(marketData, capeId, cities, 0, routeOrigin)
    : { city: null, price: 0 };
  const gross = (best.city && best.price > 0) ? best.price : 0;
  const netSale = (typeof netSilverAfterFees === "function")
    ? netSilverAfterFees(gross, true) : gross;
  const { inputCost, inputsKnown, partsHtml, silverMats, fpExtra } =
    _capeInputCost(marketData, capeId, crestLabel);

  // No sale price → no basis for a net (a negative "net" of pure input cost
  // would sort the row above genuinely priced rows by accident).
  const net = gross > 0 ? netSale - inputCost : 0;

  const warn = inputsKnown
    ? ""
    : `${tx("⚠ inputs incomplete — click the missing input price to set it", "r_cape_inputs_incomplete")}. `;
  const craftPrefix = tx("crafted:", "r_cape_crafted_prefix");
  const note = inputsKnown
    ? `${craftPrefix} −${partsHtml}`
    : `${warn}${craftPrefix} −${partsHtml}`;

  return {
    itemId: capeId,
    name: _capeDisplayName(capeId, recipe),
    category: "",
    currency: "FP",
    favorFaction: "Energy Manipulator",
    sellCity: (best.city && gross > 0) ? best.city : "",
    sellPrice: gross,
    netSilver: net,
    fpCost: 0,
    silverPerFp: 0,
    favorCost: 0,
    silverPerFavor: 0,
    metric: "silver",
    fameValue: 0,
    famePerFavor: 0,
    breedSilverPerFp: 0,
    breedSilverPerFavor: 0,
    breedData: null,
    dailyVol: (gross > 0 && best.city && marketData[capeId] && marketData[capeId][best.city])
      ? (marketData[capeId][best.city].volume_24h || 0) : 0,
    note,
    tradeable: true,
    inputCost,
    inputsKnown,
    // The recipe's non-silver FP inputs beyond the crest (Σ count × getFpCost
    // — the royal city hearts). The royal caller folds it into row.fpCost; the
    // Favor caller ignores it (quest tokens carry no FACTION_FP_COSTS entry,
    // so it is always 0 there).
    fpExtra,
    // The row's silver-market recipe inputs (base cape + non-FP tokens — never
    // the crest or the FP-purchased hearts), priced at the same cheapest buys
    // as inputCost. The My Crafting List's faction extractor shops these lines;
    // rows without a recipe (or with every input unpriced) carry an empty
    // array and stay in the list's legacy zero-cost shape.
    silverMats,
  };
}

/**
 * Build every crafted-cape row for the Faction Spending table.
 * Returns { fpRows, favorRows } — the caller splices them in next to their
 * crest rows' currency sections (FP after the crest loop, Favor after the
 * Favor rows) so the single silver-per-currency sort ranks them together.
 */
function buildFactionCapeCraftRows(marketData) {
  const fpRows = [];
  const favorRows = [];
  if (!marketData) return { fpRows, favorRows };

  // Currency price printed next to the crest in the row note ("400 FP").
  const fmt = (typeof formatSilver === "function") ? formatSilver : (n) => String(n);

  // Royal capes — route origin is the cape's faction city, so the sale city
  // respects the Black/Red Zone Routes toggle exactly like the crest rows.
  FACTION_CAPE_ROYAL_CITIES.forEach((city) => {
    for (let t = 4; t <= 8; t++) {
      const capeId = `T${t}_CAPEITEM_FW_${city}`;
      const fpCost = (typeof getFpCost === "function") ? getFpCost(_capeCrestId(capeId)) : 0;
      if (fpCost <= 0) continue;
      const row = _buildCapeCraftRow(capeId, marketData,
        (typeof getItemFaction === "function") ? getItemFaction(capeId) : null,
        `${fmt(fpCost)} ${tx("FP", "r_cape_crest_fp_unit")}`);
      if (!row) continue;
      row.currency = "FP";
      row.category = `Cape T${t}`;
      // The city hearts the recipe consumes are Faction-Point purchases too
      // (js/data-faction-fp-costs.js) — fold their cost into the denominator
      // so "craft the crest into a cape" sorts against "sell the crest raw"
      // at its true FP price.
      row.fpCost = fpCost + (row.fpExtra || 0);
      row.silverPerFp = (typeof calculateSilverPerFp === "function")
        ? calculateSilverPerFp(row.netSilver, row.fpCost) : 0;
      fpRows.push(row);
    }
  });

  // Favor capes — the crest vendors (Mattina / Maggy Slade / Antiquarian /
  // Eralia Wayfarer) stand in every Royal City + Brecilien, so like the Favor
  // crest rows the route origin anchors to a royal city (see
  // render-favor-spending.js) and the vendor group comes from the family.
  if (typeof FAVOR_CREST_FAMILIES !== "undefined") {
    const favorOrigin = (typeof ROYAL_CITIES !== "undefined" && ROYAL_CITIES[0]) || "Thetford";
    FAVOR_CREST_FAMILIES.forEach((fam) => {
      for (let t = 4; t <= 8; t++) {
        const capeId = `T${t}_${fam.idStem}`;
        const favorCost = (typeof getFamilyCrestFavorCost === "function")
          ? getFamilyCrestFavorCost(fam, t) : 0;
        if (favorCost <= 0) continue;
        const row = _buildCapeCraftRow(capeId, marketData, favorOrigin,
          `${fmt(favorCost)} ${tx("Favor", "r_cape_crest_favor_unit")}`);
        if (!row) continue;
        row.currency = "Favor";
        row.category = fam.category.replace("Crest", "Cape");
        row.favorFaction = fam.faction || "Energy Manipulator";
        row.favorCost = favorCost;
        row.silverPerFavor = (typeof calculateSilverPerFavor === "function")
          ? calculateSilverPerFavor(row.netSilver, favorCost) : 0;
        favorRows.push(row);
      }
    });
  }

  return { fpRows, favorRows };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    FACTION_CAPE_ROYAL_CITIES,
    getFactionCapeCraftIds,
    buildFactionCapeCraftRows,
  };
}
