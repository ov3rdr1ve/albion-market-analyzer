// Uniform short display names for raw/refined resources, e.g. "T6.1 planks",
// "T4 bar", "T3 logs". Used app-wide (getItemDisplayName, the refining table, the
// resource-flip table) so resources read consistently by tier instead of
// carrying tier-specific proper names (Bloodoak/Cedar/Lavish/Steel…) that drift
// from the in-game localisation across families and tiers.
//
// resourceShortName() returns null for any non-resource id, so callers fall
// through to their normal name resolution.
//
// Recognised families (raw word / refined word), one regex over the 10 segment
// names that appear directly after the tier prefix:
//   WOOD logs / PLANKS planks      ORE ore / METALBAR bar
//   HIDE hide / LEATHER leather    FIBER fiber / CLOTH cloth
//   ROCK rock / STONEBLOCK block
// Enchant level is read from either id form (_LEVELn@n or @n); level 0 is omitted.
// MUST load before js/data.js and js/utils.js (see index.html).

const RESOURCE_WORDS = {
  WOOD: "logs", PLANKS: "planks",
  ORE: "ore", METALBAR: "bar",
  HIDE: "hide", LEATHER: "leather",
  FIBER: "fiber", CLOTH: "cloth",
  ROCK: "rock", STONEBLOCK: "block",
};

// Spanish short words — keeps the same compact "6.1 tablones" format so column
// widths hold. Used when the UI language is "es" (getLang(), js/i18n.js).
const RESOURCE_WORDS_ES = {
  WOOD: "troncos", PLANKS: "tablones",
  ORE: "mineral", METALBAR: "lingote",
  HIDE: "piel", LEATHER: "cuero",
  FIBER: "fibra", CLOTH: "tela",
  ROCK: "roca", STONEBLOCK: "bloque",
};

const RESOURCE_ID_RE =
  /^T(\d+)_(WOOD|ORE|HIDE|FIBER|ROCK|PLANKS|METALBAR|LEATHER|CLOTH|STONEBLOCK)(?:_LEVEL(\d+))?(?:@(\d+))?$/;

function resourceShortName(itemId) {
  if (typeof itemId !== "string") return null;
  const m = itemId.match(RESOURCE_ID_RE);
  if (!m) return null;
  const tier = m[1];
  const es = typeof getLang === "function" && getLang() === "es";
  const word = (es ? RESOURCE_WORDS_ES : RESOURCE_WORDS)[m[2]];
  const ench = Number(m[3] || m[4] || 0);
  // The "T" keeps a bare tier from reading as a count in mat lists, where the
  // label follows a multiplier: "1x T2 rock", not "1x 2 rock".
  return ench ? `T${tier}.${ench} ${word}` : `T${tier} ${word}`;
}

// Family synonyms appended to a resource's search aliases so a row prints "4
// rock" yet is still found by "stone", "metal", "lumber", etc. Raw and refined
// segments share the family's everyday words plus their own.
const RESOURCE_SYNONYMS = {
  WOOD: "wood logs lumber", PLANKS: "wood planks plank lumber",
  ORE: "ore metal", METALBAR: "metal bar ingot",
  HIDE: "hide leather skin", LEATHER: "leather hide",
  FIBER: "fiber cloth", CLOTH: "cloth fiber",
  ROCK: "rock stone", STONEBLOCK: "stone block rock",
};

// Extra, hidden search terms for a raw/refined resource id: its real in-game
// proper name (Travertine / Bloodoak Logs / Steel Bar, drawn from the names map)
// plus the family synonyms above — lowercased, de-duplicated, space-joined.
// Returns "" for any non-resource id (callers then render no alias span).
//
// `namesMap` defaults to the browser-global ITEM_NAMES_MAP (js/item-names.js);
// tests pass a synthetic map so they need no 24MB global. The proper name is
// looked up by the PLAIN base id (enchant stripped) so quality words
// ("Rare"/"Pristine") never crowd out the actual material name.
function resourceSearchAliases(itemId, namesMap) {
  if (typeof itemId !== "string") return "";
  const m = itemId.match(RESOURCE_ID_RE);
  if (!m) return "";
  const tier = m[1];
  const seg = m[2];
  const map =
    namesMap ||
    (typeof ITEM_NAMES_MAP !== "undefined" ? ITEM_NAMES_MAP : null) ||
    (typeof global !== "undefined" ? global.ITEM_NAMES_MAP : null);
  const proper = map && map[`T${tier}_${seg}`]
    ? String(map[`T${tier}_${seg}`]).replace(/^T\d+(?:\.\d+)?\s+/, "")
    : "";
  const tokens = `${proper} ${RESOURCE_SYNONYMS[seg] || ""}`
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return [...new Set(tokens)].join(" ");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { resourceShortName, resourceSearchAliases, RESOURCE_WORDS };
}
