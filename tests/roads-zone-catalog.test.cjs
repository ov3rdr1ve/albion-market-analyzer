/**
 * Tests for the Roads of Avalon zone catalog builder.
 *
 * Black-box over the pure transform in scripts/gen-roads-zones.cjs: it takes the
 * raw upstream array (https://albionroadsmapper.com/avalon-roads-info.json —
 * 817 entries) and turns it into the runtime catalog js/data-roads-zones.js.
 *
 * Upstream shape (verified 2026-07-25):
 *   roads zone   { name, tier, icons: [{alt, badge?}], img }          (no color)
 *   non-roads    { name, tier, img, color: blue|yellow|red|black }    (no icons)
 *
 * Icon alts seen upstream: BLUE/GREEN/GOLD (+3 stray YELLOW) chests,
 * ROCK/STONE, LOGS, ORE, COTTON/FIBER, HIDE/LEATHER resources, DUNGEON, HIRE,
 * GROUP. `badge` carries the count when a zone has more than one.
 *
 * NO network here — every case runs off inline fixtures.
 *
 * Run: node tests/roads-zone-catalog.test.cjs
 */

const assert = require("assert");
const {
  buildZones, slugify, REST_PREFIXES, NON_REST_EXCEPTIONS,
  encodeZone, decodeRoadsZones, packLines, parseWorldClusters,
} = require("../scripts/gen-roads-zones.cjs");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

const roads = (name, tier, icons) => ({ name, tier, icons, img: `img/${name} T${tier}.png` });
const city = (name, tier, color) => ({ name, tier, color, img: `img/${name} T${tier}.png` });

// ── slugify ────────────────────────────────────────────────────────────────
const SLUG_CASES = [
  ["Cases-Ugumlos", "cases-ugumlos"],
  ["Brent Knoll", "brent-knoll"],
  ["Martlock", "martlock"],
  ["Qiitun-Setuan-Auvem", "qiitun-setuan-auvem"],
  ["Sun's Rest", "suns-rest"],
  ["  Padded   Name  ", "padded-name"],
];
SLUG_CASES.forEach(([input, want]) => {
  test(`slugify(${JSON.stringify(input)}) = ${want}`, () => {
    assert.strictEqual(slugify(input), want);
  });
});

// ── zone typing ────────────────────────────────────────────────────────────
const TYPE_CASES = [
  [city("Brent Knoll", 3, "blue"), "royalBlue"],
  [city("Sunfang Dawn", 5, "yellow"), "royalYellow"],
  [city("Dryvein Rise", 6, "red"), "royalRed"],
  [city("Qiitun-Setuan", 7, "black"), "outlands"],
  [roads("Cases-Ugumlos", 6, [{ alt: "BLUE" }]), "roads"],
];
TYPE_CASES.forEach(([raw, want]) => {
  test(`type of ${raw.name} = ${want}`, () => {
    const [zone] = buildZones([raw]);
    assert.strictEqual(zone.type, want);
  });
});

test("roads zones are detected by the absence of color, not by the hyphen", () => {
  // A hyphenated royal zone stays royal; a roads zone without icons stays roads.
  const zones = buildZones([city("Fort-Sterling", 4, "blue"), { name: "Tomum-Aiacaes", tier: 5, img: "x.png" }]);
  assert.strictEqual(zones.find((z) => z.name === "Fort-Sterling").type, "royalBlue");
  assert.strictEqual(zones.find((z) => z.name === "Tomum-Aiacaes").type, "roads");
});

// ── tier normalisation ─────────────────────────────────────────────────────
test("string tiers are coerced to numbers", () => {
  const [zone] = buildZones([roads("Setos-Aiaitum", "4", [])]);
  assert.strictEqual(zone.tier, 4);
});

test("zones with an unusable tier are dropped", () => {
  const zones = buildZones([roads("Broken-Zone", "abc", []), roads("Good-Zone", 5, [])]);
  assert.deepStrictEqual(zones.map((z) => z.name), ["Good-Zone"]);
});

