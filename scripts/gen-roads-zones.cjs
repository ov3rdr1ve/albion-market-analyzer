/**
 * Regenerate js/data-roads-zones.js — the zone catalog behind the Roads map.
 *
 * TWO SOURCES, joined on the display name:
 *
 *  1. ao-bin-dumps `cluster/world.xml` (13 MB) — the authoritative list of every
 *     cluster: `id="TNL-022" displayname="…" type="TUNNEL_ROYAL"`. The id is
 *     what the game itself reports on the wire (the Join operation response
 *     carries `TNL-022` in parameter 8, verified live 2026-07-25), so the id —
 *     not a slug — is this catalog's primary key. It also supplies the zones the
 *     mapper JSON omits entirely, cities included.
 *
 *  2. https://albionroadsmapper.com/avalon-roads-info.json (817 entries) — the
 *     player-facing detail world.xml has no notion of: tier, chest spawns,
 *     gatherable resources, dungeon/hireling markers.
 *
 * Neither source knows which zone connects to which. Portal edges are
 * per-account discovery, expire in 12-24h (tunnelsystem.xml: lifetimemin 43200 /
 * lifetimemax 86400), and come from the player alone (typed in by hand).
 *
 * `HIRE` / `GROUP` icon semantics are not documented upstream, so their counts
 * are carried through verbatim under `markers` rather than renamed into a
 * meaning this script cannot verify.
 *
 * Usage:
 *   node scripts/gen-roads-zones.cjs                       # fetch both, write the catalog
 *   node scripts/gen-roads-zones.cjs --source raw.json --world world.xml
 *   node scripts/gen-roads-zones.cjs --stdout              # print, write nothing
 */

const fs = require("fs");
const path = require("path");

const SOURCE_URL = "https://albionroadsmapper.com/avalon-roads-info.json";
const WORLD_URL = "https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/cluster/world.xml";

// Cluster types worth carrying: everywhere a player can stand and a portal can
// land. Islands, expeditions, arenas and instanced dungeons are dropped — the
// route planner never has to route through them.
const KEPT_CLUSTER_TYPES = [
  /^TUNNEL_/,        // Roads of Avalon (incl. HIDEOUT / DEEP rests)
  /^OPENPVP_/,       // royal red + outlands black
  /^SAFEAREA$/,      // royal cities
  /^PASSAGE_SAFEAREA$/,
  /^STARTAREA$/,
  /^PLAYERCITY_/,    // Caerleon, Brecilien, Smuggler's Dens
  /^OPENWORLD/,
];

// Normalised zone type, derived from the world.xml cluster type. The mapper
// JSON's colour wins when it has an opinion (it distinguishes blue/yellow).
const CLUSTER_TYPE_TO_ZONE_TYPE = [
  [/^TUNNEL_/, "roads"],
  [/^OPENPVP_BLACK/, "outlands"],
  [/^OPENPVP_RED/, "royalRed"],
  [/^OPENPVP_YELLOW/, "royalYellow"],
  [/^(SAFEAREA|PASSAGE_SAFEAREA|STARTAREA)$/, "city"],
  [/^PLAYERCITY_/, "city"],
];

// Avalonian Rest (roads hideout zone) name prefixes, minus two known
// non-hideouts that share them.
const REST_PREFIXES = new Set(["Qua", "Qii", "Sec", "Set"]);
const NON_REST_EXCEPTIONS = new Set(["Setos-Aiaitum", "Setitos-Obobrom"]);

const COLOR_TO_TYPE = {
  blue: "royalBlue",
  yellow: "royalYellow",
  red: "royalRed",
  black: "outlands",
};

// Chest icons. Upstream uses GOLD in 99 zones and YELLOW in 3 for the same
// chest, so they fold together.
const CHEST_ALTS = { GREEN: "green", BLUE: "blue", GOLD: "gold", YELLOW: "gold" };

// Resource icons. STONE/ROCK and COTTON/FIBER and HIDE/LEATHER are upstream
// spelling drift for one resource each.
const RESOURCE_ALTS = {
  ROCK: "rock", STONE: "rock",
  LOGS: "logs",
  ORE: "ore",
  COTTON: "fiber", FIBER: "fiber",
  HIDE: "hide", LEATHER: "hide",
};

const MARKER_ALTS = { DUNGEON: "dungeon", HIRE: "hire", GROUP: "group" };

