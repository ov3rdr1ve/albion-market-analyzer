// Breeding — Profit / Day, for the Crafting List's Total Profit cell.
//
// Profit / Day = a profit / (grow hours / 24). The hours come from
// getBreedingGrowHours() (js/render-mounts-breeding-row.js), so the figure
// follows the Premium Account toggle: a T8 horse is 142 h with Premium, 284 h
// without. The Crafting List feeds it the cell's own Total Profit (per-animal
// profit x Qty); see js/craft-list-per-day.js. Pure maths, no pricing, no DOM.

/** Pure: profit per day, or null when either input cannot make a rate. */
function breedingProfitPerDay(profit, hours) {
  if (profit === null || profit === undefined || profit === "") return null;
  if (hours === null || hours === undefined || hours === "") return null;
  const p = Number(profit);
  const h = Number(hours);
  if (!Number.isFinite(p) || !Number.isFinite(h) || h <= 0) return null;
  return p / (h / 24);
}

/** Grow hours (Premium-aware) of a breeding row, or null for any other row. */
function breedingRowGrowHours(row) {
  if (!row || !row.isBreeding) return null;
  const meta = row.meta || (typeof getBreedingMeta === "function" ? getBreedingMeta(row.item) : null);
  if (!meta) return null;
  const hours = getBreedingGrowHours(meta);
  return Number.isFinite(hours) && hours > 0 ? hours : null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { breedingProfitPerDay, breedingRowGrowHours };
}
