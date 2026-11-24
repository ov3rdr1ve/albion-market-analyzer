// Refining recipes used by the Refining/Transports table to expand the
// "buy intermediate plank vs refine it ourselves" comparison. Built from
// RESOURCE_DEFS at load time so the canonical raw/refined naming and
// rawRatio live in one place (data.js:743).
//
// Shape: { matId: { rawId, rawRatio, secondaryMatId, secondaryMatCount,
//                   resourceType, tier, enchant } }
//
// Coverage: T4-T8 × {wood/ore/hide/fiber} × 5 enchants (0..4) = 100, PLUS
// rock's 5 PLAIN blocks (T4-T8, no enchant), PLUS the 10 plain T2/T3 entries
// (5 resources × 2 tiers) = 115 entries. Stone's refined product never enchants
// (enchanted raw rock refines into PLAIN blocks — those are alt-sourcing rows in
// TRANSPORT_ITEMS, not chain recipes), so the enchant loop caps on the refined
// side via refinedMaxEnchant(). That same cap is what keeps T2/T3 plain-only
// (resources enchant from T4 up) and the old fictional ids
// (T*_STONEBLOCK_LEVELn, pristine .4 rock) out of the map.
//
// T2/T3 are in because they refine in game and the app prices them: items.xml
// gives T2_CLOTH = 1x T2_FIBER and T3_CLOTH = 2x T3_FIBER + 1x T2_CLOTH, and
// js/focus-costs.js carries both. They were excluded while the gear catalogue
// stopped at T4; now that a T3 bag has a Crafting Planner row, its cloth and
// leather need the same refine-vs-buy comparison every other tier gets.
// T2 is the floor — no T1 refined product exists to be its secondary, so it
// refines from raw alone (`hasSecondary`, mirroring TRANSPORT_ITEMS in data.js).
//
// Enchant rule (matches data.js:810 and items.xml T4 refining): T4.X's
// secondary is PLAIN T3, not T3.X, because the in-game recipe for T4
// enchanted planks consumes an unenchanted T3 plank. T5+ enchanted
// recipes inherit the parent's enchant level on the secondary.
//
// Faction "hearts" (city resource tokens) CAN substitute for ONE unit of the
// biome RAW resource in a T4-T8 refine, enchant .0-.3 only (no heart recipe
// exists at .4/pristine). They do NOT replace the refined secondary. See
// HEART_BY_RESOURCE below and the heart-substitution path in
// refining-chain-pricing.js (chooseRawWithHeart) / render-transport.js
// (resolveRefineRawHeart, which gates out .4).

const REFINING_RECIPES = {};
const MIN_CHAIN_TIER = 2;

// Each faction heart stands in for ONE unit of its OWN resource type's biome RAW
// in a T4-T8 refine (one substitution per refine), for enchant .0-.3 only — no
// heart recipe exists for .4/pristine refines. Keyed by RESOURCE_DEFS.type.
// Caerleon's Shadowheart (T1_FACTION_CAERLEON_TOKEN_1) maps to no single resource
// type, so it is omitted. The heart is NOT returned by RRR (it is fully consumed,
// like a crafting artifact) — the pricing layer keeps its cost outside the
// (1-rrr) discount.
const HEART_BY_RESOURCE = {
  wood:  "T1_FACTION_FOREST_TOKEN_1",    // Treeheart      (Lymhurst)
  ore:   "T1_FACTION_MOUNTAIN_TOKEN_1",  // Mountainheart  (Fort Sterling)
  hide:  "T1_FACTION_STEPPE_TOKEN_1",    // Beastheart     (Bridgewatch)
  fiber: "T1_FACTION_SWAMP_TOKEN_1",     // Vineheart      (Thetford)
  rock:  "T1_FACTION_HIGHLAND_TOKEN_1",  // Rockheart      (Martlock)
};

(function buildRefiningRecipes() {
  RESOURCE_DEFS.forEach(({ type, raw, refined, tiers }) => {
    tiers.forEach(([tier, , , rawRatio]) => {
      if (tier < MIN_CHAIN_TIER) return;
      // T2 refines from its raw alone — there is no T1 refined product to be its
      // secondary. Same rule TRANSPORT_ITEMS applies (js/data.js).
      const hasSecondary = tier >= 3;
      // Cap the enchant loop on the REFINED side: non-rock refines .0–.4, but
      // stoneblock never enchants (refinedMaxEnchant("rock") === 0), so rock
      // gets only its plain recipe here — no fictional T*_STONEBLOCK_LEVELn or
      // pristine-rock (.4) ids. The enchanted-rock→plain-block recipe lives in
      // TRANSPORT_ITEMS as an alt-sourcing row, keyed off the SAME plain block.
      const maxRefinedEnch = (typeof refinedMaxEnchant === "function")
        ? refinedMaxEnchant(type, tier) : 4;
      for (let ench = 0; ench <= maxRefinedEnch; ench++) {
        const suffix = ench ? `_LEVEL${ench}@${ench}` : "";
        const prevTier = tier - 1;
        // T4.X consumes plain T3; T5+.X inherits the enchant on the secondary.
        const secEnchSuffix = (ench && prevTier >= 4) ? suffix : "";
        REFINING_RECIPES[`T${tier}_${refined}${suffix}`] = {
          rawId: `T${tier}_${raw}${suffix}`,
          rawRatio,
          secondaryMatId: hasSecondary ? `T${prevTier}_${refined}${secEnchSuffix}` : null,
          secondaryMatCount: hasSecondary ? 1 : 0,
          resourceType: type,
          tier,
          enchant: ench,
        };
      }
    });
  });
})();
