// Split from js/utils.js: focus cost per craft and station fee helpers.
// Loads right after utils.js; nothing here runs at load time.

// Focus cost per craft/refine by tier — generic fallback (30 focus * 2^(tier-4))
function getFocusCostPerTier(tier) {
  // T2=7, T3=15, T4=30, T5=60, T6=120, T7=240, T8=480
  return Math.round(30 * Math.pow(2, tier - 4));
}

// Focus Cost Efficiency lives in js/focus-spec.js now: the multiplier is derived
// per ITEM from the Destiny Board nodes that cover it (achievements.xml data) and
// the levels the user set in that table's ⚙ panel — untouched, a mastery reads
// 100 and a specialization 0 (js/focus-spec.js defaultSpecLevel).
//
// It replaced three flat per-category constants (refining ×0.0625, crafting
// ×0.0221, ingredient ×0.125). The refining number was verified in-game and the
// data reproduces it exactly (40,000 FCE → 6.25%), but "crafting" was applying
// the 55,000-FCE cooking/alchemy figure to GEAR, which really tops out around
// 44,500 FCE (~4.6%) — gear focus was understated ~2×. Likewise tools/furniture
// were special-cased by regex; the node data now decides (tools DO have a spec,
// furniture and mounts genuinely have none).
//
// Called defensively so the focus math still works if focus-spec.js is absent
// (older test sandboxes): no data → multiplier 1 → base focus cost.
function _itemFocusMultiplier(itemId) {
  return typeof focusSpecMultiplier === "function" ? focusSpecMultiplier(itemId) : 1;
}

// Resolve the base (0-spec) focus cost from items.xml data, with a fallback for
// enchant suffixes. 0 when not focus-usable.
//
// NOTE: zero-focus COMBINE crafts are NOT here on purpose — items.xml gives them
// craftingfocus="0" because the focus was already paid making the consumed base
// item, so the combine itself is free:
//   • artifact / faction capes (T*_CAPEITEM_*) = base cape + crest + tokens.
//   • royal armor (T*_{HEAD,ARMOR,SHOES}_{CLOTH,LEATHER,PLATE}_ROYAL) = base SETn
//     armor + Royal Sigil tokens.
// Both bases are consumed with maxreturnamount=0/preservequality. The old
// "CAPEITEM → base CAPE" and "ROYAL → SET1" fallbacks double-counted that focus
// (e.g. T4 Avalonian Cape 429→9, T8 Royal armor 4021→89) and printed a bogus
// silver/focus, so they were removed → these crafts correctly return 0 focus.
function getBaseFocusCost(itemId) {
  if (typeof FOCUS_COSTS === "undefined" || !itemId) return 0;
  const cost = FOCUS_COSTS[itemId];
  if (cost) return cost;
  // Try without enchantment suffix as fallback
  const baseId = itemId.replace(/@\d+$/, "");
  if (baseId !== itemId && FOCUS_COSTS[baseId]) return FOCUS_COSTS[baseId];
  return 0;
}

// Item-specific focus cost from items.xml data, reduced by the specialization
// levels in force for the current table (js/focus-spec.js). Returns 0 when the
// item can't use focus.
//
// `category` is vestigial — the reduction now comes from the item's Destiny
// Board nodes, not from a caller-declared category — but it's still accepted so
// the ~40 existing call sites read the same.
function getFocusCost(itemId, tier, category) {
  const base = getBaseFocusCost(itemId);
  if (!base) return 0;
  const mult = _itemFocusMultiplier(itemId);
  if (mult === 1) return base;
  // The game charges FRACTIONAL focus per unit — a T6 Avalonian Stew reads
  // 80.3/each in-game. Rounding the reduced cost to an integer here used to
  // cascade into every consumer that divides the 10,000-focus bar by it:
  // T4 Avalonian Goat Stew is 58 × 0.0221 = 1.28 focus/unit, and round()→1 made
  // floor(10000 / 1) = 10,000 crafts instead of 7,803 — Profit/10k Focus,
  // Silver/Focus and Mats to Buy all overstated 28%, and unboundedly so as the
  // reduced cost approaches 0. Round for DISPLAY only (formatFocusCost), never
  // in the arithmetic. The small floor keeps a focus-craftable item from
  // reading 0 (and dividing to Infinity).
  return Math.max(0.01, base * mult);
}

