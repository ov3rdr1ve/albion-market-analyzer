/**
 * Generate js/data-item-categories.js from items.xml.
 *
 * The in-game Marketplace filters in this order: Category ▸ Subcategory ▸ Tier ▸
 * Enchantment ▸ Quality. The app already had Tier + Enchantment; this file
 * supplies the two missing levels. Ground truth is the `shopcategory` /
 * `shopsubcategory1` attributes items.xml carries on every tradable item — the
 * exact same taxonomy the client's market UI builds its tree from.
 *
 * Keys are BASE ids: the tier prefix (`T4_`), the refined-resource level suffix
 * (`_LEVEL3`) and the enchant suffix (`@2`) are all stripped, because every
 * variant of an item shares its category. That folds ~4.7k tradable items into
 * ~2k base ids, so the shipped map stays small and a lookup needs no per-tier
 * entries.
 *
 * Run: node scripts/gen-item-categories.cjs
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "data", "dumps", "items.xml");
const OUT = path.join(ROOT, "js", "data-item-categories.js");

// items.xml spells a few categories twice for the same in-game tab. Fold the
// alias onto the canonical key BEFORE anything else, or the picker lists
// "Off-hand" and "Farming" twice.
const CATEGORY_ALIASES = { offhands: "offhand", farmables: "farming" };

// The 2026 ao-bin-dumps reshuffled the whole shop taxonomy: weapons/armors/head/
// shoes/bags/capes became top-level categories, the per-line detail moved DOWN
// into shopsubcategory2/3 (T4_ORE is now crafting|resources|ore, the Swordfish
// Trophy other|labourers|trophies|fish), and several buckets were renamed
// ("cooked" → "food", "potion" → "potions"). The app's picker keeps the older,
// finer tree — Melee / Magic / Ranged / Products / Materials / Trophies /
// Laborers — because that is the shape every table filter and saved preference
// already speaks. FOLD maps the dump's taxonomy onto it.
//
// Keys are packed "category|sub1|sub2|sub3", looked up MOST SPECIFIC FIRST, so a
// family only needs a deep rule where the dump pushed its detail deep. Values are
// always a full "category|subcategory" of the app's own tree, so a rule can move
// an item across categories, not just rename its subcategory.
const FOLD = {
  // ── weapons: one dump category, three app ones ───────────────────────────
  "weapons|arcanestaff": "magic|arcanestaff",
  "weapons|cursestaff": "magic|cursestaff",
  "weapons|firestaff": "magic|firestaff",
  "weapons|froststaff": "magic|froststaff",
  "weapons|holystaff": "magic|holystaff",
  "weapons|naturestaff": "magic|naturestaff",
  "weapons|shapeshifterstaff": "magic|shapeshifterstaff",
  "weapons|bow": "ranged|bow",
  "weapons|crossbow": "ranged|crossbow",
  "weapons|axe": "melee|axe",
  "weapons|dagger": "melee|dagger",
  "weapons|hammer": "melee|hammer",
  "weapons|knuckles": "melee|knuckles",
  "weapons|mace": "melee|mace",
  "weapons|quarterstaff": "melee|quarterstaff",
  "weapons|spear": "melee|spear",
  "weapons|sword": "melee|sword",
  "weapons|other": "other|other",

  // ── armor: split across armors / head / shoes in the dump ────────────────
  "armors|cloth_armor": "armor|cloth_armor",
  "armors|leather_armor": "armor|leather_armor",
  "armors|plate_armor": "armor|plate_armor",
  "armors|other": "armor|unique_armor",
  "head|cloth_helmet": "armor|cloth_helmet",
  "head|leather_helmet": "armor|leather_helmet",
  "head|plate_helmet": "armor|plate_helmet",
  "head|other": "armor|unique_helmet",
  "shoes|cloth_shoes": "armor|cloth_shoes",
  "shoes|leather_shoes": "armor|leather_shoes",
  "shoes|plate_shoes": "armor|plate_shoes",
  "shoes|other": "armor|unique_shoes",
  "armor|cape": "accessories|cape", // lone DEBUG_CAPE_HIDDEN in older dumps

  // ── accessories: every cape spelling, bags and satchels ──────────────────
  capes: "accessories|cape",
  "bags|bags": "accessories|bag",
  "bags|satchels": "accessories|bag",

  // ── off-hand: the dump's *type spellings ─────────────────────────────────
  "offhand|booktype": "offhand|book",
  "offhand|shieldtype": "offhand|shield",
  "offhand|torchtype": "offhand|torch",

  // ── artifacts: routed by the line the artifact builds ────────────────────
  "artefacts|weapons|bow": "artefacts|ranged_artefact",
  "artefacts|weapons|crossbow": "artefacts|ranged_artefact",
  "artefacts|weapons|arcanestaff": "artefacts|magic_artefact",
  "artefacts|weapons|cursestaff": "artefacts|magic_artefact",
  "artefacts|weapons|firestaff": "artefacts|magic_artefact",
  "artefacts|weapons|froststaff": "artefacts|magic_artefact",
  "artefacts|weapons|holystaff": "artefacts|magic_artefact",
  "artefacts|weapons|naturestaff": "artefacts|magic_artefact",
  "artefacts|weapons|shapeshifterstaff": "artefacts|magic_artefact",
  "artefacts|weapons|axe": "artefacts|melee_artefact",
  "artefacts|weapons|dagger": "artefacts|melee_artefact",
  "artefacts|weapons|hammer": "artefacts|melee_artefact",
  "artefacts|weapons|knuckles": "artefacts|melee_artefact",
  "artefacts|weapons|mace": "artefacts|melee_artefact",
  "artefacts|weapons|quarterstaff": "artefacts|melee_artefact",
  "artefacts|weapons|spear": "artefacts|melee_artefact",
  "artefacts|weapons|sword": "artefacts|melee_artefact",
  "artefacts|offhands": "artefacts|offhand_artefact",
  "artefacts|armors": "artefacts|armor_artefact",
  "artefacts|head": "artefacts|armor_artefact",
  "artefacts|shoes": "artefacts|armor_artefact",
  "artefacts|capes": "artefacts|capes",
  "artefacts|favor": "artefacts|other",
  // Runes/souls/relics are Materials in the app; the shards stay Fragments.
  "artefacts|fragments|runes": "materials|rune",
  "artefacts|fragments|souls": "materials|soul",
  "artefacts|fragments|relics": "materials|relic",
  "artefacts|fragments": "artefacts|fragments",

  // ── resources: detail moved into shopsubcategory2 ────────────────────────
  "crafting|resources|ore": "resources|ore",
  "crafting|resources|wood": "resources|wood",
  "crafting|resources|fiber": "resources|fiber",
  "crafting|resources|hide": "resources|hide",
  "crafting|resources|rock": "resources|rock",
  "crafting|refinedresources|metalbars": "refinedresources|metalbar",
  "crafting|refinedresources|planks": "refinedresources|planks",
  "crafting|refinedresources|cloth": "refinedresources|cloth",
  "crafting|refinedresources|leather": "refinedresources|leather",
  "crafting|refinedresources|stoneblock": "refinedresources|stoneblock",
  "crafting|cityresources|beastheart": "cityresources|beastheart",
  "crafting|cityresources|blackheart": "cityresources|blackheart",
  "crafting|cityresources|mountainheart": "cityresources|mountainheart",
  "crafting|cityresources|rockheart": "cityresources|rockheart",
  "crafting|cityresources|treeheart": "cityresources|treeheart",
  "crafting|cityresources|vineheart": "cityresources|vineheart",
  "crafting|fish": "consumables|fish",
  "crafting|alchemy|essence": "materials|essence",
  "crafting|alchemy|extract": "materials|other",
  "crafting|alchemy": "crafting|alchemy",
  "crafting|tokens|royalsigils": "token|royalsigils",
  "crafting|tokens": "crafting|tokens",

  // ── consumables ──────────────────────────────────────────────────────────
  "consumables|food": "consumables|cooked",
  "consumables|potions": "consumables|potion",
  "consumables|tomes|fiber": "skillbooks|skillbook_fiber",
  "consumables|tomes|hide": "skillbooks|skillbook_hide",
  "consumables|tomes|ore": "skillbooks|skillbook_ore",
  "consumables|tomes|rock": "skillbooks|skillbook_rock",
  "consumables|tomes|wood": "skillbooks|skillbook_wood",
  "consumables|tomes": "skillbooks|skillbook",
  "consumables|other|firework": "consumables|vanity",
  "consumables|other": "consumables|other",
  "consumables|silverbag": "consumables|other",
  "consumables|vanity": "consumables|vanity",

  // ── gatherer gear + tools: one dump category per profession ──────────────
  "gathering|ore|picks": "tools|pickaxe",
  "gathering|wood|axes": "tools|woodaxe",
  "gathering|hide|knifes": "tools|skinningknife",
  "gathering|rock|hammer": "tools|stonehammer",
  "gathering|fiber|sickle": "tools|sickle",
  "gathering|fish|fishingrods": "tools|fishing",
  "gathering|tracking|toolkit": "tools|tracking",
  "gathering|fish|bait": "consumables|fishingbait",
  "gathering|ore|gathering_armor": "gatherergear|oregatherer_armor",
  "gathering|ore|gathering_head": "gatherergear|oregatherer_helmet",
  "gathering|ore|gathering_shoes": "gatherergear|oregatherer_shoes",
  "gathering|ore|gathering_capes": "gatherergear|oregatherer_backpack",
  "gathering|wood|gathering_armor": "gatherergear|woodgatherer_armor",
  "gathering|wood|gathering_head": "gatherergear|woodgatherer_helmet",
  "gathering|wood|gathering_shoes": "gatherergear|woodgatherer_shoes",
  "gathering|wood|gathering_capes": "gatherergear|woodgatherer_backpack",
  "gathering|fiber|gathering_armor": "gatherergear|fibergatherer_armor",
  "gathering|fiber|gathering_head": "gatherergear|fibergatherer_helmet",
  "gathering|fiber|gathering_shoes": "gatherergear|fibergatherer_shoes",
  "gathering|fiber|gathering_capes": "gatherergear|fibergatherer_backpack",
  "gathering|hide|gathering_armor": "gatherergear|hidegatherer_armor",
  "gathering|hide|gathering_head": "gatherergear|hidegatherer_helmet",
  "gathering|hide|gathering_shoes": "gatherergear|hidegatherer_shoes",
  "gathering|hide|gathering_capes": "gatherergear|hidegatherer_backpack",
  "gathering|rock|gathering_armor": "gatherergear|rockgatherer_armor",
  "gathering|rock|gathering_head": "gatherergear|rockgatherer_helmet",
  "gathering|rock|gathering_shoes": "gatherergear|rockgatherer_shoes",
  "gathering|rock|gathering_capes": "gatherergear|rockgatherer_backpack",
  "gathering|fish|gathering_armor": "gatherergear|fishgatherer_armor",
  "gathering|fish|gathering_head": "gatherergear|fishgatherer_helmet",
  "gathering|fish|gathering_shoes": "gatherergear|fishgatherer_shoes",
  "gathering|fish|gathering_capes": "gatherergear|fishgatherer_backpack",

  // ── farming: seeds/plants/animals split across four dump buckets ─────────
  "farming|farm|seeds": "farming|seed",
  "farming|herbgarden|seeds": "farming|seed",
  "farming|farm|plants": "products|farming",
  "farming|herbgarden|herbs": "products|farming",
  "farming|farmingproducts": "products|farming",
  "farming|pasture|egg": "products|farming",
  "farming|pasture|milk": "products|farming",
  "farming|pasture": "farming|animals",
  "farming|kennel": "farming|kennel",

  // ── mounts ───────────────────────────────────────────────────────────────
  "mounts|basemounts|horse": "mounts|ridinghorse",
  "mounts|basemounts|armoredhorse": "mounts|armoredhorse",
  "mounts|basemounts|ox": "mounts|ox",
  "mounts|basemounts|donkey": "mounts|mule",
  "mounts|basemounts|cougar": "mounts|cougar",
  "mounts|basemounts|direbear": "mounts|direbear",
  "mounts|basemounts|direboar": "mounts|direboar",
  "mounts|basemounts|direwolf": "mounts|direwolf",
  "mounts|basemounts|swampdragon": "mounts|swampdragon",
  "mounts|basemounts|stag": "mounts|giantstag",
  "mounts|basemounts": "mounts|rare_mount", // mammoth / moabird / ram
  "mounts|battle_mount": "mounts|battle_mount",
  "mounts|raremounts": "mounts|rare_mount",

  // ── furniture ────────────────────────────────────────────────────────────
  "furniture|chest": "furniture|chest",
  "furniture|repairkit": "furniture|repairkit",
  "furniture|wardrobe": "furniture|wardrobe",
  "furniture|world|banner": "furniture|banner",
  furniture: "furniture|decoration_furniture",

  // ── laborers, journals, trophies (all under other|labourers now) ─────────
  "other|labourers|beds": "furniture|bed",
  "other|labourers|tables": "furniture|table",
  "other|labourers|journals": "products|journal",
  "other|labourers|contracts|fiber": "labourers|fibercontract",
  "other|labourers|contracts|fish": "labourers|fishingcontract",
  "other|labourers|contracts|hide": "labourers|hidecontract",
  "other|labourers|contracts|hunter": "labourers|huntercontract",
  "other|labourers|contracts|mage": "labourers|magecontract",
  "other|labourers|contracts|mercenary": "labourers|mercenarycontract",
  "other|labourers|contracts|ore": "labourers|orecontract",
  "other|labourers|contracts|stone": "labourers|stonecontract",
  "other|labourers|contracts|toolmaker": "labourers|toolmakercontract",
  "other|labourers|contracts|warrior": "labourers|warriorcontract",
  "other|labourers|contracts|wood": "labourers|woodcontract",
  "other|labourers|trophies|fiber": "trophies|fibertrophy",
  "other|labourers|trophies|fish": "trophies|fishtrophy",
  "other|labourers|trophies|general": "trophies|generaltrophy",
  "other|labourers|trophies|hide": "trophies|hidetrophy",
  "other|labourers|trophies|mercenary": "trophies|mercenarytrophy",
  "other|labourers|trophies|ore": "trophies|oretrophy",
  "other|labourers|trophies|rock": "trophies|rocktrophy",
  "other|labourers|trophies|wood": "trophies|woodtrophy",
  // sub3="other": the Trophy Shark and the Founder's Looking Glass. Both are
  // labourersaffected="all" — general trophies, not a line of their own.
  "other|labourers|trophies": "trophies|generaltrophy",

  // ── everything else the dump files under "other" ─────────────────────────
  "other|luxurygoods|any": "luxurygoods|any",
  "other|luxurygoods|bridgewatch": "luxurygoods|bridgewatch",
  "other|luxurygoods|caerleon": "luxurygoods|caerleon",
  "other|luxurygoods|fortsterling": "luxurygoods|fortsterling",
  "other|luxurygoods|lymhurst": "luxurygoods|lymhurst",
  "other|luxurygoods|martlock": "luxurygoods|martlock",
  "other|luxurygoods|thetford": "luxurygoods|thetford",
  "other|maps": "consumables|maps",
  "other|hardcoreexpeditions": "token|event",
  "other|questitems": "other|mission",
  "other|tokens|crystalleague": "token|crystalleague",
  "other|tokens": "token|other",
  "other|guilds|siegehammer": "tools|demolitionhammer",
  "other|guilds|siegebanners": "furniture|banner",
  "other|guilds": "other|other",
  "other|killtrophy": "other|other",
  "other|lootitem": "other|other",
  "other|trash": "other|trash",
  "token|other": "token|other",

  // ── vanity: skins the Skins Trading table sells ──────────────────────────
  "vanity|killemotes": "consumables|kill_emotes",
  "vanity|armors": "vanity|armor",
  "vanity|capes": "vanity|cape",
  "vanity|head": "vanity|head",
  "vanity|shoes": "vanity|shoes",
  "vanity|offhands": "vanity|offhand",
  "vanity|weapons": "vanity|weapon",
  "vanity|mounts": "vanity|mount",
  "vanity|avatar": "vanity|avatar",
  "vanity|avatarring": "vanity|avatar_ring",
};

// artefacts|weapons holds the Crystal weapon artifacts, whose proper home
// depends on the weapon line: ARTEFACT_2H_BOW_CRYSTAL is a ranged artifact,
// ARTEFACT_2H_HAMMER_CRYSTAL a melee one. Drop the ARTEFACT_ prefix and reuse
// the (already folded) category of the weapon the artifact builds.
const ARTIFACT_LINE_SUB = {
  melee: "melee_artefact",
  magic: "magic_artefact",
  ranged: "ranged_artefact",
  offhand: "offhand_artefact",
  armor: "armor_artefact",
};

// In-game category names.
const CATEGORY_LABELS = {
  accessories: "Accessories",
  armor: "Armor",
  artefacts: "Artifacts",
  capes: "Capes",
  cityresources: "City Resources",
  consumables: "Consumables",
  crafting: "Crafting",
  farmables: "Farming",
  farming: "Farming",
  furniture: "Furniture",
  gatherergear: "Gatherer Gear",
  labourers: "Laborers",
  luxurygoods: "Luxury Goods",
  magic: "Magic",
  materials: "Materials",
  melee: "Melee",
  mounts: "Mounts",
  offhand: "Off-hand",
  offhands: "Off-hand",
  other: "Other",
  products: "Products",
  ranged: "Ranged",
  refinedresources: "Refined Resources",
  resources: "Resources",
  skillbooks: "Skill Books",
  token: "Tokens",
  tools: "Tools",
  trophies: "Trophies",
  vanity: "Vanity",
  weapons: "Weapons",
};

// Order the picker lists categories in. Anything unlisted trails alphabetically.
const CATEGORY_ORDER = [
  "resources", "refinedresources", "products", "materials", "cityresources",
  "melee", "magic", "ranged", "offhand", "armor", "capes", "accessories",
  "artefacts", "gatherergear", "tools", "consumables", "farming",
  "mounts", "furniture", "labourers", "luxurygoods", "trophies",
  "skillbooks", "token", "crafting", "vanity", "weapons", "other",
];

// Subcategory names the generic humanizer gets wrong — the run-together weapon
// lines and the few in-game names that differ from the raw key.
const SUBCATEGORY_LABELS = {
  arcanestaff: "Arcane Staff",
  cursestaff: "Curse Staff",
  firestaff: "Fire Staff",
  froststaff: "Frost Staff",
  holystaff: "Holy Staff",
  naturestaff: "Nature Staff",
  shapeshifterstaff: "Shapeshifter Staff",
  quarterstaff: "Quarterstaff",
  knuckles: "War Gloves",
  woodaxe: "Wood Axe",
  stonehammer: "Stone Hammer",
  demolitionhammer: "Demolition Hammer",
  skinningknife: "Skinning Knife",
  fishingrod: "Fishing Rod",
  metalbar: "Metal Bar",
  stoneblock: "Stone Block",
  planks: "Planks",
  crystalleague: "Crystal League",
  offhands: "Off-hand",
  offhand: "Off-hand",
};

/** "plate_armor" → "Plate Armor"; overrides win. */
function humanize(key) {
  if (SUBCATEGORY_LABELS[key]) return SUBCATEGORY_LABELS[key];
  return String(key)
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Fold a game id to the base id the map is keyed by. */
function baseId(id) {
  return String(id)
    .replace(/^T[1-8]_/, "")
    .replace(/@\d+$/, "")
    .replace(/_LEVEL\d+$/, "");
}

const xml = fs.readFileSync(SRC, "utf8");

// Every element that names an item AND carries a shop category. A single regex
// over the raw text beats an XML parse here: items.xml is 40 MB of a dozen
// different element names that all share these three attributes.
const ELEMENT_RE = /<[a-zA-Z0-9_]+\b[^>]*\buniquename="([^"]+)"[^>]*>/g;
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}="([^"]+)"`));
  return m ? m[1] : null;
};

