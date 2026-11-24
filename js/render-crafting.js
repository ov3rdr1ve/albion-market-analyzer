// Flat recipe silver (craftable maps) with the live Global Discount applied.
// No-op where the module isn't loaded, as in the Node test sandboxes.
function _craftRecipeSilver(silver) {
  return typeof applyGlobalDiscount === "function" ? applyGlobalDiscount(silver) : silver;
}

// The self-found pure-profit twin (js/self-found-profit.js); Node sandboxes that compile this renderer alone use the same live-getter formula.
const _craftSelfFoundTwin = (sellPrice, keptSilver) => typeof selfFoundProfit === "function" ? selfFoundProfit(sellPrice, keptSilver) : sellPrice * (1 - PREMIUM_TAX) - keptSilver;

function getCraftSpecLabel(city, craftType) {
  if (!craftType) return "";
  const specs = CITY_CRAFT_SPEC[city];
  return specs && specs.includes(craftType) ? " ★ spec" : "";
}

function getSpecCraftCity(craftType) {
  if (!craftType) return null;
  for (const [city, types] of Object.entries(CITY_CRAFT_SPEC)) {
    if (types.includes(craftType)) return city;
  }
  return null;
}

// Inverse of the spec marker: when a craft type HAS a spec city but we're
// crafting somewhere else — e.g. a Caerleon-spec staff built in a royal city
// because red-zone routes are off — flag that only base RRR applies and the
// displayed city is an arbitrary pick among equals. Mirrors the consumables
// table's "(no spec)" tag. Returns "" for items with no spec city, and for the
// spec city itself (where the bonus does apply).
function getNoSpecLabel(craftCity, craftType) {
  const specCity = getSpecCraftCity(craftType);
  if (!specCity || specCity === craftCity) return "";
  const caerleonNote = specCity === "Caerleon" ? ", " + tx("unreachable with red-zone routes off", "r_unreachable_red_zone") : "";
  return ` <small style="color:#fbbf24" title="${tx("No {type} spec in {city} — base RRR only. {specCity} is the spec city{note}.", "r_no_spec_craft_tip").replace("{type}", craftType).replace("{city}", craftCity).replace("{specCity}", specCity).replace("{note}", caerleonNote)}">${tx("(no spec)", "r_no_spec")}</small>`;
}

// Candidate craft cities for an item.
//
// Caerleon is ALWAYS a candidate: the Caerleon→Caerleon (and Caerleon→Black
// Market) route is self-contained and never crosses a red zone, so it stays
// valid even with Black/Red Zone Routes off — isInvalidCrossRoute drops only the
// cross-zone (royal↔Caerleon) SELL legs. Brecilien is excluded for non-spec
// items: its only difference from a royal craft is the Travel Planner exit fee,
// so it is never uniquely better — only an inferior duplicate.
//
// The one toggle-dependent case is a CAERLEON-spec craft (shapeshifter staves,
// war gloves, gathering gear, tools, food). With routes ON, crafting in Caerleon
// with the spec bonus and hauling out dominates the spec-less royal craft, so we
// list Caerleon only. With routes OFF, royal-based players can't reach Caerleon,
// so we ALSO list the royals (base RRR) while keeping Caerleon for players who
// stay in it — the table then shows a royal row and a Caerleon→Caerleon row.
function getCraftCandidates(specCity, bmrOn) {
  const royals = ROYAL_CITIES.filter((c) => c !== "Brecilien");
  if (specCity === "Caerleon") return bmrOn ? ["Caerleon"] : [...royals, "Caerleon"];
  if (specCity) return [specCity, "Caerleon"];
  return [...royals, "Caerleon"];
}

// Markets `craftCity` may buy its materials in, narrowed to the table's Buy City
// pick (js/table-sell-city.js). No pick = every zone-valid city, as before.
function craftBuyCities(craftCity) {
  const sourceable = CITIES.filter((c) => isValidSourceCity(c, craftCity));
  return typeof effectiveBuyCities === "function"
    ? effectiveBuyCities("crafting-table", craftCity, sourceable) : sourceable;
}

/**
 * Returns the crafting recipe for an item as [{matId, count}].
 *
 * BUNDLED_RECIPES is the source of truth; recipeCache is only ever a copy of it
 * (gameinfo.albiononline.com has been CORS-blocked for every origin — see
 * fetchCraftingRecipe in js/api.js). Resolution lives in js/recipe-resolver.js
 * so a boot render with an empty cache cannot fall through to the
 * single-material fallback and drop half a furniture recipe.
 */
function getCraftingMaterials(item) {
  if (typeof resolveItemRecipe === "function") return resolveItemRecipe(item);
  // Sandbox without the resolver (some Node tests compile a subset of js/).
  const recipe = recipeCache[item.id];
  if (recipe && recipe.length > 0) return recipe;
  if (item.materials && item.materials.length > 0) return item.materials;
  return [{ matId: item.matId, count: item.matCount }];
}

