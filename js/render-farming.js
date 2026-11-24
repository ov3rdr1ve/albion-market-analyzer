// Farming production simulator. Replaces the earlier flip-only table.
//
// Each FARMING_PRODUCTION entry renders one row that simulates a single
// plot of farming/herbalism, or one slot of pasture for animal byproducts.
// Columns surface the per-cycle yield (including the +10% city bonus),
// profit per cycle, profit per day, and silver/focus when watering is enabled.
//
// A pasture row is a FEED cycle, not a breeding one: the grown animal eats
// 9 favorite crops per 22h and hands over 8-11 eggs/milk (x2.1 with Premium
// in the byproduct's bonus city — the +100% and +10% Product Yield sum once)
// without being consumed. So its buy leg is the feed crop, the animal is shown
// as one-off capital, and it has no focus play at all — nurturing is a play on
// a BABY, priced in the Mounts table.
//
// City routing — three independent legs (js/farming-row-econ.js):
//   - Seed/feed buy city: the cheapest listing in the active pool. Seeds are
//     freight, so they are carried to the plot rather than bought at it.
//   - Farm city: the city whose whole cycle pays best — in practice the +10%
//     local production bonus city, now that a dear local seed can no longer
//     push the plot somewhere else.
//   - Output sell city: best sell listing across the active sell-city pool.
//   - Bonus city: the +10% farming spec city for this output. Highlighted when
//     the chosen farm city is one of them.

