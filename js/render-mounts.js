// Breeding metadata. Source: Albion Online game data items.xml via
// github.com/ao-data/ao-bin-dumps. Food nutrition values are uniform within
// each category (48 for any plant, 52 for any meat). Total nutrition to grow
// an animal is tier-based (nutritionmax on the farmable item). Livestock and
// cottontails use the short-grow line with different nutrition budgets.
const BREEDING_LONG_GROW_HOURS = { 3: 44, 4: 92, 5: 140, 6: 188, 7: 236, 8: 284 };
const BREEDING_LONG_NUTRITION_MAX = { 3: 480, 4: 768, 5: 1488, 6: 3312, 7: 7920, 8: 19728 };
const BREEDING_LIVESTOCK_NUTRITION = 864;
const BREEDING_COTTONTAIL_NUTRITION = 500;

const BREEDING_SHORT_GROW_RE = /_(CHICKEN|GOAT|GOOSE|SHEEP|PIG|COW|RABBIT_EASTER)_/;
const BREEDING_MEAT_RE = /_(COUGAR|SWAMPDRAGON|DIREBEAR|DIREWOLF|DIREBOAR|GREYWOLF|OWL|SPIDER|RABBIT_EASTER_DARK)_/;

// Babies that fit none of the ladders above. Straight from items.xml
// (growtime / nutritionmax / <acceptedfood>), because nothing about them is
// derivable from the tier: the Firewing Drake Egg takes 668 h against every
// other T8 baby's 284, needs 7.5× the nutrition, and eats MOUNTS.
const BREEDING_OVERRIDES = {
  T8_FARM_DRAKE_BABY: { growHours: 668, nutritionMax: 147696, foodCategory: "mounts" },
};

const FOOD_ITEMS = {
  plants: [
    "T1_CARROT", "T2_BEAN", "T3_WHEAT", "T4_TURNIP",
    "T5_CABBAGE", "T6_POTATO", "T7_CORN", "T8_PUMPKIN",
    "T2_AGARIC", "T3_COMFREY", "T4_BURDOCK", "T5_TEASEL",
    "T6_FOXGLOVE", "T7_MULLEIN", "T8_YARROW",
  ],
  meat: ["T3_MEAT", "T4_MEAT", "T5_MEAT", "T6_MEAT", "T7_MEAT", "T8_MEAT"],
  chocolate: ["UNIQUE_CONSUMABLE_EVENT_EASTER_2020_CHOCOLATE"],
  // The Firewing Drake Egg accepts foodcategory="mount" and nothing else, so
  // raising it means feeding it whole mounts. Kept to the two mass-produced
  // lines a breeder would actually burn — riding horses and transport oxen;
  // every other mount is either rarer or a re-skin at the same nutrition.
  mounts: [
    "T3_MOUNT_HORSE", "T4_MOUNT_HORSE", "T5_MOUNT_HORSE",
    "T6_MOUNT_HORSE", "T7_MOUNT_HORSE", "T8_MOUNT_HORSE",
    "T3_MOUNT_OX", "T4_MOUNT_OX", "T5_MOUNT_OX",
    "T6_MOUNT_OX", "T7_MOUNT_OX", "T8_MOUNT_OX",
  ],
};
const FOOD_NUTRITION_PER_PIECE = { plants: 48, meat: 52, chocolate: 48 };

// Mount nutrition is NOT flat within its category the way crops (48) and meat
// (52) are — it climbs steeply with tier (items.xml <mount nutrition="…">).
// So for mounts the cheapest feed is the cheapest per NUTRITION POINT, and how
// many animals you burn depends on which one you bought.
const MOUNT_FEED_NUTRITION = { 3: 170, 4: 583, 5: 1859, 6: 5905, 7: 18699, 8: 59049 };

/** Nutrition one piece of `id` restores, for a feed category. */
function foodNutritionPerPiece(category, id) {
  if (category === "mounts") return MOUNT_FEED_NUTRITION[getTierFromId(id)] || 0;
  return FOOD_NUTRITION_PER_PIECE[category] || 0;
}

// Every id findCheapestFeed can price. The scan collectors (utils.js) call this so
// "Scan Mounts" fetches feed prices — without them every breeding row's feed reads
// "no data" even though the table's own mount/baby prices came back fine.
function getBreedingFeedIds() {
  return Object.values(FOOD_ITEMS).flat();
}

const BREEDING_OFFSPRING_PCT = {
  T3_FARM_CHICKEN: 60.0,
  T3_FARM_HORSE: 84.0,  T3_FARM_OX: 84.0,
  T4_FARM_HORSE: 78.7,  T4_FARM_OX: 78.7,  T4_FARM_GOAT: 73.3,
  T5_FARM_HORSE: 78.7,  T5_FARM_OX: 78.7,  T5_FARM_GOOSE: 80.0,
  T6_FARM_HORSE: 81.0,  T6_FARM_OX: 81.0,  T6_FARM_SHEEP: 86.7,
  T7_FARM_HORSE: 84.2,  T7_FARM_OX: 84.2,  T7_FARM_PIG: 91.1,
  T8_FARM_HORSE: 87.4,  T8_FARM_OX: 87.4,  T8_FARM_COW: 93.3,
};

