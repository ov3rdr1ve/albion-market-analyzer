// The consumables table's enchant-variant model, split out of
// js/render-consumables.js to keep both files inside the 800-line cap.
//
// Generate enchant variants for T4+ craftable consumables. Mirrors the gear-
// table convention so the same expand/collapse UX works here. Each variant
// carries `baseId` (for the collapsible filter), `enchantLevel`, and an
// `enchantSauce` describing the upgrade material to add to the recipe.
//
// Foods enchant up to .3 (fishsauce L1/L2/L3). Classic potions only enchant to
// .1 (essence_potion of the matching tier); the rare/alchemy potions (Calming,
// Acid, Gathering, …) enchant up to .3 via Arcane Extract. The exact set of
// valid levels per item comes from ENCHANT_UPGRADE_SAUCE — extracted from
// items.xml — so this generator just follows the data.
//
// Sauces are non-tradeable. The Albion API never returns a price for
// fishsauce/essence_potion, so the row will show 0 silver by default and the
// user can override via the price-edit cell to factor in their own
// opportunity cost (per the user's product decision on 2026-05-05).
//
// Idempotent — already-generated variants pass through unchanged.
function generateConsumableEnchantVariants(items) {
  const out = [];
  const seenIds = new Set();
  const sauceMap = (typeof ENCHANT_UPGRADE_SAUCE !== "undefined") ? ENCHANT_UPGRADE_SAUCE : {};
  for (const item of items) {
    if (seenIds.has(item.id)) continue;
    seenIds.add(item.id);
    out.push(item);
    if (item.id.includes("@")) continue;        // already a variant
    // One rule for "does this base enchant?", shared with the expand caret so
    // generated rows and carets never disagree (foods from T4, potions from T3).
    if (!consumableBaseHasEnchantVariants(item.id)) continue;
    const upgrades = sauceMap[item.id] || [];
    for (const u of upgrades) {
      const variantId = `${item.id}@${u.level}`;
      if (seenIds.has(variantId)) continue;
      seenIds.add(variantId);
      out.push({
        ...item,
        id: variantId,
        baseId: item.id,
        enchantLevel: u.level,
        enchantSauce: { matId: u.sauceMatId, count: u.count },
        name: `${item.name} [.${u.level}]`,
      });
    }
  }
  return out;
}

// Single source of truth for "does this base emit .1/.2/.3 enchant rows?",
// used by BOTH the variant generator and the expand caret so they never
// disagree. An item enchants iff items.xml gave it upgrade sauces AND it clears
// the table's clutter floor: foods/meals enchant from T4, potions from T3 (the
// rare/alchemy potions — Calming/Acid/Gathering/… — start at T3). Standard T3
// potions (Resistance/Sticky/Gigantify) have no sauces, so they stay caret-free
// regardless; low-tier foods (T1–T3) are intentionally kept base-only.
function consumableBaseHasEnchantVariants(id) {
  if (!id || String(id).includes("@")) return false;
  const recipes = (typeof BUNDLED_RECIPES !== "undefined") ? BUNDLED_RECIPES : {};
  const sauceMap = (typeof ENCHANT_UPGRADE_SAUCE !== "undefined") ? ENCHANT_UPGRADE_SAUCE : {};
  if (!recipes[id] || !Array.isArray(sauceMap[id]) || sauceMap[id].length === 0) return false;
  const tier = (typeof getTierFromId === "function")
    ? getTierFromId(id)
    : parseInt((id.match(/^T(\d)/) || [])[1] || "0", 10);
  const isPotion = id.includes("_POTION_");
  if (tier < 3) return false;               // nothing enchants below T3
  if (tier < 4 && !isPotion) return false;  // foods enchant from T4 (clutter floor)
  return true;
}

// Node test harness export. Browser load uses globals; this branch is inert
// at runtime in the browser (module is undefined).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { generateConsumableEnchantVariants, consumableBaseHasEnchantVariants };
}