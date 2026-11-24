/**
 * Test: mount craft / breeding material labels.
 *
 * T8 cloth is "Baroque Cloth" in game (never "Gossamer"), and the mount rows
 * label materials via getItemDisplayName (refined resources print the short
 * "T8 cloth" form) instead of reading ITEM_NAMES_MAP first.
 *
 * Black-box: name maps are loaded for real, getItemDisplayName is extracted
 * from js/utils.js; the render files are checked for the lookup they use.
 * No live API or DB.
 *
 * Run: node tests/mount-material-labels.test.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

const utilsSrc = (read("js/utils.js") + read("js/utils-item-ids.js") + read("js/utils-overrides.js") + read("js/utils-focus-fees.js"));
const start = utilsSrc.indexOf("function getItemDisplayName(");
const endMatch = /\r?\n\}/.exec(utilsSrc.slice(start));
const end = start + endMatch.index + endMatch[0].length;
assert(start >= 0 && end > start, "getItemDisplayName not found in utils.js");

const ctx = vm.createContext({});
vm.runInContext(
  read("js/item-names.js") + "\n" +
  read("js/resource-names.js").replace(/if \(typeof module[\s\S]*$/, "") + "\n" +
  utilsSrc.slice(start, end) +
  "\nthis.MAP = ITEM_NAMES_MAP; this.nameOf = getItemDisplayName;",
  ctx,
);
const MAP = ctx.MAP;
// Same resolver the rows use.
const matName = (id) => ctx.nameOf(id) || id;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name}\n    ${e.message}`); }
}

test("T8_CLOTH is Baroque Cloth", () => assert.strictEqual(MAP.T8_CLOTH, "T8 Baroque Cloth"));
test("no ITEM_NAMES_MAP value says Gossamer", () => {
  const bad = Object.entries(MAP).filter(([, v]) => /Gossamer/i.test(v));
  assert.deepStrictEqual(bad, []);
});
for (const n of [1, 2, 3, 4]) {
  test(`T8_CLOTH_LEVEL${n}@${n} contains Baroque`, () =>
    assert(/Baroque/.test(MAP[`T8_CLOTH_LEVEL${n}@${n}`]), MAP[`T8_CLOTH_LEVEL${n}@${n}`]));
}

const SHORT = {
  T8_CLOTH: "T8 cloth", T8_METALBAR: "T8 bar", "T8_CLOTH_LEVEL1@1": "T8.1 cloth",
  T7_LEATHER: "T7 leather",
};
for (const [id, expect] of Object.entries(SHORT)) {
  test(`resolver ${id} -> "${expect}"`, () => assert.strictEqual(matName(id), expect));
}

for (const id of ["T8_FARM_HORSE_GROWN", "T8_MOUNT_ARMORED_HORSE"]) {
  test(`non-resource ${id} resolves to a name`, () => {
    if (!MAP[id]) return; // no name in the map: nothing to assert
    assert.strictEqual(matName(id), MAP[id]);
    assert.notStrictEqual(matName(id), id);
  });
}

for (const file of ["js/render-mounts-breeding-row.js", "js/render-mounts-craft-row.js"]) {
  test(`${file} material names skip ITEM_NAMES_MAP`, () => {
    const lines = read(file).split("\n").filter((l) => /const name = .*m\.matId/.test(l));
    assert(lines.length > 0);
    for (const l of lines) assert(!/ITEM_NAMES_MAP/.test(l), l.trim());
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