function getBreedingMeta(item) {
  const babyId = item.babyId;
  const tier = parseInt(babyId.match(/^T(\d)/)?.[1] || "0", 10);
  const isShortGrow = BREEDING_SHORT_GROW_RE.test(babyId);
  const isCottontail = /_RABBIT_EASTER/.test(babyId);

  const override = BREEDING_OVERRIDES[babyId] || {};

  let foodCategory;
  if (override.foodCategory) foodCategory = override.foodCategory;
  else if (/_RABBIT_EASTER_BABY$/.test(babyId)) foodCategory = "chocolate";
  else if (BREEDING_MEAT_RE.test(babyId)) foodCategory = "meat";
  else foodCategory = "plants";

  const growHours = override.growHours
    ?? (isShortGrow ? 44 : (BREEDING_LONG_GROW_HOURS[tier] || 0));
  let nutritionMax;
  if (override.nutritionMax !== undefined) nutritionMax = override.nutritionMax;
  else if (isCottontail) nutritionMax = BREEDING_COTTONTAIL_NUTRITION;
  else if (isShortGrow) nutritionMax = BREEDING_LIVESTOCK_NUTRITION;
  else nutritionMax = BREEDING_LONG_NUTRITION_MAX[tier] || 0;

  // The headline "N × at M each" uses the animal's own tier of feed; which
  // mount actually gets bought is findCheapestFeed's call and can differ.
  const perPiece = foodNutritionPerPiece(foodCategory, `T${tier}_`) || 48;
  const piecesNeeded = Math.ceil(nutritionMax / perPiece);

  const stem = babyId.replace(/_BABY$/, "").replace(/_FW_[A-Z]+$/, "");
  const offspringPct = BREEDING_OFFSPRING_PCT[stem] ?? null;

  const foodTypeLabel = foodCategory === "plants" ? "Crops/Herbs"
    : foodCategory === "meat" ? "Meat"
    : foodCategory === "mounts" ? "Mounts" : "Chocolate";

  // Nurture mechanics from game data. Every nurture cycle costs the same
  // flat focus (1000, pre-mastery) and adds a tier-specific bonus to the
  // offspring chance. Rare mounts have 0 base offspring so nurture is the
  // only way to ever get one back.
  const nurtureRow = (typeof BREEDING_NURTURE_DATA !== "undefined" && BREEDING_NURTURE_DATA[babyId]) || null;
  // Scales with the breeding nodes set in the table's ⚙ Specs panel; 125 at max
  // spec (30,000 FCE), up to the 1,000 base for an unspecced breeder.
  const focusPerNurture = (typeof getNurtureFocusCost === "function")
    ? getNurtureFocusCost(babyId)
    : (typeof BREEDING_NURTURE_FOCUS_PER_CYCLE !== "undefined")
      ? BREEDING_NURTURE_FOCUS_PER_CYCLE : 1000;
  // The 100/100 floor, so the row's "(max spec)" qualifier is claimed only
  // when the ⚙ Specs panel figure actually IS the floor (125). At the panel's
  // defaults (Breeder 100, specialist 0) a nurture reads 500 — a real player
  // number, but calling it "max spec" was the bug.
  const focusPerNurtureMaxSpec = (typeof getNurtureFocusMaxSpec === "function")
    ? getNurtureFocusMaxSpec(babyId)
    : (typeof BREEDING_NURTURE_FOCUS_PER_CYCLE !== "undefined")
      ? BREEDING_NURTURE_FOCUS_PER_CYCLE : 125;
  const maxNurtures = nurtureRow ? nurtureRow.maxCycles : 0;
  const bonusPerNurture = nurtureRow ? nurtureRow.bonusPerCycle : 0;
  const baseOffspring = nurtureRow ? nurtureRow.baseOffspring : 0;
  const totalNurtureFocus = maxNurtures * focusPerNurture;
  // NOT clamped at 100%. A fully nurtured common animal genuinely goes over —
  // a T3 horse is 0.84 + 0.20 = 1.04 — and the slice above 100 is a real chance
  // at a SECOND baby, which the old Math.min(1, …) threw away along with the
  // tail of the nurture ladder it was paying focus for.
  const maxOffspring = baseOffspring + maxNurtures * bonusPerNurture;
  const nurtureOffspringGain = maxNurtures * bonusPerNurture;

  return {
    tier, growHours, nutritionMax, foodCategory, foodType: foodTypeLabel,
    piecesNeeded, nutritionPerPiece: perPiece, offspringPct,
    focusPerNurture, focusPerNurtureMaxSpec, maxNurtures, bonusPerNurture,
    baseOffspringPct: baseOffspring * 100,
    maxOffspringPct: maxOffspring * 100,
    nurtureGainPct: nurtureOffspringGain * 100,
    totalNurtureFocus,
  };
}

// isRrrEligible (RRR applies to refined station resources only) moved to
// js/rrr-eligible.js — the crafting list and faction spending ask the same
// question, and the enchanted-bar case has to be spelled the same way in all
// three.

// Price one candidate feed tier across the citySearch list. Mirrors the
// saddler material lookup: per-id `getCityForce` pins the search to one city
// (so user-set price overrides are honored regardless of the breeding city),
// and the force is honored only within this section's cities so a pin can't
// bleed across the royal/Caerleon split. No volume gate — feed is bought in
// any quantity, so volume is not the constraint that matters here.
// Returns { id, price, city, silverPerNutrition, pieces, totalCost } or null
// when the tier has no usable price anywhere in scope.
function evaluateFeedTier(marketData, category, citySearch, id, piecesNeeded, nutritionMax) {
  const perPiece = foodNutritionPerPiece(category, id);
  if (!perPiece) return null;
  // Crops and meat restore the same nutrition whatever their tier, so pieces
  // is the caller's tier-derived count. Mounts do not, so recount per
  // candidate from the nutrition budget.
  const pieces = category === "mounts" && nutritionMax
    ? Math.ceil(nutritionMax / perPiece)
    : piecesNeeded;
  const bounds = getIQRBounds(marketData[id]);
  const forcedBuyCity = getCityForce(id, "buy");
  const cities =
    forcedBuyCity && citySearch.includes(forcedBuyCity)
      ? [forcedBuyCity]
      : citySearch;
  let tierBest = null;
  for (const city of cities) {
    const price = getBuyPrice(marketData[id], city, bounds, id);
    if (price <= 0) continue;
    // Rank on silver per nutrition point, never on the sticker price: a T8
    // horse costs 200× a T3 one and still feeds the drake for less. For the
    // flat-nutrition categories this is the same ordering as before.
    const silverPerNutrition = price / perPiece;
    if (!tierBest || silverPerNutrition < tierBest.silverPerNutrition) {
      tierBest = {
        id, price, city, hasData: true,
        silverPerNutrition,
        pieces,
        totalCost: pieces * price,
      };
    }
  }
  return tierBest;
}