// Cheapest zone-valid buy source for a material, mirroring the sourcing scan in
// computeCraftRoutesForCity. Used by the no-data placeholder row so that a
// recipe blocked by ONE unpriced input (e.g. a thinly-traded faction token /
// crest that momentarily has no listing in any valid city) still shows the
// REAL price + source city for every other material, instead of collapsing them
// all to "no data" just because the single craft city lacks a listing. Returns
// { price:0, city:null } only for a material that is genuinely unpriced in every
// zone-valid city — the actual blocker the user must override.
function bestMatBuySource(matId, craftCity, marketData) {
  // The pool is zone-valid AND honours the Buy City pick, which outranks a pin.
  const pool = craftBuyCities(craftCity);
  const forced = getCityForce(matId, "buy");
  if (forced && pool.includes(forced)) {
    const p = getBuyPrice(marketData[matId], forced, null, matId);
    return { price: p > 0 ? p : 0, city: p > 0 ? forced : null };
  }
  const bounds = getIQRBounds(marketData[matId]);
  let bestPrice = 0;
  let bestCity = null;
  pool.forEach((city) => {
    const p = getBuyPrice(marketData[matId], city, bounds, matId);
    if (p > 0 && (bestCity === null || p < bestPrice)) {
      bestPrice = p;
      bestCity = city;
    }
  });
  return { price: bestCity ? bestPrice : 0, city: bestCity };
}

// The per-craft-city loop in renderCraftingTable emits one row per candidate
// craft city. For a non-specialized item every Royal craft city is
// interchangeable (identical RRR + material sourcing), so those rows are just
// duplicates of one economic route. When the craft is PROFITABLE they converge
// on the same best sell city and an exact-signature filter collapsed them — but
// when it was UNPROFITABLE a since-removed `margin > 0 || sc === craftCity` gate
// in computeCraftRoutesForCity dropped every cross-city sell, pinning each craft
// city to its own LOCAL sell at a different price. Those rows no longer shared a
// (sellCity, price) signature, so the old filter let all five through: one item,
// five near-identical rows differing only by which city you happened to craft
// and sell in (the reported duplicate-route bug).
//
// Collapse to the single most-profitable row per (item, zone section): the best
// Royal route survives, and separately the Caerleon route (whose self-contained
// sell / Black-Market options can genuinely differ). Real rows always beat the
// no-data placeholder; among real rows the higher margin wins. On a margin TIE
// — which is exactly the non-specialized case where every Royal craft city is
// economically interchangeable (identical RRR + sourcing, free royal↔royal haul)
// — prefer the row that crafts in the city it sells in, so the displayed advice
// avoids a pointless finished-good haul. When the best sell city isn't a Royal
// craft candidate (Black Market / Caerleon) no row is "local", so the tie falls
// back to the first-seen craft city for stable ordering.
function dedupeCraftingRows(rowData) {
  const isNoData = (row) => row.marginInfo && row.marginInfo.margin === -1;
  const sellsWhereCrafted = (row) =>
    !!(row.sellGear && row.craftCity && row.sellGear.city === row.craftCity);
  const best = new Map();
  rowData.forEach((row) => {
    const key = `${row.item.id}|${row.section}`;
    const cur = best.get(key);
    if (!cur) {
      best.set(key, row);
      return;
    }
    const curNo = isNoData(cur);
    const rowNo = isNoData(row);
    if (curNo && !rowNo) {
      best.set(key, row); // a real route always beats a no-data placeholder
    } else if (!curNo && !rowNo) {
      if (row.marginInfo.margin > cur.marginInfo.margin) {
        best.set(key, row); // strictly higher margin wins
      } else if (
        row.marginInfo.margin === cur.marginInfo.margin &&
        sellsWhereCrafted(row) && !sellsWhereCrafted(cur)
      ) {
        best.set(key, row); // tie → craft where you sell (no haul); else first-seen
      }
    }
  });
  const keep = new Set(best.values());
  return rowData.filter((row) => keep.has(row));
}

