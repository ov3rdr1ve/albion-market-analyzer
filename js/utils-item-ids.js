// Split from js/utils.js: the API id universe (getAllRequiredItemIds) and the
// per-table id getters. Loads right after utils.js; nothing here runs at load time.

// Combine all required API IDs for one batched call.
// Recipe ingredients resolve from BUNDLED_RECIPES, so this is correct whether
// or not a recipe pre-fetch has run (see js/recipe-resolver.js).
function getAllRequiredItemIds() {
  const ids = new Set();
  CRAFTING_ITEMS.forEach((i) => {
    ids.add(i.id);
    if (i.matId) ids.add(i.matId);
    // Include recipe ingredients (e.g. T5_CLOTH in furniture recipes)
    const recipe = typeof resolveRecipeById === "function" ? resolveRecipeById(i.id) : recipeCache[i.id];
    if (recipe) recipe.forEach((m) => ids.add(m.matId));
    // Handle gear recipes with materials array
    if (i.materials) i.materials.forEach((m) => ids.add(m.matId));
    // Add @1-@4 variants for T4-T8 gear items
    if (i.isGearRecipe && !i.id.includes("@")) {
      const tier = getTierFromId(i.id);
      if (tier >= 4 && tier <= 8) {
        for (let enchLevel = 1; enchLevel <= 4; enchLevel++) {
          const enchId = i.id + "@" + enchLevel;
          ids.add(enchId);
          const recipeEnch = recipeCache[enchId];
          if (recipeEnch) recipeEnch.forEach((m) => ids.add(m.matId));
          const baseMats = i.materials || (i.matId ? [{ matId: i.matId }] : []);
          baseMats.forEach(m => {
            if (/^T\d+_(LEATHER|CLOTH|METALBAR|PLANKS|STONEBLOCK)$/.test(m.matId)) {
              ids.add(m.matId + "_LEVEL" + enchLevel + "@" + enchLevel);
            } else if (/^T\d+_/.test(m.matId) &&
                       !/ARTEFACT|_BP|TOKEN|_FACTION_|ALCHEMY_RARE|SKILLBOOK/.test(m.matId)) {
              // Non-resource enchantable combine input (e.g. the base cape
              // T*_CAPE of a faction cape → T*_CAPE@n). Mirrors the render
              // mat-enchant rule so the scan fetches the price the variant needs.
              ids.add(m.matId + "@" + enchLevel);
            }
          });
        }
      }
    }
  });
  FLIPPING_ITEMS.forEach((i) => ids.add(i.id));
  // Tradeable vanity-skin unlock tokens (Skins Trading table).
  if (typeof SKIN_TRADE_ITEMS !== "undefined") SKIN_TRADE_ITEMS.forEach((i) => ids.add(i.id));
  // Construction materials + the laborer contracts and furniture a fitted
  // building buys (Building Costs table).
  if (typeof getBuildingsItemIds === "function") getBuildingsItemIds().forEach((id) => ids.add(id));
  // ARTIFACT_FLIP_ITEMS is populated at DOMContentLoaded; also included via ARTIFACT_MAPPING loop below
  ARTIFACT_FLIP_ITEMS.forEach((i) => ids.add(i.id));
  TRANSPORT_ITEMS.forEach((i) => {
    ids.add(i.rawId);
    ids.add(i.refinedId);
    if (i.secondaryMatId) ids.add(i.secondaryMatId);
    // Refining-chain pre-fetch: pull every intermediate-tier raw + refined id
    // the chain might recurse into. Without this, chain leaves at lower tiers
    // would have no market data and chain pricing would silently return 0.
    if (typeof getRefiningChainIds === "function") {
      getRefiningChainIds(i.refinedId).forEach((id) => ids.add(id));
    }
    // Transmute-substitute pre-fetch: the lower tier/enchant nodes the row's raw
    // can be transmuted up FROM. Without their prices the substitution search
    // sees zeros and silently never fires.
    if (typeof getRawTransmuteIds === "function") {
      getRawTransmuteIds(i.rawId).forEach((id) => ids.add(id));
    }
  });
  // Include base CONSUMABLES + their @1/@2/@3 enchant variants (T4+) so the
  // market data fetch covers every row the consumables table will render.
  const consumablesWithVariants = (typeof generateConsumableEnchantVariants === "function")
    ? generateConsumableEnchantVariants(CONSUMABLES)
    : CONSUMABLES;
  const collectChainInputs = (chainRecipe) => {
    if (!chainRecipe) return;
    if (Array.isArray(chainRecipe.options)) {
      chainRecipe.options.forEach((opt) => opt.inputs?.forEach((m) => ids.add(m.matId)));
    }
    chainRecipe.inputs?.forEach((m) => ids.add(m.matId));
  };
  consumablesWithVariants.forEach((i) => {
    ids.add(i.id);
    // Include all recipe ingredients (bundled, so no pre-fetch needed)
    const recipe = typeof resolveRecipeById === "function" ? resolveRecipeById(i.id) : recipeCache[i.id];
    if (recipe) recipe.forEach((m) => ids.add(m.matId));
    // CHAIN_RECIPES inputs (raw meat → grown animal, fish chops → fish).
    // Mirrors getConsumableItemIds in utils.js — keep these two in sync.
    if (typeof CHAIN_RECIPES !== "undefined") collectChainInputs(CHAIN_RECIPES[i.id]);
    // Synthetic rows' sellAs (e.g., T1_FISHCHOPS__T3_*).sellAs === "T1_FISHCHOPS".
    if (i.sellAs) ids.add(i.sellAs);
  });

  // Mounts, breeding, farming
  if (typeof MOUNT_RECIPES !== "undefined") {
    MOUNT_RECIPES.forEach((m) => {
      ids.add(m.id);
      m.materials.forEach((mat) => ids.add(mat.matId));
    });
  }
  if (typeof BREEDING_ITEMS !== "undefined") {
    BREEDING_ITEMS.forEach((b) => {
      ids.add(b.babyId);
      ids.add(b.grownId);
    });
  }
  // Breeding feed (crops, herbs, meat, chocolate) — findCheapestFeed prices these.
  if (typeof getBreedingFeedIds === "function") {
    getBreedingFeedIds().forEach((id) => ids.add(id));
  }
  // FARMING_PRODUCTION rows are { id: seed-or-feed, outputId: crop/herb/byproduct }
  // plus, on a pasture row, the grown animal that eats the feed.
  if (typeof FARMING_PRODUCTION !== "undefined") {
    FARMING_PRODUCTION.forEach((f) => {
      ids.add(f.id);
      ids.add(f.outputId);
      if (f.animalId) ids.add(f.animalId);
      if (f.wormsPerPlot > 0) ids.add(typeof FARM_WORM_ID === "string" ? FARM_WORM_ID : "T1_WORM");
    });
  }

  // Inject Artifacts and Fragments (T4-T8)
  for (let t = 4; t <= 8; t++) {
    ids.add(`T${t}_RUNE`);
    ids.add(`T${t}_SOUL`);
    ids.add(`T${t}_RELIC`);
    ids.add(`T${t}_SHARD_AVALONIAN`);
    // Energy Manipulator exchange fragments (js/data-energy-exchange.js).
    ids.add(`T${t}_SHARD_CRYSTAL`);
    ids.add(`T${t}_SHARD_FIRE_DRAGON`);

    Object.keys(ARTIFACT_MAPPING).forEach((suffix) => {
      ids.add(`T${t}_ARTEFACT_${suffix}`);
    });
  }

  // Crystallized tokens and the expiring Crystal twins — both priced against the
  // artifact they can replace in a gear craft (js/gear-token-substitute.js).
  if (typeof getArtifactTokenIds === "function") getArtifactTokenIds(ids);
  if (typeof getArtifactDecayIds === "function") getArtifactDecayIds(ids);

  // Laborers (trophy journals + trophies); guard so the scan-all keeps working
  // when data-laborers.js is absent (e.g. in legacy test sandboxes).
  if (typeof getLaborersItemIds === "function") {
    getLaborersItemIds().forEach((id) => ids.add(id));
  }

  // Enchanting / Transmute — needed so the joined-summary "Best of Each
  // Category" table can include these rows after a single "Scan Market Now".
  if (typeof getAllEnchantItemIds === "function") {
    getAllEnchantItemIds().forEach((id) => ids.add(id));
  }
  if (typeof getTransmuteItemIds === "function") {
    getTransmuteItemIds().forEach((id) => ids.add(id));
  }

  // Gathering — raw resource sell prices, so "Scan Market Now" populates the
  // Gathering table in one pass.
  if (typeof getGatheringItemIds === "function") {
    getGatheringItemIds().forEach((id) => ids.add(id));
  }

  // Journals — empty/full prices for the Best Journal column + Journal Filling
  // table (the Laborers table also fetches these; deduped by the Set).
  if (typeof getJournalItemIds === "function") {
    getJournalItemIds().forEach((id) => ids.add(id));
  }

  // Refined mix a crafting laborer returns — the Crafting table's "Profit +
  // Laborer Journal" column prices it (js/laborer-journal-value.js).
  if (typeof getLaborerJournalPayoutIds === "function") {
    getLaborerJournalPayoutIds().forEach((id) => ids.add(id));
  }

  // Faction Spending, full flipping universe (luxury + FLIP_EXTRA_IDS), planner
  // @1..@4 variants — see js/scan-extra-ids.js.
  if (typeof getScanExtraItemIds === "function") {
    getScanExtraItemIds().forEach((id) => ids.add(id));
  }

  return Array.from(ids);
}


