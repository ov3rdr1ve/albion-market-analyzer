// renderChainBreakdown lives in js/render-chain-breakdown.js (shared with
// render-transport.js, kept separate to stay under the 800-line cap).
// The enchant-variant model (generateConsumableEnchantVariants /
// consumableBaseHasEnchantVariants) lives in js/consumable-enchant-variants.js,
// extracted for the same reason — load it before this file.

function renderConsumableTable(marketData) {
  // Only sell legs are gated here — the material buys go through
  // findCheapestMarketBuy, which carries no volume preference.
  const MIN_VOLUME = getOrderType("sell") === "market" ? 25 : 0;

  const consumablesWithVariants = generateConsumableEnchantVariants(CONSUMABLES);
  const rowData = consumablesWithVariants.flatMap((item) => {
    // Cache, then the bundled catalog, then the derived `@n` variant (base
    // recipe + enchant sauce). Reading recipeCache directly meant the boot
    // render — which runs before any scan has filled it — saw no recipe and
    // dropped every consumable into the flip branch below. See
    // js/recipe-resolver.js.
    const recipe = (typeof resolveConsumableRecipe === "function")
      ? resolveConsumableRecipe(item)
      : recipeCache[item.id];

    // --- CHAIN CRAFT: items that are produced by a sub-recipe (raw meat from
    // breeding+butcher, flour from wheat, bread from flour, butter from milk).
    // For these, we ALWAYS show the breed/butcher/mill chain — the user is
    // producing the item, not arbitraging it, so the chain stays visible
    // even when buying it raw off the market would be cheaper. Only when the
    // chain itself is unbuildable (no baby/feed/leaf prices) do we fall back
    // to a "no market data" placeholder — never to a flip route.
    const chainRecipe = (typeof CHAIN_RECIPES !== "undefined") ? CHAIN_RECIPES[item.id] : null;
    if (chainRecipe && !recipe) {
      // What an unbuildable chain would have bought — handed to the no-data row
      // so its inputs stay priced and clickable instead of collapsing to dashes.
      const chainMats = Array.isArray(chainRecipe.inputs) ? chainRecipe.inputs : null;
      const buildChainCraftRow = (rawCitySearch, rawSellCities, section) => {
        // Narrowed to the City picks; a section that cannot honour one yields no
        // row, and the caller substitutes the editable no-data placeholder.
        const citySearch = consumablePickedPool("buy", rawCitySearch);
        const sellCities = consumablePickedPool("sell", rawSellCities);
        if (!citySearch.length || !sellCities.length) return null;
        // sellAs: synthetic rows (T1_FISHCHOPS__<fishId>) have no market
        // listings of their own — they route sell-side lookups to the real
        // output id (T1_FISHCHOPS). Real rows use their own id for both.
        const sellId = item.sellAs || item.id;
        const sourcing = (typeof forceChainSourcing === "function")
          ? forceChainSourcing(item.id, marketData, citySearch) : null;
        if (!sourcing || sourcing.source !== "chain" || !sourcing.chain) {
          return null;
        }
        const chain = sourcing.chain;
        const breedCity = chain.inputs?.[0]?.sourcing?.city || citySearch[0];
        // Hoist focusCost so we can decide whether the focus toggle is even
        // meaningful for this item. Items with no craftingfocus attribute in
        // items.xml (e.g., T1_FISHSAUCE_LEVEL{1,2,3}, T1_FISHCHOPS) can't be
        // focus-crafted in-game; toggling "Use Focus" must NOT grant the
        // +59% RRR bonus for them, only the base city RRR.
        // Butchering meat costs items.xml's craftingfocus × amountcrafted per
        // animal (38 × 18 = 684 unspecced, identical at every meat tier), scaled
        // by the cooking spec levels — see getButcherFocusCost. Every other chain
        // row goes through getFocusCost, whose reduction is read from the item's
        // own Destiny Board nodes, so the third argument is vestigial: flour,
        // bread and butter sit in FARM_COOK's base list with no spec node of
        // their own (general cooking FCE only), while the alcohols DO have one —
        // FARM_ALCHEMIST_ALCOHOL ("Bootlegger", ring 9, +2.5 group bonus on the
        // POTION branch), which is why schnapps reads far cheaper per unit than
        // flour does. That node cuts FOCUS only; it grants no Local Production
        // Bonus in any city (see getChainCraftType). Fish chops/sauce carry no
        // craftingfocus and stay 0 either way.
        const isButcher = chain.station === "butcher";
        // A pasture is not a craft station: no focus is spent on a produce
        // cycle, so the row's four focus columns stay blank the same way fish
        // chops' do. Its batch scales with Premium and the byproduct spec city
        // instead — priced in js/consumable-pasture-row.js.
        const pasture = chain.station === "pasture" && typeof buildPastureRowFields === "function"
          ? buildPastureRowFields(chain, {
              perUnit: sourcing.perUnit,
              marketData,
              citySearch,
              fallbackCity: breedCity,
            })
          : null;
        const isPasture = !!pasture;
        const focusCost = isPasture
          ? 0
          : isButcher
          ? ((typeof getButcherFocusCost === "function") ? getButcherFocusCost(sellId) : 0)
          : ((typeof getFocusCost === "function")
              ? getFocusCost(sellId, getTierFromId(sellId), "ingredient") : 0);
        const effectiveFocusOn = isFocusEnabled() && focusCost > 0;
        // Butchers carry a per-meat city spec (+10 PB, see CITY_BUTCHER_SPEC):
        // buy the grown animal cheapest (breedCity) but BUTCHER in the spec city
        // via getOptimalButcherCity (falls back to breedCity when none reachable).
        // Butchers pay RRR as extra output meat (noReturn on the grown-animal
        // input); mill/cook/alchemist take it as an input refund.
        const butcherCity = isButcher && typeof getOptimalButcherCity === "function"
          ? getOptimalButcherCity(chain.produces, citySearch, breedCity)
          : breedCity;
        // Mill/cook rows carry a CITY_CRAFT_SPEC bonus too (+15 PB) — it was
        // just never claimed, because this branch hard-coded craftType null.
        // Flour/bread/butter are craftingcategory="food" and ride Caerleon.
        // Alchemist rows get NOTHING: schnapps is on the potion branch of the
        // Destiny Board yet reads base 15.2% RRR in Brecilien in-game, and a
        // potion-branch item can't claim Caerleon's food bonus either (see
        // getChainCraftType). Same shape as the butcher otherwise: buy the
        // input cheapest, craft in the bonus city.
        const chainCraftType = (typeof getChainCraftType === "function")
          ? getChainCraftType(chain.station) : null;
        const craftCity = isPasture
          ? (pasture ? pasture.pastureCity : breedCity)
          : isButcher
          ? butcherCity
          : ((typeof getOptimalCraftCity === "function")
              ? getOptimalCraftCity(chainCraftType, citySearch, breedCity)
              : breedCity);
        // A pasture has no return rate at all: the feed is eaten, and the city
        // bonus it does carry pays out as extra produce (already in yieldMult),
        // not as a refund.
        const chainRrr = isPasture
          ? 0
          : isButcher
          ? ((typeof getButcherRRR === "function")
              ? getButcherRRR(butcherCity, chain.produces, effectiveFocusOn)
              : 0)
          : ((typeof getCraftRRR === "function")
              ? getCraftRRR(craftCity, chainCraftType, effectiveFocusOn)
              : 0);
        const anyReturnable = (chain.inputs || []).some((i) => !i.noReturn);
        // Effective per-batch output. Butchers gain extra meat from RRR; mill/cook
        // still produce chain.output but pay less in inputs.
        const effectiveOutput = isPasture
          ? pasture.effectiveOutput
          : isButcher
          ? chain.output * (1 + chainRrr)
          : chain.output;
        // Effective per-output-unit cost:
        //   butcher: same input dollars / more meat → divide by (1+rrr)
        //   mill/cook with at least one returnable input: refund cuts cost by (1-rrr)
        //   mill/cook with all noReturn inputs: no refund possible
        //   pasture: falls through to the same last case — the feed is eaten and
        //     the chain pricer already spread it over the scaled produce cycle
        let effectiveCostPerOutput;
        if (isButcher) {
          effectiveCostPerOutput = sourcing.perUnit * chain.output / effectiveOutput;
        } else if (anyReturnable) {
          effectiveCostPerOutput = sourcing.perUnit * (1 - chainRrr);
        } else {
          effectiveCostPerOutput = sourcing.perUnit;
        }
        const totalInputCost = effectiveCostPerOutput * (1 + SETUP_FEE);
        const potBounds = getIQRBounds(marketData[sellId]);
        const forcedSellCity = getCityForce(sellId, "sell");
        // Only honor a force that belongs to THIS section (royal vs Caerleon).
        const sellPool =
          forcedSellCity && sellCities.includes(forcedSellCity)
            ? [forcedSellCity]
            : sellCities;
        let bestSell = { city: null, price: 0 };
        let bestSellNet = -Infinity;
        sellPool.forEach((sc) => {
          const sPrice = getSellPrice(marketData[sellId], sc, potBounds, sellId);
          const sVol = marketData[sellId]?.[sc]?.volume_24h || 0;
          if (sPrice > 0 && (sVol >= MIN_VOLUME || getOverridePrice(sellId, sc) !== null)) {
            // Net of the Brecilien haul-out fee (free when selling in Brecilien).
            const exit = (typeof legBrecilienCost === "function")
              ? legBrecilienCost(breedCity, sc, sellId, 1) : 0;
            const net = sPrice - exit;
            if (net > bestSellNet) { bestSellNet = net; bestSell = { city: sc, price: sPrice }; }
          }
        });
        // Sell-side fallback: no listing → first sell-pool city at price 0 so
        // the row still renders an editable sell cell (mirrors breeding rows).
        const effectiveSell = bestSell.city ? bestSell : { city: sellPool[0], price: 0 };
        const productTravel = (typeof legBrecilienCost === "function")
          ? legBrecilienCost(breedCity, effectiveSell.city, sellId, 1) : 0;
        const revenue = effectiveSell.price * (1 - PREMIUM_TAX);
        const profit = revenue - totalInputCost - productTravel;
        const margin = totalInputCost > 0 ? (profit / totalInputCost) * 100 : 0;
        // Focus efficiency. Silver/Focus is a benchmark that ALWAYS assumes
        // focus-on RRR (matches the craft-row convention + focus-toggle test).
        // Gate on focusCost so items without craftingfocus (fish chops, fish
        // sauce) get only base RRR — they can't use focus in-game.
        const rrrAt = (useFocus) => (isPasture ? 0 : isButcher
          ? ((typeof getButcherRRR === "function")
              ? getButcherRRR(butcherCity, chain.produces, useFocus) : 0)
          : ((typeof getCraftRRR === "function")
              ? getCraftRRR(craftCity, chainCraftType, useFocus) : 0));
        // One batch at a given return rate. Butcher rows get MORE output per
        // animal; mill/cook rows get a refund on the returnable inputs instead.
        const batchAtRrr = (atRrr) => {
          const out = isPasture
            ? effectiveOutput
            : isButcher ? chain.output * (1 + atRrr) : chain.output;
          let costPerOutput;
          if (isButcher) costPerOutput = sourcing.perUnit * chain.output / out;
          else if (anyReturnable) costPerOutput = sourcing.perUnit * (1 - atRrr);
          else costPerOutput = sourcing.perUnit;
          const perOutput = revenue - costPerOutput * (1 + SETUP_FEE) - productTravel;
          return { output: out, profitPerOutput: perOutput, profitPerBatch: perOutput * out };
        };
        const benchmarkRrr = rrrAt(focusCost > 0);
        const benchBatch = batchAtRrr(benchmarkRrr);
        const benchOutput = benchBatch.output;
        const profitPerBatch = benchBatch.profitPerBatch;
        // The chain craft (butcher / mill) is the only focusable step on this row.
        // What focus adds to the batch you SELL is the whole-batch profit it gains
        // over the same batch run without focus — the shared standard, not the
        // batch's entire profit divided by its focus (js/focus-play.js).
        const bestFocusPlay = pickBestFocusPlay([
          makeFocusPlay({
            kind: "chain", itemId: chain.produces, focusItemId: chain.produces,
            focusCost,
            profitDelta: profitPerBatch - batchAtRrr(rrrAt(false)).profitPerBatch,
          }),
        ]);
        const profitPerFocus = focusPlayRate(bestFocusPlay);
        // The same play restated PER OUTPUT, which is the unit this row's
        // profit, cost and price are all quoted in. `focusCost` above is a whole
        // BATCH's charge, so anything that multiplies it by a number of outputs
        // (My Crafting List's basket, js/craft-list-focus-budget.js) has to
        // divide it down first — the same trap the farming rows hit when a
        // 22h cycle's watering focus was billed once per crop.
        const baseBatch = batchAtRrr(rrrAt(false));
        const focusPerOutput = benchOutput > 0 ? focusCost / benchOutput : 0;
        const focusProfitPerOutput = benchBatch.profitPerOutput - baseBatch.profitPerOutput;
        // Self-gathered twin of one focus-ON batch (Profit / 10k Focus's
        // gathered line): chain ingredients at zero, haul leg + tax kept.
        const gatheredBatchFocusOn = (revenue - productTravel) * benchOutput;
        return {
          item,
          isFlip: false,
          isChainCraft: true,
          chainSourcing: sourcing,
          buyMat: { city: breedCity, price: 0 },
          sellPot: effectiveSell,
          matBestPrices: null,
          totalInputCost,
          brecilienFee: productTravel,
          marginInfo: { profit, margin, selfFoundProfit: revenue - productTravel }, // twin: chain ingredients zeroed, haul leg + tax kept
          // Multi-input chain (feed + station): Daily Vol = output sell-city
          // volume, not the output read at the breed city (~0 when they differ).
          dailyVol: getCityVol(marketData, sellId, effectiveSell.city),
          rrr: chainRrr,
          chainRrr,
          chainStation: chain.station,
          butcherCity: isButcher ? butcherCity : null,
          butcherBonus: isButcher && butcherCity !== breedCity ? "+10%" : null,
          craftCity,
          craftBonus: isPasture
            ? pasture.pastureBonus
            : (!isButcher && chainCraftType
                && typeof CITY_CRAFT_SPEC !== "undefined"
                && (CITY_CRAFT_SPEC[craftCity] || []).includes(chainCraftType) ? "+15%" : null),
          // Pasture rows only: the grown animal, priced for display. Reusable
          // capital, deliberately outside totalInputCost.
          pastureCapital: isPasture ? pasture.capitalBuy : null,
          effectiveOutput,
          focusCost,
          focusPerOutput,
          focusProfitPerOutput,
          baseRrr: rrrAt(false),
          profitPerFocus,
          bestFocusPlay,
          // Chain rows craft a whole batch per focus charge, so the 10k-focus
          // profit multiplies the PER-BATCH profit, not the per-output one —
          // and the FOCUS-ON batch (profitPerBatch, priced at benchmarkRrr),
          // since spending a focus bar is focus-on play by definition. Using
          // the checkbox batch made the column move with the toggle.
          profitPer10kFocus: calculateProfitPer10kFocus(profitPerBatch, focusCost),
          profitFocusOn: profitPerBatch,
          // Self-gathered twin per focus-ON batch: chain ingredients at zero,
          // haul leg + tax kept, over the same batch output.
          profitFocusOnGathered: gatheredBatchFocusOn,
          profitPer10kFocusGathered: (Number.isFinite(gatheredBatchFocusOn) && focusCost > 0)
            ? calculateProfitPer10kFocus(gatheredBatchFocusOn, focusCost) : null,
          profitFocusOnPerOutput: benchBatch.profitPerOutput, // ranks the merged arms for the per-10k figure
          hasOverride: !!getOverridePrice(sellId, effectiveSell.city),
          section,
        };
      };
      if (isBlackRedZoneEnabled()) {
        // The chain's craft city is DERIVED from where its first input was
        // bought (breedCity above), so handing it every city at once let one
        // batch buy its animal in Caerleon and its salt in Martlock. Price the
        // two zones separately and keep whichever pays more — the materials
        // then share a side of the line, while the sell pool stays SELL_CITIES
        // in both arms because the sale is the one leg allowed to cross
        // (isValidSourceCity, js/utils.js). Still ONE row: with routes on this
        // table does not split into sections.
        const arms = [
          buildChainCraftRow(ROYAL_CITIES, SELL_CITIES),
          buildChainCraftRow(["Caerleon", ...BLACK_ZONE_CITIES], SELL_CITIES),
        ].filter(Boolean);
        const row = arms.reduce((best, r) => (
          !best || (r.marginInfo?.profit || 0) > (best.marginInfo?.profit || 0) ? r : best
        ), null);
        return [withFocusOnPer10k(row, bestFocusOnArm(arms)) || { item, mats: chainMats, marginInfo: { margin: -1 } }];
      }
      const royal = buildChainCraftRow(ROYAL_CITIES, ROYAL_CITIES, "royal");
      const caer = buildChainCraftRow(["Caerleon"], ["Caerleon", "Black Market"], "caerleon");
      return [
        royal || { item, mats: chainMats, marginInfo: { margin: -1 }, section: "royal" },
        caer || { item, mats: chainMats, marginInfo: { margin: -1 }, section: "caerleon" },
      ];
    }

    // --- FLIP ANALYSIS: the leaves nobody produces (crops, herbs, raw fish) ---
    // Anything with a recipe or a CHAIN_RECIPES entry has already returned above.
    if (!recipe) {
      return buildConsumableFlipRows(item, marketData);
    }

    // --- CRAFT ANALYSIS: meals and potions with a full ingredient recipe ---
    // Brecilien specializes in Potion (+15%), Caerleon in Food (+15%); other cities get base 18%.
    const consumableCraftType = getConsumableCraftType(item.id);
    // Units produced per craft action (items.xml amountcrafted): salads/most
    // potions = 10, heal potions = 5, single-ingredient foods = 1. The recipe
    // counts (e.g. 24 turnip + 24 wheat) make a whole batch, so all material
    // costs below are divided by this to price the row PER SINGLE UNIT —
    // matching the per-unit focus cost and per-unit sale price. Without it,
    // batch-yield meals/potions show a ~10×/5× false loss and vanish.
    const recipeOutput = (typeof getRecipeOutput === "function")
      ? getRecipeOutput(item.id) : 1;
    const potBounds = getIQRBounds(marketData[item.id]);
    // Hoisted: items without craftingfocus (fish sauce/chops) never get +59% focus RRR.
    const recipeItemFocusCost = (typeof getFocusCost === "function")
      ? getFocusCost(item.id, getTierFromId(item.id)) : 0;

    // Try every craft city; track best per section when checkbox OFF
    let bestResult = null;
    let bestRoyalResult = null;
    let bestCaerleonResult = null;
    let bestFocusOnResult = null; // merged-mode winner WITH focus (js/consumable-city-pick.js)

    CRAFT_CITIES.forEach((craftCity) => {
      const rrr = getCraftRRR(craftCity, consumableCraftType, isFocusEnabled() && recipeItemFocusCost > 0);
      const isCaerleonCity = craftCity === "Caerleon";

      // Find best price for each ingredient across all cities. For chain-able
      // ingredients (raw meat, flour, bread, butter), the chain-pricing helper
      // automatically picks the cheaper of "buy raw" vs "make from sub-recipe"
      // and returns a breakdown the renderer can show as indented sub-rows.
      // Every market this craft city may source from, narrowed to the Buy City
      // pick. Empty = it cannot buy there, so the arm is dropped rather than
      // sourcing somewhere the pick did not name.
      const matCitySearch = consumableBuyCities(craftCity);
      if (!matCitySearch.length) return;
      const matBestPrices = {};
      // The chain legs this row did NOT take. The headline cost is the market
      // buy (see below); each entry here is an ingredient the user could make
      // instead, rendered under the row by the "alternative routes" panel.
      const matAltChains = [];
      let allAvailable = true;

      recipe.forEach((m) => {
        // Both legs, not just the winner. The row is priced on the MARKET leg
        // — "what does this potion cost if I buy its ingredients" is one
        // question and "should I run a pasture" is another, and folding the
        // cheaper of the two into the headline answered neither cleanly. The
        // chain leg survives as an alternative instead of being discarded.
        const alt = (typeof getChainAlternatives === "function")
          ? getChainAlternatives(m.matId, marketData, matCitySearch)
          : null;
        // Enchant sauces (T1_FISHSAUCE_LEVEL{N}, T{tier}_ESSENCE_POTION).
        // These used to be non-tradeable, but real market listings now
        // exist (e.g. T1_FISHSAUCE_LEVEL3 @ 35K silver in Thetford). Price
        // resolution priority:
        //   1) User override at ANY city in CITIES (the price-edit dropdown
        //      lets them commit at any city; renderer must find it).
        //   2) Real market data via findCheapestMarketBuy across
        //      matCitySearch (which already honors overrides internally).
        //   3) 0 if neither — row stays renderable (allAvailable=true)
        //      so the user can still see/edit the breakdown.
        if (m.isEnchantSauce) {
          let resolvedPrice = null;
          let resolvedCity = null;
          if (typeof getOverridePrice === "function" && typeof CITIES !== "undefined") {
            for (const c of CITIES) {
              const ov = getOverridePrice(m.matId, c);
              if (ov !== null && ov > 0) {
                resolvedPrice = ov;
                resolvedCity = c;
                break;
              }
            }
          }
          if (resolvedPrice === null && typeof findCheapestMarketBuy === "function") {
            const realMarket = findCheapestMarketBuy(m.matId, marketData, matCitySearch);
            if (realMarket.price > 0) {
              resolvedPrice = realMarket.price;
              resolvedCity = realMarket.city;
            }
          }
          const fallbackCity = matCitySearch[0];
          const cityForSourcing = resolvedCity ?? fallbackCity;
          matBestPrices[m.matId] = {
            price: resolvedPrice ?? 0,
            city: cityForSourcing,
            sourcing: { perUnit: resolvedPrice ?? 0, source: "market", city: cityForSourcing },
          };
          return;
        }
        const market = alt?.market;
        const chainLeg = alt?.chain;
        if (market && market.perUnit > 0) {
          matBestPrices[m.matId] = {
            price: market.perUnit,
            city: market.city,
            sourcing: { perUnit: market.perUnit, source: "market", city: market.city },
          };
          // Only worth offering when it actually undercuts the buy — a chain
          // that costs more is the option the user already has by doing nothing.
          if (chainLeg && chainLeg.perUnit > 0 && chainLeg.perUnit < market.perUnit) {
            matAltChains.push({
              matId: m.matId,
              marketPerUnit: market.perUnit,
              marketCity: market.city,
              chainPerUnit: chainLeg.perUnit,
              chain: chainLeg.chain,
            });
          }
          return;
        }
        // Nothing listed. The chain is not an alternative here, it is the only
        // way to hold the ingredient — price the row off it, or the whole
        // recipe drops off the table for want of one unlisted intermediate.
        if (chainLeg && chainLeg.perUnit > 0) {
          matBestPrices[m.matId] = {
            price: chainLeg.perUnit,
            city: null,
            sourcing: { perUnit: chainLeg.perUnit, source: "chain", chain: chainLeg.chain },
            unlisted: true,
          };
          return;
        }
        allAvailable = false;
        matBestPrices[m.matId] = { price: 0, city: null, sourcing: null };
      });

      if (!allAvailable) return;

      // Total material cost (with RRR)
      let totalInputCost = 0;
      let brecilienMatFee = 0;
      recipe.forEach((m) => {
        // Per-unit consumed amount: batch count, post-RRR refund, divided by yield.
        const effectiveCount = (m.noReturn ? m.count : m.count * (1 - rrr)) / recipeOutput;
        totalInputCost +=
          matBestPrices[m.matId].price * effectiveCount * (1 + SETUP_FEE);
        // Haul a market-sourced mat out of Brecilien to the craft city (0 otherwise).
        if (typeof legBrecilienCost === "function") {
          const matFee = legBrecilienCost(matBestPrices[m.matId].city, craftCity, m.matId, effectiveCount);
          totalInputCost += matFee;
          brecilienMatFee += matFee;
        }
      });

      // Find best sell city. A sell-city force pins the row to the user's chosen
      // city, but ONLY where this craft city can legitimately reach it (royal vs
      // Caerleon section) — without that guard the force collapses the OTHER
      // section's sell list and its twin row falls back to "no market data" the
      // moment any sell override is set. An active Sell City pick outranks the
      // pin, and an unreachable pick empties the list and drops the arm
      // (js/consumable-city-pick.js).
      const forcedSellCity = getCityForce(item.id, "sell");
      const sellCitySearch = consumableSellCities(
        craftCity,
        forcedSellCity && !isInvalidCrossRoute(craftCity, forcedSellCity) ? forcedSellCity : null,
      );
      sellCitySearch.forEach((sc) => {
        if (isInvalidCrossRoute(craftCity, sc)) return;
        const sPrice = getSellPrice(marketData[item.id], sc, potBounds, item.id);
        const sVol = marketData[item.id]?.[sc]?.volume_24h || 0;
        if (sPrice > 0 && (sVol >= MIN_VOLUME || getOverridePrice(item.id, sc) !== null)) {
          // Brecilien craft spec (potions): haul finished item out → fee (free if sold in Brecilien).
          const productTravel = (typeof legBrecilienCost === "function")
            ? legBrecilienCost(craftCity, sc, item.id, 1) : 0;
          const routeCost = totalInputCost + productTravel;
          const revenue = sPrice * (1 - PREMIUM_TAX);
          const profit = revenue - routeCost;
          const margin =
            routeCost > 0 ? (profit / routeCost) * 100 : 0;
          const candidate = {
            item,
            isFlip: false,
            recipe,
            matBestPrices,
            matAltChains,
            craftCity,
            buyMat: {
              city: Object.values(matBestPrices)[0]?.city || craftCity,
              price: 0,
            },
            sellPot: { city: sc, price: sPrice },
            totalInputCost: routeCost,
            brecilienFee: brecilienMatFee + productTravel,
            marginInfo: { profit, margin, selfFoundProfit: revenue - brecilienMatFee - productTravel }, // twin: ingredients zeroed, haul legs + tax kept
            dailyVol: getCityVol(marketData, item.id, sc),
            rrr,
            hasOverride:
              recipe.some(m => getOverridePrice(m.matId, matBestPrices[m.matId]?.city) !== null) ||
              getOverridePrice(item.id, sc) !== null,
          };
          const focusCost = getFocusCost(item.id, getTierFromId(item.id), "crafting");
          // Silver/Focus + "Mats to Buy" benchmark assumes focus is ON, but
          // only when the item is actually focus-craftable. For items with
          // no craftingfocus in items.xml (fish sauce, fish chops),
          // focusCost === 0 → benchmark falls back to base RRR (matches the
          // "—" rendering in the Silver/Focus cell).
          const focusRrr = getCraftRRR(craftCity, consumableCraftType, focusCost > 0);
          const baseRrr = getCraftRRR(craftCity, consumableCraftType, false);
          // Input cost at a given return rate; the only thing focus changes here.
          const inputCostAtRrr = (atRrr) => {
            let cost = 0;
            recipe.forEach((m) => {
              const eff = (m.noReturn ? m.count : m.count * (1 - atRrr)) / recipeOutput;
              cost += matBestPrices[m.matId].price * eff * (1 + SETUP_FEE);
              if (typeof legBrecilienCost === "function") {
                cost += legBrecilienCost(matBestPrices[m.matId].city, craftCity, m.matId, eff);
              }
            });
            return cost + productTravel; // haul finished item out of Brecilien
          };
          const focusInputCost = inputCostAtRrr(focusRrr);
          const focusProfit = revenue - focusInputCost;
          // Chain-bonus profit: for any ingredient that has a chain recipe but
          // is NOT focus-craftable (focusCost === 0 on the ingredient), the
          // chain-vs-market savings are unclaimed profit — silver you keep by
          // making that ingredient yourself. Pure profit stays unchanged because
          // the headline material cost still shows market prices.
          // Example: Fancy Fish Sauce uses 45 Fish Chops; chops are chain-
          // craftable from fish but the game won't let you spend focus on the
          // chops butcher craft.
          //
          // It is reported next to Silver/Focus but NOT inside it: no focus point
          // buys it (that is exactly why it lands here rather than on the chops
          // row), and the shared standard counts only what focus itself adds.
          // Folding it in used to inflate a sauce's Silver/Focus with silver the
          // row earns whether or not a single focus point is spent.
          let chainBonusProfit = 0;
          const chainBonusBreakdown = [];
          if (typeof chainSavingsPerOutput === "function") {
            recipe.forEach((m) => {
              const savingsPerUnit = chainSavingsPerOutput(m.matId, marketData, matCitySearch, 0);
              if (!(savingsPerUnit > 0)) return;
              const effectiveCount = (m.noReturn ? m.count : m.count * (1 - focusRrr)) / recipeOutput;
              const savings = savingsPerUnit * effectiveCount * (1 + SETUP_FEE);
              chainBonusProfit += savings;
              chainBonusBreakdown.push({
                matId: m.matId,
                savings,
                perUnit: savingsPerUnit,
              });
            });
          }
          // The cook/brew step is the only place this row can put a focus point:
          // it buys the ingredients at market, so what focus adds to the finished
          // consumable is the extra ingredient value the higher return rate hands
          // back — the cost the play removes. Same standard as every other table
          // (js/focus-play.js); the old figure was the row's WHOLE profit ÷ focus,
          // which credited focus with profit the craft earns anyway.
          const bestFocusPlay = pickBestFocusPlay([
            makeFocusPlay({
              kind: "craft", itemId: item.id, focusCost,
              profitDelta: inputCostAtRrr(baseRrr) - focusInputCost,
            }),
          ]);
          const profitPerFocus = focusPlayRate(bestFocusPlay);
          const focusMatsTotal = recipe.reduce((sum, m) => {
            return sum + matsNeededFor10kFocus(focusCost, m.count / recipeOutput, true, focusRrr);
          }, 0);
          candidate.focusCost = focusCost;
          candidate.focusRrr = focusRrr;
          candidate.baseRrr = baseRrr;
          candidate.bestFocusPlay = bestFocusPlay;
          candidate.profitPerFocus = profitPerFocus;
          // A full focus bar is focus-on play, so the per-10k figure multiplies
          // the FOCUS-ON profit (focusProfit above), not the checkbox one.
          candidate.profitFocusOn = focusProfit;
          candidate.profitPer10kFocus = calculateProfitPer10kFocus(focusProfit, focusCost);
          // Self-gathered twin: ingredients at zero, haul legs + tax kept —
          // the row's own selfFoundProfit, which no return rate can move.
          const gatheredFocusOn = candidate.marginInfo.selfFoundProfit;
          candidate.profitFocusOnGathered = gatheredFocusOn;
          candidate.profitPer10kFocusGathered = (Number.isFinite(gatheredFocusOn) && focusCost > 0)
            ? calculateProfitPer10kFocus(gatheredFocusOn, focusCost) : null;
          candidate.focusMats = focusMatsTotal;
          candidate.chainBonusProfit = chainBonusProfit;
          candidate.chainBonusBreakdown = chainBonusBreakdown;
          if (!bestResult || margin > bestResult.marginInfo.margin)
            bestResult = candidate;
          bestFocusOnResult = trackFocusOnBest(bestFocusOnResult, candidate, focusProfit, focusInputCost);
          if (
            isCaerleonCity &&
            (!bestCaerleonResult ||
              margin > bestCaerleonResult.marginInfo.margin)
          )
            bestCaerleonResult = { ...candidate, section: "caerleon" };
          // Royal pick: strictly higher margin wins; on a tie (every Royal craft
          // city is interchangeable for non-spec items) prefer the candidate that
          // sells in the city it crafted in — no finished-good haul. Falls back to
          // first-seen when the best sell city isn't a Royal craft candidate.
          const sellsLocal = sc === craftCity;
          if (
            !isCaerleonCity &&
            (!bestRoyalResult ||
              margin > bestRoyalResult.marginInfo.margin ||
              (margin === bestRoyalResult.marginInfo.margin &&
                sellsLocal &&
                bestRoyalResult.craftCity !== bestRoyalResult.sellPot.city))
          )
            bestRoyalResult = { ...candidate, section: "royal" };
        }
      });
    });

    // No-data placeholders carry `item` so the sorting-filter clause that
    // keeps @-variants of expanded base rows can identify them. Without
    // `item` the filter sees no id and drops the row, which would make
    // expand-collapse appear broken for low-volume / unpriced enchant levels.
    if (isBlackRedZoneEnabled()) {
      return [withFocusOnPer10k(bestResult, bestFocusOnResult) || { item, mats: recipe, marginInfo: { margin: -1 } }];
    }
    return [
      bestRoyalResult || { item, mats: recipe, marginInfo: { margin: -1 }, section: "royal" },
      bestCaerleonResult || { item, mats: recipe, marginInfo: { margin: -1 }, section: "caerleon" },
    ];
  });

  renderTableData("consumable-table", rowData, makeConsumableRowFormatter(marketData));
}
