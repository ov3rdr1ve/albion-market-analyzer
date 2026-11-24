/**
 * The Roads panel's vocabulary: [English, translation slug] per code the zone
 * catalog and the portal graph speak in.
 *
 * Kept apart from js/render-roads.js because it is data, not rendering — the
 * panel file is at its size limit and these tables grow every time the catalog
 * learns a new resource or marker.
 */

const ROADS_TYPE_LABELS = {
  roads: ["Roads", "roads_type_roads"],
  royalBlue: ["Royal (blue)", "roads_type_royal_blue"],
  royalYellow: ["Royal (yellow)", "roads_type_royal_yellow"],
  royalRed: ["Royal (red)", "roads_type_royal_red"],
  outlands: ["Outlands", "roads_type_outlands"],
  city: ["City", "roads_type_city"],
  other: ["Other", "roads_type_other"],
};

const ROADS_BIOME_LABELS = {
  forest: ["Forest", "roads_biome_forest"],
  swamp: ["Swamp", "roads_biome_swamp"],
  steppe: ["Steppe", "roads_biome_steppe"],
  mountain: ["Mountain", "roads_biome_mountain"],
  highlands: ["Highlands", "roads_biome_highlands"],
  avalon: ["Avalon", "roads_biome_avalon"],
};

const ROADS_SIZE_LABELS = {
  solo: ["Solo", "portal_size_solo"],
  group: ["Group", "portal_size_group"],
  raid: ["Raid", "portal_size_raid"],
  unknown: ["?", "portal_size_unknown"],
};

const ROADS_RESOURCE_LABELS = {
  rock: ["Stone", "roads_res_stone"],
  logs: ["Logs", "roads_res_logs"],
  ore: ["Ore", "roads_res_ore"],
  fiber: ["Fiber", "roads_res_fiber"],
  hide: ["Hide", "roads_res_hide"],
};

const ROADS_MARKER_LABELS = {
  dungeon: ["dungeon", "roads_marker_dungeon"],
  hire: ["hire", "roads_marker_hire"],
  group: ["group", "roads_marker_group"],
};

const ROADS_CHEST_LABELS = {
  green: ["green", "roads_chest_green"],
  blue: ["blue", "roads_chest_blue"],
  gold: ["gold", "roads_chest_gold"],
};

const ROADS_LABELS = {
  ROADS_TYPE_LABELS, ROADS_BIOME_LABELS, ROADS_SIZE_LABELS, ROADS_RESOURCE_LABELS,
  ROADS_MARKER_LABELS, ROADS_CHEST_LABELS,
};

// Explicit, because a top-level `const` in a classic script goes to the
// lexical scope and NEVER to globalThis — the browser build would read
// `undefined` off every one of these while Node's require worked fine.
if (typeof globalThis !== "undefined") Object.assign(globalThis, ROADS_LABELS);

if (typeof module !== "undefined" && module.exports) {
  module.exports = ROADS_LABELS;
}
