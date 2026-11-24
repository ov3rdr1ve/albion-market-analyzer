/**
 * My Crafting List — the focus budget.
 *
 * Focus is the one input on the list that cannot be bought. Premium regenerates
 * ~10,000 a day (pool capped at 30,000), so a basket that needs 40,000 focus is
 * not "40,000 focus of focused crafts" — it is one bar's worth of focused
 * crafts plus a long tail run at the BASE return rate. The list used to sum
 * `focusCost × qty` flat and price every unit focus-on, which overstated the
 * profit of any basket bigger than a bar.
 *
 * This module answers one question: given a budget, WHICH units get the focus?
 *
 * Greedy on silver-per-focus. A focus point is fungible across rows, so the
 * plan that gets the most out of a fixed budget spends it where it buys the
 * most silver — the same ranking `focusPlayRate` (js/focus-play.js) already
 * defines and the Profit / 10k Focus board already sorts on. Rows are funded
 * in WHOLE units first (`floor(remaining / focusCost)`); whatever is left once
 * no whole unit fits goes to the next unit in line as a fraction, because the
 * budget is a daily pool and an unspent remainder carries into tomorrow.
 *
 * Everything here is pure — no DOM, no market lookups, no globals. The split it
 * returns is consumed by summarizeCraftList / aggregateCraftListMaterials
 * (js/craft-list-materials.js) and rendered by js/render-craft-list-footer.js.
 */

/**
 * The production bonus focus adds. Mirrors FOCUS_BONUS in
 * js/data-city-bonuses.js — read from the live global when the app has loaded
 * it, with the literal as the fallback so this module stays require-able bare
 * in the Node tests (a top-level const in another file is NOT a global).
 */
function _clFocusBonusPB() {
  return (typeof FOCUS_BONUS === "number" && FOCUS_BONUS > 0) ? FOCUS_BONUS : 0.59;
}

/**
 * A return rate with the focus bonus taken back off.
 *
 * RRR = PB/(1+PB) (calcRRR, js/calculations.js), so PB = RRR/(1−RRR) and the
 * flat +0.59 focus bonus comes straight off the production bonus. Used only as
 * the FALLBACK when a source row does not publish its own base rate: a row that
 * does (`baseRrr`) is always believed instead, because a renderer knows about
 * city specs, no-return crafts and butcher rates that this inversion cannot see.
 *
 * A rate that is nothing but focus (or is not a rate at all) floors at 0 rather
 * than going negative.
 */
function rrrWithoutFocus(rrr) {
  const r = Number(rrr);
  if (!Number.isFinite(r) || !(r > 0) || r >= 1) return 0;
  const base = (r / (1 - r)) - _clFocusBonusPB();
  if (!(base > 0)) return 0;
  return base / (1 + base);
}

/**
 * Silver one focus point buys on ONE execution of this entry.
 *
 * `focusProfitDelta` is the row's own focus play measured per row execution
 * (js/focus-play.js makeFocusPlay) — what the row earns focus-on minus what it
 * earns focus-off. A row that gains nothing from focus rates 0 and sinks to the
 * back of the queue: burning budget on it while a paying row goes unfunded is
 * exactly the mistake this ranking exists to avoid.
 */
function craftListFocusRate(entry) {
  if (!entry) return 0;
  const cost = Number(entry.focusCost);
  if (!Number.isFinite(cost) || cost <= 0) return 0;
  const gain = Number(entry.focusProfitDelta);
  if (!Number.isFinite(gain) || gain <= 0) return 0;
  return gain / cost;
}

/** What the entry's quantity is worth as a count: never negative, never NaN. */
function _clQty(entry) {
  const q = Math.floor(Number(entry && entry.qty));
  return Number.isFinite(q) && q > 0 ? q : 0;
}

/** The budget as a number. Missing = no cap; junk or negative = none at all. */
function _clBudget(budget) {
  if (budget === undefined || budget === null) return Infinity;
  const b = Number(budget);
  if (!Number.isFinite(b)) return b === Infinity ? Infinity : 0;
  return b > 0 ? b : 0;
}

/**
 * Split every entry's quantity into the units the budget can focus and the
 * units it cannot.
 *
 * @param {object[]} entries  extracted rows + qty, exactly what
 *   summarizeCraftList takes (js/craft-list-materials.js).
 * @param {number} [budget]   focus points available. Omitted or Infinity = no
 *   cap (today's behaviour); 0, negative or unreadable = nothing is funded.
 * @param {object} [opts]     `focusEnabled: false` when the app's "Use Focus"
 *   box is off — the rows are already priced focus-off, so nothing is funded
 *   and nothing is needed. Defaults to enabled.
 * @returns {{splits: object[], focusUsed: number, focusNeeded: number,
 *   focusUnfunded: number, budget: number, capped: boolean}}
 *   `splits` is positional: splits[i] describes entries[i].
 */
