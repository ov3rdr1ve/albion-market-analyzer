/**
 * Test: magical-material TIER-UP transmute recipes (5× T(n) → 1× T(n+1)).
 *
 * Every magical material has TWO transmute paths at the Artifact Foundry, and
 * the table used to model only the first:
 *   - Type-up (already modelled): 1× T(n) → 1× T(n+1-type) at the same tier,
 *     for a silver fee. Rune→Soul→Relic→Avalonian Shard.
 *   - Tier-up (this test): 5× T(n) → 1× T(n+1) of the SAME type, silver 0.
 *     Applies to Rune, Soul, Relic AND Avalonian Shard, T4→T5 … T7→T8.
 *
 * Ground truth is items.xml, e.g.:
 *   <simpleitem uniquename="T5_RELIC" …>
 *     <craftingrequirements time="0.01" silver="0">
 *       <craftresource uniquename="T4_RELIC" count="5" maxreturnamount="0" />
 *   …
 * `maxreturnamount="0"` → no resource return, and there is no craftingfocus
 * attribute → no focus. silver=0 → no station fee either (transmute nutrition
 * scales with the fixed transmute silver — see transmuteNutrition).
 *
 * The 5:1 ratio is what makes these rows different from every other transmute
 * row, so `sourceCount` drives the input cost: 5 × source price, not 1 ×.
 *
 * Black-box: load resource-names.js + data-transmute.js in a vm sandbox and
 * inspect the recipe descriptors the renderer/scan consume. No DOM, no live API.
 *
 * Run: node tests/transmute-material-tier-up.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const sandbox = { console };
vm.createContext(sandbox);
for (const s of ["js/resource-names.js", "js/data-transmute.js"]) {
  try {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", s), "utf-8"), sandbox);
  } catch (e) {
    console.error(`Error loading ${s}: ${e.message}`);
    process.exit(1);
  }
}
const getMaterialTransmuteRecipes = vm.runInContext("getMaterialTransmuteRecipes", sandbox);
const getTransmuteRecipes = vm.runInContext("getTransmuteRecipes", sandbox);
const getTransmuteItemIds = vm.runInContext("getTransmuteItemIds", sandbox);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name}\n    ${e.message}`); }
}

const matRecipes = getMaterialTransmuteRecipes();
const find = (sourceId, targetId) =>
  matRecipes.find((r) => r.sourceId === sourceId && r.targetId === targetId);

// A tier-up row keeps the family and climbs the tier; a type-up row keeps the
// tier and changes the family. Classify off the ids so the test never depends on
// an internal flag name.
const tierOf = (id) => Number(id.match(/^T(\d)_/)[1]);
const famOf = (id) => id.replace(/^T\d_/, "");
const tierUps = matRecipes.filter((r) => famOf(r.sourceId) === famOf(r.targetId));
const typeUps = matRecipes.filter((r) => famOf(r.sourceId) !== famOf(r.targetId));

console.log("Magical-material tier-up transmutes\n");

// ── 1. Coverage: all 4 families × 4 steps, source tiers 4-7 ──
const FAMILIES = ["RUNE", "SOUL", "RELIC", "SHARD_AVALONIAN"];
for (const fam of FAMILIES) {
  for (let t = 4; t <= 7; t++) {
    test(`tier-up T${t}_${fam} → T${t + 1}_${fam} exists`, () =>
      assert.ok(find(`T${t}_${fam}`, `T${t + 1}_${fam}`), `missing T${t}_${fam} → T${t + 1}_${fam}`));
  }
}
test("16 tier-up recipes (4 families × 4 steps)", () =>
  assert.strictEqual(tierUps.length, 16));

// ── 2. Ratio + fee: 5 source per 1 target, zero silver (items.xml silver="0") ──
test("every tier-up consumes 5 of the source", () => {
  const bad = tierUps.filter((r) => r.sourceCount !== 5);
  assert.strictEqual(bad.length, 0, bad.map((r) => `${r.sourceId}=${r.sourceCount}`).join(", "));
});
test("every tier-up is free (silverCost 0)", () => {
  const bad = tierUps.filter((r) => r.silverCost !== 0);
  assert.strictEqual(bad.length, 0, bad.map((r) => `${r.sourceId}=${r.silverCost}`).join(", "));
});
test("T4 Relic → T5 Relic: 5× source, 0 silver", () => {
  const r = find("T4_RELIC", "T5_RELIC");
  assert.strictEqual(r.sourceCount, 5);
  assert.strictEqual(r.silverCost, 0);
});
test("T7 Aval. Shard → T8 Aval. Shard: 5× source, 0 silver", () => {
  const r = find("T7_SHARD_AVALONIAN", "T8_SHARD_AVALONIAN");
  assert.strictEqual(r.sourceCount, 5);
  assert.strictEqual(r.silverCost, 0);
});

// ── 3. Bounds: the ladder stops at T4 (bottom) and T8 (top) ──
test("no tier-up below T4 or above T8", () => {
  const bad = tierUps.filter((r) => tierOf(r.sourceId) < 4 || tierOf(r.targetId) > 8);
  assert.strictEqual(bad.length, 0, bad.map((r) => r.sourceId).join(", "));
});
test("every tier-up climbs exactly one tier", () => {
  const bad = tierUps.filter((r) => tierOf(r.targetId) - tierOf(r.sourceId) !== 1);
  assert.strictEqual(bad.length, 0, bad.map((r) => `${r.sourceId}→${r.targetId}`).join(", "));
});

// ── 4. `tier` is the SOURCE tier (drives the Tier column / sort / filter) ──
test("tier field is the SOURCE tier", () => {
  assert.strictEqual(find("T4_RELIC", "T5_RELIC").tier, 4);
  assert.strictEqual(find("T7_RUNE", "T8_RUNE").tier, 7);
});

// ── 5. Type-up rows are untouched: still 1:1, still their in-game silver ──
test("15 type-up recipes remain (5 tiers × 3 transitions)", () =>
  assert.strictEqual(typeUps.length, 15));
test("every type-up stays 1:1 (sourceCount 1)", () => {
  const bad = typeUps.filter((r) => (r.sourceCount || 1) !== 1);
  assert.strictEqual(bad.length, 0, bad.map((r) => r.sourceId).join(", "));
});
test("T4 Rune→Soul keeps its 723 silver cost + label", () => {
  const r = find("T4_RUNE", "T4_SOUL");
  assert.strictEqual(r.silverCost, 723);
  assert.strictEqual(r.transition.label, "Rune → Soul");
});
test("T8 Soul→Relic keeps its 46240 silver cost", () =>
  assert.strictEqual(find("T8_SOUL", "T8_RELIC").silverCost, 46240));

// ── 6. Row-key invariant: (tier | transition.label) unique across ALL recipes ──
// getRowKey(transmute) = `${tier}|${transition.label}|${section}`; a collision
// scroll-jumps the viewport on price edit and corrupts suppress-sort order.
test("(tier, label) pairs stay unique across all transmute recipes", () => {
  const seen = new Map();
  for (const r of getTransmuteRecipes()) {
    const key = `${r.tier}|${r.transition.label}`;
    assert.ok(!seen.has(key), `duplicate row key ${JSON.stringify(key)} (${r.sourceId}→${r.targetId} vs ${seen.get(key)})`);
    seen.set(key, `${r.sourceId}→${r.targetId}`);
  }
});
test("every tier-up label shows the 5× ratio and the target tier", () => {
  for (const r of tierUps) {
    assert.ok(/^5× /.test(r.transition.label), `${r.sourceId}: ${r.transition.label}`);
    assert.ok(r.transition.label.includes(`T${tierOf(r.targetId)}`), `${r.sourceId}: ${r.transition.label}`);
  }
});

// ── 7. Scan ids: tier-ups reuse the material ids already fetched, none added ──
test("scan ids still cover every material id, deduped", () => {
  const ids = getTransmuteItemIds();
  const idSet = new Set(ids);
  assert.strictEqual(ids.length, idSet.size, "scan ids are not deduped");
  for (const fam of FAMILIES)
    for (let t = 4; t <= 8; t++) assert.ok(idSet.has(`T${t}_${fam}`), `missing T${t}_${fam}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
