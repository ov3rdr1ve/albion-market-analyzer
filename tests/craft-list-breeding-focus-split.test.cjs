/**
 * My Crafting List — a breeding row's focus budget split carries ONE focus play.
 *
 * Bug: with Use Focus on, a T6 Moose row (qty 1440, 10k budget) showed a Total
 * Profit of 52.1M where ~11.2M is right. The row's headline profit holds TWO
 * focus effects at once — the saddler craft's focused leather return AND the
 * nurture offspring slice — but the extractor priced an unfunded unit as
 * `headline − winning play`, so the 1,360 units past the budget kept the
 * saddler gain they never paid focus for. Total Buy Cost had the same hole:
 * unfunded units kept the focused saddler return rate.
 *
 * The model pinned here:
 *   unfunded unit = fully unfocused profit (base saddler RRR, base offspring)
 *   funded unit   = unfocused profit + the ONE winning play's delta
 *   Use Focus off = every unit at the unfocused profit (unchanged)
 *   Profit / 10k  = the bar is constant; the list cell is Total + bar.
 *
 * Black box: (1) the REAL renderMountsTable publishes the unfocused twin;
 * (2) the REAL extractor + allocateCraftListFocus + summarizeCraftList price
 * the split. Synthetic numbers only, no DOM, no live APIs.
 *
 * Run: node tests/craft-list-breeding-focus-split.test.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const {
  extractCraftListRow,
  aggregateCraftListMaterials,
  summarizeCraftList,
} = require(path.join(__dirname, "..", "js", "craft-list-materials.js"));
const { allocateCraftListFocus } = require(path.join(__dirname, "..", "js", "craft-list-focus-budget.js"));
const { combinedPer10k } = require(path.join(__dirname, "..", "js", "craft-list-per10k.js"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.error(`  FAIL: ${name} — ${e.message}`); }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= Math.max(eps, Math.abs(b) * 1e-9);
const byId = (mats) => Object.fromEntries(mats.map((m) => [m.matId, m]));

// ── 1. the renderer publishes a fully unfocused twin ───────────────────────

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");
const stubs = `
const _els = { "use-focus": { checked: true }, "premium-account": { checked: true } };
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
  "sorting-row-key.js", "rrr-eligible.js", "render-mounts.js", "render-mounts-breeding-row.js",
  "render-mounts-craft-row.js"].map(J).join("\n");
const mod = new Module("craft-list-breeding-focus-split");
mod._compile(`${stubs}${sources}\nmodule.exports = { tableState, renderMountsTable, _els };`,
  "craft-list-breeding-focus-split.js");
const X = mod.exports;

const BABY = "T8_FARM_HORSE_BABY";
function market() {
  const md = {};
  const priced = (b, s, v) => ({ buy_price: b, sell_price: s, volume_24h: v });
  const put = (id, b, s, v) =>
    ["Lymhurst", "Martlock", "Caerleon"].forEach((c) => { (md[id] = md[id] || {})[c] = priced(b, s, v); });
  put(BABY, 60000, 65000, 500);
  put("T8_FARM_HORSE_GROWN", 100000, 110000, 500);
  put("T8_LEATHER", 9000, 9500, 5000);
  put("T8_MOUNT_HORSE", 380000, 420000, 500);
  put("T3_WHEAT", 100, 110, 5000);
  return md;
}
function breedRows(focusOn) {
  X._els["use-focus"].checked = focusOn;
  X.renderMountsTable(market());
  return X.tableState["mounts-table"].data
    .filter((r) => !r.isCraft && r.item && r.item.babyId === BABY && r.marginInfo && r.marginInfo.profit);
}
const rowKey = (r) => `${r.section}|${r.buyMat.city}|${r.sellPot.city}`;

test("fixture sanity: the T8 horse breeds into a saddled row in both focus states", () => {
  assert.ok(breedRows(true).length >= 1, "no focus-on breeding row");
  assert.ok(breedRows(false).length >= 1, "no focus-off breeding row");
  assert.ok(breedRows(true).every((r) => r.recipe), "fixture must chain into the saddler craft");
});

test("focus ON: profitNoFocus equals the row's own focus-OFF headline", () => {
  const off = Object.fromEntries(breedRows(false).map((r) => [rowKey(r), r]));
  const on = breedRows(true);
  let compared = 0;
  on.forEach((r) => {
    const twin = off[rowKey(r)];
    if (!twin) return;
    compared++;
    assert.strictEqual(typeof r.profitNoFocus, "number", `${rowKey(r)}: profitNoFocus missing`);
    assert.ok(near(r.profitNoFocus, twin.marginInfo.profit),
      `${rowKey(r)}: profitNoFocus ${r.profitNoFocus} ≠ focus-off profit ${twin.marginInfo.profit}`);
    assert.ok(near(r.totalInputCostNoFocus, twin.totalInputCost),
      `${rowKey(r)}: totalInputCostNoFocus ${r.totalInputCostNoFocus} ≠ focus-off cost ${twin.totalInputCost}`);
    assert.ok(r.marginInfo.profit > r.profitNoFocus, "the focused headline must exceed the unfocused twin");
  });
  assert.ok(compared >= 1, "no row matched across the toggle");
});

test("focus OFF: profitNoFocus is the headline itself", () => {
  breedRows(false).forEach((r) => {
    assert.ok(near(r.profitNoFocus, r.marginInfo.profit), `${rowKey(r)}: twin drifted with focus off`);
    assert.ok(near(r.totalInputCostNoFocus, r.totalInputCost), `${rowKey(r)}: cost twin drifted`);
  });
});

// ── 2. the extractor prices ONE focus play per funded unit ─────────────────

// The reported row, published the way the renderer now publishes it: T6 Moose,
// nurture 500 focus over 4 days (125/day) adding 69,587; unfocused cycle 3,937.
// The focused headline (marginInfo.profit) also holds ~28.4k of saddler RRR.
const NO_FOCUS = 3937;
const NURTURE = 69587;
const SADDLER_GAIN = 28400;
function mooseRow(over) {
  return Object.assign({
    isBreeding: true,
    item: {
      babyId: "T6_FARM_GIANTSTAG_MOOSE_BABY",
      grownId: "T6_FARM_GIANTSTAG_MOOSE_GROWN",
      id: "T6_MOUNT_GIANTSTAG_MOOSE",
      name: "Moose [T6]",
    },
    meta: { maxNurtures: 4, focusPerNurture: 125, totalNurtureFocus: 500, piecesNeeded: 69 },
    buyMat: { city: "Brecilien", price: 200019 },
    feed: { id: "T3_COMFREY", price: 256, city: "Brecilien", pieces: 69 },
    recipe: {
      id: "T6_MOUNT_GIANTSTAG_MOOSE",
      materials: [
        { matId: "T6_FARM_GIANTSTAG_MOOSE_GROWN", count: 1 },
        { matId: "T6_LEATHER", count: 20 },
      ],
    },
    saddlerMatPrices: {
      T6_FARM_GIANTSTAG_MOOSE_GROWN: { price: 0, city: "Thetford", isProduced: true },
      T6_LEATHER: { price: 4717, city: "Thetford" },
    },
    saddlerCity: "Thetford",
    saddlerRrr: 0.435,
    saddlerRrrNoFocus: 0.152,
    sellPot: { city: "Lymhurst", price: 469899 },
    totalInputCost: 250000,
    totalInputCostNoFocus: 250000 + SADDLER_GAIN,
    marginInfo: { profit: NO_FOCUS + SADDLER_GAIN + NURTURE },
    profitNoFocus: NO_FOCUS,
    focusCost: 500,
    focusProfitDelta: NURTURE,
    bestFocusPlay: { kind: "nurture", focusCost: 500, profitDelta: NURTURE },
    profitPer10kFocus: 2038395,
    rrr: 0,
  }, over || {});
}
const saddlerWins = {
  focusProfitDelta: 90000,
  bestFocusPlay: { kind: "saddler", focusCost: 3000, profitDelta: 90000 },
};

[
  ["nurture wins, saddler also focused", {}, "nurture", NURTURE],
  ["saddler wins, nurture slice also in the headline", saddlerWins, "saddler", 90000],
].forEach(([label, over, kind, delta]) => {
  test(`${label}: unfunded unit = fully unfocused profit`, () => {
    const e = extractCraftListRow("mounts-table", mooseRow(over));
    assert.strictEqual(e.unitProfitNoFocus, NO_FOCUS);
    assert.strictEqual(e.laborerProfitNoFocus, NO_FOCUS);
  });
  test(`${label}: funded unit = unfocused + the ${kind} delta only`, () => {
    const e = extractCraftListRow("mounts-table", mooseRow(over));
    assert.strictEqual(e.unitProfit, NO_FOCUS + delta);
  });
  test(`${label}: unfunded units buy leather at the BASE return rate`, () => {
    const e = extractCraftListRow("mounts-table", mooseRow(over));
    const off = byId(e.materialsNoFocus).T6_LEATHER.count;
    assert.ok(near(off, 20 * (1 - 0.152)), `unfunded leather ${off}`);
    assert.strictEqual(e.inputCostNoFocus, 250000 + SADDLER_GAIN);
  });
});

test("nurture wins: funded units are not saddler-focused either — base leather, base cost", () => {
  const e = extractCraftListRow("mounts-table", mooseRow());
  assert.ok(near(byId(e.materials).T6_LEATHER.count, 20 * (1 - 0.152)));
  assert.strictEqual(e.inputCost, 250000 + SADDLER_GAIN);
});

test("saddler wins: funded units buy leather at the focused rate and the focused cost", () => {
  const e = extractCraftListRow("mounts-table", mooseRow(saddlerWins));
  assert.ok(near(byId(e.materials).T6_LEATHER.count, 20 * (1 - 0.435)));
  assert.strictEqual(e.inputCost, 250000);
});

test("Use Focus off: every unit at the unfocused profit (unchanged)", () => {
  const row = mooseRow({
    marginInfo: { profit: NO_FOCUS },
    focusProfitDelta: 0,
    saddlerRrr: 0.152,
    totalInputCost: 250000 + SADDLER_GAIN,
  });
  const entries = [Object.assign(extractCraftListRow("mounts-table", row), { qty: 1440 })];
  const alloc = allocateCraftListFocus(entries, 10000, { focusEnabled: false });
  const s = summarizeCraftList(entries, alloc);
  assert.strictEqual(s.totalProfit, 1440 * NO_FOCUS);
  assert.strictEqual(s.totalCost, 1440 * (250000 + SADDLER_GAIN));
});

// ── 3. the reported basket ─────────────────────────────────────────────────

test("Moose T6 ×1440, 10k budget: 80 funded × 73,524 + 1,360 × 3,937 ≈ 11.24M", () => {
  const entries = [Object.assign(extractCraftListRow("mounts-table", mooseRow()), { qty: 1440 })];
  const alloc = allocateCraftListFocus(entries, 10000);
  assert.strictEqual(alloc.splits[0].fundedQty, 80, "125 focus a day → 80 nurtured babies");
  assert.strictEqual(alloc.splits[0].unfundedQty, 1360);
  const s = summarizeCraftList(entries, alloc);
  assert.strictEqual(s.totalProfit, 80 * (NO_FOCUS + NURTURE) + 1360 * NO_FOCUS);
  assert.ok(Math.abs(s.totalProfit - 11.24e6) < 0.01e6, `total ${s.totalProfit}`);
  // Nurture costs offspring, never leather: the whole basket buys at base RRR.
  assert.strictEqual(s.totalCost, 1440 * (250000 + SADDLER_GAIN));
  const agg = aggregateCraftListMaterials(entries, alloc);
  assert.ok(near(byId(agg.lines).T6_LEATHER.count, 1440 * 20 * (1 - 0.152)));
});

test("toggling Use Focus moves Total Profit only by funded units × the winning delta", () => {
  const onEntries = [Object.assign(extractCraftListRow("mounts-table", mooseRow()), { qty: 1440 })];
  const on = summarizeCraftList(onEntries, allocateCraftListFocus(onEntries, 10000));
  const offRow = mooseRow({ marginInfo: { profit: NO_FOCUS }, focusProfitDelta: 0, saddlerRrr: 0.152 });
  const offEntries = [Object.assign(extractCraftListRow("mounts-table", offRow), { qty: 1440 })];
  const off = summarizeCraftList(offEntries, allocateCraftListFocus(offEntries, 10000, { focusEnabled: false }));
  assert.strictEqual(on.totalProfit - off.totalProfit, 80 * NURTURE);
});

test("Profit / 10k bar stays constant across the toggle; list cell = Total + bar", () => {
  const bar = mooseRow().profitPer10kFocus;
  [true, false].forEach((focusOn) => {
    const row = focusOn ? mooseRow()
      : mooseRow({ marginInfo: { profit: NO_FOCUS }, focusProfitDelta: 0, saddlerRrr: 0.152 });
    const entries = [Object.assign(extractCraftListRow("mounts-table", row), { qty: 1440 })];
    const s = summarizeCraftList(entries, allocateCraftListFocus(entries, 10000, { focusEnabled: focusOn }));
    assert.strictEqual(row.profitPer10kFocus, bar);
    assert.strictEqual(combinedPer10k(row.profitPer10kFocus, s.totalProfit, false), s.totalProfit + 2038395);
  });
});

test("an older row with no unfocused twin keeps the previous split", () => {
  const e = extractCraftListRow("mounts-table", mooseRow({
    profitNoFocus: undefined, totalInputCostNoFocus: undefined,
  }));
  assert.strictEqual(e.unitProfit, NO_FOCUS + SADDLER_GAIN + NURTURE);
  assert.strictEqual(e.unitProfitNoFocus, NO_FOCUS + SADDLER_GAIN);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
