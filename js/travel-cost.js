/**
 * Brecilien Travel Planner cost.
 *
 * Brecilien sits in the Mists: you can carry goods IN for free (yellow portal),
 * but the ONLY way to move tradeable goods OUT is the Travel Planner, which
 * charges silver by weight. So any transport leg that ORIGINATES in Brecilien
 * and ends in a different city pays this fee; legs that end in Brecilien (or
 * never touch it) are free.
 *
 * In-game formula (Albion wiki, Travel_Planner):
 *     cost = RATE * weight(kg) * fasttravelfactor * distance
 * Brecilien counts as 2 city distances. The wiki also notes the final charge is
 * "affected by both Gold Market Stabilization and Global Discount" — server-side
 * modifiers the market API does not expose, so the rate is pinned against
 * observed in-game charges for 1 × T4_RELIC (weight 0.05, ftf 1, raw 15):
 *
 *   2026-05-28  17.34 silver  gold ~7,520  → rate × GMS = 173.4
 *   2026-07-29  23.00 silver  gold  7,872  → rate × GMS = 230.0
 *
 * Gold moved 4.7% while the charge moved 33%, so this is NOT gold-driven — the
 * planner's base rate itself changed (150 → 200, which reproduces the reading as
 * 23.12). Only the PRODUCT rate × GMS is observable from a single item, so which
 * factor moved is unidentifiable; GMS stays 1.156 because the independent maps
 * calibration (data-maps.js, 2026-07-20) still confirms that value.
 *
 * The Global Discount (gold below 5,000) applies on top and is live — see
 * js/global-discount.js.
 *
 * Weight + fasttravelfactor come from items.xml. Raw/refined resources follow
 * the exact tier weight 0.1*1.5^tier (which the app's getResourceWeightKg
 * already matches; weight does NOT change with enchant) and a fasttravelfactor
 * (Travel Cost Modifier) that is 1 through T3 then DOUBLES with each tier AND
 * each enchant level, capped at 256 — ftf = min(256, 2^(tier-3+enchant)),
 * uniform across every resource family. So an enchanted log costs more to haul
 * than a plain one of the same tier even though it weighs the same. Item
 * quality does not affect either weight or TCM (and resources can't be
 * qualified anyway), so it is intentionally ignored. Finished goods Brecilien
 * actually produces (capes/bags/potions/meals/crops) get real per-item weights
 * from the generated ITEM_WEIGHTS table (js/data-weights.js); everything else
 * falls back to a tier-based estimate with fasttravelfactor 1.
 */

const TRAVEL_PLANNER_RATE = 200; // silver per kg (was 150 before 2026-07-29)
const BRECILIEN_DISTANCE = 2; // Brecilien = 2 city distances
const BRECILIEN_CITY = "Brecilien";
// Gold Market Stabilization multiplier, calibrated against the in-game value
// 17.34 silver for 1 × T4_RELIC: 17.34 / (150 * 0.05 * 1 * 2) = 1.156.
const GOLD_MARKET_STABILIZATION = 1.156;

// Raw + refined resource base ids carry a tier- AND enchant-scaled
// fasttravelfactor in items.xml (see _resourceFastTravelFactor below).
const RESOURCE_BASE_RE =
  /^T\d+_(ORE|WOOD|FIBER|HIDE|ROCK|METALBAR|PLANKS|LEATHER|CLOTH|STONEBLOCK)$/;

// Laborer journals — items.xml weights follow 0.15 * 1.5^(tier-2) rounded
// to 2dp. Table-stored (not formula) so JS float rounding can't drift on
// T3 (0.225 → 0.22 in IEEE-754). All variants (partial / _EMPTY / _FULL)
// share the same in-game journal item, so the regex tolerates any suffix.
const JOURNAL_BASE_RE = /^T\d+_JOURNAL_/;
const JOURNAL_WEIGHT_BY_TIER = { 2: 0.15, 3: 0.23, 4: 0.34, 5: 0.51, 6: 0.76, 7: 1.14, 8: 1.71 };

// Trophy furniture (laborer trophies) — items.xml weight is a flat 3 kg
// across every tier and every trophy slug.
const FURNITURE_TROPHY_RE = /^T\d+_FURNITUREITEM_TROPHY_/;
const FURNITURE_TROPHY_WEIGHT = 3;