// ── chests ─────────────────────────────────────────────────────────────────
test("chest icons become counts, badge carries the multiple", () => {
  const [zone] = buildZones([
    roads("Cases-Ugumlos", 6, [{ alt: "BLUE" }, { alt: "GREEN", badge: 2 }, { alt: "GOLD" }]),
  ]);
  assert.deepStrictEqual(zone.chests, { green: 2, blue: 1, gold: 1 });
});

test("stray YELLOW chest icons fold into gold", () => {
  const [zone] = buildZones([roads("Yellow-Chest", 5, [{ alt: "YELLOW", badge: 3 }])]);
  assert.deepStrictEqual(zone.chests, { gold: 3 });
});

test("a zone with no chest icons gets an empty chest map", () => {
  const [zone] = buildZones([roads("Bare-Zone", 4, [{ alt: "LOGS" }])]);
  assert.deepStrictEqual(zone.chests, {});
});

// ── resources ──────────────────────────────────────────────────────────────
const RESOURCE_CASES = [
  ["ROCK", "rock"],
  ["STONE", "rock"],
  ["LOGS", "logs"],
  ["ORE", "ore"],
  ["COTTON", "fiber"],
  ["FIBER", "fiber"],
  ["HIDE", "hide"],
  ["LEATHER", "hide"],
];
RESOURCE_CASES.forEach(([alt, want]) => {
  test(`resource icon ${alt} maps to ${want}`, () => {
    const [zone] = buildZones([roads(`Res-${alt}`, 5, [{ alt }])]);
    assert.deepStrictEqual(zone.resources, [want]);
  });
});

test("resources are deduped and sorted", () => {
  const [zone] = buildZones([
    roads("Multi-Res", 6, [{ alt: "ORE" }, { alt: "ROCK" }, { alt: "STONE" }, { alt: "LOGS" }]),
  ]);
  assert.deepStrictEqual(zone.resources, ["logs", "ore", "rock"]);
});

// ── markers (dungeon / hire / group) ────────────────────────────────────────
test("markers keep their raw upstream counts", () => {
  const [zone] = buildZones([
    roads("Marked-Zone", 7, [{ alt: "DUNGEON", badge: 2 }, { alt: "HIRE" }, { alt: "GROUP" }]),
  ]);
  assert.deepStrictEqual(zone.markers, { dungeon: 2, hire: 1, group: 1 });
});

test("unknown icon alts are ignored, not crashed on", () => {
  const [zone] = buildZones([roads("Odd-Zone", 5, [{ alt: "SOMETHING_NEW" }, { alt: "ORE" }])]);
  assert.deepStrictEqual(zone.resources, ["ore"]);
  assert.deepStrictEqual(zone.markers, {});
});

// ── Avalonian Rest (roads hideout zone) ────────────────────────────────────
test("Rest prefixes are the documented four", () => {
  assert.deepStrictEqual([...REST_PREFIXES].sort(), ["Qii", "Qua", "Sec", "Set"]);
});

const REST_CASES = [
  ["Quaes-Ovumlum", true],
  ["Qiitun-Setuan", true],
  ["Secam-Aiavem", true],
  ["Setuum-Obobrom", true],
  ["Cases-Ugumlos", false],
  ["Setos-Aiaitum", false],   // hardcoded non-hideout
  ["Setitos-Obobrom", false], // hardcoded non-hideout
];
REST_CASES.forEach(([name, want]) => {
  test(`isRest(${name}) = ${want}`, () => {
    const [zone] = buildZones([roads(name, 6, [])]);
    assert.strictEqual(zone.isRest, want);
  });
});

test("the non-Rest exception list is exactly the two known zones", () => {
  assert.deepStrictEqual([...NON_REST_EXCEPTIONS].sort(), ["Setitos-Obobrom", "Setos-Aiaitum"]);
});

