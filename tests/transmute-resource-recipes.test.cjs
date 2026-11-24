/**
 * Test: resource transmutation recipes in the Transmute table.
 *
 * The Transmute table shows 1:1 resource upgrades alongside the existing
 * Rune→Soul→Relic→Shard material rows. Two transition kinds (from the in-game
 * Transmuting feature, Wild Blood Update values):
 *   - Tier-up:    T(n) → T(n+1), same resource type & enchant. Wood/Ore/Fiber/
 *                 Hide at every enchant 0-4; Stone at enchant 0 only.
 *   - Enchant-up: T(n).e → T(n).(e+1), same type & tier. Wood/Ore/Fiber/Hide
 *                 only (Stone has no enchanted variants).
 *
 * Silver costs are the live in-game values pulled from the wiki, keyed by the
 * RESULTING tier (tier-up) or RESULTING enchant (enchant-up). All five families
 * share identical item values per tier, so cost depends only on tier/enchant.
 *
 * Black-box: load resource-names.js + data-transmute.js in a vm sandbox and
 * inspect the recipe descriptors + scan id list the renderer/scan consume —
 * no DOM, no live API.
 *
 * Run: node tests/transmute-resource-recipes.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// data-transmute.js calls resourceShortName() (a function declaration in
// resource-names.js, so it leaks across vm scripts in a shared context) to build
// its labels. Load both into one sandbox, then read the builder functions out.
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
const getResourceTransmuteRecipes = vm.runInContext("getResourceTransmuteRecipes", sandbox);
const getMaterialTransmuteRecipes = vm.runInContext("getMaterialTransmuteRecipes", sandbox);
const getTransmuteRecipes = vm.runInContext("getTransmuteRecipes", sandbox);
const getTransmuteItemIds = vm.runInContext("getTransmuteItemIds", sandbox);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name}\n    ${e.message}`); }
}

const resRecipes = getResourceTransmuteRecipes();
const find = (sourceId, targetId) =>
  resRecipes.find((r) => r.sourceId === sourceId && r.targetId === targetId);
const cost = (sourceId, targetId) => {
  const r = find(sourceId, targetId);
  assert.ok(r, `no recipe ${sourceId} -> ${targetId}`);
  return r.silverCost;
};

console.log("Resource transmute recipes\n");

// ── 1. Tier-up silver cost, enchant 0 (cost keyed by the RESULTING tier) ──
const TIERUP_E0 = {
  "T4_ORE|T5_ORE": 781, "T5_FIBER|T6_FIBER": 1250,
  "T6_WOOD|T7_WOOD": 2500, "T7_HIDE|T8_HIDE": 5000,
};
for (const [pair, expect] of Object.entries(TIERUP_E0)) {
  const [s, t] = pair.split("|");
  test(`tier-up ${s}→${t} costs ${expect}`, () => assert.strictEqual(cost(s, t), expect));
}

// ── 2. Tier-up silver cost at higher enchant levels ──
const TIERUP_ENCH = {
  "T4_FIBER_LEVEL1@1|T5_FIBER_LEVEL1@1": 1563,
  "T4_ORE_LEVEL2@2|T5_ORE_LEVEL2@2": 3125,
  "T6_ORE_LEVEL3@3|T7_ORE_LEVEL3@3": 51975,
  "T7_WOOD_LEVEL4@4|T8_WOOD_LEVEL4@4": 779625,
};
for (const [pair, expect] of Object.entries(TIERUP_ENCH)) {
  const [s, t] = pair.split("|");
  test(`tier-up ${s}→${t} costs ${expect}`, () => assert.strictEqual(cost(s, t), expect));
}

// ── 3. Enchant-up silver cost (cost keyed by tier + the RESULTING enchant) ──
const ENCHUP = {
  "T4_ORE|T4_ORE_LEVEL1@1": 1500,
  "T7_FIBER|T7_FIBER_LEVEL1@1": 4800,
  "T6_WOOD_LEVEL2@2|T6_WOOD_LEVEL3@3": 19800,
  "T8_HIDE_LEVEL3@3|T8_HIDE_LEVEL4@4": 784440,
};
for (const [pair, expect] of Object.entries(ENCHUP)) {
  const [s, t] = pair.split("|");
  test(`enchant-up ${s}→${t} costs ${expect}`, () => assert.strictEqual(cost(s, t), expect));
}

// ── 4. Stone: tier-up only, enchant 0 only ──
test("stone tier-up T4_ROCK→T5_ROCK costs 1367", () => assert.strictEqual(cost("T4_ROCK", "T5_ROCK"), 1367));
test("stone tier-up T7_ROCK→T8_ROCK costs 16292", () => assert.strictEqual(cost("T7_ROCK", "T8_ROCK"), 16292));
test("stone has exactly 4 recipes (T4→T5 … T7→T8)", () =>
  assert.strictEqual(resRecipes.filter((r) => r.family === "ROCK").length, 4));
test("no enchanted stone recipe (no _LEVEL on any ROCK id)", () => {
  const bad = resRecipes.filter((r) => r.family === "ROCK" &&
    (/_LEVEL/.test(r.sourceId) || /_LEVEL/.test(r.targetId)));
  assert.strictEqual(bad.length, 0, bad.map((r) => r.sourceId).join(", "));
});
test("no stone enchant-up recipe (no same-tier ROCK transition)", () => {
  const bad = resRecipes.filter((r) => r.family === "ROCK" &&
    r.sourceId.split("_")[0] === r.targetId.split("_")[0]);
  assert.strictEqual(bad.length, 0);
});

// ── 5. Enchant id format is _LEVELn@n (never the bare @n form), plain at e0 ──
test("enchanted ids use the _LEVELn@n form", () => {
  const r = find("T4_ORE_LEVEL2@2", "T5_ORE_LEVEL2@2");
  assert.ok(r, "expected T4_ORE_LEVEL2@2 → T5_ORE_LEVEL2@2");
});
test("no recipe id uses the bare @n form without _LEVEL", () => {
  const bad = resRecipes.filter((r) =>
    /@\d/.test(r.sourceId) && !/_LEVEL\d+@\d/.test(r.sourceId));
  assert.strictEqual(bad.length, 0, bad.map((r) => r.sourceId).join(", "));
});
test("enchant 0 ids carry no suffix", () => {
  const r = find("T4_ORE", "T5_ORE");
  assert.ok(r && !/[_@]/.test(r.sourceId.replace("T4_ORE", "")), "T4_ORE should be bare");
});

// ── 6. Source/target relationship: 1:1, +1 tier or +1 enchant ──
test("every resource recipe is 1:1 with a single source and target", () => {
  assert.ok(resRecipes.every((r) => r.sourceId && r.targetId && r.sourceId !== r.targetId));
});
test("tier field is the SOURCE tier", () => {
  assert.strictEqual(find("T4_ORE", "T5_ORE").tier, 4);                       // tier-up
  assert.strictEqual(find("T6_WOOD_LEVEL1@1", "T6_WOOD_LEVEL2@2").tier, 6);   // enchant-up
});
test("every recipe has positive silver cost and a '→' label", () => {
  assert.ok(resRecipes.every((r) => r.silverCost > 0 && /→/.test(r.transition.label)));
});

// ── 7. Recipe counts encode the full spec ──
test("80 enchantable tier-up recipes (4 families × 4 steps × 5 enchants)", () => {
  const n = resRecipes.filter((r) => r.family !== "ROCK" &&
    r.sourceId.split("_")[0] !== r.targetId.split("_")[0]).length;
  assert.strictEqual(n, 80);
});
test("80 enchant-up recipes (4 families × 5 tiers × 4 steps)", () => {
  const n = resRecipes.filter((r) =>
    r.sourceId.split("_")[0] === r.targetId.split("_")[0]).length;
  assert.strictEqual(n, 80);
});
test("164 resource recipes total (80 + 80 + 4 stone)", () =>
  assert.strictEqual(resRecipes.length, 164));

// ── 8. Material rows untouched (regression) ──
// 15 type-up (5 tiers × 3 transitions) + 16 tier-up (4 families × 4 steps); the
// tier-ups are specified in tests/transmute-material-tier-up.test.cjs.
const matRecipes = getMaterialTransmuteRecipes();
test("31 material recipes (15 type-up + 16 tier-up)", () =>
  assert.strictEqual(matRecipes.length, 31));
test("T4 Rune→Soul keeps its 723 silver cost + label", () => {
  const r = matRecipes.find((m) => m.sourceId === "T4_RUNE" && m.targetId === "T4_SOUL");
  assert.ok(r, "missing T4_RUNE→T4_SOUL");
  assert.strictEqual(r.silverCost, 723);
  assert.strictEqual(r.transition.label, "Rune → Soul");
});
test("combined getTransmuteRecipes = materials + resources (195)", () =>
  assert.strictEqual(getTransmuteRecipes().length, 195));

// ── 9. Row-key invariant: (tier | transition.label) unique across ALL recipes ──
// getRowKey(transmute) = `${tier}|${transition.label}|${section}`. Within one
// section every coexisting row must get a distinct key, else editing a price
// scroll-jumps the viewport and suppress-sort corrupts row order.
test("(tier, label) pairs are unique across all transmute recipes", () => {
  const seen = new Map();
  for (const r of getTransmuteRecipes()) {
    const key = `${r.tier}|${r.transition.label}`;
    assert.ok(!seen.has(key), `duplicate row key ${JSON.stringify(key)} (${r.sourceId}→${r.targetId} vs ${seen.get(key)})`);
    seen.set(key, `${r.sourceId}→${r.targetId}`);
  }
});

// ── 10. Scan id list: resource ids included, materials kept, deduped ──
const ids = getTransmuteItemIds();
const idSet = new Set(ids);
test("scan ids include raw + enchanted resources and stone", () => {
  for (const id of ["T4_ORE", "T6_WOOD_LEVEL1@1", "T8_HIDE_LEVEL4@4", "T5_ROCK"])
    assert.ok(idSet.has(id), `missing ${id}`);
});
test("scan ids still include material ids (regression)", () => {
  for (const id of ["T4_RUNE", "T8_SHARD_AVALONIAN"]) assert.ok(idSet.has(id), `missing ${id}`);
});
test("scan ids are deduped", () => assert.strictEqual(ids.length, idSet.size));
test("scan id count = 125 (105 resource + 20 material)", () =>
  assert.strictEqual(idSet.size, 125));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