function computeCraftRoutesForCity(
  craftCity,
  item,
  materials,
  marketData,
  forceFocus = false,
) {
  // Crafting rows are always-visible valuations: every recipe gets a row (even
  // a no-data placeholder the user can click to price). Thinly-traded outputs
  // and materials — city-faction capes, artifact crests, faction tokens — trade
  // far below the per-order volume gate (25/24h) yet carry real standing orders,
  // so gating on volume wrongly collapsed those rows to "no data". Like the
  // mounts table (MOUNT_MIN_VOLUME), crafting valuations are NOT volume-gated:
  // getBuyPrice/getSellPrice still apply IQR outlier rejection and the Vol/24h
  // column surfaces the thin liquidity. See tests/crafting-thin-volume-gate.
  const MIN_VOLUME = 0;
  // Only honor the "Use Focus" toggle when the item is actually focus-craftable
  // (items.xml craftingfocus > 0 ⇒ focusCost > 0). Without this guard, items
  // missing the attribute would silently get the +59% focus RRR even though
  // the game wouldn't grant it.
  const craftFocusCost = (typeof getFocusCost === "function")
    ? getFocusCost(item.id, getTierFromId(item.id)) : 0;
  // forceFocus pins this evaluation to focus-on regardless of the checkbox — used
  // to build the focus-on Silver/Focus benchmark (see renderCraftingTable). The
  // benchmark must not move when the checkbox flips the winning route (the
  // `margin > 0` gate can drop the best sell city under focus-off costs).
  const effectiveFocusOn = (forceFocus || isFocusEnabled()) && craftFocusCost > 0;
  const rrr = item.noReturn ? 0 : getCraftRRR(craftCity, item.craftType, effectiveFocusOn);
  const gearBounds = getIQRBounds(marketData[item.id]);

  const matBestPrices = {};
  let allAvailable = true;
  // Zone-valid buy markets, narrowed to the Buy City pick while one is active.
  const buyPool = craftBuyCities(craftCity);
  materials.forEach((m) => {
    // Cheapest city for one candidate id, or null when it can't be sourced.
    const sourceCandidate = (candId) => {
      const bounds = getIQRBounds(marketData[candId]);
      const forcedBuyCity = getCityForce(candId, "buy");
      // Only honor a forced material buy city the pool allows: zone-compatible
      // with the craft city (BMR off splits royal/Caerleon — a Lymhurst force
      // must not reach the Caerleon-craft row), and never over an active pick.
      if (forcedBuyCity && buyPool.includes(forcedBuyCity)) {
        const p = getBuyPrice(marketData[candId], forcedBuyCity, bounds, candId);
        return p > 0 ? { id: candId, price: p, city: forcedBuyCity, eff: p, forcedDead: false }
                     : { id: candId, price: 0, city: forcedBuyCity, eff: Infinity, forcedDead: true };
      }
      let best = null;
      buyPool.forEach((city) => {
        const p = getBuyPrice(marketData[candId], city, bounds, candId);
        const v = marketData[candId]?.[city]?.volume_24h || 0;
        if (p > 0 && (v >= MIN_VOLUME || getOverridePrice(candId, city) !== null)) {
          // Rank by effective cost: a mat sourced in Brecilien but consumed in
          // another craft city pays the Travel Planner fee to haul it out.
          const exit = (typeof legBrecilienCost === "function")
            ? legBrecilienCost(city, craftCity, candId, 1) : 0;
          const eff = p + exit;
          if (!best || eff < best.eff) best = { id: candId, price: p, city, eff, forcedDead: false };
        }
      });
      return best;
    };

    // An artifact slot also accepts a Crystallized token of the same tier — same
    // recipe, same focus — so price both and buy whichever is cheaper.
    const candidates = (typeof getCraftMatCandidates === "function")
      ? getCraftMatCandidates(m.matId) : [m.matId];
    const primary = sourceCandidate(m.matId);
    let best = primary;
    // A dead forced buy city on the material itself still kills the row: the
    // force means "source it here", not "source it anywhere else".
    if (!primary || !primary.forcedDead) {
      candidates.slice(1).forEach((candId) => {
        const alt = sourceCandidate(candId);
        if (alt && !alt.forcedDead && (!best || best.forcedDead || alt.eff < best.eff)) best = alt;
      });
    }
    if (!best || best.forcedDead) allAvailable = false;
    matBestPrices[m.matId] = {
      id: best ? best.id : m.matId,
      price: best && !best.forcedDead ? best.price : 0,
      city: best ? best.city : null,
    };
  });

  if (!allAvailable) return [];

  let totalInputCost = 0;
  let nonArtifactMatCount = 0;
  // gatheredMats prices the GATHERABLE ingredients exactly as the loop books
  // them into totalInputCost — the self-found twin subtracts it back out.
  let brecilienMatFee = 0, gatheredMats = 0;
  materials.forEach((m) => {
    const isArtifact = isNonReturnableCraftMat(m.matId);
    const effectiveCount = isArtifact ? m.count : m.count * (1 - rrr);
    totalInputCost +=
      matBestPrices[m.matId].price * effectiveCount * (1 + SETUP_FEE);
    // Travel Planner fee for hauling this mat out of Brecilien to the craft
    // city (0 unless its buy city is Brecilien and craftCity differs).
    if (typeof legBrecilienCost === "function") {
      const matFee = legBrecilienCost(matBestPrices[m.matId].city, craftCity, matBestPrices[m.matId].id, effectiveCount);
      totalInputCost += matFee;
      brecilienMatFee += matFee;
    }
    if (!isArtifact) { nonArtifactMatCount += m.count; gatheredMats += matBestPrices[m.matId].price * effectiveCount * (1 + SETUP_FEE); }
  });
  totalInputCost += calcStationFeeSilver(getTierFromId(item.id), nonArtifactMatCount, item.nutritionPerCraft);
  if (item.silverCost) totalInputCost += _craftRecipeSilver(item.silverCost);

  const validRoutes = [];

  // The crafting table renders each item in two independent zone sections
  // (Caerleon-craft and royal-craft), but the sell-city force is a single
  // global per item. Honoring a force the craft city can't haul to (e.g. a
  // royal sell forced from the royal section, then seen by the Caerleon
  // section) collapses the OTHER section to a dead no-data row instead of its
  // real best route — typically Caerleon → Black Market. Only pin to the forced
  // city when it's reachable from this craft city; otherwise fall back to the
  // full search. Mirrors the zone gate already used by the mount material buy
  // loop (render-mounts.js / tests/city-force-respected).
  // An active City pick outranks that force: it re-prices (js/table-sell-city.js).
  const forcedSellCity = getCityForce(item.id, "sell");
  const forceReachable = forcedSellCity && !isInvalidCrossRoute(craftCity, forcedSellCity);
  const sellCitiesToSearch = (typeof effectiveSellCities === "function")
    ? effectiveSellCities("crafting-table", craftCity, forceReachable ? forcedSellCity : null, SELL_CITIES)
    : (forceReachable ? [forcedSellCity] : SELL_CITIES);
  sellCitiesToSearch.forEach((sc) => {
    if (!isInvalidCrossRoute(craftCity, sc)) {
      const sPrice = getSellPrice(marketData[item.id], sc, gearBounds, item.id);
      const sVol = marketData[item.id]?.[sc]?.volume_24h || 0;
      if (
        sPrice > 0 &&
        (sVol >= MIN_VOLUME || getOverridePrice(item.id, sc) !== null)
      ) {
        // Crafting capes/bags/potions in Brecilien (its spec) and selling
        // elsewhere hauls the finished item out → Travel Planner fee. Selling
        // in Brecilien itself is free, so this favours it where it wins.
        const productTravel = (typeof legBrecilienCost === "function")
          ? legBrecilienCost(craftCity, sc, item.id, 1) : 0;
        const routeCost = totalInputCost + productTravel;
        const gearRevenue = sPrice * (1 - PREMIUM_TAX);
        const profit = gearRevenue - routeCost;
        const margin = routeCost > 0 ? (profit / routeCost) * 100 : 0;

        // Every priced sell is a route, profitable or not. The callers read
        // routes[0], so a loss-making craft must still rank its sells by
        // margin: an old `margin > 0 || sc === craftCity` gate kept only the
        // LOCAL sell once nothing was profitable, so a Lymhurst craft stayed on
        // Lymhurst's 380k bid while Martlock paid 450k (reported on My
        // Crafting List). See tests/crafting-unprofitable-best-sell.
        // selfFoundProfit: gatherable ingredients at zero (routeCost − gatheredMats); artifacts, haul fees, station fee, recipe silver, haul leg stay.
        validRoutes.push({
          craftCity,
          matBestPrices,
          totalInputCost: routeCost,
          sellCity: sc,
          sellPrice: sPrice,
          marginInfo: { profit, margin, selfFoundProfit: _craftSelfFoundTwin(sPrice, routeCost - gatheredMats) },
          rrr,
          brecilienFee: brecilienMatFee + productTravel,
        });
      }
    }
  });

  // Deduplicate and sort
  validRoutes.sort((a, b) => b.marginInfo.margin - a.marginInfo.margin);
  return validRoutes;
}