// --- Per-table ID getters ---

// Fragments and artifacts the Artifact Rolling table prices: the four rolled
// families, plus the Energy Manipulator exchange section's Crystal Shards / Fire
// Dragon Scales and the artifacts they buy. Crystal and Dragon are not roll
// types, so their ids come from the exchange catalog (js/rolling-exchange.js
// rollingExchangeItemIds), never from ROLL_TYPES.
function getRollingItemIds() {
  const ids = new Set();
  const rollFamilies = new Set(ROLL_TYPES);
  const suffixes = Object.entries(ARTIFACT_MAPPING)
    .filter(([, info]) => rollFamilies.has(info.tier))
    .map(([suffix]) => suffix);
  for (let t = 4; t <= 8; t++) {
    ids.add(`T${t}_RUNE`);
    ids.add(`T${t}_SOUL`);
    ids.add(`T${t}_RELIC`);
    ids.add(`T${t}_SHARD_AVALONIAN`);
    suffixes.forEach((suffix) => {
      ids.add(`T${t}_ARTEFACT_${suffix}`);
    });
  }
  if (typeof rollingExchangeItemIds === "function") {
    const exchange = rollingExchangeItemIds();
    exchange.fragments.forEach((id) => ids.add(id));
    exchange.artifacts.forEach((id) => ids.add(id));
  }
  // Crystallized tokens: an artifact row shows the token when it is the cheaper
  // way to fill that artifact's craft slot (render-rolling.js tokenSub).
  if (typeof getArtifactTokenIds === "function") getArtifactTokenIds(ids);
  return Array.from(ids);
}

