// My Crafting List — the "/day" line under a breeding row's Total Profit.
//
// Total Profit (per-animal profit x Qty, the cell's own first number) over the
// animal's grow days: `5,373,833 /day`, in the same dimmed block as the
// "self-gathered" line. Breeding rows only; a row with no grow time, a parked
// (Qty 0) row or a non-finite total gets no line. A loss stays negative.
// Total Profit sorting stays on the first number. Lives in its own file because
// js/render-craft-list.js is past the 800-line cap.

/** The dimmed `<n> /day` line (HTML), or "" when the row has no rate. */
function clPerDayLine(row, total, parked) {
  if (parked || total === null || total === undefined) return "";
  if (typeof breedingRowGrowHours !== "function") return "";
  const hours = breedingRowGrowHours(row);
  const perDay = hours === null ? null : breedingProfitPerDay(total, hours);
  if (perDay === null) return "";
  const say = (typeof tx === "function") ? tx : (en) => en;
  const fmt = (typeof _clFmt === "function") ? _clFmt : (n) => String(Math.round(n));
  const shownHours = Number.isInteger(hours) ? hours : Math.round(hours * 100) / 100;
  const tip = say("Total Profit / (grow hours / 24) = {total} / ({hours}h / 24). Qty included; grow time follows Premium.", "r_cl_perday_tip")
    .replace("{total}", fmt(total)).replace("{hours}", String(shownHours));
  const esc = (typeof _clEsc === "function") ? _clEsc : (x) => String(x);
  return `<small class="cl-row-perday" style="color:#9ca3af;display:block;font-size:0.7rem" title="${esc(tip)}">`
    + `${fmt(perDay)} ${say("/day", "r_cl_perday")}</small>`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { clPerDayLine };
}
