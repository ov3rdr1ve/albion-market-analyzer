/**
 * Generate js/data-buildings.js from buildings.xml + items.xml (ao-bin-dumps).
 *
 * buildings.xml is the only ground truth for what a building costs to put down:
 * items.xml knows nothing about construction (the one exception, UNIQUE_HIDEOUT,
 * is the deed ITEM, priced differently from the placement). Each building
 * element carries `placecost` (a flat silver fee), an optional
 * `<craftingrequirements silver="…">`, and the `<craftresource>` list that is the
 * real bill of materials. Houses and guild halls additionally carry
 * `furniturelimit` / `laborerslimit`, which is where the "+ laborers & furniture"
 * row gets its slot counts — nothing is hand-authored.
 *
 * The dump mixes real buildings with tutorial copies, NDA test rigs, NPC shop
 * fronts and founder-pack skins. Rather than blacklisting those (a new one would
 * silently appear in the table), FAMILIES below is an allow-list: a building is
 * catalogued only if its family is named here. Anything else is dropped and
 * reported, so a genuinely new station shows up in the run summary instead of
 * disappearing. A family that matches nothing is reported too — TRANSMUTATOR is
 * commented out in the dump, i.e. not a placeable building, which is why the
 * Transmutation Tower is absent here even though the Transmute table exists.
 *
 * The second pass reads items.xml for the furniture that goes IN those slots.
 * Every laborer furniture item states its own rules as attributes, so the
 * furnishing plan is never hand-authored: `labourersperfurnitureitem` (a bed
 * serves 1 laborer, a table 4 at T2-T4 but 6 from T5 up), `labourerhappiness`
 * (bed and table are 50x tier each, i.e. together the 100x-tier base happiness a
 * tier-n laborer needs; trophies are a flat +10 specialist / +5 general at EVERY
 * tier) and `labourersaffected` (which laborer line a trophy helps).
 *
 * Run: node scripts/gen-buildings-catalog.cjs
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const XML_PATH = path.join(ROOT, "data", "dumps", "buildings.xml");
const ITEMS_XML_PATH = path.join(ROOT, "data", "dumps", "items.xml");
const OUT_PATH = path.join(ROOT, "js", "data-buildings.js");

// Allow-list: family key (the uniquename with its T<n>_ / UNIQUE_ prefix
// stripped) → how the table labels and groups it. Labels are the in-game
// building names, which do not always match the internal key
// (CARPENTERSWORKSHOP is the Lumbermill, STABLE is the Saddler, MAGICITEMS is
// the Mage's Tower). Categories drive the table's grouping and decide which
// buildings get a "+ laborers & furniture" row.
const FAMILIES = {
  // ── Crafting & refining stations ──
  FORGE:               { label: "Warrior's Forge",      category: "station" },
  HUNTERSLODGE:        { label: "Hunter's Lodge",       category: "station" },
  MAGICITEMS:          { label: "Mage's Tower",         category: "station" },
  TOOLMAKER:           { label: "Toolmaker",            category: "station" },
  ALCHEMIST:           { label: "Alchemist's Lab",      category: "station" },
  COOK:                { label: "Cook",                 category: "station" },
  MILL:                { label: "Mill",                 category: "station" },
  BUTCHER:             { label: "Butcher",              category: "station" },
  STABLE:              { label: "Saddler",              category: "station" },
  SMELTER:             { label: "Smelter",              category: "station" },
  TANNERY:             { label: "Tannery",              category: "station" },
  WEAVINGMILL:         { label: "Weaver",               category: "station" },
  CARPENTERSWORKSHOP:  { label: "Lumbermill",           category: "station" },
  STONEMASONRY:        { label: "Stonemason",           category: "station" },
  REPAIRSHOP:          { label: "Repair Shop",          category: "station" },
  MELDBUILDING:        { label: "Artifact Foundry",     category: "station" },
  // ── Homes ──
  PLAYERHOUSE:         { label: "House",                category: "house" },
  GUILDHALL:           { label: "Guild Hall",           category: "guildhall" },
  // ── Farming plots ──
  FARMHOUSE:           { label: "Farm",                 category: "farm" },
  HERBGARDEN:          { label: "Herb Garden",          category: "farm" },
  PASTURE:             { label: "Pasture",              category: "farm" },
  KENNEL:              { label: "Kennel",               category: "farm" },
  // ── Hideout ──
  HIDEOUT:             { label: "Hideout",              category: "hideout" },
};

// Element types that can describe a constructible building. Marketplace / bank /
// castle-gate elements carry no <craftingrequirements> and are not placeable.
const ELEMENTS = ["craftbuilding", "playerbuilding", "farmbuilding",
  "hideoutbuilding", "repairbuilding", "meldbuilding"];

// Laborer contract lines — the fitted row buys whichever is cheapest at the
// building's tier unless the user picks a line, so the scan needs all of them.
const CONTRACT_SLUGS = ["WOOD", "STONE", "ORE", "FIBER", "HIDE", "FISHERMAN",
  "WARRIOR", "HUNTER", "MAGE", "TOOLMAKER", "MERCENARY"];

// Trophies whose coverage rule makes them a different optimisation than the
// tier ladder the plan walks. The Trophy Shark serves 10 laborers for +5 and is
// the only CRAFTABLE trophy (see the Laborers table) rather than one rung of a
// T2-T8 line, so including it would have the allocator compare unlike things.
const FURNITURE_ID_EXCLUDE = new Set(["T8_FURNITUREITEM_TROPHY_FISHING_BOSS"]);

function attrOf(attrs, name) {
  const m = attrs.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
}

function parse(xml) {
  const rows = [];
  const skipped = [];
  for (const el of ELEMENTS) {
    const re = new RegExp(`<${el}\\s([^>]*?)(/>|>)`, "g");
    let m;
    while ((m = re.exec(xml))) {
      const attrs = m[1];
      const id = attrOf(attrs, "uniquename");
      if (!id) continue;
      let body = "";
      if (m[2] === ">") {
        const close = xml.indexOf(`</${el}>`, re.lastIndex);
        body = xml.slice(re.lastIndex, close);
      }
      const family = id.replace(/^T\d+_/, "").replace(/^UNIQUE_/, "");
      if (!FAMILIES[family]) { skipped.push(id); continue; }

      const req = body.match(/<craftingrequirements([^>]*)>([\s\S]*?)<\/craftingrequirements>/);
      if (!req) { skipped.push(`${id} (no craftingrequirements)`); continue; }
      const materials = [];
      const reMat = /<craftresource uniquename="([^"]+)"\s*count="(\d+)"/g;
      let r;
      while ((r = reMat.exec(req[2]))) materials.push({ matId: r[1], count: parseInt(r[2], 10) });
      if (!materials.length) { skipped.push(`${id} (empty bill of materials)`); continue; }

      const reqSilver = req[1].match(/silver="(\d+)"/);
      rows.push({
        id,
        family,
        // The dump's `tier` attribute is authoritative and does NOT always match
        // the id: T1_KENNEL is a tier-6 building, T1_PASTURE a tier-3 one.
        tier: parseInt(attrOf(attrs, "tier"), 10),
        silverCost: parseInt(attrOf(attrs, "placecost") || "0", 10)
          + (reqSilver ? parseInt(reqSilver[1], 10) : 0),
        materials,
        laborerSlots: parseInt(attrOf(attrs, "laborerslimit") || "0", 10),
        furnitureSlots: parseInt(attrOf(attrs, "furniturelimit") || "0", 10),
        upgradeableTo: attrOf(attrs, "upgradeableto"),
      });
    }
  }
  return { rows, skipped };
}

// Every <furnitureitem> that declares itself laborer furniture. The presence of
// `labourerfurnituretype` is the whole filter: a chest or a wardrobe carries no
// labourer* attributes at all, which is exactly why they must not fill a laborer
// slot — they are decor, and the old catalog counted them as interchangeable
// with beds.
const skippedFurniture = [];

function parseFurniture(xml) {
  const out = [];
  const re = /<furnitureitem\s([^>]*?)(?:\/>|>)/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = m[1];
    const type = attrOf(attrs, "labourerfurnituretype");
    if (!type) continue;
    const id = attrOf(attrs, "uniquename");
    if (!id || FURNITURE_ID_EXCLUDE.has(id)) continue;
    // Tier-ladder items only. The dump also marks founder-pack vanity as laborer
    // furniture (UNIQUE_FURNITUREITEM_FOUNDER_LOOKINGGLASS is a +5 trophy), but
    // those are account-bound one-offs with no market and no tier ladder to walk,
    // so the plan can neither price them nor buy a second one.
    if (!/^T[1-8]_/.test(id)) { skippedFurniture.push(id); continue; }
    const perItem = parseInt(attrOf(attrs, "labourersperfurnitureitem") || "0", 10);
    const happiness = parseInt(attrOf(attrs, "labourerhappiness") || "0", 10);
    // perItem is the divisor the plan counts slots with — a zero would mean an
    // infinite pile of furniture, so refuse rather than emit it.
    if (!perItem) throw new Error(`${id}: labourersperfurnitureitem missing or zero`);
    out.push({
      id,
      tier: parseInt(attrOf(attrs, "tier"), 10),
      type,
      perItem,
      happiness,
      affected: attrOf(attrs, "labourersaffected") || "all",
    });
  }
  return out;
}

function emitFurniture(furniture) {
  const order = { bed: 0, table: 1, trophy: 2 };
  furniture.sort((a, b) =>
    (order[a.type] ?? 9) - (order[b.type] ?? 9) || a.tier - b.tier || a.id.localeCompare(b.id));
  return furniture.map((f) =>
    `  { id: "${f.id}", tier: ${f.tier}, type: "${f.type}", perItem: ${f.perItem}, ` +
    `happiness: ${f.happiness}, affected: "${f.affected}" },`).join("\n");
}

function emit(rows, furniture) {
  const famKeys = Object.keys(FAMILIES);
  const order = (b) => famKeys.indexOf(b.family) * 100 + b.tier;
  rows.sort((a, b) => order(a) - order(b));

  const famSrc = Object.entries(FAMILIES)
    .map(([k, f]) => `  ${k}: { label: ${JSON.stringify(f.label)}, category: ${JSON.stringify(f.category)} },`)
    .join("\n");

  const rowSrc = rows.map((b) => {
    const mats = b.materials.map((m) => `{ matId: "${m.matId}", count: ${m.count} }`).join(", ");
    return `  { id: "${b.id}", family: "${b.family}", tier: ${b.tier}, silverCost: ${b.silverCost},\n` +
      `    laborerSlots: ${b.laborerSlots}, furnitureSlots: ${b.furnitureSlots}, ` +
      `upgradeableTo: ${b.upgradeableTo ? `"${b.upgradeableTo}"` : "null"},\n` +
      `    materials: [${mats}] },`;
  }).join("\n");

  return `// GENERATED by scripts/gen-buildings-catalog.cjs from buildings.xml + items.xml
// — do not edit.
//
// What it costs to PUT DOWN a building: the silver fee (placecost, plus the
// recipe silver a hideout charges) and the bill of construction materials, read
// straight out of the ao-bin-dumps buildings.xml. \`laborerSlots\` /
// \`furnitureSlots\` are the dump's furniturelimit / laborerslimit, which only
// houses and guild halls carry — they are the slot budget the table's
// "+ laborers & furniture" row has to furnish.
//
// \`tier\` is the dump's own attribute, NOT the id prefix: T1_KENNEL is a tier-6
// building and T1_PASTURE a tier-3 one, so never parse the tier off the id here.
//
// Re-run the generator after refreshing either dump.

const BUILDING_FAMILIES = {
${famSrc}
};

const BUILDINGS = [
${rowSrc}
];

// Laborer contract lines. The fitted row buys the cheapest of them unless the
// user names one in the table's laborer picker.
const BUILDING_CONTRACT_SLUGS = ${JSON.stringify(CONTRACT_SLUGS)};

// The furniture that can fill a laborer slot, with the rules items.xml states
// for it. A slot is NOT generic: \`type\` says what the item is, \`perItem\` how
// many laborers one of them serves (bed 1, table 4 below T5 and 6 from T5 up,
// trophy 3), \`happiness\` what it contributes and \`affected\` which laborer line
// a trophy helps ("all" for beds, tables and General Trophies).
//
// A bed and a table of tier n contribute 50n each, i.e. exactly the 100n base
// happiness a tier-n laborer wants — they are mandatory and sufficient for the
// base. Trophy happiness is FLAT per tier (+10 specialist, +5 general) and only
// stacks across DISTINCT items, which is why the plan buys one of each tier
// rather than a pile of the same one, and why it is free to shop the cheapest
// tiers. js/buildings-furnishing.js does the allocating.
const BUILDING_LABORER_FURNITURE = [
${emitFurniture(furniture)}
];

/** The laborer furniture of one \`type\`, optionally pinned to one tier. */
function getBuildingFurnitureByType(type, tier) {
  return BUILDING_LABORER_FURNITURE.filter((f) =>
    f.type === type && (tier === undefined || f.tier === tier));
}

