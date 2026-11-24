// Shared setup for tests/breeding-metadata-and-row-*.test.cjs (split from breeding-metadata-and-row.test.cjs).
// Each part requires this once; `test` and `finish` keep one pass/fail tally per part.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

// ── Load getBreedingMeta helper from render-mounts.js (top of file) ──
const renderMountsSrc = fs.readFileSync(
  path.join(__dirname, "..", "..", "js", "render-mounts.js"),
  "utf8"
);
const helperSource = renderMountsSrc.slice(
  0,
  renderMountsSrc.indexOf("function renderMountsTable")
);

// Nurture data from data-mounts.js is read by getBreedingMeta as a script-scope
// global, so include the full data-mounts source in the helper module too.
const dataMountsSrc = fs.readFileSync(
  path.join(__dirname, "..", "..", "js", "data-mounts.js"),
  "utf8"
);

const helperMod = new Module("render-mounts-helpers");
// Stub dependencies used by findCheapestFeed (getBuyPrice, getIQRBounds,
// getOverridePrice, getCityForce) so the helpers can execute in this test
// context. __setTestCityForce lets individual tests pin a per-id buy city,
// matching the user-saved cityForceOverrides used by the live app.
const helperStubs = `
let testCityForce = {};
function getIQRBounds() { return null; }
function getOverridePrice() { return null; }
function getCityForce(itemId, side) { return testCityForce[itemId]?.[side] ?? null; }
function __setTestCityForce(map) { testCityForce = map || {}; }
function getBuyPrice(itemData, city) {
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].buy_price || 0;
}
// The drake eats MOUNTS, and mount feed nutrition is tier-dependent, so
// foodNutritionPerPiece reaches for this one (js/utils.js). Every other food
// category is tier-uniform, which is why nothing needed it before.
function getTierFromId(itemId) {
  const match = String(itemId || "").match(/^T(\\d+)/);
  return match ? parseInt(match[1], 10) : 4;
}
`;
// isRrrEligible lives in js/rrr-eligible.js (the crafting list and faction
// spending ask the same question); render-mounts.js reads it as a global.
const rrrEligibleSrc = fs.readFileSync(
  path.join(__dirname, "..", "..", "js", "rrr-eligible.js"),
  "utf8"
);

helperMod._compile(
  helperStubs + rrrEligibleSrc + dataMountsSrc + helperSource + "\nmodule.exports = { getBreedingMeta, findCheapestFeed, FOOD_ITEMS, FOOD_NUTRITION_PER_PIECE, isRrrEligible, BREEDING_ITEMS, MOUNT_RECIPES, BREEDING_NURTURE_DATA, BREEDING_NURTURE_FOCUS_PER_CYCLE, __setTestCityForce };",
  "render-mounts.js"
);
const {
  getBreedingMeta, findCheapestFeed, isRrrEligible,
  BREEDING_ITEMS, 
  BREEDING_NURTURE_DATA, BREEDING_NURTURE_FOCUS_PER_CYCLE,
  __setTestCityForce,
} = helperMod.exports;

// ── The real getRowKey ──
// It now lives in js/sorting-row-key.js (split out of sorting.js for the 800-line
// cap) and exports itself, so the extraction harness this used to need is gone.
const { getRowKey } = require("../../js/sorting-row-key.js");
const { readIndexHtml } = require("./page-source.cjs");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

console.log("Breeding metadata + row rendering tests\n");

function finish() {
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

module.exports = {
  assert, fs, path, Module, renderMountsSrc, helperSource, dataMountsSrc, helperMod, helperStubs, rrrEligibleSrc, getBreedingMeta, findCheapestFeed, isRrrEligible, BREEDING_ITEMS, BREEDING_NURTURE_DATA, BREEDING_NURTURE_FOCUS_PER_CYCLE, __setTestCityForce, getRowKey, readIndexHtml, passed, failed, test, finish,
};