function getCraftingItemIds() {
  const ids = new Set();
  CRAFTING_ITEMS.forEach((i) => {
    ids.add(i.id);
    if (i.matId) ids.add(i.matId);
    const recipe = typeof resolveRecipeById === "function" ? resolveRecipeById(i.id) : recipeCache[i.id];
    if (recipe) recipe.forEach((m) => ids.add(m.matId));
    if (i.materials) i.materials.forEach((m) => ids.add(m.matId));
    // Add @1-@4 variants for T4-T8 gear items
    if (i.isGearRecipe && !i.id.includes("@")) {
      const tier = getTierFromId(i.id);
      if (tier >= 4 && tier <= 8) {
        for (let enchLevel = 1; enchLevel <= 4; enchLevel++) {
          const enchId = i.id + "@" + enchLevel;
          ids.add(enchId);
          const recipeEnch = recipeCache[enchId];
          if (recipeEnch) recipeEnch.forEach((m) => ids.add(m.matId));
          const baseMats = i.materials || (i.matId ? [{ matId: i.matId }] : []);
          baseMats.forEach(m => {
            if (/^T\d+_(LEATHER|CLOTH|METALBAR|PLANKS|STONEBLOCK)$/.test(m.matId)) {
              ids.add(m.matId + "_LEVEL" + enchLevel + "@" + enchLevel);
            } else if (/^T\d+_/.test(m.matId) &&
                       !/ARTEFACT|_BP|TOKEN|_FACTION_|ALCHEMY_RARE|SKILLBOOK/.test(m.matId)) {
              // Non-resource enchantable combine input (e.g. the base cape
              // T*_CAPE of a faction cape → T*_CAPE@n). Mirrors the render
              // mat-enchant rule so the scan fetches the price the variant needs.
              ids.add(m.matId + "@" + enchLevel);
            }
          });
        }
      }
    }
  });
  // Refined output a crafting laborer returns for the journal this craft fills —
  // priced by the "Profit + Laborer Journal" column (js/laborer-journal-value.js).
  // A craft's own recipe only covers ITS material, but the laborer pays out the
  // whole profession mix (e.g. a Blacksmith also returns planks + cloth), so
  // without these the column silently undervalues every row.
  if (typeof getLaborerJournalPayoutIds === "function") {
    getLaborerJournalPayoutIds().forEach((id) => ids.add(id));
  }
  return Array.from(ids);
}

