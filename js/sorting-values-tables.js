/**
 * Per-table sort values — the branches of getSortValue that belong to ONE table
 * and would otherwise collide with the generic fall-throughs in js/sorting.js.
 *
 * Split out because sorting.js had grown past the 800-line limit; this file is
 * pure lookup with no state. Both functions return `undefined` for a column they
 * do not handle, which is the signal for sorting.js to carry on down its own
 * chain — no branch here ever legitimately yields undefined.
 */

// Tables whose row shape is entirely their own (craft-planner rows have no
// marginInfo, buildings rows have no margin at all), so they are answered as a
// closed switch rather than falling through to the shared columns.
function getTableSpecificSortValue(row, col, tableId) {
  if (tableId === "craft-planner-table") {
    switch (col) {
      case "name":           return row.item ? row.item.name : "";
      case "route":          return `${row.craftCity || ""}-${row.sellCity || ""}`;
      case "materials":      return getItemDisplayName(row.materials?.[0]?.matId || "");
      case "cost":           return row.refineCraftCost || 0;
      case "revenue":        return row.sellPrice || 0;
      // Reroll EV sorts on the uplift itself. A row whose walk cannot be priced
      // (no per-quality prices yet, or a non-rerollable item) carries null and
      // sorts to the bottom, the same rule the focus columns use.
      case "rerollEv":       return row.rerollEv != null ? row.rerollEv : -Infinity;
      case "combined":       return row.combinedProfit != null ? row.combinedProfit : -Infinity;
      case "refineSavings":  return row.refineSavings || 0;
      case "journalFill":    return row.journal ? (row.journal.extraSilverPerCraft || 0) : 0;
      // The Laborer Journal column shows the row's profit under the worked-
      // journal play, so it sorts on that — not on the silver the play adds.
      case "laborerCombined":
        return row.laborerCombinedProfit != null ? row.laborerCombinedProfit : -Infinity;
      // Best Focus is chosen on what the play ADDS to this craft's profit, so the
      // column sorts on that same figure rather than on silver-per-focus.
      case "silverPerFocus": return row.bestFocusStep ? (row.bestFocusStep.profitDelta || 0) : 0;
      // A row that can take no focus (and a no-data row) has no figure at all —
      // sort those to the bottom rather than letting a 0 outrank a loss.
      case "profitPer10kFocus":
        return row.profitPer10kFocus != null ? row.profitPer10kFocus : -Infinity;
      case "sellVol":        return row.sellVol || 0;
      default:               return 0;
    }
  }

  // Building Costs: a cost board with no margin, so every column is either a
  // silver total or a label. Handled as a block because `name`, `category` and
  // `materials` collide with the generic fall-throughs in sorting.js.
  if (tableId === "buildings-table") {
    const fam = (typeof BUILDING_FAMILIES !== "undefined" && row.family) || null;
    switch (col) {
      // Family then tier, so the tiers of one station read in order.
      case "name":         return `${fam ? fam.label : ""}|${String(row.building?.tier || 0).padStart(2, "0")}`;
      case "category":     return fam ? fam.category : "";
      case "materials":    return row.materials?.length || 0;
      case "silverFee":    return row.silverFee || 0;
      case "materialCost": return row.materialCost || 0;
      case "laborers":     return row.laborers ? row.laborers.cost : 0;
      // The whole furnishing plan, not one item — beds + tables + trophies.
      case "furniture":    return row.furnitureCost || 0;
      // Journal tier, so the rows where a lower-tier journal already caps the
      // yield (and the trophies are therefore optional) group together.
      case "journal":      return row.bestJournal ? row.bestJournal.journalTier : 0;
      // The self-fill loop's rate, through the same banded key the Laborers
      // table's journalPlay column uses, so a crew's fill play here and there
      // can never disagree about which is worth more.
      case "selfFill":     return (typeof journalPlayValue === "function")
                                    ? journalPlayValue(null, (row.bestJournal && row.bestJournal.selfFill) || null)
                                    : 0;
      // No-data rows sort last under either direction rather than reading as free.
      case "totalCost":    return row.hasData ? (row.totalCost || 0) : Infinity;
      default:             return 0;
    }
  }

  // All three boards share one flat row shape; the focus board just carries two
  // extra fields the other two leave undefined, and the Black Market board
  // sorts its Buy City column through the same `route` key.
  if (tableId === "joined-summary-table" || tableId === "joined-focus-table"
    || tableId === "bm-board-table") {
    switch (col) {
      case "throughput":        return row.throughput || 0;
      case "category":          return row.category   || "";
      case "name":              return row.itemName   || "";
      case "route":             return tableId === "bm-board-table"
        ? (row.buyCity || "")
        : (row.routeLabel || "");
      case "cost":              return row.inputCost  || 0;
      case "revenue":           return row.sellPrice  || 0;
      case "margin":            return row.marginPct != null ? row.marginPct : -999;
      case "profit":            return row.pureProfit || 0;
      // Black Market board only (js/render-bm-board.js). A row with no per-unit
      // haul carries no oxLoad at all, and sorts to the bottom rather than
      // reading as a zero-silver load.
      case "profitPerLoad":     return row.oxLoad ? row.oxLoad.profitPerLoad : -Infinity;
      case "focusCost":         return row.focusCost  || 0;
      case "profitPer10kFocus": return row.profitPer10kFocus || 0;
      case "dailyVol":          return row.dailyVol   || 0;
      default:                  return 0;
    }
  }

  return undefined;
}