function renderFarmingTable(marketData) {
  const MIN_BUY_VOLUME = getOrderType("buy") === "market" ? 25 : 0;
  const MIN_SELL_VOLUME = getOrderType("sell") === "market" ? 25 : 0;
  const focusOn = (typeof isFocusEnabled === "function") ? isFocusEnabled() : true;
  // Premium adds +100% Product Yield (it also halves grow time, which this table
  // no longer models — growing is breeding, not a produce cycle).
  const premium = (typeof isPremiumEnabled === "function") ? isPremiumEnabled() : true;

  const rowData = FARMING_PRODUCTION.flatMap((item) => {
    const buildRow = (citySearch, sellCities, section) => {
      const bonusCities = findFarmingBonusCities(item.outputId);

      // Focus per cycle — scales with the crop/herb nodes set in ⚙ Specs.
      //
      // Only a crop or herb plot has a focusable step (watering). A pasture
      // row's `id` is the FEED crop, which the cycle BUYS rather than grows, so
      // watering it belongs to that crop's own row: pricing it here printed a
      // 1,000-focus cost this row can never spend (the feed crops are absent
      // from FOCUS_SPEC_ITEM_FAMILY, so no specialization even reduced it).
      //
      // getFarmingFocusCost is the charge for ONE SEED (js/data-farming.js). The
      // game waters — and bills — every planted seed separately, so a full
      // 9-slot plot costs nine of them, 1,125 at max spec. One focus PLAY here is
      // one whole watered cycle, and `wateringProfitDelta` below is likewise the
      // gain over all nine slots, so the two have to be on the same footing:
      // billing a single seed's 125 for a nine-slot gain overstated every
      // Farming Silver/Focus and Profit / 10k Focus figure ninefold.
      const focusPerSeed = (typeof getFarmingFocusCost === "function")
        ? getFarmingFocusCost(item.id)
        : (typeof FARMING_FOCUS_PER_SEED !== "undefined") ? FARMING_FOCUS_PER_SEED : 125;
      const seedSlots = item.plotsPerCycle || 9;
      const focusPerCycle = item.type === "byproduct" ? 0 : focusPerSeed * seedSlots;

      // Where to farm is a decision of its own, separate from where the seed is
      // bought: the farm city decides whether the +10% local production bonus
      // lands on the seed yield, and it is the origin the harvest is hauled
      // from. js/farming-row-econ.js scores every candidate city end to end,
      // sourcing the seed across the whole pool for each one.
      // `altFarm` is the counterpart city the row passed over — the best
      // candidate on the other side of the +10% line, scored end to end the
      // same way. The Profit cells print it as a muted second line so the
      // table answers "what is the bonus worth?" and not only "is there one?".
      const { farmCity, seedBuy, cropSell, seedSell, wormSell, animalBuy, cityYieldBonus, econ, altFarm, seedPriced } = evaluateFarmingRow(
        item, citySearch, sellCities,
        { minVolume: MIN_BUY_VOLUME, minSellVolume: MIN_SELL_VOLUME, focusOn, focusPerCycle, premium },
        {
          marketData, findBestBuyCity, findBestSellCity,
          getFarmingYieldBonus: (typeof getFarmingYieldBonus === "function") ? getFarmingYieldBonus : null,
          calcFarmingEconomics: (typeof calcFarmingEconomics === "function") ? calcFarmingEconomics : null,
          getCityForce: (typeof getCityForce === "function") ? getCityForce : null,
        },
      );

      // The one focusable step of a farm cycle, scored by the shared standard
      // (js/focus-play.js). Crops and herbs spend it WATERING — worth the profit a
      // watered cycle makes over a dry one. A pasture row has NO focus play:
      // items.xml puts activefarmfocuscost on the BABY (nurturing for an extra
      // offspring, priced in the Mounts table), and the grown animal's <products>
      // cycle costs no focus at all. Focus buys no extra eggs or milk.
      // A row that does not know what its seeds cost knows nothing about what
      // watering them is worth either: econ was computed from a FREE seed, so
      // every figure derived from it is revenue wearing a profit's name.
      const bestFocusPlay = (item.type !== "byproduct" && seedPriced && typeof pickBestFocusPlay === "function")
        ? pickBestFocusPlay([makeFocusPlay(
            { kind: "water", itemId: item.id, focusCost: focusPerCycle,
              profitDelta: econ.wateringProfitDelta || 0 })])
        : null;

      // Margin denominator: what the cycle SPENT per output. Above 100% yield
      // the net seed cost is revenue (negative), and dividing by it would flip
      // the margin's sign, so a surplus row falls through to the "no input
      // cost" branch below and shows the 999 sentinel instead.
      const totalInputCost = seedPriced
        ? Math.max(0, econ.netSeedCostPerOutput) * (1 + SETUP_FEE)
        : 0;
      // Without a seed price the row has no input cost it can vouch for, so it
      // takes the same -1 "nothing to divide by" sentinel an unprofitable
      // surplus row takes — never the 999 a free seed would otherwise mint.
      const margin = totalInputCost > 0
        ? (econ.profitPerOutput / totalInputCost) * 100
        : ((seedPriced && econ.profitPerOutput > 0) ? 999 : -1);

      // Bottleneck of the two REAL legs: buy the SEED at seedBuy.city, sell the
      // CROP at cropSell.city. Reading the output at the seed-buy city (the old
      // getMinVol call) understated it — crops rarely list where seeds are sold.
      const vol = getMinVol2(marketData, item.id, seedBuy.city, item.outputId, cropSell.city);

      // Seeds a whole 10,000-focus bar plants, and how many of them must actually
      // be bought. matsNeededFor10kFocus (js/utils.js) owns the bar division, so
      // this file keeps its single local bar division in the tooltip below.
      //
      // Divided by focusPerCycle, not by the play: this is focus-and-yield
      // arithmetic — how many plots a bar waters — and it holds whether or not
      // the row can price what that watering is worth. Reading the cost off the
      // play printed "0x seeds" beside "72 plots" on an unpriced row.
      const barSeeds = (count) => ((typeof matsNeededFor10kFocus === "function" && focusPerCycle > 0)
        ? matsNeededFor10kFocus(focusPerCycle, count)
        : 0);
      const seedsPer10kFocus = barSeeds(seedSlots);
      // Seeds TO BUY follow the Use Focus checkbox: a plot grown dry returns
      // fewer seeds (91.1% on a T7 herb) than a watered one (108.9%), and quoting
      // the watered figure with focus off read "self-seeding" on a plot that is
      // not. Planted seeds above stay the bar's own arithmetic.
      const seedYieldShown = focusOn ? (econ.wateredSeedYield || 0) : (econ.drySeedYield || 0);
      const seedsToBuyPer10kFocus = barSeeds(
        (focusOn ? (econ.seedsBoughtPerOutputFocusOn || 0) : (econ.seedsBoughtPerOutputNoFocus || 0))
          * (econ.outputsPerCycle || 0),
      );

      return {
        item,
        farmCity,
        buySeed: seedBuy,
        sellCrop: cropSell,
        sellSeed: seedSell,
        sellWorm: wormSell || { city: null, price: 0, travelCost: 0 },
        wormsPerCycle: econ.wormsPerCycle || 0,
        wormRevenuePerCycle: econ.wormRevenuePerCycle || 0,
        buyAnimal: animalBuy || { city: null, price: 0, travelCost: 0 },
        surplusSeedsPerCycle: econ.surplusSeedsPerCycle || 0,
        seedRevenuePerCycle: econ.seedRevenuePerCycle || 0,
        bonusCities,
        cityYieldBonus,
        cycleHours: item.cycleHours,
        totalSeedYield: econ.totalSeedYield,
        outputsPerCycle: econ.outputsPerCycle,
        profitPerCycle: econ.profitPerCycle,
        profitPerDay: econ.profitPerDay,
        profitPerFocus: focusPlayRate(bestFocusPlay),
        bestFocusPlay,
        // Throughput, not the marginal rate beside it: what a whole 10,000-focus
        // bar spent HERE is worth, so the figure is comparable with Crafting,
        // Refining, Consumables and Mounts (and can rank on the focus board).
        // Priced on the WATERED cycle so it never moves with the Use Focus
        // checkbox. A row with no focus play carries focusCost 0 and the shared
        // helper returns 0 — the cell renders "—" rather than a false zero.
        //
        // Taken from focusPerCycle rather than the play: the two are the same
        // number (makeFocusPlay is built from it), but the watering CHARGE is a
        // fact about the plot, not about whether the row can price the play.
        // An unpriced seed suppresses the play, and reading the cost off it took
        // the Seeds to Plant shopping list — pure focus/yield arithmetic — down
        // with the silver figures.
        focusCost: item.type === "byproduct" ? 0 : focusPerCycle,
        focusPerSeed,
        seedSlots,
        // "Seeds to Plant (10k Focus)" — the shopping-list twin of the throughput
        // figure above, and the counterpart of every other table's "Mats to Buy
        // (10k Focus)". A bar waters whole cycles, one seed per slot, so the
        // seeds it plants are slots × those cycles. `seedsToBuy` is the same
        // count NET of the seed return, which is the convention Consumables uses
        // for the resource return rate. Planted seeds never follow the Use Focus
        // checkbox; seeds to buy DO (see seedYieldShown above): a watered plot is
        // at or above 100% and the cell says "self-seeding", a dry one is below
        // it and buys the shortfall.
        // matsNeededFor10kFocus (js/utils.js) owns the bar division; no second
        // bar division belongs in this file.
        seedsPer10kFocus,
        seedsToBuyPer10kFocus,
        wateredSeedYield: econ.wateredSeedYield || 0,
        seedYieldShown,
        // The sort key the other 10k-focus shopping columns already use
        // (js/sorting.js reads `focusMats` for every table).
        focusMats: seedsPer10kFocus,
        // Per-CROP siblings of the two per-cycle figures above, for consumers
        // that count harvested outputs rather than cycles — My Crafting List
        // scales every field by a crop quantity, and billing it the CYCLE's
        // watering focus read 1.8M focus for a 15,000-potato basket. The
        // table's own columns keep using the per-cycle figures beside them.
        focusPerOutput: econ.outputsPerCycle > 0
          ? (bestFocusPlay ? bestFocusPlay.focusCost : 0) / econ.outputsPerCycle
          : 0,
        // The seed leg as a per-crop COUNT, in both of the states the crafting
        // list's focus budget puts a crop in. Funded means WATERED by
        // definition — like profitPerCycleFocusOn, it must not follow the Use
        // Focus checkbox — and unfunded means the plot was grown dry, which for
        // every crop and herb is below 100% seed return and therefore buys
        // seeds. Passing only the displayed cycle's figure left a partly
        // focused basket with an empty "Materials to Buy" board.
        seedsPerOutput: econ.seedsBoughtPerOutputFocusOn || 0,
        seedsPerOutputNoFocus: econ.seedsBoughtPerOutputNoFocus || 0,
        // What the watering actually adds to THIS row's headline profit, per
        // crop. 0 when the checkbox is off: marginInfo below is then already
        // the dry figure, and profitPerFocus / profitFocusOn beside it stay the
        // invariant watered benchmarks they are meant to be.
        focusProfitPerOutput: (focusOn && bestFocusPlay)
          ? (econ.wateringProfitDeltaPerOutput || 0) : 0,
        // The same cycle farmed on the other side of the +10% line. Usually the
        // best NON-bonus city (the headline took the bonus), but the roles swap
        // when the bonus city loses the row, and `altHasBonus` says which way
        // round it is. Null on a one-city pool, an output nobody specializes
        // in, or a pool where every candidate has the bonus.
        altFarmCity: altFarm ? altFarm.farmCity : null,
        altHasBonus: !!(altFarm && altFarm.cityYieldBonus > 0),
        altProfitPerCycle: altFarm ? (altFarm.econ.profitPerCycle || 0) : 0,
        altProfitPerDay: altFarm ? (altFarm.econ.profitPerDay || 0) : 0,
        profitFocusOn: econ.profitPerCycleFocusOn || 0,
        profitPer10kFocus: calculateProfitPer10kFocus(
          econ.profitPerCycleFocusOn || 0,
          bestFocusPlay ? bestFocusPlay.focusCost : 0,
        ),
        totalInputCost,
        marginInfo: { profit: econ.profitPerOutput, margin },
        dailyVol: vol,
        section,
        seedPriced,
        hasOverride: !!(
          getOverridePrice(item.id, seedBuy.city) ||
          getOverridePrice(item.outputId, cropSell.city)
        ),
      };
    };

    if (isBlackRedZoneEnabled()) {
      return [buildRow(CITIES, SELL_CITIES, "all")];
    }
    return [
      buildRow(ROYAL_CITIES, ROYAL_CITIES, "royal"),
      buildRow(["Caerleon"], ["Caerleon", "Black Market"], "caerleon"),
    ];
  });

  renderTableData("farming-table", rowData, (row, rowIdx) => {
    if (!row.item) return "";
    const rowKey = getRowKey(row, "farming-table");
    const typeBadge = row.item.section === "crops" ? tx("Crop", "r_crop")
                    : row.item.section === "herbs" ? tx("Herb", "r_herb")
                    : tx("Byproduct", "r_byproduct");
    const bonusBadge = renderFarmingBonusBadge(row);
    const yieldDisplay = renderFarmingYieldCell(row);
    const cycleDisplay = `${row.cycleHours}h`;
    const profitCycleDisplay = formatSilver(row.profitPerCycle || 0);
    const profitDayDisplay = formatSilver(row.profitPerDay || 0);
    const profitFocusDisplay = (row.profitPerFocus || 0) > 0
      ? formatSilver(row.profitPerFocus)
      : '<span style="color:#6b7280;font-style:italic">—</span>';
    // Profit / 10k Focus — the whole bar's throughput, the counterpart to the
    // marginal Silver/Focus cell beside it. A farming focus play costs one
    // cycle's watering, so "cycles" is literal: this many waterings fit in a
    // bar. Pasture rows have no focus play and render "—" here.
    const cyclesWithFocus = row.focusCost ? (typeof focusBarCrafts === "function" ? focusBarCrafts(row.focusCost) : Math.floor(10000 / row.focusCost)) : 0;
    const p10k = row.profitPer10kFocus || 0;
    // Every silver figure on this row is (revenue − seed cost). With no seed
    // price the subtraction never happened, so the numbers would be revenue
    // presented as profit — a Ghoul Yarrow plot reading +384/cycle on seeds
    // nobody has quoted. The row still shows what it does know: the route, the
    // farm city, the +10% bonus, the yield and the crop's own sell price.
    const seedUnpriced = row.seedPriced === false;
    const seedUnpricedTip = tx("Seed price unknown — click the Buy cell to set one", "r_farming_seed_unpriced");
    const unpricedTd = (cls) => `<td class="${cls}" style="color:#6b7280;font-style:italic" title="${seedUnpricedTip}">—</td>`;
    const p10kCell = seedUnpriced
      ? unpricedTd("silver-val cell-num")
      : row.focusCost
      ? `<td class="silver-val cell-num ${p10k > 0 ? "profit-low" : "profit-negative"}" title="${
          tx("Whole-bar throughput: {profit} per WATERED cycle (after seed costs) × {cycles} cycles ({focus} focus ea). Silver/Focus shows what watering buys.", "r_p10k_farming_tip")
            .replace("{profit}", formatSilver(row.profitFocusOn || 0))
            .replace("{cycles}", (typeof formatBarCrafts === "function" ? formatBarCrafts(cyclesWithFocus) : cyclesWithFocus.toLocaleString()))
            .replace("{focus}", formatFocusCost(row.focusCost))
        }">${formatSilver(p10k)}</td>`
      : `<td class="cell-num" style="color:#6b7280;font-style:italic" title="${
          tx("No focus play on this row", "r_farming_no_focus_play")
        }">—</td>`;

    // Seeds to Plant (10k Focus) — the shopping-list twin of the throughput cell
    // beside it, and the Farming counterpart of "Mats to Buy (10k Focus)". Three
    // numbers, because for farming they genuinely differ:
    //   planted — one seed per slot, over the whole cycles a bar waters
    //   to buy  — the same count net of the seed return. A WATERED crop or herb
    //             plot is always at or above 100% in Albion, so this is 0 and the
    //             cell has to say why rather than print a bare zero.
    //   action  — the cycles/plots/focus line, which is what the column was asked
    //             for: how many plots a bar actually waters.
    // cyclesWithFocus is reused deliberately; the counts themselves come from
    // matsNeededFor10kFocus, so this file keeps ONE local bar division.
    const seedYieldPct = ((row.seedYieldShown || 0) * 100).toFixed(1);
    const plotsWatered = cyclesWithFocus * (row.seedSlots || 0);
    const toBuy = row.seedsToBuyPer10kFocus || 0;
    const buyLine = toBuy > 0
      ? `${toBuy.toLocaleString()}x ${tx("to buy", "r_seeds_to_buy")} <span style="color:#6b7280">(${seedYieldPct}% ${tx("seed return", "r_seed_return")})</span>`
      : `0x ${tx("to buy", "r_seeds_to_buy")} <span style="color:#5e9e78">(${tx("self-seeding", "r_self_seeding")}, ${seedYieldPct}%)</span>`;
    const seedsCell = row.focusCost
      ? `<td class="cell-focus-mats" title="${
          (focusOn
            ? tx("A bar waters {cycles} cycles = {plots} plots at {focus} a cycle ({perSeed} a seed × {slots} slots). Watered, the plot returns {pct}% of its seeds.", "r_seeds_10k_farming_tip")
            : tx("A bar waters {cycles} cycles = {plots} plots at {focus} a cycle ({perSeed} a seed × {slots} slots). Dry (Use Focus off), it returns {pct}% of its seeds.", "r_seeds_10k_farming_tip_dry"))
            .replace("{cycles}", (typeof formatBarCrafts === "function" ? formatBarCrafts(cyclesWithFocus) : cyclesWithFocus.toLocaleString()))
            .replace("{plots}", plotsWatered.toLocaleString())
            .replace("{focus}", formatFocusCost(row.focusCost))
            .replace("{perSeed}", formatFocusCost(row.focusPerSeed || 0))
            .replace("{slots}", String(row.seedSlots || 0))
            .replace("{pct}", seedYieldPct)
        }">${(row.seedsPer10kFocus || 0).toLocaleString()}x ${dispName(row.item.id, row.item.name)} ${tx("seeds", "r_seeds")}<br><small style="color:#9ca3af">${buyLine}</small><br><small style="color:#9ca3af">${
          tx("{cycles}x cycles · {plots} plots @ {focus} focus ea", "r_seeds_10k_farming_actions")
            .replace("{cycles}", (typeof formatBarCrafts === "function" ? formatBarCrafts(cyclesWithFocus) : cyclesWithFocus.toLocaleString()))
            .replace("{plots}", plotsWatered.toLocaleString())
            .replace("{focus}", formatFocusCost(row.focusCost))
        }</small></td>`
      : `<td style="color:#6b7280;font-style:italic" title="${
          tx("No focus play on this row", "r_farming_no_focus_play")
        }">—</td>`;

    // What the focus itself buys, not the cycle's whole profit — see the Best
    // Focus cell beside it and js/focus-play.js.
    const focusTip = row.bestFocusPlay
      ? `${formatSilver(row.bestFocusPlay.profitDelta)} added per cycle ÷ ${formatFocusCost(row.bestFocusPlay.focusCost)} focus — ${
          tx("the profit a watered cycle makes over the same plot left dry", "r_tip_watering_delta")}`
      : (row.item.type === "byproduct"
          ? tx("Focus buys no extra produce — feeding a grown animal costs none. Nurturing is a play on a baby, priced in the Mounts table.", "r_tip_pasture_no_focus")
          : tx("Watering buys nothing measurable at these prices", "r_tip_watering_worthless"));

    return `
    <tr data-row-key="${rowKey}">
      ${addTdForKey("farming-table", rowKey)}
      <td class="cell-item">${dispName(row.item.id, row.item.name)} <small style="color:#9ca3af">[${typeBadge}]</small></td>
      <td class="cell-route">${tx("Buy", "r_buy")}: ${row.buySeed.city || "—"}${renderFarmingFarmLeg(row)} → ${tx("Sell", "r_sell")}: ${row.sellCrop.city || "—"}${renderFarmingSeedLeg(row)}${renderFarmingWormLeg(row)}${renderFarmingAnimalLeg(row)}</td>
      <td class="cell-text">${bonusBadge}</td>
      ${priceTd(row.buySeed.price, row.item.id, farmingPriceCity(row, row.buySeed, "buy", row.item.id), "buy")}
      ${priceTd(row.sellCrop.price, row.item.outputId, farmingPriceCity(row, row.sellCrop, "sell", row.item.outputId))}
      <td title="${row.item.type === "byproduct"
        ? tx("Produce cycle: the animal eats once and hands over its eggs/milk 22h later", "r_tip_produce_cycle")
        : tx("Cycle time (assumes Premium); 24/cycle = cycles per day", "r_tip_cycle_time")}">${cycleDisplay}</td>
      <td class="cell-text">${yieldDisplay}</td>
      ${profitTd(row.marginInfo, "farming-table", rowIdx, row.sellCrop.city)}
      ${seedUnpriced ? unpricedTd("silver-val cell-num") : `<td class="silver-val cell-num" title="${tx("Profit per harvest cycle × {outputs} outputs", "r_tip_profit_per_cycle").replace("{outputs}", row.outputsPerCycle.toFixed(2))}">${profitCycleDisplay}${renderFarmingAltProfit(row, row.profitPerCycle, row.altProfitPerCycle)}</td>`}
      ${seedUnpriced ? unpricedTd("silver-val cell-num") : `<td class="silver-val cell-num" title="${tx("Extrapolated from cycle: {cycles} cycles/day", "r_tip_cycles_per_day").replace("{cycles}", (24 / row.cycleHours).toFixed(2))}">${profitDayDisplay}${renderFarmingAltProfit(row, row.profitPerDay, row.altProfitPerDay)}</td>`}
      ${p10kCell}
      ${seedsCell}
      ${seedUnpriced ? unpricedTd("silver-val cell-num") : `<td class="silver-val cell-num" title="${focusTip}">${profitFocusDisplay}</td>`}
      <td class="cell-note">${focusPlayCell(row.bestFocusPlay)}</td>
    </tr>`;
  });
}

