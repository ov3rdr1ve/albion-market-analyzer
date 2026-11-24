/**
 * Laborers profitability table — covers Trophy / Resource / Crafting /
 * Mercenary modes plus a Contract Cost + Breakeven column for amortising
 * the up-front cost of buying a pre-leveled laborer.
 *
 * YIELD = getLaborerYield(tier) — the OWN-TIER yield, set by the header's Trophy
 * Happiness box: 100% with beds and tables alone, +0.5% per point of trophy
 * happiness, capped at 150%. Every row models a tier-T laborer running a tier-T
 * journal; the Best Journal Play column separately values feeding it a LOWER-
 * tier journal, which starts at 150% base yield whatever the happiness.
 *
 * Per-cycle revenue formulas:
 *   Trophy     revenue = trophyPrice         × YIELD × (1 - PREMIUM_TAX)
 *   Resource   revenue = Σ_e baseloot × YIELD × enchantProb_e × price_e × (1 - PREMIUM_TAX)
 *   Crafting   revenue = Σ_r baseloot × YIELD × mixFrac_r × refinedPrice_r × (1 - PREMIUM_TAX)
 *   Mercenary  revenue = silverPerTier × YIELD          (no market tax on direct silver)
 *
 * Per-cycle cost:
 *   cost = filledJournalBuy × (1 + SETUP_FEE)
 *
 * Per-cycle profit:
 *   profit = revenue + emptyJournalSell × (1 - PREMIUM_TAX) - cost
 *
 * Contract amortisation:
 *   breakevenCycles = contractPrice × (1 + SETUP_FEE) / profitPerCycle
 *   (only reported when profit > 0; shown as "—" otherwise)
 *
 * The laborer cycle is assumed to run IN the laborer city (where the trophy /
 * resource / refined / silver is also sold). No Brecilien Travel Planner fee is
 * charged on the filled-journal leg: Brecilien is reachable through safe-zone
 * Avalonian portals in the Mists, so hauling in/out costs nothing. See
 * travel-cost.js:legBrecilienCost (disabled app-wide, returns 0).
 *
 * The pricing model itself — row specs, per-mode payload revenue, the best-route
 * picker and the per-cell price lookups — lives in js/laborers-pricing.js, which
 * loads first. This file is the leveling path, the row assembly and the markup.
 */

// ─── Best leveling path (buy/hire → level → sell) ────────────────────────
//
// Alternative exit strategy to "Buy T8": acquire a contract at some start tier
// S (a free-ish T2 apprentice via hire, or buy a pre-leveled S>2 contract), run
// THIS mode's journals to level up to end tier E, then sell the T{E} contract.
// Each leveling cycle at tier t is one tier-t journal whose net silver equals
// the per-cycle profit the table already computes for that (laborer, tier,
// mode). We search every 2 ≤ S < E ≤ 8 and keep the most profitable path.

// Map a row spec → wiki fame-table keys (journal type + upgrade category).
// Returns null for laborers with no contract attribution (GENERAL trophy).
function _levelingFameKeys(spec) {
  const lab = spec.laborer;
  if (!lab || !lab.contractSlug) return null;
  switch (spec.mode) {
    case LABORER_MODE.RESOURCE:  return lab.slug === "FISHING"
                                   ? { fameType: "FISHERMAN", upgradeCat: "FISHERMAN" }
                                   : { fameType: "GATHERING", upgradeCat: "GATHER_CRAFT" };
    case LABORER_MODE.CRAFTING:  return { fameType: "CRAFTING",  upgradeCat: "GATHER_CRAFT" };
    case LABORER_MODE.MERCENARY: return { fameType: "MERCENARY", upgradeCat: "MERCENARY" };
    case LABORER_MODE.TROPHY:
      if (lab.category === "battle") return { fameType: "TROPHY_GENERAL",   upgradeCat: "MERCENARY" };
      if (lab.slug === "FISHING")    return { fameType: "FISHERMAN_TROPHY", upgradeCat: "FISHERMAN" };
      return { fameType: "TROPHY_GENERAL", upgradeCat: "GATHER_CRAFT" };
    default: return null;
  }
}

