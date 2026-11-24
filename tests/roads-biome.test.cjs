/**
 * Tests for the per-zone `biome` field on the Roads zone catalog.
 *
 * Biome ground truth is the world.xml cluster `file` attribute — the first
 * token that names a biome, scanning after the "kind" token (RDS/WRL/CTY).
 * Real shapes lifted from ao-bin-dumps world.xml (verified 2026-09-14):
 *   TNL-001_RDS_RO_AUTO_T4_AVA_AVA.cluster.xml → avalon (tunnels carry AVA
 *     after the tier token)
 *   0208_WRL_SW_AUTO_T6_MOR_ROY.cluster.xml    → swamp (open world carries it
 *     right after the WRL kind token; the after-tier MOR/UND/KPR/HER token is
 *     a POI theme, NOT the biome)
 *   1000_CTY_FR_AUTO_T1_NON.cluster.xml        → forest (cities carry it too)
 * Codes with no biome meaning (RO, MI mist, HE hellgate, NON) → null, and so
 * do zones world.xml does not know (the mapper-only phantoms).
 *
 * NO network here — every case runs off inline fixtures or the shipped catalog.
 *
 * Run: node tests/roads-biome.test.cjs
 */

const assert = require("assert");
const {
  buildZones, encodeZone, decodeRoadsZones, parseWorldClusters,
} = require("../scripts/gen-roads-zones.cjs");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

const roads = (name, tier, icons) => ({ name, tier, icons, img: `img/${name} T${tier}.png` });

// ── biome parsing (buildZones over realistic world.xml fixtures) ───────────

const BIOME_WORLD_XML = `<?xml version="1.0"?>
<world>
  <cluster id="TNL-001" file="TNL-001_RDS_RO_AUTO_T4_AVA_AVA.cluster.xml" displayname="Ouyos-Aoeuam" enabled="true" type="TUNNEL_ROYAL" />
  <cluster id="0208" file="0208_WRL_SW_AUTO_T6_MOR_ROY.cluster.xml" displayname="Stumprot Swamp" enabled="true" type="OPENPVP_RED" />
  <cluster id="1201" file="1201_WRL_FR_AUTO_T3_HER_ROY.cluster.xml" displayname="Larchroad" enabled="true" type="OPENPVP_YELLOW" />
  <cluster id="2201" file="2201_WRL_ST_AUTO_T6_MOR_ROY.cluster.xml" displayname="Kindlegrass Steppe" enabled="true" type="OPENPVP_RED" />
  <cluster id="3201" file="3201_WRL_HL_AUTO_T6_MOR_ROY.cluster.xml" displayname="Birken Fell" enabled="true" type="OPENPVP_RED" />
  <cluster id="4201" file="4201_WRL_MN_AUTO_T5_KPR_ROY.cluster.xml" displayname="Pen Garn" enabled="true" type="OPENPVP_YELLOW" />
  <cluster id="1000" file="1000_CTY_FR_AUTO_T1_NON.cluster.xml" displayname="Lymhurst" enabled="true" type="PLAYERCITY_SAFEAREA_02" />
  <cluster id="5000" file="5000_CTY_MI_AUTO_T1_NON.cluster.xml" displayname="Brecilien" enabled="true" type="PLAYERCITY_BLACK" />
  <cluster id="0000-HellDen" file="0000-HellDen_CTY_HE_AUTO_T1_NON.cluster.xml" displayname="Antiquarian's Den" enabled="true" type="PLAYERCITY_HELLDEN" />
</world>`;

const clusters = parseWorldClusters(BIOME_WORLD_XML);
const biomeOf = (id) => {
  const zone = buildZones([], clusters).find((z) => z.id === id);
  assert.ok(zone, `${id} missing from buildZones output`);
  return zone.biome;
};

test("a roads tunnel file decodes biome avalon", () => {
  assert.strictEqual(biomeOf("TNL-001"), "avalon");
});

test("an open-world _SW_ file decodes biome swamp (Stumprot Swamp)", () => {
  assert.strictEqual(biomeOf("0208"), "swamp");
});

test("an open-world _FR_ file decodes biome forest", () => {
  assert.strictEqual(biomeOf("1201"), "forest");
});

test("an open-world _ST_ file decodes biome steppe", () => {
  assert.strictEqual(biomeOf("2201"), "steppe");
});

test("an open-world _HL_ file decodes biome highlands", () => {
  assert.strictEqual(biomeOf("3201"), "highlands");
});

test("an open-world _MN_ file decodes biome mountain", () => {
  assert.strictEqual(biomeOf("4201"), "mountain");
});

test("the after-tier POI token (MOR/HER/KPR) is never taken for a biome", () => {
  // 0208's after-tier token is MOR and 1201's is HER — both must still yield
  // the token-3 biome, not null.
  assert.strictEqual(biomeOf("0208"), "swamp");
  assert.strictEqual(biomeOf("1201"), "forest");
});

test("a city zone carries its file-attribute biome (Lymhurst = forest)", () => {
  assert.strictEqual(biomeOf("1000"), "forest");
});

