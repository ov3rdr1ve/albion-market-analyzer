/**
 * Tests for the overland zone map — the walkable neighbours of every open-world
 * zone, joined out of ao-bin-dumps `cluster/world.xml`.
 *
 * Two halves, both black-box:
 *   1. the pure transform in scripts/gen-roads-overland.cjs, over inline
 *      fixtures shaped like the live dump (verified 2026-08-11):
 *        <cluster id="0347" worldmapposition="-47.94 197.57">
 *          <exit targetid="GUID@3355" targettype="Cluster" />
 *        </cluster>
 *      Tunnels carry an empty <exits /> — the Roads are portal-only and must
 *      never gain foot edges.
 *   2. the shipped catalog js/data-roads-overland.js, checked for structural
 *      sanity plus hop counts read off the live dump.
 *
 * NO network here — fixtures inline, catalog read from disk.
 *
 * Run: node tests/roads-overland-catalog.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildZones, parseWorldClusters } = require("../scripts/gen-roads-zones.cjs");
const {
  buildOverland, encodeAdjacency, encodePositions, encodeTravel, encodeRealmgates,
  decodeRoadsOverland,
} = require("../scripts/gen-roads-overland.cjs");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

// ── fixtures ───────────────────────────────────────────────────────────────

const WORLD_XML = `<?xml version="1.0"?>
<world>
  <cluster id="0347" displayname="Deathwisp Bog" enabled="true" type="OPENPVP_BLACK_6" worldmapposition="-47.94 197.57">
    <exits>
      <exit id="a" targetid="g1@3355" targettype="Cluster" />
      <exit id="b" targetid="g2@DNG-UND-01-MAIN-022" targettype="DungeonSolo" />
      <exit id="c" targetid="g3@BLACKBANK-0347" targettype="Cluster" />
      <exit id="d" targetid="g4@0348" targettype="Cluster" />
    </exits>
  </cluster>
  <cluster id="3355" displayname="Murdergulch Ravine" enabled="true" type="OPENPVP_BLACK_6" worldmapposition="10 -20">
    <exits>
      <exit id="e" targetid="g5@0347" targettype="Cluster" />
      <exit id="f" targetid="g6@3355" targettype="Cluster" />
    </exits>
  </cluster>
  <cluster id="0348" displayname="Widemoor Fen" enabled="true" type="OPENPVP_BLACK_5">
    <exits>
      <exit id="g" targetid="g7@0347" targettype="Cluster" />
      <exit id="h" targetid="g8@0349" targettype="Cluster" />
    </exits>
  </cluster>
  <cluster id="0349" displayname="Sunkenbough Woods" enabled="false" type="OPENPVP_BLACK_4" worldmapposition="1 2">
    <exits>
      <exit id="i" targetid="g9@0348" targettype="Cluster" />
    </exits>
  </cluster>
  <cluster id="TNL-001" displayname="Ouyos-Aoeuam" enabled="true" type="TUNNEL_ROYAL">
    <exits />
  </cluster>
  <cluster id="1000" displayname="Lymhurst" enabled="true" type="PLAYERCITY_SAFEAREA_02" worldmapposition="127.54 -313.69">
    <travelpoints><travelpoint id="tp"><connections>
      <connection to="g10@3003" costmodifier="4" noluggage="true" />
      <connection to="g11@3355" costmodifier="0" noluggage="false" />
      <connection to="g12@0349" costmodifier="7" noluggage="false" />
      <connection to="g13@9999" costmodifier="7" noluggage="false" />
    </connections></travelpoint></travelpoints>
  </cluster>
  <cluster id="3003" displayname="Caerleon" enabled="true" type="PLAYERCITY_BLACK_ROYAL" worldmapposition="28.21 -288.95">
    <travelpoints><travelpoint id="tp2"><connections>
      <connection to="g14@1000" costmodifier="4" noluggage="true" />
    </connections></travelpoint></travelpoints>
  </cluster>
  <cluster id="1301" displayname="Lymhurst Portal" enabled="true" type="PLAYERCITY_BLACK_PORTALCITY_NOFURNITURE" worldmapposition="200 -100">
    <travelpoints><travelpoint id="tp3"><connections>
      <connection to="g15@1000" costmodifier="0" noluggage="false" />
    </connections></travelpoint></travelpoints>
  </cluster>
  <cluster id="0000" displayname="Thetford" enabled="true" type="PLAYERCITY_SAFEAREA_02" worldmapposition="-100 -300">
    <travelpoints><travelpoint id="tp4"><connections>
      <connection to="g16@1000" costmodifier="9" noluggage="false" />
    </connections></travelpoint></travelpoints>
  </cluster>
  <cluster id="3004" displayname="Martlock" enabled="true" type="PLAYERCITY_SAFEAREA_02" worldmapposition="300 -300" />
</world>`;

const CLUSTERS = parseWorldClusters(WORLD_XML);
const ZONES = buildZones([], CLUSTERS);
const OVERLAND = buildOverland(ZONES, CLUSTERS);

// ── adjacency ──────────────────────────────────────────────────────────────

test("neighbouring clusters become undirected foot edges", () => {
  assert.deepStrictEqual(OVERLAND.adjacency["0347"], ["0348", "3355"]);
  assert.deepStrictEqual(OVERLAND.adjacency["3355"], ["0347"]);
});

test("an exit named by only one side still links both", () => {
  // 0347 lists 0348, and 0348 lists 0347 — but the reverse-only case matters
  // too: 0348 names 0349 while 0349 is disabled, so the edge must not appear.
  assert.ok(OVERLAND.adjacency["0348"].includes("0347"));
  assert.ok(!OVERLAND.adjacency["0348"].includes("0349"));
});

test("dungeon and bank targets are dropped", () => {
  const all = Object.values(OVERLAND.adjacency).flat();
  assert.ok(!all.some((id) => /^DNG-|^BLACKBANK-/.test(id)));
});

test("a cluster never links to itself", () => {
  assert.ok(!OVERLAND.adjacency["3355"].includes("3355"));
});

test("roads zones get no foot edges", () => {
  assert.strictEqual(OVERLAND.adjacency["TNL-001"], undefined);
});

test("adjacency is symmetric across the whole map", () => {
  for (const [id, neighbors] of Object.entries(OVERLAND.adjacency)) {
    for (const n of neighbors) {
      assert.ok((OVERLAND.adjacency[n] || []).includes(id), `${n} is missing ${id}`);
    }
  }
});

test("zones with no live neighbour are absent, not empty", () => {
  assert.ok(!("0349" in OVERLAND.adjacency));
});

// ── positions ──────────────────────────────────────────────────────────────

test("world map positions are parsed into numbers", () => {
  assert.deepStrictEqual(OVERLAND.positions["0347"], { x: -47.94, y: 197.57 });
  assert.deepStrictEqual(OVERLAND.positions["3355"], { x: 10, y: -20 });
});

test("a zone without a world map position is skipped", () => {
  assert.ok(!("0348" in OVERLAND.positions));
});

// ── city travel ────────────────────────────────────────────────────────────

test("travel connections carry the fee modifier and the luggage flag", () => {
  const byPair = new Map(OVERLAND.travel.map((t) => [`${t.from}~${t.to}`, t]));
  assert.deepStrictEqual(byPair.get("1000~3003"), { from: "1000", to: "3003", cost: 4, noLuggage: true });
  assert.deepStrictEqual(byPair.get("1000~3355"), { from: "1000", to: "3355", cost: 0, noLuggage: false });
});

test("a pair listed from both ends is stored once", () => {
  assert.strictEqual(OVERLAND.travel.filter((t) => t.from === "1000" && t.to === "3003").length, 1);
  assert.ok(!OVERLAND.travel.some((t) => t.from === "3003" && t.to === "1000"));
});

test("a travel target outside the walkable map is dropped", () => {
  const targets = OVERLAND.travel.flatMap((t) => [t.from, t.to]);
  assert.ok(!targets.includes("9999"), "unknown cluster");
  assert.ok(!targets.includes("0349"), "disabled cluster");
});

// ── realmgates ─────────────────────────────────────────────────────────────

test("a PORTALCITY cluster becomes a realmgate onto its royal city", () => {
  assert.deepStrictEqual(OVERLAND.gates, [{ portal: "1301", royal: "1000" }]);
});

test("an ordinary city is not a realmgate", () => {
  const portals = OVERLAND.gates.map((g) => g.portal);
  assert.ok(!portals.includes("1000"));
  assert.ok(!portals.includes("3003"));
});

test("encode/decode round-trips the realmgates", () => {
  assert.deepStrictEqual(encodeRealmgates(OVERLAND.gates), ["1301>1000"]);
  const decoded = decodeRoadsOverland([], [], [], encodeRealmgates(OVERLAND.gates));
  assert.strictEqual(decoded.gates.get("1301"), "1000");
});

// ── the off-network pocket ─────────────────────────────────────────────────────────────────────────────────────────────────

test("a seed drags in its whole foot component", () => {
  const pocket = buildOverland(ZONES, CLUSTERS, { offNetworkSeeds: ["0347"] }).offNetwork;
  assert.deepStrictEqual(pocket, ["0347", "0348", "3355"]);
});

test("a seed outside the walkable map yields no pocket", () => {
  assert.deepStrictEqual(buildOverland(ZONES, CLUSTERS, { offNetworkSeeds: ["9999"] }).offNetwork, []);
  assert.deepStrictEqual(buildOverland(ZONES, CLUSTERS, { offNetworkSeeds: [] }).offNetwork, []);
});

test("encode/decode round-trips the pocket", () => {
  const pocket = buildOverland(ZONES, CLUSTERS, { offNetworkSeeds: ["0347"] }).offNetwork;
  const decoded = decodeRoadsOverland([], [], [], [], pocket);
  assert.ok(decoded.offNetwork.has("0348"));
  assert.ok(!decoded.offNetwork.has("1000"));
});

// ── royal ring supplement ──────────────────────────────────────────────────

test("a royal pair the dump omits is supplied at cost 5, luggage allowed", () => {
  const hop = OVERLAND.travel.find((t) => t.from === "1000" && t.to === "3004");
  assert.deepStrictEqual(hop, { from: "1000", to: "3004", cost: 5, noLuggage: false });
});

test("the dump wins over the supplement when it lists the pair itself", () => {
  const hop = OVERLAND.travel.find((t) => t.from === "0000" && t.to === "1000");
  assert.strictEqual(hop.cost, 9);
});

test("a supplement pair with an endpoint outside the map is skipped", () => {
  // 2000 and 4000 are absent from the fixture, so 0000~2000, 2000~4000 and
  // 3004~4000 must not appear.
  const ids = new Set(OVERLAND.travel.flatMap((t) => [t.from, t.to]));
  assert.ok(!ids.has("2000") && !ids.has("4000"));
});

// ── encoding round-trip ────────────────────────────────────────────────────

test("encode/decode round-trips the travel connections in both directions", () => {
  const decoded = decodeRoadsOverland([], [], encodeTravel(OVERLAND.travel));
  const hops = decoded.travel.get("1000");
  assert.deepStrictEqual(
    hops.find((h) => h.zoneId === "3003"), { zoneId: "3003", cost: 4, noLuggage: true },
  );
  assert.deepStrictEqual(
    hops.find((h) => h.zoneId === "3355"), { zoneId: "3355", cost: 0, noLuggage: false },
  );
  assert.deepStrictEqual(decoded.travel.get("3003"), [{ zoneId: "1000", cost: 4, noLuggage: true }]);
});

test("encoded travel records use the packed pair shape", () => {
  assert.ok(encodeTravel(OVERLAND.travel).includes("1000~3003|4|1"));
  assert.ok(encodeTravel(OVERLAND.travel).includes("1000~3355|0|0"));
});

test("encode/decode round-trips the adjacency and the positions", () => {
  const decoded = decodeRoadsOverland(
    encodeAdjacency(OVERLAND.adjacency),
    encodePositions(OVERLAND.positions),
    [],
  );
  assert.deepStrictEqual([...decoded.adj.keys()].sort(), Object.keys(OVERLAND.adjacency).sort());
  for (const [id, neighbors] of decoded.adj) {
    assert.deepStrictEqual(neighbors, OVERLAND.adjacency[id]);
  }
  for (const [id, pos] of decoded.pos) {
    assert.deepStrictEqual(pos, OVERLAND.positions[id]);
  }
});

test("encoded records use the packed one-line-per-zone shape", () => {
  assert.ok(encodeAdjacency(OVERLAND.adjacency).includes("0347>0348,3355"));
  assert.ok(encodePositions(OVERLAND.positions).includes("3355|10|-20"));
});

// ── shipped catalog ────────────────────────────────────────────────────────

const CATALOG_PATH = path.join(__dirname, "..", "js", "data-roads-overland.js");
const catalog = require(CATALOG_PATH);
const { ROADS_ZONE_BY_ID, ROADS_ZONE_BY_NAME } = require("../js/data-roads-zones.js");

const idOf = (name) => {
  const zone = ROADS_ZONE_BY_NAME.get(name.toLowerCase());
  assert.ok(zone, `${name} is not in the zone catalog`);
  return zone.id;
};

/** Foot-hop distance over the shipped map, or null when unreachable. */
function footHops(fromName, toName) {
  const from = idOf(fromName), to = idOf(toName);
  const seen = new Set([from]);
  let frontier = [from], distance = 0;
  while (frontier.length) {
    if (frontier.includes(to)) return distance;
    const next = [];
    for (const id of frontier) {
      for (const n of catalog.overlandNeighbors(id)) {
        if (seen.has(n)) continue;
        seen.add(n);
        next.push(n);
      }
    }
    frontier = next;
    distance++;
  }
  return null;
}