// Contract buy (ask) + sell (bid) prices at every tier, sold/bought in the
// laborer city. Mirrors _contractLookup but spans all tiers for the path search.
function _contractPricesAllTiers(laborer, marketData, laborerCity) {
  const out = {};
  if (!laborer || !laborer.contractSlug || !laborerCity) return out;
  LABORER_TIERS.forEach((tier) => {
    const id = getLaborerContractId(laborer.contractSlug, tier);
    const itemData = marketData[id];
    const bounds = getIQRBounds(itemData);
    // Same pins the per-tier cells render at, so a hand-typed contract price
    // feeds the path from wherever the user typed it.
    const buy  = getBuyPrice (itemData, _pinnedCity(id, "buy")  || laborerCity, bounds, id);
    const sell = getSellPrice(itemData, _pinnedCity(id, "sell") || laborerCity, bounds, id);
    out[tier] = { buy: buy > 0 ? buy : 0, sell: sell > 0 ? sell : 0 };
  });
  return out;
}

/**
 * @param profitByTier  { [tier]: number|null } per-cycle profit (null = no data)
 * @param contractPrices { [tier]: { buy, sell } }
 * @param fameKeys       { fameType, upgradeCat }
 * Returns { startTier, endTier, netProfit, totalCycles } or null.
 */
function computeBestLevelingPath({ profitByTier, contractPrices, fameKeys }) {
  if (!fameKeys || !contractPrices || !profitByTier) return null;
  const { fameType, upgradeCat } = fameKeys;
  let best = null;

  for (const startTier of LABORER_TIERS) {
    const S = startTier;
    // Acquisition: free-ish T2 hire, else buy a pre-leveled S>2 contract.
    let acquire;
    if (S === 2) {
      acquire = HIRE_COST;
    } else {
      const cBuy = (contractPrices[S] && contractPrices[S].buy) || 0;
      if (cBuy <= 0) continue;
      acquire = cBuy * (1 + SETUP_FEE);
    }

    let levelGain = 0;
    let cycles = 0;
    for (let E = S + 1; E <= 8; E++) {
      const crossed = E - 1;               // tier just leveled through
      const p = profitByTier[crossed];
      if (p == null) break;                // no journal/loot data crossing this tier
      const journals = getLaborerUpgradeJournals(fameType, upgradeCat, crossed);
      levelGain += journals * p;
      cycles += journals;

      const cSell = (contractPrices[E] && contractPrices[E].sell) || 0;
      if (cSell <= 0) continue;            // can't exit at E, but may level further
      const net = cSell * (1 - PREMIUM_TAX) - acquire + levelGain;
      if (!best || net > best.netProfit) {
        best = { startTier: S, endTier: E, netProfit: net, totalCycles: cycles };
      }
    }
  }
  return best;
}

