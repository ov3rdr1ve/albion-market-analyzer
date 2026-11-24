/**
 * The single answer to "what materials does this craft take?".
 *
 * BUNDLED_RECIPES (js/recipes.js) is a synchronous bundled constant, but the
 * app used to reach it only through `recipeCache`, which is filled by
 * fetchCraftingRecipe() from inside the scan handlers. renderAllTables() also
 * runs at boot (js/app.js) after restoring persisted + captured prices — with
 * an EMPTY cache. Every table then fell through to the single-material legacy
 * line, and the furniture entries in CRAFTING_ITEMS carry only their PRIMARY
 * material, so Elder's Bed rendered as "10x Planks" with its 20x Cloth missing:
 * understated cost, overstated profit, wrong journal fame.
 *
 * Resolution order below is deliberately identical to the old WARM-cache
 * behaviour, so a table renders the same recipe whether or not a scan has run.
 *
 * Guarded with `typeof` because the Node test sandboxes compile arbitrary
 * subsets of js/ — same pattern as js/table-search-fetch.js.
 */

/** Cache-then-bundle lookup by id. Returns null when nothing knows the recipe. */
function resolveRecipeById(itemId) {
  if (!itemId) return null;
  // The cache is authoritative when populated: js/render-consumables.js writes
  // DERIVED @n variants (base recipe + enchant sauce) straight into it, and
  // those exist nowhere else.
  if (typeof recipeCache !== "undefined" && recipeCache) {
    const cached = recipeCache[itemId];
    if (cached && cached.length > 0) return cached;
  }
  if (typeof BUNDLED_RECIPES !== "undefined" && BUNDLED_RECIPES) {
    const bundled = BUNDLED_RECIPES[itemId];
    if (bundled && bundled.length > 0) return bundled;
  }
  return null;
}

/**
 * Full recipe for a catalog entry, as [{ matId, count }].
 *   recipeCache      derived @n consumable variants live only here
 *   BUNDLED_RECIPES  the bundled truth (recipeCache is only ever a copy of it)
 *   item.materials   gear / mounts / UNIQUE_HIDEOUT carry their own list
 *   [{matId, matCount}]  single-material legacy fallback
 *
 * Note `matId`/`matCount` stay on catalog entries even where a full recipe
 * exists: they are the last fallback here, which is what a cold recipe cache
 * falls through to.
 */
function resolveItemRecipe(item) {
  if (!item) return [];
  const known = resolveRecipeById(item.id);
  if (known) return known;
  if (item.materials && item.materials.length > 0) return item.materials;
  if (item.matId) return [{ matId: item.matId, count: item.matCount }];
  return [];
}

/**
 * Recipe for a CONSUMABLES entry, including the derived `@n` enchant variants.
 *
 * A variant reuses its base recipe and appends the enchant upgrade sauce
 * (T1_FISHSAUCE_LEVEL{N} for foods, T{tier}_ESSENCE_POTION for potions). Sauces
 * carry noReturn:true (city RRR doesn't refund them) and have no market data —
 * the renderer falls back to 0 silver per sauce, which the user can override via
 * the price-edit cell to factor in opportunity cost. The derived list exists
 * nowhere else, so it is memoized into recipeCache the way the pre-fetch phase
 * used to write it.
 *
 * Deliberately NOT resolveItemRecipe: that falls back to item.materials /
 * item.matId, which would turn genuinely recipe-less ingredients (raw crops,
 * herbs, meat, dairy) into bogus single-material craft rows instead of the flip
 * rows they must stay. Returns null when nothing knows a recipe — the caller's
 * signal to render a flip.
 */
function resolveConsumableRecipe(item) {
  if (!item) return null;
  const cache = (typeof recipeCache !== "undefined" && recipeCache) ? recipeCache : null;
  if (item.baseId && !(cache && cache[item.id])) {
    const base = resolveRecipeById(item.baseId);
    if (base) {
      const sauce = item.enchantSauce;
      const derived = sauce
        ? [...base, { matId: sauce.matId, count: sauce.count, noReturn: true, isEnchantSauce: true }]
        : base;
      if (cache) cache[item.id] = derived;
      return derived;
    }
  }
  return resolveRecipeById(item.id);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { resolveItemRecipe, resolveRecipeById, resolveConsumableRecipe };
}