test("shipped map covers the open world and no roads zone", () => {
  assert.ok(catalog.ROADS_OVERLAND_ADJ.size > 400, `only ${catalog.ROADS_OVERLAND_ADJ.size} zones`);
  for (const id of catalog.ROADS_OVERLAND_ADJ.keys()) {
    const zone = ROADS_ZONE_BY_ID.get(id);
    assert.ok(zone, `${id} is not a catalog zone`);
    assert.notStrictEqual(zone.type, "roads");
  }
});

test("shipped adjacency is symmetric and self-loop free", () => {
  for (const [id, neighbors] of catalog.ROADS_OVERLAND_ADJ) {
    assert.ok(!neighbors.includes(id));
    for (const n of neighbors) {
      assert.ok((catalog.ROADS_OVERLAND_ADJ.get(n) || []).includes(id), `${n} is missing ${id}`);
    }
  }
});

test("overlandNeighbors is empty for unknown, roads and junk ids", () => {
  assert.deepStrictEqual(catalog.overlandNeighbors("TNL-001"), []);
  assert.deepStrictEqual(catalog.overlandNeighbors("no-such-zone"), []);
  assert.deepStrictEqual(catalog.overlandNeighbors(""), []);
  assert.deepStrictEqual(catalog.overlandNeighbors(undefined), []);
});

