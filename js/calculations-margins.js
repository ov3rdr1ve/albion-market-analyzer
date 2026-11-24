// Split from js/calculations.js: flip / transport / craft margins, the focus bar,
// silver formatting and the rolling EV. Loads right after calculations.js;
// nothing here runs at load time. Node: calculations.js require()s this file.

/**
 * Calculates raw profit for flipping an item (Buy Order -> Sell Order)
 * @param {number} travelCost - flat per-unit silver cost (e.g. Brecilien Travel
 *   Planner fee when buying in Brecilien and selling elsewhere). Added to cost.
 */
function calculateFlipMargin(buyPrice, sellPrice, travelCost = 0) {
  if (!buyPrice || !sellPrice) return { profit: 0, margin: 0 };

  const totalCost = buyPrice * (1 + SETUP_FEE) + travelCost;
  const totalRevenue = sellPrice * (1 - PREMIUM_TAX);

  const profit = totalRevenue - totalCost;
  const margin = (profit / totalCost) * 100;

  return { profit: profit, margin: margin };
}

/**
 * Calculates Royal City Transport Margin (Buy Order raw -> Sell Order refined)
 * Now includes city refining RRR — effective raw consumed is reduced by return rate
 */
function calculateTransportMargin(
  buyCost,
  sellPrice,
  rrr = 0,
  secondaryMatCost = 0,
  stationFee = 0,
  travelCost = 0,
  nonReturnableMatCost = 0,
  setupExemptCost = 0,
) {
  if (!buyCost || !sellPrice) return { profit: 0, margin: 0 };

  // Primary + secondary materials are subject to RRR. A faction heart used as a
  // refining substitute is NOT returned (nonReturnableMatCost): it sits outside
  // the (1-rrr) discount but still inside the setup fee. Station fee and
  // travel-planner fee are flat silver, unaffected by the return rate.
  // `setupExemptCost` is the slice of buyCost/secondaryMatCost that was never a
  // market purchase (transmute silver, a sub-chain's station fees): consumed like
  // the rest, so still RRR-discounted, but it pays no buy-order setup fee.
  const effectiveCost =
    ((buyCost + secondaryMatCost - setupExemptCost) * (1 - rrr) + nonReturnableMatCost) * (1 + SETUP_FEE)
    + setupExemptCost * (1 - rrr) + stationFee + travelCost;
  const totalRevenue = sellPrice * (1 - PREMIUM_TAX);

  const profit = totalRevenue - effectiveCost;
  const margin = (profit / effectiveCost) * 100;

  return { profit, margin };
}

/**
 * Crafting Loop with City Bonus + Focus
 * @param {number} rrr - Resource return rate (from getCraftRRR)
 */
function calculateCraftMargin(
  matCost,
  totalMats,
  outputPrice,
  rrr = 0,
  emptyJournalCost = 0,
  fullJournalPrice = 0,
  travelCost = 0,
) {
  if (!matCost || !outputPrice) return { profit: 0, margin: 0 };

  // With RRR, effective materials consumed is reduced
  const effectiveMats = totalMats * (1 - rrr);

  const totalMatCost = matCost * effectiveMats * (1 + SETUP_FEE);
  // travelCost: flat per-craft Travel Planner fee (Brecilien-origin legs).
  const totalInputCost = totalMatCost + emptyJournalCost * (1 + SETUP_FEE) + travelCost;

  const gearRevenue = outputPrice * (1 - PREMIUM_TAX);
  const journalRevenue = fullJournalPrice * (1 - PREMIUM_TAX);

  const totalRevenue = gearRevenue + journalRevenue;
  const profit = totalRevenue - totalInputCost;
  const margin = (profit / totalInputCost) * 100;

  return { profit, margin };
}

/**
 * Calculate items per ox load and total profit per load
 */