// Comprehensive flip universe: every tradeable item the app knows about, not
// just the hand-curated FLIPPING_ITEMS sample. Unions all gear (weapons,
// armor, capes, bags, tools, gatherer gear, crystal weapons), every mount,
// every consumable, breeding/farming outputs, and the dynamic artifact +
// resource flip lists. Deduped by id; the first source to claim an id wins its
// display name, so the curated FLIPPING_ITEMS names take precedence over the
// catalog defaults. Used by both getFlippingItemIds (scan) and
// renderFlippingTable (display) so the two never drift.
function getAllFlippingItems() {
  const seen = new Set();
  const out = [];
  const push = (id, name) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({
      id,
      name: name || (typeof getItemDisplayName === "function" ? getItemDisplayName(id) : id) || id,
    });
  };
  // Curated misc first (runes, souls, journals, furniture, dungeon maps, fish,
  // tokens, crystallized spirits, sample gear/mounts) so their names win.
  FLIPPING_ITEMS.forEach((i) => push(i.id, i.name));
  ARTIFACT_FLIP_ITEMS.forEach((i) => push(i.id, i.name));
  RESOURCE_FLIP_ITEMS.forEach((i) => push(i.id, i.name));
  // Luxury (trade) goods — fixed-NPC-price flips (see js/data-luxury.js).
  if (typeof LUXURY_FLIP_ITEMS !== "undefined") LUXURY_FLIP_ITEMS.forEach((i) => push(i.id, i.name));
  // All craftable/tradeable gear (already tier>=4 filtered in gear.js):
  // includes capes, bags, tools, gatherer gear, all weapons + armor.
  if (typeof GEAR_RECIPES !== "undefined") GEAR_RECIPES.forEach((g) => push(g.id, g.name));
  // Every mount (riding, transport, battlemount, saddled FW mounts).
  if (typeof MOUNT_RECIPES !== "undefined") MOUNT_RECIPES.forEach((m) => push(m.id, m.name));
  // Breeding outputs (babies + grown farm animals) and farming outputs
  // (seeds + crops) — all tradeable on the market.
  if (typeof BREEDING_ITEMS !== "undefined") {
    BREEDING_ITEMS.forEach((b) => { push(b.babyId); push(b.grownId); });
  }
  if (typeof FARMING_PRODUCTION !== "undefined") {
    // `name` describes the plant/animal, not the seed, so let both ids resolve
    // their own display names.
    FARMING_PRODUCTION.forEach((f) => { push(f.id); push(f.outputId); });
  }
  // All consumables (food + potions).
  if (typeof CONSUMABLES !== "undefined") CONSUMABLES.forEach((c) => push(c.id, c.name));
  // Tradeable families no production catalog owns: laborer trophies, house
  // furniture, tomes and the saltwater catch (see js/data-flip-extras.js).
  if (typeof FLIP_EXTRA_IDS !== "undefined") FLIP_EXTRA_IDS.forEach((id) => push(id));
  return out;
}

function getFlippingItemIds() {
  return getAllFlippingItems().map((i) => i.id);
}