test("shipped positions are finite numbers on catalog zones", () => {
  assert.ok(catalog.ROADS_ZONE_POS.size > 300, `only ${catalog.ROADS_ZONE_POS.size} positions`);
  for (const [id, pos] of catalog.ROADS_ZONE_POS) {
    assert.ok(ROADS_ZONE_BY_ID.has(id), `${id} is not a catalog zone`);
    assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.y), `${id} has a junk position`);
  }
});

// Read off the live dump 2026-08-11 — these are the numbers that make the
// hybrid router useful: from a mapped roads exit, how far is the target?
const HOP_CASES = [
  ["Braemore Upland", "Murdergulch Ravine", 10],
  ["Sunkenbough Woods", "Murdergulch Ravine", 11],
  ["Scuttlesink Marsh", "Murdergulch Ravine", 14],
];
HOP_CASES.forEach(([from, to, want]) => {
  test(`${from} is ${want} zones on foot from ${to}`, () => {
    assert.strictEqual(footHops(from, to), want);
  });
});

test("the royal continent is walkable end to end", () => {
  const hops = footHops("Lymhurst", "Birchcopse");
  assert.ok(Number.isFinite(hops) && hops > 0 && hops < 20, `got ${hops}`);
});

test("royal and outlands are separate foot components", () => {
  assert.strictEqual(footHops("Lymhurst", "Murdergulch Ravine"), null);
});

