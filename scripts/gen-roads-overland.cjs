/**
 * Regenerate js/data-roads-overland.js — the walkable map behind the hybrid
 * route finder.
 *
 * SOURCE: ao-bin-dumps `cluster/world.xml`, the same 13 MB file the zone catalog
 * is built from. Two attributes carry everything needed:
 *
 *   <cluster id="0347" … worldmapposition="-47.94 197.57">
 *     <exit targetid="GUID@3355" targettype="Cluster" />
 *
 * The bit after the `@` is the neighbouring cluster id, so a zone's exits ARE
 * its foot neighbours. Dungeon and bank targets share the same block under a
 * different `targettype` and are dropped; the Roads carry `<exits />` and gain
 * nothing here — tunnel edges are portals, discovered locally, and expire.
 *
 * The join runs `buildZones` from gen-roads-zones.cjs so ids match the zone
 * catalog exactly, including the `<id>-t<tier>` rename it applies to duplicates.
 *
 * Usage:
 *   node scripts/gen-roads-overland.cjs                      # fetch, write the map
 *   node scripts/gen-roads-overland.cjs --world world.xml    # reuse a local dump
 *   node scripts/gen-roads-overland.cjs --stdout             # print, write nothing
 */

const fs = require("fs");
const path = require("path");
const {
  buildZones, parseWorldClusters, packLines, SOURCE_URL, WORLD_URL,
} = require("./gen-roads-zones.cjs");

// A portal city is the outlands half of a realmgate; its cluster type says so.
const PORTAL_CITY_TYPE_RE = /PORTALCITY/;

// Royal-to-royal travel pairs the dump does NOT list. world.xml gives each royal
// city only its two ring neighbours (Lymhurst: Bridgewatch + Fort Sterling), but
// in game the Travel Planner reaches every royal city directly — verified in the
// client 2026-08-11. Same fee modifier as the pairs the dump does list, luggage
// allowed. Fill-in only: a dump that ever ships one of these keeps its own values.
const ROYAL_TRAVEL_SUPPLEMENT = [
  ["0000", "1000"], // Thetford ↔ Lymhurst
  ["0000", "2000"], // Thetford ↔ Bridgewatch
  ["1000", "3004"], // Lymhurst ↔ Martlock
  ["2000", "4000"], // Bridgewatch ↔ Fort Sterling
  ["3004", "4000"], // Martlock ↔ Fort Sterling
];
const ROYAL_TRAVEL_SUPPLEMENT_COST = 5;

// Zones the Roads never touch, named by one seed cluster each — the whole foot
// component around a seed is taken. Only Brecilien (5000) qualifies: no Roads
// tunnel opens into the Mists, its zones touch nothing else on the overland
// map, and the one way in from the Roads is a white Brecilien portal that
// spawns at random and expires unseen. So the pocket is not part of the Roads
// network at all — a route may not start in it, end in it or cross it.
const OFF_NETWORK_SEEDS = ["5000"];

// ── transform ──────────────────────────────────────────────────────────────

/**
 * Catalog zones + world.xml clusters → the overland map. Pure: no fetch, no fs.
 *
 * @param {Array} zones          buildZones output (the id authority)
 * @param {Array} worldClusters  parseWorldClusters output (exits, travel, positions)
 * @param {object} [options]     `offNetworkSeeds` overrides OFF_NETWORK_SEEDS (tests)
 * @returns {{adjacency: Object, positions: Object, travel: Array, gates: Array,
 *           offNetwork: Array}} keyed by catalog zone id
 */
