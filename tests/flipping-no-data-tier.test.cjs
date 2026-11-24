/**
 * Regression test: a Flipping row whose item has NO market data must still
 * carry its tier. Previously buildFlipRowData took an early-return path when
 * findBestBuyCity/findBestSellCity returned a null city (no prices), and that
 * object omitted `tier` — so the render printed "Tundefined" (the reported
 * "logs shows as tier Tundefined" bug). The priced path always had a tier; the
 * no-data path did not. Tier comes purely from the item id and must be present
 * in BOTH paths.
 *
 * Black-box: drive the REAL buildFlipRowData from js/render-flipping.js with
 * stubbed market helpers (no live data). Assert tier is the parsed value
 * whether or not the route resolved a city.
 *
 * Run: node tests/flipping-no-data-tier.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const sandbox = `
function getTierFromId(id) { const m = id && id.match(/^T(\\d+)/); return m ? parseInt(m[1], 10) : 4; }
function calculateFlipMargin(buy, sell, travel) { return { margin: sell - buy - travel, profit: sell - buy - travel }; }
function getGearWeightKg() { return 1; }
function calculateOxLoad(profit) { return { profitPerLoad: profit }; }
function getMinVol() { return 0; }
function getOverridePrice() { return null; }
function getOverrideField() { return null; }
module.exports = { buildFlipRowData };
`;

const src = fs.readFileSync(path.join(__dirname, "..", "js", "render-flipping.js"), "utf8") + "\n" + sandbox;
const mod = new Module("flipping-no-data-tier");
mod.paths = Module._nodeModulePaths(process.cwd());
mod._compile(src, "flipping-no-data-tier.js");
const { buildFlipRowData } = mod.exports;

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.error(`FAIL  ${name}\n      ${e.message}`); }
}

// Parameterised: id → expected tier, across raw resources + enchant variants.
const CASES = [
  ["T2_WOOD", 2],
  ["T4_WOOD", 4],
  ["T4_WOOD_LEVEL1@1", 4],
  ["T5_WOOD_LEVEL4@4", 5],
  ["T8_PLANKS", 8],
];

// No-data route: both cities null (what findBestBuyCity returns with no prices).
const noDataRoute = { buyCity: null, buyPrice: 0, sellCity: null, sellPrice: 0, travelCost: 0 };
// Priced route for the control case.
const pricedRoute = { buyCity: "Thetford", buyPrice: 100, sellCity: "Caerleon", sellPrice: 200, travelCost: 0 };

CASES.forEach(([id, tier]) => {
  check(`no-data row for ${id} keeps tier ${tier}`, () => {
    const row = buildFlipRowData({ id, name: id }, noDataRoute, {}, "royal");
    assert.strictEqual(row.tier, tier, `tier was ${row.tier}, expected ${tier}`);
  });
  check(`priced row for ${id} keeps tier ${tier}`, () => {
    const row = buildFlipRowData({ id, name: id }, pricedRoute, {}, "royal");
    assert.strictEqual(row.tier, tier, `tier was ${row.tier}, expected ${tier}`);
  });
});

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — flipping-no-data-tier`);
process.exit(failures === 0 ? 0 : 1);
