/**
 * Test: "Best FP" for the user's Baby Elite Wild Boar [T8] Faction Spending row.
 *
 * The T8 boar chain takes FP in two places: the baby (50,000 FP) and the
 * saddler's 20 Treehearts (3,000 FP each). Best FP names the placement whose
 * FP earns the most silver per point, scored the way S/FP (Bred) scores the
 * whole set: the cycle profit with that placement's inputs paid in FP (the rest
 * bought), over that placement's FP.
 *
 * The user's 2026-10-05 screenshot showed "Best FP: 20× Treeheart +615,144/cycle
 * · 10.25/FP" on a row whose S/FP (Bred) read 19.33: the first version scored
 * only the silver an input saves, so a baby bought cheaper than it breeds lost
 * to the hearts. Worked by hand from that screenshot alone:
 *
 *   all FP  (baby + hearts)  cycle T = 19.33 x 110,000          = 2,126,300
 *   hearts  20 x 30,007 x 1.025                                 =   615,143.50
 *   baby only  = (T - hearts) / 50,000 = 1,511,156.50 / 50,000  = 30.22 /FP
 *   all FP     = T / 110,000                                    = 19.33 /FP
 *   -> Best FP: the baby, 30.22 /FP (never below S/FP (Bred))
 *
 * The baby's own buy price drops out of "baby only"; it only moves the
 * hearts-only figure. His old line picked hearts, so his baby buy price was
 * under 500,000 (768,744/50,000 would have beaten 10.25) — 450,000 below.
 *
 * Run: node tests/breeding-best-fp-boar-screenshot.test.cjs
 */
const assert = require("assert");
const { X } = require("./helpers/moose-screenshot-row.cjs");

const BABY = "T8_FARM_DIREBOAR_FW_LYMHURST_BABY";
const HEART = "T1_FACTION_FOREST_TOKEN_1";
const priced = (b, sl, v) => ({ buy_price: b, sell_price: sl, volume_24h: v });
const MD = {
  // Buy 450,000 (bid), sell 749,994 — the raw sale the row's S/FP (Direct) uses.
  [BABY]: { Martlock: priced(450000, 749994, 51) },
  T4_MEAT: { Martlock: priced(178, 190, 50000), Bridgewatch: priced(178, 190, 50000) },
  T8_LEATHER: { Bridgewatch: priced(32001, 33000, 5000) },
  [HEART]: { Bridgewatch: priced(30007, 44922, 10419) },
  T8_MOUNT_DIREBOAR_FW_LYMHURST_ELITE: { Bridgewatch: priced(2797980, 2797980, 50) },
};
const { pickBestFpPlay } = require("../js/faction-focus-value.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); passed++; }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); failed++; }
}
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

X.renderMountsTable(MD);
const row = X.tableState["mounts-table"].data
  .find((r) => r.isBreeding && r.item && r.item.babyId === BABY && r.buyMat && r.buyMat.price > 0);

console.log("\n=== Elite Wild Boar [T8]: Best FP ===");

test("screenshot by hand: baby only 30.22/FP beats hearts 27.75 and all-FP 19.33", () => {
  const T = 19.33 * 110000;                 // S/FP (Bred) x total FP
  const hearts = 20 * 30007 * 1.025;        // 615,143.50
  const baby = 450000 * 1.025;              // the assumed bid (see header)
  const base = T - hearts - baby;           // cycle with everything bought
  const plays = [
    { input: "baby", itemId: BABY, count: 1, fpCost: 50000, silverSaved: baby, cycleProfit: base + baby },
    { input: "mat", itemId: HEART, count: 20, fpCost: 60000, silverSaved: hearts, cycleProfit: base + hearts },
    { input: "all", itemId: null, count: 1, fpCost: 110000, silverSaved: baby + hearts, cycleProfit: T },
  ];
  const best = pickBestFpPlay(plays);
  assert.strictEqual(best.input, "baby");
  assert.strictEqual(best.silverPerFp.toFixed(2), "30.22");
  assert.strictEqual((plays[1].cycleProfit / 60000).toFixed(2), "27.75");
  assert.strictEqual((plays[2].cycleProfit / 110000).toFixed(2), "19.33");
});

test("the boar row is priced off the screenshot's inputs", () => {
  assert.ok(row, "no priced T8 boar breeding row");
  assert.strictEqual(row.saddlerMatPrices[HEART].price, 30007);
  assert.strictEqual(row.totalFpCost, 50000 + 20 * 3000);
  assert.ok(row.silverPerFp > 0, "no bred S/FP");
});

test("three placements: baby, 20 hearts (615,143.50 saved), and all-FP = S/FP (Bred)", () => {
  const hearts = row.fpPlays.find((p) => p.itemId === HEART);
  const all = row.fpPlays.find((p) => p.input === "all");
  assert.strictEqual(row.fpPlays.length, 3);
  assert.ok(near(hearts.silverSaved, 615143.5), `hearts saved ${hearts.silverSaved}`);
  assert.strictEqual(all.fpCost, 110000);
  assert.ok(near(all.cycleProfit, row.fpAdjustedProfit), "all-FP cycle is fpAdjustedProfit");
  assert.ok(near(all.cycleProfit / all.fpCost, row.silverPerFp, 1e-9), "all-FP rate is S/FP (Bred)");
});