// Helpers — kept inline so the file stays self-contained.

function findFarmingBonusCities(outputId) {
  if (typeof CITY_FARM_SPEC === "undefined") return [];
  return Object.entries(CITY_FARM_SPEC)
    .filter(([, spec]) => {
      const all = [].concat(spec.crops || [], spec.herbs || [], spec.byproducts || []);
      return all.includes(outputId);
    })
    .map(([city]) => city);
}

function renderFarmingBonusBadge(row) {
  if (!row.bonusCities || row.bonusCities.length === 0) {
    return '<span style="color:#6b7280;font-style:italic">none</span>';
  }
  const matched = row.cityYieldBonus > 0;
  const color = matched ? "#5e9e78" : "#9ca3af";
  const text = row.bonusCities.join(" / ") + " +10%";
  const tooltip = matched
    ? `Farming in ${row.farmCity} — bonus city matches, +10% yield applied`
    : `Bonus available in ${row.bonusCities.join(" / ")} — the chosen farm city does not get the bonus`;
  return `<small style="color:${color}" title="${tooltip}">${text}</small>`;
}

// Middle leg of the route: where the plot actually sits. Printed only when the
// seed is bought somewhere else — a same-city row reads "Buy: X → Sell: Y" as
// before, so the column does not widen on the common case.
function renderFarmingFarmLeg(row) {
  if (!row.farmCity || row.farmCity === row.buySeed.city) return "";
  const tip = tx("Seeds are carried in from {buy}; the plot sits here, so this city decides the +10% bonus", "r_tip_farm_leg")
    .replace("{buy}", row.buySeed.city || "—");
  return ` → <span title="${tip}">${tx("Farm", "r_farm")}: ${row.farmCity}</span>`;
}

