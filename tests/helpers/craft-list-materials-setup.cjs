// Shared setup for tests/craft-list-materials-*.test.cjs (split from craft-list-materials.test.cjs).
// Each part requires this once; `test` and `finish` keep one pass/fail tally per part.
const assert = require("assert");
const path = require("path");

const {
  CRAFT_LIST_EXTRACTORS,
  extractCraftListRow,
  aggregateCraftListMaterials,
  summarizeCraftList,
  scaleCraftListToLaborers,
} = require(path.join(__dirname, "..", "..", "js", "craft-list-materials.js"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

function finish() {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);

}

module.exports = {
  assert, path, CRAFT_LIST_EXTRACTORS, extractCraftListRow, aggregateCraftListMaterials, summarizeCraftList, scaleCraftListToLaborers, passed, failed, test, finish,
};