// `spec` carries the LABORER identity (tier label, contract, leveling); the row's
// journal cells + headline profit come from the BEST journal play (bestJournal),
// which may be a lower-tier journal run at 1.5 yield. `jspec` is the winning
// journal's spec (== spec for the same-tier play), so the Buy/Empty/Payload cells
// and the Profit/Cycle all describe the optimal play the user actually runs.
function _buildRow(spec, marketData, levelingPath, bestJournal, groupCity, selfFill, shownJournal) {
  // `shown` is the journal the row DISPLAYS and prices — normally the best play,
  // but the row's own tier while its journal price is pinned. `bestJournal` is
  // always the unconstrained winner, and stays the Best Journal Play column's.
  const shown = shownJournal || bestJournal;
  const journalPinned = !!(shown && bestJournal && shown !== bestJournal);
  const route = shown ? shown.route : null;
  const jspec = (shown && shown.spec) ? shown.spec : spec;
  const playYield = shown ? shown.yield : _specOwnTierYield(spec);
  const item = {
    id: `${spec.mode}|${spec.filledId}`,   // stable per laborer-tier row (not the journal)
    name: `T${spec.tier} ${spec.laborerName}`,
  };

  if (!route) {
    // No market data → no computed route. Anchor the editable price cells to the
    // group's established city (or a default) so the user can still type in
    // prices. The overrides they set are read back on the next render, at which
    // point a real route may form. The contract anchor matches the leveling
    // path's all-tier scan city, so per-tier contract overrides feed it.
    const anchorCity = groupCity || _defaultLaborerCity();
    const ep = _emptyRowPrices(spec, marketData, anchorCity);
    // Empty journal priced independently (best-available / user-pinned city), so
    // a no-route row still surfaces the price wherever it trades and an
    // Empty-Sell override the user just set stays visible.
    const emptyJ = _emptyJournalSell(marketData, spec.emptyId);
    const emptyCity = emptyJ.city || anchorCity;
    const contract = _contractLookup(spec, marketData, anchorCity);
    const rowContract = _contractLookup(spec, marketData, anchorCity, spec.tier);
    const hasOverride = (typeof getOverridePrice === "function") && (
      getOverridePrice(spec.filledId, ep.filledCity) !== null ||
      (spec.trophyId && getOverridePrice(spec.trophyId, ep.trophyCity) !== null) ||
      getOverridePrice(spec.emptyId, emptyCity) !== null ||
      (contract.id && getOverridePrice(contract.id, contract.city) !== null) ||
      (rowContract.id && getOverridePrice(rowContract.id, rowContract.city) !== null)
    );
    return {
      item, tier: spec.tier, mode: spec.mode,
      laborerName: spec.laborerName,
      payloadLabel: spec.payloadLabel || "",
      buy: { city: ep.filledCity, price: ep.filledPrice },
      sell: { city: ep.trophyCity, price: ep.trophyPrice },
      filledId: spec.filledId, emptyId: spec.emptyId,
      trophyId: spec.trophyId || null,
      contract,
      rowContract,
      emptyJournalPrice: emptyJ.price,
      emptyCity,
      totalInputCost: 0,
      payloadRevenue: 0,
      emptyRevenue: 0,
      playYield: _specOwnTierYield(spec),
      marginInfo: { margin: -1, profit: 0 },
      breakevenCycles: 0,
      levelingPath: levelingPath || null,
      bestJournal: bestJournal || null,
      selfFill: selfFill || null,
      // Each row's self-fill rate in its OWN unit, NET of the market value of
      // the fame it spent — hours for gatherers, crafts for the crafting
      // laborers, which have no hourly rate at all. The other family keys 0,
      // which is why neither is the column's sort key.
      selfFillPerHour: (selfFill && selfFill.found) ? (selfFill.silverPerHour || 0) : 0,
      selfFillPerCraft: (selfFill && selfFill.found) ? (selfFill.netSilverPerCraft || 0) : 0,
      selfFillFameCost: (selfFill && selfFill.found) ? (selfFill.fameCost || 0) : 0,
      // Reported, never ranked: what one point of THIS journal's fame is worth
      // (not comparable across tiers — a point of fame costs a different amount
      // of gathering at each), and what a single journal pays the laborer (the
      // right unit only when the laborer, not your own effort, is the limit).
      selfFillPerFame: (selfFill && selfFill.found) ? (selfFill.silverPerFame || 0) : 0,
      selfFillPerCycle: (selfFill && selfFill.found) ? (selfFill.profitPerCycle || 0) : 0,
      journalPlayRank: (typeof journalPlayValue === "function")
        ? journalPlayValue(bestJournal || null, selfFill || null) : 0,
      journalPinned,
      hasOverride,
    };
  }

  const contract = _contractLookup(spec, marketData, route.laborerCity);
  // Per-row contract at THIS row's tier (editable; feeds the leveling path's
  // all-tier scan via overrides). Distinct from `contract`, which is always the
  // T8 contract used for the Buy-and-hold breakeven. For T8 rows they coincide.
  const rowContract = _contractLookup(spec, marketData, route.laborerCity, spec.tier);
  const buyWithSetup = contract.buyPrice > 0 ? contract.buyPrice * (1 + SETUP_FEE) : 0;
  const breakevenCycles = (route.profit > 0 && buyWithSetup > 0)
    ? buyWithSetup / route.profit
    : 0;

  const emptyCity = route.emptyCity || route.laborerCity;
  const hasOverride = (typeof getOverridePrice === "function") && (
    getOverridePrice(jspec.filledId, route.buyCity) !== null ||
    (jspec.trophyId && getOverridePrice(jspec.trophyId, route.laborerCity) !== null) ||
    getOverridePrice(jspec.emptyId, emptyCity) !== null ||
    (contract.id && getOverridePrice(contract.id, contract.city) !== null) ||
    (rowContract.id && getOverridePrice(rowContract.id, rowContract.city) !== null)
  );

  return {
    item, tier: spec.tier, mode: spec.mode,
    laborerName: spec.laborerName,
    payloadLabel: _journalPayloadLabel(jspec, playYield),
    buy: { city: route.buyCity, price: route.filledPrice },
    sell: { city: route.laborerCity, price: route.payloadPrice },
    filledId: jspec.filledId, emptyId: jspec.emptyId,
    trophyId: jspec.trophyId || null,
    contract,
    rowContract,
    emptyJournalPrice: route.emptyPrice,
    emptyCity,
    totalInputCost: route.filledCost,
    payloadRevenue: route.payloadRevenue,
    // Per-cycle silver behind Profit / Cycle. The price columns show UNIT
    // prices (they're click-to-override cells), so these are what actually add
    // up: payloadRevenue + emptyRevenue − totalInputCost = profit.
    emptyRevenue: route.emptyRevenue,
    playYield,
    marginInfo: { margin: route.margin, profit: route.profit },
    breakevenCycles,
    levelingPath: levelingPath || null,
    bestJournal: bestJournal || null,
    // An ALTERNATIVE play to this row, never an addition to it: fill the journal
    // yourself and the purchase/resale legs above disappear. Deliberately absent
    // from marginInfo and the profit breakdown. See js/laborer-self-fill.js.
    selfFill: selfFill || null,
    selfFillPerHour: (selfFill && selfFill.found) ? (selfFill.silverPerHour || 0) : 0,
    selfFillPerCraft: (selfFill && selfFill.found) ? (selfFill.netSilverPerCraft || 0) : 0,
    selfFillFameCost: (selfFill && selfFill.found) ? (selfFill.fameCost || 0) : 0,
    selfFillPerFame: (selfFill && selfFill.found) ? (selfFill.silverPerFame || 0) : 0,
    selfFillPerCycle: (selfFill && selfFill.found) ? (selfFill.profitPerCycle || 0) : 0,
    journalPlayRank: (typeof journalPlayValue === "function")
      ? journalPlayValue(bestJournal || null, selfFill || null) : 0,
    journalPinned,
    hasOverride,
  };
}