// Third leg of the route, shown only when the plot actually returns seeds over
// par: where the surplus is sold. Kept a <small> second line so the Route
// column reads as one route and does not widen.
// Which city a farming price cell edits.
//
// An unpriced leg is `emptyFarmingLeg()` — `{ city: null, price: 0 }`
// (js/farming-row-econ.js) — and handing that null straight to priceTd rendered
// `data-city="null"`, so the editor opened on a city that does not exist and
// defaulted to nothing. Fall back the way every other table does: a pinned city
// first, then the row's other leg, then the section's own first city.
function farmingPriceCity(row, leg, side, itemId) {
  if (leg && leg.city) return leg.city;
  const forced = typeof getCityForce === "function" ? getCityForce(itemId, side) : null;
  if (forced) return forced;
  if (side === "buy" && row.farmCity) return row.farmCity;
  const other = side === "buy" ? row.sellCrop : row.buySeed;
  if (other && other.city) return other.city;
  if (row.section === "caerleon") return "Caerleon";
  return (typeof ROYAL_CITIES !== "undefined" && ROYAL_CITIES[0])
    || (typeof CITIES !== "undefined" && CITIES[0]) || "";
}

function renderFarmingSeedLeg(row) {
  if (!(row.surplusSeedsPerCycle > 0) || !row.sellSeed || !row.sellSeed.city) return "";
  const tip = tx("{seeds} surplus seeds a cycle, worth {silver} sold here", "r_tip_seed_surplus_leg")
    .replace("{seeds}", row.surplusSeedsPerCycle.toFixed(2))
    .replace("{silver}", formatSilver(row.seedRevenuePerCycle || 0));
  return `<br><small style="color:#5e9e78" title="${tip}">+ ${
    tx("seeds", "r_seeds")} → ${row.sellSeed.city}</small>`;
}

