/**
 * Test: a breeding row's two focus plays are EXACTLY marginal, and an
 * unscorable row is never split.
 *
 * A breeding cycle has two places to spend focus, and the Crafting List prices
 * a funded unit as `profitNoFocus + winning play delta`. That is only right if
 * each delta is the play measured against the FULLY unfocused cycle:
 *
 *   U = cycle_b + base       × max(baby, cycle_b)        (nothing focused)
 *   N = cycle_b + (base+gain) × max(baby, cycle_b)        (nurture only)
 *   S = cycle_f + base       × max(baby, cycle_f)        (saddler only)
 *
 * where cycle_b / cycle_f are the cycle margins at the base / focused saddler
 * return rate. Bugs pinned here:
 *   - the nurture delta valued the offspring at the FOCUSED saddler cycle, so a
 *     nurture-wins unit came out a little above N;
 *   - the saddler delta was the leather refund alone, missing the base
 *     offspring chance on the higher cycle, so a saddler-wins unit came out a
 *     little below S;
 *   - a row that cannot be scored (no sell price, missing saddler mats) has a
 *     0 headline, and splitting it showed funded units at `0 + delta`.
 *
 * Black box: the REAL renderMountsTable over synthetic market data, then the
 * REAL Craft List extractor. Simulated prices only, no live APIs.
 *
 * Run: node tests/breeding-focus-play-marginal.test.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const { extractCraftListRow } = require(path.join(__dirname, "..", "js", "craft-list-materials.js"));

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
const mod = new Module("breeding-focus-play-marginal");
mod._compile(`${stubs}${sources}\nmodule.exports = { tableState, renderMountsTable, _els, PREMIUM_TAX };`,
  "breeding-focus-play-marginal.js");
const X = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}
const near = (a, b) => Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-9);

// T8 Riding Horse: baby → grown (fed) → saddled with 20x T8_LEATHER. Leather
// price drives the saddler play, baby price the nurture play.
function render({ babyPrice, leatherPrice, mountPrice, omit = [], focus = true }) {
  const md = {};
  const put = (id, b, s) => {
    if (omit.includes(id)) return;
    (md[id] = md[id] || {}).Lymhurst = { buy_price: b, sell_price: s, volume_24h: 1000 };
  };
  put("T8_FARM_HORSE_BABY", babyPrice, babyPrice + 1000);
  put("T8_FARM_HORSE_GROWN", 100000, 110000);
  put("T8_LEATHER", leatherPrice, leatherPrice + 100);
  put("T8_MOUNT_HORSE", mountPrice, mountPrice + 20000);
  ["T1_CARROT", "T2_BEAN", "T3_WHEAT", "T4_TURNIP", "T5_CABBAGE", "T6_POTATO", "T7_CORN", "T8_PUMPKIN"]
    .forEach((id) => put(id, 300, 310));
  X._els["use-focus"].checked = focus;
  X.renderMountsTable(md);
  return X.tableState["mounts-table"].data.find(
    (r) => r.isBreeding && r.item && r.item.babyId === "T8_FARM_HORSE_BABY" && r.section === "royal");
}

/** The three cycles, computed straight from the row's published inputs. */
function cycles(r) {
  const P = r.sellPot.price * (1 - X.PREMIUM_TAX);
  const baby = r.buyMat.price;
  const base = r.meta.baseOffspringPct / 100;
  const gain = r.meta.nurtureGainPct / 100;
  const value = (cycle, chance) => {
    const unit = Math.max(baby, cycle);
    return cycle + (unit > 0 ? chance * unit : 0);
  };
  const cycleB = P - r.totalInputCostNoFocus;
  // With Use Focus on, the row's own input cost IS the focused saddler pass.
  const cycleF = P - r.totalInputCost;
  return {
    U: value(cycleB, base),
    N: value(cycleB, base + gain),
    S: value(cycleF, base),
  };
}

const NURTURE_WINS = [
  { babyPrice: 400000, leatherPrice: 200, mountPrice: 900000 },
  { babyPrice: 250000, leatherPrice: 1500, mountPrice: 700000 },
  { babyPrice: 600000, leatherPrice: 5000, mountPrice: 1200000 },
];
const SADDLER_WINS = [
  { babyPrice: 1, leatherPrice: 400000, mountPrice: 500000 },
  { babyPrice: 1, leatherPrice: 250000, mountPrice: 9000000 },
  { babyPrice: 5000, leatherPrice: 600000, mountPrice: 14000000 },
];

console.log("\n=== the winning play's delta is exactly marginal ===");