// Biome, read from the world.xml `file` attribute. The biome is the first
// token naming one, scanning after the "kind" token (RDS/WRL/CTY):
//   TNL-001_RDS_RO_AUTO_T4_AVA_AVA.cluster.xml → avalon (tunnels carry it
//     after the tier token; all 400 TUNNEL_* clusters are AVA)
//   0208_WRL_SW_AUTO_T6_MOR_ROY.cluster.xml    → swamp (right after WRL)
//   1000_CTY_FR_AUTO_T1_NON.cluster.xml        → forest (cities carry it too)
// The after-tier token on open-world files (MOR/UND/KPR/HER) is a POI theme,
// NOT a biome. Codes with no biome meaning (RO, MI mist, HE hellgate, NON)
// and files world.xml names nothing for decode to null. Verified against
// ao-bin-dumps 2026-09-14: 400/400 tunnels avalon, scan rule == token-3 rule
// on every WRL/CTY cluster.
const BIOME_CODES = {
  FR: "forest", SW: "swamp", ST: "steppe", MN: "mountain", HL: "highlands", AVA: "avalon",
};

function biomeFromFileName(file) {
  const tokens = String(file || "").replace(/\.cluster\.xml$/, "").split("_");
  for (let i = 2; i < tokens.length; i++) {
    const biome = BIOME_CODES[tokens[i]];
    if (biome) return biome;
  }
  return null;
}

function slugify(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isRestName(name) {
  if (NON_REST_EXCEPTIONS.has(name)) return false;
  return REST_PREFIXES.has(name.slice(0, 3));
}

/**
 * Parse the `<cluster …>` tags out of world.xml. Pure string work — no XML dep.
 *
 * Besides the attributes the catalog needs, each record carries the three
 * fields the overland map is built from (scripts/gen-roads-overland.cjs):
 *   - `worldmapposition` — "x y" on the world map, absent on tunnels and on a
 *     handful of hideout/den clusters.
 *   - `exits` — the `targetid` of every `<exit targettype="Cluster">` in the
 *     body, i.e. "GUID@CLUSTERID". Tunnels carry `<exits />` and yield none.
 *   - `travel` — the city travel network: every `<connection>` under a
 *     `<travelpoint>`, with its fee modifier and whether luggage may come.
 */
function parseWorldClusters(xml) {
  if (typeof xml !== "string") return [];
  const attr = (tag, name) => {
    const m = tag.match(new RegExp(`${name}="([^"]*)"`));
    return m ? m[1] : "";
  };
  const out = [];
  for (const match of xml.matchAll(/<cluster\b([^>]*?)(\/?)>/g)) {
    const tag = match[1];
    const id = attr(tag, "id");
    const displayname = attr(tag, "displayname");
    const type = attr(tag, "type");
    if (!id || !displayname) continue;
    if (!KEPT_CLUSTER_TYPES.some((re) => re.test(type))) continue;
    const body = match[2] ? "" : clusterBody(xml, match.index + match[0].length);
    out.push({
      id,
      displayname,
      type,
      enabled: attr(tag, "enabled") !== "false",
      biome: biomeFromFileName(attr(tag, "file")),
      worldmapposition: attr(tag, "worldmapposition"),
      exits: clusterExits(body),
      travel: clusterTravel(body),
    });
  }
  return out;
}

/**
 * The cluster body starting at `start`. It ends at whichever comes first, its
 * own `</cluster>` or the next `<cluster` — a self-closing tag would otherwise
 * swallow the following cluster's contents.
 */
function clusterBody(xml, start) {
  const close = xml.indexOf("</cluster>", start);
  const next = xml.indexOf("<cluster", start);
  let end = close === -1 ? xml.length : close;
  if (next !== -1 && next < end) end = next;
  return xml.slice(start, end);
}

/** `targetid`s of the body's cluster exits. Dungeon targets carry another
 * targettype and are skipped. */
function clusterExits(body) {
  const out = [];
  for (const m of body.matchAll(/<exit\b([^>]*)>/g)) {
    if (!/targettype="Cluster"/.test(m[1])) continue;
    const target = m[1].match(/targetid="([^"]*)"/);
    if (target && target[1]) out.push(target[1]);
  }
  return out;
}

