/**
 * Boot step: fold the injected catalogs (gear, mounts, consumables, tools,
 * Foundry maps, waystones, Energy exchange) into the table item lists.
 *
 * Split out of js/app.js (800-line limit). Called from its DOMContentLoaded
 * handler once catalogsReady has resolved.
 */
function mergeCatalogsIntoTables() {
  // Build artifact flip items now that ARTIFACT_MAPPING is available
  buildArtifactFlipItems();
  buildResourceFlipItems();

  // Inject GEAR_RECIPES into CRAFTING_ITEMS
  if (typeof GEAR_RECIPES !== "undefined") {
    const existingCraftIds = new Set(CRAFTING_ITEMS.map((i) => i.id));
    GEAR_RECIPES.forEach((gear) => {
      // Add to CRAFTING_ITEMS if not already there
      if (!existingCraftIds.has(gear.id)) {
        CRAFTING_ITEMS.push({
          id: gear.id,
          name: gear.name,
          craftType: gear.craftType,
          materials: gear.materials, // Array of {matId, count}
          isGearRecipe: true,
        });
      }

      // If it's a Royal item, also add the Sigil to FLIPPING_ITEMS
      if (gear.group === "royal") {
        const sigilMat = gear.materials.find((m) =>
          m.matId.includes("QUESTITEM_TOKEN_ROYAL"),
        );
        if (sigilMat && !FLIPPING_ITEMS.some((f) => f.id === sigilMat.matId)) {
          const tier = getTierFromId(sigilMat.matId);
          FLIPPING_ITEMS.push({
            id: sigilMat.matId,
            name: `Royal Sigil [T${tier}]`,
          });
        }
      }
    });
  }

  // Inject MOUNT_RECIPES into CRAFTING_ITEMS
  if (typeof MOUNT_RECIPES !== "undefined") {
    const existingIds = new Set(CRAFTING_ITEMS.map((i) => i.id));
    MOUNT_RECIPES.forEach((mount) => {
      if (!existingIds.has(mount.id)) {
        CRAFTING_ITEMS.push({
          id: mount.id,
          name: mount.name,
          craftType: mount.craftType || null,
          materials: mount.materials,
        });
      }
    });
  }

  // Inject craftable CONSUMABLES into CRAFTING_ITEMS
  if (typeof CONSUMABLES !== "undefined") {
    const existingIds = new Set(CRAFTING_ITEMS.map((i) => i.id));
    CONSUMABLES.forEach((item) => {
      if (!existingIds.has(item.id) && (item.materials || recipeCache[item.id])) {
        CRAFTING_ITEMS.push({
          id: item.id,
          name: item.name,
          craftType: item.craftType || null,
          materials: item.materials || recipeCache[item.id],
          isGearRecipe: true,
        });
      }
    });
  }

  // Inject GEAR_TRACKING_TOOLS into CRAFTING_ITEMS
  if (typeof GEAR_TRACKING_TOOLS !== "undefined") {
    const existingIds = new Set(CRAFTING_ITEMS.map((i) => i.id));
    GEAR_TRACKING_TOOLS.forEach((tool) => {
      if (!existingIds.has(tool.id)) {
        CRAFTING_ITEMS.push({
          id: tool.id,
          name: tool.name,
          craftType: tool.craftType || null,
          materials: tool.materials,
          isGearRecipe: true,
        });
      }
    });
  }

  // Inject craftable Artifact Foundry maps into CRAFTING_ITEMS
  if (typeof injectCraftableMaps === "function") {
    injectCraftableMaps(CRAFTING_ITEMS);
  }

  // Dragon Sanctuary Waystones — the same Foundry, a different input (see
  // js/data-waystones.js for why they are not part of the map catalog).
  if (typeof injectWaystones === "function") {
    injectWaystones(CRAFTING_ITEMS);
  }

  // Crystal Shard / Fire Dragon Scale artifacts — a 50-fragment exchange at the
  // Energy Manipulator where you PICK the artifact, so they are deterministic
  // crafts, not Rolling-table melds (js/data-energy-exchange.js).
  if (typeof injectEnergyExchange === "function") {
    injectEnergyExchange(CRAFTING_ITEMS);
  }
}