// Artifact crafting mats (RELIC / SOUL / RUNE / SHARD_AVALONIAN / SHARD_CRYSTAL
// / ESSENCE / ESSENCE_POTION) — items.xml uses one weight schedule across every
// family, T4-T8 only, and never sets fasttravelfactor (defaults to 1). Without
// this branch they fall through to the gear-class fallback and report ~100×
// the real weight, inflating every Brecilien exit fee on artifact crafts.
// SHARD_CRYSTAL ("Crystal Shard") postdates the items.xml dump but is the same
// artifact-mat class as SHARD_AVALONIAN, so we treat it on the same schedule.
// SHARD_FIRE_DRAGON ("Fire Dragon Scales") is the Crystal Shard's Dragonhide
// sibling at the Energy Manipulator and rides the same schedule.
const ARTIFACT_MATERIAL_RE = /^T[4-8]_(RELIC|SOUL|RUNE|SHARD_AVALONIAN|SHARD_CRYSTAL|SHARD_FIRE_DRAGON|ESSENCE|ESSENCE_POTION)$/;
const ARTIFACT_MATERIAL_WEIGHT_BY_TIER = { 4: 0.05, 5: 0.25, 6: 0.38, 7: 0.5, 8: 1 };

// Per-item travel overrides for ids that the items.xml dump under-specifies.
// These bypass both the ITEM_WEIGHTS table and every pattern fallback. Use
// sparingly — only for ids whose real in-game Travel Planner charge differs
// from what (weight × fasttravelfactor) in items.xml predicts. Verified by
// observing the exact silver cost shown at the Brecilien planner.
//   - QUESTITEM_TOKEN_AVALON ("Avalonian Energy"): items.xml weight 0.01 with
//     no TCM attr, but the planner charges 55.49 silver → effective TCM 16.
//     Server-side TCM that the static dump doesn't reflect.
//   - UNIQUE_GVGTOKEN_GENERIC ("Siphoned Energy"): items.xml weight 0.01,
//     TCM 1; the planner charges 3.47 silver, matching the items.xml values.
//     Pinned here so the broken gear-class fallback (5.25 kg → 1820 silver)
//     can't catch this id.
const MANUAL_TRAVEL_OVERRIDES = {
  QUESTITEM_TOKEN_AVALON: { weight: 0.01, ftf: 16 },
  UNIQUE_GVGTOKEN_GENERIC: { weight: 0.01 },
  // Fishing bait + worms carry no weight attribute in items.xml; without an
  // override they'd hit the heavy finished-good fallback. They're light
  // stackable consumables, so pin a small weight.
  T1_WORM: { weight: 0.1 },
  T1_FISHINGBAIT: { weight: 0.1 },
  T3_FISHINGBAIT: { weight: 0.1 },
  T5_FISHINGBAIT: { weight: 0.1 },
};

// Strip enchant decorations so "T5_METALBAR_LEVEL2@2" and "T5_CAPE@3" resolve
// to their base id for table + pattern lookups.
function _travelBaseId(itemId) {
  if (!itemId || typeof itemId !== "string") return "";
  return itemId.replace(/@\d+$/, "").replace(/_LEVEL\d+$/, "");
}

function _travelTier(itemId) {
  const m = String(itemId || "").match(/^T(\d+)/);
  return m ? parseInt(m[1], 10) : 4;
}

// Enchant level from an id's @N or _LEVELN decoration (0 when unenchanted).
// Unlike weight, a resource's fasttravelfactor scales with this, so the ftf
// path reads it off the RAW id instead of the stripped base.
function _travelEnchant(itemId) {
  const s = String(itemId || "");
  const at = s.match(/@(\d+)\s*$/);
  if (at) return parseInt(at[1], 10);
  const lvl = s.match(/_LEVEL(\d+)/);
  return lvl ? parseInt(lvl[1], 10) : 0;
}

// Weight tables are defined by js/data-weights.js (browser) or injected as
// globals (tests). Read lazily — same pattern as getFocusCost reading FOCUS_COSTS.
function _weightTable() {
  return typeof ITEM_WEIGHTS !== "undefined" && ITEM_WEIGHTS ? ITEM_WEIGHTS : null;
}
function _factorTable() {
  return typeof ITEM_FT_FACTORS !== "undefined" && ITEM_FT_FACTORS ? ITEM_FT_FACTORS : null;
}

/**
 * Per-unit weight (kg) for travel-fee purposes.
 * Order: extracted items.xml table → resource tier formula → finished-good
 * tier estimate. The resource formula (0.1*1.5^tier, 2dp) matches items.xml
 * exactly (T5 = 0.76), so resources need no table entry.
 */
