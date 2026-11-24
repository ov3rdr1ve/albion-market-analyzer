/**
 * Test: js/buildings-upgrade-path.js — the upgrade ladder a building is reached by.
 *
 * A T8 building cannot be placed. You place the family's lowest tier and pay an
 * upgrade step per tier, so what a T8 Guild Hall COSTS is the sum of every step
 * from the chain root. The wiki publishes that running sum ("Total T1 mat.
 * required"), and the numbers pinned below are read off those tables:
 *   House      — https://wiki.albiononline.com/wiki/House
 *   Guild Hall — https://wiki.albiononline.com/wiki/Guild_Hall
 * Everything else is asserted against the real generated catalog, so the test
 * fails if buildings.xml drifts rather than restating the dump here.
 *
 * Black-box: only the three exported functions are called.
 *
 * Run: node tests/buildings-upgrade-path.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
function loadFile(rel) { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }

const mod = new Module("buildings-upgrade-path-test");
mod._compile(
  loadFile("js/data-buildings.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/buildings-upgrade-path.js").replace(/if \(typeof module[\s\S]*$/, "") +
    "\nmodule.exports = { BUILDINGS, getBuildingUpgradePath, rollupUpgradeMaterials, " +
    "sumUpgradeSilver };",
  "buildings-upgrade-path.js",
);
const { BUILDINGS, getBuildingUpgradePath, rollupUpgradeMaterials, sumUpgradeSilver } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const byId = new Map(BUILDINGS.map((b) => [b.id, b]));
const countOf = (mats, matId) => {
  const m = mats.find((x) => x.matId === matId);
  return m ? m.count : 0;
};

// ── Path shape, over the whole catalog ─────────────────────────────────────
console.log("\n=== Path shape ===");

test("every path ends at the requested building", () => {
  BUILDINGS.forEach((b) => {
    const p = getBuildingUpgradePath(b.id);
    assert.ok(p.length >= 1, `${b.id}: empty path`);
    assert.strictEqual(p[p.length - 1].id, b.id, `${b.id}: path ends at ${p[p.length - 1].id}`);
  });
});

test("every path is one family and rises one tier at a time", () => {
  BUILDINGS.forEach((b) => {
    const p = getBuildingUpgradePath(b.id);
    p.forEach((step, i) => {
      assert.strictEqual(step.family, b.family, `${b.id}: step ${step.id} is family ${step.family}`);
      if (i > 0) {
        assert.strictEqual(step.tier, p[i - 1].tier + 1,
          `${b.id}: ${p[i - 1].id} (T${p[i - 1].tier}) → ${step.id} (T${step.tier}) is not one tier`);
      }
    });
  });
});

test("every step but the last upgrades into the next one", () => {
  BUILDINGS.forEach((b) => {
    const p = getBuildingUpgradePath(b.id);
    for (let i = 0; i < p.length - 1; i++) {
      assert.strictEqual(p[i].upgradeableTo, p[i + 1].id,
        `${b.id}: ${p[i].id} upgrades to ${p[i].upgradeableTo}, not ${p[i + 1].id}`);
    }
  });
});

test("the path root is a building nothing upgrades into", () => {
  const targeted = new Set(BUILDINGS.map((b) => b.upgradeableTo).filter(Boolean));
  BUILDINGS.forEach((b) => {
    const root = getBuildingUpgradePath(b.id)[0];
    assert.ok(!targeted.has(root.id), `${b.id}: root ${root.id} is upgraded into by something`);
  });
});

test("an unknown id has no path", () => {
  assert.deepStrictEqual(getBuildingUpgradePath("T9_NOPE"), []);
  assert.deepStrictEqual(getBuildingUpgradePath(null), []);
});

// ── Chain roots ────────────────────────────────────────────────────────────
console.log("\n=== Chain roots ===");

[
  ["T8_PLAYERHOUSE", "T2_PLAYERHOUSE", 7],
  ["T8_GUILDHALL", "T2_GUILDHALL", 7],
  ["T8_FORGE", "T2_FORGE", 7],
  // Butcher and Saddler have no T2 in the dump — their ladders start at T3, so a
  // hardcoded "sum from T2" would invent a step that cannot be built.
  ["T8_BUTCHER", "T3_BUTCHER", 6],
  ["T8_STABLE", "T3_STABLE", 6],
  ["T5_PLAYERHOUSE", "T2_PLAYERHOUSE", 4],
].forEach(([id, root, len]) => {
  test(`${id} path is ${root} … (${len} steps)`, () => {
    const p = getBuildingUpgradePath(id);
    assert.strictEqual(p[0].id, root);
    assert.strictEqual(p.length, len);
  });
});

// Buildings with no ladder at all: farming plots, the one-off Artifact Foundry and
// Hideout, and T1_FORGE (a dead-end that the T2 ladder does NOT pass through).
["T1_FARMHOUSE", "T1_HERBGARDEN", "T1_PASTURE", "T1_KENNEL", "T1_MILL",
  "T8_MELDBUILDING", "UNIQUE_HIDEOUT", "T1_FORGE"].forEach((id) => {
  test(`${id} stands alone (path of 1)`, () => {
    const p = getBuildingUpgradePath(id);
    assert.strictEqual(p.length, 1, `${id}: path of ${p.length}`);
    assert.strictEqual(p[0].id, id);
  });
});

test("the T2 station ladder does not pass through T1_FORGE", () => {
  const ids = getBuildingUpgradePath("T8_FORGE").map((b) => b.id);
  assert.ok(!ids.includes("T1_FORGE"), `T1_FORGE is in ${ids.join(" → ")}`);
});

// ── Rolled-up materials, pinned to the wiki's totals ───────────────────────
console.log("\n=== Cumulative materials ===");

test("T8 House: 3,810 Rough Logs and 381 Rough Stone (wiki total)", () => {
  const mats = rollupUpgradeMaterials(getBuildingUpgradePath("T8_PLAYERHOUSE"));
  assert.strictEqual(countOf(mats, "T1_WOOD"), 3810);
  assert.strictEqual(countOf(mats, "T1_ROCK"), 381);
});

test("T8 House: 180 blocks of EVERY tier T2–T8", () => {
  const mats = rollupUpgradeMaterials(getBuildingUpgradePath("T8_PLAYERHOUSE"));
  for (let t = 2; t <= 8; t++) {
    assert.strictEqual(countOf(mats, `T${t}_STONEBLOCK`), 180, `T${t}_STONEBLOCK`);
  }
});

test("T8 Guild Hall: 19,050 Rough Logs and 1,905 Rough Stone (wiki total)", () => {
  const mats = rollupUpgradeMaterials(getBuildingUpgradePath("T8_GUILDHALL"));
  assert.strictEqual(countOf(mats, "T1_WOOD"), 19050);
  assert.strictEqual(countOf(mats, "T1_ROCK"), 1905);
});

test("T8 Guild Hall: 900 blocks of EVERY tier T2–T8", () => {
  const mats = rollupUpgradeMaterials(getBuildingUpgradePath("T8_GUILDHALL"));
  for (let t = 2; t <= 8; t++) {
    assert.strictEqual(countOf(mats, `T${t}_STONEBLOCK`), 900, `T${t}_STONEBLOCK`);
  }
});

test("T5 House matches the wiki's partial total (450 logs / 45 stone)", () => {
  const mats = rollupUpgradeMaterials(getBuildingUpgradePath("T5_PLAYERHOUSE"));
  assert.strictEqual(countOf(mats, "T1_WOOD"), 450);
  assert.strictEqual(countOf(mats, "T1_ROCK"), 45);
});

test("the rollup equals the per-step sums, for every building", () => {
  BUILDINGS.forEach((b) => {
    const p = getBuildingUpgradePath(b.id);
    const want = new Map();
    p.forEach((s) => s.materials.forEach((m) => {
      want.set(m.matId, (want.get(m.matId) || 0) + m.count);
    }));
    const got = rollupUpgradeMaterials(p);
    assert.strictEqual(got.length, want.size, `${b.id}: ${got.length} ids vs ${want.size}`);
    got.forEach((m) => assert.strictEqual(m.count, want.get(m.matId), `${b.id}: ${m.matId}`));
  });
});

test("a one-step path rolls up to that step's own bill", () => {
  const b = byId.get("T2_PLAYERHOUSE");
  const mats = rollupUpgradeMaterials(getBuildingUpgradePath("T2_PLAYERHOUSE"));
  assert.deepStrictEqual(mats, b.materials);
});

test("each material id appears exactly once", () => {
  BUILDINGS.forEach((b) => {
    const mats = rollupUpgradeMaterials(getBuildingUpgradePath(b.id));
    const ids = mats.map((m) => m.matId);
    assert.strictEqual(new Set(ids).size, ids.length, `${b.id}: duplicate id in ${ids.join(",")}`);
  });
});

test("materials are ordered by the tier that first needs them", () => {
  const mats = rollupUpgradeMaterials(getBuildingUpgradePath("T8_PLAYERHOUSE"));
  const ids = mats.map((m) => m.matId);
  // T1_WOOD / T1_ROCK are wanted by the T2 step, so they lead; the blocks then
  // follow in tier order because each is introduced one step later.
  assert.deepStrictEqual(ids.slice(0, 2), ["T1_WOOD", "T1_ROCK"]);
  assert.deepStrictEqual(ids.slice(2), [
    "T2_STONEBLOCK", "T3_STONEBLOCK", "T4_STONEBLOCK", "T5_STONEBLOCK",
    "T6_STONEBLOCK", "T7_STONEBLOCK", "T8_STONEBLOCK",
  ]);
});

test("an empty path rolls up to nothing", () => {
  assert.deepStrictEqual(rollupUpgradeMaterials([]), []);
});

// ── Silver ─────────────────────────────────────────────────────────────────
console.log("\n=== Cumulative silver ===");

test("silver is the sum of every step's fee", () => {
  BUILDINGS.forEach((b) => {
    const p = getBuildingUpgradePath(b.id);
    const want = p.reduce((s, x) => s + x.silverCost, 0);
    assert.strictEqual(sumUpgradeSilver(p), want, b.id);
  });
});

test("T8 House pays the placement fee seven times", () => {
  const p = getBuildingUpgradePath("T8_PLAYERHOUSE");
  assert.strictEqual(sumUpgradeSilver(p), 7 * byId.get("T8_PLAYERHOUSE").silverCost);
});

test("a standalone building pays its fee once", () => {
  assert.strictEqual(
    sumUpgradeSilver(getBuildingUpgradePath("UNIQUE_HIDEOUT")),
    byId.get("UNIQUE_HIDEOUT").silverCost);
});

test("an empty path costs no silver", () => {
  assert.strictEqual(sumUpgradeSilver([]), 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
