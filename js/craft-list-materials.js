/**
 * My Crafting List — material aggregation and basket totals.
 *
 * Turns the normalized rows from js/craft-list-extractors.js plus their
 * quantities into the two things the panel reports: the Materials to Buy board
 * and the footer totals.
 *
 * Both take an optional `allocation` (js/craft-list-focus-budget.js) — the
 * split of every row's quantity into the units a finite focus budget can cover
 * and the tail past it, which is costed at the base return rate. Without one,
 * every unit is focused, which is what the list did before the budget existed.
 *
 * Everything here is pure: no DOM, no market lookups, no globals.
 */


/**
 * How one entry's quantity divides into focused and unfocused units.
 *
 * `allocation` is what allocateCraftListFocus returned for THIS entry list
 * (js/craft-list-focus-budget.js), positional by construction. Absent — every
 * Node test that calls these functions bare, and any caller that has not opted
 * into a budget — every unit is focused, which is exactly the behaviour before
 * the budget existed.
 */
function _clSplit(allocation, index, entry) {
  const qty = Number(entry && entry.qty) || 0;
  const total = qty > 0 ? qty : 0;
  const split = allocation && allocation.splits && allocation.splits[index];
  if (!split) return { fundedQty: total, unfundedQty: 0 };
  return {
    fundedQty: Number(split.fundedQty) || 0,
    unfundedQty: Number(split.unfundedQty) || 0,
  };
}

/**
 * The shopping list: every entry's materials × its quantity, merged per
 * (material, city) and sorted by what it costs.
 *
 * A zero perUnit means "the market has no price" — the line is KEPT (it is
 * still something to go buy) and the first real price seen for that material
 * wins, so one unpriced source row doesn't blank a material the rest priced.
 */
function aggregateCraftListMaterials(entries, allocation) {
  const byKey = new Map();
  const add = (mats, qty) => {
    if (!(qty > 0)) return;
    (mats || []).forEach((m) => {
      // note is part of the key: a material you refine and the same material
      // bought in the same city are two different lines of the plan.
      const key = `${m.matId}|${m.city || ""}|${m.note || ""}`;
      const cur = byKey.get(key);
      if (cur) {
        cur.count += (Number(m.count) || 0) * qty;
        if (!cur.perUnit) cur.perUnit = Number(m.perUnit) || 0;
      } else {
        byKey.set(key, {
          matId: m.matId,
          city: m.city || "",
          note: m.note || "",
          count: (Number(m.count) || 0) * qty,
          perUnit: Number(m.perUnit) || 0,
        });
      }
    });
  };
  (entries || []).forEach((e, i) => {
    const split = _clSplit(allocation, i, e);
    add(e && e.materials, split.fundedQty);
    // The units the focus budget could not cover get less material back, so
    // they BUY more — the shopping board has to show the bigger number or it
    // under-buys the very plan the footer just costed.
    add((e && e.materialsNoFocus) || (e && e.materials), split.unfundedQty);
  });
  const lines = [...byKey.values()]
    // A parked row (quantity 0) and a recipe slot that resolves to nothing both
    // land here as a 0× line, which is noise on a shopping list, not a purchase.
    .filter((l) => l.count > 0)
    .map((l) => ({ ...l, total: l.count * l.perUnit }));
  lines.sort((a, b) => b.total - a.total || a.matId.localeCompare(b.matId));
  return { lines, grandTotal: lines.reduce((s, l) => s + l.total, 0) };
}

/** Fractional journals each `slug|tier` fills, keyed for grouping. */
function _clJournalFractions(entries) {
  const byJournal = new Map();
  (entries || []).forEach((e) => {
    const qty = Number(e && e.qty) || 0;
    const f = e && e.laborerFill;
    if (!f || !(f.craftsPerJournal > 0) || qty <= 0) return;
    const key = `${f.slug}|${f.tier}`;
    const at = byJournal.get(key)
      || { slug: f.slug, tier: f.tier, fraction: 0 };
    at.fraction += qty / f.craftsPerJournal;
    byJournal.set(key, at);
  });
  return byJournal;
}

