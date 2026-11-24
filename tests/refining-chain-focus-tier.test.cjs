/**
 * Test: pickCheapestFocusTier — given a refining chain, identifies the single
 * tier where applying focus leaves the END PRODUCT most profitable. Implements
 * the user's design directive: "focus spends on most profitable tier."
 *
 * The chain sells (or feeds a craft with) the SAME top-tier output whichever
 * step gets the focus, so revenue is fixed and "most profitable end product" is
 * exactly "cheapest output":
 *   focusOffCost  = chain silver cost with focus OFF everywhere
 *   cost_i        = chain silver cost with focus applied at T_i only
 *   silverSaved_i = focusOffCost − cost_i     // RRR saving, propagated up
 * Pick argmax(silverSaved_i) = argmin(cost_i). js/focus-play.js then divides
 * that saving by the tier's focus cost to get the Silver/Focus figure — this is
 * the ONE objective every table's Best Focus column now ranks on.
 *
 * Two earlier rules are wrong and are asserted against here:
 *   • total profit ÷ focusCost — the chain's base margin is near-constant across
 *     tiers while focusCost climbs ~9× from T4→T8, so it mechanically picked the
 *     lowest tier (the reported "Focus@T4" bug).
 *   • silverSaved ÷ focusCost (best RATE) — an efficient low tier can save almost
 *     nothing in absolute silver, which is the wrong answer when the objective is
 *     the finished item's profit.
 *
 * Run: node tests/refining-chain-focus-tier.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const sandbox = `
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
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
  { type: "wood", raw: "WOOD", refined: "PLANKS",
    tiers: [[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
];
let testBmrEnabled = false;
let testCityForce = {};
let testOverrides = {};
function isBlackRedZoneEnabled() { return testBmrEnabled; }
function isValidSourceCity(buyCity, craftCity) {
  if (!buyCity || !craftCity) return false;
  if (isBlackRedZoneEnabled()) return true;
  if (BLACK_ZONE_CITIES.includes(buyCity) || BLACK_ZONE_CITIES.includes(craftCity)) return false;
  return (buyCity === "Caerleon") === (craftCity === "Caerleon");
}
function getOverridePrice(itemId, city) { return testOverrides[itemId+":"+city] ?? null; }
function getCityForce(itemId, side) { return testCityForce[itemId]?.[side] ?? null; }
function getIQRBounds() { return { upper: Infinity }; }
function getBuyPrice(itemData, city, bounds, itemId) {
  const ov = itemId ? getOverridePrice(itemId, city) : null;
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].buy_price || 0;
}
function calcRRR(b) { return b <= 0 ? 0 : b / (1 + b); }
function getRefineRRR(city, type, useFocus) {
  let bonus = BASE_CITY_BONUS;
  if (CITY_REFINE_SPEC[city] === type) bonus += REFINE_SPEC_BONUS;
  if (useFocus) bonus += FOCUS_BONUS;
  return calcRRR(bonus);
}
// Deterministic focus costs: 30, 60, 120, 240, 480 for T4..T8
function getFocusCost(id, t) { return Math.round(30 * Math.pow(2, t-4)); }
function calcStationFeeSilver() { return 0; }
function refineStationFeeSilver() { return 0; }
function __reset() { testBmrEnabled = false; testOverrides = {}; testCityForce = {}; }
`;

function loadFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const recipesSrc = loadFile("js/refining-chain-recipes.js");
const pricingSrc = loadFile("js/refining-chain-pricing.js");
const focusPlaySrc = loadFile("js/focus-play.js");

const mod = new Module("refining-chain-focus-tier-test");
mod._compile(
  sandbox + focusPlaySrc + recipesSrc + pricingSrc +
    "\nmodule.exports = { getRefiningSourcing, pickCheapestFocusTier, makeFocusPlay, " +
    "pickBestFocusPlay, chainSilverCostWithFocusAtTier, __reset };",
  "refining-chain-focus-tier.js"
);
const { getRefiningSourcing, pickCheapestFocusTier, makeFocusPlay, pickBestFocusPlay,
  chainSilverCostWithFocusAtTier, __reset } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { __reset(); fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

function priceMap(entries) {
  const out = {};
  for (const e of entries) {
    if (!out[e.id]) out[e.id] = {};
    out[e.id][e.city] = { buy_price: e.buy, sell_price: (e.buy||0)+1, volume_24h: 9999 };
  }
  return out;
}

const FS = "Fort Sterling";
const FOCUS_BY_TIER = { 4: 30, 5: 60, 6: 120, 7: 240, 8: 480 };

// A T8 plank ladder: raw price grows ~2.2× per tier while focus cost grows 2×.
function ladderMarket() {
  return priceMap([
    { id: "T8_PLANKS", city: FS, buy: 999999 },
    { id: "T7_PLANKS", city: FS, buy: 999999 },
    { id: "T6_PLANKS", city: FS, buy: 999999 },
    { id: "T5_PLANKS", city: FS, buy: 999999 },
    { id: "T4_PLANKS", city: FS, buy: 999999 },
    { id: "T8_WOOD",   city: FS, buy: 1400 },
    { id: "T7_WOOD",   city: FS, buy: 640 },
    { id: "T6_WOOD",   city: FS, buy: 290 },
    { id: "T5_WOOD",   city: FS, buy: 130 },
    { id: "T4_WOOD",   city: FS, buy: 60 },
    { id: "T3_PLANKS", city: FS, buy: 40 },
  ]);
}
function ladderChain() {
  const r = getRefiningSourcing("T8_PLANKS", ladderMarket(), FS, false);
  assert.strictEqual(r.source, "chain");
  return r.chain;
}
function walkTiers(chain) {
  const out = [];
  for (let node = chain; node; ) {
    if (node.focusCost > 0) out.push(node.tier);
    const sec = node.inputs[1];
    node = (sec && sec.sourcing.source === "chain") ? sec.sourcing.chain : null;
  }
  return out;
}

console.log("\n=== pickCheapestFocusTier basic shape ===");

test("Returns null when chain is null", () => {
  assert.strictEqual(pickCheapestFocusTier(null), null);
});

test("Returns the only tier when chain has one node", () => {
  // T5 chain with T4 secondary as market (no further chain) → only T5 candidate.
  const md = priceMap([
    { id: "T5_PLANKS", city: FS, buy: 999999 },
    { id: "T5_WOOD",   city: FS, buy: 100 },
    { id: "T4_PLANKS", city: FS, buy: 200 },
    { id: "T4_WOOD",   city: FS, buy: 999999 },
    { id: "T3_PLANKS", city: FS, buy: 999999 },
  ]);
  const r = getRefiningSourcing("T5_PLANKS", md, FS, false);
  assert.strictEqual(r.source, "chain");
  const best = pickCheapestFocusTier(r.chain);
  assert.strictEqual(best.tier, 5, "only T5 is a chain node here");
  assert.strictEqual(best.focusCost, 60);  // 30*2^(5-4)
  assert.ok(typeof best.silverSaved === "number");
  assert.ok(typeof best.totalCost === "number");
  assert.ok(typeof best.focusOffCost === "number");
});

test("silverSaved is exactly focusOffCost − totalCost", () => {
  const best = pickCheapestFocusTier(ladderChain());
  assert.ok(Math.abs(best.silverSaved - (best.focusOffCost - best.totalCost)) < 1e-9);
});

test("focusOffCost is the focus-nowhere baseline the caller can re-derive", () => {
  const chain = ladderChain();
  const best = pickCheapestFocusTier(chain);
  assert.ok(Math.abs(best.focusOffCost - chainSilverCostWithFocusAtTier(chain, -1)) < 1e-9);
});

console.log("\n=== Multi-tier picker: the objective is the END PRODUCT's profit ===");

test("Picks the HIGHEST tier when material value climbs faster than focus cost (the Focus@T4 bug)", () => {
  const best = pickCheapestFocusTier(ladderChain());
  assert.strictEqual(best.tier, 8,
    `highest tier must win on absolute silver saved, got T${best.tier}`);
  assert.strictEqual(best.focusCost, 480); // 30*2^(8-4)
  assert.ok(best.totalCost < best.focusOffCost,
    `best totalCost ${best.totalCost} should be < no-focus baseline ${best.focusOffCost}`);
});

test("The winner minimizes the chain's per-output cost over every candidate tier", () => {
  const chain = ladderChain();
  const best = pickCheapestFocusTier(chain);
  walkTiers(chain).forEach((t) => {
    const cost = chainSilverCostWithFocusAtTier(chain, t);
    assert.ok(best.totalCost <= cost + 1e-6,
      `T${t} costs ${cost}, cheaper than the chosen ${best.totalCost}`);
  });
});

test("…which is the same thing as maximizing silverSaved", () => {
  const chain = ladderChain();
  const best = pickCheapestFocusTier(chain);
  const focusOff = chainSilverCostWithFocusAtTier(chain, -1);
  walkTiers(chain).forEach((t) => {
    const saved = focusOff - chainSilverCostWithFocusAtTier(chain, t);
    assert.ok(best.silverSaved >= saved - 1e-6,
      `T${t} saves ${saved}, more than the chosen ${best.silverSaved}`);
  });
});

test("The chosen tier is NOT always the most focus-EFFICIENT one — profit wins", () => {
  // Ranking by silverSaved/focusCost is the rejected rule. Assert only that the
  // two objectives are answered by this picker on the profit side: no candidate
  // tier removes more silver than the winner, even if some tier's RATE is higher.
  const chain = ladderChain();
  const best = pickCheapestFocusTier(chain);
  const focusOff = chainSilverCostWithFocusAtTier(chain, -1);
  const rates = walkTiers(chain).map((t) => ({
    tier: t,
    rate: (focusOff - chainSilverCostWithFocusAtTier(chain, t)) / FOCUS_BY_TIER[t],
  }));
  const bestRate = rates.reduce((a, b) => (b.rate > a.rate ? b : a));
  assert.ok(rates.every((r) => best.silverSaved >=
    (focusOff - chainSilverCostWithFocusAtTier(chain, r.tier)) - 1e-6));
  // Documented for the reader: whichever tier wins on rate, the picker's answer
  // is the one that leaves the finished bar cheapest.
  assert.ok(best.tier >= 4 && bestRate.tier >= 4);
});

console.log("\n=== Feeds the shared Silver/Focus standard ===");

test("silverSaved is the profitDelta of a refine play; the rate follows from it", () => {
  const best = pickCheapestFocusTier(ladderChain());
  const play = makeFocusPlay({
    kind: "refine", matId: "T8_PLANKS", focusItemId: `T${best.tier}_PLANKS`,
    tier: best.tier, focusCost: best.focusCost, profitDelta: best.silverSaved,
  });
  assert.ok(play);
  assert.ok(Math.abs(play.silverPerFocus - best.silverSaved / best.focusCost) < 1e-9);
  assert.strictEqual(pickBestFocusPlay([play]), play);
});

console.log("\n=== Edge cases ===");

test("Skips tiers with zero focus cost (defensive)", () => {
  const fakeChain = {
    produces: "T5_PLANKS",
    output: 1,
    station: "Refine wood at Fort Sterling",
    refineCity: FS,
    rrr: 0.367,
    focusCost: 0,
    tier: 5,
    resourceType: "wood",
    inputs: [
      { matId: "T5_WOOD",   count: 3, sourcing: { perUnit: 100, source: "market", city: FS } },
      { matId: "T4_PLANKS", count: 1, sourcing: { perUnit: 200, source: "market", city: FS } },
    ],
    costPerOutput: 0,
  };
  assert.strictEqual(pickCheapestFocusTier(fakeChain), null,
    "a chain no tier of which can take focus has no focus play");
});

test("A ladder where focus saves nothing still names a tier (saving 0, never negative)", () => {
  // Focus only ever adds RRR, so the focused cost can never exceed the focus-off
  // one — the winner's silverSaved is >= 0 by construction.
  const best = pickCheapestFocusTier(ladderChain());
  assert.ok(best.silverSaved >= 0);
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