test("royal/outlands zones are never Rests", () => {
  const [zone] = buildZones([city("Setback Keep", 5, "yellow")]);
  assert.strictEqual(zone.isRest, false);
});

// ── depth (hyphen segments) ────────────────────────────────────────────────
test("two-part roads names are depth 2, three-part are depth 3", () => {
  const zones = buildZones([roads("Tomum-Aiacaes", 5, []), roads("Qiitun-Setuan-Auvem", 7, [])]);
  assert.strictEqual(zones.find((z) => z.name === "Tomum-Aiacaes").depth, 2);
  assert.strictEqual(zones.find((z) => z.name === "Qiitun-Setuan-Auvem").depth, 3);
});

test("non-roads zones have no depth", () => {
  const [zone] = buildZones([city("Martlock", 8, "blue")]);
  assert.strictEqual(zone.depth, null);
});

// ── ids ────────────────────────────────────────────────────────────────────
test("ids are unique; collisions get a tier suffix", () => {
  const zones = buildZones([city("Twin Hills", 4, "blue"), city("Twin Hills", 6, "red")]);
  assert.deepStrictEqual(zones.map((z) => z.id).sort(), ["twin-hills", "twin-hills-t6"]);
});

// ── world.xml cluster ids ──────────────────────────────────────────────────
// The game reports the cluster id on the wire (Join response parameter 8, e.g.
// "TNL-022"), so it is the catalog key whenever world.xml knows the zone.

const WORLD_XML = `<?xml version="1.0"?>
<world>
  <cluster id="TNL-022" file="TNL-022_RDS.cluster.xml" displayname="Tetos-Igaelum" enabled="true" type="TUNNEL_ROYAL" />
  <cluster id="TNL-500" file="x.xml" displayname="Quaes-Ovumlum" enabled="true" type="TUNNEL_HIDEOUT" />
  <cluster id="TNL-101" file="deep.xml" displayname="Fuyes-Izohun" enabled="true" type="TUNNEL_DEEP" />
  <cluster id="TNL-296" file="raid.xml" displayname="Fynitos-Ezatam" enabled="true" type="TUNNEL_DEEP_RAID" />
  <cluster id="3004" file="y.xml" displayname="Martlock" enabled="true" type="SAFEAREA" />
  <cluster id="0301" file="z.xml" displayname="Anklesnag Mire" enabled="true" type="OPENPVP_RED" />
  <cluster id="ISLAND-GUILD-1" file="i.xml" displayname="Some Island" enabled="true" type="GUILDISLAND" />
  <cluster id="NO-NAME" file="n.xml" type="TUNNEL_LOW" />
</world>`;

test("parseWorldClusters keeps navigable clusters and drops the rest", () => {
  const clusters = parseWorldClusters(WORLD_XML);
  assert.deepStrictEqual(clusters.map((c) => c.id), ["TNL-022", "TNL-500", "TNL-101", "TNL-296", "3004", "0301"]);
});

test("parseWorldClusters skips clusters with no display name", () => {
  assert.ok(!parseWorldClusters(WORLD_XML).some((c) => c.id === "NO-NAME"));
});

test("parseWorldClusters tolerates junk input", () => {
  assert.deepStrictEqual(parseWorldClusters(""), []);
  assert.deepStrictEqual(parseWorldClusters(null), []);
  assert.deepStrictEqual(parseWorldClusters("<world></world>"), []);
});

// ── exits + world map position (the overland map's raw material) ───────────
// Shape verified against the live dump 2026-08-11: `targetid="GUID@CLUSTERID"`,
// with dungeon entrances mixed into the same <exits> block under a different
// targettype, and tunnels carrying an empty <exits />.