/**
 * Footer totals over the list, each entry scaled by its quantity.
 *
 * `totalProfit` and `totalLaborerProfit` are the same basket under the two
 * exclusive journal plays — sell the journal vs. feed it to a laborer — so they
 * are alternatives to read side by side, never to add. `laborerRows` counts the
 * entries that actually HAVE the second play; at 0 the two figures are
 * identical by construction and the footer drops the second one.
 *
 * `totalJournals` is the headcount that play needs: a laborer works ONE journal
 * per 22h cycle. Fractions are summed per journal identity and floored PER
 * GROUP — two half-filled Tinker T5 baskets are one journal, but a half-filled
 * Tinker and a half-filled Blacksmith are none, and a part-filled journal is
 * not something you can hand over. The profit total is unaffected by the floor:
 * extraSilverPerCraft is already prorated per craft (js/laborer-journal-value.js),
 * so the leftover fraction stays priced there. This figure is the discrete one
 * on purpose — it counts laborers, not silver.
 */
function summarizeCraftList(entries, allocation) {
  const acc = {
    count: 0, totalCost: 0, totalRevenue: 0, totalProfit: 0,
    // Faction Points the basket spends at the NPC — not silver, so not in
    // totalCost. Every planned unit pays it, focused or not.
    totalFp: 0,
    totalFavor: 0,
    totalLaborerProfit: 0, laborerRows: 0,
    totalJournals: 0, journalGroups: [], totalFocus: 0,
    // What the basket WOULD spend if focus were free, what the budget was, and
    // what it could not cover. Equal-and-zero when no allocation is passed.
    focusNeeded: 0, focusUnfunded: 0, focusBudget: Infinity, focusCapped: false,
    // The longest focus instalment on the list. Above 1 the focus figures are
    // a DAILY draw, not a one-sitting spend — a nurture ladder pays 125 a day
    // for as many days as the baby grows (js/craft-list-extractors.js).
    focusDays: 1,
  };
  (entries || []).forEach((e, i) => {
    const qty = Number(e && e.qty) || 0;
    const { fundedQty, unfundedQty } = _clSplit(allocation, i, e);
    const unitProfit = Number(e.unitProfit) || 0;
    const unitProfitNoFocus = Number.isFinite(Number(e.unitProfitNoFocus))
      ? Number(e.unitProfitNoFocus) : unitProfit;
    const laborerProfit = Number.isFinite(Number(e.laborerProfit))
      ? Number(e.laborerProfit) : unitProfit;
    const laborerProfitNoFocus = Number.isFinite(Number(e.laborerProfitNoFocus))
      ? Number(e.laborerProfitNoFocus) : laborerProfit;
    const inputCost = Number(e.inputCost) || 0;
    const inputCostNoFocus = Number.isFinite(Number(e.inputCostNoFocus))
      ? Number(e.inputCostNoFocus) : inputCost;
    acc.count += 1;
    acc.totalCost += inputCost * fundedQty + inputCostNoFocus * unfundedQty;
    acc.totalFp += (Number(e.fpCost) || 0) * (fundedQty + unfundedQty);
    acc.totalFavor += (Number(e.favorCost) || 0) * (fundedQty + unfundedQty);
    // Focus changes what a craft CONSUMES, never what it sells for, so revenue
    // is the same either way — but it is still summed over the split so a
    // parked row (quantity 0) drops out of it like everything else.
    acc.totalRevenue += (Number(e.sellPrice) || 0) * (fundedQty + unfundedQty);
    acc.totalProfit += unitProfit * fundedQty + unitProfitNoFocus * unfundedQty;
    acc.totalLaborerProfit += laborerProfit * fundedQty + laborerProfitNoFocus * unfundedQty;
    // A parked row has no play to run, so it must not put the "with laborers"
    // headline on a list that is not going to fill a single journal.
    acc.laborerRows += (e.hasLaborerPlay && qty > 0) ? 1 : 0;
    acc.totalFocus += (Number(e.focusCost) || 0) * fundedQty;
    if (qty > 0 && (Number(e.focusCost) || 0) > 0) {
      acc.focusDays = Math.max(acc.focusDays, Math.floor(Number(e.focusDays) || 1));
    }
  });

  if (allocation) {
    acc.focusNeeded = Number(allocation.focusNeeded) || 0;
    acc.focusUnfunded = Number(allocation.focusUnfunded) || 0;
    acc.focusBudget = Number(allocation.budget);
    acc.focusCapped = !!allocation.capped;
  } else {
    acc.focusNeeded = acc.totalFocus;
  }

  acc.journalGroups = [..._clJournalFractions(entries).values()]
    .map((g) => ({ slug: g.slug, tier: g.tier, journals: Math.floor(g.fraction) }))
    .filter((g) => g.journals > 0)
    .sort((a, b) => b.journals - a.journals || String(a.slug).localeCompare(b.slug));
  acc.totalJournals = acc.journalGroups.reduce((s, g) => s + g.journals, 0);
  return acc;
}

