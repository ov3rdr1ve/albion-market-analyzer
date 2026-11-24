/**
 * Quality Rerolling Data & Helpers
 * Handles quality upgrade transitions (Normal→Good→Outstanding→Excellent→Masterpiece).
 */

const QUALITY_NAMES = {
  1: "Normal",
  2: "Good",
  3: "Outstanding",
  4: "Excellent",
  5: "Masterpiece",
};

// All meaningful quality upgrade transitions
const QUALITY_TRANSITIONS = [
  { from: 1, to: 2 },
  { from: 1, to: 3 },
  { from: 1, to: 4 },
  { from: 1, to: 5 },
  { from: 2, to: 3 },
  { from: 2, to: 4 },
  { from: 2, to: 5 },
  { from: 3, to: 4 },
  { from: 3, to: 5 },
  { from: 4, to: 5 },
];

// Outcome table of one "Reroll Quality" at a repair station, as reworked in
// Lands Awaken: REROLL_MATRIX[from][to] is the chance a `from`-quality item
// lands on `to`. A reroll never lowers quality, and the Normal column has no
// stay-put mass — rerolling a Normal item always upgrades it.
//
// The old model rolled the CRAFTING quality table (25/5/1/0.1%) once per
// attempt, which put Normal → Excellent at 91 attempts. The station instead
// walks up through the intermediate qualities, so it averages ~3.8.
const REROLL_MATRIX = {
  1: { 2: 0.8, 3: 0.15, 4: 0.05, 5: 0.001 },
  2: { 2: 0.3, 3: 0.6, 4: 0.099, 5: 0.001 },
  3: { 3: 0.5, 4: 0.499, 5: 0.001 },
  4: { 4: 0.995, 5: 0.005 },
};

// Silver per reroll = [item value] * [modifier of the item's CURRENT quality].
// In-game the result is further scaled by Global Discount and Gold Market
// Stabilization, which are server-wide and not modelled here.
const REROLL_COST_MODIFIER = { 1: 4.4, 2: 5.5, 3: 6.6, 4: 27.5 };

/** Chance a reroll leaves the item at the quality it started on. */
function getRerollStayChance(quality) {
  const row = REROLL_MATRIX[quality];
  if (!row) return 0;
  return row[quality] || 0;
}

/**
 * Solves the absorbing Markov chain over qualities below `toQuality`, where the
 * per-attempt payoff is `cost(quality)`: 1 for an attempt count, silver for a
 * price. States only move upward, so one descending pass is exact.
 *
 *   E[q] = (cost(q) + Σ_{q < q' < to} P(q→q') · E[q']) / (1 − P(q→q))
 */
function solveRerollWalk(fromQuality, toQuality, cost) {
  if (!(fromQuality < toQuality)) return 0;
  const expected = {};
  for (let q = toQuality - 1; q >= fromQuality; q--) {
    const row = REROLL_MATRIX[q];
    if (!row) return Infinity;
    let carried = 0;
    for (let next = q + 1; next < toQuality; next++) {
      carried += (row[next] || 0) * expected[next];
    }
    const escape = 1 - getRerollStayChance(q);
    if (escape <= 0) return Infinity;
    expected[q] = (cost(q) + carried) / escape;
  }
  return expected[fromQuality];
}

/**
 * Expected number of rerolls to lift an item from fromQuality to at least
 * toQuality. 0 when the item already qualifies.
 */
function getExpectedAttempts(fromQuality, toQuality) {
  return solveRerollWalk(fromQuality, toQuality, () => 1);
}

/**
 * items.xml item value of a gear piece — what the reroll fee is billed against.
 * Unknown ids fall back to a plain-armor-shaped estimate so a missing entry
 * never prices a reroll at zero.
 */
function getGearItemValue(itemId) {
  const table = typeof ITEM_VALUES !== "undefined" ? ITEM_VALUES : null;
  const known = table && table[String(itemId).split("@")[0]];
  if (known) return known;
  const tier = Number(/^T(\d)/.exec(String(itemId))?.[1]) || 4;
  return 128 * Math.pow(2, tier - 4);
}

/**
 * Expected silver to reroll an item from fromQ up to toQ, accumulated along the
 * same walk as the attempt count because each quality is billed at its own rate.
 */
function getExpectedRerollCost(itemId, fromQ, toQ) {
  const itemValue = getGearItemValue(itemId);
  const gross = solveRerollWalk(fromQ, toQ, (q) => itemValue * (REROLL_COST_MODIFIER[q] || 0));
  // An unreachable transition stays Infinity — discounting it would read as free.
  if (!Number.isFinite(gross)) return gross;
  return typeof applyGlobalDiscount === "function" ? applyGlobalDiscount(gross) : gross;
}

// Mounts whose items.xml entry is maxqualitylevel=1: siege engines, battle
// swampdragons, the fire drake and the battle mammoth have no quality to reroll.
const NON_REROLLABLE_MOUNTS = new Set([
  "T6_MOUNT_SIEGE_BALLISTA",
  "T7_MOUNT_SWAMPDRAGON_BATTLE",
  "T7_MOUNT_ARMORED_SWAMPDRAGON_BATTLE",
  "T7_MOUNT_SWAMPDRAGON_AVALON_BASILISK",
  "T8_MOUNT_DRAKE_FIRE",
  "T8_MOUNT_MAMMOTH_BATTLE@1",
]);

// A handful of mounts are .1 by nature (items.xml enchantmentlevel="1"), so the
// @1 id IS the item — Swiftclaw, Rageclaw, Bonehorse, Morgana Nightmare,
// Caerleon Cottontail. MOUNT_RECIPES lists them under that id; they are not an
// enchant variant of anything and reroll like any other mount.
function isNativeEnchantMount(id) {
  return id.includes("@") && typeof MOUNT_RECIPES !== "undefined"
    && MOUNT_RECIPES.some((m) => m.id === id);
}

/**
 * Mounts DO carry quality (items.xml gives them maxqualitylevel=5) and reroll
 * at the repair station like any other equipment. They reach CRAFTING_ITEMS
 * through MOUNT_RECIPES without an isGearRecipe flag, so they are recognised
 * by their _MOUNT_ id. T3 stays below the tier floor and `@` variants are
 * priced under their base id.
 */
function isRerollableMount(id) {
  if (!id.includes("_MOUNT_")) return false;
  if (NON_REROLLABLE_MOUNTS.has(id)) return false;
  if (id.includes("@") && !isNativeEnchantMount(id)) return false;
  const tier = getTierFromId(id);
  return tier >= 4 && tier <= 8;
}

/**
 * Returns the T4-T8 base equipment and mounts that can be quality-rerolled.
 * Quality applies to every equipment piece and to mounts: getEquipmentSlot
 * (data-enchanting.js) keeps out the artifact MATERIALS and consumables that
 * isGearRecipe alone lets through — those have no quality and can never price.
 */
function getRerollableItems() {
  return CRAFTING_ITEMS.filter((item) => {
    if (item.id.includes("@") && !isNativeEnchantMount(item.id)) return false;
    if (isRerollableMount(item.id)) return true;
    if (!item.isGearRecipe) return false;
    if (!getEquipmentSlot(item.id)) return false;
    const tier = getTierFromId(item.id);
    return tier >= 4 && tier <= 8;
  });
}

/**
 * Returns item IDs needed for quality price fetching (T4-T8 base equipment).
 */
function getQualityItemIds() {
  return getRerollableItems().map((item) => item.id);
}