// Helper: artifact-style mats are consumed in full (no RRR return). RRR never
// returns a FINISHED equipment piece, so combine bases (capes, royal armor) and
// artifacts/tokens/mounts/farm inputs are all non-returnable — otherwise the
// dominant base-item cost gets a phantom RRR discount:
//   • cape combines: base cape (T*_CAPE) + artifact (T*_CAPEITEM_*_BP).
//   • royal armor combines: base SETn armor (maxreturnamount=0) + Royal tokens.
//
// The game states this per recipe line as `maxreturnamount="0"`. This classifier
// answers by material id instead, because it runs per material in the render hot
// path — tests/non-returnable-mats-match-itemsxml.test.cjs pins the two together
// over every material the app's catalogues actually consume.
//
// Two of the patterns are narrower than they look, and deliberately:
//   • _SKILLBOOK_STANDARD, not SKILLBOOK — the Tome of Insight in the Satchels
//     of Insight is flagged, but T*_SKILLBOOK_NONTRADABLE never is.
//   • _MOUNTUPGRADE_ is listed beside _MOUNT_ rather than folded into a bare
//     _MOUNT: T5-T7_MOUNT_ARMORED_HORSE are NOT flagged (only the mount-skin
//     crafts consume them, which this app does not price), so widening the
//     pattern would over-claim.
function isNonReturnableCraftMat(matId) {
  return matId.includes("ARTEFACT") || matId.includes("QUESTITEM_TOKEN") ||
    matId.includes("_FACTION_") || matId.includes("UNIQUE_GVGTOKEN") ||
    matId.includes("_FARM_") || matId.includes("_MOUNT_") ||
    matId.includes("_MOUNTUPGRADE_") || matId.includes("ALCHEMY_RARE") ||
    matId.includes("_SKILLBOOK_STANDARD") ||
    matId.includes("_CAPEITEM_") || /^T\d+_CAPE(@\d+)?$/.test(matId) ||
    /^T\d+_(HEAD|ARMOR|SHOES)_(CLOTH|LEATHER|PLATE)_SET[123](@\d+)?$/.test(matId);
}