/**
 * The city travel network: `<travelpoint><connections><connection to="GUID@ID"
 * costmodifier="N" noluggage="…">`. Symmetric in the source — every pair is
 * listed from both ends — and the fee modifier is what the game charges on top
 * of weight, not a silver amount.
 */
function clusterTravel(body) {
  const out = [];
  for (const m of body.matchAll(/<connection\b([^>]*)>/g)) {
    const tag = m[1];
    const to = (tag.match(/\bto="([^"]*)"/) || [])[1];
    if (!to) continue;
    out.push({
      to,
      costmodifier: Number((tag.match(/costmodifier="([^"]*)"/) || [])[1]) || 0,
      noLuggage: /noluggage="true"/.test(tag),
    });
  }
  return out;
}

function zoneTypeFromCluster(clusterType) {
  const hit = CLUSTER_TYPE_TO_ZONE_TYPE.find(([re]) => re.test(clusterType));
  return hit ? hit[1] : "other";
}

/**
 * Sources → catalog rows. Pure: no fetch, no fs, deterministic.
 *
 * @param {Array}  raw             albionroadsmapper entries (tier/icons/colour)
 * @param {Array} [worldClusters]  parseWorldClusters output (id/displayname/type)
 */
function buildZones(raw, worldClusters = []) {
  if (!Array.isArray(raw)) raw = [];
  if (!Array.isArray(worldClusters)) worldClusters = [];

  // Cluster ids by display name — the join key between the two sources.
  const clusterByName = new Map();
  for (const cluster of worldClusters) {
    const key = cluster.displayname.trim().toLowerCase();
    if (!clusterByName.has(key)) clusterByName.set(key, cluster);
  }
  const usedClusters = new Set();

  const rows = [];
  for (const entry of raw) {
    if (!entry || typeof entry.name !== "string" || !entry.name.trim()) continue;

    const tier = Number(entry.tier);
    if (!Number.isFinite(tier)) continue;

    const name = entry.name.trim();
    const color = typeof entry.color === "string" ? entry.color.toLowerCase() : "";
    // Roads zones are the ones upstream leaves uncolored. The hyphen pattern is
    // a weaker signal — royal zones can carry hyphens too.
    const type = color ? COLOR_TO_TYPE[color] || "other" : "roads";
    const isRoads = type === "roads";

    const chests = {};
    const resources = new Set();
    const markers = {};
    for (const icon of Array.isArray(entry.icons) ? entry.icons : []) {
      const alt = icon && typeof icon.alt === "string" ? icon.alt.toUpperCase() : "";
      const count = Number(icon && icon.badge) > 0 ? Number(icon.badge) : 1;
      if (CHEST_ALTS[alt]) {
        chests[CHEST_ALTS[alt]] = (chests[CHEST_ALTS[alt]] || 0) + count;
      } else if (RESOURCE_ALTS[alt]) {
        resources.add(RESOURCE_ALTS[alt]);
      } else if (MARKER_ALTS[alt]) {
        markers[MARKER_ALTS[alt]] = (markers[MARKER_ALTS[alt]] || 0) + count;
      }
    }

    const cluster = clusterByName.get(name.toLowerCase()) || null;
    if (cluster) usedClusters.add(cluster.id);

    rows.push({
      // The cluster id is what the game reports on the wire, so it is the key
      // whenever world.xml knows this zone; the slug is the fallback.
      id: cluster ? cluster.id : slugify(name),
      slug: slugify(name),
      name,
      tier,
      type,
      chests,
      resources: [...resources].sort(),
      markers,
      isRest: isRoads && isRestName(name),
      depth: isRoads ? name.split("-").length : null,
      // The raw TUNNEL_*/SAFEAREA/... cluster type. For roads zones this is the
      // only place TUNNEL_DEEP vs TUNNEL_DEEP_RAID survives — the split that
      // decides whether the static Brecilien portal exists (js/data-roads-brecilien.js).
      worldType: cluster ? cluster.type : "",
      // forest/swamp/steppe/mountain/highlands/avalon, or null when world.xml
      // does not know the zone or its file names no known biome.
      biome: cluster ? cluster.biome || null : null,
    });
  }

  // Zones world.xml knows and the mapper JSON never listed — cities above all,
  // which matter because a route starts and ends in whatever cluster you pick.
  for (const cluster of worldClusters) {
    if (usedClusters.has(cluster.id)) continue;
    const name = cluster.displayname.trim();
    const type = zoneTypeFromCluster(cluster.type);
    const isRoads = type === "roads";
    rows.push({
      id: cluster.id,
      slug: slugify(name),
      name,
      tier: 0, // world.xml carries no tier; the mapper JSON is the only source
      type,
      chests: {},
      resources: [],
      markers: {},
      isRest: isRoads && isRestName(name),
      depth: isRoads ? name.split("-").length : null,
      worldType: cluster.type,
      biome: cluster.biome || null,
    });
  }

  // Duplicate slugs (same zone name at two tiers) get a tier suffix, keeping the
  // first occurrence stable.
  const seen = new Set();
  for (const row of rows) {
    if (!seen.has(row.id)) { seen.add(row.id); continue; }
    let candidate = `${row.id}-t${row.tier}`;
    let n = 2;
    while (seen.has(candidate)) candidate = `${row.id}-t${row.tier}-${n++}`;
    row.id = candidate;
    seen.add(candidate);
  }

  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return rows;
}

// ── packed encoding ────────────────────────────────────────────────────────
//
// 817 zones as one object literal per line blows past the 800-line file cap, so
// each zone is packed into a short pipe-delimited record and several records
// share a physical line. `decodeRoadsZones` is embedded verbatim into the
// generated file (via Function.prototype.toString) so encoder and decoder can
// never drift apart.

const TYPE_CODES = ["roads", "royalBlue", "royalYellow", "royalRed", "outlands", "other", "city"];
const CHEST_ORDER = ["green", "blue", "gold"];
const MARKER_ORDER = ["dungeon", "hire", "group"];
const RESOURCE_CODES = { rock: "r", logs: "l", ore: "o", fiber: "f", hide: "h" };
const BIOME_TO_CODE = { forest: "FR", swamp: "SW", steppe: "ST", mountain: "MN", highlands: "HL", avalon: "AVA" };

function encodeZone(z) {
  const chests = CHEST_ORDER.map((k) => z.chests[k] || 0).join("");
  const markers = MARKER_ORDER.map((k) => z.markers[k] || 0).join("");
  const resources = z.resources.map((r) => RESOURCE_CODES[r] || "").join("");
  // The slug is always recomputed from the name at decode time, never stored.
  return [z.id, z.name, z.tier, TYPE_CODES.indexOf(z.type), chests, resources, markers,
    z.isRest ? 1 : 0, z.depth === null ? "" : z.depth, z.worldType || "",
    BIOME_TO_CODE[z.biome] || ""].join("|");
}

function decodeRoadsZones(records) {
  const TYPES = ["roads", "royalBlue", "royalYellow", "royalRed", "outlands", "other", "city"];
  const CHESTS = ["green", "blue", "gold"];
  const MARKERS = ["dungeon", "hire", "group"];
  const RESOURCES = { r: "rock", l: "logs", o: "ore", f: "fiber", h: "hide" };
  const BIOMES = { FR: "forest", SW: "swamp", ST: "steppe", MN: "mountain", HL: "highlands", AVA: "avalon" };
  const toSlug = (s) => s.trim().toLowerCase().replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  return records.map((record) => {
    // worldType is field 10 and biome field 11; records predating either
    // decode to "" / null.
    const [id, name, tier, typeIdx, chestCode, resCode, markerCode, rest, depth, worldType, biomeCode] = record.split("|");
    const chests = {};
    CHESTS.forEach((key, i) => { const n = Number(chestCode[i] || 0); if (n) chests[key] = n; });
    const markers = {};
    MARKERS.forEach((key, i) => { const n = Number(markerCode[i] || 0); if (n) markers[key] = n; });
    return {
      id,
      slug: toSlug(name),
      name,
      tier: Number(tier),
      type: TYPES[Number(typeIdx)],
      chests,
      resources: [...resCode].map((c) => RESOURCES[c]).filter(Boolean),
      markers,
      isRest: rest === "1",
      depth: depth === "" ? null : Number(depth),
      worldType: worldType || "",
      biome: BIOMES[biomeCode] || null,
    };
  });
}

/** Greedily wrap encoded records so no source line runs past `width` chars. */
function packLines(records, width = 150) {
  const lines = [];
  let current = "";
  for (const record of records) {
    const chunk = `${JSON.stringify(record)},`;
    if (current && current.length + chunk.length + 1 > width) { lines.push(current); current = ""; }
    current = current ? `${current} ${chunk}` : chunk;
  }
  if (current) lines.push(current);
  return lines;
}

// ── CLI ────────────────────────────────────────────────────────────────────

function serialize(zones) {
  const counts = zones.reduce((acc, z) => ((acc[z.type] = (acc[z.type] || 0) + 1), acc), {});
  const summary = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");

  return `/**
 * Roads of Avalon zone catalog — GENERATED, do not hand-edit.
 *
 * Source: ${SOURCE_URL}
 * Regenerate: node scripts/gen-roads-zones.cjs
 * Generated: ${new Date().toISOString().slice(0, 10)} — ${zones.length} zones (${summary}).
 *
 * Zones are static; the PORTALS between them are not. Edges live in
 * js/data-roads-portals.js and are discovered locally, never fetched.
 *
 * Records are packed as
 *   id|name|tier|typeIndex|chestCounts|resourceCodes|markerCounts|isRest|depth|worldType|biomeCode
 * with biomeCode one of FR/SW/ST/MN/HL/AVA (empty when the zone has no known
 * biome) and an empty name meaning "title-case the id". Decoded once on load.
 */

const ROADS_ZONE_RECORDS = [
${packLines(zones.map(encodeZone)).map((line) => `  ${line}`).join("\n")}
];

const decodeRoadsZones = ${decodeRoadsZones.toString()};

const ROADS_ZONES = decodeRoadsZones(ROADS_ZONE_RECORDS);

const ROADS_ZONE_BY_ID = new Map(ROADS_ZONES.map((z) => [z.id, z]));

// 74 names are shared by several clusters — every city repeats its Antiquarian's
// Den and Conquerors' Halls, and Brecilien names two of its own zones after
// itself. Records are sorted by id, so keeping the FIRST wins the canonical one
// (Brecilien is 5000, the city with the travel network, not 5001 next door).
const ROADS_ZONE_BY_NAME = new Map();
for (const zone of ROADS_ZONES) {
  const key = zone.name.toLowerCase();
  if (!ROADS_ZONE_BY_NAME.has(key)) ROADS_ZONE_BY_NAME.set(key, zone);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { ROADS_ZONES, ROADS_ZONE_BY_ID, ROADS_ZONE_BY_NAME, ROADS_ZONE_RECORDS };
}
`;
}

async function main() {
  const args = process.argv.slice(2);
  const sourceIdx = args.indexOf("--source");
  const worldIdx = args.indexOf("--world");
  const toStdout = args.includes("--stdout");

  let raw;
  if (sourceIdx !== -1 && args[sourceIdx + 1]) {
    raw = JSON.parse(fs.readFileSync(args[sourceIdx + 1], "utf8"));
  } else {
    const res = await fetch(SOURCE_URL);
    if (!res.ok) throw new Error(`${SOURCE_URL} → HTTP ${res.status}`);
    raw = await res.json();
  }

  // world.xml is ~13 MB; read it as text and regex the cluster tags rather than
  // pulling in an XML parser for six attributes.
  let worldXml;
  if (worldIdx !== -1 && args[worldIdx + 1]) {
    worldXml = fs.readFileSync(args[worldIdx + 1], "utf8");
  } else {
    const res = await fetch(WORLD_URL);
    if (!res.ok) throw new Error(`${WORLD_URL} → HTTP ${res.status}`);
    worldXml = await res.text();
  }
  const clusters = parseWorldClusters(worldXml);
  if (!clusters.length) throw new Error("world.xml parsed to zero clusters — refusing to drop every cluster id");

  const zones = buildZones(raw, clusters);
  if (!zones.length) throw new Error("no zones parsed — refusing to write an empty catalog");

  const out = serialize(zones);
  if (toStdout) {
    process.stdout.write(out);
    return;
  }
  const target = path.join(__dirname, "..", "js", "data-roads-zones.js");
  fs.writeFileSync(target, out);
  const roads = zones.filter((z) => z.type === "roads").length;
  console.log(`wrote ${target}: ${zones.length} zones (${roads} roads, ${zones.filter((z) => z.isRest).length} Rests)`);
}

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = {
  buildZones, slugify, REST_PREFIXES, NON_REST_EXCEPTIONS, SOURCE_URL, WORLD_URL,
  encodeZone, decodeRoadsZones, packLines, serialize, parseWorldClusters, zoneTypeFromCluster,
};
