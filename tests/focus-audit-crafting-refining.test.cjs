/**
 * Focus audit — Crafting, Crafting Planner and Refining tables.
 *
 * Three rules, checked black-box on every table that has a Use Focus effect or
 * a Profit / 10k Focus column, against simulated market data (no network):
 *
 *   1. Profit / 10k Focus is the focus-ON value and does not change when the
 *      global "Use Focus" checkbox is toggled — tested both ways (off → on and
 *      on → off) on fresh evaluations.
 *   2. The focus-on profit includes only focus effects whose focus is billed
 *      in `focusCost` (no free effect that costs no focus, and no billed focus
 *      without its effect).
 *   3. The focus-off profit, materials and cost are fully unfocused (no focus
 *      RRR, no focused return rates leaking in).
 *
 * Each table is driven through the same entry point its renderer uses:
 *   Crafting         → craftingRowsForItem (js/render-crafting.js)
 *   Crafting Planner → computeCraftPlannerRow (js/craft-planner-pricing.js),
 *                      via the shared tests/helpers/craft-planner-pricing-harness
 *   Refining         → renderTransportTable (js/render-transport.js), with
 *                      renderTableData stubbed to capture the row data.
 *
 * Run: node tests/focus-audit-crafting-refining.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const CALC = require("../js/calculations.js");
const BONUS = require("../js/data-city-bonuses.js");
const P = require("./helpers/craft-planner-pricing-harness.cjs");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}
const near = (a, b, eps = 1e-6) => a === b || (a != null && b != null && Math.abs(a - b) <= eps);
function assertNear(a, b, msg, eps = 1e-6) {
  assert.ok(near(a, b, eps), `${msg} (got ${a}, expected ${b})`);
}

// The real calculations.js functions, handed to each sandbox so no table is
// tested against a hand-copied RRR / margin formula.
globalThis.__AUDIT_CALC__ = CALC;
globalThis.__AUDIT_BONUS__ = BONUS;
const CALC_PRELUDE = `
const __C = globalThis.__AUDIT_CALC__;
const __B = globalThis.__AUDIT_BONUS__;
const SETUP_FEE = __C.SETUP_FEE;
const PREMIUM_TAX = __C.PREMIUM_TAX;
const BASE_CITY_BONUS = __B.BASE_CITY_BONUS;
const FOCUS_BONUS = __B.FOCUS_BONUS;
const CITY_CRAFT_SPEC = __B.CITY_CRAFT_SPEC;
const CITY_REFINE_SPEC = __B.CITY_REFINE_SPEC;
const calcRRR = __C.calcRRR;
const getCraftRRR = __C.getCraftRRR;
const getRefineRRR = __C.getRefineRRR;
const calculateTransportMargin = __C.calculateTransportMargin;
const calculateProfitPer10kFocus = __C.calculateProfitPer10kFocus;
const calculateProfitPerFocus = __C.calculateProfitPerFocus;
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = CITIES;
let __focusOn = false;
let __bmrOn = true;
let __orderType = "instant";
function isFocusEnabled() { return __focusOn; }
function isBlackRedZoneEnabled() { return __bmrOn; }
function isValidSourceCity(buyCity, craftCity) {
  if (!buyCity || !craftCity) return false;
  if (isBlackRedZoneEnabled()) return true;
  if (BLACK_ZONE_CITIES.includes(buyCity) || BLACK_ZONE_CITIES.includes(craftCity)) return false;
  return (buyCity === "Caerleon") === (craftCity === "Caerleon");
}
function isInvalidCrossRoute(a, b) { return !isValidSourceCity(a, b); }
function getCityForce() { return null; }
function getOverridePrice() { return null; }
function getIQRBounds() { return { upper: Infinity }; }
function getBuyPrice(d, c) { return (d && d[c] && d[c].buy_price) || 0; }
function getSellPrice(d, c) { return (d && d[c] && d[c].sell_price) || 0; }
function getCityVol(md, id, c) { return (md && md[id] && md[id][c] && md[id][c].volume_24h) || 0; }
function getTierFromId(id) { const m = id && String(id).match(/^T(\\d+)/); return m ? parseInt(m[1], 10) : 4; }
function getOrderType() { return __orderType; }
function matsNeededFor10kFocus(focusCost, per, applyRrr, rrr) {
  const c = Math.floor(10000 / focusCost); const e = applyRrr ? per * (1 - (rrr || 0)) : per; return Math.round(c * e);
}
function __set(o) {
  if ("focus" in o) __focusOn = !!o.focus;
  if ("bmr" in o) __bmrOn = !!o.bmr;
  if ("orderType" in o) __orderType = o.orderType;
}
`;

function compile(name, src, exportsList) {
  const mod = new Module(name);
  mod._compile(src + `\nmodule.exports = { ${exportsList.join(", ")} };`, name + ".js");
  return mod.exports;
}

function priceMap(entries) {
  const out = {};
  for (const e of entries) {
    if (!out[e.id]) out[e.id] = {};
    out[e.id][e.city] = { buy_price: e.buy || 0, sell_price: e.sell || 0, volume_24h: e.vol == null ? 9999 : e.vol };
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. CRAFTING (crafting-table)
// ═════════════════════════════════════════════════════════════════════════════

const CR = compile("audit-crafting", CALC_PRELUDE + `
// Focus is billed per item: 0 marks an item that is NOT focus-craftable.
const __FOCUS = {};
function getFocusCost(id) { return id in __FOCUS ? __FOCUS[id] : 100; }
function getCraftFocusCost(id, tier) { return getFocusCost(id, tier, "crafting"); }
function calcStationFeeSilver() { return 37; }
function __setFocusCost(id, v) { __FOCUS[id] = v; }
const recipeCache = {};
` + read("js/focus-play.js") + read("js/render-crafting.js"),
["craftingRowsForItem", "isNonReturnableCraftMat", "getCraftRRR", "__set", "__setFocusCost", "SETUP_FEE", "PREMIUM_TAX"]);

// Each fixture: an item with inline materials + a market. `focusCost` 0 marks a
// non-focus-craftable item.
const CRAFT_FIXTURES = [
  {
    name: "margin gate flips the winning sell city",
    item: { id: "T4_AUDIT_ARMOR", craftType: null, materials: [{ matId: "T4_CLOTH", count: 8 }] },
    md: priceMap([
      { id: "T4_CLOTH", city: "Lymhurst", buy: 1000 },
      { id: "T4_AUDIT_ARMOR", city: "Caerleon", sell: 6000 },
      { id: "T4_AUDIT_ARMOR", city: "Lymhurst", sell: 5000 },
    ]),
  },
  {
    name: "spec city craft with a non-returnable artifact",
    item: { id: "T6_MAIN_AUDITSWORD", craftType: "sword",
      materials: [{ matId: "T6_METALBAR", count: 16 }, { matId: "T6_ARTEFACT_MAIN_AUDIT", count: 1 }] },
    md: priceMap([
      { id: "T6_METALBAR", city: "Lymhurst", buy: 900 },
      { id: "T6_ARTEFACT_MAIN_AUDIT", city: "Martlock", buy: 20000 },
      { id: "T6_MAIN_AUDITSWORD", city: "Lymhurst", sell: 52000 },
      { id: "T6_MAIN_AUDITSWORD", city: "Bridgewatch", sell: 51000 },
    ]),
  },
  {
    name: "no-return combine craft",
    item: { id: "T5_AUDIT_COMBINE", craftType: null, noReturn: true,
      materials: [{ matId: "T5_PLANKS", count: 10 }] },
    md: priceMap([
      { id: "T5_PLANKS", city: "Thetford", buy: 300 },
      { id: "T5_AUDIT_COMBINE", city: "Thetford", sell: 4000 },
    ]),
  },
  {
    name: "loss-making craft (fallback route)",
    item: { id: "T4_AUDIT_LOSS", craftType: null, materials: [{ matId: "T4_LEATHER", count: 12 }] },
    md: priceMap([
      { id: "T4_LEATHER", city: "Martlock", buy: 2000 },
      { id: "T4_AUDIT_LOSS", city: "Martlock", sell: 9000 },
    ]),
  },
  {
    name: "item that is NOT focus-craftable (focusCost 0)",
    focusCost: 0,
    item: { id: "T4_AUDIT_NOFOCUS", craftType: null, materials: [{ matId: "T4_PLANKS", count: 8 }] },
    md: priceMap([
      { id: "T4_PLANKS", city: "Fort Sterling", buy: 500 },
      { id: "T4_AUDIT_NOFOCUS", city: "Fort Sterling", sell: 6000 },
    ]),
  },
];
CRAFT_FIXTURES.forEach((f) => { if (f.focusCost != null) CR.__setFocusCost(f.item.id, f.focusCost); });

function craftRows(f, focus) {
  CR.__set({ focus, bmr: true });
  const rows = CR.craftingRowsForItem(f.item, f.md).filter((r) => r.marginInfo && r.marginInfo.margin !== -1);
  const out = {};
  rows.forEach((r) => { out[r.craftCity] = r; });
  return out;
}

// Independent recomputation of a crafting route's input cost at a given RRR.
function craftCostAt(row, rrr) {
  let cost = 0;
  row.materials.forEach((m) => {
    const eff = CR.isNonReturnableCraftMat(m.matId) ? m.count : m.count * (1 - rrr);
    cost += row.matBestPrices[m.matId].price * eff * (1 + CR.SETUP_FEE);
  });
  return cost + 37; // station fee stub
}

console.log("\n=== Crafting: rule 1 — Profit / 10k Focus is invariant to the toggle ===");
CRAFT_FIXTURES.forEach((f) => {
  [["off → on", [false, true]], ["on → off", [true, false]]].forEach(([dir, order]) => {
    test(`[crafting] ${f.name}: Profit/10k identical ${dir}`, () => {
      const a = craftRows(f, order[0]);
      const b = craftRows(f, order[1]);
      const cities = Object.keys(a);
      assert.ok(cities.length > 0, "fixture produced no priced rows");
      assert.deepStrictEqual(Object.keys(b).sort(), cities.sort());
      cities.forEach((c) => {
        assertNear(b[c].profitPer10kFocus, a[c].profitPer10kFocus, `${c}: Profit/10k moved`);
        assertNear(b[c].profitFocusOn, a[c].profitFocusOn, `${c}: focus-on profit moved`);
      });
    });
  });
});

console.log("\n=== Crafting: rule 2 — focus-on profit only carries billed focus ===");
CRAFT_FIXTURES.forEach((f) => {
  test(`[crafting] ${f.name}: focus-on headline = billed focus effect, Profit/10k = it × bar`, () => {
    const on = craftRows(f, true);
    const off = craftRows(f, false);
    Object.keys(on).forEach((c) => {
      const r = on[c];
      const billed = r.focusCost > 0;
      const baseRrr = f.item.noReturn ? 0 : CR.getCraftRRR(c, f.item.craftType, false);
      const focusRrr = f.item.noReturn ? 0 : CR.getCraftRRR(c, f.item.craftType, true);
      // No free effect: an unbilled craft keeps its base return rate.
      assertNear(r.rrr, billed ? focusRrr : baseRrr, `${c}: headline RRR vs billed focus ${r.focusCost}`);
      // No billed focus without its effect: the cost is exactly the billed RRR's.
      assertNear(r.totalInputCost, craftCostAt(r, r.rrr), `${c}: input cost not at the headline RRR`);
      if (!billed) {
        assertNear(r.marginInfo.profit, off[c].marginInfo.profit, `${c}: unbilled focus changed profit`);
        assert.ok(!r.profitPer10kFocus, `${c}: a craft with no focus cost has no 10k-focus value`);
      } else {
        // The benchmark is the focus-on headline × the crafts a bar buys.
        assertNear(r.profitFocusOn, r.marginInfo.profit, `${c}: focus-on twin ≠ focused headline`);
        assertNear(r.profitPer10kFocus, r.profitFocusOn * CALC.focusBarCrafts(r.focusCost), `${c}: Profit/10k`);
        // The gathered line: the same focus-on route's self-gathered twin × bar.
        assertNear(r.profitFocusOnGathered, r.marginInfo.selfFoundProfit, `${c}: gathered operand`);
        assertNear(r.profitPer10kFocusGathered,
          r.marginInfo.selfFoundProfit * CALC.focusBarCrafts(r.focusCost), `${c}: Profit/10k gathered`);
        assertNear(off[c].profitPer10kFocusGathered, r.profitPer10kFocusGathered,
          `${c}: Profit/10k gathered moved with the toggle`);
      }
    });
  });
});

console.log("\n=== Crafting: rule 3 — focus-off is fully unfocused ===");
CRAFT_FIXTURES.forEach((f) => {
  test(`[crafting] ${f.name}: focus-off RRR, cost and profit are base`, () => {
    const off = craftRows(f, false);
    Object.keys(off).forEach((c) => {
      const r = off[c];
      const baseRrr = f.item.noReturn ? 0 : CR.getCraftRRR(c, f.item.craftType, false);
      assertNear(r.rrr, baseRrr, `${c}: focus RRR leaked into the focus-off row`);
      assertNear(r.totalInputCost, craftCostAt(r, baseRrr), `${c}: focus-off input cost`);
      const rev = r.sellGear.price * (1 - CR.PREMIUM_TAX);
      assertNear(r.marginInfo.profit, rev - r.totalInputCost, `${c}: focus-off profit`);
      assert.strictEqual(r.focusProfitDelta, 0, `${c}: focus-off row reports a focus gain`);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. CRAFTING PLANNER (craft-planner-table)
// ═════════════════════════════════════════════════════════════════════════════

const FS = "Fort Sterling";
const PLANNER_FIXTURES = [
  {
    name: "furniture, all-market mats (craft play)",
    item: { id: "T8_FURNITUREITEM_TABLE", name: "Elder's Table", craftType: null },
    mats: [{ matId: "T8_PLANKS", count: 30 }],
    city: FS,
    md: () => priceMap([
      { id: "T8_PLANKS", city: FS, buy: 1000 },
      { id: "T8_FURNITUREITEM_TABLE", city: FS, sell: 60000 },
      { id: "T8_JOURNAL_TOOLMAKER_EMPTY", city: FS, buy: 5000 },
      { id: "T8_JOURNAL_TOOLMAKER_FULL", city: FS, sell: 20000 },
    ]),
  },
  {
    name: "Martlock craft spec, focus on the plank refine wins",
    setup: () => P.__setCraftSpec(0.40),
    item: { id: "T8_FURNITUREITEM_TABLE", name: "Elder's Table", craftType: null },
    mats: [{ matId: "T8_PLANKS", count: 30 }],
    city: "Martlock",
    md: () => priceMap([
      { id: "T8_PLANKS", city: FS, buy: 5000 },
      { id: "T8_WOOD", city: FS, buy: 500 },
      { id: "T7_PLANKS", city: FS, buy: 500 },
      { id: "T8_FURNITUREITEM_TABLE", city: FS, sell: 600000 },
    ]),
  },
  {
    name: "enchant route sits between the focused and unfocused craft cost",
    item: { id: "T5_MAIN_SWORD@1", name: "Adept's Sword", craftType: "sword" },
    mats: [{ matId: "T5_METALBAR@1", count: 16 }],
    city: FS,
    md: () => priceMap([
      { id: "T5_METALBAR@1", city: FS, buy: 9000 },
      { id: "T5_MAIN_SWORD@1", city: FS, sell: 150000 },
      { id: "T5_MAIN_SWORD", city: FS, buy: 1000 },
      { id: "T5_RUNE", city: FS, buy: 330 },
      { id: "T5_JOURNAL_WARRIOR_EMPTY", city: FS, buy: 4000 },
      { id: "T5_JOURNAL_WARRIOR_FULL", city: FS, sell: 18000 },
    ]),
  },
  {
    name: "enchant route beats the craft either way",
    item: { id: "T5_MAIN_SWORD@1", name: "Adept's Sword", craftType: "sword" },
    mats: [{ matId: "T5_METALBAR@1", count: 16 }],
    city: FS,
    md: () => priceMap([
      { id: "T5_METALBAR@1", city: FS, buy: 9000 },
      { id: "T5_MAIN_SWORD@1", city: FS, sell: 50000 },
      { id: "T5_MAIN_SWORD", city: FS, buy: 1000 },
      { id: "T5_RUNE", city: FS, buy: 100 },
    ]),
  },
  {
    name: "craft with no focus cost and no refinable material",
    setup: () => P.__setCraftFocus(0),
    item: { id: "T4_AUDIT_COMBINE", name: "Combine", craftType: null },
    mats: [{ matId: "T4_ARTEFACT_AUDIT", count: 1 }, { matId: "T4_CAPE", count: 1 }],
    city: FS,
    md: () => priceMap([
      { id: "T4_ARTEFACT_AUDIT", city: FS, buy: 3000 },
      { id: "T4_CAPE", city: FS, buy: 2000 },
      { id: "T4_AUDIT_COMBINE", city: FS, sell: 9000 },
    ]),
  },
];

function plannerRow(f, focus) {
  P.__reset();
  if (f.setup) f.setup();
  P.__setFocus(focus);
  const row = P.computeCraftPlannerRow(f.item, f.mats, f.md(), f.city);
  P.__reset();
  return row;
}
function plannerBaseRrr(f) { P.__reset(); if (f.setup) f.setup(); const r = P.getCraftRRR(f.city, f.item.craftType, false); P.__reset(); return r; }
function plannerFocusRrr(f) { P.__reset(); if (f.setup) f.setup(); const r = P.getCraftRRR(f.city, f.item.craftType, true); P.__reset(); return r; }

// Every chain node the row sourced must have been built at the BASE refine rate.
function assertChainsUnfocused(sourcing, label) {
  (sourcing || []).forEach((s) => {
    const walk = (node) => {
      if (!node) return;
      assertNear(node.rrr, P.getRefineRRR(node.refineCity, node.resourceType, false),
        `${label}: chain node ${node.produces} built at a focused RRR`);
      (node.inputs || []).forEach((i) => i.sourcing && i.sourcing.source === "chain" && walk(i.sourcing.chain));
    };
    if (s.sourcing && s.sourcing.source === "chain" && s.sourcing.focusTier == null) walk(s.sourcing.chain);
  });
}

console.log("\n=== Crafting Planner: rule 1 — Profit / 10k Focus is invariant to the toggle ===");
PLANNER_FIXTURES.forEach((f) => {
  [["off → on", [false, true]], ["on → off", [true, false]]].forEach(([dir, order]) => {
    test(`[planner] ${f.name}: Profit/10k identical ${dir}`, () => {
      const a = plannerRow(f, order[0]);
      const b = plannerRow(f, order[1]);
      assert.ok(!a.noData && !b.noData, "fixture must price");
      assert.strictEqual(b.profitPer10kFocus == null, a.profitPer10kFocus == null,
        `Profit/10k null-ness moved (first=${a.profitPer10kFocus}, then=${b.profitPer10kFocus})`);
      assertNear(b.profitPer10kFocus, a.profitPer10kFocus, "Profit/10k moved");
      assertNear(b.focusPerCraft, a.focusPerCraft, "focus per craft moved");
      assertNear(b.focusCombinedProfit, a.focusCombinedProfit, "focus-on profit moved");
    });
  });
});

console.log("\n=== Crafting Planner: rule 2 — focus-on profit only carries billed focus ===");
PLANNER_FIXTURES.forEach((f) => {
  test(`[planner] ${f.name}: focus-on headline = exactly the billed play`, () => {
    const r = plannerRow(f, true);
    const baseRrr = plannerBaseRrr(f), focusRrr = plannerFocusRrr(f);
    const focusedSrc = r.sourcing.filter((s) => s.sourcing && s.sourcing.focusTier != null);
    if (r.enchantedVia) {
      // Bought and enchanted: no focus anywhere, so none may be billed.
      assert.strictEqual(r.focusPerCraft, 0, "enchant route bills focus");
      assert.strictEqual(r.profitPer10kFocus, null);
      assert.strictEqual(focusedSrc.length, 0);
      return;
    }
    if (!(r.focusPerCraft > 0)) {
      // Nothing billed → nothing focused: base craft RRR, no focused refine,
      // profit identical to the no-focus twin.
      assertNear(r.rrr, baseRrr, "free craft RRR with no focus billed");
      assert.strictEqual(focusedSrc.length, 0, "free focused refine with no focus billed");
      assertNear(r.craftProfit, r.noFocusCraftProfit, "profit gained without billed focus");
      assert.strictEqual(r.profitPer10kFocus, null, "no focus billed → no 10k-focus value");
      return;
    }
    // Something is billed: the effect is exactly that ONE play.
    const play = r.bestFocusStep;
    assert.ok(play, "focus billed without a play");
    if (play.kind === "craft") {
      assertNear(r.rrr, focusRrr, "craft play billed but craft RRR not focused");
      assert.strictEqual(focusedSrc.length, 0, "craft play also focused a refine for free");
      assertNear(r.focusPerCraft, play.focusCost, "craft play bills its craft focus once");
    } else {
      assertNear(r.rrr, baseRrr, "refine play billed but the craft RRR got focus too");
      assert.strictEqual(focusedSrc.length, 1, "refine play must focus exactly one material");
      assert.strictEqual(focusedSrc[0].sourcing.focusTier, play.tier);
    }
    assertNear(r.craftProfit - r.noFocusCraftProfit, play.profitDelta,
      "focus-on gain ≠ the billed play's effect");
    assertNear(r.focusCraftProfit, r.craftProfit, "focus-on twin ≠ focused headline");
    assertNear(r.profitPer10kFocus, r.focusCombinedProfit * CALC.focusBarCrafts(r.focusPerCraft), "Profit/10k");
  });
});

console.log("\n=== Crafting Planner: rule 3 — focus-off is fully unfocused ===");
PLANNER_FIXTURES.forEach((f) => {
  test(`[planner] ${f.name}: focus-off RRR, sourcing and profit are base`, () => {
    const r = plannerRow(f, false);
    if (!r.enchantedVia) {
      assertNear(r.rrr, plannerBaseRrr(f), "focus craft RRR leaked into the focus-off row");
    }
    r.sourcing.forEach((s) => assert.ok(!(s.sourcing && s.sourcing.focusTier != null),
      `${s.matId}: focused refine leaked into the focus-off row`));
    assertChainsUnfocused(r.sourcing, "focus-off");
    assert.deepStrictEqual(r.sourcing, r.noFocusSourcing, "materials differ from the no-focus basis");
    assertNear(r.craftProfit, r.noFocusCraftProfit, "focus-off profit ≠ no-focus profit");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. REFINING (transport-table)
// ═════════════════════════════════════════════════════════════════════════════

const RF = compile("audit-refining", CALC_PRELUDE + `
const RESOURCE_DEFS = [
  { type: "wood", raw: "WOOD", refined: "PLANKS",
    tiers: [[2,"","",1],[3,"","",2],[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
  { type: "ore", raw: "ORE", refined: "METALBAR",
    tiers: [[2,"","",1],[3,"","",2],[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
];
let TRANSPORT_ITEMS = [];
function __setItems(list) { TRANSPORT_ITEMS = list; }
function getFocusCost(id) { const t = getTierFromId(id); return Math.round(30 * Math.pow(2, t - 4)) || 8; }
function refineStationFeeSilver() { return 11; }
function calcStationFeeSilver() { return 11; }
function getResourceWeightKg() { return 1; }
function calculateOxLoad() { return 0; }
function getMinVol2() { return 0; }
function findBestBuyCity(md, id, cities) {
  let best = { city: null, price: 0 };
  cities.forEach((c) => { const p = getBuyPrice(md[id], c); if (p > 0 && (!best.price || p < best.price)) best = { city: c, price: p }; });
  return best;
}
function findBestSellCity(md, id, cities) {
  let best = { city: null, price: 0 };
  cities.forEach((c) => { const p = getSellPrice(md[id], c); if (p > best.price) best = { city: c, price: p }; });
  return best;
}
let __captured = null;
function renderTableData(id, rows) { __captured = rows; }
function __rows() { return __captured; }
` + read("js/focus-play.js") + read("js/refining-chain-recipes.js") + read("js/refining-chain-pricing.js") +
  read("js/refining-chain-focus.js") + read("js/refining-route.js") + read("js/render-transport.js"),
["renderTransportTable", "getRefineRRR", "chooseRawWithHeart", "__set", "__setItems", "__rows", "SETUP_FEE"]);

const W = (tier) => ({
  rawId: `T${tier}_WOOD`, refinedId: `T${tier}_PLANKS`,
  rawRatio: { 4: 2, 5: 3, 6: 4, 7: 5, 8: 5 }[tier], resourceType: "wood",
  secondaryMatId: `T${tier - 1}_PLANKS`, secondaryMatCount: 1,
});
const O = (tier) => ({
  rawId: `T${tier}_ORE`, refinedId: `T${tier}_METALBAR`,
  rawRatio: { 4: 2, 5: 3, 6: 4, 7: 5, 8: 5 }[tier], resourceType: "ore",
  secondaryMatId: `T${tier - 1}_METALBAR`, secondaryMatCount: 1,
});

const REFINE_FIXTURES = [
  {
    name: "single refine, market secondary (spec + Caerleon rows)",
    bmr: false,
    items: [W(4)],
    md: () => priceMap([
      { id: "T4_WOOD", city: "Fort Sterling", buy: 200 },
      { id: "T4_WOOD", city: "Caerleon", buy: 210 },
      { id: "T3_PLANKS", city: "Fort Sterling", buy: 150 },
      { id: "T3_PLANKS", city: "Caerleon", buy: 160 },
      { id: "T4_PLANKS", city: "Fort Sterling", sell: 700 },
      { id: "T4_PLANKS", city: "Caerleon", sell: 720 },
    ]),
  },
  {
    name: "ladder row: secondary refined in-house",
    bmr: true,
    items: [O(6)],
    md: () => priceMap([
      { id: "T6_ORE", city: "Thetford", buy: 900 },
      { id: "T5_ORE", city: "Thetford", buy: 400 },
      { id: "T4_ORE", city: "Thetford", buy: 150 },
      { id: "T3_METALBAR", city: "Thetford", buy: 120 },
      { id: "T5_METALBAR", city: "Thetford", buy: 9000 },
      { id: "T4_METALBAR", city: "Thetford", buy: 4000 },
      { id: "T6_METALBAR", city: "Thetford", sell: 9000 },
    ]),
  },
  {
    name: "faction heart wins only at the base return rate (flips with the toggle)",
    bmr: true,
    items: [W(5)],
    // raw 1000: base FS rrr (0.58/1.58≈0.367) → 633/raw; focused (1.17/2.17≈0.539) → 461/raw.
    md: () => priceMap([
      { id: "T5_WOOD", city: "Fort Sterling", buy: 1000 },
      { id: "T4_PLANKS", city: "Fort Sterling", buy: 500 },
      { id: "T1_FACTION_FOREST_TOKEN_1", city: "Fort Sterling", buy: 550 },
      { id: "T5_PLANKS", city: "Fort Sterling", sell: 3500 },
    ]),
  },
  {
    name: "thin raw volume → fallback row",
    bmr: true,
    orderType: "market",
    items: [W(4)],
    md: () => priceMap([
      { id: "T4_WOOD", city: "Fort Sterling", buy: 200, vol: 3 },
      { id: "T3_PLANKS", city: "Fort Sterling", buy: 150 },
      { id: "T4_PLANKS", city: "Fort Sterling", sell: 700 },
    ]),
  },
];

function refineRows(f, focus) {
  RF.__set({ focus, bmr: f.bmr, orderType: f.orderType || "instant" });
  RF.__setItems(f.items);
  RF.renderTransportTable(f.md());
  const out = {};
  (RF.__rows() || []).filter(Boolean).forEach((r) => { out[`${r.route.rawId}|${r.refineCity}`] = r; });
  RF.__set({ focus: false, bmr: true, orderType: "instant" });
  return out;
}
const priced = (r) => r && r.marginInfo && r.marginInfo.margin !== -1;

// Independent margin from a row's own published inputs at a given RRR.
function refineProfitAt(r, rrr) {
  const kept = r.heartCost > 0 ? r.route.rawRatio - 1 : r.route.rawRatio;
  const raw = r.rawUnitCost * kept;
  const sec = r.secondaryMat ? r.secondaryMat.price * r.secondaryMat.count : 0;
  return CALC.calculateTransportMargin(raw, r.sellRefined.price, rrr, sec, 11, 0,
    r.heartCost || 0, r.setupExemptCost || 0).profit;
}

console.log("\n=== Refining: rule 1 — Profit / 10k Focus is invariant to the toggle ===");
REFINE_FIXTURES.forEach((f) => {
  [["off → on", [false, true]], ["on → off", [true, false]]].forEach(([dir, order]) => {
    test(`[refining] ${f.name}: Profit/10k identical ${dir}`, () => {
      const a = refineRows(f, order[0]);
      const b = refineRows(f, order[1]);
      const keys = Object.keys(a);
      assert.ok(keys.some((k) => priced(a[k])), "fixture produced no priced rows");
      assert.deepStrictEqual(Object.keys(b).sort(), keys.sort());
      keys.forEach((k) => {
        assertNear(b[k].profitPer10kFocus, a[k].profitPer10kFocus, `${k}: Profit/10k moved`);
        assertNear(b[k].profitGatheredPer10kFocus, a[k].profitGatheredPer10kFocus, `${k}: Profit Gathered/10k moved`);
        assertNear(b[k].focusCost, a[k].focusCost, `${k}: focus cost moved`);
      });
    });
  });
});

console.log("\n=== Refining: rule 2 — focus-on profit only carries billed focus ===");
REFINE_FIXTURES.forEach((f) => {
  test(`[refining] ${f.name}: focus-on headline = exactly the billed tier`, () => {
    const on = refineRows(f, true);
    Object.keys(on).forEach((k) => {
      const r = on[k];
      if (!priced(r)) return;
      const rowTier = parseInt(r.route.rawId.match(/^T(\d+)/)[1], 10);
      const baseRrr = RF.getRefineRRR(r.refineCity, r.route.resourceType, false);
      const focusRrr = RF.getRefineRRR(r.refineCity, r.route.resourceType, true);
      assert.ok(r.focusCost > 0, `${k}: focused row bills no focus`);
      if (r.focusBestTier === rowTier) {
        assertNear(r.rrr, focusRrr, `${k}: billed own-tier focus but own refine not focused`);
        assertNear(r.refinesPerOutput, 1, `${k}: own-tier focus bills one refine per output`);
        if (!r.secondaryChain && r.secondaryMat) {
          // Market secondary: nothing below this refine can carry focus.
          assert.ok(r.secondaryMat.price > 0);
        }
      } else {
        // Focus billed on a lower rung: this refine stays at base, and the rung
        // below is what got cheaper.
        assertNear(r.rrr, baseRrr, `${k}: lower-rung focus also focused the top refine for free`);
        assert.ok(r.secondaryChain, `${k}: lower-rung focus without a ladder`);
        assert.ok(r.secondaryMat.price < r.secondaryChain.costPerOutput - 1e-9,
          `${k}: lower-rung focus billed but the ladder did not get cheaper`);
      }
      assertNear(r.marginInfo.profit, refineProfitAt(r, r.rrr), `${k}: profit not at the headline RRR`);
      assertNear(r.profitFocusOn, r.marginInfo.profit, `${k}: focus-on twin ≠ focused headline`);
      assertNear(r.profitPer10kFocus,
        CALC.calculateProfitPer10kFocus(r.profitFocusOn, r.focusCost, r.refinesPerOutput), `${k}: Profit/10k`);
    });
  });
});

console.log("\n=== Refining: rule 3 — focus-off is fully unfocused ===");
REFINE_FIXTURES.forEach((f) => {
  test(`[refining] ${f.name}: focus-off RRR, secondary, heart and profit are base`, () => {
    const off = refineRows(f, false);
    Object.keys(off).forEach((k) => {
      const r = off[k];
      const baseRrr = RF.getRefineRRR(r.refineCity, r.route.resourceType, false);
      assertNear(r.rrr, baseRrr, `${k}: focus RRR leaked into the focus-off row`);
      if (r.secondaryChain) {
        assertNear(r.secondaryMat.price, r.secondaryChain.costPerOutput, `${k}: secondary priced focused`);
        const walk = (node) => {
          if (!node) return;
          assertNear(node.rrr, RF.getRefineRRR(node.refineCity, node.resourceType, false),
            `${k}: ladder node ${node.produces} built focused`);
          (node.inputs || []).forEach((i) => i.sourcing && i.sourcing.source === "chain" && walk(i.sourcing.chain));
        };
        walk(r.secondaryChain);
      }
      // The heart decision is the base-RRR one.
      if (r.route.rawRatio >= 1) {
        const heartAtBase = r.heartCost > 0;
        if (heartAtBase) {
          assert.ok(r.heartCost < r.rawUnitCost * (1 - baseRrr), `${k}: heart booked that only wins with focus`);
        }
      }
      if (priced(r)) {
        assertNear(r.marginInfo.profit, refineProfitAt(r, baseRrr), `${k}: focus-off profit`);
      }
      assert.strictEqual(r.focusProfitDelta || 0, 0, `${k}: focus-off row reports a focus gain`);
    });
  });
});

test("[refining] heart fixture sanity: the heart flips with the toggle", () => {
  const f = REFINE_FIXTURES[2];
  const on = refineRows(f, true), off = refineRows(f, false);
  const k = Object.keys(on)[0];
  assert.ok(off[k].heartCost > 0 && !(on[k].heartCost > 0),
    `heart on=${on[k].heartCost} off=${off[k].heartCost}`);
});

test("[refining] ladder fixture sanity: the secondary is refined in-house both ways", () => {
  const f = REFINE_FIXTURES[1];
  [true, false].forEach((focus) => {
    const rows = refineRows(f, focus);
    const r = rows[Object.keys(rows).find((k) => priced(rows[k]))];
    assert.ok(r && r.secondaryChain, `focus=${focus}: secondary should be refined in-house`);
  });
});

test("[refining] fallback fixture sanity: the row is the thin-volume fallback", () => {
  const f = REFINE_FIXTURES[3];
  const off = refineRows(f, false);
  const r = off[Object.keys(off)[0]];
  assert.ok(r && priced(r), "fallback row should still price");
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