// Build the Silver/Focus column from a FOCUS-ON route (computeCraftRoutesForCity
// with forceFocus=true). Decoupling it from the checkbox-selected route keeps
// the benchmark a stable focus-on number — it no longer moves (or flips sign)
// when toggling "Use Focus" shifts the winning sell city via the margin>0 gate.
// Always assumes focus-on RRR (matches the consumable/mount/refining convention).
function computeCraftFocusColumn(focusResult, item, materials) {
  const craftCity = focusResult.craftCity;
  const matBestPrices = focusResult.matBestPrices;
  const tier = getTierFromId(item.id);
  const focusCost = getCraftFocusCost(item.id, tier);
  const focusRrr = item.noReturn ? 0 : getCraftRRR(craftCity, item.craftType, focusCost > 0);
  const focusMats = materials.reduce((sum, m) =>
    sum + matsNeededFor10kFocus(focusCost, m.count, !isNonReturnableCraftMat(m.matId), focusRrr), 0);

  // Material value focus can actually give back: the full (undiscounted) count
  // of the RRR-eligible materials, landed in the craft city. Artifacts, tokens
  // and combine bases are consumed whatever the RRR, so they are worth nothing
  // per focus point — and neither is anything in a no-return craft. Station
  // fees, recipe silver and the haul-out leg are flat silver: they cancel out of
  // a difference-of-two-RRRs, so they play no part here.
  let rrrEligibleMatCost = 0;
  if (!item.noReturn) {
    materials.forEach((m) => {
      if (isNonReturnableCraftMat(m.matId)) return;
      let perUnit = matBestPrices[m.matId].price;
      if (typeof legBrecilienCost === "function") {
        perUnit += legBrecilienCost(matBestPrices[m.matId].city, craftCity, m.matId, 1);
      }
      rrrEligibleMatCost += perUnit * m.count;
    });
  }
  // Silver/Focus is what the FOCUS buys, not what the craft earns. Focus only
  // raises RRR, so its value is the extra material returned — the same marginal
  // metric the Refining/Transports column uses (marginalSilverPerFocus), and the
  // same one the Crafting Planner ranks focus plays by. The old figure
  // (profit ÷ focus) credited focus with profit the craft makes anyway, so a bed
  // read 67.9 when its focus was really worth 36.8 and the two tables
  // contradicted each other about where to spend a limited focus bar.
  //
  // This row BUYS its materials ("Route: Buy Mats → Sell Gear"), so the craft
  // step is the only place it can put a focus point. There is nothing to choose
  // between, which is why this table has no Best Focus column: it would read
  // "Craft" on every row forever. Focusing a material's refine instead is a
  // different pipeline — the Crafting Planner prices it, ranks it against the
  // craft, and shows the winner there; offering it here would contradict this
  // table's own Materials column. Both tables score the play with the same
  // standard (js/focus-play.js), so their Silver/Focus figures stay comparable.
  const baseRrr = item.noReturn ? 0 : getCraftRRR(craftCity, item.craftType, false);
  const craftPlay = makeFocusPlay({
    kind: "craft",
    itemId: item.id,
    focusCost,
    profitDelta: rrrEligibleMatCost * (focusRrr - baseRrr) * (1 + SETUP_FEE),
  });
  return {
    focusCost,
    focusRrr,
    baseRrr,
    focusMats,
    // What focus is WORTH on one craft of this row. Already computed for the
    // Silver/Focus column above; published so a caller with a finite focus
    // budget can price the crafts it cannot afford to focus (My Crafting List,
    // js/craft-list-focus-budget.js) without pricing the whole table twice.
    focusProfitDelta: craftPlay ? craftPlay.profitDelta : 0,
    profitPerFocus: focusPlayRate(craftPlay),
  };
}

// In-game name of the laborer that works a crafting journal slug (WARRIOR →
// Blacksmith …). Read from the LABORERS catalogue so the two never drift.
function craftLaborerName(slug) {
  if (!slug || typeof LABORERS === "undefined") return slug || "";
  const lab = LABORERS.find((l) => l.slug === slug);
  return lab ? lab.name : slug;
}

// "Profit + Laborer Journal" cell: Pure Profit plus what this craft's journal is
// worth handed to your own laborer instead of sold. The laborer returns refined
// resources AND the journal, empty — so the play needs one set of journals and
// never re-buys them, which is why no journal price appears here. Renders "—"
// when the craft fills no crafting journal (food, mounts, gathering gear) or the
// laborer's refined output has no price yet.
function craftLaborerJournalCell(laborerJournal, marginInfo, profitWithLaborer) {
  const j = laborerJournal;
  if (!j || !j.bestJournal || !(j.extraSilverPerCraft > 0)) {
    const why = j
      ? tx("No priced refined output for this profession's laborer yet.", "r_laborer_journal_no_price")
      : tx("This craft fills no crafting journal.", "r_laborer_journal_none");
    return `<td style="color:#6b7280;font-style:italic" title="${why}">—</td>`;
  }
  const b = j.bestJournal;
  const cls = profitWithLaborer > 0 ? "profit-low" : "profit-negative";
  const tip = tx(
    "Pure Profit {profit} + {extra} laborer value: {fame} fame/craft fills a {laborer} T{tier} journal ({maxfame}); a T8 laborer returns {payout} at {yield}× yield.",
    "r_laborer_journal_tip",
  )
    .replace("{profit}", formatSilver(marginInfo.profit))
    .replace("{extra}", formatSilver(j.extraSilverPerCraft))
    .replace("{fame}", Math.round(j.famePerCraft).toLocaleString())
    .replace("{laborer}", craftLaborerName(j.slug))
    .replace("{tier}", b.tier)
    .replace("{maxfame}", b.maxfame.toLocaleString())
    .replace("{yield}", b.yield.toFixed(3))
    .replace("{payout}", formatSilver(b.payout));
  return `<td class="silver-val ${cls}" title="${tip}">${formatSilver(profitWithLaborer)}` +
    `<br><small style="color:#9ca3af">+${formatSilver(j.extraSilverPerCraft)} · ${craftLaborerName(j.slug)} T${b.tier}</small></td>`;
}