const WORLD_XML_EXITS = `<?xml version="1.0"?>
<world>
  <cluster id="0347" displayname="Deathwisp Bog" enabled="true" type="OPENPVP_BLACK_6" worldmapposition="-47.94 197.57">
    <exits>
      <exit id="a" targetid="g1@3355" targettype="Cluster" />
      <exit id="b" targetid="g2@DNG-UND-01-MAIN-022" targettype="DungeonSolo" />
      <exit id="c" targetid="g3@0348" targettype="Cluster" />
    </exits>
  </cluster>
  <cluster id="TNL-001" displayname="Ouyos-Aoeuam" enabled="true" type="TUNNEL_ROYAL">
    <exits />
  </cluster>
  <cluster id="3355" displayname="Murdergulch Ravine" enabled="true" type="OPENPVP_BLACK_6" worldmapposition="10 -20">
    <exits>
      <exit id="d" targetid="g4@0347" targettype="Cluster" />
    </exits>
  </cluster>
  <cluster id="1000" displayname="Lymhurst" enabled="true" type="PLAYERCITY_SAFEAREA_02" worldmapposition="127.54 -313.69">
    <travelpoints>
      <travelpoint id="tp" pos="-30 51">
        <connections>
          <connection to="g10@1301" costmodifier="0" noluggage="false" />
          <connection to="g11@3003" costmodifier="4" noluggage="true" />
          <connection to="g12@5000" costmodifier="10" noluggage="false" />
        </connections>
      </travelpoint>
    </travelpoints>
  </cluster>
</world>`;

test("parseWorldClusters reads cluster exits and the world map position", () => {
  const byId = new Map(parseWorldClusters(WORLD_XML_EXITS).map((c) => [c.id, c]));
  assert.deepStrictEqual(byId.get("0347").exits, ["g1@3355", "g3@0348"]);
  assert.strictEqual(byId.get("0347").worldmapposition, "-47.94 197.57");
  assert.deepStrictEqual(byId.get("TNL-001").exits, []);
  assert.strictEqual(byId.get("TNL-001").worldmapposition, "");
});

test("parseWorldClusters does not leak exits across a self-closing cluster tag", () => {
  const byId = new Map(parseWorldClusters(WORLD_XML).map((c) => [c.id, c]));
  assert.deepStrictEqual(byId.get("TNL-022").exits, []);
  assert.deepStrictEqual(byId.get("3004").exits, []);
  assert.deepStrictEqual(byId.get("3004").travel, []);
});

test("parseWorldClusters reads the city travel connections", () => {
  const byId = new Map(parseWorldClusters(WORLD_XML_EXITS).map((c) => [c.id, c]));
  assert.deepStrictEqual(byId.get("1000").travel, [
    { to: "g10@1301", costmodifier: 0, noLuggage: false },
    { to: "g11@3003", costmodifier: 4, noLuggage: true },
    { to: "g12@5000", costmodifier: 10, noLuggage: false },
  ]);
});

test("a cluster with no travelpoint carries no connections", () => {
  const byId = new Map(parseWorldClusters(WORLD_XML_EXITS).map((c) => [c.id, c]));
  assert.deepStrictEqual(byId.get("0347").travel, []);
  assert.deepStrictEqual(byId.get("TNL-001").travel, []);
});

test("a mapper zone adopts its world.xml cluster id and keeps the slug", () => {
  const zones = buildZones([roads("Tetos-Igaelum", 4, [{ alt: "GREEN", badge: 7 }])], parseWorldClusters(WORLD_XML));
  const zone = zones.find((z) => z.name === "Tetos-Igaelum");
  assert.strictEqual(zone.id, "TNL-022");
  assert.strictEqual(zone.slug, "tetos-igaelum");
  assert.strictEqual(zone.tier, 4);
  assert.deepStrictEqual(zone.chests, { green: 7 });
});

test("zones only world.xml knows are added, cities included", () => {
  const zones = buildZones([roads("Tetos-Igaelum", 4, [])], parseWorldClusters(WORLD_XML));
  const martlock = zones.find((z) => z.name === "Martlock");
  assert.strictEqual(martlock.id, "3004");
  assert.strictEqual(martlock.type, "city");
  assert.strictEqual(martlock.tier, 0); // world.xml carries no tier
});