// The travel network as the live dump lists it: bound portal city free,
// Caerleon cheap but no luggage, Brecilien the expensive one.
const TRAVEL_CASES = [
  ["Lymhurst", "Lymhurst Portal", 0, false],
  ["Lymhurst", "Caerleon", 4, true],
  ["Lymhurst", "Bridgewatch", 5, false],
  ["Lymhurst", "Brecilien", 10, false],
  ["Caerleon", "Brecilien", 1, true],
];
TRAVEL_CASES.forEach(([from, to, cost, noLuggage]) => {
  test(`${from} travels to ${to} at ${cost}${noLuggage ? ", no luggage" : ""}`, () => {
    const hop = catalog.travelConnections(idOf(from)).find((t) => t.zoneId === idOf(to));
    assert.ok(hop, `${from} has no connection to ${to}`);
    assert.strictEqual(hop.cost, cost);
    assert.strictEqual(hop.noLuggage, noLuggage);
  });
});

test("travel is symmetric and every endpoint is a catalog zone", () => {
  for (const [id, hops] of catalog.ROADS_TRAVEL) {
    assert.ok(ROADS_ZONE_BY_ID.has(id), `${id} is not a catalog zone`);
    for (const hop of hops) {
      assert.ok(ROADS_ZONE_BY_ID.has(hop.zoneId), `${hop.zoneId} is not a catalog zone`);
      const back = catalog.ROADS_TRAVEL.get(hop.zoneId).find((t) => t.zoneId === id);
      assert.ok(back, `${hop.zoneId} does not travel back to ${id}`);
      assert.strictEqual(back.cost, hop.cost);
      assert.strictEqual(back.noLuggage, hop.noLuggage);
    }
  }
});

