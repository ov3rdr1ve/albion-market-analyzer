/**
 * Energy Manipulator fragment exchange — Crystal Shards and Fire Dragon Scales.
 *
 * These two fragment families are NOT Artifact Foundry melds. You hand 50
 * fragments to the Energy Manipulator and pick the artifact you want: the
 * outcome is deterministic, so there is no random pool, no class filter, no
 * salvage-and-reroll campaign. That is the whole reason they live here as
 * ordinary crafting rows instead of in the Artifact Rolling table, which prices
 * the random 36/50-fragment meld that Runes, Souls, Relics and Avalonian Shards
 * really do go through.
 *
 * Modelled on js/data-waystones.js, which faces the same three quirks:
 *   • the fragments are never refunded          → `noReturn: true`
 *   • the exchange costs no focus                → no focus entry anywhere
 *   • a vendor is not a crafting station         → `nutritionPerCraft: 0`, so
 *     calcStationFeeSilver bills nothing. (`silverCost: 0` for the same reason:
 *     items.xml gives these recipes no silver.)
 *
 * The catalog is derived rather than listed: every non-drop-only artifact in
 * ARTIFACT_MAPPING whose family is Crystal or Dragon, crossed with T4–T8.
 * Deriving it keeps this file in step with the artifact catalog automatically —
 * a new crystal weapon needs one line in js/data-artifacts.js and nothing here.
 * tests/energy-manipulator-exchange.test.cjs pins every generated id and its
 * 50-fragment recipe against items.xml.
 */

// Family → the fragment id stem it is bought with (prefixed with the tier).
const ENERGY_EXCHANGE_FRAGMENT_STEM = {
  Crystal: "SHARD_CRYSTAL",
  Dragon: "SHARD_FIRE_DRAGON",
};
const ENERGY_EXCHANGE_TIERS = [4, 5, 6, 7, 8];
// Tier word, matching the EN-US strings in the dump. Same map as the one inside
// buildArtifactFlipItems (js/data.js), which is local to that function.
const ENERGY_EXCHANGE_TIER_WORD = {
  4: "Adept's",
  5: "Expert's",
  6: "Master's",
  7: "Grandmaster's",
  8: "Elder's",
};

// Every fragment the exchange consumes — the ids a price scan has to cover.
const ENERGY_EXCHANGE_FRAGMENT_IDS = Object.values(ENERGY_EXCHANGE_FRAGMENT_STEM).flatMap(
  (stem) => ENERGY_EXCHANGE_TIERS.map((tier) => `T${tier}_${stem}`),
);

const ENERGY_EXCHANGE_ITEMS = Object.entries(ARTIFACT_MAPPING)
  .filter(([, info]) => ENERGY_EXCHANGE_FRAGMENT_STEM[info.tier] && !info.dropOnly)
  .flatMap(([suffix, info]) =>
    ENERGY_EXCHANGE_TIERS.map((tier) => ({
      id: `T${tier}_ARTEFACT_${suffix}`,
      name: `${ENERGY_EXCHANGE_TIER_WORD[tier]} ${info.name} [T${tier}]`,
      craftType: null,
      materials: [
        {
          matId: `T${tier}_${ENERGY_EXCHANGE_FRAGMENT_STEM[info.tier]}`,
          count: 50,
        },
      ],
      silverCost: 0,
      noReturn: true,
      // A vendor exchange, not a station craft ⇒ no usage fee.
      nutritionPerCraft: 0,
      // Read by getCraftStation (js/data-craft-stations.js) so the Crafting
      // table's Station picker files these under the Energy Manipulator instead
      // of the Artifact Foundry its `_ARTEFACT` id pattern would otherwise pick.
      station: "energy",
    })),
  );

/**
 * Append every exchange row to a crafting catalog (CRAFTING_ITEMS), skipping
 * ids that are already present. Safe to call twice. Mirrors injectWaystones.
 */
function injectEnergyExchange(craftingItems) {
  if (!Array.isArray(craftingItems)) return craftingItems;
  const existing = new Set(craftingItems.map((i) => i.id));
  ENERGY_EXCHANGE_ITEMS.forEach((item) => {
    if (!existing.has(item.id)) craftingItems.push({ ...item });
  });
  return craftingItems;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    ENERGY_EXCHANGE_ITEMS,
    ENERGY_EXCHANGE_FRAGMENT_IDS,
    injectEnergyExchange,
  };
}