test("a city zone with an unmapped biome code decodes null (mist/hellgate)", () => {
  assert.strictEqual(biomeOf("5000"), null); // CTY_MI — mist is not a biome
  assert.strictEqual(biomeOf("0000-HellDen"), null); // CTY_HE — hellgate
});

test("a joined mapper zone adopts the cluster's biome", () => {
  const zone = buildZones([roads("Stumprot Swamp", 6, [])], clusters).find((z) => z.id === "0208");
  assert.ok(zone, "joined Stumprot Swamp missing");
  assert.strictEqual(zone.biome, "swamp");
});

test("a zone world.xml does not know decodes biome null", () => {
  const zone = buildZones([roads("Unknown-Zone", 5, [])], clusters).find((z) => z.name === "Unknown-Zone");
  assert.ok(zone, "Unknown-Zone missing");
  assert.strictEqual(zone.worldType, "");
  assert.strictEqual(zone.biome, null);
});

// ── packed encoding round-trip ─────────────────────────────────────────────

test("encode packs the biome as a trailing short code, decode restores it", () => {
  const zone = buildZones([roads("Stumprot Swamp", 6, [])], clusters).find((z) => z.id === "0208");
  assert.ok(zone, "joined Stumprot Swamp missing");
  assert.strictEqual(zone.biome, "swamp");
  const encoded = encodeZone(zone);
  assert.ok(encoded.endsWith("|SW"), `expected trailing biome code, got: ${encoded}`);
  assert.deepStrictEqual(decodeRoadsZones([encoded])[0], zone);
});

test("records predating the biome field decode to biome null", () => {
  assert.strictEqual(decodeRoadsZones(["TNL-101|Fuyes-Izohun|8|0|000||000|0|2|TUNNEL_DEEP"])[0].biome, null);
  assert.strictEqual(decodeRoadsZones(["TNL-101|Fuyes-Izohun|8|0|000||000|0|2"])[0].biome, null);
});

// ── the shipped catalog ────────────────────────────────────────────────────
// Reads the generated file from disk — no network.

const CATALOG_PATH = require("path").join(__dirname, "..", "js", "data-roads-zones.js");

if (require("fs").existsSync(CATALOG_PATH)) {
  const { ROADS_ZONES, ROADS_ZONE_BY_ID, ROADS_ZONE_BY_NAME } = require(CATALOG_PATH);

  test("catalog: TNL-001 decodes with biome avalon", () => {
    assert.strictEqual(ROADS_ZONE_BY_ID.get("TNL-001").biome, "avalon");
  });

  test("catalog: real open-world zones decode their biomes", () => {
    assert.strictEqual(ROADS_ZONE_BY_ID.get("1201").biome, "forest"); // Larchroad
    assert.strictEqual(ROADS_ZONE_BY_ID.get("2201").biome, "steppe"); // Kindlegrass Steppe
    assert.strictEqual(ROADS_ZONE_BY_ID.get("3201").biome, "highlands"); // Birken Fell
    assert.strictEqual(ROADS_ZONE_BY_ID.get("4201").biome, "mountain"); // Pen Garn
    assert.strictEqual(ROADS_ZONE_BY_NAME.get("stumprot swamp").biome, "swamp");
  });

  test("catalog: unmapped codes and phantom zones decode biome null", () => {
    assert.strictEqual(ROADS_ZONE_BY_ID.get("5000").biome, null, "Brecilien (mist) must have no biome");
    // The mapper-only roads zones (no world.xml row behind them) — derived
    // from the data, not hardcoded: roads type with an empty worldType.
    const phantoms = ROADS_ZONES.filter((z) => z.type === "roads" && !z.worldType);
    assert.ok(phantoms.length >= 6, `expected the >=6 known phantom roads zones, got ${phantoms.length}`);
    phantoms.forEach((z) => assert.strictEqual(z.biome, null, `${z.id} must have no biome`));
  });

  test("catalog: every decoded biome is forest/swamp/steppe/mountain/highlands/avalon/null", () => {
    const valid = new Set(["forest", "swamp", "steppe", "mountain", "highlands", "avalon", null]);
    ROADS_ZONES.forEach((z) => assert.ok(valid.has(z.biome), `${z.id}: unexpected biome ${z.biome}`));
  });

  test("catalog: avalon count equals the TUNNEL_* zone count (consistency)", () => {
    const avalon = ROADS_ZONES.filter((z) => z.biome === "avalon").length;
    const tunnels = ROADS_ZONES.filter((z) => z.worldType.startsWith("TUNNEL_")).length;
    assert.ok(tunnels > 0, "no TUNNEL_* zones in the catalog");
    assert.strictEqual(avalon, tunnels);
  });

  test("catalog: open-world biomes are all represented", () => {
    const seen = new Set(ROADS_ZONES.map((z) => z.biome));
    ["forest", "swamp", "steppe", "mountain", "highlands", "avalon"].forEach((b) => {
      assert.ok(seen.has(b), `no zone with biome ${b}`);
    });
  });
} else {
  test("catalog file exists (run: node scripts/gen-roads-zones.cjs)", () => {
    assert.fail("js/data-roads-zones.js missing");
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