// The laborer running its OWN tier's journal, in the shape the row cells and
// the Best-Journal comparison both read.
function _sameTierJournalEntry(specs, sameTierRoutes, i) {
  if (!sameTierRoutes[i]) return null;
  // The own-tier yield THIS laborer type can buy — a crafting laborer has no
  // trophy of its own, so its ceiling is lower than a gatherer's. Carried on the
  // result so the tooltip quotes the same number the comparison used.
  const ownTierYield = _specOwnTierYield(specs[i]);
  return {
    journalTier: specs[i].tier, yield: ownTierYield,
    profit: sameTierRoutes[i].profit, route: sameTierRoutes[i], spec: specs[i],
    sameTierProfit: sameTierRoutes[i].profit, sameTierYield: ownTierYield,
  };
}

// A filled journal the user PINNED (a typed price — override plus the city force
// the editor writes with it) fixes its row to its own tier. Without this the row
// silently re-picked whichever journal the new price made cheapest, so the cell
// came back showing another tier's market price: the edit read as "it didn't
// pin", and the pinned journal was left with no cell to correct or clear it
// from (a T4-T6 journal is otherwise never the winner of any row). The Best
// Journal Play column keeps reporting the unconstrained winner.
function _ownTierJournalPinned(spec) {
  return typeof _pinnedCity === "function"
    && _pinnedCity(spec.filledId, "buy") !== null;
}

// Best journal to FEED a tier-T laborer (index `i` in the ascending-tier specs).
// A journal at least one tier below the laborer yields the full 150%; the
// laborer's own tier only what its trophy happiness buys (getLaborerYield). So
// we compare the same-tier route (tier-T loot at that yield) against every
// lower-tier journal run at 1.5 (tier-J loot, cheaper journal) and keep the most
// profitable. At max happiness both sides sit at 1.5 and the comparison reduces
// to which tier of loot is worth more per journal — the tie goes to same-tier.
// `boostedRoutes[j]` is specs[j]'s journal run at 1.5 (i.e. by a higher laborer).
function _bestJournalForLaborer(specs, sameTierRoutes, boostedRoutes, i) {
  const ownTierYield = _specOwnTierYield(specs[i]);
  let best = _sameTierJournalEntry(specs, sameTierRoutes, i);
  const sameTierProfit = sameTierRoutes[i] ? sameTierRoutes[i].profit : null;
  for (let j = 0; j < i; j++) {            // specs[j].tier < laborerTier
    const r = boostedRoutes[j];
    if (!r) continue;
    if (!best || r.profit > best.profit) {
      best = { journalTier: specs[j].tier, yield: LABORER_YIELD_CAP, profit: r.profit, route: r, spec: specs[j], sameTierProfit };
    }
  }
  if (best) {
    best.sameTierProfit = sameTierProfit;
    best.sameTierYield = ownTierYield;
  }
  return best;
}

