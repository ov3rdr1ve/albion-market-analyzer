/**
 * Test: the cheapest way to OBTAIN one artifact fragment (js/fragment-transmute-sourcing.js).
 *
 * A Rune / Soul / Relic / Avalonian Shard does not have to be bought as itself.
 * The Artifact Foundry (and any crafting station) transmutes them:
 *   - type-up, 1:1, same tier, silver fee:  Rune → Soul → Relic → Avalonian Shard
 *   - tier-up, 5:1, same family, free:      5× T5 Relic → 1× T6 Relic
 * Fees come from the real tables in js/data-transmute.js. A market buy pays the
 * buy-order setup fee; transmute silver and its station fee do not.
 *
 * getFragmentSourcing(fragmentId, marketData, cities) must return the cheapest
 * all-in route over the (tier × family) grid, or null when nothing is priced.
 *
 * Black-box over synthetic prices: real data-transmute.js + the module under
 * test, browser globals stubbed. No live API or DB.
 *
 * Run: node tests/fragment-transmute-sourcing.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const sandbox = `
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
let SETUP_FEE = 0.025;
let testCityForce = {}, testOverrides = {}, testStationRate = 0, testDiscount = 1;
function getOverridePrice(itemId, city) { return testOverrides[itemId + ":" + city] ?? null; }
function getCityForce(itemId, side) { return testCityForce[itemId]?.[side] ?? null; }
function getIQRBounds() { return { upper: Infinity }; }
function getBuyPrice(itemData, city, bounds, itemId) {
  const ov = itemId ? getOverridePrice(itemId, city) : null;
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].buy_price || 0;
}
function applyGlobalDiscount(silver) { return silver * testDiscount; }
function getStationFeeInput() { return testStationRate; }
function calcStationFeeSilver(tier, mats, nutritionOverride = null) {
  const nutrition = nutritionOverride != null ? nutritionOverride : mats * 14 * Math.pow(2, tier - 4) * 0.1125;
  return applyGlobalDiscount((getStationFeeInput() / 100) * nutrition);
}
function resourceShortName(id) { return id; }
function __setSetupFee(v) { SETUP_FEE = v; }
function __setOverrides(m) { testOverrides = m || {}; }
function __setForce(m) { testCityForce = m || {}; }
function __setStationRate(r) { testStationRate = r || 0; }
function __setDiscount(d) { testDiscount = d == null ? 1 : d; }
function __reset() { __setSetupFee(0.025); __setOverrides({}); __setForce({}); __setStationRate(0); __setDiscount(1); }
`;

const load = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

const mod = new Module("fragment-transmute-sourcing");
mod._compile(
  sandbox +
    load("js/data-transmute.js") +
    load("js/fragment-transmute-sourcing.js") +
    "\nmodule.exports = { CITIES, getFragmentSourcing, parseFragmentId, TRANSMUTE_SILVER_COST," +
    " TRANSMUTE_NUTRITION_PER_SILVER, __setSetupFee, __setOverrides, __setForce," +
    " __setStationRate, __setDiscount, __reset };",
  "fragment-transmute-sourcing.js",
);
const X = mod.exports;
const FEE = X.TRANSMUTE_SILVER_COST;
const CITIES = X.CITIES;

let passed = 0, failed = 0;
function test(name, fn) {
  try { X.__reset(); fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const CITY = "Martlock";
function priceMap(entries) {
  const out = {};
  for (const e of entries) { (out[e.id] ||= {})[e.city || CITY] = { buy_price: e.buy, volume_24h: 9999 }; }
  return out;
}
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: expected ${b}, got ${a}`);

// ── parseFragmentId ──────────────────────────────────────────────────────────
console.log("\n=== parseFragmentId ===");

[
  ["T4_RUNE", { tier: 4, family: "RUNE", index: 0 }],
  ["T6_SOUL", { tier: 6, family: "SOUL", index: 1 }],
  ["T8_RELIC", { tier: 8, family: "RELIC", index: 2 }],
  ["T5_SHARD_AVALONIAN", { tier: 5, family: "SHARD_AVALONIAN", index: 3 }],
].forEach(([id, want]) => {
  test(`parses ${id}`, () => {
    const got = X.parseFragmentId(id);
    assert.deepStrictEqual({ tier: got.tier, family: got.family, index: got.index }, want);
  });
});

["T6_WOOD", "T6_ARTEFACT_2H_CURSEDSTAFF_MORGANA", "T3_RUNE", "T6_SHARD_CRYSTAL", "", null, "T6_RELIC@1"]
  .forEach((id) => {
    test(`rejects ${JSON.stringify(id)}`, () => {
      assert.strictEqual(X.parseFragmentId(id), null);
    });
  });

// ── Route choice (parameterized) ─────────────────────────────────────────────
console.log("\n=== Cheapest route ===");

const S = 1.025;
const ROUTE_CASES = [
  {
    name: "market wins when the relic is cheap",
    target: "T6_RELIC",
    prices: [{ id: "T6_RELIC", buy: 20_000 }, { id: "T6_SOUL", buy: 15_000 }],
    want: { source: "market", buyId: "T6_RELIC", buyCount: 1, steps: 0,
      perUnit: 20_000 * S, marketPerUnit: 20_000, feePerUnit: 0 },
  },
  {
    name: "Soul → Relic wins when the relic is dear",
    target: "T6_RELIC",
    prices: [{ id: "T6_RELIC", buy: 40_000 }, { id: "T6_SOUL", buy: 10_000 }],
    want: { source: "transmute", buyId: "T6_SOUL", buyCount: 1, steps: 1,
      perUnit: 10_000 * S + FEE.SOUL_RELIC[6], marketPerUnit: 10_000, feePerUnit: FEE.SOUL_RELIC[6] },
  },
  {
    name: "Rune → Soul → Relic, two type-up steps",
    target: "T6_RELIC",
    prices: [{ id: "T6_RELIC", buy: 60_000 }, { id: "T6_SOUL", buy: 50_000 }, { id: "T6_RUNE", buy: 1_000 }],
    want: { source: "transmute", buyId: "T6_RUNE", buyCount: 1, steps: 2,
      perUnit: 1_000 * S + FEE.RUNE_SOUL[6] + FEE.SOUL_RELIC[6],
      marketPerUnit: 1_000, feePerUnit: FEE.RUNE_SOUL[6] + FEE.SOUL_RELIC[6] },
  },
  {
    name: "5× T5 Relic tier-up is free of silver",
    target: "T6_RELIC",
    prices: [{ id: "T6_RELIC", buy: 60_000 }, { id: "T5_RELIC", buy: 2_000 }],
    want: { source: "transmute", buyId: "T5_RELIC", buyCount: 5, steps: 1,
      perUnit: 5 * 2_000 * S, marketPerUnit: 10_000, feePerUnit: 0 },
  },
  {
    name: "two tier-ups multiply the count (25× T5 → T7)",
    target: "T7_RELIC",
    prices: [{ id: "T7_RELIC", buy: 99_999_999 }, { id: "T5_RELIC", buy: 100 }],
    want: { source: "transmute", buyId: "T5_RELIC", buyCount: 25, steps: 2,
      perUnit: 25 * 100 * S, marketPerUnit: 2_500, feePerUnit: 0 },
  },
  {
    // Two orders reach T6 Relic from T5 Soul. Type-up first pays 5× the T5 fee;
    // tier-up first pays the T6 fee once, and fees only DOUBLE per tier — so the
    // tier-up must come first.
    name: "mixed: 5× T5 Soul → T6 Soul, then → T6 Relic (tier-up first is cheaper)",
    target: "T6_RELIC",
    prices: [{ id: "T6_RELIC", buy: 99_999 }, { id: "T5_SOUL", buy: 100 }],
    want: { source: "transmute", buyId: "T5_SOUL", buyCount: 5, steps: 2,
      perUnit: 500 * S + FEE.SOUL_RELIC[6], marketPerUnit: 500, feePerUnit: FEE.SOUL_RELIC[6] },
  },
  {
    name: "an Avalonian Shard is reachable from a Relic",
    target: "T5_SHARD_AVALONIAN",
    prices: [{ id: "T5_SHARD_AVALONIAN", buy: 50_000 }, { id: "T5_RELIC", buy: 1_000 }],
    want: { source: "transmute", buyId: "T5_RELIC", buyCount: 1, steps: 1,
      perUnit: 1_000 * S + FEE.RELIC_SHARD_AVALONIAN[5], marketPerUnit: 1_000,
      feePerUnit: FEE.RELIC_SHARD_AVALONIAN[5] },
  },
  {
    name: "a Rune has no type-up predecessor — only tier-ups",
    target: "T5_RUNE",
    prices: [{ id: "T5_RUNE", buy: 9_000 }, { id: "T5_SOUL", buy: 1 }, { id: "T4_RUNE", buy: 100 }],
    want: { source: "transmute", buyId: "T4_RUNE", buyCount: 5, steps: 1,
      perUnit: 500 * S, marketPerUnit: 500, feePerUnit: 0 },
  },
  {
    name: "a T4 fragment never looks below T4",
    target: "T4_RELIC",
    prices: [{ id: "T4_RELIC", buy: 1_000 }, { id: "T3_RELIC", buy: 1 }],
    want: { source: "market", buyId: "T4_RELIC", buyCount: 1, steps: 0,
      perUnit: 1_000 * S, marketPerUnit: 1_000, feePerUnit: 0 },
  },
];

ROUTE_CASES.forEach((c) => {
  test(c.name, () => {
    const r = X.getFragmentSourcing(c.target, priceMap(c.prices), CITIES);
    assert.ok(r, "expected a route");
    assert.strictEqual(r.source, c.want.source, "source");
    assert.strictEqual(r.buyId, c.want.buyId, "buyId");
    assert.strictEqual(r.buyCount, c.want.buyCount, "buyCount");
    assert.strictEqual(r.steps.length, c.want.steps, "step count");
    close(r.perUnit, c.want.perUnit, "perUnit");
    close(r.marketPerUnit, c.want.marketPerUnit, "marketPerUnit");
    close(r.feePerUnit, c.want.feePerUnit, "feePerUnit");
    assert.strictEqual(r.buyCity, CITY, "buyCity");
  });
});

test("steps are ordered from the bought node to the fragment", () => {
  const r = X.getFragmentSourcing("T6_RELIC",
    priceMap([{ id: "T6_RELIC", buy: 99_999 }, { id: "T5_SOUL", buy: 100 }]), CITIES);
  assert.deepStrictEqual(
    r.steps.map((s) => [s.fromId, s.toId, s.kind, s.ratio]),
    [["T5_SOUL", "T6_SOUL", "tier", 5], ["T6_SOUL", "T6_RELIC", "type", 1]],
  );
  assert.strictEqual(r.steps[0].fee, 0);
  assert.strictEqual(r.steps[1].fee, FEE.SOUL_RELIC[6]);
});

test("the fragment's own listing is reported beside a winning transmute", () => {
  const r = X.getFragmentSourcing("T6_RELIC",
    priceMap([{ id: "T6_RELIC", buy: 40_000, city: "Lymhurst" }, { id: "T6_SOUL", buy: 10_000 }]), CITIES);
  assert.strictEqual(r.source, "transmute");
  assert.strictEqual(r.marketPrice, 40_000);
  assert.strictEqual(r.marketCity, "Lymhurst");
  assert.strictEqual(r.buyPrice, 10_000);
});

test("an unlisted fragment can still be sourced by transmute", () => {
  const r = X.getFragmentSourcing("T6_RELIC", priceMap([{ id: "T6_SOUL", buy: 10_000 }]), CITIES);
  assert.ok(r, "expected a route");
  assert.strictEqual(r.source, "transmute");
  assert.strictEqual(r.marketPrice, 0);
  assert.strictEqual(r.marketCity, null);
});

test("nothing priced on the grid → null", () => {
  assert.strictEqual(X.getFragmentSourcing("T8_RELIC", {}, CITIES), null);
  assert.strictEqual(X.getFragmentSourcing("T8_RELIC", priceMap([{ id: "T8_SHARD_AVALONIAN", buy: 5 }]), CITIES), null);
});

test("a non-fragment id → null", () => {
  assert.strictEqual(X.getFragmentSourcing("T6_WOOD", priceMap([{ id: "T6_WOOD", buy: 5 }]), CITIES), null);
});

test("an equal-cost transmute does not displace the market buy", () => {
  X.__setSetupFee(0);
  const r = X.getFragmentSourcing("T6_RELIC",
    priceMap([{ id: "T6_RELIC", buy: 10_000 + FEE.SOUL_RELIC[6] }, { id: "T6_SOUL", buy: 10_000 }]), CITIES);
  assert.strictEqual(r.source, "market");
});

// ── City pool and forces ─────────────────────────────────────────────────────
console.log("\n=== City pool ===");

test("leaves outside the city pool are never bought", () => {
  const md = priceMap([
    { id: "T6_RELIC", buy: 40_000, city: "Martlock" },
    { id: "T6_SOUL", buy: 10, city: "Caerleon" },
  ]);
  const royal = X.getFragmentSourcing("T6_RELIC", md, ["Martlock", "Lymhurst"]);
  assert.strictEqual(royal.source, "market");
  assert.strictEqual(royal.buyCity, "Martlock");
  const all = X.getFragmentSourcing("T6_RELIC", md, CITIES);
  assert.strictEqual(all.buyCity, "Caerleon");
});

test("the cheapest city is picked per leaf", () => {
  const md = priceMap([
    { id: "T6_RELIC", buy: 30_000, city: "Martlock" },
    { id: "T6_RELIC", buy: 20_000, city: "Thetford" },
  ]);
  const r = X.getFragmentSourcing("T6_RELIC", md, CITIES);
  assert.strictEqual(r.buyCity, "Thetford");
  assert.strictEqual(r.buyPrice, 20_000);
});

test("an in-pool buy force pins the leaf's city even when dearer", () => {
  X.__setForce({ T6_RELIC: { buy: "Martlock" } });
  const md = priceMap([
    { id: "T6_RELIC", buy: 30_000, city: "Martlock" },
    { id: "T6_RELIC", buy: 20_000, city: "Thetford" },
  ]);
  const r = X.getFragmentSourcing("T6_RELIC", md, CITIES);
  assert.strictEqual(r.buyCity, "Martlock");
  assert.strictEqual(r.buyPrice, 30_000);
});

test("a force outside the pool is ignored", () => {
  X.__setForce({ T6_RELIC: { buy: "Caerleon" } });
  const md = priceMap([
    { id: "T6_RELIC", buy: 1, city: "Caerleon" },
    { id: "T6_RELIC", buy: 20_000, city: "Thetford" },
  ]);
  const r = X.getFragmentSourcing("T6_RELIC", md, ["Thetford", "Martlock"]);
  assert.strictEqual(r.buyCity, "Thetford");
});

test("a price override counts as a listing", () => {
  X.__setOverrides({ "T6_SOUL:Bridgewatch": 5 });
  const r = X.getFragmentSourcing("T6_RELIC", priceMap([{ id: "T6_RELIC", buy: 40_000 }]), CITIES);
  assert.strictEqual(r.buyId, "T6_SOUL");
  assert.strictEqual(r.buyCity, "Bridgewatch");
});

// ── Fees ─────────────────────────────────────────────────────────────────────
console.log("\n=== Fees ===");

test("the Global Discount lowers the transmute silver", () => {
  X.__setDiscount(0.5);
  const r = X.getFragmentSourcing("T6_RELIC",
    priceMap([{ id: "T6_RELIC", buy: 40_000 }, { id: "T6_SOUL", buy: 10_000 }]), CITIES);
  close(r.feePerUnit, FEE.SOUL_RELIC[6] * 0.5, "discounted fee");
});

test("the setup fee lands on the market silver only", () => {
  X.__setSetupFee(0.1);
  const r = X.getFragmentSourcing("T6_RELIC",
    priceMap([{ id: "T6_RELIC", buy: 99_000 }, { id: "T6_SOUL", buy: 10_000 }]), CITIES);
  close(r.perUnit, 10_000 * 1.1 + FEE.SOUL_RELIC[6], "perUnit with 10% setup");
});

test("the station fee adds to a type-up", () => {
  X.__setStationRate(1000);
  const r = X.getFragmentSourcing("T6_RELIC",
    priceMap([{ id: "T6_RELIC", buy: 99_000 }, { id: "T6_SOUL", buy: 10_000 }]), CITIES);
  const station = 10 * FEE.SOUL_RELIC[6] * X.TRANSMUTE_NUTRITION_PER_SILVER;
  close(r.feePerUnit, FEE.SOUL_RELIC[6] + station, "fee incl. station");
  close(r.steps[0].stationFee, station, "step station fee");
});

test("a tier-up bills no station fee", () => {
  X.__setStationRate(1000);
  const r = X.getFragmentSourcing("T6_RELIC",
    priceMap([{ id: "T6_RELIC", buy: 60_000 }, { id: "T5_RELIC", buy: 2_000 }]), CITIES);
  close(r.feePerUnit, 0, "tier-up fee");
  close(r.perUnit, 10_000 * S, "tier-up perUnit");
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