// Columns unique to the Gathering, Journal Filling and Laborers tables. These
// names do not collide with the shared columns, so they are a flat lookup.
function getGatheringSortValue(row, col) {
  switch (col) {
    // Gathering table
    case "netPerUnit":         return row.netPerUnit || 0;
    case "weight":             return row.weightKg || 0;
    case "silverPerKg":        return row.silverPerKg || 0;
    case "unitsPerHour":       return row.unitsPerHour || 0;
    case "silverPerHour":      return row.silverPerHour || 0;
    case "journalExtraPerHour": return row.journalExtraPerHour || 0;
    // Journal Filling table
    case "type":               return row.typeLabel || "";
    case "emptyCost":          return row.emptyCost || 0;
    case "fullGross":          return row.fullGross || 0;
    case "journalMargin":      return row.journalMargin || 0;
    case "fameToFill":         return row.fameToFill || 0;
    case "silverPer1kFame":    return row.silverPer1kFame || 0;
    // Silver per hour of gathering once the fill time is priced in. A journal
    // the current Gathering Tier cannot fill scores 0, so it sinks rather than
    // sorting on a rate you could never earn.
    case "journalFillPerHour": return row.journalFillPerHour || 0;
    // Feed a Laborer — carried by BOTH the Gathering and Journal Filling tables
    // (js/journal-laborer-payload.js), so it lives here once. `laborerPayload` is
    // what one journal pays a laborer; `laborerAdvantage` is that minus what the
    // full journal would have sold for, so it can legitimately be negative and a
    // row with no full-journal price scores 0 rather than a phantom win.
    // The column's headline and its sort key: payload per hour of the gathering
    // that fills the journal. A journal the current gathering tier cannot fill
    // earns nothing per hour, so it scores 0 and sinks — the same rule
    // journalFillPerHour uses for the sell-it-full rate over the same hours.
    // Deliberately NOT named selfFillPerHour: that key is the Laborers rows' own
    // NET rate, and a shared name across tables that share this function is
    // exactly how the craft-planner scan bug happened.
    case "laborerPerHour":     return row.laborerPerHour || 0;
    case "laborerPayload":     return row.laborerPayload || 0;
    case "laborerAdvantage":   return row.laborerAdvantage || 0;
    // Laborers table's Best Journal Play column — the self-fill loop's rate,
    // BANDED by unit (journalPlayValue in js/laborer-journal-play.js): silver
    // per gathering hour for the gatherers, silver per craft for the crafting
    // laborers, each family ordered inside itself and never against the other.
    // `|| 0` would promote a crafting row's negative band key above a no-model
    // row's, so the fallback is only for a missing key.
    case "journalPlay":        return row.journalPlayRank != null ? row.journalPlayRank : 0;
    // Reported, never the header's key: what one journal pays the laborer, what
    // one point of this journal's fame is worth (NOT cross-tier comparable —
    // fame costs different gathering time at each tier), and the two per-effort
    // rates on their own. Kept so a header can be pointed at any of them.
    case "selfFillPerCycle":   return row.selfFillPerCycle || 0;
    case "selfFillPerHour":    return row.selfFillPerHour || 0;
    case "selfFillPerCraft":   return row.selfFillPerCraft || 0;
    case "selfFillPerFame":    return row.selfFillPerFame || 0;
    default:                   return undefined;
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getTableSpecificSortValue, getGatheringSortValue };
}
