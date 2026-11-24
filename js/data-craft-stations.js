// Crafting station (in-game building) per craft — the data behind the Crafting
// table's "Station" picker.
//
// GROUND TRUTH: ao-bin-dumps buildings.xml <craftbuilding> item lists, joined to
// items.xml `craftingcategory` (which is exactly the `craftType` our catalogs
// carry). The non-obvious splits, all read off that file:
//
//   • Crossbow + War Gloves (knuckles) are FORGE crafts, not Hunter's Lodge.
//   • Spear + Quarterstaff + Nature Staff + Shapeshifter Staff are HUNTER'S
//     LODGE crafts, not Forge / Mage's Tower.
//   • `offhand` is one items.xml category but THREE buildings: shields at the
//     Forge, torch/horn (OFF_TORCH, OFF_HORN_KEEPER, lamp, jester cane,
//     talisman) at the Hunter's Lodge, book/orb/totem (OFF_BOOK, OFF_ORB_MORGANA,
//     OFF_TOTEM_KEEPER, censer, grimoire) at the Mage's Tower. Our catalogs
//     already split it into shield/torch/horn/book/orb/totem craftTypes.
//   • Armor follows its weapon building: plate → Forge, leather → Hunter's
//     Lodge, cloth → Mage's Tower.
//   • Bags, capes, tools, tracking toolkits, gatherer gear, furniture, repair
//     kits and the hideout are ALL Toolmaker.
//   • Flour + butter are MILL, not Cook; meat + fish chops are BUTCHER.
//
// Artifacts and dungeon/hellgate maps have no <craftbuilding> entry (the
// Artifact Foundry is a <meldbuilding>), so they are classified by id.
//
// Two artifact families are NOT Foundry work at all: Crystal Shards and Fire
// Dragon Scales are exchanged 50-for-one at the ENERGY MANIPULATOR, where you
// pick the artifact instead of rolling for it (see js/data-energy-exchange.js).
// Their catalog rows carry an explicit `station`, and the id pattern below
// catches them ahead of the `_ARTEFACT` catch-all for the row-key fallback.

const CRAFT_STATIONS = [
  { key: "forge", label: "Warrior's Forge" },
  { key: "hunterslodge", label: "Hunter's Lodge" },
  { key: "magetower", label: "Mage's Tower" },
  { key: "toolmaker", label: "Toolmaker" },
  { key: "alchemist", label: "Alchemist's Lab" },
  { key: "cook", label: "Cook" },
  { key: "mill", label: "Mill" },
  { key: "butcher", label: "Butcher" },
  { key: "saddler", label: "Saddler" },
  { key: "foundry", label: "Artifact Foundry" },
  { key: "energy", label: "Energy Manipulator" },
];

const CRAFT_STATION_BY_TYPE = {
  // ── Warrior's Forge ──────────────────────────────────────────────────────
  sword: "forge", axe: "forge", mace: "forge", hammer: "forge",
  crossbow: "forge", knuckles: "forge", shield: "forge",
  plate_armor: "forge", plate_helmet: "forge", plate_shoes: "forge",
  // ── Hunter's Lodge ───────────────────────────────────────────────────────
  bow: "hunterslodge", spear: "hunterslodge", dagger: "hunterslodge",
  quarterstaff: "hunterslodge", naturestaff: "hunterslodge",
  shapeshifterstaff: "hunterslodge", torch: "hunterslodge", horn: "hunterslodge",
  leather_armor: "hunterslodge", leather_helmet: "hunterslodge", leather_shoes: "hunterslodge",
  // ── Mage's Tower ─────────────────────────────────────────────────────────
  firestaff: "magetower", holystaff: "magetower", froststaff: "magetower",
  arcanestaff: "magetower", cursestaff: "magetower",
  book: "magetower", orb: "magetower", totem: "magetower",
  cloth_armor: "magetower", cloth_helmet: "magetower", cloth_shoes: "magetower",
  // ── Toolmaker (tools, bags, capes; gatherer gear handled by suffix) ───────
  pickaxe: "toolmaker", sickle: "toolmaker", skinningknife: "toolmaker",
  fishing: "toolmaker", stonehammer: "toolmaker", demolitionhammer: "toolmaker",
  woodaxe: "toolmaker", tools: "toolmaker", gatherergear: "toolmaker",
  bag: "toolmaker", cape: "toolmaker",
  // ── Consumables / mounts / artifacts ─────────────────────────────────────
  potion: "alchemist", food: "cook", battlemount: "saddler", mount: "saddler",
  artifact: "foundry",
};

