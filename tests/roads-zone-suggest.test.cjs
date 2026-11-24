/**
 * Tests for the Roads zone autocomplete shortlist (js/roads-zone-suggest.js).
 *
 * Typing a zone by hand had no suggestions at all, so a one-character typo in
 * "Quaes-Ovumlum" read back as "Unknown zone". These cases pin the ranking the
 * shortlist must produce: exact match first, then prefix, then substring, with
 * roads zones ahead of open-world ones and cities last. Cities ARE offered —
 * resolveZone and the route finder both accept them, so hiding them from the
 * shortlist only hid zones that already worked when typed out in full.
 *
 * Black-box: only the catalog goes in and an ordered name list comes out.
 *
 * Run: node tests/roads-zone-suggest.test.cjs
 */

const assert = require("assert");

const { suggestZones } = require("../js/roads-zone-suggest.js");

const ZONES = [
  { id: "TNL-101", name: "Cases-Ugumlos", tier: 6, type: "roads" },
  { id: "TNL-102", name: "Quaes-Ovumlum", tier: 7, type: "roads" },
  { id: "TNL-103", name: "Quaes-Ossum", tier: 5, type: "roads" },
  { id: "TNL-104", name: "Ugum-Casos", tier: 4, type: "roads" },
  { id: "TNL-105", name: "O'Quaes Rest", tier: 8, type: "roads" },
  { id: "1101", name: "Martlock", tier: 8, type: "royalBlue" },
  { id: "1102", name: "Quaes Outland", tier: 6, type: "outlands" },
  { id: "0007", name: "Thetford Market", tier: 0, type: "city" },
  { id: "0000", name: "Quaesford", tier: 0, type: "city" },
];

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

const names = (query, options) => suggestZones(ZONES, query, options).map((z) => z.name);

// ── ranking ────────────────────────────────────────────────────────────────
// [query, expected first hit, why]
const FIRST_CASES = [
  ["Quaes-Ossum", "Quaes-Ossum", "an exact name wins over every prefix match"],
  ["quaes-ossum", "Quaes-Ossum", "matching ignores case"],
  ["TNL-104", "Ugum-Casos", "an exact cluster id resolves too — that is what the wire carries"],
  ["tnl-104", "Ugum-Casos", "ids match case-insensitively"],
  ["Quaes-O", "Quaes-Ossum", "prefix hits sort alphabetically among themselves"],
  ["Casos", "Ugum-Casos", "a substring inside the name still matches"],
  ["oquaes", "O'Quaes Rest", "apostrophes are ignored, so the typed form need not carry them"],
];

FIRST_CASES.forEach(([query, want, why]) => {
  test(`suggest("${query}") leads with ${want} — ${why}`, () => {
    assert.strictEqual(names(query)[0], want);
  });
});

test("prefix matches all rank above mere substring matches", () => {
  const got = names("quaes");
  const prefixes = ["Quaes-Ossum", "Quaes-Ovumlum", "Quaes Outland"];
  assert.deepStrictEqual(got.slice(0, 3), prefixes);
  assert.ok(got.includes("O'Quaes Rest"), "the substring hit is still offered, just later");
  assert.ok(got.indexOf("O'Quaes Rest") > 2, "…and after every prefix hit");
});

test("roads zones outrank open-world zones at equal match quality", () => {
  const got = names("quaes-o");
  assert.ok(got.indexOf("Quaes-Ossum") < got.indexOf("Quaes Outland") || !got.includes("Quaes Outland"));
  const outlandRank = names("quaes").indexOf("Quaes Outland");
  const roadsRank = names("quaes").indexOf("Quaes-Ovumlum");
  assert.ok(roadsRank < outlandRank, "roads before outlands");
});

// ── every zone type is reachable ───────────────────────────────────────────
const TYPED_NAME_CASES = ["Quaesford", "Thetford Market", "Martlock", "Quaes Outland"];
TYPED_NAME_CASES.forEach((name) => {
  test(`suggests ${name} when it is typed`, () => {
    assert.strictEqual(names(name)[0], name);
  });
});

test("cities rank behind roads and open-world zones at equal match quality", () => {
  const got = names("quaes");
  assert.ok(got.includes("Quaesford"), "the city is offered");
  assert.ok(got.indexOf("Quaesford") > got.indexOf("Quaes Outland"), "…after the outlands zone");
  assert.ok(got.indexOf("Quaesford") > got.indexOf("Quaes-Ossum"), "…and after the roads zones");
});

test("a query matching nothing returns an empty list, not the whole catalog", () => {
  assert.deepStrictEqual(names("zzzznotazone"), []);
});

// ── shape ──────────────────────────────────────────────────────────────────
const LIMIT_CASES = [
  ["", 3],
  ["quaes", 2],
  ["quaes", 1],
];
LIMIT_CASES.forEach(([query, limit]) => {
  test(`limit ${limit} caps the shortlist for "${query || "(empty)"}"`, () => {
    assert.strictEqual(suggestZones(ZONES, query, { limit }).length, limit);
  });
});

test("an empty query offers a browsable slice: roads, then open world, then cities", () => {
  const got = suggestZones(ZONES, "", { limit: 99 });
  assert.ok(got.length > 0, "empty box still lists something to pick from");
  const group = (test) => got.filter(test).map((z) => z.name);
  const roads = group((z) => z.type === "roads");
  const open = group((z) => z.type !== "roads" && z.type !== "city");
  const cities = group((z) => z.type === "city");
  assert.deepStrictEqual(got.map((z) => z.name), [...roads, ...open, ...cities]);
  for (const bucket of [roads, open, cities]) {
    assert.deepStrictEqual(bucket, [...bucket].sort((a, b) => a.localeCompare(b)), "alphabetical inside a group");
  }
});

test("duplicate display names are offered once", () => {
  const twins = [
    { id: "TNL-900", name: "Twin", tier: 4, type: "roads" },
    { id: "TNL-901", name: "Twin", tier: 6, type: "roads" },
  ];
  assert.deepStrictEqual(suggestZones(twins, "twin").map((z) => z.id), ["TNL-900"]);
});

test("returns the zone records themselves, so the caller can label them", () => {
  const [zone] = suggestZones(ZONES, "Cases-Ugumlos");
  assert.strictEqual(zone.tier, 6);
  assert.strictEqual(zone.id, "TNL-101");
});

// ── defensive ──────────────────────────────────────────────────────────────
const BAD_INPUT_CASES = [
  [null, "x"],
  [undefined, "x"],
  [[], "x"],
  [ZONES, null],
  [ZONES, undefined],
];
BAD_INPUT_CASES.forEach(([zones, query], i) => {
  test(`bad input #${i + 1} returns an array instead of throwing`, () => {
    assert.ok(Array.isArray(suggestZones(zones, query)));
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