// Pick the row's feed. A tier pinned via the food-mode price editor
// (js/pinned-feed.js) wins outright — the point of the pin is "this food,
// always", so it is NOT re-ranked against every tier's fresh prices on each
// recompute. Only when the pinned tier has no price anywhere in scope does
// the cheapest-per-nutrition ranking take over; the pin itself stays stored
// for when its data returns.
//
// When no food has market data anywhere in citySearch, falls back to a
// tier-matched feed at price 0 attributed to defaultCity so the click-edit
// dropdown opens on the breeding city, not on citySearch[0] (which is Caerleon
// in BRZ — a confusing default).
function findCheapestFeed(marketData, category, citySearch, defaultCity, piecesNeeded, tier, nutritionMax) {
  const ids = FOOD_ITEMS[category] || [];
  if (!ids.length) return null;
  const pinnedId = (typeof PinnedFeed !== "undefined") ? PinnedFeed.get(category) : null;
  if (pinnedId && ids.includes(pinnedId)) {
    const pinned = evaluateFeedTier(marketData, category, citySearch, pinnedId, piecesNeeded, nutritionMax);
    if (pinned) return pinned;
  }
  let best = null;
  for (const id of ids) {
    const entry = evaluateFeedTier(marketData, category, citySearch, id, piecesNeeded, nutritionMax);
    if (!entry) continue;
    if (!best || entry.silverPerNutrition < best.silverPerNutrition) best = entry;
  }
  if (best) return best;
  const fallbackId = findTierMatchedFeedId(ids, tier);
  if (!fallbackId) return null;
  return {
    id: fallbackId, price: 0, city: defaultCity, hasData: false,
    silverPerNutrition: 0,
    pieces: piecesNeeded,
    totalCost: 0,
  };
}

function findTierMatchedFeedId(ids, tier) {
  if (!tier) return ids[0] || null;
  const sameTier = ids.find((id) => id.startsWith(`T${tier}_`));
  if (sameTier) return sameTier;
  for (let t = tier - 1; t >= 1; t--) {
    const lower = ids.find((id) => id.startsWith(`T${t}_`));
    if (lower) return lower;
  }
  return ids[0] || null;
}

/** Food category label ("Meat", "Crops/Herbs") in the current language. */
function txFood(foodType) {
  if (typeof tx !== "function" || !foodType) return foodType;
  const slug = "food_" + String(foodType).toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return tx(foodType, slug);
}