// base id → "category|subcategory" (subcategory may be empty).
const byBase = new Map();
let seen = 0;

let m;
// Most specific FOLD rule wins: sub3 → sub2 → sub1 → category. Unmatched buckets
// pass through as "category|sub1", so a family the dump adds later still shows up
// in the picker (under its raw spelling) instead of silently vanishing.
function fold(cat, s1, s2, s3) {
  const keys = [];
  if (s3) keys.push(`${cat}|${s1}|${s2}|${s3}`);
  if (s2) keys.push(`${cat}|${s1}|${s2}`);
  if (s1) keys.push(`${cat}|${s1}`);
  keys.push(cat);
  for (const k of keys) if (FOLD[k]) return FOLD[k];
  return s1 ? `${cat}|${s1}` : cat;
}

while ((m = ELEMENT_RE.exec(xml))) {
  const raw = attr(m[0], "shopcategory");
  if (!raw) continue;
  const cat = CATEGORY_ALIASES[raw] || raw;
  const base = baseId(m[1]);
  if (!base) continue;
  seen++;
  // First writer wins: base ids are visited in tier order and every tier of an
  // item shares its category, so any later disagreement is noise.
  if (byBase.has(base)) continue;
  byBase.set(
    base,
    fold(
      cat,
      attr(m[0], "shopsubcategory1") || "",
      attr(m[0], "shopsubcategory2") || "",
      attr(m[0], "shopsubcategory3") || "",
    ),
  );
}