test("cluster types map onto zone types", () => {
  const zones = buildZones([], parseWorldClusters(WORLD_XML));
  const typeOf = (name) => zones.find((z) => z.name === name).type;
  assert.strictEqual(typeOf("Tetos-Igaelum"), "roads");
  assert.strictEqual(typeOf("Quaes-Ovumlum"), "roads");
  assert.strictEqual(typeOf("Martlock"), "city");
  assert.strictEqual(typeOf("Anklesnag Mire"), "royalRed");
});

test("a world.xml-only Rest is still detected as a Rest", () => {
  const zones = buildZones([], parseWorldClusters(WORLD_XML));
  assert.strictEqual(zones.find((z) => z.name === "Quaes-Ovumlum").isRest, true);
});

test("the mapper colour wins over the cluster type", () => {
  // world.xml calls this red; the mapper JSON says yellow, and it is fresher.
  const zones = buildZones([city("Anklesnag Mire", 6, "yellow")], parseWorldClusters(WORLD_XML));
  assert.strictEqual(zones.find((z) => z.name === "Anklesnag Mire").type, "royalYellow");
});

test("a zone with no matching cluster falls back to its slug id", () => {
  const zones = buildZones([roads("Unknown-Zone", 5, [])], parseWorldClusters(WORLD_XML));
  assert.strictEqual(zones.find((z) => z.name === "Unknown-Zone").id, "unknown-zone");
});

// ── worldType (the raw world.xml cluster type) ─────────────────────────────
// Roads zones must keep their TUNNEL_* subtype: only TUNNEL_DEEP clusters carry
// the static Brecilien portal (S_ROADS_Portal_Mistcity_01), TUNNEL_DEEP_RAID
// ones do not. Verified against ao-bin-dumps 2026-08-29.

test("a joined zone keeps its raw world.xml cluster type", () => {
  const zones = buildZones(
    [roads("Fuyes-Izohun", 8, []), roads("Fynitos-Ezatam", 8, [])],
    parseWorldClusters(WORLD_XML),
  );
  assert.strictEqual(zones.find((z) => z.id === "TNL-101").worldType, "TUNNEL_DEEP");
  assert.strictEqual(zones.find((z) => z.id === "TNL-296").worldType, "TUNNEL_DEEP_RAID");
});

test("a zone world.xml does not know has an empty worldType", () => {
  const zones = buildZones([roads("Unknown-Zone", 5, [])], parseWorldClusters(WORLD_XML));
  assert.strictEqual(zones.find((z) => z.name === "Unknown-Zone").worldType, "");
});

test("world-only zones carry their cluster type too", () => {
  const zones = buildZones([], parseWorldClusters(WORLD_XML));
  assert.strictEqual(zones.find((z) => z.id === "TNL-022").worldType, "TUNNEL_ROYAL");
  assert.strictEqual(zones.find((z) => z.id === "3004").worldType, "SAFEAREA");
});

test("buildZones works with no world data at all", () => {
  const [zone] = buildZones([roads("Tetos-Igaelum", 4, [])]);
  assert.strictEqual(zone.id, "tetos-igaelum");
});

test("output is sorted by id and stable across runs", () => {
  const raw = [roads("Zulu-Zone", 5, []), city("Alpha Keep", 4, "blue"), roads("Mid-Zone", 6, [])];
  const first = buildZones(raw).map((z) => z.id);
  const second = buildZones(raw).map((z) => z.id);
  assert.deepStrictEqual(first, ["alpha-keep", "mid-zone", "zulu-zone"]);
  assert.deepStrictEqual(first, second);
});

// ── malformed input ────────────────────────────────────────────────────────
test("entries without a name are skipped", () => {
  const zones = buildZones([{ tier: 5, color: "blue" }, city("Real Zone", 5, "blue")]);
  assert.deepStrictEqual(zones.map((z) => z.name), ["Real Zone"]);
});