/**
 * The catalog this table draws, T4-T8 gear expanded to its @1-@4 variants.
 *
 * Split out of renderCraftingTable so the chunked variant
 * (js/render-crafting-chunked.js) computes exactly the same rows over exactly
 * the same items — the two paths must never drift.
 */
function buildCraftingTableItems() {
  // Build items list including @1-@4 variants for T4-T8 gear (dedup by id)
  const craftItems = [];
  const seenIds = new Set();
  CRAFTING_ITEMS.forEach((item) => {
    if (seenIds.has(item.id)) return;
    seenIds.add(item.id);
    craftItems.push(item);
    if (item.isGearRecipe && !item.id.includes("@")) {
      const tier = getTierFromId(item.id);
      if (tier >= 4 && tier <= 8) {
        for (let enchLevel = 1; enchLevel <= 4; enchLevel++) {
          const enchId = item.id + "@" + enchLevel;
          if (seenIds.has(enchId)) continue;
          seenIds.add(enchId);
          const baseMats = item.materials || [{ matId: item.matId, count: item.matCount }];
          const enchMats = baseMats.map(m => {
            if (/^T\d+_(LEATHER|CLOTH|METALBAR|PLANKS|STONEBLOCK)$/.test(m.matId))
              return { ...m, matId: m.matId + "_LEVEL" + enchLevel + "@" + enchLevel };
            if (/^T\d+_/.test(m.matId) &&
                !/ARTEFACT|_BP|TOKEN|_FACTION_|ALCHEMY_RARE|SKILLBOOK/.test(m.matId))
              return { ...m, matId: m.matId + "@" + enchLevel };
            return m;
          });
          craftItems.push({ ...item, id: enchId, name: item.name + " [." + enchLevel + "]", materials: enchMats });
        }
      }
    }
  });

  return craftItems;
}

