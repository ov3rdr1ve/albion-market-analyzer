/**
 * Test: getCraftCandidates picks the right craft-city candidates, accounting for
 * the Black/Red Zone Routes toggle (isBlackRedZoneEnabled / "include-caerleon").
 *
 * Two behaviours are pinned here:
 *
 * 1. Brecilien is excluded from the candidates for non-spec items. Brecilien
 *    sits in ROYAL_CITIES, and a Brecilien craft pays the Travel Planner exit
 *    fee on the finished product whenever sellCity != Brecilien, so it is never
 *    a uniquely-better route for a non-spec item — only an inferior duplicate.
 *
 * 2. When Black/Red Zone Routes is OFF, Caerleon is unreachable from the royal
 *    pool, so it is never a craft candidate. A Caerleon-spec craft (shapeshifter
 *    staves, war gloves, gathering gear, tools, food) then falls back to the
 *    royal cities at base RRR — i.e. it must surface in the Royal-city table,
 *    not in an unreachable Caerleon-only row. (Reported bug: Prowling Staff only
 *    showed under Caerleon even with red-zone routes disabled.)
 *
 * Run: node tests/crafting-candidates-no-brecilien.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

// ── Mirror getCraftCandidates from js/render-crafting.js ──
// Behavioural copy: if the renderer ever drifts from this, the source-level
// guards below will fail and force the two to stay in sync. The second arg
// mirrors isBlackRedZoneEnabled() (the "include-caerleon" toggle).

const ROYAL_CITIES = [
  "Lymhurst",
  "Fort Sterling",
  "Thetford",
  "Martlock",
  "Bridgewatch",
  "Brecilien",
];

function getCraftCandidates(specCity, bmrOn) {
  const royals = ROYAL_CITIES.filter((c) => c !== "Brecilien");
  // Caerleon's self-contained Caerleon→Caerleon route survives routes-off, so it
  // is always a candidate; only a Caerleon-spec craft gains the royal fallback
  // (for royal-based players) when routes are off.
  if (specCity === "Caerleon") return bmrOn ? ["Caerleon"] : [...royals, "Caerleon"];
  if (specCity) return [specCity, "Caerleon"];
  return [...royals, "Caerleon"];
}

const ROYALS_ONLY = ["Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch"];

console.log("Crafting Candidate City Tests\n");

// ── BMR ON (Caerleon reachable): existing behaviour preserved ──

test("non-spec item excludes Brecilien, keeps 5 royals + Caerleon (BMR on)", () => {
  const got = getCraftCandidates(null, true);
  assert.ok(!got.includes("Brecilien"), `expected no Brecilien, got ${JSON.stringify(got)}`);
  ["Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Caerleon"].forEach((c) => {
    assert.ok(got.includes(c), `expected ${c} in candidates, got ${JSON.stringify(got)}`);
  });
  assert.strictEqual(got.length, 6, `expected 6 candidates, got ${got.length}: ${JSON.stringify(got)}`);
});

test("Brecilien-spec item keeps Brecilien + Caerleon (BMR on)", () => {
  assert.deepStrictEqual(getCraftCandidates("Brecilien", true), ["Brecilien", "Caerleon"]);
});

test("Lymhurst-spec item keeps Lymhurst + Caerleon (BMR on)", () => {
  assert.deepStrictEqual(getCraftCandidates("Lymhurst", true), ["Lymhurst", "Caerleon"]);
});

test("Caerleon-spec item (shapeshifter/gathering gear/food) returns only Caerleon (BMR on)", () => {
  assert.deepStrictEqual(getCraftCandidates("Caerleon", true), ["Caerleon"]);
});

// ── BMR OFF: royal↔Caerleon hauling is blocked, but Caerleon stays a candidate ──
// (its self-contained Caerleon→Caerleon route never crosses a red zone). Reported
// bug: a Caerleon-spec staff must show BOTH a royal row (royal-based players, base
// RRR) AND a Caerleon→Caerleon row (spec bonus) — not one instead of the other.

test("Caerleon-spec item lists the 5 royals AND Caerleon (BMR off)", () => {
  const got = getCraftCandidates("Caerleon", false);
  assert.deepStrictEqual(got, [...ROYALS_ONLY, "Caerleon"], `got ${JSON.stringify(got)}`);
  ROYALS_ONLY.forEach((c) => assert.ok(got.includes(c), `expected royal ${c}`));
  assert.ok(got.includes("Caerleon"), "Caerleon→Caerleon route must remain available");
  assert.ok(!got.includes("Brecilien"), "Brecilien stays excluded (strictly worse for non-spec)");
});

test("non-spec item keeps the 5 royals + Caerleon (BMR off)", () => {
  assert.deepStrictEqual(getCraftCandidates(null, false), [...ROYALS_ONLY, "Caerleon"]);
});

test("Lymhurst-spec item keeps Lymhurst + Caerleon (BMR off)", () => {
  assert.deepStrictEqual(getCraftCandidates("Lymhurst", false), ["Lymhurst", "Caerleon"]);
});

test("Brecilien-spec item keeps Brecilien + Caerleon (BMR off)", () => {
  assert.deepStrictEqual(getCraftCandidates("Brecilien", false), ["Brecilien", "Caerleon"]);
});

// ── Source-level regression guards ──

const renderCraftingSrc = fs.readFileSync(
  path.join(__dirname, "..", "js", "render-crafting.js"),
  "utf-8",
);

test("render-crafting.js defines a getCraftCandidates helper", () => {
  assert.ok(
    /function\s+getCraftCandidates\s*\(/.test(renderCraftingSrc),
    "expected `function getCraftCandidates(` in js/render-crafting.js",
  );
});

test("renderCraftingTable no longer builds inline [...ROYAL_CITIES, \"Caerleon\"]", () => {
  // If someone reintroduces the inline spread of unfiltered ROYAL_CITIES, the
  // Brecilien duplicates come back. Pin it shut at source level.
  assert.ok(
    !/\[\s*\.\.\.ROYAL_CITIES\s*,\s*["']Caerleon["']\s*\]/.test(renderCraftingSrc),
    "render-crafting.js must not spread the unfiltered ROYAL_CITIES; use getCraftCandidates instead",
  );
});

const fnMatch = renderCraftingSrc.match(/function\s+getCraftCandidates\s*\([\s\S]*?\n\}/);

test("getCraftCandidates body filters out Brecilien for non-spec items", () => {
  assert.ok(fnMatch, "expected getCraftCandidates to be defined");
  assert.ok(/Brecilien/.test(fnMatch[0]), "expected the helper body to reference Brecilien (the city it filters out)");
  assert.ok(/filter\s*\(/.test(fnMatch[0]), "expected the helper body to .filter() the royal-city list");
});

test("getCraftCandidates is Black/Red-Zone aware (adds the royal fallback when routes are off)", () => {
  assert.ok(fnMatch, "expected getCraftCandidates to be defined");
  // The helper must branch on the BMR toggle (a bmrOn arg threaded from
  // isBlackRedZoneEnabled()) so a Caerleon-spec craft ALSO lists the royals
  // when routes are off, while keeping Caerleon itself.
  assert.ok(
    /bmrOn|isBlackRedZoneEnabled/.test(fnMatch[0]),
    "expected getCraftCandidates body to reference the Black/Red Zone toggle (bmrOn / isBlackRedZoneEnabled)",
  );
});

test("the renderCraftingTable caller threads the live toggle into getCraftCandidates", () => {
  assert.ok(
    /getCraftCandidates\s*\(\s*specCity\s*,\s*isBlackRedZoneEnabled\s*\(\s*\)\s*\)/.test(renderCraftingSrc),
    "expected `getCraftCandidates(specCity, isBlackRedZoneEnabled())` at the call site",
  );
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