// Focus cost for a CRAFTING-table row. Identical to getFocusCost now — which
// items have a focus specialization is data, not a regex:
//   • Furniture (tables/beds/chests/repair kits) has NO node → full base cost.
//     Verified in-game: T7 Grandmaster's Table = 5,627 focus EACH.
//   • Gathering TOOLS (`_2H_TOOL_`) DO have one (CRAFT_TOOL_*, 40,000 FCE at max
//     → 6.25%); the old blanket "tools are exempt" rule overcharged them, and the
//     ×0.0221 it was written to avoid was the wrong (cooking) multiplier anyway.
//   • Gathering GEAR (T*_*_GATHERER_*) shares those same tool nodes.
// Kept as a named wrapper so the crafting renderers keep reading intent-first.
function getCraftFocusCost(itemId, tier) {
  return getFocusCost(itemId || "", tier, "crafting");
}

// How many units one craft action yields (items.xml `amountcrafted`). Most
// meals and potions craft in batches (salads 10, heal potions 5); single-
// ingredient foods yield 1. The consumables craft branch divides material cost
// by this so a row is priced per single unit — matching the per-unit focus cost
// and per-unit sale price. Default 1 for anything not in the generated map
// (gear/refining are 1:1). Enchant variants (id@n) reuse the base recipe, so
// strip the suffix and fall back to the base id's yield.
function getRecipeOutput(itemId) {
  if (typeof CONSUMABLE_OUTPUT === "undefined" || !itemId) return 1;
  if (CONSUMABLE_OUTPUT[itemId]) return CONSUMABLE_OUTPUT[itemId];
  const baseId = String(itemId).replace(/@\d+$/, "");
  if (baseId !== itemId && CONSUMABLE_OUTPUT[baseId]) return CONSUMABLE_OUTPUT[baseId];
  return 1;
}

// Butchering ONE animal into raw meat. The charge comes straight out of
// items.xml, which gives every meat tier the identical block:
//
//   <craftingrequirements amountcrafted="18" craftingfocus="38"
//                         returnproductnotresource="true">
//
// craftingfocus is per OUTPUT UNIT ([[project_craftingfocus_is_per_output_unit]]),
// so one animal is 38 × 18 = 684 focus at zero specialization — and flat across
// T3-T8 as a CONSEQUENCE of the six blocks being identical, not as an assertion.
// The usual cooking-node multiplier then scales it.
//
// Two independent in-game readings pin that base:
//   Chef 100 + Butcher 100 + 17 sibling levels → 31,510 FCE → 77 focus
//     (2026-06-26: T3 Chicken and T6 Sheep both 77)
//   Chef 100 + Butcher 100 + Stew Chef 17 + 19 more sibling levels
//                                            → 32,080 FCE → 74 focus
//     (2026-08-03, a goose; the same character's T6 Avalonian Stew reads
//      80.3/each, which back-solves to exactly those levels)
//
// The previous model back-solved a ~536 base from the first reading while
// assuming every sibling node sat at 0, and so understated the charge ~21% at
// every spec level. Reading the per-unit 38 WITHOUT the ×18 is the opposite
// error and collapses the charge to 1 — the original bug.
//
// The RRR side keeps its own convention (PB = base 18 + meat-city spec 10
// + focus 59), which is independent of this.
// Fish chops (the butcher's other product) carry no craftingfocus → 0.
const BUTCHER_ANIMAL_YIELD_FALLBACK = 18; // items.xml amountcrafted, all tiers
function _butcherAnimalYield(itemId) {
  const recipe = (typeof CHAIN_RECIPES !== "undefined") ? CHAIN_RECIPES[itemId] : null;
  return (recipe && recipe.output > 0) ? recipe.output : BUTCHER_ANIMAL_YIELD_FALLBACK;
}
function getButcherFocusCost(itemId) {
  if (!/^T[3-8]_MEAT$/.test(itemId || "")) return 0;
  const base = getBaseFocusCost(itemId) * _butcherAnimalYield(itemId);
  if (!base) return 0;
  return Math.max(1, Math.round(base * _itemFocusMultiplier(itemId)));
}