function buildOverland(zones, worldClusters, options = {}) {
  if (!Array.isArray(zones)) zones = [];
  if (!Array.isArray(worldClusters)) worldClusters = [];

  const zoneById = new Map(zones.map((z) => [z.id, z]));
  // A cluster whose id was taken by another zone lives under `<id>-t<tier>`.
  const renamed = new Map();
  for (const zone of zones) {
    const base = /^(.*)-t\d+(-\d+)?$/.exec(zone.id);
    if (base && !renamed.has(base[1])) renamed.set(base[1], zone.id);
  }
  const zoneIdOf = (clusterId) => {
    if (zoneById.has(clusterId)) return clusterId;
    return renamed.get(clusterId) || null;
  };

  const walkable = new Map(); // cluster id → catalog zone id, foot-traversable only
  for (const cluster of worldClusters) {
    if (cluster.enabled === false) continue;
    const zoneId = zoneIdOf(cluster.id);
    if (!zoneId) continue;
    const zone = zoneById.get(zoneId);
    if (!zone || zone.type === "roads") continue;
    walkable.set(cluster.id, zoneId);
  }

  const adjacency = {};
  const link = (a, b) => {
    if (a === b) return;
    (adjacency[a] = adjacency[a] || new Set()).add(b);
    (adjacency[b] = adjacency[b] || new Set()).add(a);
  };
  for (const cluster of worldClusters) {
    const from = walkable.get(cluster.id);
    if (!from) continue;
    for (const target of Array.isArray(cluster.exits) ? cluster.exits : []) {
      const at = target.indexOf("@");
      if (at === -1) continue;
      const to = walkable.get(target.slice(at + 1));
      if (to) link(from, to);
    }
  }

  const positions = {};
  for (const cluster of worldClusters) {
    const zoneId = walkable.get(cluster.id);
    if (!zoneId || positions[zoneId]) continue;
    const [x, y] = String(cluster.worldmapposition || "").trim().split(/\s+/).map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    positions[zoneId] = { x, y };
  }

  // City travel. Symmetric in the source — every pair is listed from both ends
  // with the same fee modifier — so one record per unordered pair is enough.
  const travelByPair = new Map();
  for (const cluster of worldClusters) {
    const from = walkable.get(cluster.id);
    if (!from) continue;
    for (const connection of Array.isArray(cluster.travel) ? cluster.travel : []) {
      const at = String(connection.to || "").indexOf("@");
      if (at === -1) continue;
      const to = walkable.get(String(connection.to).slice(at + 1));
      if (!to || to === from) continue;
      const [a, b] = from < to ? [from, to] : [to, from];
      const key = `${a}~${b}`;
      if (travelByPair.has(key)) continue;
      travelByPair.set(key, {
        from: a,
        to: b,
        cost: Number(connection.costmodifier) || 0,
        noLuggage: connection.noLuggage === true,
      });
    }
  }

  // The royal ring the dump leaves out. Added only when both cities survived
  // the walkable filter, and never over a pair the dump already described.
  for (const [a, b] of ROYAL_TRAVEL_SUPPLEMENT) {
    const from = walkable.get(a);
    const to = walkable.get(b);
    if (!from || !to || from === to) continue;
    const [lo, hi] = from < to ? [from, to] : [to, from];
    const key = `${lo}~${hi}`;
    if (travelByPair.has(key)) continue;
    travelByPair.set(key, {
      from: lo, to: hi, cost: ROYAL_TRAVEL_SUPPLEMENT_COST, noLuggage: false,
    });
  }

  // Realmgates: the cost-0 link between a portal city and the royal city it
  // belongs to. That crossing is the one the game gates by character binding.
  const gates = [];
  for (const cluster of worldClusters) {
    const portal = walkable.get(cluster.id);
    if (!portal || !PORTAL_CITY_TYPE_RE.test(cluster.type || "")) continue;
    for (const connection of Array.isArray(cluster.travel) ? cluster.travel : []) {
      if (Number(connection.costmodifier) !== 0) continue;
      const at = String(connection.to || "").indexOf("@");
      if (at === -1) continue;
      const royal = walkable.get(String(connection.to).slice(at + 1));
      if (!royal || royal === portal) continue;
      gates.push({ portal, royal });
      break;
    }
  }

  // The off-network pocket: everything foot-reachable from a seed. Derived, not
  // typed out, so a dump that renames or splits a Brecilien zone keeps working.
  const seeds = options.offNetworkSeeds || OFF_NETWORK_SEEDS;
  const pocket = new Set();
  const queue = [];
  for (const seed of seeds) {
    const zoneId = walkable.get(seed);
    if (zoneId && !pocket.has(zoneId)) { pocket.add(zoneId); queue.push(zoneId); }
  }
  while (queue.length) {
    for (const neighbor of adjacency[queue.shift()] || []) {
      if (!pocket.has(neighbor)) { pocket.add(neighbor); queue.push(neighbor); }
    }
  }

  const sorted = {};
  for (const id of Object.keys(adjacency).sort()) sorted[id] = [...adjacency[id]].sort();
  const sortedPos = {};
  for (const id of Object.keys(positions).sort()) sortedPos[id] = positions[id];
  const travel = [...travelByPair.keys()].sort().map((key) => travelByPair.get(key));
  gates.sort((a, b) => a.portal.localeCompare(b.portal));
  return { adjacency: sorted, positions: sortedPos, travel, gates, offNetwork: [...pocket].sort() };
}

// ── packed encoding ────────────────────────────────────────────────────────
//
// Same discipline as the zone catalog: short records, several per physical
// line, and the decoder embedded verbatim so it can never drift.

function encodeAdjacency(adjacency) {
  return Object.entries(adjacency).map(([id, neighbors]) => `${id}>${neighbors.join(",")}`);
}

