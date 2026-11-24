/**
 * Test: which fragment families the Artifact Rolling table prices.
 *
 * The table prices the RANDOM meld at the Artifact Foundry — 36 fragments for
 * an unfiltered roll, 50 for one filtered to a class. Exactly four families go
 * through it: Rune, Soul, Relic, Avalonian Shard.
 *
 * Crystal Shards and Fire Dragon Scales must NOT be here. They are not melded:
 * 50 of either buys the artifact you PICK at the Energy Manipulator, so they
 * are deterministic crafting rows (js/data-energy-exchange.js, guarded by
 * tests/energy-manipulator-exchange.test.cjs). Pricing them as a roll would
 * quote a random outcome for a play that lets you choose — and a 36-fragment
 * "Any" column for a purchase that always costs 50.
 *
 * Black-box: drives the real ROLL_COSTS / fragment maps / category chooser out
 * of js/render-rolling.js against the real ARTIFACT_MAPPING. No live API or DB.
 *
 * Run: node tests/artifact-rolling-families.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

function load(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

// render-rolling.js is a browser module; it only needs enough globals to parse.
const stubs = [
  "const PREMIUM_TAX = 0.04;",
  "const SETUP_FEE = 0.025;",
  "function tx(s) { return s; }",
  "",
].join("\n");

const mod = new Module("rolling-families-test");
mod._compile(
  stubs +
    load("js/data-artifacts.js") +
    load("js/render-rolling.js") +
    "\nmodule.exports = { ARTIFACT_MAPPING, ROLL_COSTS, ROLL_TYPES, ROLL_FRAGMENT_ID_BY_TYPE, ROLL_FRAGMENT_LABEL, rollCategoriesFor, rollCostFor, getArtifactShortName };",
  "rolling-families-test.js"
);
const {
  ARTIFACT_MAPPING,
  ROLL_COSTS,
  ROLL_TYPES,
  ROLL_FRAGMENT_ID_BY_TYPE,
  ROLL_FRAGMENT_LABEL,
  rollCategoriesFor,
  rollCostFor,
  getArtifactShortName,
} = mod.exports;

const EXCHANGE_FAMILIES = ["Crystal", "Dragon"];

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name + " — " + e.message); failed++; }
}

console.log("\n=== The table prices the four random meld families ===");
test("ROLL_TYPES is Rune / Soul / Relic / Avalonian", () => {
  assert.deepStrictEqual(ROLL_TYPES, ["Rune", "Soul", "Relic", "Avalonian"]);
});
test("every roll type has both a fragment id and a label", () => {
  for (const t of ROLL_TYPES) {
    assert.ok(ROLL_FRAGMENT_ID_BY_TYPE[t], t + " has no fragment id");
    assert.ok(ROLL_FRAGMENT_LABEL[t], t + " has no label");
  }
});
test("the fragment maps carry nothing beyond those four", () => {
  assert.deepStrictEqual(Object.keys(ROLL_FRAGMENT_ID_BY_TYPE).sort(), [...ROLL_TYPES].sort());
  assert.deepStrictEqual(Object.keys(ROLL_FRAGMENT_LABEL).sort(), [...ROLL_TYPES].sort());
});
test("each family maps to a real items.xml fragment id at every tier", () => {
  const xml = load("data/dumps/items.xml");
  for (const t of ROLL_TYPES) {
    for (const tier of [4, 5, 6, 7, 8]) {
      const id = "T" + tier + "_" + ROLL_FRAGMENT_ID_BY_TYPE[t];
      assert.ok(xml.includes('uniquename="' + id + '"'), id + " is not a real id");
    }
  }
});

console.log("\n=== Roll costs: 36 unfiltered, 50 class-filtered ===");
test("all four families offer Any + all three classes", () => {
  for (const t of ROLL_TYPES) {
    assert.deepStrictEqual(rollCategoriesFor(t), ["Any", "Warrior", "Mage", "Hunter"],
      t + " lost a category");
  }
});
test("an unfiltered meld costs 36, a class-filtered one 50", () => {
  for (const t of ROLL_TYPES) {
    assert.strictEqual(rollCostFor(t, "Any"), 36, t + " Any");
    for (const cat of ["Warrior", "Mage", "Hunter"]) {
      assert.strictEqual(rollCostFor(t, cat), 50, t + " " + cat);
    }
  }
});
test("ROLL_COSTS carries no per-family exception", () => {
  assert.deepStrictEqual(ROLL_COSTS, { Any: 36, Warrior: 50, Mage: 50, Hunter: 50 });
});

console.log("\n=== Energy Manipulator families stay out ===");
test("neither Crystal nor Dragon is a roll type", () => {
  for (const fam of EXCHANGE_FAMILIES) {
    assert.ok(!ROLL_TYPES.includes(fam), fam + " is still priced as a roll");
  }
});
test("neither has a fragment id or a label in this table", () => {
  for (const fam of EXCHANGE_FAMILIES) {
    assert.strictEqual(ROLL_FRAGMENT_ID_BY_TYPE[fam], undefined, fam + " id");
    assert.strictEqual(ROLL_FRAGMENT_LABEL[fam], undefined, fam + " label");
  }
});
test("neither has a roll cost", () => {
  for (const fam of EXCHANGE_FAMILIES) {
    assert.strictEqual(ROLL_COSTS[fam], undefined, fam + " still has a roll cost");
  }
});
test("no roll type would price a crystal or dragonhide artifact", () => {
  const rollable = new Set(ROLL_TYPES);
  for (const [suffix, info] of Object.entries(ARTIFACT_MAPPING)) {
    if (!EXCHANGE_FAMILIES.includes(info.tier)) continue;
    assert.ok(!rollable.has(info.tier), suffix + " is reachable from a roll group");
  }
});

console.log("\n=== The artifact catalog still names them ===");
test("Crystal and Dragon artifacts stay in ARTIFACT_MAPPING for their names", () => {
  // The flip catalog and the exchange catalog both read these entries; only the
  // Rolling table stopped looking at them.
  assert.strictEqual(getArtifactShortName("HEAD_LEATHER_DRAGON"), "Dragonhide Crown");
  assert.strictEqual(getArtifactShortName("ARMOR_LEATHER_DRAGON"), "Dragonhide Padding");
  assert.strictEqual(getArtifactShortName("SHOES_LEATHER_DRAGON"), "Dragonhide Trim");
  assert.strictEqual(getArtifactShortName("2H_HOLYSTAFF_CRYSTAL"), "Exalted Crystal");
});

console.log("\n" + "=".repeat(50));
console.log("Total: " + (passed + failed) + " | Passed: " + passed + " | Failed: " + failed);
if (failed > 0) process.exit(1);
