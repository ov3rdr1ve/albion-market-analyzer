/**
 * Test: every My Crafting List row that can spend focus gets the "10k" button.
 *
 * The user's 2026-10-07 list showed the button on the Breeding & Mounts rows but
 * not on the Faction Spending row "Baby Elite Wild Boar [T8]" (planned as the
 * breed, Best FP on the baby) nor on Master's Royal Sandals [T6]. By hand:
 *
 *   Faction boar row — it IS the bred cycle, so it nurtures like its twin:
 *     "Nurture: 6x @ 125 focus = 750", charged once a day over 6 days
 *     -> 125 focus/day -> floor(10,000 / 125) = 80 babies per 10k bar,
 *        the same 80 the Breeding row's own button sets.
 *   Master's Royal Sandals [T6] — a combine craft (Scholar Sandals + 8 Royal
 *     Sigils) with craftingfocus="0" in items.xml (pinned in
 *     tests/craft-planner-no-focus-combine.test.cjs): it cannot spend focus, so
 *     no quantity spends a bar on it and it keeps the bare box.
 *   A planner craft that does spend focus, 60 focus/craft -> floor(10,000/60)
 *     = 166.
 *
 * Run: node tests/craft-list-qty-focus-all-rows.test.cjs
 */
const assert = require("assert");
const path = require("path");
const { X } = require("./helpers/moose-screenshot-row.cjs");

globalThis.tx = (en) => en;
globalThis.formatSilver = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");
const { clQtyFocusBtnHtml } = require(path.join(__dirname, "..", "js", "craft-list-qty-focus.js"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); passed++; }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); failed++; }
}
const btnQty = (html) => {
  const m = /data-cl-qty-focus="(\d+)"/.exec(html);
  return m ? Number(m[1]) : null;
};

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
const mountRow = X.tableState["mounts-table"].data
  .find((r) => r.isBreeding && r.item && r.item.babyId === BABY && r.buyMat && r.buyMat.price > 0);
const bd = X.getBreedDataByBaby()[BABY];
const factionRow = { itemId: BABY, name: "Baby Elite Wild Boar [T8]",
  sellCity: "Martlock", sellPrice: 749994, netSilver: 701244, silverPerFp: 701244 / 50000,
  breedData: bd };
const ex = X.extractCraftListRow("faction-spending-table", factionRow);
const entry = (tableId) => ({ tableId, rowKey: "k", qty: 5 });

console.log("\n=== Faction Spending baby planned as the breed ===");

test("the boar nurtures 6x @ 125 = 750 focus, as in the screenshot", () => {
  assert.strictEqual(mountRow.meta.maxNurtures, 6);
  assert.strictEqual(mountRow.focusCost, 750);
  assert.strictEqual(bd.maxNurtures, 6);
  assert.strictEqual(bd.nurtureFocusCost, 750);
});

test("the faction row bills 125 focus a day over 6 days, like the breeding row", () => {
  assert.strictEqual(ex.focusCost, 125);
  assert.strictEqual(ex.focusDays, 6);
  const breed = X.extractCraftListRow("mounts-table", mountRow);
  assert.strictEqual(ex.focusCost, breed.focusCost);
  assert.ok(Math.abs(ex.focusProfitDelta - mountRow.nurtureProfitDelta / 6) < 1e-6);
});

test("its 10k button sets 80 babies (10,000 / 125), same as the breeding row's", () => {
  const html = clQtyFocusBtnHtml(entry("faction-spending-table"), ex);
  assert.strictEqual(btnQty(html), 80, html);
  const breedHtml = clQtyFocusBtnHtml(entry("mounts-table"), X.extractCraftListRow("mounts-table", mountRow));
  assert.strictEqual(btnQty(breedHtml), 80);
});

test("funded babies keep Best FP's cycle; an unfunded one loses only the nurture slice", () => {
  assert.ok(Math.abs(ex.unitProfit - mountRow.bestFpPlay.cycleProfit) < 1e-6);
  assert.ok(Math.abs(ex.unitProfitNoFocus - (ex.unitProfit - mountRow.nurtureProfitDelta)) < 1e-6);
  // Nurture costs focus, not silver: an unfunded baby buys exactly the same.
  assert.strictEqual(ex.inputCostNoFocus, ex.inputCost);
});

test("a baby sold raw (no breed plan) still has no focus and no button", () => {
  const raw = X.extractCraftListRow("faction-spending-table", { ...factionRow, silverPerFp: 99 });
  assert.strictEqual(raw.focusCost, 0);
  assert.strictEqual(clQtyFocusBtnHtml(entry("faction-spending-table"), raw), "");
});

console.log("\n=== Crafting planner rows ===");

const plannerRow = (id, focusPerCraft) => ({ item: { id, name: id }, craftCity: "Bridgewatch",
  sellCity: "Brecilien", sellPrice: 399980, refineCraftCost: 202807, combinedProfit: 171174,
  focusPerCraft, recipe: [], matBestPrices: {} });

test("Master's Royal Sandals [T6] (zero-focus combine) keeps the bare box", () => {
  const r = X.extractCraftListRow("craft-planner-table", plannerRow("T6_SHOES_CLOTH_ROYAL", 0));
  assert.strictEqual(r.focusCost, 0);
  assert.strictEqual(clQtyFocusBtnHtml(entry("craft-planner-table"), r), "");
});

test("a planner craft at 60 focus gets a button for 166 crafts", () => {
  const r = X.extractCraftListRow("craft-planner-table", plannerRow("T6_HEAD_LEATHER_DRAGON", 60));
  assert.strictEqual(btnQty(clQtyFocusBtnHtml(entry("craft-planner-table"), r)), 166);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
