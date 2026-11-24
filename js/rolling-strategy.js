/**
 * Artifact Rolling Strategy — pure decision logic (no DOM, no market I/O).
 *
 * Separated from render-rolling.js so the optimal-stopping maths and the
 * per-row sell / reroll / salvage decision can be unit-tested in isolation.
 *
 * The model (optimal stopping):
 *   Each reroll costs `netRerollCost` = full roll cost − salvage recovery
 *   (you spend 36/50 fragments to roll, get only ~10 back on salvage). You
 *   should reroll an artifact only while its sell value is below the option
 *   value T* of rolling again, where:
 *       T* = E[max(v_i, T*)] − netRerollCost
 *
 *   Consequence: rerolling is only ever worth it inside a "hunt" group. When
 *   rolling is marginal (T* ≤ 0, i.e. fragments are expensive relative to the
 *   artifacts) you keep/sell whatever you roll and salvage the duds for their
 *   fragments — you never gamble again. `decideRowAction` enforces this: it
 *   returns "reroll" ONLY for hunt groups.
 */

/**
 * Solve T* = E[max(v_i, T*)] − netRerollCost by fixed-point iteration.
 * @param {number[]} values net sell revenue of each artifact in the pool
 * @param {number} netRerollCost silver burned per reroll (full roll − salvage)
 * @returns {number} the optimal sell threshold T*
 */
function solveOptimalThreshold(values, netRerollCost) {
  if (!values || values.length === 0) return 0;
  let T = 0;
  for (let i = 0; i < 30000; i++) {
    const Tnew =
      values.reduce((s, v) => s + Math.max(v, T), 0) / values.length -
      netRerollCost;
    if (Math.abs(Tnew - T) < 1) {
      T = Tnew;
      break;
    }
    T = Tnew;
  }
  return T;
}

/**
 * Classify a roll group (one section × cat × tier × rollType pool).
 * @param {number[]} sellRevenues net (post-tax) sell revenue of each artifact
 * @param {number} netRerollCost silver burned per reroll
 * @returns {{type: 'hunt'|'keep-any'|'unprofitable', Tstar: number}}
 *   - hunt        → keep/sell artifacts above T*, reroll the rest
 *   - keep-any    → rolling marginal; sell or salvage what you roll, never reroll
 *   - unprofitable→ T* exceeds even the jackpot (degenerate); don't roll
 */
function classifyRollGroup(sellRevenues, netRerollCost) {
  const Tstar = solveOptimalThreshold(sellRevenues, netRerollCost);
  const huntCount = sellRevenues.filter((v) => v >= Tstar && Tstar > 0).length;
  let type;
  if (Tstar <= 0 || huntCount === sellRevenues.length) type = "keep-any";
  else if (huntCount === 0) type = "unprofitable";
  else type = "hunt";
  return { type, Tstar };
}

/**
 * Decide the action for a single artifact row.
 * Guarantee: "reroll" is returned ONLY for hunt groups (artifact below T*).
 * @param {'hunt'|'keep-any'|'unprofitable'} type group classification
 * @param {number} Tstar optimal sell threshold for the group
 * @param {number} sellRevenue this artifact's net sell revenue
 * @param {number} salvageValue net silver from salvaging this artifact (10 frags − fee)
 * @returns {'sell'|'reroll'|'salvage'|'skip'}
 */
function decideRowAction(type, Tstar, sellRevenue, salvageValue) {
  if (type === "hunt") {
    return sellRevenue >= Tstar ? "sell" : "reroll";
  }
  if (type === "keep-any") {
    // Rolling isn't worth continuing: sell the artifact, or salvage it for
    // fragments and sell those — but never reroll.
    return sellRevenue >= salvageValue ? "sell" : "salvage";
  }
  // unprofitable (degenerate): don't roll at all.
  return "skip";
}

/**
 * Whole-campaign economics for one roll group.
 *
 * A "campaign" = buy fragments, roll once, then follow the optimal-stopping
 * policy (sell / salvage / reroll) until you cash out. In a hunt group that is
 * MORE than one roll, so the headline margin and the silver-per-fragment figure
 * must be divided by the EXPECTED total spend — dividing by the first roll
 * alone flatters a hunt group badly (it ignores every fragment burned chasing
 * the jackpot).
 *
 *   expected rolls        n = 1 / P(sell)                (hunt; 1 otherwise)
 *   expected fragments      = rollFrags + (rollFrags − salvageFrags)·(n − 1)
 *   expected silver         = rollCost  + (rollCost − salvageValue)·(n − 1)
 *
 * profitPerCampaign:
 *   hunt      → T* − salvageValue  (the option value of a fresh roll, net of
 *               the artifact you salvage to pay for it)
 *   otherwise → E[max(v, salvageValue)] − rollCost — one roll, then either sell
 *               the artifact or break it for fragments; never gamble again.
 *
 * @param {number[]} sellRevenues net (post-tax) sell revenue of each artifact
 * @param {number} rollCostSilver silver for ONE roll (fragments + setup fee)
 * @param {number} salvageValue net silver from salvaging one rolled artifact
 * @param {number} rollFrags fragments consumed per roll (36 any / 50 class)
 * @param {number} salvageFrags fragments recovered per salvage (20% of 50 = 10)
 * @returns {{type: string, Tstar: number, profitPerCampaign: number,
 *   expectedRolls: number, expectedCost: number, expectedFragments: number,
 *   marginPct: number, profitPerFragment: number, sellChance: number}}
 */
function rollCampaignEconomics(
  sellRevenues,
  rollCostSilver,
  salvageValue,
  rollFrags,
  salvageFrags,
) {
  const pool = sellRevenues || [];
  const netRerollCost = rollCostSilver - salvageValue;
  const { type, Tstar } = classifyRollGroup(pool, netRerollCost);

  const mean = (arr, f) =>
    arr.length ? arr.reduce((s, v) => s + f(v), 0) / arr.length : 0;

  let profitPerCampaign;
  let sellChance;
  if (type === "hunt") {
    profitPerCampaign = Tstar - salvageValue;
    sellChance = pool.filter((v) => v >= Tstar).length / pool.length;
  } else {
    // Single roll: keep the artifact if it beats salvage, otherwise break it.
    profitPerCampaign = pool.length
      ? mean(pool, (v) => Math.max(v, salvageValue)) - rollCostSilver
      : 0;
    sellChance = 1;
  }

  const expectedRolls = sellChance > 0 ? 1 / sellChance : 1;
  const extraRolls = expectedRolls - 1;
  const expectedCost = rollCostSilver + netRerollCost * extraRolls;
  const expectedFragments =
    rollFrags + Math.max(0, rollFrags - salvageFrags) * extraRolls;

  const safeDiv = (a, b) => (b > 0 ? a / b : 0);
  return {
    type,
    Tstar,
    profitPerCampaign,
    expectedRolls,
    expectedCost,
    expectedFragments,
    marginPct: safeDiv(profitPerCampaign, expectedCost) * 100,
    profitPerFragment: safeDiv(profitPerCampaign, expectedFragments),
    sellChance,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    solveOptimalThreshold,
    classifyRollGroup,
    decideRowAction,
    rollCampaignEconomics,
  };
}
