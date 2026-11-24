/**
 * Test: the REAL breeding row (renderMountsTable) finishes its grown animal with
 * the best-paying mount craft and reports own-baby sell-vs-raise.
 *
 *   - T8 horse: Armored Horse nets more -> row.recipe.id T8_MOUNT_ARMORED_HORSE;
 *     reversed prices -> Riding Horse; equal -> Riding (declaration order).
 *   - row.babySellVsRaise exists for a SILVER baby, with sellNet / raiseNet from
 *     the row's own published figures and the winner on the right side.
 *   - the row's sell item, sell price and mat prices follow the winning recipe.
 *
 * Black box over synthetic market data, no live APIs.
 * Run: node tests/breeding-row-best-finish-wiring.test.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");
const stubs = `
const _els = { "use-focus": { checked: false }, "premium-account": { checked: true } };
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const window = { addEventListener: () => {} };
const tableState = { "mounts-table": { data: [] }, "faction-spending-table": { data: [] } };
function renderTableData(id, rows) { tableState[id].data = rows; }
function priceTd(p){ return "<td>"+p+"</td>"; }
function volTd(){ return "<td></td>"; }
function profitTd(){ return "<td></td>"; }
function pureProfitTd(){ return "<td></td>"; }
function matPriceSpan(id, c, p){ return "<span>"+p+"</span>"; }
function getProfitClass(){ return ""; }
function tx(enText){ return enText; }
function dispName(id, fallbackName){ return fallbackName; }
function addTdForKey(){ return "<td></td>"; }
const ITEM_NAMES_MAP = {};
let lastMpMarketData = null, lastMarketData = null;
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
const CRAFTING_ITEMS = [], FLIPPING_ITEMS = [], TRANSPORT_ITEMS = [], CONSUMABLES = [], FARMING_ITEMS = [], ARTIFACT_FLIP_ITEMS = [], GEAR_CAPES = [];
`;
const sources = ["focus-play.js", "data-faction-fp-costs.js", "focus-costs.js", "data-mounts.js",
  "data-city-bonuses.js", "calculations.js", "calculations-margins.js", "travel-cost.js", "mp-bonus.js", "utils.js", "utils-item-ids.js", "utils-overrides.js", "utils-focus-fees.js",
  "sorting-row-key.js", "rrr-eligible.js", "breeding-finish.js", "render-mounts.js",
  "render-mounts-breeding-row.js", "render-mounts-craft-row.js"].map(J).join("\n");
const mod = new Module("breeding-row-best-finish-wiring");
mod._compile(`${stubs}${sources}\nmodule.exports = { tableState, renderMountsTable, _els, PREMIUM_TAX, SETUP_FEE };`,
  "breeding-row-best-finish-wiring.js");
const X = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

// Prices are sell_price (what the row reads as the sale / buy ask).
function render({ riding, armored, babyBuy = 300000, babySell = 310000, leather = 1000, cloth = 1000, metal = 1000 }) {
  const md = {};
  const put = (id, p) => { (md[id] = md[id] || {}).Lymhurst = { buy_price: p, sell_price: p, volume_24h: 1000 }; };
  put("T8_FARM_HORSE_BABY", babyBuy);
  md.T8_FARM_HORSE_BABY.Lymhurst.sell_price = babySell;
  put("T8_FARM_HORSE_GROWN", 100000);
  put("T8_LEATHER", leather);
  put("T8_CLOTH", cloth);
  put("T8_METALBAR", metal);
  put("T8_MOUNT_HORSE", riding);
  put("T8_MOUNT_ARMORED_HORSE", armored);
  ["T1_CARROT", "T2_BEAN", "T3_WHEAT", "T4_TURNIP", "T5_CABBAGE", "T6_POTATO", "T7_CORN", "T8_PUMPKIN"]
    .forEach((id) => put(id, 300));
  X.renderMountsTable(md);
  return X.tableState["mounts-table"].data.find(
    (r) => r.isBreeding && r.item && r.item.babyId === "T8_FARM_HORSE_BABY" && r.section === "royal");
}

console.log("\n=== Breeding row: best finish wiring ===");

[
  { name: "Armored nets more", riding: 900000, armored: 2000000, want: "T8_MOUNT_ARMORED_HORSE" },
  { name: "Riding nets more (reversed)", riding: 2000000, armored: 900000, want: "T8_MOUNT_HORSE" },
  { name: "equal sale, Riding mats cheaper", riding: 1500000, armored: 1500000, want: "T8_MOUNT_HORSE" },
  { name: "Armored unpriced -> Riding", riding: 900000, armored: 0, want: "T8_MOUNT_HORSE" },
  { name: "Riding unpriced -> Armored", riding: 0, armored: 900000, want: "T8_MOUNT_ARMORED_HORSE" },
].forEach((c) => {
  test(c.name, () => {
    const r = render(c);
    assert.ok(r, "row built");
    assert.strictEqual(r.recipe.id, c.want);
    assert.strictEqual(r.sellItemId, c.want);
    assert.ok(r.recipe.materials.every((m) => r.saddlerMatPrices[m.matId]), "mat prices follow the winner");
  });
});

test("Armored's expensive mats flip the winner back to Riding", () => {
  // Armored sells higher but its 10 cloth + 20 metal bars cost far more.
  const r = render({ riding: 1000000, armored: 1300000, cloth: 60000, metal: 60000 });
  assert.strictEqual(r.recipe.id, "T8_MOUNT_HORSE");
});

console.log("\n=== Breeding row: own baby sell vs raise ===");

test("raise wins: valuable mount, cheap baby sale", () => {
  const r = render({ riding: 3000000, armored: 0, babySell: 20000 });
  const b = r.babySellVsRaise;
  assert.ok(b, "silver baby carries the comparison");
  assert.strictEqual(b.winner, "raise");
  assert.ok(Math.abs(b.sellNet - 20000 * (1 - X.PREMIUM_TAX)) < 1e-6);
  const raise = r.marginInfo.profit + r.buyMat.price * (1 + X.SETUP_FEE);
  assert.ok(Math.abs(b.raiseNet - raise) < 1e-6);
  assert.ok(Math.abs(b.delta - (b.raiseNet - b.sellNet)) < 1e-6);
  assert.strictEqual(b.sellCity, "Lymhurst");
});

test("sell wins: worthless mount, pricey baby", () => {
  const r = render({ riding: 50000, armored: 0, babyBuy: 9000000, babySell: 9500000 });
  const b = r.babySellVsRaise;
  assert.ok(b);
  assert.strictEqual(b.winner, "sell");
  assert.ok(b.sellNet > b.raiseNet);
});

test("no baby sell price -> raise, sellUnpriced, null when baby absent from market", () => {
  const r = render({ riding: 3000000, armored: 0, babySell: 0 });
  assert.ok(!r.babySellVsRaise || (r.babySellVsRaise.winner === "raise" && r.babySellVsRaise.sellUnpriced));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
