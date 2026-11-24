/**
 * Data-sanity test for FARMING_PRODUCTION.
 *
 * Loaded TLD because the production data feeds the UI directly — these
 * assertions catch typos in the data table (wrong tier, missing field,
 * id that doesn't exist as a market item) before they reach the rendered
 * page where they'd silently produce broken rows.
 *
 * Items.xml is the source of truth for crop/herb/seed/baby/output ids.
 *
 * Run: node tests/farming-production-data.test.cjs
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const Module = require("module");

const dataSrc = fs.readFileSync(path.join(__dirname, "..", "js/data-farming.js"), "utf8");
const mod = new Module("farming-data-test");
mod._compile(`${dataSrc}\nmodule.exports = { FARMING_PRODUCTION, FARMING_FOCUS_PER_SEED };`, "farming-data.js");
const { FARMING_PRODUCTION, FARMING_FOCUS_PER_SEED } = mod.exports;

const itemsXml = fs.readFileSync(path.join(__dirname, "..", "data", "dumps", "items.xml"), "utf8");
function xmlHasItem(id) {
  // Match `uniquename="ID"` anywhere in items.xml.
  return itemsXml.includes(`uniquename="${id}"`);
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

console.log("\n=== FARMING_PRODUCTION coverage ===");

test("8 crops T1-T8", () => {
  const crops = FARMING_PRODUCTION.filter((p) => p.type === "crop");
  assert.strictEqual(crops.length, 8);
  const tiers = crops.map((p) => p.tier).sort((a, b) => a - b);
  assert.deepStrictEqual(tiers, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("7 herbs T2-T8", () => {
  const herbs = FARMING_PRODUCTION.filter((p) => p.type === "herb");
  assert.strictEqual(herbs.length, 7);
  const tiers = herbs.map((p) => p.tier).sort((a, b) => a - b);
  assert.deepStrictEqual(tiers, [2, 3, 4, 5, 6, 7, 8]);
});

test("5 byproducts (T3, T4, T5, T6, T8 — pig T7 has no byproduct)", () => {
  const by = FARMING_PRODUCTION.filter((p) => p.type === "byproduct");
  assert.strictEqual(by.length, 5);
  const tiers = by.map((p) => p.tier).sort((a, b) => a - b);
  assert.deepStrictEqual(tiers, [3, 4, 5, 6, 8]);
});

test("every seed/feed id exists in items.xml", () => {
  for (const p of FARMING_PRODUCTION) {
    assert.ok(xmlHasItem(p.id), `${p.id} (${p.name}) is not in items.xml`);
  }
});

test("every output id exists in items.xml", () => {
  for (const p of FARMING_PRODUCTION) {
    assert.ok(xmlHasItem(p.outputId), `${p.outputId} (${p.name}) is not in items.xml`);
  }
});

test("every cycle is 22h — crops harvest, animals produce", () => {
  for (const p of FARMING_PRODUCTION) {
    assert.strictEqual(p.cycleHours, 22,
      `${p.name}: cycle should be 22h, got ${p.cycleHours}`);
  }
});

test("byproduct rows buy feed and name their animal", () => {
  for (const p of FARMING_PRODUCTION) {
    if (p.type !== "byproduct") continue;
    assert.strictEqual(p.id, p.feedId, `${p.name}: the per-cycle buy is the feed crop`);
    assert.strictEqual(p.feedCount, 9, `${p.name}: 864 nutrition = 9 favorite crops`);
    assert.ok(p.produceBase > 0, `${p.name}: needs a produce figure`);
    for (const id of [p.animalId, p.babyId, p.feedId]) {
      assert.ok(xmlHasItem(id), `${p.name}: ${id} is not in items.xml`);
    }
    assert.ok(p.animalId.endsWith("_GROWN"), `${p.name}: ${p.animalId} must be the grown animal`);
  }
});

test("crops/herbs use 9 plots per garden, byproducts use 1 slot", () => {
  for (const p of FARMING_PRODUCTION) {
    const expected = p.type === "byproduct" ? 1 : 9;
    assert.strictEqual(p.plotsPerCycle, expected,
      `${p.name}: expected plotsPerCycle ${expected}, got ${p.plotsPerCycle}`);
  }
});

test("seed yield sums (base + watering) match wiki canonical values", () => {
  // Wiki Island Farms table — total yield with watering is invariant of tier
  // for *symmetric* crop+herb pairs. T1 carrot = 200%, T8 pumpkin = 106.66%.
  const EXPECTED_TOTAL = {
    1: 2.0000,
    2: 1.6666,
    3: 1.4000,
    4: 1.2666,
    5: 1.2000,
    6: 1.1334,
    7: 1.0889,
    8: 1.0666,
  };
  for (const p of FARMING_PRODUCTION) {
    if (p.type === "byproduct") continue;
    const total = p.baseSeedYield + p.wateringBonus;
    const expected = EXPECTED_TOTAL[p.tier];
    assert.ok(Math.abs(total - expected) < 0.01,
      `${p.name}: base+watering should be ~${(expected * 100).toFixed(2)}%, got ${(total * 100).toFixed(2)}%`);
  }
});

// The game charges 1000 * 0.5^(FCE/100) to water a plot, and the herb/crop
// nodes cap at 300 efficiency (1 base + 2 specialist) — so max spec is 125,
// not the 100 this used to assert over an assumed 40,000 FCE.
test("FARMING_FOCUS_PER_SEED = 125 per seed (max spec, 1000 base halved 3x)", () => {
  assert.strictEqual(FARMING_FOCUS_PER_SEED, 125);
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