// Every harvested slot has a 10% chance of an Earthworm (2 with Premium), so a
// 9-slot plot turns up about one a cycle. Small silver, but it is bait — the
// only ingredient every fishing-bait recipe uses — and it sells where the crop
// often does not.
function renderFarmingWormLeg(row) {
  if (!(row.wormRevenuePerCycle > 0) || !row.sellWorm || !row.sellWorm.city) return "";
  const tip = tx("{worms} Earthworms a cycle, worth {silver} sold here", "r_tip_worm_leg")
    .replace("{worms}", (row.wormsPerCycle || 0).toFixed(2))
    .replace("{silver}", formatSilver(row.wormRevenuePerCycle || 0));
  return `<br><small style="color:#5e9e78" title="${tip}">+ ${
    tx("worms", "r_worms")} → ${row.sellWorm.city}</small>`;
}

// Pasture rows carry a second, one-off leg: the grown animal. It is capital,
// not a cycle input — it survives every harvest and can still be sold or
// butchered — so it is shown beside the route and never charged to the profit.
function renderFarmingAnimalLeg(row) {
  if (row.item.type !== "byproduct") return "";
  const feed = `${row.item.feedCount || 0} × ${dispName(row.item.feedId, row.item.feedId)}`;
  if (!row.buyAnimal || !row.buyAnimal.city || !(row.buyAnimal.price > 0)) {
    return `<br><small style="color:#9ca3af">${tx("feed", "r_feed")}: ${feed}</small>`;
  }
  const tip = tx("One-off: the animal survives every harvest, so it is capital, not a cycle cost", "r_tip_animal_capital");
  return `<br><small style="color:#9ca3af">${tx("feed", "r_feed")}: ${feed} · <span title="${tip}">${
    tx("animal", "r_animal")}: ${formatSilver(row.buyAnimal.price)} @ ${row.buyAnimal.city}</span></small>`;
}

