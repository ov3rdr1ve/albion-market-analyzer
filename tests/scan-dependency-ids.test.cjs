/**
 * Test: the scan id collectors must fetch every id their table's pricing reads.
 *
 * A table renders "no data" whenever a price it needs was never requested from the
 * API. The collectors (utils.js) and the catalogs they walk are the only contract
 * that keeps the two in sync, and nothing else catches a drift — a renamed catalog
 * field just yields `undefined` ids and silently empty rows.
 *
 * Covered here:
 *  - Farming: FARMING_PRODUCTION rows are keyed { id, outputId }. Collectors that read
 *    the (non-existent) seedId/cropId produced [undefined] and fetched nothing.
 *  - Mounts:  breeding prices its FEED (crops, herbs, meat, chocolate) via
 *    findCheapestFeed, so the feed ids must be in the mounts scan.
 *  - Refining: raw + refined + secondary + the refining chain + the faction heart
 *    + the transmute-substitute grid nodes.
 *
 * Black-box: drive the real collectors over the real catalogs. No API, no DOM.
 *
 * Run: node tests/scan-dependency-ids.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

function loadFile(rel) { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); }

// Minimal globals the collectors touch. utils.js is all function declarations, so
// it compiles standalone; only the catalogs it reads must exist.
const sandbox = `
const recipeCache = {};
function getTierFromId(id) { const m = id && id.match(/T(\\d+)/); return m ? parseInt(m[1],10) : 0; }
function isBlackRedZoneEnabled() { return false; }
function refinedMaxEnchant(type) { return type === "rock" ? 0 : 4; }
function rawMaxEnchant(type) { return type === "rock" ? 3 : 4; }
function getStationFeeInput() { return 0; }
function calcStationFeeSilver() { return 0; }
function refineStationFeeSilver() { return 0; }
function resourceShortName(id) { return id; }
`;

const mod = new Module("scan-dependency-ids-test");
mod._compile(
  sandbox +
    loadFile("js/data.js") +
    loadFile("js/data-farming.js") +
    loadFile("js/data-mounts.js") +
    loadFile("js/data-transmute.js") +
    loadFile("js/refining-chain-recipes.js") +
    loadFile("js/refining-chain-pricing.js") +
    loadFile("js/refining-transmute-substitute.js") +
    loadFile("js/render-mounts.js") + loadFile("js/render-mounts-breeding-row.js") + loadFile("js/render-mounts-craft-row.js") +
    (loadFile("js/utils.js") + loadFile("js/utils-item-ids.js") + loadFile("js/utils-overrides.js") + loadFile("js/utils-focus-fees.js")) +
    "\nmodule.exports = { getFarmingItemIds, getMountsItemIds, getTransportItemIds, " +
    "getAllFlippingItems, getBreedingFeedIds, FARMING_PRODUCTION, MOUNT_RECIPES, BREEDING_ITEMS };",
  "scan-dependency-ids.js",
);
const {
  getFarmingItemIds, getMountsItemIds, getTransportItemIds,
  getAllFlippingItems, getBreedingFeedIds, FARMING_PRODUCTION,
} = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// ── Every collector must emit real, defined ids ──────────────────────────────
console.log("\n=== no undefined / empty ids leak into a fetch ===");
[
  ["getFarmingItemIds", getFarmingItemIds],
  ["getMountsItemIds", getMountsItemIds],
  ["getTransportItemIds", getTransportItemIds],
].forEach(([name, fn]) => {
  test(`${name} returns only non-empty strings`, () => {
    const ids = fn();
    assert.ok(ids.length > 0, `${name} returned nothing`);
    const bad = ids.filter((id) => typeof id !== "string" || id.length === 0);
    assert.strictEqual(bad.length, 0, `${name} emitted ${bad.length} bad ids: ${JSON.stringify(bad.slice(0, 3))}`);
  });
});

// ── Farming ─────────────────────────────────────────────────────────────────
console.log("\n=== farming: seeds + outputs are fetched ===");
test("FARMING_PRODUCTION rows are keyed { id, outputId } (guards the field rename)", () => {
  FARMING_PRODUCTION.forEach((f) => {
    assert.ok(f.id && f.outputId, `row missing id/outputId: ${JSON.stringify(f)}`);
    assert.strictEqual(f.seedId, undefined, "seedId must not exist — collectors must not read it");
    assert.strictEqual(f.cropId, undefined, "cropId must not exist — collectors must not read it");
  });
});
test("getFarmingItemIds covers every seed and every output", () => {
  const ids = new Set(getFarmingItemIds());
  FARMING_PRODUCTION.forEach((f) => {
    assert.ok(ids.has(f.id), `missing seed/animal ${f.id}`);
    assert.ok(ids.has(f.outputId), `missing output ${f.outputId}`);
  });
});
test("seed ids reach the flip universe too (they are tradeable)", () => {
  const ids = new Set(getAllFlippingItems().map((i) => i.id));
  assert.ok(ids.has("T4_FARM_TURNIP_SEED"), "crop seed missing from flipping");
  assert.ok(ids.has("T8_FARM_YARROW_SEED"), "herb seed missing from flipping");
  assert.ok(ids.has("T8_PUMPKIN"), "crop output missing from flipping");
});

// ── Mounts / breeding feed ──────────────────────────────────────────────────
console.log("\n=== mounts: breeding feed is fetched ===");
test("getBreedingFeedIds lists plants, meat and chocolate", () => {
  const feed = new Set(getBreedingFeedIds());
  ["T1_CARROT", "T8_PUMPKIN", "T2_AGARIC", "T8_YARROW", "T3_MEAT", "T8_MEAT",
   "UNIQUE_CONSUMABLE_EVENT_EASTER_2020_CHOCOLATE"].forEach((id) => {
    assert.ok(feed.has(id), `feed id ${id} missing`);
  });
});
test("getMountsItemIds includes every feed id (findCheapestFeed prices them)", () => {
  const ids = new Set(getMountsItemIds());
  getBreedingFeedIds().forEach((id) => assert.ok(ids.has(id), `mounts scan misses feed ${id}`));
});
test("getMountsItemIds still includes mount recipe mats and breeding pairs", () => {
  const ids = new Set(getMountsItemIds());
  assert.ok(ids.has("T8_FARM_HORSE_BABY") && ids.has("T8_FARM_HORSE_GROWN"));
});

// ── Refining substitutions ──────────────────────────────────────────────────
console.log("\n=== refining: heart + transmute deps are fetched ===");
test("getTransportItemIds includes the faction heart for each resource", () => {
  const ids = new Set(getTransportItemIds());
  ["T1_FACTION_FOREST_TOKEN_1", "T1_FACTION_MOUNTAIN_TOKEN_1", "T1_FACTION_STEPPE_TOKEN_1",
   "T1_FACTION_SWAMP_TOKEN_1", "T1_FACTION_HIGHLAND_TOKEN_1"].forEach((id) => {
    assert.ok(ids.has(id), `heart ${id} missing`);
  });
});
test("getTransportItemIds includes the transmute grid nodes a raw can come from", () => {
  const ids = new Set(getTransportItemIds());
  // An 8.4 fiber refine can be fed by transmuting 8.3 up, or 7.4, etc.
  ["T8_FIBER_LEVEL3@3", "T7_FIBER_LEVEL4@4", "T7_FIBER", "T4_FIBER"].forEach((id) => {
    assert.ok(ids.has(id), `transmute node ${id} missing`);
  });
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
