/**
 * Test: Newly added cape families (Smuggler, Brecilien, Avalonian).
 * Validates that GEAR_CAPES contains T4-T8 entries for each family with
 * well-formed materials, craftType, group, and tier-correct names.
 *
 * Run: node tests/capes-missing-families.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadScript(filePath) {
  return fs.readFileSync(path.join(__dirname, "..", filePath), "utf-8");
}

const sandbox = { window: {}, document: { getElementById: () => null }, exports: {} };
vm.createContext(sandbox);
const scriptFiles = ["js/gear-capes.js"];
for (const s of scriptFiles) {
  try { vm.runInContext(loadScript(s), sandbox); }
  catch (e) { console.error(`Error loading ${s}: ${e.message}`); process.exit(1); }
}
const extract = (name) => vm.runInContext(name, sandbox);
const GEAR_CAPES = extract("GEAR_CAPES");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name}\n    ${e.message}`); }
}

const TIER_PREFIX = {
  T4: "Adept's",
  T5: "Expert's",
  T6: "Master's",
  T7: "Grandmaster's",
  T8: "Elder's",
};

const FAMILIES = [
  { idStem: "CAPEITEM_SMUGGLER",     label: "Smuggler" },
  { idStem: "CAPEITEM_FW_BRECILIEN", label: "Brecilien" },
  { idStem: "CAPEITEM_AVALON",       label: "Avalonian" },
];

const TIERS = ["T4", "T5", "T6", "T7", "T8"];
const capesById = new Map(GEAR_CAPES.map((c) => [c.id, c]));

console.log("\n=== Missing cape families exist in GEAR_CAPES ===");
FAMILIES.forEach(({ idStem, label }) => {
  TIERS.forEach((tier) => {
    const id = `${tier}_${idStem}`;
    test(`${id} is in GEAR_CAPES`, () => {
      assert.ok(capesById.has(id), `${id} missing from GEAR_CAPES`);
    });
  });
});

console.log("\n=== Each new cape has well-formed shape ===");
FAMILIES.forEach(({ idStem, label }) => {
  TIERS.forEach((tier) => {
    const id = `${tier}_${idStem}`;
    test(`${id} has valid shape`, () => {
      const cape = capesById.get(id);
      if (!cape) throw new Error(`${id} not found`);
      assert.strictEqual(typeof cape.name, "string");
      assert.ok(cape.name.length > 0, `${id} name is empty`);
      assert.strictEqual(cape.craftType, "cape", `${id} craftType is not "cape"`);
      assert.strictEqual(cape.group, "normal", `${id} group is not "normal"`);
      assert.ok(Array.isArray(cape.materials), `${id} materials is not an array`);
      assert.ok(cape.materials.length >= 1, `${id} materials is empty`);
      cape.materials.forEach((m, i) => {
        assert.strictEqual(typeof m.matId, "string", `${id} materials[${i}].matId not a string`);
        assert.ok(m.matId.length > 0, `${id} materials[${i}].matId is empty`);
        assert.strictEqual(typeof m.count, "number", `${id} materials[${i}].count not a number`);
        assert.ok(Number.isInteger(m.count), `${id} materials[${i}].count not an integer`);
        assert.ok(m.count > 0, `${id} materials[${i}].count is not positive`);
      });
    });
  });
});

console.log("\n=== Tier-prefix naming is correct ===");
FAMILIES.forEach(({ idStem, label }) => {
  TIERS.forEach((tier) => {
    const id = `${tier}_${idStem}`;
    test(`${id} name uses "${TIER_PREFIX[tier]}" prefix and includes "${label}"`, () => {
      const cape = capesById.get(id);
      if (!cape) throw new Error(`${id} not found`);
      assert.ok(
        cape.name.startsWith(TIER_PREFIX[tier]),
        `${id} name "${cape.name}" should start with "${TIER_PREFIX[tier]}"`,
      );
      assert.ok(
        cape.name.includes(label),
        `${id} name "${cape.name}" should include "${label}"`,
      );
      assert.ok(
        cape.name.endsWith(`[${tier}]`),
        `${id} name "${cape.name}" should end with "[${tier}]"`,
      );
    });
  });
});

console.log("\n=== No duplicate IDs in GEAR_CAPES ===");
test("all GEAR_CAPES ids are unique", () => {
  const ids = GEAR_CAPES.map((c) => c.id);
  const unique = new Set(ids);
  assert.strictEqual(ids.length, unique.size, `duplicate ids found: ${ids.length - unique.size}`);
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
