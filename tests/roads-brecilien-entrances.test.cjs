/**
 * Tests for the Brecilien entrance catalog — js/data-roads-brecilien.js.
 *
 * NOT every deep Roads zone carries the permanent white portal into Brecilien.
 * The game spawns it only in the zones world.xml types TUNNEL_DEEP — verified
 * 2026-08-29 against ao-bin-dumps: exactly the 10 TUNNEL_DEEP cluster files
 * contain the S_ROADS_Portal_Mistcity_01 template, and none of the 20
 * TUNNEL_DEEP_RAID files do (Fynitos-Ezatam confirmed portal-less in game).
 * The catalog carries that type as `worldType`, so the entrance set stays
 * derived — a catalog regen cannot leave it stale.
 *
 * The reverse trip is NOT an edge: Brecilien's exit drops you in a random Road,
 * so nothing here is symmetric.
 *
 * Black-box over the shipped catalog — no DOM, no localStorage, no network.
 *
 * Run: node tests/roads-brecilien-entrances.test.cjs
 */

const assert = require("assert");
const {
  BRECILIEN_ZONE_ID, brecilienEntrances, isBrecilienEntrance, brecilienEdgesFrom,
} = require("../js/data-roads-brecilien.js");
const { ROADS_ZONES, ROADS_ZONE_BY_ID } = require("../js/data-roads-zones.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

// The 10 TUNNEL_DEEP zones — the only deep roads whose cluster file carries the
// S_ROADS_Portal_Mistcity_01 template (verified 2026-08-29, ao-bin-dumps).
const DEEP_ZONE_IDS = [
  "TNL-101", "TNL-128", "TNL-131", "TNL-148", "TNL-150",
  "TNL-301", "TNL-328", "TNL-331", "TNL-348", "TNL-350",
];

// The TUNNEL_DEEP_RAID tier-8 zones — deep roads WITHOUT a Brecilien portal.
// TNL-096 (Firos-Ezatam) is raid too, but the mapper JSON files it as T6.
const RAID_ZONE_IDS = [
  "TNL-100", "TNL-120", "TNL-122", "TNL-129", "TNL-130", "TNL-139", "TNL-144",
  "TNL-147", "TNL-149", "TNL-296", "TNL-300", "TNL-320", "TNL-322", "TNL-329",
  "TNL-330", "TNL-339", "TNL-344", "TNL-347", "TNL-349",
];

// ── the set itself ─────────────────────────────────────────────────────────

test("Brecilien is zone 5000, the city with the travel network", () => {
  assert.strictEqual(BRECILIEN_ZONE_ID, "5000");
  assert.strictEqual(ROADS_ZONE_BY_ID.get(BRECILIEN_ZONE_ID).name, "Brecilien");
});

test("the entrances are exactly the 10 TUNNEL_DEEP zones", () => {
  const entrances = [...brecilienEntrances()].sort();
  assert.deepStrictEqual(entrances, [...DEEP_ZONE_IDS].sort());
});

test("every T8 raid road carries the worldType the filter needs", () => {
  const worlds = ROADS_ZONES
    .filter((z) => z.type === "roads" && z.tier === 8)
    .map((z) => z.worldType);
  assert.ok(worlds.length >= DEEP_ZONE_IDS.length + RAID_ZONE_IDS.length,
    `expected 29+ tier-8 roads zones, got ${worlds.length}`);
  // 10 TUNNEL_DEEP, 19 TUNNEL_DEEP_RAID, plus one mapper-only phantom name
  // (files-izizaum) that no world.xml cluster backs.
  assert.ok(worlds.filter((w) => w === "TUNNEL_DEEP").length === DEEP_ZONE_IDS.length,
    "expected 10 TUNNEL_DEEP zones");
  assert.ok(worlds.filter((w) => w === "TUNNEL_DEEP_RAID").length === RAID_ZONE_IDS.length,
    "expected 19 TUNNEL_DEEP_RAID zones");
});

test("the set is one object, not rebuilt per call", () => {
  assert.strictEqual(brecilienEntrances(), brecilienEntrances());
});

// ── what is NOT an entrance ────────────────────────────────────────────────

for (const id of RAID_ZONE_IDS) {
  test(`raid road ${id} (${ROADS_ZONE_BY_ID.get(id)?.name}) is not an entrance`, () => {
    assert.strictEqual(isBrecilienEntrance(id), false);
  });
}

test("Fynitos-Ezatam — the reported zone — is not an entrance", () => {
  assert.strictEqual(ROADS_ZONE_BY_ID.get("TNL-296").name, "Fynitos-Ezatam");
  assert.strictEqual(isBrecilienEntrance("TNL-296"), false);
});

test("the mapper-only phantom name is not an entrance", () => {
  // files-izizaum has no world.xml cluster behind it — nothing on the wire can
  // ever report it, and no cluster file carries a portal for it.
  assert.strictEqual(ROADS_ZONE_BY_ID.get("files-izizaum").tier, 8);
  assert.strictEqual(isBrecilienEntrance("files-izizaum"), false);
});

for (const tier of [4, 6]) {
  test(`no T${tier} roads zone is an entrance`, () => {
    const zones = ROADS_ZONES.filter((z) => z.type === "roads" && z.tier === tier);
    assert.ok(zones.length, `catalog has no T${tier} roads zones to check`);
    assert.ok(zones.every((z) => !isBrecilienEntrance(z.id)));
  });
}

test("no Avalonian Rest is an entrance", () => {
  const rests = ROADS_ZONES.filter((z) => z.isRest);
  assert.ok(rests.length);
  assert.ok(rests.every((z) => !isBrecilienEntrance(z.id)));
});

test("no open-world or city zone is an entrance", () => {
  const outside = ROADS_ZONES.filter((z) => z.type !== "roads");
  assert.ok(outside.every((z) => !isBrecilienEntrance(z.id)));
});

test("Brecilien is not its own entrance", () => {
  assert.strictEqual(isBrecilienEntrance(BRECILIEN_ZONE_ID), false);
});

test("nonsense ids are not entrances", () => {
  for (const id of ["", null, undefined, "TNL-does-not-exist", 8]) {
    assert.strictEqual(isBrecilienEntrance(id), false, `${String(id)} claimed to be an entrance`);
  }
});

// ── the edge ───────────────────────────────────────────────────────────────

test("an entrance offers one edge, into Brecilien", () => {
  const edges = brecilienEdgesFrom(DEEP_ZONE_IDS[0]);
  assert.deepStrictEqual(edges, [{ neighbor: BRECILIEN_ZONE_ID, kind: "brecilien" }]);
});

test("every entrance offers exactly that edge", () => {
  for (const id of DEEP_ZONE_IDS) {
    assert.deepStrictEqual(brecilienEdgesFrom(id), [{ neighbor: BRECILIEN_ZONE_ID, kind: "brecilien" }], id);
  }
});

test("a raid road offers no edge — no portal to hang a route on", () => {
  for (const id of RAID_ZONE_IDS) {
    assert.deepStrictEqual(brecilienEdgesFrom(id), [], id);
  }
});

test("nothing else offers an edge", () => {
  for (const id of [BRECILIEN_ZONE_ID, "1000", "TNL-034", "", null]) {
    assert.deepStrictEqual(brecilienEdgesFrom(id), [], String(id));
  }
});

test("the edge is one way — Brecilien offers no way back", () => {
  assert.deepStrictEqual(brecilienEdgesFrom(BRECILIEN_ZONE_ID), []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