// Second line of a Profit cell: the same cycle farmed on the other side of the
// +10% local production bonus.
//
// The Bonus City column already says a bonus EXISTS; it never said what it was
// worth, and a player whose plot sits in the wrong city had no figure at all.
// js/farming-row-econ.js scores both buckets in one pass and hands back the
// loser as `altFarm`, so this is a print, not a second calculation.
//
// Two directions, because the bonus city does not always win the row:
//   - headline took the bonus  -> "no bonus: X @ City (+delta)", delta = what
//                                 the +10% adds
//   - headline passed it over  -> "+10% @ City: X (-delta)", so the cell says
//                                 why the plot is not in the bonus city
//
// Both figures come from the same cycle state, so the sub-line follows the Use
// Focus and Premium toggles exactly as the headline does.
function renderFarmingAltProfit(row, headline, alt) {
  if (!row.altFarmCity) return "";
  const delta = (headline || 0) - (alt || 0);
  // Rounds to nothing at display precision — two cities that pay the same are
  // not worth a line of their own.
  const deltaTag = Math.round(delta) === 0
    ? ""
    : ` <span style="color:${delta > 0 ? "#5e9e78" : "#9e8840"}">(${
        delta > 0 ? "+" : ""}${formatSilver(delta)})</span>`;
  // City first, connectives dropped: this sub-line sits in a capped cell
  // (cell-num) and every extra word is another wrapped line. "no bonus" is what
  // the "+10%" prefix on the other template already distinguishes, and `tip`
  // below still spells the whole thing out on hover.
  const line = row.altHasBonus
    ? tx("+10% {city} {profit}", "r_farming_alt_bonus")
    : tx("{city} {profit}", "r_farming_alt_no_bonus");
  const tip = row.altHasBonus
    ? tx("The +10% bonus city pays less here, so the plot does better in {farm}", "r_tip_farming_alt_bonus")
        .replace("{farm}", row.farmCity || "—")
    : tx("The same cycle farmed outside the +10% bonus city — the gap is what the bonus is worth", "r_tip_farming_alt_no_bonus");
  return `<br><small style="color:#9ca3af" title="${tip}">${
    line.replace("{city}", row.altFarmCity).replace("{profit}", formatSilver(alt || 0))
  }${deltaTag}</small>`;
}