/** Every candidate row for one catalog item. The unit of work of this table. */
function craftingRowsForItem(item, marketData) {
  {
    const materials = getCraftingMaterials(item);

    // Emit one row per candidate city. Caerleon is always a candidate (its
    // self-contained Caerleon→Caerleon route survives red-zone routes being
    // off); with routes off a Caerleon-spec craft ALSO lists the royals so
    // royal-based players see it. See getCraftCandidates for the full logic.
    const specCity = getSpecCraftCity(item.craftType);
    const candidates = getCraftCandidates(specCity, isBlackRedZoneEnabled());

    // A craft city that cannot reach an active City pick has no honest row —
    // the Black Market is sellable from Caerleon alone, and a royal craft cannot
    // buy in Caerleon — so that section is dropped rather than filled with
    // placeholders (js/table-sell-city.js).
    const pick = (typeof getTableSellCity === "function") ? getTableSellCity("crafting-table") : null;
    const buyPick = (typeof getTableBuyCity === "function") ? getTableBuyCity("crafting-table") : null;
    const reachable = candidates.filter((cc) => (!pick || !isInvalidCrossRoute(cc, pick))
      && (!buyPick || isValidSourceCity(buyPick, cc)));

    return reachable.flatMap((cc) => {
      const results = computeCraftRoutesForCity(
        cc,
        item,
        materials,
        marketData,
      );
      if (results.length === 0)
        return [
          {
            item,
            materials,
            craftCity: cc,
            marginInfo: { margin: -1 },
            hasOverride:
              materials.some(m => {
                const mCity = getCityForce(m.matId, "buy") || cc;
                return getOverridePrice(m.matId, mCity) !== null;
              }) ||
              (() => {
                const fs = getCityForce(item.id, "sell");
                const sc = fs && !isInvalidCrossRoute(cc, fs) ? fs : cc;
                return getOverridePrice(item.id, sc) !== null;
              })(),
            section: cc === "Caerleon" ? "caerleon" : "royal",
          },
        ];

      const result = results[0];
      const {
        craftCity,
        matBestPrices,
        totalInputCost,
        sellCity: bestSellCity,
        sellPrice: bestSellPrice,
        marginInfo: bestMarginInfo,
        rrr,
        brecilienFee,
      } = result;
      // Multi-material craft: no single buy id to pair, so Daily Vol = output
      // sell-city volume (the old getMinVol read the output at craftCity, ~0
      // when craftCity differs from the sell city). Equals sellVol below.
      const sellVol = getCityVol(marketData, item.id, bestSellCity);
      const vol = sellVol;
      // Silver/Focus + "Mats to Buy" is a focus-ON benchmark, invariant to the
      // checkbox: evaluate the route once more with focus forced on (reuse the
      // checkbox routes when focus is already on) and derive the column from it.
      // Without this, the `margin > 0` gate shifts the winning sell city when
      // focus is off, dragging Silver/Focus with it (and flipping its sign).
      const focusResults = isFocusEnabled()
        ? results
        : computeCraftRoutesForCity(craftCity, item, materials, marketData, true);
      const focusResult = focusResults[0] || result;
      const {
        focusCost, focusRrr, baseRrr, focusMats: totalMatsToBuy,
        profitPerFocus, focusProfitDelta,
      } = computeCraftFocusColumn(focusResult, item, materials);
      // Profit / 10k Focus is the same focus-ON benchmark: a full focus bar is
      // focus-on play by definition, so it multiplies the FOCUS-ON profit, not
      // the checkbox one (pairing an invariant focus cost with a toggling
      // profit made the column move with the checkbox).
      const profitFocusOn = (focusResult && focusResult.marginInfo)
        ? focusResult.marginInfo.profit
        : bestMarginInfo.profit;
      // Self-gathered twin of that profit (Profit / 10k Focus's gathered
      // line): the focus-ON route with its gatherable ingredients at zero.
      const gatheredFocusOn = focusResult?.marginInfo?.selfFoundProfit ?? null;
      // The crafting fame this craft awards fills a crafting journal. Valued
      // here as WORKED BY YOUR OWN LABORER (the loot comes back with the same
      // journal, empty) rather than sold — so no empty journal is ever bought.
      // See js/laborer-journal-value.js.
      const laborerJournal = (typeof getLaborerJournalFill === "function")
        ? getLaborerJournalFill(item, materials, craftCity, marketData)
        : null;
      const laborerExtra = laborerJournal ? laborerJournal.extraSilverPerCraft : 0;
      return [
        {
          item,
          materials,
          craftCity,
          matBestPrices,
          sellGear: { city: bestSellCity, price: bestSellPrice },
          totalInputCost,
          brecilienFee,
          marginInfo: bestMarginInfo,
          dailyVol: vol,
          sellVol,
          rrr,
          focusRrr,
          baseRrr,
          focusCost,
          focusMats: totalMatsToBuy,
          profitPerFocus,
          // Only when this row's HEADLINE is actually focused: with the box off
          // `marginInfo.profit` is already the focus-off figure, and reporting a
          // gain against it would have the list subtract a saving twice.
          focusProfitDelta: (isFocusEnabled() && focusCost > 0) ? focusProfitDelta : 0,
          laborerJournal,
          profitWithLaborer: bestMarginInfo.profit + laborerExtra,
          profitFocusOn,
          profitPer10kFocus: calculateProfitPer10kFocus(profitFocusOn, focusCost),
          // Self-gathered twin of the bar: the focus-ON route's gatherable
          // ingredients at zero (its marginInfo.selfFoundProfit).
          profitFocusOnGathered: gatheredFocusOn,
          profitPer10kFocusGathered: (Number.isFinite(gatheredFocusOn) && focusCost > 0)
            ? calculateProfitPer10kFocus(gatheredFocusOn, focusCost) : null,
          hasOverride:
            materials.some(m => getOverridePrice(matBestPrices[m.matId]?.id || m.matId, matBestPrices[m.matId]?.city) !== null) ||
            getOverridePrice(item.id, bestSellCity) !== null,
          section: craftCity === "Caerleon" ? "caerleon" : "royal",
        },
      ];
    });
  }
}

function renderCraftingTable(marketData) {
  const rowData = buildCraftingTableItems()
    .flatMap((item) => craftingRowsForItem(item, marketData));
  paintCraftingRows(dedupeCraftingRows(rowData), marketData);
}

