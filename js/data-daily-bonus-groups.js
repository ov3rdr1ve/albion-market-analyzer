// Per-group Daily Production Bonus model — which item groups a station's
// rotating 10%/20% daily bonus can target.
//
// Pure data plus three tiny helpers, patterned on js/data-city-bonuses.js:
// bare top-level declarations so classic scripts share one scope, module.exports
// for Node. js/calculations.js and js/utils.js read these through globalThis,
// and js/app.js populates the toolbar's shared datalist from DAILY_BONUS_GROUPS.
//
// Source: Albion Wiki "Local Production Bonus" (daily rotation: up to two
// item groups per station get +10% or +20% production bonus for one day).

// Standalone Node require: hoist the city-bonus tables onto globalThis (same
// pattern as js/calculations.js). In the browser and in the concatenated
// test sandboxes CITY_CRAFT_SPEC already shares the script scope, so the
// guard skips the require there.
if (typeof module !== "undefined" && module.exports && typeof CITY_CRAFT_SPEC === "undefined") {
  Object.assign(globalThis, require("./data-city-bonuses.js"));
}

// Craft groups: the ordered union of CITY_CRAFT_SPEC values (cities in file
// order, ids deduped) with the two consumable families appended. Mounts /
// battlemounts are NOT in the list on purpose — mount rows pass a null
// craftType to getCraftRRR, and the game puts no daily bonus on them either.
const DAILY_BONUS_CRAFT_GROUPS = (() => {
  const seen = new Set();
  const ids = [];
  const push = (id) => {
    if (typeof id === "string" && id.length > 0 && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  };
  Object.values(CITY_CRAFT_SPEC).forEach((list) => (list || []).forEach(push));
  // "food" is already a Caerleon spec and "potion" a Brecilien spec, so these
  // appends are usually no-ops — they keep the consumable families targetable
  // even if a city spec list ever drops them.
  ["food", "potion"].forEach(push);
  return ids;
})();

// Refining rows are matched by prefixed id (a bare "wood" must never hit the
// crafting group of the same name — the prefix keeps the namespaces apart).
const DAILY_BONUS_REFINE_PREFIX = "refine:";
const DAILY_BONUS_REFINE_GROUPS = [
  "refine:wood",
  "refine:fiber",
  "refine:rock",
  "refine:ore",
  "refine:hide",
];

// One butcher group covers every meat tier: the spec table stays per-meat,
// but the daily bonus is per station activity, not per animal.
const DAILY_BONUS_BUTCHER_GROUPS = ["butcher"];

// Craft + refine + butcher, in display order, no duplicates by construction.
const DAILY_BONUS_GROUPS = [
  ...DAILY_BONUS_CRAFT_GROUPS,
  ...DAILY_BONUS_REFINE_GROUPS,
  ...DAILY_BONUS_BUTCHER_GROUPS,
];

// Display labels for the ids whose raw form is not already human-readable
// (wording follows CRAFT_TYPE_LABELS in js/render-city-bonuses.js). Simple
// weapon/armor ids ("sword", "plate_helmet", ...) may fall through to the
// title-case fallback in dailyBonusGroupLabel().
const DAILY_BONUS_GROUP_LABELS = {
  holystaff: "Holy Staff",
  arcanestaff: "Arcane Staff",
  cursestaff: "Curse Staff",
  naturestaff: "Nature Staff",
  firestaff: "Fire Staff",
  froststaff: "Frost Staff",
  quarterstaff: "Quarterstaff",
  shapeshifterstaff: "Shapeshifter Staff",
  skinningknife: "Skinning Knife",
  stonehammer: "Stonehammer",
  demolitionhammer: "Demolition Hammer",
  woodaxe: "Wood Axe",
  fibergatherer_helmet: "Fiber Gatherer Helmet",
  fibergatherer_armor: "Fiber Gatherer Armor",
  fibergatherer_shoes: "Fiber Gatherer Shoes",
  fibergatherer_backpack: "Fiber Gatherer Backpack",
  hidegatherer_helmet: "Hide Gatherer Helmet",
  hidegatherer_armor: "Hide Gatherer Armor",
  hidegatherer_shoes: "Hide Gatherer Shoes",
  hidegatherer_backpack: "Hide Gatherer Backpack",
  oregatherer_helmet: "Ore Gatherer Helmet",
  oregatherer_armor: "Ore Gatherer Armor",
  oregatherer_shoes: "Ore Gatherer Shoes",
  oregatherer_backpack: "Ore Gatherer Backpack",
  rockgatherer_helmet: "Rock Gatherer Helmet",
  rockgatherer_armor: "Rock Gatherer Armor",
  rockgatherer_shoes: "Rock Gatherer Shoes",
  rockgatherer_backpack: "Rock Gatherer Backpack",
  woodgatherer_helmet: "Wood Gatherer Helmet",
  woodgatherer_armor: "Wood Gatherer Armor",
  woodgatherer_shoes: "Wood Gatherer Shoes",
  woodgatherer_backpack: "Wood Gatherer Backpack",
  fishgatherer_helmet: "Fish Gatherer Helmet",
  fishgatherer_armor: "Fish Gatherer Armor",
  fishgatherer_shoes: "Fish Gatherer Shoes",
  fishgatherer_backpack: "Fish Gatherer Backpack",
  knuckles: "War Gloves",
  food: "Food (Meals)",
  potion: "Potions",
  "refine:wood": "Refine: Wood",
  "refine:fiber": "Refine: Fiber",
  "refine:rock": "Refine: Rock",
  "refine:ore": "Refine: Ore",
  "refine:hide": "Refine: Hide",
  butcher: "Butchery",
};

/** Label for a group id: explicit map entry, else title-cased ("plate_armor" → "Plate Armor"). */
function dailyBonusGroupLabel(id) {
  if (typeof id !== "string" || id.length === 0) return "";
  if (DAILY_BONUS_GROUP_LABELS[id]) return DAILY_BONUS_GROUP_LABELS[id];
  return id.replace(/_/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** True only for ids in DAILY_BONUS_GROUPS — the gate for every reader/restore path. */
function isDailyBonusGroupId(id) {
  return typeof id === "string" && DAILY_BONUS_GROUPS.includes(id);
}

/**
 * Inverse of dailyBonusGroupLabel for the type-to-filter group inputs: the
 * trimmed, case-insensitive exact match of the typed text against every
 * group's label. Empty/whitespace text and any miss resolve to "none" — the
 * no-bonus sentinel the reader and restore paths already skip, so free-typed
 * junk simply prices that slot as no bonus. Labels are unique across
 * DAILY_BONUS_GROUPS (the datalist keys on them); were a collision ever
 * introduced, the id earlier in DAILY_BONUS_GROUPS wins.
 */
function dailyBonusGroupIdFromLabel(text) {
  if (typeof text !== "string") return "none";
  const needle = text.trim().toLowerCase();
  if (needle.length === 0) return "none";
  for (const id of DAILY_BONUS_GROUPS) {
    if (dailyBonusGroupLabel(id).toLowerCase() === needle) return id;
  }
  return "none";
}

if (typeof globalThis !== "undefined") {
  globalThis.DAILY_BONUS_CRAFT_GROUPS = DAILY_BONUS_CRAFT_GROUPS;
  globalThis.DAILY_BONUS_REFINE_PREFIX = DAILY_BONUS_REFINE_PREFIX;
  globalThis.DAILY_BONUS_REFINE_GROUPS = DAILY_BONUS_REFINE_GROUPS;
  globalThis.DAILY_BONUS_BUTCHER_GROUPS = DAILY_BONUS_BUTCHER_GROUPS;
  globalThis.DAILY_BONUS_GROUPS = DAILY_BONUS_GROUPS;
  globalThis.DAILY_BONUS_GROUP_LABELS = DAILY_BONUS_GROUP_LABELS;
  globalThis.dailyBonusGroupLabel = dailyBonusGroupLabel;
  globalThis.isDailyBonusGroupId = isDailyBonusGroupId;
  globalThis.dailyBonusGroupIdFromLabel = dailyBonusGroupIdFromLabel;
}
if (typeof window !== "undefined") {
  window.DAILY_BONUS_CRAFT_GROUPS = DAILY_BONUS_CRAFT_GROUPS;
  window.DAILY_BONUS_REFINE_PREFIX = DAILY_BONUS_REFINE_PREFIX;
  window.DAILY_BONUS_REFINE_GROUPS = DAILY_BONUS_REFINE_GROUPS;
  window.DAILY_BONUS_BUTCHER_GROUPS = DAILY_BONUS_BUTCHER_GROUPS;
  window.DAILY_BONUS_GROUPS = DAILY_BONUS_GROUPS;
  window.DAILY_BONUS_GROUP_LABELS = DAILY_BONUS_GROUP_LABELS;
  window.dailyBonusGroupLabel = dailyBonusGroupLabel;
  window.isDailyBonusGroupId = isDailyBonusGroupId;
  window.dailyBonusGroupIdFromLabel = dailyBonusGroupIdFromLabel;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DAILY_BONUS_CRAFT_GROUPS, DAILY_BONUS_REFINE_PREFIX, DAILY_BONUS_REFINE_GROUPS,
    DAILY_BONUS_BUTCHER_GROUPS, DAILY_BONUS_GROUPS, DAILY_BONUS_GROUP_LABELS,
    dailyBonusGroupLabel, isDailyBonusGroupId, dailyBonusGroupIdFromLabel,
  };
}
