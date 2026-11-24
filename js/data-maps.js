/**
 * Craftable maps — Artifact Foundry (souls → dungeon / hellgate entrances).
 *
 * Eight maps are crafted from souls at the Artifact Foundry. They are unlike
 * every other craft in the app on three counts:
 *
 *   1. FLAT SILVER COST. The recipe itself charges silver
 *      (<craftingrequirements silver="…">) on top of the materials. Carried as
 *      `silverCost`, already converted to in-game silver (items.xml × 1.156).
 *   2. NO RESOURCE RETURN. The craft window reports "Resource Return Rate: 0%"
 *      — souls are never refunded → `noReturn: true`.
 *   3. NO FOCUS. No craftingfocus attribute, so the focus toggle and the
 *      Silver/Focus column stay inert (getFocusCost returns 0).
 *
 * Verified in-game 2026-07-20 on the Corrupted Dungeon Map (Stalker/Slayer):
 * 54 maps → 187,272 silver = 54 × 3,468 = 54 × (3,000 × 1.156), 1 × Master's
 * Soul each, RRR 0%.
 *
 * SOURCE NOTE: the repo's items.xml used to predate the Corrupted Dungeon
 * rework and carried neither corrupted map id, so this catalog was their only
 * source. The 2026-08-31 dump refresh closed that gap — all eight ids are now
 * in items.xml and every soul tier, soul count, silver fee and itemvalue below
 * was re-checked against it and matched exactly.
 *
 * Station usage fee: nutrition is normally derived from the non-artifact
 * material count, which is meaningless for a one-artifact recipe, so each map
 * pins `nutritionPerCraft` to its real item value × 0.1125 (same escape hatch as
 * UNIQUE_HIDEOUT). The fee still scales with the #station-fee input.
 *
 * Smuggler's Dens have an Artifact Foundry too, but they are not in CRAFT_CITIES
 * (no crafting stations of any other kind), so map crafts are priced from the
 * royal cities + Caerleon like every other row.
 */

// items.xml silver → in-game silver.
const MAP_SILVER_MULT = 1.156;
// Station-fee nutrition per unit of item value (see calcStationFeeSilver).
const MAP_NUTRITION_PER_ITEMVALUE = 0.1125;

// [id, name, soulTier, soulCount, xmlSilver, itemValue]
const CRAFTABLE_MAP_SPECS = [
  // ── Corrupted Dungeons (solo, souls of the matching tier) ────────────────
  ["T5_CORRUPTED_NONLETHAL_MAP", "Corrupted Dungeon Map (Hunter)", 5, 1, 1000, 200],
  ["T6_CORRUPTED_LETHAL_MAP", "Corrupted Dungeon Map (Stalker/Slayer)", 6, 1, 3000, 600],
  // ── Hellgates, non-lethal (all T5 souls) ─────────────────────────────────
  ["T5_HELLGATE_2V2_NON_LETHAL_1_MAP", "Hellgate Map 2v2 (Non-Lethal)", 5, 2, 3000, 600],
  ["T5_HELLGATE_5V5_NON_LETHAL_1_MAP", "Hellgate Map 5v5 (Non-Lethal)", 5, 5, 20000, 4000],
  ["T5_HELLGATE_10V10_NON_LETHAL_1_MAP", "Hellgate Map 10v10 (Non-Lethal)", 5, 10, 100000, 20000],
  // ── Hellgates, lethal (soul tier tracks the map tier) ────────────────────
  ["T6_HELLGATE_2V2_LETHAL_1_MAP", "Hellgate Map 2v2 (Lethal)", 6, 2, 15000, 3000],
  ["T7_HELLGATE_5V5_LETHAL_1_MAP", "Hellgate Map 5v5 (Lethal)", 7, 5, 100000, 20000],
  // itemvalue 10,000 despite the 500k recipe silver — that is the live value
  // (salvagevalueoverride carries the 100,000 salvage figure separately).
  ["T8_HELLGATE_10V10_LETHAL_1_MAP", "Hellgate Map 10v10 (Lethal)", 8, 10, 500000, 10000],
];

const CRAFTABLE_MAPS = CRAFTABLE_MAP_SPECS.map(
  ([id, name, soulTier, soulCount, xmlSilver, itemValue]) => ({
    id,
    name,
    craftType: null,
    materials: [{ matId: `T${soulTier}_SOUL`, count: soulCount }],
    silverCost: Math.round(xmlSilver * MAP_SILVER_MULT),
    noReturn: true,
    nutritionPerCraft: itemValue * MAP_NUTRITION_PER_ITEMVALUE,
  }),
);

/**
 * Append every map to a crafting catalog (CRAFTING_ITEMS), skipping ids that
 * are already present. Safe to call twice.
 */
function injectCraftableMaps(craftingItems) {
  if (!Array.isArray(craftingItems)) return craftingItems;
  const existing = new Set(craftingItems.map((i) => i.id));
  CRAFTABLE_MAPS.forEach((map) => {
    if (!existing.has(map.id)) craftingItems.push({ ...map });
  });
  return craftingItems;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { CRAFTABLE_MAPS, injectCraftableMaps };
}
