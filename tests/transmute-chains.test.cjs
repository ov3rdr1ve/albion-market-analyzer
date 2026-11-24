/**
 * Test: multi-step transmute chains (≥2 consecutive 1:1 steps).
 *
 * A chain buys the start node, pays the SUMMED per-step fees, and sells the end
 * node. Two axes:
 *   - enchant: same tier, e.g. 7.1 → 7.2 → 7.3 → 7.4 (Wood/Ore/Fiber/Hide)
 *   - tier:    same enchant, e.g. T4 → T5 → … → T8 (incl. Stone, enchant 0 only)
 * Fees reuse the single-step tables, summed along the path.
 *
 * The renderer groups candidates by (axis | end product) and shows the single
 * most profitable start; this file checks the static chain set the renderer
 * consumes: composition, summed fees, ids, labels, counts, and the
 * (tier|label) row-key invariant across singles + materials + chains.
 *
 * Black-box: load resource-names.js + data-transmute.js in a vm sandbox.
 *
 * Run: node tests/transmute-chains.test.cjs
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
  } catch (e) { console.error(`Error loading ${s}: ${e.message}`); process.exit(1); }
}
const getResourceTransmuteChains = vm.runInContext("getResourceTransmuteChains", sandbox);
const getTransmuteRecipes = vm.runInContext("getTransmuteRecipes", sandbox);
const getTransmuteItemIds = vm.runInContext("getTransmuteItemIds", sandbox);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name}\n    ${e.message}`); }
}

const chains = getResourceTransmuteChains();
const find = (sourceId, targetId) =>
  chains.find((c) => c.sourceId === sourceId && c.targetId === targetId);

console.log("Transmute chains\n");

// ── 1. Enchant chain composition (Wood T7 .1→.4) ──
test("enchant chain T7 logs .1→.4: steps, summed fee, ids, label", () => {
  const c = find("T7_WOOD_LEVEL1@1", "T7_WOOD_LEVEL4@4");
  assert.ok(c, "missing 7.1→7.4 wood chain");
  assert.strictEqual(c.axis, "enchant");
  assert.strictEqual(c.tier, 7);                       // start tier
  assert.strictEqual(c.steps.length, 3);
  assert.strictEqual(c.steps.map((s) => s.fee).join(","), "15120,49896,199584");
  assert.strictEqual(c.silverCost, 264600);            // 15120+49896+199584
  assert.strictEqual(c.transition.label, "7.1 → 7.2 → 7.3 → 7.4 logs");
  assert.strictEqual(c.groupKey, "enchant|T7_WOOD_LEVEL4@4");
});

// ── 2. Tier chain composition, enchant 0 (Ore T4→T7) ──
test("tier chain ore T4→T7 (e0): steps, summed fee, ids, label", () => {
  const c = find("T4_ORE", "T7_ORE");
  assert.ok(c, "missing T4→T7 ore chain");
  assert.strictEqual(c.axis, "tier");
  assert.strictEqual(c.tier, 4);
  assert.strictEqual(c.steps.map((s) => s.fee).join(","), "781,1250,2500");
  assert.strictEqual(c.silverCost, 4531);
  assert.strictEqual(c.transition.label, "4 → 5 → 6 → 7 ore");
  assert.strictEqual(c.groupKey, "tier|T7_ORE");
});

// ── 3. Enchanted tier chain (Hide T4.2→T6.2) ──
test("tier chain hide T4.2→T6.2: enchanted ids + fee", () => {
  const c = find("T4_HIDE_LEVEL2@2", "T6_HIDE_LEVEL2@2");
  assert.ok(c, "missing T4.2→T6.2 hide chain");
  assert.strictEqual(c.steps.map((s) => s.fee).join(","), "3125,5000");
  assert.strictEqual(c.silverCost, 8125);
  assert.strictEqual(c.transition.label, "4.2 → 5.2 → 6.2 hide");
});

// ── 4. Stone: tier chains only, enchant 0 ──
test("stone tier chain T4→T8: 4 steps summing 27243", () => {
  const c = find("T4_ROCK", "T8_ROCK");
  assert.ok(c, "missing stone T4→T8 chain");
  assert.strictEqual(c.steps.map((s) => s.fee).join(","), "1367,3057,6527,16292");
  assert.strictEqual(c.silverCost, 27243);
  assert.strictEqual(c.transition.label, "4 → 5 → 6 → 7 → 8 rock");
});
test("no enchant chains for stone", () =>
  assert.strictEqual(chains.filter((c) => c.family === "ROCK" && c.axis === "enchant").length, 0));
test("no enchanted stone chain ids", () =>
  assert.strictEqual(chains.filter((c) => c.family === "ROCK" && /_LEVEL/.test(c.sourceId)).length, 0));

// ── 4b. Mixed chains — step up BOTH tier and enchant, cheapest path wins ──
// Each step is +1 tier OR +1 enchant; the per-step fee depends on the node it
// passes through, so the cheapest path is NOT a naive concat. The generator
// runs a min-fee solver per (start,end) where both axes strictly increase.
test("mixed chain ore T6.0→T8.2: min-fee path 6→7→8→8.1→8.2, summed 67260", () => {
  const c = find("T6_ORE", "T8_ORE_LEVEL2@2");
  assert.ok(c, "missing mixed T6.0→T8.2 ore chain");
  assert.strictEqual(c.axis, "mixed");
  assert.strictEqual(c.tier, 6);                       // SOURCE tier
  assert.strictEqual(c.steps.length, 4);
  assert.strictEqual(c.steps.map((s) => s.fee).join(","), "2500,5000,14400,45360");
  assert.strictEqual(c.silverCost, 67260);             // beats ench-first 6→7→7.1→7.2→8.2 (69670)
  assert.strictEqual(c.transition.label, "6 → 7 → 8 → 8.1 → 8.2 ore");
  assert.strictEqual(c.groupKey, "mixed|T8_ORE_LEVEL2@2");
});

test("mixed chain ore T7.0→T8.1: tier-first 7→8→8.1 (19400) beats ench-first (19800)", () => {
  const c = find("T7_ORE", "T8_ORE_LEVEL1@1");
  assert.ok(c, "missing mixed T7.0→T8.1 ore chain");
  assert.strictEqual(c.silverCost, 19400);             // TIERUP[8][0]=5000 + ENCHUP[8][1]=14400
  assert.strictEqual(c.transition.label, "7 → 8 → 8.1 ore");
});

test("400 mixed chains (4 fam × 10 tier-pairs × 10 ench-pairs)", () =>
  assert.strictEqual(chains.filter((c) => c.axis === "mixed").length, 400));
test("no mixed chains for stone", () =>
  assert.strictEqual(chains.filter((c) => c.axis === "mixed" && c.family === "ROCK").length, 0));
test("every mixed chain strictly increases BOTH tier and enchant", () => {
  const re = /^T(\d+)_(?:WOOD|ORE|FIBER|HIDE|ROCK)(?:_LEVEL(\d+))?/;
  chains.filter((c) => c.axis === "mixed").forEach((c) => {
    const s = c.sourceId.match(re), t = c.targetId.match(re);
    const sT = +s[1], sE = +(s[2] || 0), tT = +t[1], tE = +(t[2] || 0);
    assert.ok(tT > sT && tE > sE, `${c.sourceId}→${c.targetId} does not move both axes`);
  });
});
test("64 distinct mixed end-product groups (4 fam × tiers 5-8 × ench 1-4)", () =>
  assert.strictEqual(
    new Set(chains.filter((c) => c.axis === "mixed").map((c) => c.groupKey)).size, 64));

// ── 5. Structural invariants ──
test("every chain is ≥2 steps", () =>
  assert.ok(chains.every((c) => c.steps.length >= 2)));
test("sourceId is the first step's from, targetId is the last step's to", () =>
  assert.ok(chains.every((c) =>
    c.sourceId === c.steps[0].fromId && c.targetId === c.steps[c.steps.length - 1].toId)));
test("silverCost equals the sum of step fees", () =>
  assert.ok(chains.every((c) => c.silverCost === c.steps.reduce((a, s) => a + s.fee, 0))));
test("groupKey is axis|targetId", () =>
  assert.ok(chains.every((c) => c.groupKey === `${c.axis}|${c.targetId}`)));

// ── 6. Counts ──
test("120 enchant chains (4 fam × 5 tiers × 6 pairs)", () =>
  assert.strictEqual(chains.filter((c) => c.axis === "enchant").length, 120));
test("126 tier chains (4 fam × 5 ench × 6 + stone 6)", () =>
  assert.strictEqual(chains.filter((c) => c.axis === "tier").length, 126));
test("646 chains total (120 enchant + 126 tier + 400 mixed)", () =>
  assert.strictEqual(chains.length, 646));
test("187 distinct (axis,end) groups (123 single-axis + 64 mixed)", () =>
  assert.strictEqual(new Set(chains.map((c) => c.groupKey)).size, 187));

// ── 7. Row-key invariant: (tier|label) unique across singles + materials + chains ──
test("(tier, label) unique across all transmute rows (singles + chains)", () => {
  const all = [...getTransmuteRecipes(), ...chains];
  const seen = new Map();
  for (const r of all) {
    const key = `${r.tier}|${r.transition.label}`;
    assert.ok(!seen.has(key),
      `duplicate ${JSON.stringify(key)} (${r.sourceId}→${r.targetId} vs ${seen.get(key)})`);
    seen.set(key, `${r.sourceId}→${r.targetId}`);
  }
});

// ── 8. Chain endpoints are already in the scan id set (no new fetch needed) ──
test("chain start/end ids ⊆ getTransmuteItemIds()", () => {
  const ids = new Set(getTransmuteItemIds());
  const missing = chains.flatMap((c) => [c.sourceId, c.targetId]).filter((id) => !ids.has(id));
  assert.strictEqual(missing.length, 0, `missing: ${[...new Set(missing)].join(", ")}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
