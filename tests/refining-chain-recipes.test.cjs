/**
 * Test: REFINING_RECIPES data sanity.
 *
 * REFINING_RECIPES is built at load time from RESOURCE_DEFS — one entry per
 * (tier × resource × enchant) for tiers T2-T8. Tests verify:
 *   - Coverage: every T4-T8 × {wood, ore, hide, fiber, rock} × {0..4} exists,
 *     plus the plain-only T2/T3 entries
 *   - Field shape: rawId, secondaryMatId, rawRatio, resourceType, tier, enchant
 *   - Enchant rule: T4.X plank's secondary is PLAIN T3 (not T3.X);
 *     T5+.X inherits the enchant
 *   - Raw ratios match RESOURCE_DEFS [1, 2, 2, 3, 4, 5, 5] for T2..T8
 *   - MIN_CHAIN_TIER is 2, and T2 refines from raw alone (no T1 secondary)
 *
 * Run: node tests/refining-chain-recipes.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

// Minimal RESOURCE_DEFS stub matching the real one in js/data.js:743.
// Only `type`, `raw`, `refined`, and the rawRatio in tiers tuples matter for
// recipe building. Names are not consulted by the builder.
const sandbox = `
const RESOURCE_DEFS = [
  { type: "wood",  raw: "WOOD",  refined: "PLANKS",
    tiers: [[2,"","",1],[3,"","",2],[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
  { type: "ore",   raw: "ORE",   refined: "METALBAR",
    tiers: [[2,"","",1],[3,"","",2],[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
  { type: "hide",  raw: "HIDE",  refined: "LEATHER",
    tiers: [[2,"","",1],[3,"","",2],[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
  { type: "fiber", raw: "FIBER", refined: "CLOTH",
    tiers: [[2,"","",1],[3,"","",2],[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
  { type: "rock",  raw: "ROCK",  refined: "STONEBLOCK",
    tiers: [[2,"","",1],[3,"","",2],[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
];
// Mirror of js/data.js: stone's REFINED block never enchants, so the recipe
// builder caps rock's enchant loop at 0 (no fictional T*_STONEBLOCK_LEVELn).
const MIN_RESOURCE_ENCHANT_TIER = 4;
const NON_ENCHANTABLE_REFINED_TYPES = new Set(["rock"]);
function refinedMaxEnchant(type, tier) {
  if (NON_ENCHANTABLE_REFINED_TYPES.has(type)) return 0;
  return tier >= MIN_RESOURCE_ENCHANT_TIER ? 4 : 0;
}
`;

function loadFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const refiningRecipesSrc = loadFile("js/refining-chain-recipes.js");

const mod = new Module("refining-recipes-test");
mod._compile(
  sandbox + refiningRecipesSrc +
    "\nmodule.exports = { REFINING_RECIPES, MIN_CHAIN_TIER };",
  "refining-chain-recipes.js"
);
const { REFINING_RECIPES, MIN_CHAIN_TIER } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// ── Constants ─────────────────────────────────────────────────────────────
console.log("\n=== Constants ===");

test("MIN_CHAIN_TIER is 2 (T2/T3 refine too — T1 refined does not exist)", () => {
  assert.strictEqual(MIN_CHAIN_TIER, 2);
});

// ── Coverage ──────────────────────────────────────────────────────────────
console.log("\n=== Coverage ===");

const RESOURCES = [
  { type: "wood",  refined: "PLANKS" },
  { type: "ore",   refined: "METALBAR" },
  { type: "hide",  refined: "LEATHER" },
  { type: "fiber", refined: "CLOTH" },
  { type: "rock",  refined: "STONEBLOCK" },
];
const ENCHANTABLE = RESOURCES.filter((r) => r.type !== "rock");
const TIERS = [4, 5, 6, 7, 8];
const LOW_TIERS = [2, 3];
const ENCHANTS = [0, 1, 2, 3, 4];
const RAW_RATIOS = { 2: 1, 3: 2, 4: 2, 5: 3, 6: 4, 7: 5, 8: 5 };

test("All T4-T8 × 4 enchantable resources × 5 enchants + rock plain + T2/T3 plain = 115 entries", () => {
  let count = 0;
  for (const r of ENCHANTABLE) {
    for (const t of TIERS) {
      for (const e of ENCHANTS) {
        const suffix = e ? `_LEVEL${e}@${e}` : "";
        const matId = `T${t}_${r.refined}${suffix}`;
        assert.ok(REFINING_RECIPES[matId], `missing recipe for ${matId}`);
        count++;
      }
    }
  }
  // Rock: only the PLAIN block per tier (refined stone never enchants).
  for (const t of TIERS) {
    assert.ok(REFINING_RECIPES[`T${t}_STONEBLOCK`], `missing plain T${t}_STONEBLOCK`);
    count++;
  }
  // T2/T3: plain only — resources do not enchant below T4.
  for (const r of RESOURCES) {
    for (const t of LOW_TIERS) {
      assert.ok(REFINING_RECIPES[`T${t}_${r.refined}`], `missing plain T${t}_${r.refined}`);
      count++;
    }
  }
  assert.strictEqual(count, 115);
});

test("T2/T3 carry NO enchanted recipes (resources enchant from T4 up)", () => {
  for (const r of RESOURCES) {
    for (const t of LOW_TIERS) {
      for (let e = 1; e <= 4; e++) {
        const id = `T${t}_${r.refined}_LEVEL${e}@${e}`;
        assert.strictEqual(REFINING_RECIPES[id], undefined, `fictional recipe leaked: ${id}`);
      }
    }
  }
});

test("rock has NO enchanted stoneblock recipes (refined block stays flat)", () => {
  for (const t of TIERS) {
    for (let e = 1; e <= 4; e++) {
      const id = `T${t}_STONEBLOCK_LEVEL${e}@${e}`;
      assert.strictEqual(REFINING_RECIPES[id], undefined, `fictional recipe leaked: ${id}`);
    }
  }
});

test("no recipe consumes pristine (.4) raw rock — no pristine rock exists", () => {
  for (const t of TIERS) {
    // The plain T*_STONEBLOCK recipe must source plain T*_ROCK, never an enchanted raw.
    assert.strictEqual(REFINING_RECIPES[`T${t}_STONEBLOCK`].rawId, `T${t}_ROCK`);
  }
  const leaked = Object.values(REFINING_RECIPES).filter((r) => /_ROCK_LEVEL\d+@\d+$/.test(r.rawId));
  assert.strictEqual(leaked.length, 0, `enchanted rock raw leaked: ${leaked.map((r) => r.rawId).join(", ")}`);
});

// ── Field shape ───────────────────────────────────────────────────────────
console.log("\n=== Field shape ===");

test("T4_PLANKS recipe has correct fields (no enchant)", () => {
  const r = REFINING_RECIPES.T4_PLANKS;
  assert.strictEqual(r.rawId, "T4_WOOD");
  assert.strictEqual(r.rawRatio, 2);
  assert.strictEqual(r.secondaryMatId, "T3_PLANKS");
  assert.strictEqual(r.secondaryMatCount, 1);
  assert.strictEqual(r.resourceType, "wood");
  assert.strictEqual(r.tier, 4);
  assert.strictEqual(r.enchant, 0);
});

// T2 is the floor of the ladder: items.xml refines T2_CLOTH from 1x T2_FIBER and
// nothing else, and no T1 refined product exists to stand in as a secondary.
test("T2_CLOTH refines from raw alone — no secondary at the bottom of the ladder", () => {
  const r = REFINING_RECIPES.T2_CLOTH;
  assert.strictEqual(r.rawId, "T2_FIBER");
  assert.strictEqual(r.rawRatio, 1);
  assert.strictEqual(r.secondaryMatId, null);
  assert.strictEqual(r.secondaryMatCount, 0);
  assert.strictEqual(r.resourceType, "fiber");
  assert.strictEqual(r.tier, 2);
  assert.strictEqual(r.enchant, 0);
});

test("T3_CLOTH is 2x raw + 1x T2_CLOTH (items.xml)", () => {
  const r = REFINING_RECIPES.T3_CLOTH;
  assert.strictEqual(r.rawId, "T3_FIBER");
  assert.strictEqual(r.rawRatio, 2);
  assert.strictEqual(r.secondaryMatId, "T2_CLOTH");
  assert.strictEqual(r.secondaryMatCount, 1);
  assert.strictEqual(r.tier, 3);
});

test("every T2 recipe drops its secondary; every T3 recipe keeps one", () => {
  for (const r of RESOURCES) {
    const t2 = REFINING_RECIPES[`T2_${r.refined}`];
    assert.strictEqual(t2.secondaryMatId, null, `T2_${r.refined} must have no secondary`);
    assert.strictEqual(t2.secondaryMatCount, 0);
    const t3 = REFINING_RECIPES[`T3_${r.refined}`];
    assert.strictEqual(t3.secondaryMatId, `T2_${r.refined}`);
    assert.strictEqual(t3.secondaryMatCount, 1);
  }
});

test("T8_METALBAR recipe has rawRatio 5", () => {
  const r = REFINING_RECIPES.T8_METALBAR;
  assert.strictEqual(r.rawId, "T8_ORE");
  assert.strictEqual(r.rawRatio, 5);
  assert.strictEqual(r.secondaryMatId, "T7_METALBAR");
  assert.strictEqual(r.resourceType, "ore");
  assert.strictEqual(r.tier, 8);
});

// ── Raw ratios ────────────────────────────────────────────────────────────
console.log("\n=== Raw ratios ===");

test("rawRatio matches RESOURCE_DEFS pattern [1,2,2,3,4,5,5] across tiers and resources", () => {
  for (const r of RESOURCES) {
    for (const t of [...LOW_TIERS, ...TIERS]) {
      const matId = `T${t}_${r.refined}`;
      const rec = REFINING_RECIPES[matId];
      assert.strictEqual(
        rec.rawRatio, RAW_RATIOS[t],
        `${matId} rawRatio expected ${RAW_RATIOS[t]}, got ${rec.rawRatio}`
      );
    }
  }
});

// ── Enchant rule (the critical edge case) ────────────────────────────────
console.log("\n=== Enchant rule ===");

test("T4.1 plank's secondary is PLAIN T3_PLANKS (not T3_PLANKS_LEVEL1)", () => {
  const r = REFINING_RECIPES["T4_PLANKS_LEVEL1@1"];
  assert.ok(r);
  assert.strictEqual(r.secondaryMatId, "T3_PLANKS",
    "T4 enchanted refining uses plain T3 secondary per items.xml");
  assert.strictEqual(r.rawId, "T4_WOOD_LEVEL1@1");
  assert.strictEqual(r.enchant, 1);
});

test("T5.1 plank's secondary is T4_PLANKS_LEVEL1@1 (enchant inherits T5+)", () => {
  const r = REFINING_RECIPES["T5_PLANKS_LEVEL1@1"];
  assert.ok(r);
  assert.strictEqual(r.secondaryMatId, "T4_PLANKS_LEVEL1@1");
  assert.strictEqual(r.rawId, "T5_WOOD_LEVEL1@1");
});

test("T8.4 plank's secondary is T7_PLANKS_LEVEL4@4 (deepest enchant chain root)", () => {
  const r = REFINING_RECIPES["T8_PLANKS_LEVEL4@4"];
  assert.ok(r);
  assert.strictEqual(r.secondaryMatId, "T7_PLANKS_LEVEL4@4");
  assert.strictEqual(r.rawId, "T8_WOOD_LEVEL4@4");
  assert.strictEqual(r.enchant, 4);
});

test("T4 enchanted secondary boundary holds for the 4 enchantable resources × 4 enchants", () => {
  for (const r of ENCHANTABLE) {
    for (let ench = 1; ench <= 4; ench++) {
      const matId = `T4_${r.refined}_LEVEL${ench}@${ench}`;
      const rec = REFINING_RECIPES[matId];
      assert.ok(rec, `missing ${matId}`);
      assert.strictEqual(
        rec.secondaryMatId, `T3_${r.refined}`,
        `${matId} should use plain T3 secondary, got ${rec.secondaryMatId}`
      );
    }
  }
});

// ── Resource type tagging ────────────────────────────────────────────────
console.log("\n=== Resource type ===");

test("resourceType tag matches RESOURCE_DEFS for each refined family", () => {
  const expected = {
    PLANKS: "wood",
    METALBAR: "ore",
    LEATHER: "hide",
    CLOTH: "fiber",
    STONEBLOCK: "rock",
  };
  for (const [family, type] of Object.entries(expected)) {
    const r = REFINING_RECIPES[`T4_${family}`];
    assert.strictEqual(r.resourceType, type);
  }
});

// ── Negative cases ────────────────────────────────────────────────────────
console.log("\n=== Negative cases ===");

test("T1 refined ids have NO recipe (the ladder bottoms out at T2)", () => {
  assert.strictEqual(REFINING_RECIPES.T1_PLANKS, undefined);
  assert.strictEqual(REFINING_RECIPES.T1_CLOTH, undefined);
});

test("no recipe names a T1 secondary — T1 refined products do not exist", () => {
  const leaked = Object.entries(REFINING_RECIPES)
    .filter(([, r]) => r.secondaryMatId && /^T1_/.test(r.secondaryMatId))
    .map(([id]) => id);
  assert.deepStrictEqual(leaked, []);
});

test("Raw ids have NO recipe (raws are not refined products)", () => {
  assert.strictEqual(REFINING_RECIPES.T4_WOOD, undefined);
  assert.strictEqual(REFINING_RECIPES.T8_ORE, undefined);
});

test("Non-resource ids have NO recipe", () => {
  assert.strictEqual(REFINING_RECIPES.T4_BREAD, undefined);
  assert.strictEqual(REFINING_RECIPES["T6_2H_NATURESTAFF"], undefined);
});

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