function encodePositions(positions) {
  return Object.entries(positions).map(([id, p]) => `${id}|${p.x}|${p.y}`);
}

function encodeTravel(travel) {
  return travel.map((t) => `${t.from}~${t.to}|${t.cost}|${t.noLuggage ? 1 : 0}`);
}

function encodeRealmgates(gates) {
  return (gates || []).map((g) => `${g.portal}>${g.royal}`);
}

function decodeRoadsOverland(adjRecords, posRecords, travelRecords, gateRecords, offNetworkRecords) {
  const adj = new Map();
  for (const record of adjRecords) {
    const cut = record.indexOf(">");
    adj.set(record.slice(0, cut), record.slice(cut + 1).split(","));
  }
  const pos = new Map();
  for (const record of posRecords) {
    const [id, x, y] = record.split("|");
    pos.set(id, { x: Number(x), y: Number(y) });
  }
  const travel = new Map();
  const link = (from, to, cost, noLuggage) => {
    if (!travel.has(from)) travel.set(from, []);
    travel.get(from).push({ zoneId: to, cost, noLuggage });
  };
  for (const record of travelRecords || []) {
    const [pair, cost, noLuggage] = record.split("|");
    const [from, to] = pair.split("~");
    link(from, to, Number(cost), noLuggage === "1");
    link(to, from, Number(cost), noLuggage === "1");
  }
  const gates = new Map();
  for (const record of gateRecords || []) {
    const cut = record.indexOf(">");
    gates.set(record.slice(0, cut), record.slice(cut + 1));
  }
  return { adj, pos, travel, gates, offNetwork: new Set(offNetworkRecords || []) };
}

// ── CLI ────────────────────────────────────────────────────────────────────

function serialize({ adjacency, positions, travel, gates, offNetwork }) {
  const edges = Object.values(adjacency).reduce((n, list) => n + list.length, 0) / 2;

  return `/**
 * Overland zone map — GENERATED, do not hand-edit.
 *
 * Source: ${WORLD_URL}
 * Regenerate: node scripts/gen-roads-overland.cjs
 * Generated: ${new Date().toISOString().slice(0, 10)} — ${Object.keys(adjacency).length} zones, ${edges} foot edges, ${travel.length} travel connections, ${(gates || []).length} realmgates, ${(offNetwork || []).length} off-network zones, ${Object.keys(positions).length} world map positions.
 *
 * Two ways to move that are not a Roads portal:
 *
 *   foot    the neighbours you can RUN to, from world.xml cluster exits
 *   travel  the city travel network, from <travelpoint><connections>: royal
 *           city to royal city, to its own bound portal city (fee modifier 0),
 *           to Caerleon (4, no luggage) and to Brecilien (10). The royal pairs
 *           world.xml omits are supplied by ROYAL_TRAVEL_SUPPLEMENT in the
 *           generator — in game every royal city reaches every other directly.
 *
 * The realmgates are the cost-0 portal-city links, listed apart because the game
 * gates that crossing by character binding: royal → outlands only through the
 * gate you are bound to, while coming back through any of them re-binds you.
 *
 * The off-network list is the Brecilien pocket — the Mists. No Roads tunnel
 * opens into it (the one way in from the Roads is a white Brecilien portal that
 * spawns at random), and the way out is a Mists portal that lands you at
 * random. So it is not part of the Roads network: a route may not start in it,
 * end in it, or cross it.
 *
 * Roads zones are absent by design: tunnels connect through portals, which
 * expire and live in js/data-roads-portals.js. The hybrid route finder
 * (js/roads-hybrid-route.js) walks all three edge sets at once.
 *
 * Records are packed as
 *   adjacency  id>neighborId,neighborId,…
 *   position   id|x|y
 *   travel     idA~idB|feeModifier|noLuggage
 *   realmgate   portalCityId>royalCityId
 *   off-network bare zone id
 */

const ROADS_OVERLAND_RECORDS = [
${packLines(encodeAdjacency(adjacency)).map((line) => `  ${line}`).join("\n")}
];

const ROADS_ZONE_POS_RECORDS = [
${packLines(encodePositions(positions)).map((line) => `  ${line}`).join("\n")}
];

const ROADS_TRAVEL_RECORDS = [
${packLines(encodeTravel(travel)).map((line) => `  ${line}`).join("\n")}
];

const ROADS_REALMGATE_RECORDS = [
${packLines(encodeRealmgates(gates)).map((line) => `  ${line}`).join("\n")}
];

const ROADS_OFF_NETWORK_RECORDS = [
${packLines(offNetwork || []).map((line) => `  ${line}`).join("\n")}
];

const decodeRoadsOverland = ${decodeRoadsOverland.toString()};

const ROADS_OVERLAND = decodeRoadsOverland(
  ROADS_OVERLAND_RECORDS, ROADS_ZONE_POS_RECORDS, ROADS_TRAVEL_RECORDS,
  ROADS_REALMGATE_RECORDS, ROADS_OFF_NETWORK_RECORDS,
);
const ROADS_OVERLAND_ADJ = ROADS_OVERLAND.adj;
const ROADS_ZONE_POS = ROADS_OVERLAND.pos;
const ROADS_TRAVEL = ROADS_OVERLAND.travel;
const ROADS_REALMGATES = ROADS_OVERLAND.gates;
const ROADS_OFF_NETWORK = ROADS_OVERLAND.offNetwork;

/** Zones reachable on foot from \`zoneId\`. Empty for roads and unknown zones. */
function overlandNeighbors(zoneId) {
  return ROADS_OVERLAND_ADJ.get(zoneId) || [];
}

/** City travel available from \`zoneId\`: {zoneId, cost, noLuggage} per hop. */
function travelConnections(zoneId) {
  return ROADS_TRAVEL.get(zoneId) || [];
}

/** The royal city on the other side of \`zoneId\`'s realmgate, else null. */
function realmgateRoyalCity(zoneId) {
  return ROADS_REALMGATES.get(zoneId) || null;
}

/** True for the five outlands portal cities, i.e. the binding-gated ones. */
function isPortalCity(zoneId) {
  return ROADS_REALMGATES.has(zoneId);
}

/**
 * True for a zone the Roads cannot reach — the Brecilien pocket. Such a zone is
 * no part of the network: it is never a route endpoint, never a waypoint, and
 * never one end of a portal.
 */
function isOffRoadsNetwork(zoneId) {
  return ROADS_OFF_NETWORK.has(zoneId);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    ROADS_OVERLAND_ADJ, ROADS_ZONE_POS, ROADS_TRAVEL, ROADS_REALMGATES, ROADS_OFF_NETWORK,
    overlandNeighbors, travelConnections, realmgateRoyalCity, isPortalCity, isOffRoadsNetwork,
    ROADS_OVERLAND_RECORDS, ROADS_ZONE_POS_RECORDS, ROADS_TRAVEL_RECORDS,
    ROADS_REALMGATE_RECORDS, ROADS_OFF_NETWORK_RECORDS,
  };
}
`;
}