// Build one (laborer/trophy-line × mode) group: compute the 7 tier routes once,
// derive the shared best-leveling-path, then attach it to every tier row.
function _buildGroup(specs, marketData, rows) {
  const routes = specs.map((s) => computeBestLaborerRoute(s, marketData));
  // Same journal specs, but valued as if run by a HIGHER-tier laborer (yield
  // 1.5) — the candidate pool for each row's Best-Journal column.
  const boosted = specs.map((s) => computeBestLaborerRoute({ ...s, yield: 1.5 }, marketData));
  const profitByTier = {};
  specs.forEach((s, i) => { profitByTier[s.tier] = routes[i] ? routes[i].profit : null; });

  const refRoute = routes.find((r) => r) || null;
  // City the whole group anchors on: the best route's laborer city when any
  // tier has data, else a default. No-data rows pin their editable cells (incl.
  // per-tier contract) here so overrides line up with the leveling-path scan.
  const groupCity = refRoute ? refRoute.laborerCity : _defaultLaborerCity();
  const laborer = specs[0].laborer;
  const fameKeys = _levelingFameKeys(specs[0]);
  let levelingPath = null;
  if (refRoute && laborer && fameKeys) {
    const contractPrices = _contractPricesAllTiers(laborer, marketData, refRoute.laborerCity);
    levelingPath = computeBestLevelingPath({ profitByTier, contractPrices, fameKeys });
  }

  specs.forEach((s, i) => {
    const bestJournal = _bestJournalForLaborer(specs, routes, boosted, i);
    const selfFill = (typeof computeLaborerSelfFill === "function")
      ? computeLaborerSelfFill({
          spec: s, marketData, laborerTier: s.tier,
          city: (routes[i] && routes[i].laborerCity) || groupCity,
        })
      : null;
    // A pinned own-tier journal price fixes the row's cells and Profit / Cycle
    // to that journal (see _ownTierJournalPinned); bestJournal still drives the
    // Best Journal Play column, so the cheaper tier stays visible.
    const shownJournal = _ownTierJournalPinned(s)
      ? (_sameTierJournalEntry(specs, routes, i) || bestJournal)
      : bestJournal;
    rows.push(_buildRow(s, marketData, levelingPath, bestJournal, groupCity, selfFill, shownJournal));
  });
}

function buildLaborersRowData(marketData) {
  const rows = [];

  // Trophy mode groups (one per trophy line)
  TROPHY_LABORERS.forEach((line) => {
    _buildGroup(LABORER_TIERS.map((tier) => _trophyRowSpec(line, tier)), marketData, rows);
  });

  // Resource / Crafting / Mercenary mode groups (one per laborer × mode)
  LABORERS.forEach((laborer) => {
    laborer.modes.forEach((mode) => {
      _buildGroup(LABORER_TIERS.map((tier) => _laborerJournalRowSpec(laborer, tier, mode)), marketData, rows);
    });
  });

  return rows;
}

// ─── Renderer ────────────────────────────────────────────────────────────

function _breakevenLabel(cycles) {
  if (!cycles || cycles <= 0) return '<span style="color:#6b7280;font-style:italic">—</span>';
  if (cycles < 1) return `<span title="${tx("Less than one cycle to recoup contract", "r_tip_recoup_fast")}">${cycles.toFixed(2)} cyc</span>`;
  if (cycles < 1000) {
    const hours = cycles * 22;
    const days = hours / 24;
    return `<span title="${hours.toFixed(0)}h ≈ ${days.toFixed(1)}d at 22h/cycle">${cycles.toFixed(1)} cyc</span>`;
  }
  return `<span title="${tx("Contract recovery would take {cycles} cycles", "r_tip_recoup_slow").replace("{cycles}", cycles.toFixed(0))}">${Math.round(cycles).toLocaleString()} cyc</span>`;
}

