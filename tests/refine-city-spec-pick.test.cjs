/**
 * Test: a refining chain refines in the RESOURCE's specialization city, not
 * wherever the caller happens to stand.
 *
 * The +40% local production bonus belongs to the refining station, and a
 * refining station exists in every city — so refining ore is worth 58 PB in
 * Thetford no matter which city the bar is later crafted in. The Crafting
 * Planner hands buildRefiningChain its CRAFT city (Martlock for an axe), which
 * used to price every self-refine at the base 18 PB.
 *
 * Black box: only the chain node's refineCity / rrr / costPerOutput and the
 * market-vs-chain winner are asserted. No live market, no database.
 *
 * Run: node tests/refine-city-spec-pick.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const sandbox = `
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const SETUP_FEE = 0.025;
const BASE_CITY_BONUS = 0.18;
const REFINE_SPEC_BONUS = 0.40;
const FOCUS_BONUS = 0.59;
const CITY_REFINE_SPEC = {
  "Fort Sterling": "wood",
  Lymhurst: "fiber",
  Bridgewatch: "rock",
  Thetford: "ore",
  Martlock: "hide",
};
const RESOURCE_DEFS = [
  { type: "wood",  raw: "WOOD",  refined: "PLANKS",
    tiers: [[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
  { type: "ore",   raw: "ORE",   refined: "METALBAR",
    tiers: [[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
  { type: "hide",  raw: "HIDE",  refined: "LEATHER",
    tiers: [[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
  { type: "fiber", raw: "FIBER", refined: "CLOTH",
    tiers: [[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
  { type: "rock",  raw: "ROCK",  refined: "STONEBLOCK",
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
function getOverridePrice(itemId, city) { return testOverrides[itemId + ":" + city] ?? null; }
function getCityForce(itemId, side) { return testCityForce[itemId]?.[side] ?? null; }
function getIQRBounds() { return { upper: Infinity }; }
function getBuyPrice(itemData, city, bounds, itemId) {
  const ov = itemId ? getOverridePrice(itemId, city) : null;
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].buy_price || 0;
}
function calcRRR(b) { return b <= 0 ? 0 : b / (1 + b); }
function getRefineRRR(city, resourceType, useFocus) {
  let bonus = BASE_CITY_BONUS;
  if (CITY_REFINE_SPEC[city] === resourceType) bonus += REFINE_SPEC_BONUS;
  if (useFocus) bonus += FOCUS_BONUS;
  return calcRRR(bonus);
}
function getFocusCost(itemId, tier) { return Math.round(30 * Math.pow(2, tier - 4)); }
function refineStationFeeSilver() { return 0; }
function __setBMR(v) { testBmrEnabled = !!v; }
function __setForce(map) { testCityForce = map || {}; }
function __reset() { __setBMR(false); __setForce({}); testOverrides = {}; }
`;

function loadFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const mod = new Module("refine-city-spec-pick-test");
mod._compile(
  sandbox + loadFile("js/refining-chain-recipes.js") + loadFile("js/refining-chain-pricing.js") +
    "\nmodule.exports = { buildRefiningChain, getRefiningSourcing, getRefineCityFor, __setBMR, __setForce, __reset };",
  "refining-chain-pricing.js",
);
const { buildRefiningChain, getRefiningSourcing, getRefineCityFor, __setBMR, __setForce, __reset } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { __reset(); fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

function priceMap(entries) {
  const out = {};
  for (const e of entries) {
    if (!out[e.id]) out[e.id] = {};
    out[e.id][e.city] = { buy_price: e.buy, sell_price: (e.buy || 0) + 1, volume_24h: 9999 };
  }
  return out;
}

// Every city carries the same ore prices, so nothing but the refine city can
// move the chain's cost.
function oreMarketEverywhere(overrides) {
  const prices = Object.assign(
    { T5_METALBAR: 4000, T5_ORE: 200, T4_METALBAR: 300, T4_ORE: 90, T3_METALBAR: 999999 },
    overrides || {},
  );
  const entries = [];
  for (const city of ["Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch"]) {
    for (const id of Object.keys(prices)) entries.push({ id, city, buy: prices[id] });
  }
  return priceMap(entries);
}

const SPEC_RRR_ORE = 0.58 / 1.58;   // Thetford, no focus
const BASE_RRR = 0.18 / 1.18;       // any non-spec city, no focus

// ── getRefineCityFor ──────────────────────────────────────────────────────
console.log("\n=== getRefineCityFor ===");

const CITY_CASES = [
  { resourceType: "ore",   anchor: "Martlock",      expect: "Thetford" },
  { resourceType: "wood",  anchor: "Martlock",      expect: "Fort Sterling" },
  { resourceType: "hide",  anchor: "Martlock",      expect: "Martlock" },
  { resourceType: "fiber", anchor: "Brecilien",     expect: "Lymhurst" },
  { resourceType: "rock",  anchor: "Fort Sterling", expect: "Bridgewatch" },
];
for (const c of CITY_CASES) {
  test(`${c.resourceType} anchored at ${c.anchor} refines in ${c.expect}`, () => {
    assert.strictEqual(getRefineCityFor(c.resourceType, c.anchor), c.expect);
  });
}

test("a resource with no spec city falls back to the anchor", () => {
  assert.strictEqual(getRefineCityFor("gem", "Martlock"), "Martlock");
});

test("a missing resource type falls back to the anchor", () => {
  assert.strictEqual(getRefineCityFor(null, "Martlock"), "Martlock");
});

test("Caerleon anchor with Black/Red routes OFF cannot reach a royal spec city", () => {
  assert.strictEqual(getRefineCityFor("ore", "Caerleon"), "Caerleon");
});

test("Caerleon anchor with Black/Red routes ON reaches the royal spec city", () => {
  __setBMR(true);
  assert.strictEqual(getRefineCityFor("ore", "Caerleon"), "Thetford");
});

// ── buildRefiningChain ────────────────────────────────────────────────────
console.log("\n=== chain nodes carry the spec city ===");

test("a bar chain anchored at the craft city still refines in the spec city", () => {
  const chain = buildRefiningChain("T5_METALBAR", oreMarketEverywhere(), "Martlock", false, 0);
  assert.strictEqual(chain.refineCity, "Thetford");
  assert.ok(Math.abs(chain.rrr - SPEC_RRR_ORE) < 1e-9, `rrr ${chain.rrr}`);
});

test("the station label names the city the refine happens in", () => {
  const chain = buildRefiningChain("T5_METALBAR", oreMarketEverywhere(), "Martlock", false, 0);
  assert.strictEqual(chain.station, "Refine ore at Thetford");
});

test("anchoring at the spec city changes nothing (regression guard)", () => {
  const md = oreMarketEverywhere();
  const atCraft = buildRefiningChain("T5_METALBAR", md, "Martlock", false, 0);
  const atSpec = buildRefiningChain("T5_METALBAR", md, "Thetford", false, 0);
  assert.strictEqual(atCraft.refineCity, atSpec.refineCity);
  assert.strictEqual(atCraft.costPerOutput, atSpec.costPerOutput);
});

test("every tier of a multi-tier chain refines in the same spec city", () => {
  // T4 bars priced out of the market so the T5 chain refines its own secondary.
  const md = oreMarketEverywhere({ T4_METALBAR: 999999, T4_ORE: 5 });
  const chain = buildRefiningChain("T5_METALBAR", md, "Martlock", false, 0);
  const sec = chain.inputs[1].sourcing;
  assert.strictEqual(sec.source, "chain", "T4 secondary should be self-refined here");
  assert.strictEqual(chain.refineCity, "Thetford");
  assert.strictEqual(sec.chain.refineCity, "Thetford");
});

test("hide refined for a Martlock craft is already in its spec city", () => {
  const md = priceMap([
    { id: "T5_LEATHER", city: "Martlock", buy: 4000 },
    { id: "T5_HIDE",    city: "Martlock", buy: 200 },
    { id: "T4_LEATHER", city: "Martlock", buy: 300 },
  ]);
  const chain = buildRefiningChain("T5_LEATHER", md, "Martlock", false, 0);
  assert.strictEqual(chain.refineCity, "Martlock");
});

test("Caerleon anchor with routes OFF keeps the whole chain in Caerleon", () => {
  const chain = buildRefiningChain("T5_METALBAR", oreMarketEverywhere(), "Caerleon", false, 0);
  assert.strictEqual(chain.refineCity, "Caerleon");
  assert.ok(Math.abs(chain.rrr - BASE_RRR) < 1e-9, `rrr ${chain.rrr}`);
});

test("Caerleon anchor with routes ON refines in the royal spec city", () => {
  __setBMR(true);
  const chain = buildRefiningChain("T5_METALBAR", oreMarketEverywhere(), "Caerleon", false, 0);
  assert.strictEqual(chain.refineCity, "Thetford");
});

console.log("\n=== the spec city makes the refine cheaper ===");

test("a chain refined in the spec city costs less than the same chain at base RRR", () => {
  const chain = buildRefiningChain("T5_METALBAR", oreMarketEverywhere(), "Martlock", false, 0);
  const inputs = 200 * 3 + 300; // T5 recipe: 3 raw + 1 lower-tier bar
  assert.ok(Math.abs(chain.costPerOutput - inputs * (1 - SPEC_RRR_ORE) * 1.025) < 1e-6,
    `costPerOutput ${chain.costPerOutput}`);
  assert.ok(chain.costPerOutput < inputs * (1 - BASE_RRR) * 1.025,
    "the spec city must be strictly cheaper than base RRR");
});

test("a self-refine the craft city would have lost now beats buying the bar", () => {
  // Priced so the chain wins ONLY at the spec return rate:
  //   inputs = 3×260 + 400 = 1180
  //   base RRR -> 1180 × 0.8475 × 1.025 ≈ 1025
  //   spec RRR -> 1180 × 0.6329 × 1.025 ≈  765
  // A 900 bar therefore beats the base-RRR refine and loses to the spec one.
  const md = oreMarketEverywhere({ T5_METALBAR: 900, T5_ORE: 260, T4_METALBAR: 400 });
  const r = getRefiningSourcing("T5_METALBAR", md, "Martlock", false, 0);
  assert.strictEqual(r.source, "chain");
  assert.ok(r.perUnit < 900, `chain perUnit ${r.perUnit} should undercut the 900 bar`);
});

test("the bar still wins when even the spec refine is dearer", () => {
  const md = oreMarketEverywhere({ T5_METALBAR: 600, T5_ORE: 260, T4_METALBAR: 400 });
  const r = getRefiningSourcing("T5_METALBAR", md, "Martlock", false, 0);
  assert.strictEqual(r.source, "market");
  assert.strictEqual(r.perUnit, 600);
});

console.log("\n=== buy-side sourcing is unaffected ===");

test("a forced raw buy city is still honored when the refine city moves", () => {
  const md = oreMarketEverywhere();
  md.T5_ORE.Lymhurst = { buy_price: 50, sell_price: 51, volume_24h: 9999 };
  __setForce({ T5_ORE: { buy: "Lymhurst" } });
  const chain = buildRefiningChain("T5_METALBAR", md, "Martlock", false, 0);
  assert.strictEqual(chain.refineCity, "Thetford");
  assert.strictEqual(chain.inputs[0].sourcing.city, "Lymhurst");
  assert.strictEqual(chain.inputs[0].sourcing.perUnit, 50);
});

test("with routes OFF a Caerleon-anchored chain buys only in Caerleon", () => {
  const md = oreMarketEverywhere();
  md.T5_ORE.Lymhurst = { buy_price: 1, sell_price: 2, volume_24h: 9999 };
  const chain = buildRefiningChain("T5_METALBAR", md, "Caerleon", false, 0);
  assert.strictEqual(chain.inputs[0].sourcing.city, "Caerleon");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