/**
 * How many raw mats to buy to use up 10,000 focus crafting/refining this item.
 * @param {number} focusCost - Focus cost per craft/refine cycle
 * @param {number} matsPerCraft - Total raw mats consumed per craft cycle
 * @param {boolean} applyRrr - If true, matsPerCraft is the base count (RRR reduces it)
 * @param {number} rrr - Resource return rate
 * @returns {number} Total raw mats to buy
 */
function matsNeededFor10kFocus(focusCost, matsPerCraft, applyRrr = false, rrr = 0) {
  // Same bar arithmetic as Profit / 10k Focus: a fraction of one craft when a
  // single craft costs more than the bar, so the list never reads 0 there.
  const craftsWithFocus = (typeof focusBarCrafts === "function" ? focusBarCrafts(focusCost) : Math.floor(10000 / focusCost));
  const effectiveMats = applyRrr ? matsPerCraft * (1 - rrr) : matsPerCraft;
  return Math.round(craftsWithFocus * effectiveMats);
}

function getStationFeeInput() {
  const el = document.getElementById("station-fee");
  return el ? (parseFloat(el.value) || 0) : 0;
}

// The toolbar's two Daily Production Bonus slots (#daily-bonus-group-1 /
// #daily-bonus-value-1 and #daily-bonus-group-2 / #daily-bonus-value-2): each
// pair targets ONE item group — craft rows match their craftType, refining
// rows "refine:<resource>", butcher rows "butcher" (js/data-daily-bonus-groups.js)
// — with the station's rotating "+10%" ("0.1") or "+20%" ("0.2"). The group
// picker is a text input over a shared datalist: the visible text is only a
// label, so the resolved group id rides on the input's data-daily-bonus-group
// attribute (kept there by js/app.js and js/settings-transfer-ui.js). Anything
// else (a missing element, no dataset id, group "none", an unknown group, a
// junk value) prices as no bonus. When both pairs name the same group,
// slot 2 wins.

// Read the two slot pairs into a { groupId: bonus } map. Fresh on every call —
// the inputs/selects can flip between renders.
function getDailyProductionBonus() {
  if (typeof document === "undefined" || !document.getElementById) return {};
  const map = {};
  for (let i = 1; i <= 2; i++) {
    const groupEl = document.getElementById("daily-bonus-group-" + i);
    const valueEl = document.getElementById("daily-bonus-value-" + i);
    if (!groupEl || !valueEl) continue;
    // The typed label text is display-only: trust the dataset-resolved id.
    const group = (groupEl.dataset && groupEl.dataset.dailyBonusGroup)
      ? groupEl.dataset.dailyBonusGroup
      : "none";
    if (group === "none" || group === "") continue;
    const isGroup = (typeof globalThis.isDailyBonusGroupId === "function")
      ? globalThis.isDailyBonusGroupId(group)
      : false; // no group model loaded → no slot can be validated → skip it
    if (!isGroup) continue;
    const v = Number.parseFloat(valueEl.value);
    if (v !== 0.1 && v !== 0.2) continue;
    map[group] = v;
  }
  return map;
}

// The bonus aimed at one group (0 when that group has no slot). Mount rows
// pass null/undefined here and always price as no bonus.
function getDailyProductionBonusFor(group) {
  return getDailyProductionBonus()[group] || 0;
}