// "Best Leveling Path" cell — shows the chosen start→end tiers and the net
// profit of that buy/hire → level → sell strategy (journal cost included).
function _levelingPathCell(path) {
  if (!path) return '<td class="silver-val" style="color:#6b7280;font-style:italic">—</td>';
  const cyc = path.totalCycles;
  const days = (cyc * 22) / 24;
  const acquire = path.startTier === 2
    ? tx("hire a T2 apprentice", "r_lvl_hire_apprentice")
    : tx("buy a T{tier} contract", "r_lvl_buy_contract").replace("{tier}", path.startTier);
  const tip = tx("{acquire}, level to T{end} (~{cyc} cycles ≈ {days}d), then sell. Net of journals and {tax}% tax.", "r_tip_leveling_path")
    .replace("{acquire}", acquire)
    .replace("{end}", path.endTier)
    .replace("{cyc}", cyc)
    .replace("{days}", days.toFixed(0))
    .replace("{tax}", (PREMIUM_TAX * 100).toFixed(1));
  const color = path.netProfit >= 0 ? "" : ' style="color:#c0392b"';
  return `<td class="silver-val cell-note"${color} title="${tip}"><span style="color:#6b7280">T${path.startTier}→T${path.endTier}</span> ${formatSilver(path.netProfit)}</td>`;
}

// The BUY-THE-FILLED-JOURNAL play, explained: the most profitable journal tier
// to FEED this laborer. A journal ≥1 tier below the laborer yields 150%, which
// beats its own tier by the whole gap the Trophy Happiness setting leaves open,
// so for an under-trophied house a lower-tier journal often nets more per cycle.
//
// Split out of the cell so the merged Best Journal Play column
// (js/laborer-journal-play.js) reuses this prose verbatim.
function bestJournalTip(bj, laborerTier) {
  if (!bj || bj.profit == null) return "";
  const yieldPct = +(bj.yield * 100).toFixed(1);
  const beatsSameTier = bj.journalTier < laborerTier;
  const delta = (beatsSameTier && bj.sameTierProfit != null)
    ? ` (+${formatSilver(bj.profit - bj.sameTierProfit)} vs same-tier)`
    : "";
  const sameTierPct = ((bj.sameTierYield != null ? bj.sameTierYield : getLaborerYield(laborerTier)) * 100).toFixed(1);
  return beatsSameTier
    ? tx("T{tier} journal @{yield}% nets {profit} / cycle{delta}, vs {own}% at its own tier.", "r_tip_best_journal_lower")
        .replace("{tier}", bj.journalTier)
        .replace("{yield}", yieldPct)
        .replace("{profit}", formatSilver(bj.profit))
        .replace("{delta}", delta)
        .replace("{own}", sameTierPct)
    : tx("The laborer's own T{tier} journal ({yield}%) is the best buy; no lower tier nets more.", "r_tip_best_journal_own")
        .replace("{tier}", laborerTier)
        .replace("{yield}", yieldPct);
}

// The standalone "Best Journal" cell — kept for any table that still shows the
// buy play on its own. The Laborers table renders the merged journalPlayCell.
// ▲ flags when a lower-tier journal beats the laborer's own tier.
function _bestJournalCell(bj, laborerTier) {
  if (!bj || bj.profit == null) {
    return '<td class="silver-val" style="color:#6b7280;font-style:italic">—</td>';
  }
  const yieldPct = +(bj.yield * 100).toFixed(1);
  const arrow = bj.journalTier < laborerTier ? ' <span style="color:#1f9d55">▲</span>' : "";
  return `<td class="silver-val" title="${bestJournalTip(bj, laborerTier)}"><span style="color:#6b7280">T${bj.journalTier} @${yieldPct}%</span> ${formatSilver(bj.profit)}${arrow}</td>`;
}