function getItemWeight(itemId) {
  const base = _travelBaseId(itemId);
  const override = MANUAL_TRAVEL_OVERRIDES[base];
  if (override && typeof override.weight === "number") return override.weight;
  const table = _weightTable();
  if (table && typeof table[base] === "number") return table[base];
  const tier = _travelTier(base);
  if (RESOURCE_BASE_RE.test(base)) {
    return Math.round(0.1 * Math.pow(1.5, tier) * 100) / 100;
  }
  if (JOURNAL_BASE_RE.test(base)) {
    return JOURNAL_WEIGHT_BY_TIER[tier] ?? Math.round(0.15 * Math.pow(1.5, tier - 2) * 100) / 100;
  }
  if (FURNITURE_TROPHY_RE.test(base)) {
    return FURNITURE_TROPHY_WEIGHT;
  }
  if (ARTIFACT_MATERIAL_RE.test(base)) {
    return ARTIFACT_MATERIAL_WEIGHT_BY_TIER[tier];
  }
  // Finished-good fallback (gear-class estimate) for ids not in the table.
  return Math.round(0.5 * Math.pow(1.8, tier) * 100) / 100;
}

// items.xml fasttravelfactor (Travel Cost Modifier) for raw + refined
// resources. Uniform across every resource family (WOOD/ORE/FIBER/HIDE/ROCK +
// their refined forms): it is 1 through T3, then DOUBLES with BOTH tier and
// enchant level, capped at 256. So ftf(tier, enchant) = min(256,
// 2^(tier-3+enchant)). Verified against items.xml: T4.0=2, T4.1=4, T4.2=8,
// T5.0=4, T5.1=8, T6.1=16, T8.2=128, T8.4 caps at 256. This was previously a
// flat hardcoded 4 (only correct for T5.0), and weight does NOT scale with
// enchant, so the enchant signal lives entirely in this modifier.
const RESOURCE_FT_FACTOR_CAP = 256;
function _resourceFastTravelFactor(tier, enchant) {
  const exp = Math.max(0, tier - 3 + (enchant || 0));
  return Math.min(RESOURCE_FT_FACTOR_CAP, Math.pow(2, exp));
}

/**
 * fasttravelfactor for travel-fee purposes.
 * Order: extracted table override → resource (tier+enchant) schedule → 1.
 * The enchant level is read from the RAW id because a resource's TCM doubles
 * per enchant level (getItemWeight, by contrast, strips it — weight is
 * enchant-invariant).
 */
function getItemFastTravelFactor(itemId) {
  const base = _travelBaseId(itemId);
  const override = MANUAL_TRAVEL_OVERRIDES[base];
  if (override && typeof override.ftf === "number") return override.ftf;
  const table = _factorTable();
  if (table && typeof table[base] === "number") return table[base];
  if (RESOURCE_BASE_RE.test(base)) {
    return _resourceFastTravelFactor(_travelTier(base), _travelEnchant(itemId));
  }
  return 1;
}

/**
 * Silver to move ONE unit of itemId out of Brecilien via the Travel Planner.
 *     200 * weight * fasttravelfactor * 2 * GOLD_MARKET_STABILIZATION
 * then the live Global Discount, which the wiki lists as applying to this fee.
 * Reproduces the observed 23.12 charge for 1 × T4_RELIC.
 */
function brecilienExitCostPerUnit(itemId) {
  const gross =
    TRAVEL_PLANNER_RATE *
    getItemWeight(itemId) *
    getItemFastTravelFactor(itemId) *
    BRECILIEN_DISTANCE *
    GOLD_MARKET_STABILIZATION;
  return typeof applyGlobalDiscount === "function" ? applyGlobalDiscount(gross) : gross;
}

/**
 * DISABLED — the Brecilien Travel Planner exit fee has been removed from all
 * profit tables (crafting, flipping, transport, farming, mounts, consumables,
 * refining chains, laborers) per request. This was the single choke point every
 * profit table routed through, so returning 0 neutralizes the fee everywhere
 * while leaving the call sites in place: the route finders revert to plain
 * cheapest-buy / highest-sell, the margin functions drop their travel term, and
 * the "+N travel" badges (which guard on fee > 0) stop rendering.
 *
 * The Brecilien Travel Planner Fees REFERENCE TABLE (js/render-brecilien-fees.js)
 * does NOT use this function — it reads brecilienExitCostPerUnit directly, which
 * stays the live, real per-unit calculation. To re-enable the applied fee,
 * restore the origin/dest/BMR-gated logic (see git history) below.
 *
 * @param {string} originCity - unused (fee disabled)
 * @param {string} destCity - unused (fee disabled)
 * @param {string} itemId - unused (fee disabled)
 * @param {number} qty - unused (fee disabled)
 * @returns {number} silver — always 0
 */
function legBrecilienCost(originCity, destCity, itemId, qty = 1) {
  return 0;
}

// Node test harness export (inert in the browser, which uses globals).
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TRAVEL_PLANNER_RATE,
    BRECILIEN_DISTANCE,
    BRECILIEN_CITY,
    GOLD_MARKET_STABILIZATION,
    getItemWeight,
    getItemFastTravelFactor,
    brecilienExitCostPerUnit,
    legBrecilienCost,
  };
}