function calculateOxLoad(profitPerItem, weightPerItem) {
  if (!weightPerItem || weightPerItem <= 0)
    return { itemsPerLoad: 0, profitPerLoad: 0 };
  const itemsPerLoad = Math.floor(OX_CAPACITY_KG / weightPerItem);
  const profitPerLoad = profitPerItem * itemsPerLoad;
  return { itemsPerLoad, profitPerLoad };
}

/**
 * Plain silver-per-focus ratio, guarded against a zero/absent focus cost.
 *
 * NOT the Silver/Focus column: that is the MARGINAL figure — what the winning
 * focus play adds to the row's end product, over the focus it burns — and it is
 * built by js/focus-play.js. Passing a row's whole profit in here was the old
 * definition, and it credited focus with profit the row earns anyway. Kept for
 * callers that genuinely want a bare ratio.
 */
function calculateProfitPerFocus(profitPerCraft, focusCostPerCraft) {
  if (!focusCostPerCraft || focusCostPerCraft <= 0) return 0;
  return profitPerCraft / focusCostPerCraft;
}

/**
 * Total profit from spending a full daily focus bar (10,000 focus) on one row.
 * = profit per craft/refine × how many whole crafts 10k focus buys. Pairs with
 * the "Mats to Buy (10k Focus)" shopping list, which counts the same crafts.
 * The profit operand is NET of mat purchases — that list is exactly the mat
 * component inside this figure, never an extra charge on top of it. Partial
 * crafts are dropped (floor) — leftover focus buys nothing — while a craft fits
 * inside the bar. A craft costing MORE than the bar floored to 0 and read as a
 * worthless play (every T8 artifact craft did), so above the bar the bar buys
 * a fraction of one craft instead — see focusBarCrafts.
 *
 * `actionsPerOutput` separates the two units when they differ. A refining LADDER
 * can spend its focus on a rung below the item it sells: a focus bar still buys
 * floor(10k/focusCost) refine ACTIONS, but each sold output costs less than one
 * of them, so it yields more outputs than actions. Defaults to 1, where actions
 * and outputs are the same thing and this is the plain formula above.
 */
const FOCUS_BAR = 10000;

/**
 * How many crafts (refines, cycles, …) one 10,000-focus bar buys.
 * Whole crafts while one fits inside the bar; a fraction once a single craft
 * costs more than the bar. Continuous at the boundary: 10,000 focus is exactly
 * one craft either way. 0 for a missing or non-positive cost.
 */
function focusBarCrafts(focusCostPerCraft) {
  if (!(focusCostPerCraft > 0)) return 0;
  return focusCostPerCraft > FOCUS_BAR
    ? FOCUS_BAR / focusCostPerCraft
    : Math.floor(FOCUS_BAR / focusCostPerCraft);
}

function calculateProfitPer10kFocus(profitPerCraft, focusCostPerCraft, actionsPerOutput = 1) {
  if (!focusCostPerCraft || focusCostPerCraft <= 0) return 0;
  if (!(actionsPerOutput > 0)) return 0;
  return profitPerCraft * (focusBarCrafts(focusCostPerCraft) / actionsPerOutput);
}

/** A bar's craft count for a tooltip: whole numbers as-is, a fraction to 2 dp. */
function formatBarCrafts(crafts) {
  if (!(crafts > 0)) return "0";
  return Number.isInteger(crafts) ? crafts.toLocaleString() : crafts.toFixed(2);
}

/**
 * Formats a number to silver standard (e.g., 12,345)
 */
function formatSilver(num) {
  if (num === null || num === undefined) return "N/A";
  return Math.round(num).toLocaleString();
}

/**
 * Focus cost for display. getFocusCost returns the exact fractional charge the
 * game applies (a maxed T4 Avalonian Goat Stew is 1.2816 focus per unit), which
 * must never be rounded in the arithmetic — see getFocusCost in js/utils.js.
 * The precision here mirrors the game client, which prints about three
 * significant digits: "3.38/ea" for a maxed leather refine, "80.3/each" for a
 * stew, a whole number once the cost is in the hundreds.
 */