function renderLaborersTable(marketData) {
  const rowData = buildLaborersRowData(marketData);

  renderTableData("laborers-table", rowData, (row, rowIdx) => {
    const {
      item, tier, mode, payloadLabel, buy, sell, emptyJournalPrice, emptyCity,
      marginInfo, payloadRevenue, emptyRevenue, playYield, totalInputCost,
      filledId, emptyId, trophyId, rowContract, breakevenCycles,
      journalPinned,
    } = row;

    const routeCell = (buy.city && sell.city)
      ? `Buy: ${buy.city} → Run/Sell: ${sell.city}`
      : "no data";

    // The three price columns are click-to-override UNIT prices, so they can't
    // be added up by eye to reach Profit / Cycle: the payload is multiplied by
    // the journal yield, both sale legs lose the 6.5%/10.5% tax+setup, and the
    // filled journal costs 2.5% more than its listed price. Spell the whole sum
    // out on the profit cell.
    // Trophy rows show a single unit price, so name the multiplication; the
    // other modes already display per-cycle silver from a multi-item mix.
    const payloadSource = (mode === LABORER_MODE.TROPHY && sell.price > 0)
      ? ` (${formatSilver(sell.price)} × ${(playYield || 1).toFixed(3)} yield, after tax)`
      : " (after tax)";
    // A pinned journal price holds the row on its own tier, so its profit can be
    // below the Best Journal Play column's (which still scans every tier). Say so
    // on the cell, otherwise the two numbers look like a contradiction.
    const pinNote = journalPinned
      ? ` · pinned T${tier} journal price — this row stays on its own tier; clear the ⚡ override to let it pick the cheapest journal again`
      : "";
    const profitBreakdown = marginInfo.profit
      ? `${formatSilver(payloadRevenue || 0)} payload${payloadSource}`
        + ` + ${formatSilver(emptyRevenue || 0)} empty journal (after tax)`
        + ` − ${formatSilver(totalInputCost || 0)} filled journal (${formatSilver(buy.price)} + 2.5% setup)`
        + ` = ${formatSilver(marginInfo.profit)}${pinNote}`
      : "";

    // Payload cell — for trophy mode show the per-unit market price (clickable
    // override). For other modes the payload is a multi-item mix, so show the
    // per-cycle silver and the breakdown label as tooltip.
    let payloadCell;
    if (mode === LABORER_MODE.TROPHY && trophyId) {
      payloadCell = priceTd(sell.price, trophyId, sell.city);
    } else {
      const tip = payloadLabel ? ` title="${payloadLabel} per cycle"` : "";
      const display = payloadRevenue > 0 ? formatSilver(payloadRevenue) : '<span style="color:#6b7280;font-style:italic">${tx("no data", "r_no_data")}</span>';
      payloadCell = `<td class="silver-val"${tip}>${display}</td>`;
    }

    // Contract Buy cell — the row's OWN-tier contract, editable even when the
    // price is missing (priceTd renders "no data — click to set" at price 0).
    // Setting it stores an override keyed by (tier-contract id, city) that the
    // leveling-path all-tier scan reads back. Only laborers with no contract
    // attribution (GENERAL trophy) lack an id and fall back to "—".
    const contractBuyCell = rowContract && rowContract.id
      ? priceTd(rowContract.buyPrice, rowContract.id, rowContract.city, "buy")
      : '<td class="silver-val" style="color:#6b7280;font-style:italic">—</td>';
    const levelingCell = _levelingPathCell(row.levelingPath);
    // Buy-the-journal-filled and fill-it-yourself, in ONE cell: both are silver
    // per 22h laborer cycle now, so side-by-side columns would have been two
    // renderings of one comparison. See js/laborer-journal-play.js.
    const journalPlayTd = (typeof journalPlayCell === "function")
      ? journalPlayCell(row.bestJournal || null, row.selfFill || null, tier)
      : _bestJournalCell(row.bestJournal, tier);

    // Stable per-row key (mode|filledId) so restoreAnchor can pin the edited row
    // in the viewport on an override re-render — matches every other table.
    const rowKey = (typeof getRowKey === "function") ? getRowKey(row, "laborers-table") : "";

    return `
      <tr data-row-key="${rowKey}">
        ${addTdForKey("laborers-table", rowKey)}
        <td class="cell-item">${item.name}</td>
        <td>${mode}</td>
        <td class="cell-route">${routeCell}</td>
        ${priceTd(buy.price, filledId, buy.city, "buy")}
        ${payloadCell}
        ${priceTd(emptyJournalPrice, emptyId, emptyCity || sell.city)}
        ${profitWithMarginTd(marginInfo, profitBreakdown, "laborers-table", rowIdx, sell.city)}
        ${journalPlayTd}
        ${contractBuyCell}
        ${levelingCell}
        <td class="silver-val">${_breakevenLabel(breakevenCycles)}</td>
      </tr>
    `;
  });
}

if (typeof module !== "undefined" && module.exports) {
  // The pricing half exports itself from js/laborers-pricing.js; the Node tests
  // compile both files together, so anything they need from there is in scope.
  module.exports = {
    buildLaborersRowData,
    renderLaborersTable,
    computeBestLevelingPath,
    // exposed for tests
    _levelingFameKeys,
    _contractPricesAllTiers,
    _bestJournalForLaborer,
    _ownTierJournalPinned,
    _bestJournalCell,
    bestJournalTip,
  };
}