test("a non-array input yields an empty catalog", () => {
  assert.deepStrictEqual(buildZones(null), []);
  assert.deepStrictEqual(buildZones({}), []);
});

test("icons missing entirely are treated as no icons", () => {
  const [zone] = buildZones([{ name: "No-Icons", tier: 5, img: "x.png" }]);
  assert.deepStrictEqual(zone.chests, {});
  assert.deepStrictEqual(zone.resources, []);
  assert.deepStrictEqual(zone.markers, {});
});

// ── packed encoding round-trip ─────────────────────────────────────────────
// The catalog ships packed (817 object literals would blow the 800-line cap),
// so decode(encode(x)) must be the identity on every field.

const ROUNDTRIP_FIXTURES = [
  roads("Cases-Ugumlos", 6, [{ alt: "BLUE" }, { alt: "GREEN", badge: 2 }, { alt: "ROCK" }, { alt: "DUNGEON" }]),
  roads("Qiitun-Setuan-Auvem", 7, [{ alt: "GOLD", badge: 3 }, { alt: "HIRE", badge: 2 }, { alt: "ORE" }, { alt: "COTTON" }]),
  roads("Setos-Aiaitum", 4, []),
  city("Brent Knoll", 3, "blue"),
  city("Sun's Rest", 5, "yellow"),
  city("Qiitun-Setuan", 8, "black"),
];

ROUNDTRIP_FIXTURES.forEach((raw) => {
  test(`encode/decode round-trips ${raw.name}`, () => {
    const [zone] = buildZones([raw]);
    const [decoded] = decodeRoadsZones([encodeZone(zone)]);
    assert.deepStrictEqual(decoded, zone);
  });
});

test("encode/decode round-trips the worldType of a joined zone", () => {
  const [zone] = buildZones([roads("Fuyes-Izohun", 8, [])], parseWorldClusters(WORLD_XML))
    .filter((z) => z.id === "TNL-101");
  assert.strictEqual(zone.worldType, "TUNNEL_DEEP");
  const [decoded] = decodeRoadsZones([encodeZone(zone)]);
  assert.deepStrictEqual(decoded, zone);
});

test("decode fills an empty worldType for legacy 9-field records", () => {
  const [zone] = decodeRoadsZones(["TNL-101|Fuyes-Izohun|8|0|000||000|0|2"]);
  assert.strictEqual(zone.worldType, "");
  assert.strictEqual(zone.tier, 8);
});

test("a whole catalog round-trips field-for-field", () => {
  const zones = buildZones(ROUNDTRIP_FIXTURES);
  assert.deepStrictEqual(decodeRoadsZones(zones.map(encodeZone)), zones);
});

test("encoded records carry the display name verbatim", () => {
  // Cluster ids like TNL-022 cannot re-derive a name, so it is always stored.
  const [zone] = buildZones([city("Sun's Rest", 5, "yellow")]);
  assert.strictEqual(encodeZone(zone).split("|")[1], "Sun's Rest");
  assert.strictEqual(decodeRoadsZones([encodeZone(zone)])[0].name, "Sun's Rest");
});

test("the slug is recomputed on decode, never stored", () => {
  const clusters = [{ id: "TNL-022", displayname: "Tetos-Igaelum", type: "TUNNEL_ROYAL", enabled: true }];
  const zone = buildZones([roads("Tetos-Igaelum", 4, [])], clusters).find((z) => z.id === "TNL-022");
  assert.ok(!encodeZone(zone).includes("tetos-igaelum"));
  assert.strictEqual(decodeRoadsZones([encodeZone(zone)])[0].slug, "tetos-igaelum");
});

test("packLines keeps every record and respects the width budget", () => {
  const records = buildZones(ROUNDTRIP_FIXTURES).map(encodeZone);
  const lines = packLines(records, 80);
  lines.forEach((line) => assert.ok(line.length <= 80, `line too long: ${line.length}`));
  const flattened = lines.join(" ").split(", ").map((s) => JSON.parse(s.replace(/,$/, "")));
  assert.deepStrictEqual(flattened, records);
});