function renderMountsTable(marketData) {
  // Mount rows (breeding + craft) are always-visible valuations: the user wants
  // the silver/FP and craft margin even for thinly-traded mounts (FW saddled
  // mounts trade only a few per day, yet have real standing orders). So mount
  // price lookups are NOT gated on 24h volume — unlike the per-order tables,
  // mounts use threshold 0. IQR filtering still rejects troll orders, and the
  // Vol/24h column surfaces the thin liquidity. Mirrors the faction-spending
  // Direct column (threshold 0).
  const MOUNT_MIN_VOLUME = 0;

  // A section pool narrowed to the table's City pick for one leg
  // (js/mounts-city-pick.js); without that module every pool is used as is.
  const pickPool = (side, pool) =>
    (typeof mountsPickedPool === "function" ? mountsPickedPool(side, pool) : pool);

  // grown_farm_id -> every finishing recipe for it, declaration order
  // (js/breeding-finish.js). A row prices each and keeps the one that pays most
  // (pickFinishRow). Without that module: the old first recipe wins. Battle
  // mounts and entries with no _FARM_ input are skipped either way.
  const GROWN_FINISHES = (() => {
    if (typeof buildGrownFinishRecipes === "function") return buildGrownFinishRecipes(MOUNT_RECIPES);
    const map = {};
    for (const m of MOUNT_RECIPES) {
      if (m.craftType === "battlemount") continue;
      const grownMat = m.materials.find((x) => /^T\d_FARM_/.test(x.matId));
      if (grownMat && !map[grownMat.matId]) map[grownMat.matId] = [m];
    }
    return map;
  })();

  // Always-visible breeding rows: when no market data exists, fall back to a
  // placeholder city for that section so the row still renders with an
  // editable "no data — click to set" cell (otherwise new mounts with no
  // liquidity would silently vanish). Feed cost is added to input by scanning
  // all food items in the correct category and picking the cheapest per
  // nutrition point (food nutrition is tier-uniform, so this equals cheapest
  // per piece). When a finish `recipe` is passed, the row also
  // folds in the tame→saddled craft step (leather + heart fragments) and
  // settles to the saddled mount's market price instead of the grown one.
  const breedingRowFor = (item, buy, sell, section, buyFallback, sellFallback, recipe = null) => {
    const sellItemId = recipe ? recipe.id : item.grownId;
    const hasMarketData = !!(buy.city && sell.city);
    const effBuy = buy.city ? buy : { city: buyFallback, price: 0 };
    const effSell = sell.city ? sell : { city: sellFallback, price: 0 };
    const meta = getBreedingMeta(item);
    // Feed sourcing follows the same realm-zoning rules as saddler materials:
    // royal rows scan all royal cities, caerleon row scans only Caerleon, BRZ
    // scans everything. effBuy.city is the dropdown default for the no-data
    // fallback so the user lands on the breeding city, not citySearch[0].
    // Every pool here is narrowed to the table's City pick for its leg.
    const feedCitySearch = pickPool("buy", section === "caerleon" ? ["Caerleon"]
                         : section === "royal" ? ROYAL_CITIES
                         : CITIES);
    const feed = findCheapestFeed(
      marketData, meta.foodCategory,
      feedCitySearch, effBuy.city,
      meta.piecesNeeded, meta.tier, meta.nutritionMax,
    );
    const feedCost = feed ? feed.totalCost : 0;

    // Saddler stage materials, priced for this finish (js/render-mounts-breeding-row.js).
    const finish = priceBreedingFinishMats(recipe, {
      item, section, effBuy, marketData,
      matCitySearch: pickPool("buy", section === "caerleon" ? ["Caerleon"]
                   : section === "royal" ? ROYAL_CITIES
                   : CITIES),
      minVolume: MOUNT_MIN_VOLUME,
    });
    if (!finish) return null;
    const {
      saddlerMatCost, saddlerMatCostFocusOn, saddlerMatCostNoFocus, saddlerMatPrices,
      saddlerCity, saddlerRrr, saddlerRrrNoFocus,
      saddlerMatCostNonGathered, hasMissingSaddlerMats,
    } = finish;

    // The saddled/grown mount is produced where you operate (saddlerCity, which
    // defaults to the baby-buy city). Selling it out of Brecilien costs the
    // Travel Planner fee; selling in Brecilien (or operating elsewhere) is free.
    const mountOrigin = saddlerCity || effBuy.city;
    const sellTravel = (typeof legBrecilienCost === "function")
      ? legBrecilienCost(mountOrigin, effSell.city, sellItemId, 1) : 0;
    const totalInputCost = (effBuy.price + feedCost + saddlerMatCost) * (1 + SETUP_FEE) + sellTravel;
    let marginInfo = { margin: -1, profit: 0 };
    let baseCycleProfit = 0;
    const canScoreMargin = hasMarketData && effSell.price > 0 && totalInputCost > 0 && !hasMissingSaddlerMats;
    if (canScoreMargin) {
      const revenue = effSell.price * (1 - PREMIUM_TAX);
      // The DETERMINISTIC half of the cycle: what the grown/saddled mount sells
      // for, less what it cost to raise. Every marginal figure on this row
      // measures against this, never against the offspring-inclusive profit —
      // otherwise one baby prices the next and the row compounds on itself.
      baseCycleProfit = revenue - totalInputCost;
      // …and the STOCHASTIC half: the cycle hands a baby back. A T3 horse does
      // so 84% of the time before a single focus point is spent, and nurturing
      // lifts that past 100%. Pricing a cycle at sell − inputs valued that baby
      // at zero, which is most of what breeding pays. The nurture slice is
      // gated on the Use Focus checkbox (nurturing is what the focus buys); the
      // base slice arrives either way. See js/data-mounts.js
      // BREEDING_NURTURE_DATA for both numbers.
      const offspringUnit = Math.max(effBuy.price, baseCycleProfit);
      const offspringChance = (meta.baseOffspringPct
        + (isFocusEnabled() ? meta.nurtureGainPct : 0)) / 100;
      const offspringRevenue = offspringUnit > 0 ? offspringChance * offspringUnit : 0;
      const profit = baseCycleProfit + offspringRevenue;
      marginInfo = { profit, margin: (profit / totalInputCost) * 100 };
    }
    // The FULLY unfocused twin: base saddler RRR AND base offspring chance,
    // whatever the checkbox says. The headline above can hold two focus effects
    // at once (saddler leather + nurture), but a row only ever runs ONE focus
    // play, so the Crafting List prices its unfunded tail at this and a funded
    // unit at this + the winning play (js/craft-list-extractors.js). Equals the
    // headline when focus is off. An unscored row publishes none (null): its
    // 0 headline is no baseline to add a play to.
    const totalInputCostNoFocus =
      (effBuy.price + feedCost + saddlerMatCostNoFocus) * (1 + SETUP_FEE) + sellTravel;
    // A cycle's expected value: its margin plus `chance` offspring, each worth
    // the baby price or another cycle's margin, whichever is higher.
    const cycleValue = (cycle, chance) => {
      const unit = Math.max(effBuy.price, cycle);
      return cycle + (unit > 0 ? chance * unit : 0);
    };
    const noFocusCycleProfit = canScoreMargin
      ? effSell.price * (1 - PREMIUM_TAX) - totalInputCostNoFocus : 0;
    const profitNoFocus = canScoreMargin
      ? cycleValue(noFocusCycleProfit, meta.baseOffspringPct / 100) : null;
    // Multi-input row (baby + feed + saddler mats): no single buy id to pair, so
    // Daily Vol = the output's sell-city volume (can I sell what I breed?). The
    // old getMinVol read the output at the baby-buy city, which is ~0 when it
    // differs from the sell city and wrongly collapsed the column.
    const vol = hasMarketData ? getCityVol(marketData, sellItemId, effSell.city) : 0;

    // Focus efficiency from nurturing. An offspring baby is worth whichever is
    // higher: the buy price (what you'd pay to get one) or the margin of
    // another full breeding cycle (what it earns if you breed it instead of
    // selling). The cycle-margin fallback is what keeps FW mounts sensible —
    // their babies can't be bought, so users override the price to 1 and the
    // buy-price proxy would show ~0 silver/focus even though each offspring
    // unlocks another profitable cycle.
    const focusCost = meta.totalNurtureFocus;
    const focusMats = focusCost > 0
      ? Math.floor(10000 / focusCost) * (1 + (feed?.pieces || 0))
      : 0;
    // Both offspring valuations read the DETERMINISTIC cycle profit, never
    // marginInfo.profit — that one already carries the offspring expectation,
    // and feeding it back in would let each baby price the next.
    const offspringValue = Math.max(effBuy.price, baseCycleProfit || 0);
    // Silver/Focus (nurture) is a focus-ON benchmark: value the offspring with
    // the focus-ON cycle margin so it doesn't move when the checkbox flips the
    // saddler RRR. Equal when focus is on.
    const focusTotalInputCost =
      (effBuy.price + feedCost + saddlerMatCostFocusOn) * (1 + SETUP_FEE) + sellTravel;
    const focusCycleProfit = canScoreMargin
      ? effSell.price * (1 - PREMIUM_TAX) - focusTotalInputCost
      : (baseCycleProfit || 0);
    const offspringValueFocus = Math.max(effBuy.price, focusCycleProfit || 0);
    // The nurture PLAY is exactly marginal over the fully unfocused cycle: one
    // focus play per row, so a nurtured baby's saddler craft runs at the base
    // rate and the extra offspring is valued at that cycle. Still independent
    // of the checkbox. Unscored rows keep the focus-on benchmark.
    const nurtureOffspringValue = canScoreMargin
      ? Math.max(effBuy.price, noFocusCycleProfit) : offspringValueFocus;
    const extraOffspringSilver = nurtureOffspringValue > 0
      ? (meta.nurtureGainPct / 100) * nurtureOffspringValue : 0;

    // Saddling focus efficiency — silver saved per focus point spent on the
    // saddler craft, vs. crafting the same saddled mount without focus.
    // Marginal: (RRR_focus_on − RRR_focus_off) × eligible-mat cost ÷ focus per
    // craft. Reads as a constant benchmark ("what would focus save me here?")
    // and is independent of the global Use-Focus toggle by design — the
    // displayed input cost / profit already react to the toggle on their own.
    let saddlerFocusCost = 0;
    let saddlerRefund = 0;
    if (recipe && !hasMissingSaddlerMats) {
      saddlerFocusCost = typeof getFocusCost === "function"
        ? getFocusCost(recipe.id, getTierFromId(recipe.id)) : 0;
      if (saddlerFocusCost > 0) {
        const rrrFull = getCraftRRR(saddlerCity, null, true);
        const rrrBase = getCraftRRR(saddlerCity, null, false);
        recipe.materials.forEach((m) => {
          if (!isRrrEligible(m.matId)) return;
          const price = saddlerMatPrices?.[m.matId]?.price || 0;
          saddlerRefund += m.count * price * (rrrFull - rrrBase) * (1 + SETUP_FEE);
        });
        // On a scored row the play is exactly marginal: the saddler-only cycle
        // (focused leather, base offspring chance) minus the fully unfocused
        // one — the refund plus the base offspring chance on the higher margin.
        if (canScoreMargin) {
          saddlerRefund = cycleValue(focusCycleProfit, meta.baseOffspringPct / 100) - profitNoFocus;
        }
      }
    }

    // A breeding row has TWO places to put a focus charge, and they compete:
    // NURTURE the offspring (an extra baby, worth what a baby costs or what
    // another cycle earns — whichever is higher) or focus the SADDLER craft (a
    // higher return rate on its leather). Whichever adds more silver to what this
    // row finally SELLS wins, per the shared standard in js/focus-play.js. Before
    // it, the column always reported nurture and the saddler figure was computed
    // and never shown, so a row whose saddler play was worth several times more
    // was silently mispriced.
    const bestFocusPlay = pickBestFocusPlay([
      makeFocusPlay({ kind: "nurture", itemId: item.babyId,
        focusCost, profitDelta: extraOffspringSilver }),
      makeFocusPlay({ kind: "saddler", itemId: recipe ? recipe.id : null,
        focusCost: saddlerFocusCost, profitDelta: saddlerRefund }),
    ]);
    const profitPerFocus = focusPlayRate(bestFocusPlay);
    const saddlerProfitPerFocus = saddlerFocusCost > 0 ? saddlerRefund / saddlerFocusCost : 0;

    // What the cycle is worth if the user fully nurtures — the FULL offspring
    // chance, base plus nurture, whatever the checkbox says. Profit itself is
    // checkbox-gated (the nurture slice is what the focus buys), so with focus
    // on the two are equal and the column reads "—"; with focus off this is
    // what turning it on would be worth. Only meaningful when the deterministic
    // cycle is already profitable — no point nurturing a loss.
    const nurtureEv = (baseCycleProfit > 0 && meta.maxNurtures > 0)
      ? baseCycleProfit
        + ((meta.baseOffspringPct + meta.nurtureGainPct) / 100) * offspringValue
      : marginInfo.profit;

    // Focus-ON twin, for the per-10k-focus columns: those price a whole
    // 10,000-focus bar, which IS focus-on play, so they must never track the
    // checkbox. The bar buys NURTURES only (focusCost = totalNurtureFocus), so
    // the saddler craft runs at the base rate: counting its focus RRR here
    // added a gain whose focus the bar never pays for. The whole offspring
    // chance counts unconditionally. Unscored rows keep the focus-on cycle.
    const nurtureCycle = canScoreMargin ? noFocusCycleProfit : focusCycleProfit;
    const nurtureEvFocusOn = (nurtureCycle > 0 && meta.maxNurtures > 0)
      ? nurtureCycle
        + ((meta.baseOffspringPct + meta.nurtureGainPct) / 100) * nurtureOffspringValue
      : nurtureCycle;

    // SELF-FOUND twin of that benchmark: the same focus-ON bar priced as if the
    // baby were self-bred from your own stock, so its whole effBuy.price term —
    // setup-fee share included — leaves the cost basis, while surplus offspring
    // keep their value (each one is worth the baby price on the market or the
    // margin of your next self-found cycle, whichever pays more). Still a
    // focus-ON figure (full offspring chance) that must not track the checkbox,
    // with the saddler at the base rate: the bar bills nurture focus only.
    const selfFoundTotalInputCost =
      (feedCost + saddlerMatCostNoFocus) * (1 + SETUP_FEE) + sellTravel;
    const selfFoundCycleProfit = canScoreMargin
      ? effSell.price * (1 - PREMIUM_TAX) - selfFoundTotalInputCost
      : (baseCycleProfit || 0);
    const selfFoundOffspringValue = Math.max(effBuy.price, selfFoundCycleProfit || 0);
    const selfFoundNurtureEvFocusOn = (selfFoundCycleProfit > 0 && meta.maxNurtures > 0)
      ? selfFoundCycleProfit
        + ((meta.baseOffspringPct + meta.nurtureGainPct) / 100) * selfFoundOffspringValue
      : selfFoundCycleProfit;

    // SELF-GATHERED twin: the BOUGHT bar (baby still bought at effBuy.price)
    // with the feed and the saddler's gatherable mats (RRR-eligible refined
    // leather, same rule as the Mounts craft row's twin) at zero. It is NOT
    // stacked on the self-found twin: line 3 of the cell is "babies bought,
    // gatherable mats self-gathered". Feed is zeroed like the Consumables
    // pasture chain row's twin zeroes its feed. Non-returnable saddler inputs
    // and the sell travel leg stay. With the leather free there is no RRR
    // slice left, so the base-rate vs focus-rate question disappears.
    const gatheredTotalInputCost =
      (effBuy.price + saddlerMatCostNonGathered) * (1 + SETUP_FEE) + sellTravel;
    const gatheredCycleProfit = canScoreMargin
      ? effSell.price * (1 - PREMIUM_TAX) - gatheredTotalInputCost
      : (baseCycleProfit || 0);
    const gatheredOffspringValue = Math.max(effBuy.price, gatheredCycleProfit || 0);
    const gatheredNurtureEvFocusOn = (gatheredCycleProfit > 0 && meta.maxNurtures > 0)
      ? gatheredCycleProfit
        + ((meta.baseOffspringPct + meta.nurtureGainPct) / 100) * gatheredOffspringValue
      : gatheredCycleProfit;

    // What the focus ALONE adds to one nurtured baby under each of the three
    // plans (a reported case, 2026-10-07: "Profit / 10k Focus should show only the
    // additional profit from focus"): the nurture slice of the offspring
    // chance, each extra baby worth the baby price or that plan's own unfocused
    // cycle, whichever is higher. The base offspring chance and the cycle's
    // own margin arrive without any focus, so they stay out. Same nurture-only
    // bill as before (saddler at the base rate): the bar pays for nurtures.
    const nurtureGainOf = (cycle) => {
      const unit = Math.max(effBuy.price, Number(cycle) || 0);
      return unit > 0 ? (meta.nurtureGainPct / 100) * unit : 0;
    };
    const nurtureGainFocusOn = extraOffspringSilver;
    const selfFoundGainFocusOn = nurtureGainOf(selfFoundCycleProfit);
    const gatheredGainFocusOn = nurtureGainOf(gatheredCycleProfit);

    // FP outlay = baby + every FP-priced material in the saddler recipe.
    // Charges nothing for FP-free items (leather, hide, grown mount).
    let totalFpCost = 0;
    let fpMatSilverCost = 0; // silver cost we'll back out of the profit when computing silver/FP
    // Each FP-priced input is also an FP PLACEMENT — buy the baby with FP, or
    // the saddler's hearts, or both. silverSaved is what that input costs on the
    // market; the placement is scored on the whole cycle's silver per FP spent
    // (js/faction-focus-value.js, pickBestFpPlay).
    const fpPlays = [];
    if (typeof getFpCost === "function") {
      const babyFp = getFpCost(item.babyId);
      if (babyFp > 0) {
        totalFpCost += babyFp;
        fpMatSilverCost += effBuy.price; // 1× baby
        fpPlays.push({ input: "baby", itemId: item.babyId, count: 1,
          fpCost: babyFp, silverSaved: effBuy.price * (1 + SETUP_FEE) });
      }
      if (recipe && recipe.materials) {
        recipe.materials.forEach((m) => {
          const fpPer = getFpCost(m.matId);
          if (fpPer > 0) {
            totalFpCost += fpPer * m.count;
            const matPrice = saddlerMatPrices?.[m.matId]?.price || 0;
            const eff = isRrrEligible(m.matId) ? m.count * (1 - saddlerRrr) : m.count;
            fpMatSilverCost += matPrice * eff;
            fpPlays.push({ input: "mat", itemId: m.matId, count: m.count,
              fpCost: fpPer * m.count, silverSaved: matPrice * eff * (1 + SETUP_FEE) });
          }
        });
      }
    }
    // Profit if FP-priced inputs are treated as 0 silver (since you pay in FP, not silver).
    // Adds back the silver we charged for the FP-priced mats, scaled by setup-fee.
    // An unprofitable all-silver cycle can still be FP-profitable when most of the
    // cost is FP-priced (hearts, baby) — that's the whole point of paying in FP.
    const fpAdjustedProfit = canScoreMargin
      ? (nurtureEv || marginInfo.profit) + fpMatSilverCost * (1 + SETUP_FEE)
      : 0;
    // Focus-ON twin, basis for the Faction Spending "profit / 10k focus (FP
    // inputs)" column — that column spends a focus bar, so it can't follow the
    // Use Focus checkbox (js/faction-focus-value.js).
    const fpAdjustedProfitFocusOn = canScoreMargin
      ? (nurtureEvFocusOn || focusCycleProfit) + fpMatSilverCost * (1 + SETUP_FEE)
      : 0;
    const silverPerFp = (typeof calculateSilverPerFp === "function" && totalFpCost > 0 && fpAdjustedProfit > 0)
      ? calculateSilverPerFp(fpAdjustedProfit, totalFpCost)
      : 0;

    // FP placements, each priced as the cycle S/FP (Bred) prices all of them at
    // once: the cycle profit with every input bought (the same nurture EV basis
    // as fpAdjustedProfit) plus the silver that placement's inputs no longer
    // cost, over that placement's FP. With more than one FP input the
    // "everything with FP" placement joins the list, and it is exactly
    // S/FP (Bred), so Best FP can never read below the bred column.
    if (fpPlays.length > 1) {
      fpPlays.push({ input: "all", itemId: null, count: 1,
        items: fpPlays.map((p) => ({ itemId: p.itemId, count: p.count })),
        fpCost: totalFpCost,
        silverSaved: fpPlays.reduce((n, p) => n + p.silverSaved, 0) });
    }
    const fpBaseProfit = canScoreMargin ? (nurtureEv || marginInfo.profit) : 0;
    fpPlays.forEach((p) => { p.cycleProfit = fpBaseProfit + p.silverSaved; });
    const bestFpPlay = (canScoreMargin && typeof pickBestFpPlay === "function")
      ? pickBestFpPlay(fpPlays) : null;

    // Favor-denominated breeding — Brecilien Mystic Owls are bought with Favor
    // (Eralia Wayfarer), not Faction Points, so their breeding efficiency is
    // silver/Favor. Only the baby is Favor-priced; saddler mats (leather, Faerie
    // Fire) are bought on the market like any other, so favorAdjustedProfit adds
    // back only the baby's silver price (mirrors fpAdjustedProfit's logic).
    const babyFavorCost = (typeof getBabyFavorCost === "function") ? getBabyFavorCost(item.babyId) : 0;
    const totalFavorCost = babyFavorCost > 0 ? babyFavorCost : 0;
    const favorAdjustedProfit = (canScoreMargin && totalFavorCost > 0)
      ? (nurtureEv || marginInfo.profit) + effBuy.price * (1 + SETUP_FEE)
      : 0;
    const silverPerFavor = (typeof calculateSilverPerFavor === "function" && totalFavorCost > 0 && favorAdjustedProfit > 0)
      ? calculateSilverPerFavor(favorAdjustedProfit, totalFavorCost)
      : 0;

    // Masterpiece bonus from the saddler craft — independent of nurture; one
    // 0.1% MP roll per saddler craft per cycle (saddler spec adds RRR but no
    // quality bonus per the wiki). Section-aware sell pick so royal rows can't
    // sell MP at Caerleon. Display layer hides the annotation when no MP data.
    const mpSellCitySearch = pickPool("sell", section === "caerleon" ? ["Caerleon", "Black Market"]
                           : section === "royal"   ? ROYAL_CITIES
                           : SELL_CITIES);
    const mpBonus = (typeof computeMpBonus === "function")
      ? computeMpBonus({
          mpMarketData: typeof lastMpMarketData !== "undefined" ? lastMpMarketData : null,
          mountId: sellItemId,
          sellCitySearch: mpSellCitySearch,
          excludeBuyCity: effBuy.city,
          mpChance: typeof MOUNT_MP_CHANCE !== "undefined" ? MOUNT_MP_CHANCE : 0.001,
          premiumTax: PREMIUM_TAX,
          setupFee: SETUP_FEE,
          nurtureEv,
          fpMatSilverCost,
          totalFpCost,
          // Favor path (Brecilien owls): only the baby is Favor-priced.
          favorMatSilverCost: totalFavorCost > 0 ? effBuy.price : 0,
          totalFavorCost,
        })
      : { mpSellCity: null, mpSellPrice: 0, mpRevenuePerCycle: 0, mpSilverPerFp: 0, mpSilverPerFavor: 0 };

    // Own-baby sale: raw FP/Favor ratio + sell-vs-raise (js/render-mounts-breeding-row.js).
    const babySale = babySaleFields({
      item, marginInfo, effBuyPrice: effBuy.price, totalFavorCost, canScoreMargin,
      best: (typeof findBestSellCity === "function")
        ? findBestSellCity(marketData, item.babyId,
            pickPool("sell", section === "caerleon" ? ["Caerleon"]
                           : section === "royal" ? ROYAL_CITIES
                           : CITIES), 0, null)
        : { city: null, price: 0 },
    });

    return {
      item, isBreeding: true, isCraft: false,
      // Carried, not recomputed by the row renderer: getBreedingMeta prices a
      // nurture off the ⚙ Specs levels, and this pass is the one that runs
      // inside the table's spec scope.
      meta,
      buyMat: effBuy, sellPot: effSell,
      matBestPrices: null,
      feed, feedCost,
      recipe, saddlerMatPrices, saddlerCity, saddlerRrr, saddlerRrrNoFocus, sellItemId,
      saddlerMatCost, hasMissingSaddlerMats,
      saddlerFocusCost, saddlerProfitPerFocus,
      totalInputCost, totalInputCostNoFocus, profitNoFocus,
      brecilienFee: sellTravel,
      marginInfo, dailyVol: vol, rrr: 0,
      focusCost, focusMats, profitPerFocus, bestFocusPlay, nurtureEv,
      // What the winning play adds to THIS row's headline — 0 unless the
      // headline actually includes it. `marginInfo` is checkbox-gated (the
      // nurture slice is exactly what the focus buys) while profitPerFocus and
      // profitFocusOn deliberately are not, so a caller pricing the crafts a
      // finite focus budget cannot cover has to be told which is which
      // (js/craft-list-focus-budget.js).
      focusProfitDelta: (isFocusEnabled() && bestFocusPlay && bestFocusPlay.focusCost > 0)
        ? bestFocusPlay.profitDelta : 0,
      // The nurture play on its own — the focus the Profit / 10k Focus column
      // prices. The Crafting List funds this play on a breeding row, so the
      // gain that column shows is the gain its Total Profit adds.
      nurtureProfitDelta: nurtureGainFocusOn,
      // 10k focus = N fully-nurtured babies; each nurtured baby is one cycle.
      // Prices the FOCUS-ON cycle (focus-on saddler RRR) INCLUDING the offspring
      // it returns: a focus bar is focus-on play, so this must not move with the
      // Use Focus checkbox, and a bar of nurtures that never counted the babies
      // it produced was pricing the one thing the focus was spent on at zero.
      profitFocusOn: nurtureEvFocusOn || 0,
      // Profit / 10k Focus is the focus-ONLY gain of one bar of nurtures: the
      // extra offspring each nurtured baby yields × the babies a bar covers.
      // Never the cycle's own margin, which needs no focus.
      profitFocusGain: nurtureGainFocusOn,
      profitPer10kFocus: calculateProfitPer10kFocus(nurtureGainFocusOn, focusCost),
      // Self-found twin feeding the same cell's dimmed secondary line — the
      // self-bred baby's zero acquisition cost raises the cycle an extra
      // offspring can be bred into.
      profitFocusOnSelfFound: selfFoundNurtureEvFocusOn || 0,
      profitFocusGainSelfFound: selfFoundGainFocusOn,
      profitPer10kFocusSelfFound: calculateProfitPer10kFocus(selfFoundGainFocusOn, focusCost),
      // Self-gathered twin: baby BOUGHT, feed and saddler leather self-gathered.
      profitFocusOnGathered: gatheredNurtureEvFocusOn || 0,
      profitFocusGainGathered: gatheredGainFocusOn,
      profitPer10kFocusGathered: calculateProfitPer10kFocus(gatheredGainFocusOn, focusCost),
      totalFpCost, silverPerFp, fpAdjustedProfit, fpAdjustedProfitFocusOn,
      fpPlays, bestFpPlay,
      totalFavorCost, silverPerFavor, favorAdjustedProfit,
      mpSellCity: mpBonus.mpSellCity,
      mpSellPrice: mpBonus.mpSellPrice,
      mpRevenuePerCycle: mpBonus.mpRevenuePerCycle,
      mpSilverPerFp: mpBonus.mpSilverPerFp,
      mpSilverPerFavor: mpBonus.mpSilverPerFavor,
      ...babySale,
      hasOverride: !!(
        getOverridePrice(item.babyId, effBuy.city) ||
        getOverridePrice(sellItemId, effSell.city) ||
        (feed && feed.city && getOverridePrice(feed.id, feed.city) !== null) ||
        (recipe && saddlerMatPrices && recipe.materials.some((m) =>
          m.matId !== item.grownId &&
          saddlerMatPrices[m.matId]?.city &&
          getOverridePrice(m.matId, saddlerMatPrices[m.matId].city) !== null
        ))
      ),
      section,
    };
  };

  // --- BREEDING FLIP ROWS ---
  const breedingRows = BREEDING_ITEMS.flatMap((item) => {
    const finishes = GROWN_FINISHES[item.grownId] || [null];
    // One section's row, its baby / sale searched in that section's pools
    // narrowed to the City picks. A pool the pick empties means the section
    // cannot honour it (a royal row cannot buy in Caerleon or sell at the Black
    // Market), so no row is built there. With a pick active the placeholder
    // city for an unpriced leg is the pick itself; with none, pickPool hands the
    // very same array back and the section's historical fallback stands.
    const arm = (babyPool, sellPool, section, fallback) => {
      const buyCities = pickPool("buy", babyPool);
      const sellCities = pickPool("sell", sellPool);
      if (!buyCities.length || !sellCities.length) return null;
      const baby = findBestBuyCity(marketData, item.babyId, buyCities, MOUNT_MIN_VOLUME);
      // One row per finishing recipe; the best-paying finish is the row.
      const rows = finishes.map((recipe) => {
        const sell = findBestSellCity(marketData, recipe ? recipe.id : item.grownId,
          sellCities, MOUNT_MIN_VOLUME, baby.city, baby.city);
        return breedingRowFor(item, baby, sell, section,
          buyCities === babyPool ? fallback : buyCities[0],
          sellCities === sellPool ? fallback : sellCities[0], recipe);
      }).filter(Boolean);
      return typeof pickFinishRow === "function"
        ? pickFinishRow(rows, PREMIUM_TAX, SETUP_FEE) : (rows[0] || null);
    };
    if (isBlackRedZoneEnabled()) {
      return [arm(CITIES, SELL_CITIES, undefined, CITIES[0])].filter(Boolean);
    }

    // Separate routes: find buy/sell cities independently for baby and saddled (or grown) items
    return [
      arm(ROYAL_CITIES, ROYAL_CITIES, "royal", ROYAL_CITIES[0]),
      arm(["Caerleon"], ["Caerleon", "Black Market"], "caerleon", "Caerleon"),
    ].filter(Boolean);
  });

  // --- MOUNT CRAFT ROWS --- (js/render-mounts-craft-row.js)
  const craftRows = (typeof buildMountCraftRows === "function")
    ? buildMountCraftRows(marketData, MOUNT_MIN_VOLUME) : [];

  const rowData = [...breedingRows, ...craftRows];

  renderTableData("mounts-table", rowData, (row, rowIdx) => {
    if (!row.item) return "";
    const rowKey = getRowKey(row, "mounts-table");

    if (row.isBreeding) return renderBreedingMountRow(row, rowIdx, rowKey);

    return renderMountCraftRow(row, rowIdx, rowKey);
  });
}
