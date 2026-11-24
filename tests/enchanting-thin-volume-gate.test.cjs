/**
 * Test: enchanting rows are gear valuations, not bulk-flip picks — they must not
 * be dropped by the per-order market volume gate.
 *
 * Bug (reported): searching an artifact weapon (Bow of Badon, T4-T8) in Market
 * Orders mode surfaced a single T4 row. Every other tier/step had real standing
 * orders but traded under 25/24h, and the enchanting table's MIN_VOLUME=25 gate
 * discarded the source item, the enchant mat, or the target — killing the row.
 * Enchanted artifact gear inherently trades in single digits per day.
 *
 * Fix: MIN_VOLUME=0, mirroring the crafting table (crafting-thin-volume-gate).
 * IQR outlier rejection in getBuyPrice/getSellPrice still applies.
 *
 * Black-box: synthetic marketData → the real renderEnchantingTable, rows are
 * captured from the renderTableData stub.
 *
 * Run: node tests/enchanting-thin-volume-gate.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

// sort-instant unchecked → getOrderType() === "market" (the gated mode).
const stubs = `
const _els = { "sort-instant": { checked: false } };
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const window = { addEventListener: () => {} };
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
const CRAFTING_ITEMS = [
  { id: "T6_2H_BOW_KEEPER", name: "Bow of Badon [T6]", isGearRecipe: true,
    materials: [{ matId: "T6_PLANKS", count: 20 }, { matId: "T6_ARTEFACT_2H_BOW_KEEPER", count: 1 }] },
];
let recipeCache = {};
let lastMarketData = null;
let _rows = [];
function renderTableData(_tableId, rows) { _rows = rows; }
`;

const sources = J("data-city-bonuses.js") + (J("calculations.js") + J("calculations-margins.js")) + J("travel-cost.js") + (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) + J("data-enchanting.js") + J("render-enchanting.js");

const mod = new Module("enchanting-thin-gate");
mod._compile(
  stubs + sources + "\nmodule.exports = { renderEnchantingTable, rows: () => _rows };",
  "enchanting-thin-gate.js",
);
const X = mod.exports;

// One buy city (Lymhurst) and one sell city for every id the .0→.1 row prices.
function rowsFor({ sourceVol, matVol, targetVol }) {
  const md = {};
  const put = (id, c, b, s, v) => {
    (md[id] = md[id] || {})[c] = { buy_price: b, sell_price: s, volume_24h: v };
  };
  put("T6_2H_BOW_KEEPER", "Lymhurst", 90000, 100000, sourceVol);
  put("T6_RUNE", "Lymhurst", 90, 100, matVol);
  put("T6_2H_BOW_KEEPER@1", "Lymhurst", 700000, 800000, targetVol);
  X.renderEnchantingTable(md);
  return X.rows().filter((r) => r.item && r.transition && r.transition.from === 0);
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const V_HI = 1000; // well above the old gate
const V_LO = 3;    // below the old MIN_VOLUME (25) — a real artifact-gear volume

console.log("Enchanting thin-volume gate tests\n");

test("row survives when the SOURCE item trades below the old gate", () => {
  const rows = rowsFor({ sourceVol: V_LO, matVol: V_HI, targetVol: V_HI });
  assert.ok(rows.length > 0, "expected a row for a thinly-traded source");
  assert.strictEqual(rows[0].sourcePrice, 90000); // market mode: you post a buy order
});

test("row survives when the ENCHANT MAT trades below the old gate", () => {
  const rows = rowsFor({ sourceVol: V_HI, matVol: V_LO, targetVol: V_HI });
  assert.ok(rows.length > 0, "expected a row for a thinly-traded rune");
  assert.strictEqual(rows[0].matPrice, 90);
});

test("row survives when the TARGET (.1) trades below the old gate", () => {
  const rows = rowsFor({ sourceVol: V_HI, matVol: V_HI, targetVol: V_LO });
  assert.ok(rows.length > 0, "expected a row for a thinly-traded enchanted item");
  assert.strictEqual(rows[0].sellPrice, 800000);
});

test("row survives when ALL THREE legs are thin — the reported Badon case", () => {
  const rows = rowsFor({ sourceVol: V_LO, matVol: V_LO, targetVol: V_LO });
  assert.ok(rows.length > 0, "expected a row when every leg is thin");
  assert.ok(rows[0].totalInputCost > 0 && rows[0].sellPrice > 0, "both sides must price");
});

test("liquid row unchanged — regression guard", () => {
  const rows = rowsFor({ sourceVol: V_HI, matVol: V_HI, targetVol: V_HI });
  assert.ok(rows.length > 0);
  assert.strictEqual(rows[0].sellPrice, 800000);
  assert.strictEqual(rows[0].matCount, 384); // 2H weapon
});

test("no market data at all still yields no priced row", () => {
  X.renderEnchantingTable({});
  const priced = X.rows().filter((r) => r.item);
  assert.strictEqual(priced.length, 0, "unpriced items must not produce rows");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
