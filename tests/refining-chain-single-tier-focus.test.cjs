/**
 * Test: the Refining / Transports row prices its refining chain with focus at
 * EXACTLY ONE tier — the tier the Best Focus column names — never at every rung.
 *
 * Reported bug: a T7/T8 leather row showed a six-deep "via chain" material tree
 * (T7 <- T6 <- T5 <- T4 <- T3) while its own Best Focus column said the play was
 * a single "Refine T7 leather @ 17.9 focus". Two contradictory focus models sat
 * in one row:
 *
 *   cost basis   — computeRefineRouteForCity handed `useFocusEff` to
 *                  getSecondarySourcing -> buildRefiningChain, which applied it
 *                  at EVERY node and passed it down again. Five rungs got the
 *                  59 PB focus bonus for the price of one.
 *   focus column — _chainCostWithFocusAtTier / pickCheapestFocusTier apply focus
 *                  at one tier and base RRR everywhere else.
 *
 * The phantom discount is not cosmetic: it feeds the market-vs-chain gate
 * (`marketEff <= chain.costPerOutput`), so a bar priced between the two costs is
 * chain-refined when it should simply be bought. On the reported hide ladder the
 * T6 leather basis was 2,863 focused-everywhere vs 4,139 honest (+45%), so every
 * market price in ~2,900-4,100 got the wrong answer.
 *
 * The Crafting Planner has always done this correctly (buildRefiningChain(...,
 * false, ...) then _cpRefineFocusedSourcing re-prices at the winning tier); this
 * pins the Refining table to the same model.
 *
 * Black-box over the real modules: drive computeRefineRouteForCity /
 * computeRefineFocusColumn and the two shared chain helpers, parameterized over
 * market fixtures.
 *
 * Run: node tests/refining-chain-single-tier-focus.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const sandbox = `
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smugglers Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SETUP_FEE = 0.025;
const PREMIUM_TAX = 0.065;
const BASE_CITY_BONUS = 0.18;
const REFINE_SPEC_BONUS = 0.40;
const FOCUS_BONUS = 0.59;
const CITY_REFINE_SPEC = {
  "Fort Sterling": "wood", Lymhurst: "fiber", Bridgewatch: "rock",
  Thetford: "ore", Martlock: "hide",
};
const RESOURCE_DEFS = [
  { type: "hide", raw: "HIDE", refined: "LEATHER",
    tiers: [[2,"","",1],[3,"","",2],[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
];
function isBlackRedZoneEnabled() { return false; }
function isValidSourceCity(buyCity, craftCity) {
  if (!buyCity || !craftCity) return false;
  if (BLACK_ZONE_CITIES.includes(buyCity) || BLACK_ZONE_CITIES.includes(craftCity)) return false;
  return (buyCity === "Caerleon") === (craftCity === "Caerleon");
}
function isFocusEnabled() { return globalThis.__TEST_FOCUS__; }
function getOverridePrice() { return null; }
function getCityForce() { return null; }
function isInvalidCrossRoute() { return false; }
function getIQRBounds() { return { upper: Infinity }; }
function getBuyPrice(itemData, city) {
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].buy_price || 0;
}
function getSellPrice(itemData, city) {
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].sell_price || 0;
}
function calcRRR(b) { return b <= 0 ? 0 : b / (1 + b); }
function getRefineRRR(city, type, useFocus) {
  let bonus = BASE_CITY_BONUS;
  if (CITY_REFINE_SPEC[city] === type) bonus += REFINE_SPEC_BONUS;
  if (useFocus) bonus += FOCUS_BONUS;
  return calcRRR(bonus);
}
// Deterministic: 30, 60, 120, 240, 480, 960, 1920 for T2..T8.
function getFocusCost(id, t) { return Math.round(30 * Math.pow(2, t - 2)); }
function refineStationFeeSilver() { return 0; }
function getTierFromId(id) { const m = String(id).match(/^T(\\d+)/); return m ? parseInt(m[1], 10) : 4; }
function matsNeededFor10kFocus(focusCost, matsPerCraft, applyRrr = false, rrr = 0) {
  const n = Math.floor(10000 / focusCost);
  return Math.round(n * (applyRrr ? matsPerCraft * (1 - rrr) : matsPerCraft));
}
function calculateProfitPerFocus(profit, focusCost) {
  if (!focusCost || focusCost <= 0) return 0;
  return profit / focusCost;
}
const FOCUS_BAR = 10000;
function calculateTransportMargin(buyCost, sellPrice, rrr = 0, secondaryMatCost = 0,
  stationFee = 0, travelCost = 0, nonReturnableMatCost = 0, setupExemptCost = 0) {
  if (!buyCost || !sellPrice) return { profit: 0, margin: 0 };
  const effectiveCost =
    ((buyCost + secondaryMatCost - setupExemptCost) * (1 - rrr) + nonReturnableMatCost) * (1 + SETUP_FEE)
    + setupExemptCost * (1 - rrr) + stationFee + travelCost;
  const totalRevenue = sellPrice * (1 - PREMIUM_TAX);
  const profit = totalRevenue - effectiveCost;
  return { profit, margin: (profit / effectiveCost) * 100 };
}
`;

function loadFile(rel) { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); }

const mod = new Module("refining-chain-single-tier-focus-test");
mod._compile(
  sandbox +
    loadFile("js/focus-play.js") +
    loadFile("js/refining-chain-recipes.js") +
    loadFile("js/refining-chain-pricing.js") +
    loadFile("js/refining-chain-focus.js") +
    loadFile("js/refining-route.js") +
    "\nmodule.exports = { computeRefineRouteForCity, computeRefineFocusColumn," +
    " computeRefineGatheredProfit, getRefiningSourcing, _chainCostWithFocusAtTier," +
    " buildRootChainForFocus, refinesPerOutputAtTier, chainMarketLeafDemand, getRefineRRR };",
  "refining-chain-single-tier-focus.js",
);
const {
  computeRefineRouteForCity, computeRefineFocusColumn, computeRefineGatheredProfit,
  getRefiningSourcing, _chainCostWithFocusAtTier, buildRootChainForFocus,
  refinesPerOutputAtTier, chainMarketLeafDemand, getRefineRRR,
} = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const M = "Martlock"; // hide spec city — every hide refine resolves here
const CITIES_T = ["Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock",
  "Bridgewatch", "Brecilien"];

// ─── Fixtures: the reported hide ladder, prices straight off the screenshot ───
const HIDE = { T7: 3118, T6: 1327, T5: 503, T4: 45, T3: 90, T2: 30 };

// `bars` overrides the market price of a refined intermediate; absent = unlisted.
function hideMarket(bars = {}, sellT7 = 18052) {
  const md = {};
  const set = (id, buy, sell) => {
    md[id] = {};
    for (const c of CITIES_T) md[id][c] = { buy_price: buy, sell_price: sell, volume_24h: 9999 };
  };
  Object.entries(HIDE).forEach(([t, p]) => set(`${t}_HIDE`, p, p + 1));
  set("T7_LEATHER", 0, sellT7);
  [6, 5, 4, 3].forEach((t) => set(`T${t}_LEATHER`, bars[`T${t}`] || 0, bars[`T${t}`] || 0));
  set("T2_LEATHER", 20, 21);
  return md;
}

const T7_ROW = {
  mat: "Leather [T7]", rawId: "T7_HIDE", refinedId: "T7_LEATHER",
  rawRatio: 5, resourceType: "hide", secondaryMatId: "T6_LEATHER", secondaryMatCount: 1,
};

function route(routeItem, md, focusCheckbox) {
  globalThis.__TEST_FOCUS__ = focusCheckbox;
  return computeRefineRouteForCity(M, routeItem, md, "instant");
}

// Every node of a chain, root first.
function nodes(chain) {
  const out = [];
  for (let n = chain; n; ) {
    out.push(n);
    const sec = n.inputs[1];
    n = (sec && sec.sourcing.source === "chain") ? sec.sourcing.chain : null;
  }
  return out;
}

console.log("\n=== The chain cost basis never applies focus at more than one tier ===");

// The heart of the bug, isolated: `useFocus` buys the top step's refine and
// nothing below it, so a six-rung ladder can never be priced as six focus spends.
test("getRefiningSourcing focuses depth 0 only — every rung below is base RRR", () => {
  const md = hideMarket();
  const focusRrr = getRefineRRR(M, "hide", true);
  const baseRrr = getRefineRRR(M, "hide", false);
  const on = getRefiningSourcing("T6_LEATHER", md, M, true);
  const off = getRefiningSourcing("T6_LEATHER", md, M, false);
  assert.strictEqual(on.source, "chain");
  assert.strictEqual(off.source, "chain");
  const onNodes = nodes(on.chain);
  assert.ok(Math.abs(onNodes[0].rrr - focusRrr) < 1e-9, "the top step takes the focus");
  onNodes.slice(1).forEach((n) => {
    assert.ok(Math.abs(n.rrr - baseRrr) < 1e-9, `T${n.tier} must be base RRR`);
  });
  nodes(off.chain).forEach((n) => {
    assert.ok(Math.abs(n.rrr - baseRrr) < 1e-9, `T${n.tier} must be base RRR`);
  });
  // The honest, focus-nowhere basis for this ladder is ~4,139 — the old
  // focus-at-every-rung one was 2,863.
  assert.ok(off.perUnit > 4000 && off.perUnit < 4300,
    `expected the base-RRR basis ~4,139, got ${off.perUnit}`);
});

test("No node of the priced chain carries the focus RRR", () => {
  [true, false].forEach((checkbox) => {
    const r = route(T7_ROW, hideMarket(), checkbox);
    assert.ok(r && r.secondaryChain, "fixture must chain");
    const focusRrr = getRefineRRR(M, "hide", true);
    const focused = nodes(r.secondaryChain).filter((n) => Math.abs(n.rrr - focusRrr) < 1e-9);
    assert.strictEqual(focused.length, 0,
      `no chain node may be stored at focus RRR (checkbox=${checkbox})`);
  });
});

test("The row's own refine is focused iff the checkbox is on AND it owns focusTier", () => {
  [true, false].forEach((checkbox) => {
    const r = route(T7_ROW, hideMarket(), checkbox);
    const want = getRefineRRR(M, "hide", checkbox && r.focusTier === 7);
    assert.ok(Math.abs(r.rrr - want) < 1e-9,
      `checkbox=${checkbox}, focusTier=T${r.focusTier}: rrr ${r.rrr} != ${want}`);
  });
});

console.log("\n=== The market-vs-chain answer no longer moves with the checkbox ===");

// Parameterized over the disagreement band the bug created. The honest T6
// leather basis on this ladder is ~4,139; the old focused-everywhere one ~2,863.
[
  { t6: 0,    want: "chain",  why: "unlisted bar: chain by default" },
  { t6: 2500, want: "market", why: "bar beats even the old focused basis" },
  { t6: 3000, want: "market", why: "old disagreement band" },
  { t6: 3200, want: "market", why: "old disagreement band" },
  { t6: 4000, want: "market", why: "old disagreement band" },
  { t6: 4500, want: "chain",  why: "bar dearer than the honest basis" },
].forEach(({ t6, want, why }) => {
  test(`T6 leather @ ${t6 || "no listing"} -> ${want} (${why}), both toggle states`, () => {
    const md = hideMarket({ T6: t6 });
    [true, false].forEach((checkbox) => {
      const r = route(T7_ROW, md, checkbox);
      assert.ok(r, "route priced");
      const got = r.secondaryChain ? "chain" : "market";
      assert.strictEqual(got, want, `checkbox=${checkbox} gave ${got}`);
    });
  });
});

console.log("\n=== Row cost basis and Best Focus agree on the tier ===");

test("The row is priced at the tier its Best Focus column names", () => {
  globalThis.__TEST_FOCUS__ = true;
  const r = computeRefineRouteForCity(M, T7_ROW, hideMarket(), "instant", true);
  const col = computeRefineFocusColumn(r, T7_ROW);
  assert.strictEqual(col.focusBestTier, r.focusTier,
    "Best Focus tier must be the tier the route priced");
  assert.ok(col.bestFocusPlay, "a chain row always has a focus play");
});

test("The route's secondary cost equals _chainCostWithFocusAtTier at that tier", () => {
  globalThis.__TEST_FOCUS__ = true;
  const r = computeRefineRouteForCity(M, T7_ROW, hideMarket(), "instant", true);
  const expect = _chainCostWithFocusAtTier(r.secondaryChain, r.focusTier);
  assert.ok(Math.abs(r.secPrice - expect.cost) < 1e-6,
    `secondary cost ${r.secPrice} != focused-at-T${r.focusTier} cost ${expect.cost}`);
});

test("With focus OFF the secondary is the plain base-RRR chain cost", () => {
  globalThis.__TEST_FOCUS__ = false;
  const r = computeRefineRouteForCity(M, T7_ROW, hideMarket(), "instant", false);
  assert.ok(Math.abs(r.secPrice - r.secondaryChain.costPerOutput) < 1e-6,
    "focus-off must not re-price the chain at all");
});

console.log("\n=== refinesPerOutputAtTier ===");

function rootOf(routeItem, md) {
  globalThis.__TEST_FOCUS__ = true;
  const r = computeRefineRouteForCity(M, routeItem, md, "instant", true);
  const root = r.secondaryChain
    ? buildRootChainForFocus(routeItem, M, r.rawUnitCost, r.secondaryChain, r.rawUnitFee)
    : null;
  return { r, root };
}

test("1 refine per output at the top of the ladder", () => {
  const { root } = rootOf(T7_ROW, hideMarket());
  assert.strictEqual(refinesPerOutputAtTier(root, 7), 1);
});

test("Below the top it is secCount x (1-rrr) per step down, and 0 off-ladder", () => {
  const { root } = rootOf(T7_ROW, hideMarket());
  const base = getRefineRRR(M, "hide", false);
  assert.ok(Math.abs(refinesPerOutputAtTier(root, 6) - (1 - base)) < 1e-9);
  assert.ok(Math.abs(refinesPerOutputAtTier(root, 5) - Math.pow(1 - base, 2)) < 1e-9);
  assert.strictEqual(refinesPerOutputAtTier(root, 8), 0, "T8 is not on this ladder");
  assert.strictEqual(refinesPerOutputAtTier(null, 7), 0);
});

console.log("\n=== chainMarketLeafDemand: the shopping list matches the route ===");

test("Lists only ids the route actually BUYS — never a chain-produced bar", () => {
  const { r, root } = rootOf(T7_ROW, hideMarket());
  const demand = chainMarketLeafDemand(root, 100, r.focusTier);
  const produced = new Set(nodes(root).map((n) => n.produces));
  for (const id of demand.keys()) {
    assert.ok(!produced.has(id), `${id} is refined by the chain, not bought`);
  }
  assert.ok(demand.has("T7_HIDE"), "the row's own raw is a buy");
  // Every rung's raw is a buy, all the way down to the bottom of the ladder.
  [6, 5, 4, 3, 2].forEach((t) => assert.ok(demand.has(`T${t}_HIDE`), `T${t} hide is a buy`));
});

test("A market-sourced secondary IS listed (it is a buy)", () => {
  const { r, root } = rootOf(T7_ROW, hideMarket({ T6: 3200 }));
  assert.strictEqual(r.secondaryChain, null, "fixture buys the T6 bar");
  assert.strictEqual(root, null, "no ladder to walk when the secondary is bought");
});

test("Demand scales linearly with outputs", () => {
  const { r, root } = rootOf(T7_ROW, hideMarket());
  const a = chainMarketLeafDemand(root, 100, r.focusTier);
  const b = chainMarketLeafDemand(root, 200, r.focusTier);
  for (const [id, v] of a) {
    assert.ok(Math.abs(b.get(id) - v * 2) < 1e-6, `${id} did not scale`);
  }
});

test("Focusing a tier lowers consumption at and below it", () => {
  const { root } = rootOf(T7_ROW, hideMarket());
  const noFocus = chainMarketLeafDemand(root, 100, -1);
  const atTop = chainMarketLeafDemand(root, 100, 7);
  assert.ok(atTop.get("T7_HIDE") < noFocus.get("T7_HIDE"),
    "focusing the top refine returns more T7 hide");
  assert.ok(atTop.get("T2_HIDE") < noFocus.get("T2_HIDE"),
    "and propagates down the ladder");
});

test("Null chain / zero outputs give an empty map, never a throw", () => {
  assert.strictEqual(chainMarketLeafDemand(null, 100, 7).size, 0);
  const { root } = rootOf(T7_ROW, hideMarket());
  assert.strictEqual(chainMarketLeafDemand(root, 0, 7).size, 0);
});

console.log("\n=== Gathered profit rides the same one-tier model ===");

test("computeRefineGatheredProfit is invariant to the checkbox for a force-focus route", () => {
  const md = hideMarket();
  globalThis.__TEST_FOCUS__ = true;
  const on = computeRefineRouteForCity(M, T7_ROW, md, "instant", true);
  globalThis.__TEST_FOCUS__ = false;
  const off = computeRefineRouteForCity(M, T7_ROW, md, "instant", true);
  const a = computeRefineGatheredProfit(on, T7_ROW);
  const b = computeRefineGatheredProfit(off, T7_ROW);
  assert.ok(a != null && b != null);
  assert.ok(Math.abs(a - b) < 1e-6, `force-focus gathered profit must not move (${a} vs ${b})`);
});

console.log("\n=== Edge cases ===");

test("A T2 row (no secondary) still values and names its own tier", () => {
  const T2_ROW = {
    mat: "Leather [T2]", rawId: "T2_HIDE", refinedId: "T2_LEATHER",
    rawRatio: 1, resourceType: "hide", secondaryMatId: null, secondaryMatCount: 0,
  };
  globalThis.__TEST_FOCUS__ = true;
  const md = hideMarket();
  md.T2_LEATHER = {};
  CITIES_T.forEach((c) => { md.T2_LEATHER[c] = { buy_price: 20, sell_price: 900, volume_24h: 9999 }; });
  const r = computeRefineRouteForCity(M, T2_ROW, md, "instant", true);
  assert.ok(r, "T2 route prices");
  assert.ok(!r.secondaryChain);
  const col = computeRefineFocusColumn(r, T2_ROW);
  assert.strictEqual(col.focusBestTier, 2);
});

test("An enchanted-rock style row (outputPerRefine) keeps the single-tier path", () => {
  const ROCK_ROW = {
    mat: "Leather [T7] alt", rawId: "T7_HIDE", refinedId: "T7_LEATHER",
    rawRatio: 5, resourceType: "hide", secondaryMatId: "T6_LEATHER",
    secondaryMatCount: 1, outputPerRefine: 2,
  };
  globalThis.__TEST_FOCUS__ = true;
  const r = computeRefineRouteForCity(M, ROCK_ROW, hideMarket(), "instant", true);
  const col = computeRefineFocusColumn(r, ROCK_ROW);
  assert.strictEqual(col.focusBestTier, 7, "outputPerRefine rows never use the ladder picker");
});

test("An unpriced secondary with no chain leaves the row unvalued, not free", () => {
  const md = hideMarket();
  // Strip every hide below T7 so no chain can be built and no bar is listed.
  [6, 5, 4, 3, 2].forEach((t) => { md[`T${t}_HIDE`] = {}; });
  md.T2_LEATHER = {};
  globalThis.__TEST_FOCUS__ = true;
  const r = computeRefineRouteForCity(M, T7_ROW, md, "instant", true);
  if (r) {
    assert.ok(!r.secondaryChain, "no chain is possible");
    assert.strictEqual(r.secPrice, 0, "secondary is unpriced, never free-and-valued");
  }
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
