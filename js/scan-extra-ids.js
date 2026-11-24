// Extra id sources folded into "Scan Market Now" (getAllRequiredItemIds in utils.js):
// Faction Spending, the full flipping universe (luxury TREASURE_*, FLIP_EXTRA_IDS)
// and the Craft Planner @1..@4 variants. Every dependency is optional + guarded.
function getScanExtraItemIds() {
  const out = new Set();
  const add = (list) => {
    if (!Array.isArray(list)) return;
    list.forEach((id) => { if (id && !String(id).includes("__")) out.add(id); });
  };
  const safe = (fn) => { try { add(fn()); } catch (e) { /* source not ready — skip */ } };
  if (typeof getFactionSpendingItemIds === "function") safe(() => getFactionSpendingItemIds());
  if (typeof getFlippingItemIds === "function") safe(() => getFlippingItemIds());
  if (typeof FLIP_EXTRA_IDS !== "undefined") safe(() => Array.from(FLIP_EXTRA_IDS));
  if (typeof _cpCollectVariantIds === "function") {
    for (let lvl = 1; lvl <= 4; lvl++) safe(() => _cpCollectVariantIds({ enchLevel: lvl }));
  }
  return Array.from(out);
}