// Second pass, after every weapon has its folded category: send each Crystal
// weapon artifact to the *_artefact subcategory of the line it builds. An
// artifact whose weapon isn't in the map (none today) keeps its raw bucket
// rather than guessing.
let artifactsMoved = 0;
for (const [base, packed] of byBase) {
  if (packed !== "artefacts|weapons") continue;
  const weapon = byBase.get(base.replace(/^ARTEFACT_/, ""));
  const line = weapon ? weapon.split("|")[0] : null;
  const sub = line ? ARTIFACT_LINE_SUB[line] : null;
  if (!sub) continue;
  byBase.set(base, `artefacts|${sub}`);
  artifactsMoved++;
}

// The tree is derived from the FINAL bucket of every item, never from the raw
// attributes — otherwise a spelling that RECATEGORIZE emptied would still be
// offered in the picker and match nothing.
const tree = new Map();
for (const packed of byBase.values()) {
  const i = packed.indexOf("|");
  const cat = i < 0 ? packed : packed.slice(0, i);
  if (!tree.has(cat)) tree.set(cat, new Set());
  if (i >= 0) tree.get(cat).add(packed.slice(i + 1));
}

// The picker's category order, then whatever items.xml added that we don't rank.
const cats = Array.from(tree.keys()).sort((a, b) => {
  const ia = CATEGORY_ORDER.indexOf(a);
  const ib = CATEGORY_ORDER.indexOf(b);
  if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  return a.localeCompare(b);
});

const categories = cats.map((key) => ({
  key,
  label: CATEGORY_LABELS[key] || humanize(key),
  subs: Array.from(tree.get(key))
    .sort()
    .map((s) => ({ key: s, label: humanize(s) })),
}));

const body = `// AUTO-GENERATED by scripts/gen-item-categories.cjs from items.xml — do not edit by hand.
// In-game Marketplace taxonomy: Category ▸ Subcategory, keyed by BASE item id
// (tier prefix, _LEVELn and @n stripped — every variant shares its category).
// Re-run after an items.xml refresh.
const MARKET_CATEGORY_TREE = ${JSON.stringify(categories)};
const MARKET_CATEGORY_BY_BASE = ${JSON.stringify(Object.fromEntries(byBase))};
`;

fs.writeFileSync(OUT, body + fs.readFileSync(path.join(__dirname, "item-categories-footer.js"), "utf8"), "utf8");
console.log(
  `wrote ${path.relative(ROOT, OUT)}: ${byBase.size} base ids from ${seen} elements, ` +
    `${categories.length} categories (${artifactsMoved} Crystal artifacts routed by weapon line)`,
);