test("a royal city is bound to its own portal city only", () => {
  const portals = catalog.travelConnections(idOf("Lymhurst"))
    .map((t) => ROADS_ZONE_BY_ID.get(t.zoneId).name)
    .filter((n) => n.endsWith(" Portal"));
  assert.deepStrictEqual(portals, ["Lymhurst Portal"]);
});

test("the travel network is the 12 hubs, tutorial forts excluded", () => {
  const names = [...catalog.ROADS_TRAVEL.keys()].map((id) => ROADS_ZONE_BY_ID.get(id).name).sort();
  assert.strictEqual(names.length, 12, names.join(", "));
  assert.ok(!names.includes("Mountain Fort"));
  assert.ok(names.includes("Brecilien") && names.includes("Caerleon"));
});

// The royal ring the dump omits — player-verified, see ROYAL_TRAVEL_SUPPLEMENT.
const SUPPLEMENT_CASES = [
  ["Lymhurst", "Thetford"],
  ["Bridgewatch", "Thetford"],
  ["Lymhurst", "Martlock"],
  ["Bridgewatch", "Fort Sterling"],
  ["Martlock", "Fort Sterling"],
];
SUPPLEMENT_CASES.forEach(([from, to]) => {
  test(`${from} travels straight to ${to}`, () => {
    const hop = catalog.travelConnections(idOf(from)).find((t) => t.zoneId === idOf(to));
    assert.ok(hop, `${from} has no connection to ${to}`);
    assert.strictEqual(hop.cost, 5);
    assert.strictEqual(hop.noLuggage, false);
  });
});

