/**
 * Test: Iron Campaign Chest rows add the silver value of their contained
 * Tomes of Insight on top of the (overrideable) silver loot.
 *
 * Mechanic under test:
 *   Each Iron Campaign Chest contains 2× Grandmaster's (T7) + 1× Master's (T6)
 *   Tome of Insight. Those tomes are NON-tradeable, so they have no market price.
 *   We value them by fame-equivalence against the only tradeable Tome of Insight,
 *   the Adept's (T4_SKILLBOOK_STANDARD):
 *
 *     silverPerFame = (cheapest Adept's Tome market price) / fame(Adept's = 10,000)
 *     tomeValue     = silverPerFame × Σ(count × fame(tier))
 *
 *   Combat fame per tier: Adept T4 = 10,000 · Master T6 = 50,000 · GM T7 = 100,000
 *   Chest contents fame = 2×100,000 + 1×50,000 = 250,000  ⇒  tomeValue = 25 × T4 price.
 *
 * Black-box contract:
 *   - getChestTomeValue(marketData) returns 25× the cheapest Adept's Tome price.
 *   - It picks the CHEAPEST Adept's Tome price across cities.
 *   - Unpriced tradeable tome ⇒ tomeValue 0 (no fabricated value).
 *   - buildFactionSpendRow({fixedYield, bonusValue}) puts the silver loot in
 *     sellPrice (still overrideable) and silver loot + tomes in netSilver.
 *
 * Run: node tests/faction-spending-chest-tome-value.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const fpCostsSrc = fs.readFileSync(
  path.join(__dirname, "..", "js", "data-faction-fp-costs.js"),
  "utf8"
);
const chestSrc = fs.readFileSync(
  path.join(__dirname, "..", "js", "data-faction-chests.js"),
  "utf8"
);
const renderSrc = fs.readFileSync(
  path.join(__dirname, "..", "js", "render-faction-spending.js"),
  "utf8"
);

const stubs = `
${fpCostsSrc}
${chestSrc}
// Minimal market-price reader honouring the real getBuyPrice contract enough
// for valuation: returns a per-city price for the Adept's Tome only.
function getOverridePrice() { return null; }
let _tomePrices = {}; // city -> price for T4_SKILLBOOK_STANDARD
function getBuyPrice(itemData, city) {
  return itemData && itemData[city] ? (itemData[city].buy_price || 0) : 0;
}
function findBestSellCity(marketData, itemId, cities) {
  for (const c of cities) {
    const p = marketData?.[itemId]?.[c]?.sell_price || 0;
    if (p > 0) return { city: c, price: p };
  }
  return { city: null, price: 0 };
}
function netSilverAfterFees(gross) { return gross; }
function calculateSilverPerFp(silver, fp) { return fp > 0 ? silver / fp : 0; }
function getItemDisplayName(id) { return id; }
const ITEM_NAMES_MAP = {};
function formatSilver(n) { return String(Math.round(n)); }
function getFavorSpendItemIds() { return []; }
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
`;

const mod = new Module("render-faction-spending-tome-test");
mod._compile(
  stubs + renderSrc + `
    module.exports = {
      buildFactionSpendRow,
      getChestTomeValue,
      getFactionSpendingItemIds,
    };`,
  "render-faction-spending.js"
);

const { buildFactionSpendRow, getChestTomeValue, getFactionSpendingItemIds } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const TOME_ID = "T4_SKILLBOOK_STANDARD";
const FOREST = "UNIQUE_LOOTCHEST_FACTIONCAMPAIGN_REWARD_FOREST_01";
// 2× T7 (100k) + 1× T6 (50k) = 250k fame; /10k fame per Adept = 25× Adept price.
const FAME_MULTIPLIER = 25;
const mdWith = (prices) => ({ [TOME_ID]: prices });

console.log("\n=== Iron Chest tome value (fame-equivalence vs Adept's Tome) ===");

test("tomeValue = 25× the Adept's Tome price (single city)", () => {
  const v = getChestTomeValue(mdWith({ Caerleon: { buy_price: 2000 } }));
  assert.strictEqual(v, 2000 * FAME_MULTIPLIER); // 50,000
});

test("tomeValue uses the CHEAPEST Adept's Tome price across cities", () => {
  const v = getChestTomeValue(mdWith({
    Caerleon: { buy_price: 3000 },
    Martlock: { buy_price: 1800 },
    Lymhurst: { buy_price: 2500 },
  }));
  assert.strictEqual(v, 1800 * FAME_MULTIPLIER); // cheapest wins
});

test("zero-priced cities are ignored when finding the cheapest", () => {
  const v = getChestTomeValue(mdWith({
    Caerleon: { buy_price: 0 },
    Martlock: { buy_price: 2200 },
  }));
  assert.strictEqual(v, 2200 * FAME_MULTIPLIER);
});

test("unpriced tradeable tome ⇒ tomeValue 0 (no fabricated value)", () => {
  assert.strictEqual(getChestTomeValue(mdWith({})), 0);
  assert.strictEqual(getChestTomeValue({}), 0);
});

test("chest netSilver = silver loot + tome value; sellPrice stays loot-only", () => {
  const tomeValue = getChestTomeValue(mdWith({ Martlock: { buy_price: 2000 } })); // 50,000
  const r = buildFactionSpendRow(FOREST, {}, {
    tradeable: false,
    category: "Iron Chest",
    openCity: "Lymhurst",
    fixedYield: 76000,
    bonusValue: tomeValue,
  });
  assert.strictEqual(r.sellPrice, 76000, "yield cell shows silver loot only");
  assert.strictEqual(r.bonusValue, 50000, "tome value exposed on the row");
  assert.strictEqual(r.netSilver, 126000, "net = loot + tomes");
});

test("no bonusValue ⇒ net equals loot (unchanged legacy behavior)", () => {
  const r = buildFactionSpendRow(FOREST, {}, {
    tradeable: false,
    category: "Iron Chest",
    openCity: "Lymhurst",
    fixedYield: 76000,
  });
  assert.strictEqual(r.netSilver, 76000);
});

test("the tradeable Adept's Tome is included in the scan list", () => {
  assert.ok(getFactionSpendingItemIds().includes(TOME_ID));
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
