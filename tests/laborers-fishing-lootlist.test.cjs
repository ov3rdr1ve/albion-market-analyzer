/**
 * Test: Fisherman Resource mode now values the catch from the journal's ACTUAL
 * fixed lootlist (items.xml `T{n}_JOURNAL_FISHING <lootlist>`), as a
 * weight-share expected value — NOT the old "best common + 15% of the single
 * most expensive biome rare" heuristic.
 *
 * Why this matters: the laborer returns a biome-INDEPENDENT mix. Rares are
 * spread EQUALLY across all 6 biomes + saltwater AND across the T3/T5/T7 band
 * (weight 10 each); commons span the three tiers up to the journal tier, both
 * freshwater and saltwater; plus near-worthless T1 seaweed. The old model
 * valued every rare at the single cherry-picked max (e.g. T7 Forest), which
 * overstated T8 fisherman revenue ~2-4×.
 *
 * THE WEIGHT SHARE IS TAKEN OVER THE LINES THAT ACTUALLY PRICE. A lootlist line
 * with no market data is not a draw worth zero — it is a draw we cannot value,
 * and the honest estimate of it is the rest of the list. Dividing by the WHOLE
 * list weight while skipping unpriced lines (what this file used to assert) put
 * their weight in the denominator and nothing in the numerator, so every missing
 * line silently dragged the payload toward zero. That is one-directional: a
 * T8 fishing journal's 21 biome rares are 18.2% of the weight and the most
 * illiquid ids in the game, so the fisherman's payload was understated and never
 * overstated — which is what printed a negative self-fill profit on every fisher
 * row. Land laborers have 4-5 always-traded ids and never hit it.
 *
 * The renormalized reading assumes an unpriced line is worth the average of the
 * priced ones. That is an assumption, but it is a bounded one; the old reading
 * assumed it was worth zero, which is not.
 *
 * Black-box: drives the exported _fishResourceRevenue / getFishResourceIds /
 * FISH_JOURNAL_LOOTLIST with synthetic prices and checks input→output.
 *
 * Run: node tests/laborers-fishing-lootlist.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

// Minimal sandbox mirroring the bits _fishResourceRevenue depends on. Selling
// fish reads getSellPrice; here buy_price === sell_price so a single price feeds
// both. No volume/IQR gating (upper = Infinity).
const sandbox = `
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SETUP_FEE = 0.025;
const PREMIUM_TAX = 0.065;
function getOrderType() { return "instant"; }
function getOverridePrice() { return null; }
function getOverrideVolume() { return null; }
function getCityForce() { return null; }
function isBlackRedZoneEnabled() { return false; }
function isValidSourceCity(buyCity, craftCity) {
  if (!buyCity || !craftCity) return false;
  if (isBlackRedZoneEnabled()) return true;
  if (BLACK_ZONE_CITIES.includes(buyCity) || BLACK_ZONE_CITIES.includes(craftCity)) return false;
  return (buyCity === "Caerleon") === (craftCity === "Caerleon");
}
function legBrecilienCost() { return 0; }
function getIQRBounds() { return { upper: Infinity }; }
function formatSilver(n) { return Math.round(n).toLocaleString(); }
function getSellPrice(itemData, city, bounds, itemId) {
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].buy_price || itemData[city].sell_price || 0;
}
function getBuyPrice(itemData, city, bounds, itemId) {
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].sell_price || itemData[city].buy_price || 0;
}
`;

function loadFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const dataSrc = loadFile("js/data-laborers.js");
const pricingSrc = loadFile("js/laborers-pricing.js");
const renderSrc = loadFile("js/render-laborers.js");

const mod = new Module("laborers-fishing-lootlist-test");
mod._compile(
  sandbox + dataSrc + pricingSrc + renderSrc +
    "\nmodule.exports = { FISH_JOURNAL_LOOTLIST, FISH_LABORER_BASELOOT, getFishResourceIds, " +
    "_fishResourceRevenue, getLaborerYield, PREMIUM_TAX };",
  "laborers-fishing-lootlist.js"
);
const {
  FISH_JOURNAL_LOOTLIST, FISH_LABORER_BASELOOT, getFishResourceIds,
  _fishResourceRevenue, getLaborerYield, PREMIUM_TAX,
} = mod.exports;

const FS = "Fort Sterling";
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// Build marketData from {id: price} at Fort Sterling.
function priced(map) {
  const out = {};
  for (const [id, price] of Object.entries(map)) out[id] = { [FS]: { buy_price: price, sell_price: price } };
  return out;
}
function totalWeight(tier) {
  return FISH_JOURNAL_LOOTLIST[tier].reduce((s, l) => s + l[2], 0);
}
// The denominator the model actually uses: the weight of the lines with a price.
function pricedWeight(tier, map) {
  return FISH_JOURNAL_LOOTLIST[tier]
    .filter((l) => map[l[0]] > 0)
    .reduce((s, l) => s + l[2], 0);
}
// Expected value of one draw, renormalized over the priced lines.
function evPerDraw(tier, map) {
  const w = pricedWeight(tier, map);
  if (!w) return 0;
  return FISH_JOURNAL_LOOTLIST[tier]
    .filter((l) => map[l[0]] > 0)
    .reduce((s, [id, amount, weight]) => s + (weight / w) * amount * map[id], 0);
}
const COMMONS = (tier) => FISH_JOURNAL_LOOTLIST[tier].filter((l) => l[0].includes("_COMMON"));
const RARES = (tier) => FISH_JOURNAL_LOOTLIST[tier].filter((l) => l[0].includes("_RARE"));

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== Lootlist data shape (verbatim from items.xml) ===");

test("Every tier 2-8 has a lootlist with the expected total weight", () => {
  const expectedTotals = { 2: 106, 3: 411, 4: 399, 5: 786, 6: 779, 7: 1162, 8: 1156 };
  for (let t = 2; t <= 8; t++) {
    assert.ok(FISH_JOURNAL_LOOTLIST[t], `tier ${t} lootlist present`);
    assert.strictEqual(totalWeight(t), expectedTotals[t], `T${t} total weight`);
  }
});

test("T8 lootlist: 6 commons (w150) + 21 rares (w10) + seaweed (×14, w46)", () => {
  const ll = FISH_JOURNAL_LOOTLIST[8];
  const commons = ll.filter((l) => l[0].includes("_COMMON"));
  const rares = ll.filter((l) => l[0].includes("_RARE"));
  const seaweed = ll.find((l) => l[0] === "T1_SEAWEED");
  assert.strictEqual(commons.length, 6, "6 common lines");
  assert.ok(commons.every((l) => l[2] === 150), "commons weight 150");
  assert.strictEqual(rares.length, 21, "21 rare lines (T3/T5/T7 × 7 sources)");
  assert.ok(rares.every((l) => l[2] === 10), "rares weight 10");
  assert.deepStrictEqual(seaweed, ["T1_SEAWEED", 14, 46], "seaweed ×14, weight 46");
});

test("T8 rares are spread across all 6 biomes + saltwater at T3/T5/T7 (no single dominant)", () => {
  const rareIds = FISH_JOURNAL_LOOTLIST[8].filter((l) => l[0].includes("_RARE")).map((l) => l[0]);
  ["FOREST", "MOUNTAIN", "HIGHLANDS", "STEPPE", "SWAMP", "AVALON"].forEach((b) => {
    [3, 5, 7].forEach((t) => assert.ok(rareIds.includes(`T${t}_FISH_FRESHWATER_${b}_RARE`), `${b} T${t} present`));
  });
  [3, 5, 7].forEach((t) => assert.ok(rareIds.includes(`T${t}_FISH_SALTWATER_ALL_RARE`), `salt rare T${t}`));
});

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== getFishResourceIds — distinct lootlist ids ===");

test("getFishResourceIds returns every distinct lootlist id (commons + rares + seaweed)", () => {
  const t8 = getFishResourceIds(8);
  assert.ok(t8.includes("T8_FISH_FRESHWATER_ALL_COMMON"));
  assert.ok(t8.includes("T6_FISH_SALTWATER_ALL_COMMON"), "lower-tier commons scanned too");
  assert.ok(t8.includes("T7_FISH_FRESHWATER_FOREST_RARE"));
  assert.ok(t8.includes("T3_FISH_FRESHWATER_MOUNTAIN_RARE"), "cheap low-band rares scanned too");
  assert.ok(t8.includes("T1_SEAWEED"));
  // No fictional flat/enchant fish ids.
  assert.ok(!t8.includes("T8_FISH"));
  assert.ok(!t8.some((id) => id.includes("@")));
  // De-duplicated.
  assert.strictEqual(new Set(t8).size, t8.length, "ids are unique");
});

test("getFishResourceIds(2): seaweed + T1/T2 fresh + salt commons (no rares below T3)", () => {
  const t2 = getFishResourceIds(2);
  assert.deepStrictEqual(new Set(t2), new Set([
    "T1_SEAWEED",
    "T1_FISH_FRESHWATER_ALL_COMMON", "T2_FISH_FRESHWATER_ALL_COMMON",
    "T1_FISH_SALTWATER_ALL_COMMON", "T2_FISH_SALTWATER_ALL_COMMON",
  ]));
});

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== _fishResourceRevenue — weight-share expected value ===");

test("Only the 6 commons priced, all at P → EV/draw = P (the priced lines ARE the list)", () => {
  const P = 1000;
  const map = {};
  COMMONS(8).forEach((l) => { map[l[0]] = P; });
  const r = _fishResourceRevenue(8, priced(map), FS);
  assert.ok(r.hasData);
  // Every priced line is a common worth P, so whatever share each carries the
  // weighted average is P. Under the old whole-list denominator this read
  // (900/1156) × P = 0.78 P — a 22% haircut for markets that simply had no
  // rare listings that day.
  assert.ok(Math.abs(r.payloadPrice - P) < 1e-6, `EV/draw: expected ${P}, got ${r.payloadPrice}`);
  const draws = FISH_LABORER_BASELOOT[8] * getLaborerYield(8);
  const expectedRev = draws * P * (1 - PREMIUM_TAX);
  assert.ok(Math.abs(r.revenue - expectedRev) < 1, `rev: expected ${expectedRev}, got ${r.revenue}`);
});

test("payloadPrice is always the weighted average of the PRICED lines", () => {
  // Parameterized over how much of the rare band lists: none, a third, all.
  const P = 1000, RARE = 6000;
  [0, 7, 21].forEach((rareCount) => {
    const map = {};
    COMMONS(8).forEach((l) => { map[l[0]] = P; });
    RARES(8).slice(0, rareCount).forEach((l) => { map[l[0]] = RARE; });
    const r = _fishResourceRevenue(8, priced(map), FS);
    const expected = evPerDraw(8, map);
    assert.ok(Math.abs(r.payloadPrice - expected) < 1e-6,
      `${rareCount} rares priced: expected ${expected}, got ${r.payloadPrice}`);
    assert.ok(r.payloadPrice >= P, `${rareCount} rares priced: dear rares must not drag the EV below the commons' P`);
  });
});

test("Renormalizing never values a partial list BELOW the same list valued whole", () => {
  // The property the old denominator broke: dropping a line must not be worse
  // than pricing it at the average of the ones that remain.
  const P = 1000, RARE = 6000;
  const full = {};
  COMMONS(8).forEach((l) => { full[l[0]] = P; });
  RARES(8).forEach((l) => { full[l[0]] = RARE; });
  const whole = _fishResourceRevenue(8, priced(full), FS).payloadPrice;
  [21, 14, 7, 0].forEach((rareCount) => {
    const map = {};
    COMMONS(8).forEach((l) => { map[l[0]] = P; });
    RARES(8).slice(0, rareCount).forEach((l) => { map[l[0]] = RARE; });
    const partial = _fishResourceRevenue(8, priced(map), FS).payloadPrice;
    const oldModel = FISH_JOURNAL_LOOTLIST[8]
      .filter((l) => map[l[0]] > 0)
      .reduce((s, [id, amount, weight]) => s + (weight / totalWeight(8)) * amount * map[id], 0);
    assert.ok(partial >= oldModel - 1e-6,
      `${rareCount} rares priced: renormalized ${partial} must be ≥ the truncated ${oldModel}`);
    assert.ok(partial <= whole + 1e-6,
      `${rareCount} rares priced: ${partial} must not exceed the fully priced ${whole}`);
  });
});

test("Every rare unpriced → the commons-only value, not a fraction of it", () => {
  const P = 1000;
  const map = {};
  COMMONS(8).forEach((l) => { map[l[0]] = P; });
  const noRares = _fishResourceRevenue(8, priced(map), FS);
  // Same list, valued as if the rares were simply not in the lootlist at all.
  const commonsOnly = evPerDraw(8, map);
  assert.ok(Math.abs(noRares.payloadPrice - commonsOnly) < 1e-6,
    `expected ${commonsOnly}, got ${noRares.payloadPrice}`);
  // 18.2% of the T8 weight is rares — that is exactly the haircut the old model
  // took here, and it is the reason fisher self-fill read negative.
  const rareShare = RARES(8).reduce((s, l) => s + l[2], 0) / totalWeight(8);
  assert.ok(rareShare > 0.18 && rareShare < 0.19, `T8 rare weight share ${rareShare}`);
});

test("pricedWeightShare reports how much of the lootlist actually priced", () => {
  const P = 1000;
  const all = {};
  FISH_JOURNAL_LOOTLIST[8].forEach((l) => { all[l[0]] = P; });
  assert.ok(Math.abs(_fishResourceRevenue(8, priced(all), FS).pricedWeightShare - 1) < 1e-9,
    "everything priced → share 1");
  const commonsOnly = {};
  COMMONS(8).forEach((l) => { commonsOnly[l[0]] = P; });
  const share = _fishResourceRevenue(8, priced(commonsOnly), FS).pricedWeightShare;
  const expected = COMMONS(8).reduce((s, l) => s + l[2], 0) / totalWeight(8);
  assert.ok(Math.abs(share - expected) < 1e-9, `commons only → ${expected}, got ${share}`);
});

test("REGRESSION: one super-expensive biome rare cannot dominate — counts only its weight share", () => {
  // The original bug: T7 Forest Rare @ huge price drove ~75% of revenue via the
  // flat 15% rare share. Under the lootlist model it is ONE of 21 rare lines
  // (weight 10), so a 1,000,000 Forest rare contributes only (10/1156)×1e6.
  const P = 1000, SPIKE = 1_000_000;
  const map = {};
  COMMONS(8).forEach((l) => { map[l[0]] = P; });
  map["T7_FISH_FRESHWATER_FOREST_RARE"] = SPIKE;
  const r = _fishResourceRevenue(8, priced(map), FS);
  const expectedPerDraw = evPerDraw(8, map);
  assert.ok(Math.abs(r.payloadPrice - expectedPerDraw) < 1e-6,
    `EV/draw: expected ${expectedPerDraw}, got ${r.payloadPrice}`);
  // Sanity: the old heuristic would have valued this at 0.15×SPIKE = 150,000/draw.
  assert.ok(r.payloadPrice < 0.15 * SPIKE,
    `lootlist model (${r.payloadPrice.toFixed(0)}) must be far below the old 0.15×spike (${0.15 * SPIKE})`);
});

test("Partial data: one priced line stands in for the whole list, not for 13% of it", () => {
  // Only ONE common priced; everything else absent. Its weight is the entire
  // denominator, so the EV is that line's own value — the market's single
  // opinion about what a draw is worth. The old model read (150/1156)×5000 = 649,
  // an 87% haircut for a thin scan.
  const r = _fishResourceRevenue(8, priced({ "T8_FISH_FRESHWATER_ALL_COMMON": 5000 }), FS);
  assert.ok(r.hasData, "one common is enough data");
  assert.ok(Math.abs(r.payloadPrice - 5000) < 1e-6,
    `EV/draw: expected 5000, got ${r.payloadPrice}`);
});

test("No common priced → hasData false (seaweed/rare-only listing is not a fish market)", () => {
  // Only seaweed priced.
  const seaOnly = _fishResourceRevenue(8, priced({ "T1_SEAWEED": 300 }), FS);
  assert.strictEqual(seaOnly.hasData, false);
  assert.strictEqual(seaOnly.revenue, 0);
  // Only a rare priced, still no common.
  const rareOnly = _fishResourceRevenue(8, priced({ "T7_FISH_FRESHWATER_FOREST_RARE": 90000 }), FS);
  assert.strictEqual(rareOnly.hasData, false);
  assert.strictEqual(rareOnly.revenue, 0);
});

test("Empty market → no data, zero revenue", () => {
  const r = _fishResourceRevenue(8, {}, FS);
  assert.strictEqual(r.hasData, false);
  assert.strictEqual(r.revenue, 0);
});

test("Seaweed contributes its (small) weighted value when priced alongside commons", () => {
  const P = 1000, SEA = 300;
  const map = { "T1_SEAWEED": SEA };
  COMMONS(8).forEach((l) => { map[l[0]] = P; });
  const r = _fishResourceRevenue(8, priced(map), FS);
  // Seaweed amount is 14 per draw of that line, over a 946 priced weight.
  const expectedPerDraw = evPerDraw(8, map);
  assert.ok(Math.abs(r.payloadPrice - expectedPerDraw) < 1e-6,
    `EV/draw with seaweed: expected ${expectedPerDraw}, got ${r.payloadPrice}`);
});

// ────────────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