function getTransportItemIds() {
  const ids = new Set();
  TRANSPORT_ITEMS.forEach((i) => {
    ids.add(i.rawId);
    ids.add(i.refinedId);
    if (i.secondaryMatId) ids.add(i.secondaryMatId);
    if (typeof getRefiningChainIds === "function") {
      getRefiningChainIds(i.refinedId).forEach((id) => ids.add(id));
    }
    // Lower nodes the raw can be transmuted up from (see getAllRequiredItemIds).
    if (typeof getRawTransmuteIds === "function") {
      getRawTransmuteIds(i.rawId).forEach((id) => ids.add(id));
    }
  });
  return Array.from(ids);
}

function getConsumableItemIds() {
  // Include base CONSUMABLES + their @1/@2/@3 enchant variants. The global
  // getAllRequiredItemIds does the same — both must agree, or the per-table
  // "Scan Consumables" button would miss variant prices and the collapsible
  // expand-toggle would reveal nothing.
  const items = (typeof generateConsumableEnchantVariants === "function")
    ? generateConsumableEnchantVariants(CONSUMABLES)
    : CONSUMABLES;
  const ids = new Set();
  const collectChainInputs = (chainRecipe) => {
    if (!chainRecipe) return;
    if (Array.isArray(chainRecipe.options)) {
      chainRecipe.options.forEach((opt) => opt.inputs?.forEach((m) => ids.add(m.matId)));
    }
    chainRecipe.inputs?.forEach((m) => ids.add(m.matId));
  };
  items.forEach((i) => {
    ids.add(i.id);
    // BUNDLED_RECIPES inputs (e.g., fish-sauce → fish chops + seaweed).
    const recipe = typeof resolveRecipeById === "function" ? resolveRecipeById(i.id) : recipeCache[i.id];
    if (recipe) recipe.forEach((m) => ids.add(m.matId));
    // CHAIN_RECIPES inputs (e.g., raw meat → grown animal; fish chops →
    // fish source via single-option or multi-option chain). Without this,
    // synthetic fishchops rows and the aggregate auto-cheapest row never
    // fetch their underlying fish prices → all show "no data".
    if (typeof CHAIN_RECIPES !== "undefined") collectChainInputs(CHAIN_RECIPES[i.id]);
    // Sell-side market lookups for synthetic rows route through `sellAs`,
    // so make sure the real output id (e.g., T1_FISHCHOPS) is fetched too.
    if (i.sellAs) ids.add(i.sellAs);
  });
  return Array.from(ids);
}

function getMountsItemIds() {
  const ids = new Set();
  if (typeof MOUNT_RECIPES !== "undefined") {
    MOUNT_RECIPES.forEach((m) => {
      ids.add(m.id);
      m.materials.forEach((mat) => ids.add(mat.matId));
    });
  }
  if (typeof BREEDING_ITEMS !== "undefined") {
    BREEDING_ITEMS.forEach((b) => {
      ids.add(b.babyId);
      ids.add(b.grownId);
    });
  }
  // Breeding rows price their feed with findCheapestFeed (render-mounts.js), so a
  // mounts-only scan must fetch the feed too — otherwise every nurture/grow cost
  // reads "no data" while the mount prices come back fine.
  if (typeof getBreedingFeedIds === "function") {
    getBreedingFeedIds().forEach((id) => ids.add(id));
  }
  return Array.from(ids);
}

// FARMING_PRODUCTION rows are { id, outputId }: `id` is the seed (crops/herbs) or
// the FEED crop (byproducts), `outputId` is the harvested crop/herb/egg/milk, and
// `animalId` is the grown animal a pasture row feeds. There is no seedId/cropId —
// reading those emitted `undefined` ids and the Farming scan fetched nothing.
function getFarmingItemIds() {
  const ids = new Set();
  if (typeof FARMING_PRODUCTION !== "undefined") {
    FARMING_PRODUCTION.forEach((f) => {
      ids.add(f.id);
      ids.add(f.outputId);
      if (f.animalId) ids.add(f.animalId);
      // Every harvested slot has a 10% chance of an Earthworm, and the row
      // sells it — unscanned, that leg would price at 0 forever.
      if (f.wormsPerPlot > 0) ids.add(typeof FARM_WORM_ID === "string" ? FARM_WORM_ID : "T1_WORM");
    });
  }
  return Array.from(ids);
}