// Mirrors CRAFT_LIST_MAX_QTY (js/craft-list-store.js), which normalizes anything
// the back-solver hands back anyway — kept local so this pure module stays
// require-able bare, and because a top-level const is not a cross-file global.
const CRAFT_LIST_MAX_QTY_CAP = 1000000;

/**
 * Back-solve the list from a laborer headcount: how much to craft so the basket
 * fills `laborers` journals. Every laborer-play row scales by the SAME factor,
 * which keeps the mix the user built; a row with no laborer play has no journal
 * to solve for and is never touched.
 *
 * The divisor is the DISPLAYED (floored) count, so retyping the number already
 * on screen is a no-op — it only falls back to the fractional sum when the list
 * is too small to floor to one journal and there would be nothing to divide by.
 *
 * `entries` carry {tableId, rowKey, qty, laborerFill}. Returns only the rows
 * whose quantity actually moves, as {tableId, rowKey, qty}.
 */
function scaleCraftListToLaborers(entries, laborers) {
  const target = Number(laborers);
  if (!(target > 0)) return [];

  const groups = [..._clJournalFractions(entries).values()];
  if (!groups.length) return [];
  const fraction = groups.reduce((s, g) => s + g.fraction, 0);
  const floored = groups.reduce((s, g) => s + Math.floor(g.fraction), 0);
  const base = floored > 0 ? floored : fraction;
  if (!(base > 0)) return [];

  const factor = target / base;
  const out = [];
  (entries || []).forEach((e) => {
    const f = e && e.laborerFill;
    const qty = Number(e && e.qty) || 0;
    if (!f || !(f.craftsPerJournal > 0) || qty <= 0) return;
    const next = Math.min(Math.max(1, Math.round(qty * factor)), CRAFT_LIST_MAX_QTY_CAP);
    if (next !== qty) out.push({ tableId: e.tableId, rowKey: e.rowKey, qty: next });
  });
  return out;
}

if (typeof module !== "undefined" && module.exports) {
  // Re-exported so this module stays the list's one require target: the
  // extractors moved to their own file for size (the 800-line limit), not
  // because callers should have to know about two. A sandbox that concatenates
  // the sources has them as plain globals already and cannot resolve the path,
  // so the require is a best effort, not a dependency.
  let extractors = {};
  try {
    extractors = require("./craft-list-extractors.js");
  } catch (e) {
    if (typeof CRAFT_LIST_EXTRACTORS !== "undefined") {
      extractors = { CRAFT_LIST_EXTRACTORS, extractCraftListRow };
    }
  }
  module.exports = {
    ...extractors,
    aggregateCraftListMaterials,
    summarizeCraftList,
    scaleCraftListToLaborers,
  };
}
