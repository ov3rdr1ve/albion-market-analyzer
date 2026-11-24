/**
 * Enchanting Data & Helpers
 * Handles enchantment transitions (.0→.1, .1→.2, .2→.3) for equipment.
 *
 * Every equipment piece T4-T8 enchants: weapons, off-hands, armor, helmets,
 * boots, capes (incl. faction/artifact capes), bags, gathering gear and tools.
 * Mounts, consumables and artifact materials do not (food/potions enchant with
 * fish sauces / arcane extracts, handled by the Consumables table).
 * .3 → .4 does not exist — Pristine gear can only be crafted.
 */

const ENCHANT_TRANSITIONS = [
  { from: 0, to: 1, matType: "RUNE" },
  { from: 1, to: 2, matType: "SOUL" },
  { from: 2, to: 3, matType: "RELIC" },
];

// Rune/soul/relic count per enchant step, fixed by equipment slot (not by recipe).
const ENCHANT_MAT_COUNT_BY_SLOT = {
  twohand: 384,
  onehand: 288,
  armor: 192,
  small: 96,
};

/**
 * Equipment slot of an item id, or null when the item is not enchantable
 * equipment (artifact materials, mounts, consumables, resources…).
 */
function getEquipmentSlot(id) {
  const base = id.replace(/^T\d_/, "");
  if (base.startsWith("ARTEFACT_")) return null; // artifact material, not a wearable
  if (base.startsWith("2H_")) return "twohand";
  if (base.startsWith("MAIN_")) return "onehand";
  if (base.startsWith("ARMOR_") || base.startsWith("BAG") || base.startsWith("BACKPACK"))
    return "armor";
  if (
    base.startsWith("HEAD_") ||
    base.startsWith("SHOES_") ||
    base.startsWith("CAPE") ||
    base.startsWith("OFF_")
  )
    return "small";
  return null;
}

/**
 * Runes/souls/relics consumed by one enchant step of this item.
 */
function getEnchantMatCount(item) {
  const slot = getEquipmentSlot(item.id);
  return slot ? ENCHANT_MAT_COUNT_BY_SLOT[slot] : 0;
}

/**
 * Returns enchanted item ID: baseId@level (strips existing @suffix first).
 */
function getEnchantedItemId(baseId, level) {
  const stripped = baseId.replace(/@\d+$/, "");
  return level > 0 ? `${stripped}@${level}` : stripped;
}

/**
 * Returns enchanting material ID, e.g. "T4_RUNE", "T6_SOUL".
 */
function getEnchantMatId(tier, matType) {
  return `T${tier}_${matType}`;
}

/**
 * Filters CRAFTING_ITEMS to base equipment: enchantable slot, no @ in ID, T4-T8.
 */
function getEnchantableItems() {
  return CRAFTING_ITEMS.filter((item) => {
    if (!item.isGearRecipe) return false;
    if (item.id.includes("@")) return false;
    if (!getEquipmentSlot(item.id)) return false;
    const tier = getTierFromId(item.id);
    return tier >= 4 && tier <= 8;
  });
}

/**
 * Generates all enchanted item IDs (item@1, item@2, item@3) plus base items
 * and enchanting material IDs for API fetching.
 */
function getAllEnchantItemIds() {
  const ids = new Set();
  const items = getEnchantableItems();
  for (const item of items) {
    ids.add(item.id); // base .0
    for (let level = 1; level <= 3; level++) {
      ids.add(getEnchantedItemId(item.id, level));
    }
  }
  // Add rune/soul/relic IDs for T4-T8
  for (let t = 4; t <= 8; t++) {
    ids.add(`T${t}_RUNE`);
    ids.add(`T${t}_SOUL`);
    ids.add(`T${t}_RELIC`);
  }
  return Array.from(ids);
}