// Every market id this table needs: construction materials, plus — for the
// buildings that have slots — the laborer contracts and the furniture the
// fitted row's plan can buy. Beds and tables are pinned to the building's own
// tier (they set base happiness, so a lower tier would not do), while trophies
// are listed at EVERY tier: a plan only holds trophies up to its own building's
// tier, but T8 buildings exist, so the union across the table is still T2-T8.
function getBuildingsItemIds() {
  const ids = new Set();
  let wantsTrophies = false;
  BUILDINGS.forEach((b) => {
    b.materials.forEach((m) => ids.add(m.matId));
    if (b.laborerSlots > 0) {
      BUILDING_CONTRACT_SLUGS.forEach((s) => ids.add(\`T\${b.tier}_LABOURER_CONTRACT_\${s}\`));
    }
    if (b.furnitureSlots > 0) {
      getBuildingFurnitureByType("bed", b.tier).forEach((f) => ids.add(f.id));
      getBuildingFurnitureByType("table", b.tier).forEach((f) => ids.add(f.id));
      wantsTrophies = true;
    }
  });
  if (wantsTrophies) getBuildingFurnitureByType("trophy").forEach((f) => ids.add(f.id));
  return [...ids];
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    BUILDINGS, BUILDING_FAMILIES, BUILDING_CONTRACT_SLUGS, BUILDING_LABORER_FURNITURE,
    getBuildingFurnitureByType, getBuildingsItemIds,
  };
}
`;
}

// Disabled <skins> blocks are left in the dump as XML comments and reuse
// building uniquenames, so strip comments before parsing or a skin entry can be
// mistaken for the building it names.
const { rows, skipped } = parse(
  fs.readFileSync(XML_PATH, "utf8").replace(/<!--[\s\S]*?-->/g, ""),
);
if (!rows.length) throw new Error("no buildings parsed — has buildings.xml changed shape?");

// Disabled items are commented out in items.xml the same way skins are in
// buildings.xml, so strip comments here too or a retired furniture line
// reappears in the catalog.
const furniture = parseFurniture(
  fs.readFileSync(ITEMS_XML_PATH, "utf8").replace(/<!--[\s\S]*?-->/g, ""),
);
["bed", "table", "trophy"].forEach((t) => {
  if (!furniture.some((f) => f.type === t)) {
    throw new Error(`no "${t}" furniture parsed — has items.xml changed shape?`);
  }
});

fs.writeFileSync(OUT_PATH, emit(rows, furniture), "utf8");

const byCat = {};
rows.forEach((b) => {
  const c = FAMILIES[b.family].category;
  byCat[c] = (byCat[c] || 0) + 1;
});
console.log(`Wrote ${path.relative(ROOT, OUT_PATH)}: ${rows.length} buildings`, byCat);
console.log(`Skipped ${skipped.length} out-of-scope entries (tutorial / test / NPC / no recipe).`);
const byType = {};
furniture.forEach((f) => { byType[f.type] = (byType[f.type] || 0) + 1; });
console.log(`Laborer furniture: ${furniture.length} items`, byType);
if (skippedFurniture.length) {
  console.log(`Skipped ${skippedFurniture.length} non-tier-ladder furniture item(s): ${skippedFurniture.join(", ")}`);
}
const empty = Object.keys(FAMILIES).filter((f) => !rows.some((b) => b.family === f));
if (empty.length) console.log(`WARNING: allow-listed families with no building in the dump: ${empty.join(", ")}`);