function formatFocusCost(focusCost) {
  if (focusCost === null || focusCost === undefined || !Number.isFinite(focusCost)) return "N/A";
  const abs = Math.abs(focusCost);
  if (abs >= 100) return Math.round(focusCost).toLocaleString();
  const decimals = abs >= 10 ? 1 : 2;
  return String(Number(focusCost.toFixed(decimals)));
}

/**
 * Inline "+N travel" badge for the Brecilien Travel Planner haul-out fee.
 * Profit tables already fold this fee into a route's input cost & profit
 * (legBrecilienCost); the badge just makes the silver visible next to the
 * route so the numbers reconcile. Returns "" when there is no fee — crafted
 * and sold inside Brecilien, never touched it, or Black/Red Zone routes on.
 */
function brecilienFeeBadge(fee) {
  if (!(fee > 0)) return "";
  return ` <small style="color:#9e8840" title="Brecilien Travel Planner fee to haul out of the Mists (already included in the input cost &amp; profit)">+${formatSilver(fee)} travel</small>`;
}

/**
 * Renders a CSS class based on profit margin
 */
function getProfitClass(margin) {
  if (margin >= 20) return "profit-high";
  if (margin >= 10) return "profit-medium";
  if (margin > 0) return "profit-low";
  return "profit-negative";
}

/**
 * Calculates Expected Value (EV) for rolling artifacts.
 * @param {number} fragmentPrice Price of the fragment (Rune/Soul/Relic/Shard)
 * @param {Array<number>} artifactPrices Array of sell prices for the possible artifacts
 * @param {number} salvageReturn Number of fragments returned if salvaged
 * @param {number} rollCost Number of fragments required to roll
 */
function calculateRollingEV(
  fragmentPrice,
  artifactPrices,
  salvageReturn,
  rollCost,
) {
  if (!fragmentPrice || artifactPrices.length === 0 || !rollCost)
    return { ev: 0, margin: 0, rerollCount: 0, totalCount: 0 };

  const totalCost = rollCost * fragmentPrice * (1 + SETUP_FEE);
  let totalEv = 0;
  let rerollCount = 0;

  // Filter out completely missing prices from the average to not skew it negatively if 1 item is missing data
  const validPrices = artifactPrices.filter((p) => p > 0);
  if (validPrices.length === 0)
    return { ev: 0, margin: 0, rerollCount: 0, totalCount: 0 };

  for (const price of validPrices) {
    // Revenue from selling the artifact
    const sellRevenue = price * (1 - PREMIUM_TAX);
    // Revenue from salvaging the artifact
    // Salvage is valued at the market fee only, no sales tax. This is a SALE of
    // the recovered runes, so it follows the sell toggle, not the buy one —
    // reading the bare SETUP_FEE here would have charged the fee on the
    // fragments the roll bought instead.
    const salvageRevenue = salvageReturn * fragmentPrice * (1 - marketSetupFee("sell"));

    if (salvageRevenue > sellRevenue) {
      totalEv += salvageRevenue;
      rerollCount++;
    } else {
      totalEv += sellRevenue;
    }
  }

  const avgEv = totalEv / validPrices.length;
  const margin = totalCost > 0 ? ((avgEv - totalCost) / totalCost) * 100 : 0;

  return {
    ev: avgEv,
    margin: margin,
    rerollCount: rerollCount,
    totalCount: validPrices.length,
  };
}

// Node: a plain require() of this file (from calculations.js) gets its API. In a
// concatenated sandbox the names are added to whatever module.exports holds.
if (typeof module !== "undefined" && module.exports) {
  Object.assign(module.exports, {
    calculateFlipMargin, calculateTransportMargin, calculateCraftMargin,
    calculateOxLoad, calculateProfitPerFocus, calculateProfitPer10kFocus, FOCUS_BAR,
    focusBarCrafts, formatBarCrafts,
    formatSilver, formatFocusCost, brecilienFeeBadge, getProfitClass, calculateRollingEV,
  });
}