/** The single DOM write. Shared with the chunked path. */
function paintCraftingRows(dedupedRowData, marketData) {
  renderTableData(
    "crafting-table",
    dedupedRowData,
    (row, rowIdx) => {
      const {
        item,
        materials,
        craftCity,
        matBestPrices,
        sellGear,
        totalInputCost,
        brecilienFee,
        marginInfo,
        rrr,
        focusRrr,
        focusCost,
        profitPerFocus,
        profitPer10kFocus,
        profitFocusOn,
        profitPer10kFocusGathered,
        profitFocusOnGathered,
        laborerJournal,
        profitWithLaborer,
      } = row;
      const rowKey = getRowKey(row, "crafting-table");
      // Crafting building this row is made at — drives the header's Station
      // picker (js/table-search.js).
      const station =
        (typeof getCraftStation === "function" && item ? getCraftStation(item) : "") || "";
      const stationAttr = station ? ` data-station="${station}"` : "";
      if (marginInfo.margin === -1) {
        // Unpriced route — js/render-crafting-no-data-row.js.
        return item ? craftingNoDataRowHtml(row, rowKey, stationAttr, marketData) : "";
      }

      const matsHtml = materials
        .map((m) => {
          const { price, city, id: boughtId } = matBestPrices[m.matId];
          // The artifact slot may have been filled by a cheaper Crystallized
          // token or expiring twin. Name (and price-edit) the item the route
          // actually BUYS, not the recipe's default artifact.
          const bought = boughtId || m.matId;
          const name = getItemDisplayName(bought);
          const substTag = bought !== m.matId
            ? ` <small style="color:#9ca3af" title="${tx("Substitutes for", "r_substitutes_for")} ${getItemDisplayName(m.matId)}">(${tx("instead of", "r_instead_of")} ${getItemDisplayName(m.matId)})</small>`
            : "";
          const isArtifact = isNonReturnableCraftMat(m.matId);
          const effectiveCount = isArtifact
            ? m.count
            : (m.count * (1 - rrr)).toFixed(1);
          const fromTag = city
            ? ` <small style="color:#9ca3af">(${tx("from", "r_from_lower")} ${city})</small>`
            : "";
          const consumedTag = isArtifact
            ? ""
            : ` <small style="color:#9ca3af">(~${effectiveCount}x consumed)</small>`;
          return `${m.count}x ${name} ${matPriceSpan(bought, city, price)}${substTag}${fromTag}${consumedTag}`;
        })
        .join("<br>");

      // Whole crafts, or a fraction of one when a craft outruns the bar.
      const craftsWithFocus = focusCost ? (typeof focusBarCrafts === "function" ? focusBarCrafts(focusCost) : Math.floor(10000 / focusCost)) : 0;
      const focusMatsHtml = focusCost
        ? materials
            .map((m) => {
              const isArtifact = isNonReturnableCraftMat(m.matId);
              const need = matsNeededFor10kFocus(focusCost, m.count, !isArtifact, focusRrr);
              const name = getItemDisplayName(matBestPrices[m.matId].id || m.matId);
              return `${need.toLocaleString()}x ${name}`;
            })
            .join("<br>") +
          `<br><small style="color:#9ca3af" title="${typeof focusSpecTitle === "function" ? focusSpecTitle(item.id) : ""}">${(typeof formatBarCrafts === "function" ? formatBarCrafts(craftsWithFocus) : craftsWithFocus.toLocaleString())}x ${tx("crafts", "r_crafts")} @ ${formatFocusCost(focusCost)}${typeof focusSpecMark === "function" ? focusSpecMark(item.id) : ""} ${tx("focus ea", "r_focus_ea")}</small>`
        : "—";
      const profitPerFocusClass = profitPerFocus > 0 ? "profit-low" : "profit-negative";

      // Profit for a whole 10k focus bar spent crafting this item. Quotes the
      // FOCUS-ON profit it multiplies; Pure Profit tracks the checkbox instead.
      const p10kClass = profitPer10kFocus > 0 ? "profit-low" : "profit-negative";
      const p10kCell = focusCost
        ? `<td class="silver-val ${p10kClass}" title="${tx("{profit} profit/craft (after mat costs) × {crafts} crafts ({focus} focus ea)", "r_p10k_craft_tip").replace("{profit}", formatSilver(profitFocusOn != null ? profitFocusOn : marginInfo.profit)).replace("{crafts}", (typeof formatBarCrafts === "function" ? formatBarCrafts(craftsWithFocus) : craftsWithFocus.toLocaleString())).replace("{focus}", formatFocusCost(focusCost))}">${formatSilver(profitPer10kFocus)}${(typeof gatheredPer10kSmallHtml === "function" ? gatheredPer10kSmallHtml(profitPer10kFocusGathered, profitFocusOnGathered) : "")}</td>`
        : `<td style="color:#6b7280;font-style:italic" title="${tx("Not focus-craftable — no craftingfocus on this item", "r_not_focus_craftable")}">—</td>`;

      const laborerCell = craftLaborerJournalCell(laborerJournal, marginInfo, profitWithLaborer);

      const hasVariants = item.isGearRecipe && !item.id.includes("@") && getTierFromId(item.id) >= 4;
      const isVariant = item.id.includes("@") && !item.topLevelVariant;
      const expandIcon = hasVariants
        ? `<span data-expand-craft="${item.id}" style="cursor:pointer;margin-right:4px;color:#7ab8c4">${expandedCraftItems.has(item.id) ? "▼" : "▶"}</span>`
        : "";
      const nameStyle = isVariant ? ' style="padding-left:1.5em;color:#b0b8c4"' : "";

      return `
      <tr data-row-key="${rowKey}"${stationAttr}>
          ${addTdForKey("crafting-table", rowKey)}
          <td class="cell-item"${nameStyle}>${expandIcon}${dispName(item.id, item.name)}</td>
          ${routeCityCell([
            {
              label: tx("Buy", "r_buy"),
              city: matBestPrices[materials[0].matId].city,
              itemId: materials[0].matId,
              side: "buy",
              price: matBestPrices[materials[0].matId].price,
            },
            {
              label: tx("Craft", "r_craft"),
              city: craftCity,
              suffix: getNoSpecLabel(craftCity, item.craftType),
            },
            { label: tx("Sell", "r_sell"), city: sellGear.city, itemId: item.id, side: "sell", price: sellGear.price },
          ], { trailing: brecilienFeeBadge(brecilienFee) })}
          <td class="cell-mats">${matsHtml}</td>
          ${aggregateCostTd(totalInputCost)}
          ${priceTd(sellGear.price, item.id, sellGear.city)}
          ${profitTd(marginInfo, "crafting-table", rowIdx, sellGear.city)}
          ${pureProfitTd(marginInfo)}          ${laborerCell}          ${p10kCell}
          <td class="cell-focus-mats">${focusMatsHtml}</td>
          <td class="silver-val ${profitPerFocusClass}">${profitPerFocus ? profitPerFocus.toFixed(1) : "—"}</td>
      </tr>
  `;
    },
  );
}