// ── the shipped catalog ────────────────────────────────────────────────────
// Reads the generated file from disk — no network.

const CATALOG_PATH = require("path").join(__dirname, "..", "js", "data-roads-zones.js");
const catalogExists = require("fs").existsSync(CATALOG_PATH);

if (catalogExists) {
  const { ROADS_ZONES, ROADS_ZONE_BY_ID, ROADS_ZONE_BY_NAME } = require(CATALOG_PATH);

  test("catalog carries both sources: mapper zones plus world.xml-only ones", () => {
    assert.strictEqual(ROADS_ZONES.filter((z) => z.type === "roads").length, 406);
    assert.ok(ROADS_ZONES.length > 900, `only ${ROADS_ZONES.length} zones`);
    assert.ok(ROADS_ZONES.some((z) => z.type === "city"), "cities missing");
  });

  test("nearly every zone carries a real cluster id", () => {
    const keyed = ROADS_ZONES.filter((z) => z.id !== z.slug).length;
    assert.ok(keyed / ROADS_ZONES.length > 0.95, `only ${keyed}/${ROADS_ZONES.length} keyed by cluster id`);
  });

  test("the live-verified cluster id resolves to its zone", () => {
    // Captured from the wire 2026-07-25: Join response parameter 8 = "TNL-022".
    const zone = ROADS_ZONE_BY_ID.get("TNL-022");
    assert.ok(zone, "TNL-022 missing from the catalog");
    assert.strictEqual(zone.type, "roads");
    assert.strictEqual(zone.name, "Tetos-Igaelum");
  });

  test("catalog ids are unique", () => {
    assert.strictEqual(new Set(ROADS_ZONES.map((z) => z.id)).size, ROADS_ZONES.length);
  });

  test("lookup maps cover every zone", () => {
    assert.strictEqual(ROADS_ZONE_BY_ID.size, ROADS_ZONES.length);
    assert.ok(ROADS_ZONE_BY_NAME.get("cases-ugumlos"));
  });

  test("every roads zone has a tier in 4-8 and a depth of 2 or 3", () => {
    ROADS_ZONES.filter((z) => z.type === "roads").forEach((z) => {
      assert.ok(z.tier >= 4 && z.tier <= 8, `${z.id} tier ${z.tier}`);
      assert.ok(z.depth === 2 || z.depth === 3, `${z.id} depth ${z.depth}`);
    });
  });

  test("every deep roads zone carries a TUNNEL_DEEP worldType, 10 of each kind", () => {
    const deep = ROADS_ZONES.filter((z) => z.type === "roads" && z.tier === 8);
    assert.strictEqual(deep.length, 30, `expected 30 tier-8 roads zones, got ${deep.length}`);
    const byWorld = deep.reduce((acc, z) => ((acc[z.worldType] = (acc[z.worldType] || 0) + 1), acc), {});
    assert.strictEqual(byWorld.TUNNEL_DEEP, 10);
    assert.strictEqual(byWorld.TUNNEL_DEEP_RAID, 19);
    // One mapper-only phantom (files-izizaum — no world.xml cluster behind it).
    assert.strictEqual(byWorld[""], 1);
  });

  test("only roads zones are Rests", () => {
    ROADS_ZONES.filter((z) => z.isRest).forEach((z) => assert.strictEqual(z.type, "roads"));
  });

  test("catalog file stays under the 800-line cap", () => {
    const lines = require("fs").readFileSync(CATALOG_PATH, "utf8").split("\n").length;
    assert.ok(lines < 800, `data-roads-zones.js is ${lines} lines`);
  });
} else {
  test("catalog file exists (run: node scripts/gen-roads-zones.cjs)", () => {
    assert.fail("js/data-roads-zones.js missing");
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
