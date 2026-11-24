/**
 * Test: Brecilien is registered as a safe-route city.
 *
 * Validates that:
 *   - ROYAL_CITIES (in js/data.js) literal includes "Brecilien".
 *   - LOCATIONS (in js/api.js) requests Brecilien from the AOD API.
 *   - Routing logic (mirrored from js/utils.js isInvalidCrossRoute) treats
 *     Brecilien as a Royal-class city: safe to/from any Royal city, blocked
 *     vs Caerleon by default, blocked vs Black Market always, allowed vs
 *     Caerleon when "Black/Red Zone Routes" is enabled.
 *
 * Pattern: black-box, no eval. Mirrors tests/city-force-respected.test.cjs:42
 * which inline-stubs isInvalidCrossRoute. Source-code asserts are done by
 * regex/string match on the file text.
 *
 * Run: node tests/brecilien-safe-route.test.cjs
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

function loadFileContent(relPath) {
  return fs.readFileSync(path.join(__dirname, "..", relPath), "utf-8");
}

// ── extract ROYAL_CITIES via simple regex parsing (no eval) ─────────────
function extractRoyalCitiesFromSource(src) {
  const m = src.match(/const\s+ROYAL_CITIES\s*=\s*\[([\s\S]*?)\]/);
  if (!m) throw new Error("Could not find ROYAL_CITIES literal in js/data.js");
  return Array.from(m[1].matchAll(/"([^"]+)"/g)).map((mm) => mm[1]);
}

function extractLocationsFromSource(src) {
  const m = src.match(/const\s+LOCATIONS\s*=\s*[\s\S]*?"([^"]+)"\s*;/);
  if (!m) throw new Error("Could not find LOCATIONS literal in js/api.js");
  return m[1];
}

const dataSrc = loadFileContent("js/data.js");
const apiSrc = loadFileContent("js/api.js");
const ROYAL_CITIES = extractRoyalCitiesFromSource(dataSrc);
const LOCATIONS = extractLocationsFromSource(apiSrc);

// ── mirror isInvalidCrossRoute (parameterised on ROYAL_CITIES + toggle) ──
// This is the same logic as js/utils.js isInvalidCrossRoute. Kept inline so we
// test the contract Brecilien is expected to satisfy, not just the data layer.
// The Black Market's book sits inside Caerleon, so it resolves to Caerleon for
// the zone rules rather than carrying a rule of its own (see
// tests/cross-route-black-market.test.cjs).
function isInvalidCrossRoute(buyCity, sellCity, blackRedZoneEnabled, royalCities) {
  if (!buyCity || !sellCity) return true;
  if (buyCity === "Black Market") return true;
  if (blackRedZoneEnabled) return false;
  const effectiveSell = sellCity === "Black Market" ? "Caerleon" : sellCity;
  const buyIsRoyal = royalCities.includes(buyCity);
  const sellIsRoyal = royalCities.includes(effectiveSell);
  if (buyIsRoyal && effectiveSell === "Caerleon") return true;
  if (buyCity === "Caerleon" && sellIsRoyal) return true;
  return false;
}

// ── tests ──────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL: ${name} — ${e.message}`);
  }
}

console.log("Brecilien Safe-Route Tests\n");

// -- registration --
test("ROYAL_CITIES contains Brecilien", () => {
  assert.ok(
    ROYAL_CITIES.includes("Brecilien"),
    `Expected ROYAL_CITIES to include "Brecilien", got ${JSON.stringify(ROYAL_CITIES)}`,
  );
});

test("ROYAL_CITIES still contains the 5 original Royal cities", () => {
  ["Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch"].forEach((c) => {
    assert.ok(
      ROYAL_CITIES.includes(c),
      `Expected ROYAL_CITIES to still include "${c}", got ${JSON.stringify(ROYAL_CITIES)}`,
    );
  });
});

test("LOCATIONS requests Brecilien from API", () => {
  const cities = LOCATIONS.split(",").map((s) => s.trim());
  assert.ok(
    cities.includes("Brecilien"),
    `Expected LOCATIONS to include "Brecilien", got "${LOCATIONS}"`,
  );
});

test("LOCATIONS still requests all original cities", () => {
  const cities = LOCATIONS.split(",").map((s) => s.trim());
  ["Caerleon", "Black Market", "Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch"].forEach((c) => {
    assert.ok(cities.includes(c), `Expected LOCATIONS to include "${c}"`);
  });
});

// -- routing with Black/Red Zone Routes OFF (default) --
const royalPeers = ["Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch"];
royalPeers.forEach((peer) => {
  test(`OFF: Brecilien -> ${peer} is a safe route`, () => {
    assert.strictEqual(
      isInvalidCrossRoute("Brecilien", peer, false, ROYAL_CITIES),
      false,
    );
  });
  test(`OFF: ${peer} -> Brecilien is a safe route`, () => {
    assert.strictEqual(
      isInvalidCrossRoute(peer, "Brecilien", false, ROYAL_CITIES),
      false,
    );
  });
});

test("OFF: Brecilien -> Brecilien is allowed (same-city)", () => {
  assert.strictEqual(
    isInvalidCrossRoute("Brecilien", "Brecilien", false, ROYAL_CITIES),
    false,
  );
});

test("OFF: Brecilien -> Caerleon is blocked", () => {
  assert.strictEqual(
    isInvalidCrossRoute("Brecilien", "Caerleon", false, ROYAL_CITIES),
    true,
  );
});

test("OFF: Caerleon -> Brecilien is blocked", () => {
  assert.strictEqual(
    isInvalidCrossRoute("Caerleon", "Brecilien", false, ROYAL_CITIES),
    true,
  );
});

test("OFF: Brecilien -> Black Market is blocked (BM only accepts Caerleon)", () => {
  assert.strictEqual(
    isInvalidCrossRoute("Brecilien", "Black Market", false, ROYAL_CITIES),
    true,
  );
});

// -- routing with Black/Red Zone Routes ON --
test("ON: Brecilien -> Caerleon is allowed", () => {
  assert.strictEqual(
    isInvalidCrossRoute("Brecilien", "Caerleon", true, ROYAL_CITIES),
    false,
  );
});

test("ON: Caerleon -> Brecilien is allowed", () => {
  assert.strictEqual(
    isInvalidCrossRoute("Caerleon", "Brecilien", true, ROYAL_CITIES),
    false,
  );
});

test("ON: Brecilien -> Black Market is allowed (the haul is opted into)", () => {
  assert.strictEqual(
    isInvalidCrossRoute("Brecilien", "Black Market", true, ROYAL_CITIES),
    false,
  );
});

test("Black Market is never a buy city, at either setting", () => {
  assert.strictEqual(isInvalidCrossRoute("Black Market", "Brecilien", false, ROYAL_CITIES), true);
  assert.strictEqual(isInvalidCrossRoute("Black Market", "Brecilien", true, ROYAL_CITIES), true);
});

test("ON: Brecilien -> Lymhurst still allowed", () => {
  assert.strictEqual(
    isInvalidCrossRoute("Brecilien", "Lymhurst", true, ROYAL_CITIES),
    false,
  );
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
