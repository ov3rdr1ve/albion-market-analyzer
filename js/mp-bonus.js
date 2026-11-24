/**
 * Masterpiece-quality bonus for breeding/saddler EV.
 *
 * Albion's saddler craft rolls quality from the base table:
 *   Normal 68.8% / Good 25% / Outstanding 5% / Excellent 1.1% / Masterpiece 0.1%
 * The animal-breeder/saddler specialization adds RRR but no quality bonus
 * (per the wiki), so the masterpiece chance is a flat 0.1% for every saddler
 * craft regardless of mount tier or mastery level.
 *
 * computeMpBonus() returns the additional expected silver per cycle from MP,
 * the MP-adjusted silver/FP, and the city/price the bonus is sourced from.
 * Display layer uses these to render an annotation next to the plain
 * silverPerFp without folding MP into the headline number.
 *
 * Pure function — no DOM, no module-scope mutable state. Two globals it
 * delegates to are passed implicitly (findBestSellCity, calculateSilverPerFp);
 * tests stub them on globalThis before requiring this module.
 */

(function () {
  const MOUNT_MP_CHANCE_DEFAULT = 0.001; // 0.1% — base craft quality table

  /**
   * @param {object}  opts
   * @param {object}  opts.mpMarketData     - { [itemId]: { [city]: { sell_price, ... } } } or null
   * @param {string}  opts.mountId          - the saddled mount output id
   * @param {string[]} opts.sellCitySearch  - cities to consider (section-aware)
   * @param {string|null} opts.excludeBuyCity - excluded by realm-zoning rules
   * @param {number}  opts.mpChance         - usually MOUNT_MP_CHANCE_DEFAULT
   * @param {number}  opts.premiumTax       - 0.04 typically
   * @param {number}  opts.setupFee         - market setup fee multiplier (e.g. 0.015)
   * @param {number}  opts.nurtureEv        - plain (non-MP) expected silver per cycle
   * @param {number}  opts.fpMatSilverCost  - silver cost of FP-priced mats (added back when computing fpAdjustedProfit)
   * @param {number}  opts.totalFpCost      - total FP outlay per cycle
   * @param {number}  [opts.favorMatSilverCost] - silver cost of the Favor-priced baby (added back for the Favor path)
   * @param {number}  [opts.totalFavorCost] - total Favor outlay per cycle (Brecilien owls)
   * @returns {{ mpSellCity: string|null, mpSellPrice: number, mpRevenuePerCycle: number, mpSilverPerFp: number, mpSilverPerFavor: number }}
   */
  function computeMpBonus(opts) {
    const {
      mpMarketData,
      mountId,
      sellCitySearch,
      excludeBuyCity,
      mpChance,
      premiumTax,
      setupFee,
      nurtureEv,
      fpMatSilverCost,
      totalFpCost,
      favorMatSilverCost = 0,
      totalFavorCost = 0,
    } = opts;

    let mpSellCity = null;
    let mpSellPrice = 0;
    let mpRevenuePerCycle = 0;

    if (mpMarketData && mpMarketData[mountId] && typeof findBestSellCity === "function") {
      const mpBest = findBestSellCity(mpMarketData, mountId, sellCitySearch, 0, excludeBuyCity);
      if (mpBest && mpBest.city && mpBest.price > 0) {
        mpSellCity = mpBest.city;
        mpSellPrice = mpBest.price;
        mpRevenuePerCycle = mpChance * mpBest.price * (1 - premiumTax);
      }
    }

    // MP-adjusted silver/FP — same FP-adjustment shape the plain silverPerFp uses
    // in render-mounts.js (nurtureEv + fpMatSilverCost × (1 + setupFee)) so the
    // two figures are directly comparable.
    const mpAdjustedNurtureEv = nurtureEv + mpRevenuePerCycle;
    const mpAdjustedFpProfit = mpAdjustedNurtureEv > 0
      ? mpAdjustedNurtureEv + fpMatSilverCost * (1 + setupFee)
      : 0;

    let mpSilverPerFp = 0;
    if (totalFpCost > 0 && mpAdjustedFpProfit > 0 && mpRevenuePerCycle > 0
        && typeof calculateSilverPerFp === "function") {
      mpSilverPerFp = calculateSilverPerFp(mpAdjustedFpProfit, totalFpCost);
    }

    // MP-adjusted silver/Favor — same shape, for Favor-bought babies (Brecilien
    // owls). Only the baby is Favor-priced, so favorMatSilverCost is its silver
    // price (mirrors favorAdjustedProfit in render-mounts.js).
    const mpAdjustedFavorProfit = mpAdjustedNurtureEv > 0
      ? mpAdjustedNurtureEv + favorMatSilverCost * (1 + setupFee)
      : 0;
    let mpSilverPerFavor = 0;
    if (totalFavorCost > 0 && mpAdjustedFavorProfit > 0 && mpRevenuePerCycle > 0
        && typeof calculateSilverPerFavor === "function") {
      mpSilverPerFavor = calculateSilverPerFavor(mpAdjustedFavorProfit, totalFavorCost);
    }

    return { mpSellCity, mpSellPrice, mpRevenuePerCycle, mpSilverPerFp, mpSilverPerFavor };
  }

  // Browser global + CommonJS export
  if (typeof window !== "undefined") {
    window.computeMpBonus = computeMpBonus;
    window.MOUNT_MP_CHANCE_DEFAULT = MOUNT_MP_CHANCE_DEFAULT;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { computeMpBonus, MOUNT_MP_CHANCE_DEFAULT };
  }
})();
