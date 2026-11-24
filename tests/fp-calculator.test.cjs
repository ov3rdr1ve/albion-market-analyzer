/**
 * Test: Faction Point Calculator (FP → hearts & crests).
 *
 * Black-box parameterized tests on calcFpCapePlan input/output behavior:
 *   - per-cape FP = crest FP + heartsPerCape × 3,000
 *   - maxCapes = floor(budget / perCapeFp); crest/heart counts & FP spent
 *   - correct heart token per royal city
 *   - budget 0 still reports per-cape cost
 *
 * Loads js/gear-capes.js via a vm sandbox (no module.exports) and requires
 * js/data-faction-fp-costs.js for getFpCost, injecting both as deps.
 *
 * Run: node tests/fp-calculator.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const sandbox = { window: {}, document: { getElementById: () => null }, module: {}, exports: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "gear-capes.js"), "utf-8"), sandbox);
const GEAR_CAPES = vm.runInContext("GEAR_CAPES", sandbox);

const { getFpCost } = require(path.join(__dirname, "..", "js", "data-faction-fp-costs.js"));
const { calcFpCapePlan } = require(path.join(__dirname, "..", "js", "render-fp-calculator.js"));

const deps = { gearCapes: GEAR_CAPES, getFpCost };
const plan = (input) => calcFpCapePlan(input, deps);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Faction Point Calculator tests\n");

// ── T8 Thetford, 200,000 FP — the worked example from the request ───────────
test("T8 Thetford / 200,000 FP → 4 capes, 40 hearts, 4 crests", () => {
  const p = plan({ budget: 200000, tier: 8, city: "THETFORD" });
  assert.strictEqual(p.heartsPerCape, 10);
  assert.strictEqual(p.crestFp, 15000);
  assert.strictEqual(p.heartFpEach, 3000);
  assert.strictEqual(p.perCapeFp, 45000); // 15000 + 10*3000
  assert.strictEqual(p.maxCapes, 4);
  assert.strictEqual(p.crestCount, 4);
  assert.strictEqual(p.heartCount, 40);
  assert.strictEqual(p.crestSpent, 60000);
  assert.strictEqual(p.heartSpent, 120000);
  assert.strictEqual(p.totalSpent, 180000);
  assert.strictEqual(p.fpLeft, 20000);
  assert.strictEqual(p.heartId, "T1_FACTION_SWAMP_TOKEN_1");
});

// ── T4 Lymhurst, 10,000 FP — cheapest tier ──────────────────────────────────
test("T4 Lymhurst / 10,000 FP → 2 capes, perCapeFp 3,400", () => {
  const p = plan({ budget: 10000, tier: 4, city: "LYMHURST" });
  assert.strictEqual(p.heartsPerCape, 1);
  assert.strictEqual(p.crestFp, 400);
  assert.strictEqual(p.perCapeFp, 3400); // 400 + 1*3000
  assert.strictEqual(p.maxCapes, 2);
  assert.strictEqual(p.crestCount, 2);
  assert.strictEqual(p.heartCount, 2);
  assert.strictEqual(p.totalSpent, 6800);
  assert.strictEqual(p.fpLeft, 3200);
  assert.strictEqual(p.heartId, "T1_FACTION_FOREST_TOKEN_1");
});

// ── Mid-tier heart counts & crest FP ────────────────────────────────────────
test("T6 Martlock → 3 hearts/cape, perCapeFp 12,000", () => {
  const p = plan({ budget: 0, tier: 6, city: "MARTLOCK" });
  assert.strictEqual(p.heartsPerCape, 3);
  assert.strictEqual(p.crestFp, 3000);
  assert.strictEqual(p.perCapeFp, 12000); // 3000 + 3*3000
  assert.strictEqual(p.heartId, "T1_FACTION_HIGHLAND_TOKEN_1");
});

test("T7 Bridgewatch → 5 hearts/cape, crestFp 7,500, perCapeFp 22,500", () => {
  const p = plan({ budget: 0, tier: 7, city: "BRIDGEWATCH" });
  assert.strictEqual(p.heartsPerCape, 5);
  assert.strictEqual(p.crestFp, 7500);
  assert.strictEqual(p.perCapeFp, 22500); // 7500 + 5*3000
  assert.strictEqual(p.heartId, "T1_FACTION_STEPPE_TOKEN_1");
});

// ── Budget 0 still reports per-cape cost, zero quantities ────────────────────
test("budget 0 → maxCapes/counts 0 but perCapeFp populated", () => {
  const p = plan({ budget: 0, tier: 8, city: "FORTSTERLING" });
  assert.strictEqual(p.maxCapes, 0);
  assert.strictEqual(p.crestCount, 0);
  assert.strictEqual(p.heartCount, 0);
  assert.strictEqual(p.totalSpent, 0);
  assert.strictEqual(p.fpLeft, 0);
  assert.strictEqual(p.perCapeFp, 45000);
  assert.strictEqual(p.heartId, "T1_FACTION_MOUNTAIN_TOKEN_1");
});

// ── Heart token mapping for every royal city ────────────────────────────────
test("each royal city maps to its faction heart token", () => {
  const expected = {
    THETFORD: "T1_FACTION_SWAMP_TOKEN_1",
    LYMHURST: "T1_FACTION_FOREST_TOKEN_1",
    FORTSTERLING: "T1_FACTION_MOUNTAIN_TOKEN_1",
    BRIDGEWATCH: "T1_FACTION_STEPPE_TOKEN_1",
    MARTLOCK: "T1_FACTION_HIGHLAND_TOKEN_1",
  };
  for (const [city, heartId] of Object.entries(expected)) {
    const p = plan({ budget: 50000, tier: 8, city });
    assert.strictEqual(p.heartId, heartId, `${city} heart`);
    assert.strictEqual(p.crestId, `T8_CAPEITEM_FW_${city}_BP`, `${city} crest`);
  }
});

// ── Non-fundable / unknown inputs return null gracefully ────────────────────
test("Caerleon (crest not FP-purchasable) returns null", () => {
  assert.strictEqual(plan({ budget: 100000, tier: 8, city: "CAERLEON" }), null);
});

test("unknown city returns null", () => {
  assert.strictEqual(plan({ budget: 100000, tier: 8, city: "NOWHERE" }), null);
});

// ── Floor behavior: partial budget doesn't round up ─────────────────────────
test("partial budget floors capes (T8 Thetford, 44,999 FP → 0)", () => {
  const p = plan({ budget: 44999, tier: 8, city: "THETFORD" });
  assert.strictEqual(p.maxCapes, 0);
  assert.strictEqual(p.fpLeft, 44999);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