[["nurture", NURTURE_WINS, "N"], ["saddler", SADDLER_WINS, "S"]].forEach(([kind, fixtures, key]) => {
  fixtures.forEach((fx, i) => {
    const tag = `${kind} wins #${i + 1} (baby ${fx.babyPrice}, leather ${fx.leatherPrice})`;
    test(`${tag}: fixture sanity`, () => {
      const r = render(fx);
      assert.ok(r && r.marginInfo.profit, "row must be scored");
      assert.strictEqual(r.bestFocusPlay.kind, kind);
      assert.ok(r.totalInputCostNoFocus > r.totalInputCost, "saddler focus must save leather");
    });
    test(`${tag}: profitNoFocus + delta = profit with only that play on`, () => {
      const r = render(fx);
      const c = cycles(r);
      assert.ok(near(r.profitNoFocus, c.U), `unfocused ${r.profitNoFocus} ≠ ${c.U}`);
      assert.ok(near(r.profitNoFocus + r.bestFocusPlay.profitDelta, c[key]),
        `funded ${r.profitNoFocus + r.bestFocusPlay.profitDelta} ≠ ${key} ${c[key]}`);
    });
    // The list funds the NURTURE play on every breeding row, whichever play
    // the table's Focus Play cell names: it is the focus Profit / 10k Focus
    // prices, so that column's gain is what Total Profit adds (2026-10-07).
    test(`${tag}: the Crafting List's funded unit is the nurtured cycle`, () => {
      const r = render(fx);
      const e = extractCraftListRow("mounts-table", r);
      assert.ok(near(e.unitProfit, cycles(r).N), `funded ${e.unitProfit} ≠ ${cycles(r).N}`);
      assert.ok(near(e.unitProfitNoFocus, cycles(r).U));
    });
  });
});

test("the losing saddler play is marginal too (S − U)", () => {
  NURTURE_WINS.forEach((fx) => {
    const r = render(fx);
    const c = cycles(r);
    assert.ok(near(r.saddlerProfitPerFocus * r.saddlerFocusCost, c.S - c.U),
      `saddler delta ${r.saddlerProfitPerFocus * r.saddlerFocusCost} ≠ ${c.S - c.U}`);
  });
});

test("the nurture delta does not move with the Use Focus checkbox", () => {
  NURTURE_WINS.forEach((fx) => {
    const on = render(fx).bestFocusPlay.profitDelta;
    const off = render(Object.assign({}, fx, { focus: false })).bestFocusPlay.profitDelta;
    assert.ok(near(off, on), `off ${off} vs on ${on}`);
  });
});

console.log("\n=== an unscorable row is never split ===");

[
  ["no sell price for the saddled mount", { omit: ["T8_MOUNT_HORSE"] }],
  ["missing saddler materials", { omit: ["T8_LEATHER"] }],
].forEach(([label, over]) => {
  test(`${label}: no unfocused twin is published`, () => {
    const r = render(Object.assign({}, NURTURE_WINS[0], over));
    assert.ok(r, "the always-visible row must still render");
    assert.strictEqual(r.marginInfo.profit, 0, "fixture: the row is unscored");
    assert.ok(r.profitNoFocus === null || r.profitNoFocus === undefined,
      `profitNoFocus must be absent, got ${r.profitNoFocus}`);
  });
  test(`${label}: funded units never show 0 + delta`, () => {
    const r = render(Object.assign({}, NURTURE_WINS[0], over));
    const e = extractCraftListRow("mounts-table", r);
    assert.strictEqual(e.unitProfit, r.marginInfo.profit, "funded unit stays the unscored headline");
    const delta = Number(r.focusProfitDelta) || 0;
    assert.strictEqual(e.unitProfitNoFocus, delta > 0 ? r.marginInfo.profit - delta : r.marginInfo.profit,
      "priced as before the split");
  });
});

test("a synthetic unscored row with profitNoFocus null keeps the pre-split pricing", () => {
  const e = extractCraftListRow("mounts-table", {
    isBreeding: true,
    item: { babyId: "T8_FARM_HORSE_BABY", id: "T8_MOUNT_HORSE" },
    meta: { maxNurtures: 4 },
    marginInfo: { profit: 0 },
    profitNoFocus: null,
    totalInputCostNoFocus: null,
    totalInputCost: 1000,
    focusCost: 500,
    focusProfitDelta: 40000,
    bestFocusPlay: { kind: "nurture", focusCost: 500, profitDelta: 40000 },
  });
  assert.strictEqual(e.unitProfit, 0);
  assert.strictEqual(e.unitProfitNoFocus, -40000);
  assert.strictEqual(e.inputCost, 1000);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