// craftType → station for the families whose type is built from a resource
// prefix (fibergatherer_helmet, oregatherer_backpack, …).
const CRAFT_STATION_TYPE_PATTERNS = [
  [/gatherer_(helmet|armor|shoes|backpack)$/, "toolmaker"],
];

// id → station for rows whose catalog entry carries no craftType (mounts,
// tracking toolkits, furniture, meals, alchemy inputs, maps, artifacts).
const CRAFT_STATION_ID_PATTERNS = [
  [/_MOUNT_|^UNIQUE_MOUNT/, "saddler"],
  [/_2H_TOOL_|_FURNITUREITEM_|^UNIQUE_HIDEOUT|_SIEGE_BANNER|_GATHERER_|_BAG(?:@|$)|_CAPE(?:ITEM)?(?:@|_|$)/, "toolmaker"],
  [/_FLOUR|_BUTTER/, "mill"],
  [/_MEAT|_FISHCHOPS/, "butcher"],
  [/_MEAL_|_BREAD|_FISHSAUCE|_FISHINGBAIT/, "cook"],
  [/_POTION_|_ALCHEMY_|_ALCOHOL/, "alchemist"],
  [/^T\d+_ARTEFACT_.*(?:_CRYSTAL|_LEATHER_DRAGON)$/, "energy"],
  [/_ARTEFACT|_RANDOM_DUNGEON|_MAP(?:@|$)|_CORRUPTED_|_HELLGATE_/, "foundry"],
];

/**
 * The crafting building an item is made at.
 *
 * @param {{id?: string, craftType?: string|null, station?: string}|null} item
 *   catalog entry; an explicit `station` always wins
 * @returns {string|null} station key from CRAFT_STATIONS, or null when unknown
 *   (never guessed — an unclassified row simply never matches a station pick).
 */
function getCraftStation(item) {
  if (!item || typeof item !== "object") return null;
  // A catalog row may name its station outright — the only way to express a
  // building that no craftType or id shape implies.
  if (item.station) return item.station;
  const craftType = item.craftType;
  if (craftType) {
    if (CRAFT_STATION_BY_TYPE[craftType]) return CRAFT_STATION_BY_TYPE[craftType];
    for (const [re, station] of CRAFT_STATION_TYPE_PATTERNS) {
      if (re.test(craftType)) return station;
    }
  }
  const id = typeof item.id === "string" ? item.id.replace(/@\d$/, "") : "";
  if (!id) return null;
  for (const [re, station] of CRAFT_STATION_ID_PATTERNS) {
    if (re.test(id)) return station;
  }
  return null;
}

/** Same, from a bare item id (used by the row-key fallback in table-search). */
function getCraftStationForId(id) {
  return getCraftStation({ id });
}

function getCraftStationLabel(key) {
  const s = CRAFT_STATIONS.find((x) => x.key === key);
  return s ? s.label : "";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CRAFT_STATIONS,
    CRAFT_STATION_BY_TYPE,
    getCraftStation,
    getCraftStationForId,
    getCraftStationLabel,
  };
  // The browser gets these as plain globals (script tag); mirror that for the
  // modules that look them up via `typeof getCraftStation === "function"`.
  if (typeof globalThis !== "undefined") {
    globalThis.CRAFT_STATIONS = CRAFT_STATIONS;
    globalThis.getCraftStation = getCraftStation;
    globalThis.getCraftStationForId = getCraftStationForId;
    globalThis.getCraftStationLabel = getCraftStationLabel;
  }
}