test("every royal city travels to every other royal city", () => {
  const royal = ["Thetford", "Lymhurst", "Bridgewatch", "Martlock", "Fort Sterling"];
  for (const from of royal) {
    const reachable = catalog.travelConnections(idOf(from)).map((t) => t.zoneId);
    for (const to of royal.filter((c) => c !== from)) {
      assert.ok(reachable.includes(idOf(to)), `${from} cannot travel to ${to}`);
    }
  }
});

test("the shipped realmgates are the five portal cities", () => {
  assert.strictEqual(catalog.ROADS_REALMGATES.size, 5);
  for (const [portal, royal] of catalog.ROADS_REALMGATES) {
    const portalName = ROADS_ZONE_BY_ID.get(portal).name;
    const royalName = ROADS_ZONE_BY_ID.get(royal).name;
    assert.ok(portalName.endsWith(" Portal"), portalName);
    assert.strictEqual(portalName, `${royalName} Portal`);
  }
});

test("realmgateRoyalCity and isPortalCity read the gate map", () => {
  assert.strictEqual(catalog.realmgateRoyalCity(idOf("Lymhurst Portal")), idOf("Lymhurst"));
  assert.strictEqual(catalog.realmgateRoyalCity(idOf("Lymhurst")), null);
  assert.strictEqual(catalog.realmgateRoyalCity("no-such-zone"), null);
  assert.strictEqual(catalog.isPortalCity(idOf("Thetford Portal")), true);
  assert.strictEqual(catalog.isPortalCity(idOf("Thetford")), false);
  assert.strictEqual(catalog.isPortalCity(undefined), false);
});

test("the shipped off-network pocket is Brecilien and nothing else", () => {
  const names = [...catalog.ROADS_OFF_NETWORK].map((id) => {
    const zone = ROADS_ZONE_BY_ID.get(id);
    assert.ok(zone, `${id} is not a catalog zone`);
    return zone.name;
  }).sort();
  assert.deepStrictEqual(names, [
    "Brecilien", "Brecilien", "Brecilien Bank", "Brecilien Copse",
    "Brecilien Grove", "Brecilien Market", "Brecilien Thicket", "Brecilien Weald",
  ]);
  for (const city of ["Lymhurst", "Caerleon", "Lymhurst Portal", "Murdergulch Ravine"]) {
    assert.ok(!catalog.ROADS_OFF_NETWORK.has(idOf(city)), city);
  }
});

test("isOffRoadsNetwork answers for the pocket and nothing else", () => {
  assert.strictEqual(catalog.isOffRoadsNetwork(idOf("Brecilien")), true);
  assert.strictEqual(catalog.isOffRoadsNetwork(idOf("Brecilien Weald")), true);
  assert.strictEqual(catalog.isOffRoadsNetwork(idOf("Caerleon")), false);
  assert.strictEqual(catalog.isOffRoadsNetwork("TNL-001"), false);
  assert.strictEqual(catalog.isOffRoadsNetwork(undefined), false);
});

test("travelConnections is empty for unknown, roads and junk ids", () => {
  assert.deepStrictEqual(catalog.travelConnections("TNL-001"), []);
  assert.deepStrictEqual(catalog.travelConnections("no-such-zone"), []);
  assert.deepStrictEqual(catalog.travelConnections(undefined), []);
});

test("catalog file stays under the 800-line cap", () => {
  const lines = fs.readFileSync(CATALOG_PATH, "utf8").split("\n").length;
  assert.ok(lines < 800, `${lines} lines`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