// Validate a stored dailyProductionBonus pref (a JSON map string, e.g.
// '{"sword":0.2,"refine:wood":0.1}') into a { groupId: bonus } map. Unknown
// groups and values other than 0.1/0.2 are dropped, more than two entries
// keeps the first two in insertion order. Legacy scalars ("0"/"0.1"/"0.2")
// are no longer expressible: they fail the object shape and degrade to {}.
// Any junk input degrades to {} rather than throwing.
function parseDailyBonusJson(str) {
  let parsed;
  try {
    parsed = JSON.parse(str);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out = {};
  let kept = 0;
  for (const [id, raw] of Object.entries(parsed)) {
    if (kept >= 2) break;
    const isGroup = (typeof globalThis.isDailyBonusGroupId === "function")
      ? globalThis.isDailyBonusGroupId(id)
      : false; // no group model loaded → nothing can be validated → drop
    if (!isGroup) continue;
    const v = Number(raw);
    if (v !== 0.1 && v !== 0.2) continue;
    out[id] = v;
    kept++;
  }
  return out;
}

// calculations.js / app.js / settings-transfer-ui.js read these through
// globalThis, so mirror the browser-global scope for Node sandboxes that
// concatenate the files (same pattern as js/black-market-items.js).
if (typeof globalThis !== "undefined") {
  globalThis.getDailyProductionBonus = getDailyProductionBonus;
  globalThis.getDailyProductionBonusFor = getDailyProductionBonusFor;
  globalThis.parseDailyBonusJson = parseDailyBonusJson;
}

// Silver cost of using a crafting station for one craft/refine cycle.
// tier: item tier (4–8), nonArtifactMats: total count of non-artifact materials consumed.
// nutritionOverride: optional explicit nutrition value (used for items where the
// tier-based estimate doesn't match in-game — e.g. UNIQUE_HIDEOUT mixes T2–T6 mats
// plus a GvG token whose effective itemvalue isn't its items.xml value).
function calcStationFeeSilver(tier, nonArtifactMats, nutritionOverride = null) {
  const ivPerMat = 14 * Math.pow(2, tier - 4);
  const itemValue = nonArtifactMats * ivPerMat;
  const nutrition = nutritionOverride != null ? nutritionOverride : itemValue * 0.1125;
  // Nutrition is a game-internal quantity; the Global Discount lands on the
  // silver the station bills for it, so it multiplies the result, never the
  // nutrition (which would corrupt the measured transmute fee grids).
  const gross = (getStationFeeInput() / 100) * nutrition;
  return typeof applyGlobalDiscount === "function" ? applyGlobalDiscount(gross) : gross;
}

// Station-fee nutrition for ONE refine output. Refining doesn't need the
// per-material estimate above: the game bills nutrition off the PRODUCT's
// items.xml itemvalue, and a refined resource's itemvalue is exactly
// 16 * 2^(tier-4) * 2^enchant (T4 plank 16, T5 32 … T8 256; T5.1 64 … T5.4 512).
// With nutrition = itemvalue * 0.1125 that is 1.8 * 2^(tier-4+enchant).
//
// Verified on the wiki ("1000 silver per 100 nutrition"): Granite Block T5 = 3.6,
// Marble Block T8 = 28.8, Uncommon Pine Planks T4.1 = 3.6 against plain T4 = 1.8.
// The generic estimate was 14 item-value per material with no enchant term, so
// it ran 12.5% short on plain refines and up to 16x short at .4.
//
// Keyed on the REFINED id on purpose: enchanted-rock rows output a PLAIN stone
// block, and the wiki bills them at the plain rate (Granite Block .3 = 28.8
// nutrition for 8 blocks = 3.6 each).
function refineStationNutrition(refinedId) {
  const tier = getTierFromId(refinedId);
  const m = String(refinedId || "").match(/@(\d)$/);
  const ench = m ? parseInt(m[1], 10) : 0;
  return 1.8 * Math.pow(2, tier - 4 + ench);
}

// Silver cost of one refine's station usage, from the #station-fee input.
function refineStationFeeSilver(refinedId) {
  return calcStationFeeSilver(
    getTierFromId(refinedId), 1, refineStationNutrition(refinedId),
  );
}