function allocateCraftListFocus(entries, budget, opts) {
  const list = Array.isArray(entries) ? entries : [];
  const focusEnabled = !(opts && opts.focusEnabled === false);
  const cap = _clBudget(budget);

  const splits = list.map((e, index) => ({
    index, fundedQty: 0, unfundedQty: _clQty(e), focusUsed: 0,
  }));

  if (!focusEnabled) {
    // Focus is off app-wide, so every row's headline IS its focus-off figure.
    // Nothing is needed and nothing is short — reporting a shortfall here would
    // put a warning on a list that is not missing anything.
    return { splits, focusUsed: 0, focusNeeded: 0, focusUnfunded: 0, budget: cap, capped: false };
  }

  // A row focus cannot touch is not "unfunded" — focus changes nothing about
  // it, so it is fully funded at zero cost and never enters the queue.
  const queue = [];
  let focusNeeded = 0;
  list.forEach((e, i) => {
    const qty = splits[i].unfundedQty;
    const cost = Number(e && e.focusCost);
    if (!(qty > 0) || !Number.isFinite(cost) || cost <= 0) {
      splits[i].fundedQty = qty;
      splits[i].unfundedQty = 0;
      return;
    }
    focusNeeded += cost * qty;
    queue.push({ i, cost, qty, rate: craftListFocusRate(e) });
  });

  // Best silver-per-focus first; a tie goes to the cheaper focus, which is the
  // finer grain and therefore the one a small remainder can still buy a whole
  // unit of (same tie-break as pickBestFocusPlay, js/focus-play.js).
  queue.sort((a, b) => b.rate - a.rate || a.cost - b.cost || a.i - b.i);

  let remaining = cap;
  queue.forEach((q) => {
    const affordable = remaining >= q.cost * q.qty
      ? q.qty
      : Math.floor(remaining / q.cost);
    const funded = Math.max(0, Math.min(q.qty, affordable));
    if (!(funded > 0)) return;
    const spent = funded * q.cost;
    splits[q.i].fundedQty = funded;
    splits[q.i].unfundedQty = q.qty - funded;
    splits[q.i].focusUsed = spent;
    remaining -= spent;
  });

  // The whole-unit pass can leave a remainder no unit fits — 2,089 of a
  // 10,000 bar when every row still waiting costs more than that per unit.
  // The box is a regenerating pool, not a one-off purse: focus not spent today
  // is still there tomorrow, so over the plan that remainder funds part of the
  // next unit in line. Give it to the best-rate row that still has unfunded
  // units, as a fraction of a unit, so the footer reads the whole bar as used
  // instead of stranding it (a reported case, 2026-10-05: 7,911 / 10,000 used with
  // 50,265 unfocused).
  if (remaining > 0 && Number.isFinite(remaining)) {
    const next = queue.find((q) => splits[q.i].unfundedQty > 0);
    if (next) {
      const s = splits[next.i];
      const part = Math.min(s.unfundedQty, remaining / next.cost);
      s.fundedQty += part;
      s.unfundedQty -= part;
      s.focusUsed += part * next.cost;
      remaining -= part * next.cost;
    }
  }

  const focusUsed = splits.reduce((s, x) => s + x.focusUsed, 0);
  return {
    splits,
    focusUsed,
    focusNeeded,
    focusUnfunded: Math.max(0, focusNeeded - focusUsed),
    budget: cap,
    capped: focusNeeded > focusUsed,
  };
}

/**
 * Per-ROW split: every entry is allocated as if it alone had the whole budget,
 * so rows sized by the "10k" chip stay comparable side by side. The shared
 * allocator above still drives the footer and the materials board.
 *
 * @returns {{splits: object[]}} positional, splits[i].index === i.
 */
function allocateCraftListFocusStandalone(entries, budget, opts) {
  const list = Array.isArray(entries) ? entries : [];
  const splits = list.map((e, index) => {
    const one = allocateCraftListFocus([e], budget, opts).splits[0];
    return { ...one, index };
  });
  return { splits };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    rrrWithoutFocus,
    craftListFocusRate,
    allocateCraftListFocus,
    allocateCraftListFocusStandalone,
  };
}