function renderFarmingYieldCell(row) {
  if (row.item.type === "byproduct") {
    // The produce itself — "19.0 milk", or "20.9 milk (+10%)" in the spec city.
    // The old cell printed the 1.00/1.10 multiplier, which read as "one milk
    // per cycle" and was the visible half of the baby-consumed model.
    const pct = ((row.totalSeedYield - 1) * 100).toFixed(0);
    const bonusTag = row.cityYieldBonus > 0 ? ` <small style="color:#5e9e78">(+${pct}%)</small>` : "";
    const tip = tx("{feed} × feed per cycle → {produce} produce (Premium doubles it)", "r_tip_pasture_yield")
      .replace("{feed}", String(row.item.feedCount || 0))
      .replace("{produce}", (row.outputsPerCycle || 0).toFixed(1));
    return `<span title="${tip}">${(row.outputsPerCycle || 0).toFixed(1)}</span>${bonusTag}`;
  }
  // Crop / herb: show seed yield % (with bonus city annotation). Three reads,
  // because 100% is a hinge and not a ceiling: under it you buy the shortfall,
  // over it the plot hands back seeds you get to sell.
  const pct = (row.totalSeedYield * 100).toFixed(1);
  // The harvest itself: each planted seed hands back 3-6 crops (6-12 with
  // Premium), so a 9-slot plot is ~40 crops a cycle — the seed % beside it is
  // only the SEED return, which is what the cell used to read as the whole story.
  const perSeed = row.item.plotsPerCycle > 0
    ? (row.outputsPerCycle || 0) / row.item.plotsPerCycle
    : 0;
  const harvestTip = tx("{slots} slots × {perSeed} crops per seed = {total} a cycle (Premium doubles it)", "r_tip_crop_harvest")
    .replace("{slots}", String(row.item.plotsPerCycle || 0))
    .replace("{perSeed}", perSeed.toFixed(1))
    .replace("{total}", (row.outputsPerCycle || 0).toFixed(1));
  let sustainTag;
  if (row.surplusSeedsPerCycle > 0) {
    const over = ((row.totalSeedYield - 1) * 100).toFixed(1);
    const tip = tx("Yield >100% — {seeds} seeds a cycle over par, sold for {silver}", "r_tip_seed_surplus")
      .replace("{seeds}", row.surplusSeedsPerCycle.toFixed(2))
      .replace("{silver}", formatSilver(row.seedRevenuePerCycle || 0));
    sustainTag = ` <small style="color:#5e9e78" title="${tip}">${
      tx("surplus", "r_seed_surplus")} +${over}%</small>`;
  } else if (row.totalSeedYield >= 1) {
    sustainTag = ` <small style="color:#5e9e78" title="${
      tx("Seed economy self-sustaining (yield ≥ 100%)", "r_tip_self_sustaining")
    }">${tx("self-sustaining", "r_self_sustaining")}</small>`;
  } else {
    sustainTag = ` <small style="color:#9e8840" title="${tx("Yield <100% — net seed cost per crop applies", "r_tip_seed_cost")}">${tx("seed cost applies", "r_seed_cost_applies")}</small>`;
  }
  return `<span title="${harvestTip}">${pct}%</span>${sustainTag}`;
}
