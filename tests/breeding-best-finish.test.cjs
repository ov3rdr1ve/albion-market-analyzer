/**
 * Test: a breeding row finishes its grown animal with the best-paying mount craft.
 *
 * The row used to chain to the FIRST MOUNT_RECIPES entry that consumes the grown
 * animal (Riding Horse), even when a later one (Armored Horse) nets more. Now:
 *
 *   buildGrownFinishRecipes(recipes) -> { grownId: [recipe, ...] } (declaration order,
 *                                        battlemounts skipped, only /^T\d_FARM_/ inputs)
 *   pickBestFinish(candidates)       -> the candidate with the highest sellNet - matCost
 *
 * Rules pinned: priced beats unpriced (even a negative net); ties and all-unpriced keep
 * declaration order; empty list -> null. Black-box, simulated data only.
 *
 * Run: node tests/breeding-best-finish.test.cjs
 */

const assert = require("assert");
const { buildGrownFinishRecipes, pickBestFinish } = require("../js/breeding-finish.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

console.log("\n=== Breeding: best finish ===");

// -- pickBestFinish ---------------------------------------------------------
const c = (recipeId, sellNet, matCost, priced = true) => ({ recipeId, sellNet, matCost, priced });
const PICK_CASES = [
  { name: "Armored beats Riding", list: [c("RIDING", 1000, 400), c("ARMORED", 1500, 500)], want: "ARMORED" },
  { name: "Riding beats Armored", list: [c("RIDING", 1500, 400), c("ARMORED", 1000, 500)], want: "RIDING" },
  { name: "tie -> first declared", list: [c("RIDING", 1000, 400), c("ARMORED", 1100, 500)], want: "RIDING" },
  { name: "unpriced loses to priced negative net", list: [c("RIDING", 0, 0, false), c("ARMORED", 100, 900)], want: "ARMORED" },
  { name: "priced first, unpriced second", list: [c("RIDING", 100, 900), c("ARMORED", 9999, 0, false)], want: "RIDING" },
  { name: "all unpriced -> first declared", list: [c("RIDING", 0, 0, false), c("ARMORED", 0, 0, false)], want: "RIDING" },
  { name: "single candidate", list: [c("ONLY", 5, 50)], want: "ONLY" },
  { name: "three-way, middle best", list: [c("A", 100, 50), c("B", 900, 50), c("C", 500, 50)], want: "B" },
  { name: "empty list -> null", list: [], want: null },
];
for (const k of PICK_CASES) {
  test(`pickBestFinish: ${k.name}`, () => {
    const r = pickBestFinish(k.list);
    assert.strictEqual(r ? r.recipeId : null, k.want);
  });
}
test("pickBestFinish does not mutate its input", () => {
  const list = [c("A", 1, 0), c("B", 9, 0)];
  const snap = JSON.stringify(list);
  pickBestFinish(list);
  assert.strictEqual(JSON.stringify(list), snap);
});

// -- buildGrownFinishRecipes ------------------------------------------------
const m = (id, mats, craftType) => ({ id, craftType, materials: mats.map((x) => ({ matId: x, count: 1 })) });
const SIM = [
  m("T8_MOUNT_HORSE", ["T8_FARM_HORSE_GROWN", "T8_LEATHER"]),
  m("T8_MOUNT_ARMORED_HORSE", ["T8_FARM_HORSE_GROWN", "T8_LEATHER"]),
  m("T8_MOUNT_OX", ["T8_FARM_OX_GROWN", "T8_LEATHER"]),
  m("T7_BATTLE", ["T7_FARM_HORSE_GROWN"], "battlemount"),
  m("T6_NO_FARM", ["T6_LEATHER", "T6_MOUNT_HORSE"]),
];
test("builder: all finishes per grown id, declaration order", () => {
  const map = buildGrownFinishRecipes(SIM);
  assert.deepStrictEqual(map["T8_FARM_HORSE_GROWN"].map((r) => r.id), ["T8_MOUNT_HORSE", "T8_MOUNT_ARMORED_HORSE"]);
  assert.deepStrictEqual(map["T8_FARM_OX_GROWN"].map((r) => r.id), ["T8_MOUNT_OX"]);
});
test("builder: battlemounts excluded", () => {
  assert.strictEqual(buildGrownFinishRecipes(SIM)["T7_FARM_HORSE_GROWN"], undefined);
});
test("builder: recipes without a T<n>_FARM_ input are skipped", () => {
  const map = buildGrownFinishRecipes(SIM);
  assert.ok(!Object.values(map).flat().some((r) => r.id === "T6_NO_FARM"));
});
test("builder: empty input -> empty map", () => {
  assert.deepStrictEqual(buildGrownFinishRecipes([]), {});
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