test("the row picks the baby, at (bred cycle - hearts) / 50,000, above S/FP (Bred)", () => {
  const b = row.bestFpPlay;
  assert.ok(b, "no best FP play");
  assert.strictEqual(b.input, "baby", `picked ${b.input} ${b.itemId}`);
  const hearts = row.fpPlays.find((p) => p.itemId === HEART);
  assert.ok(near(b.silverPerFp, (row.fpAdjustedProfit - hearts.silverSaved) / 50000, 1e-9));
  assert.ok(b.silverPerFp >= row.silverPerFp, "Best FP must not read below S/FP (Bred)");
  // The old silver-saved-only score is what picked the hearts.
  assert.ok(450000 * 1.025 / 50000 < hearts.silverSaved / 60000);
});

test("the S/FP (Bred) cell's Best FP line names the baby and its rate", () => {
  // The cell helpers, lifted out of the real renderer.
  const fs = require("fs");
  const src = fs.readFileSync(require("path").join(__dirname, "..", "js", "render-faction-spending.js"), "utf8");
  const body = src.slice(src.indexOf("function _fpItemName"), src.indexOf("/**\n * The table's own column count"));
  const fn = new Function("tx", "formatSilver", "getItemDisplayName", body + "return _bestFpLineHtml;")(
    (en) => en, (n) => Math.round(n).toLocaleString("en-US"),
    (id) => ({ [BABY]: "Baby Elite Wild Boar [T8]", [HEART]: "Treeheart" })[id] || id);
  const html = fn({ bestFpPlay: row.bestFpPlay, fpPlays: row.fpPlays });
  const text = html.replace(/<[^>]+>/g, "");
  const rate = row.bestFpPlay.silverPerFp.toFixed(2);
  const profit = Math.round(row.bestFpPlay.cycleProfit).toLocaleString("en-US");
  assert.ok(text.includes(`Best FP: Baby Elite Wild Boar [T8] +${profit}/cycle · ${rate}/FP`), text);
  assert.ok(html.includes("Baby Elite Wild Boar [T8] + 20× Treeheart: "), "hover lists the all-FP option");
  assert.strictEqual(fn({ bestFpPlay: null, fpPlays: [] }), "");
});

// ── My Crafting List / Qty columns: 72 babies bred with FP on the babies only ──
// The user's 2026-10-05 screenshot showed Total Buy Cost 0 and Total Profit
// 50,489,568 (= 72 x 701,244, the raw sale) on a row whose Best FP is the baby.
// Breeding them still BUYS, per baby, by hand from the screenshot:
//   380x Raw Goat [T4]   @    178 =    67,640
//   20x T8 leather x (1 - RRR)    @ 32,001  (~16.9 consumed)
//   20x Treeheart        @ 30,007 =   600,140   (FP went to the baby)
//   x 1.025 buy setup fee; the baby itself costs 0 silver.
const QTY = 72;
test("72 bred T8 boars: buy cost is food + leather + hearts, profit is Best FP's cycle", () => {
  const bd = X.getBreedDataByBaby()[BABY];
  const factionRow = { itemId: BABY, name: "Baby Elite Wild Boar [T8]",
    sellCity: "Martlock", sellPrice: 749994, netSilver: 701244, silverPerFp: 701244 / 50000,
    breedData: bd };
  const ex = X.extractCraftListRow("faction-spending-table", factionRow);
  const leatherEach = 20 * (1 - row.saddlerRrr);
  assert.ok(Math.abs(leatherEach - 16.9) < 0.1, `leather consumed ${leatherEach}`);
  const perBaby = (380 * 178 + leatherEach * 32001 + 20 * 30007) * 1.025 + (row.brecilienFee || 0);
  assert.ok(near(ex.inputCost, perBaby, 0.01), `buy cost/baby ${ex.inputCost} vs ${perBaby}`);
  assert.ok(ex.inputCost * QTY > 89e6, `Total Buy Cost ${ex.inputCost * QTY}`);
  const ids = ex.materials.map((m) => m.matId).sort();
  assert.deepStrictEqual(ids, ["T1_FACTION_FOREST_TOKEN_1", "T4_MEAT", "T8_LEATHER"].sort(),
    "shops food, leather and hearts — never the FP-paid baby");
  const meat = ex.materials.find((m) => m.matId === "T4_MEAT");
  assert.strictEqual(meat.count, 380);
  assert.strictEqual(meat.perUnit, 178);
  assert.strictEqual(ex.materials.find((m) => m.matId === HEART).count, 20);
  // The lines sum back to the buy cost (setup fee on top).
  const sum = ex.materials.reduce((n, m) => n + m.count * m.perUnit, 0) * 1.025 + (row.brecilienFee || 0);
  assert.ok(near(sum, ex.inputCost, 0.01), `lines ${sum} vs cost ${ex.inputCost}`);
  assert.ok(near(ex.unitProfit, row.bestFpPlay.cycleProfit, 1e-6), "profit/baby is Best FP's cycle");
  assert.strictEqual(ex.sellCity, "Bridgewatch");
  assert.strictEqual(ex.sellPrice, 2797980);
});

test("a baby that sells raw for more than any breed plan keeps the raw-sale shape", () => {
  const ex = X.extractCraftListRow("faction-spending-table", { itemId: BABY, name: "b",
    sellCity: "Martlock", sellPrice: 749994, netSilver: 701244, silverPerFp: 99,
    breedData: X.getBreedDataByBaby()[BABY] });
  assert.strictEqual(ex.inputCost, 0);
  assert.strictEqual(ex.unitProfit, 701244);
  assert.deepStrictEqual(ex.materials, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