async function main() {
  const args = process.argv.slice(2);
  const sourceIdx = args.indexOf("--source");
  const worldIdx = args.indexOf("--world");
  const toStdout = args.includes("--stdout");

  // The mapper JSON only decides tier/colour, but buildZones needs it to derive
  // the very same ids the shipped catalog carries.
  let raw;
  if (sourceIdx !== -1 && args[sourceIdx + 1]) {
    raw = JSON.parse(fs.readFileSync(args[sourceIdx + 1], "utf8"));
  } else {
    const res = await fetch(SOURCE_URL);
    if (!res.ok) throw new Error(`${SOURCE_URL} → HTTP ${res.status}`);
    raw = await res.json();
  }

  let worldXml;
  if (worldIdx !== -1 && args[worldIdx + 1]) {
    worldXml = fs.readFileSync(args[worldIdx + 1], "utf8");
  } else {
    const res = await fetch(WORLD_URL);
    if (!res.ok) throw new Error(`${WORLD_URL} → HTTP ${res.status}`);
    worldXml = await res.text();
  }

  const clusters = parseWorldClusters(worldXml);
  if (!clusters.length) throw new Error("world.xml parsed to zero clusters — refusing to drop every zone");
  const overland = buildOverland(buildZones(raw, clusters), clusters);
  if (!Object.keys(overland.adjacency).length) throw new Error("no foot edges parsed — refusing to write an empty map");

  const out = serialize(overland);
  if (toStdout) {
    process.stdout.write(out);
    return;
  }
  const target = path.join(__dirname, "..", "js", "data-roads-overland.js");
  fs.writeFileSync(target, out);
  const edges = Object.values(overland.adjacency).reduce((n, l) => n + l.length, 0) / 2;
  console.log(`wrote ${target}: ${Object.keys(overland.adjacency).length} zones, ${edges} edges, ` +
    `${overland.travel.length} travel connections, ${overland.gates.length} realmgates, ` +
    `${overland.offNetwork.length} off-network zones, ${Object.keys(overland.positions).length} positions`);
}

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = {
  buildOverland, encodeAdjacency, encodePositions, encodeTravel, encodeRealmgates,
  decodeRoadsOverland, serialize, ROYAL_TRAVEL_SUPPLEMENT,
};
