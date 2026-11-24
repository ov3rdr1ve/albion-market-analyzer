/**
 * Test: Exalted Staff and Arctic Staff use the correct Albion item IDs
 * (2H_HOLYSTAFF_CRYSTAL / 2H_FROSTSTAFF_CRYSTAL, not MAIN_EXALTEDSTAFF_CRYSTAL /
 * MAIN_ARCTICSTAFF_CRYSTAL) and the correct recipes — verified against the
 * items.xml game dump AND the Albion wiki (2026-05-29):
 *   Exalted Staff = 20 Pine Planks + 12 Fine Cloth + 1 Crystal
 *   Arctic Staff  = 20 Pine Planks + 12 Steel Bar (METALBAR, NOT Cloth) + 1 Crystal
 *
 * Run: node tests/exalted-staff-id-fix.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadScript(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf-8");
}

const sandbox = { window: {}, document: { getElementById: () => null }, exports: {} };
vm.createContext(sandbox);
for (const s of ["js/data-artifacts.js", "js/gear-crystal-weapons.js"]) {
  try { vm.runInContext(loadScript(s), sandbox); }
  catch (e) { console.error(`Error loading ${s}: ${e.message}`); process.exit(1); }
}
const extract = (name) => vm.runInContext(name, sandbox);
const GEAR_CRYSTAL_WEAPONS = extract("GEAR_CRYSTAL_WEAPONS");
const ARTIFACT_MAPPING = extract("ARTIFACT_MAPPING");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Exalted/Arctic Staff ID & Material Fix Tests\n");

const fixedWeapons = [
  { suffix: "2H_HOLYSTAFF_CRYSTAL",  craftType: "holystaff",  subcat: "holystaff",  name: "Exalted Crystal",
    recipe: { T4_PLANKS: 20, T4_CLOTH: 12, T4_ARTEFACT_2H_HOLYSTAFF_CRYSTAL: 1 } },
  { suffix: "2H_FROSTSTAFF_CRYSTAL", craftType: "froststaff", subcat: "froststaff", name: "Icy Crystal",
    recipe: { T4_PLANKS: 20, T4_METALBAR: 12, T4_ARTEFACT_2H_FROSTSTAFF_CRYSTAL: 1 } },
];
const oldBadKeys = ["MAIN_EXALTEDSTAFF_CRYSTAL", "MAIN_ARCTICSTAFF_CRYSTAL"];

for (const fw of fixedWeapons) {
  test(`ARTIFACT_MAPPING has ${fw.suffix}`, () => {
    assert.ok(ARTIFACT_MAPPING[fw.suffix], `Missing ${fw.suffix}`);
    assert.strictEqual(ARTIFACT_MAPPING[fw.suffix].tier, "Crystal");
    assert.strictEqual(ARTIFACT_MAPPING[fw.suffix].subcat, fw.subcat);
    assert.strictEqual(ARTIFACT_MAPPING[fw.suffix].name, fw.name);
  });
}

test("ARTIFACT_MAPPING no longer has old MAIN_* keys", () => {
  for (const bad of oldBadKeys) {
    assert.strictEqual(ARTIFACT_MAPPING[bad], undefined, `Stale key still present: ${bad}`);
  }
});

for (const fw of fixedWeapons) {
  test(`GEAR_CRYSTAL_WEAPONS has T4-T8 ${fw.suffix}`, () => {
    for (let t = 4; t <= 8; t++) {
      const id = `T${t}_${fw.suffix}`;
      const item = GEAR_CRYSTAL_WEAPONS.find((i) => i.id === id);
      assert.ok(item, `Missing ${id}`);
      assert.strictEqual(item.craftType, fw.craftType);
      assert.strictEqual(item.group, "artifact");
    }
  });

  test(`${fw.suffix}: recipe matches current game (items.xml + wiki verified)`, () => {
    const item = GEAR_CRYSTAL_WEAPONS.find((i) => i.id === `T4_${fw.suffix}`);
    assert.ok(item, `Missing T4_${fw.suffix}`);
    const got = Object.fromEntries(item.materials.map((m) => [m.matId, m.count]));
    assert.deepStrictEqual(got, fw.recipe, `T4_${fw.suffix} recipe`);
  });
}

test("GEAR_CRYSTAL_WEAPONS no longer references old MAIN_* IDs", () => {
  const stale = GEAR_CRYSTAL_WEAPONS.filter((i) =>
    i.id.includes("MAIN_EXALTEDSTAFF") || i.id.includes("MAIN_ARCTICSTAFF") ||
    i.materials.some((m) => m.matId.includes("MAIN_EXALTEDSTAFF") || m.matId.includes("MAIN_ARCTICSTAFF"))
  );
  assert.strictEqual(stale.length, 0, `Stale MAIN_* IDs in: ${stale.map((i) => i.id).join(", ")}`);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
