/**
 * Test: the Crafting List's Faction Spending rows show the Faction Points their
 * quantity needs beside Total Buy Cost, and the footer sums them.
 *
 * The user's 2026-10-07 list (screenshot), checked by hand:
 *
 *   Baby Elite Wild Boar [T8], qty 5, planned as the breed with Best FP on the
 *     baby: the placement pays the baby's 50,000 FP -> 5 x 50,000 = 250,000 FP.
 *   Adept's Lymhurst Cape [T4], qty 100, FP Cost 3,400 (400 crest + 3,000
 *     heart) -> 100 x 3,400 = 340,000 FP.
 *   Footer: 250,000 + 340,000 = 590,000 FP.
 *   Energy Manipulator rows do the same in Favor (10 T8 tomes x 2,000 = 20,000). Silver cost is untouched: FP is
 *   paid at the NPC, never in silver.
 *
 * Run: node tests/craft-list-faction-fp-total.test.cjs
 */
const assert = require("assert");
const path = require("path");
const { X } = require("./helpers/moose-screenshot-row.cjs");

globalThis.tx = (en) => en;
const R = require(path.join(__dirname, "..", "js", "render-craft-list.js"));
globalThis._clEsc = (s) => String(s);
globalThis._clFmt = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");
const { _clTotalsCellHtml } = require(path.join(__dirname, "..", "js", "render-craft-list-footer.js"));
const { summarizeCraftList } = require(path.join(__dirname, "..", "js", "craft-list-materials.js"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); passed++; }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); failed++; }
}

// Same market as tests/breeding-best-fp-boar-screenshot.test.cjs (his boar).
const BABY = "T8_FARM_DIREBOAR_FW_LYMHURST_BABY";
const HEART = "T1_FACTION_FOREST_TOKEN_1";
const priced = (b, sl, v) => ({ buy_price: b, sell_price: sl, volume_24h: v });
const MD = {
  [BABY]: { Martlock: priced(450000, 749994, 51) },
  T4_MEAT: { Martlock: priced(178, 190, 50000), Bridgewatch: priced(178, 190, 50000) },
  T8_LEATHER: { Bridgewatch: priced(32001, 33000, 5000) },
  [HEART]: { Bridgewatch: priced(30007, 44922, 10419) },
  T8_MOUNT_DIREBOAR_FW_LYMHURST_ELITE: { Bridgewatch: priced(2797980, 2797980, 50) },
};
X.renderMountsTable(MD);
const bd = X.getBreedDataByBaby()[BABY];
const boar = X.extractCraftListRow("faction-spending-table", {
  itemId: BABY, name: "Baby Elite Wild Boar [T8]", fpCost: 50000,
  sellCity: "Martlock", sellPrice: 749994, netSilver: 701244, silverPerFp: 701244 / 50000,
  breedData: bd,
});
const cape = X.extractCraftListRow("faction-spending-table", {
  itemId: "T4_CAPEITEM_FW_LYMHURST", name: "Adept's Lymhurst Cape [T4]", fpCost: 3400,
  sellCity: "Thetford", sellPrice: 74389, netSilver: 68471, inputCost: 1083,
  silverMats: [{ matId: "T4_CAPE", count: 1, city: "Brecilien", perUnit: 1083 }],
});

test("the boar's Best FP is the baby alone, so one bred boar spends 50,000 FP", () => {
  const best = bd.bestFpPlay;
  const ids = Array.isArray(best.items) ? best.items.map((it) => it.itemId) : [best.itemId];
  assert.deepStrictEqual(ids, [BABY]);
  assert.strictEqual(boar.fpCost, 50000);
});

test("one Adept's Lymhurst Cape spends its 3,400 FP", () => {
  assert.strictEqual(cape.fpCost, 3400);
});

test("FP stays out of the silver cost", () => {
  assert.strictEqual(cape.inputCost, 1083);
  assert.strictEqual(cape.inputCost * 100, 108300); // the screenshot's Total Buy Cost
});

test("Total Buy Cost cells carry 5 x 50,000 = 250,000 FP and 100 x 3,400 = 340,000 FP", () => {
  const boarCell = R._clCostCell(6202120, false, boar.fpCost * 5);
  const capeCell = R._clCostCell(108300, false, cape.fpCost * 100);
  assert.match(boarCell, />250,000 FP</);
  assert.match(capeCell, /108,300<small[^>]*>340,000 FP</);
});

// Typing a new quantity refreshes the cost cell in place (_clRefreshTotalsOnly).
// That path used to set textContent to the silver figure alone, so the FP line
// vanished the moment the quantity changed (a reported case, 2026-10-11).
test("the in-place refresh keeps the FP line, rescaled to the new quantity", () => {
  const inner = R._clCostCellInner(6202120, false, boar.fpCost * 6);
  assert.match(inner, /^6,202,120<small[^>]*>300,000 FP</);
  const src = require("fs").readFileSync(path.join(__dirname, "..", "js", "render-craft-list.js"), "utf8");
  assert.match(src, /costCell\.innerHTML = _clCostCellInner\(/);
});

test("a parked row and a row with no FP show no FP line", () => {
  assert.doesNotMatch(R._clCostCell(0, true, 340000), /FP/);
  assert.doesNotMatch(R._clCostCell(5000, false, 0), /FP/);
});

test("the footer sums 590,000 FP beside cost", () => {
  const totals = summarizeCraftList([{ ...boar, qty: 5 }, { ...cape, qty: 100 }]);
  assert.strictEqual(totals.totalFp, 590000);
  assert.match(_clTotalsCellHtml(totals, 2), /FP <span class="cl-total-fp">590,000<\/span>/);
});

test("a list with no FP or Favor rows shows neither in the footer", () => {
  const totals = summarizeCraftList([{ inputCost: 10, unitProfit: 5, qty: 2 }]);
  assert.strictEqual(totals.totalFp, 0);
  assert.strictEqual(totals.totalFavor, 0);
  assert.doesNotMatch(_clTotalsCellHtml(totals, 1), /FP|Favor/);
});

// Energy Manipulator rows are paid in Favor: Elder's Tome of Insight [T8] costs
// 2,000 Favor (js/data-favor-costs.js), so 10 of them need 10 x 2,000 = 20,000.
const tome = X.extractCraftListRow("faction-spending-table", {
  itemId: "T8_SKILLBOOK_NONTRADABLE", name: "Tome [T8]", currency: "Favor",
  fpCost: 0, favorCost: 2000, sellPrice: 0, netSilver: 0,
});

test("an Energy Manipulator row carries its Favor, not FP", () => {
  assert.strictEqual(tome.favorCost, 2000);
  assert.strictEqual(tome.fpCost, 0);
  assert.strictEqual(tome.inputCost, 0);
});

test("its Total Buy Cost cell shows 10 x 2,000 = 20,000 Favor and no FP line", () => {
  const cell = R._clCostCell(0, false, tome.fpCost * 10, tome.favorCost * 10);
  assert.match(cell, />20,000 Favor</);
  assert.doesNotMatch(cell, /FP/);
});

test("the footer shows FP 590,000 and Favor 20,000 side by side", () => {
  const totals = summarizeCraftList([{ ...boar, qty: 5 }, { ...cape, qty: 100 }, { ...tome, qty: 10 }]);
  assert.strictEqual(totals.totalFp, 590000);
  assert.strictEqual(totals.totalFavor, 20000);
  const html = _clTotalsCellHtml(totals, 3);
  assert.match(html, /FP <span class="cl-total-fp">590,000<\/span>/);
  assert.match(html, /Favor <span class="cl-total-favor">20,000<\/span>/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
