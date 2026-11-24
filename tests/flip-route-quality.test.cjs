/**
 * Test: the Flipping route prices BOTH legs at the same quality.
 *
 * Reported: standing in Caerleon Market, the sniffer captured the Grandmaster's
 * Rootbound Staff book, but the row kept showing `549,999 - 2d ago`. The
 * capture was correct: Caerleon had no Normal ask at all, the four listings
 * were quality 2 (698,874) and quality 3 (698,941), and the quality-1
 * projection of the flat map had nothing to carry.
 *
 * The route now evaluates every priced quality of the item and keeps the best
 * pair, with the two legs always at the SAME quality. Buying a Good staff and
 * quoting the Black Market's Normal bid is not a trade anyone can make.
 *
 * Ranking rules kept from js/flip-route.js, now across qualities too:
 *   - a pair whose both legs clear the volume gate outranks any thin pair,
 *   - ties keep quality 1, so a row does not shuffle between renders.
 *
 * Black-box: real js/utils.js + js/flip-route.js + js/quality-flat-views.js +
 * js/flip-route-quality.js with stubs. No DOM, no live API.
 *
 * Run: node tests/flip-route-quality.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const stubs = `
let _instant = false;
let _bmr = true;
const _els = {
  "sort-instant": { get checked() { return _instant; } },
  "include-caerleon": { get checked() { return _bmr; } },
};
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] };
const _store = {};
const localStorage = {
  getItem: (k) => (k in _store ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: (k) => { delete _store[k]; },
};
const window = { addEventListener: () => {} };
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
const FOCUS_COSTS = {};
let recipeCache = {};
let lastMarketData = null;
function setInstant(on) { _instant = !!on; }
function setRoutes(on) { _bmr = !!on; }
`;

const exports_ = `
function setOverride(itemId, city, entry) { setOverrideEntry(itemId, city, entry); }
function clearOverrides() { Object.keys(priceOverrides).forEach((id) => clearOverridePriceAllCities(id)); }
module.exports = { findBestFlipPairAcrossQualities, findBestFlipPair, setInstant, setRoutes, setOverride, clearOverrides };
`;

const mod = new Module("flip-route-quality");
mod._compile(
  stubs
    + J("data-city-bonuses.js") + (J("calculations.js") + J("calculations-margins.js")) + J("travel-cost.js")
    + (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) + J("price-freshness.js") + J("flip-route.js")
    + J("quality-flat-views.js") + J("flip-route-quality.js") + exports_,
  "flip-route-quality.js",
);
const X = mod.exports;

const CAE = "Caerleon";
const LYM = "Lymhurst";
const MAR = "Martlock";
const THE = "Thetford";
const FST = "Fort Sterling";
const BM = "Black Market";
const ID = "T7_2H_SHAPESHIFTER_SET2";
const BUY_CITIES = ["Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Brecilien"];
const SELL_LIST = [...BUY_CITIES, BM];
const V_HI = 100;

// A non-Normal quality has to be able to say WHEN it was seen before it may
// take a row (see flipQualityIsDatable), so the fixtures date their books the
// way a real scan or capture does. `undated()` is the deliberate exception.
const SEEN = "2026-08-22T06:02:52.000Z";

/** {city: [buy, sell, vol]} -> {city: entry} */
function book(entries, dated = true) {
  const out = {};
  Object.entries(entries).forEach(([city, [buy, sell, vol]]) => {
    out[city] = { buy_price: buy, sell_price: sell, volume_24h: vol || 0 };
    if (dated) {
      if (buy > 0) out[city].buy_date = SEEN;
      if (sell > 0) out[city].sell_date = SEEN;
    }
  });
  return out;
}
const flatOf = (entries) => ({ [ID]: book(entries) });
const qualityOf = (byQuality, dated = true) => {
  const out = { [ID]: {} };
  Object.entries(byQuality).forEach(([q, entries]) => { out[ID][q] = book(entries, dated); });
  return out;
};

function run(flat, quality, options) {
  return X.findBestFlipPairAcrossQualities(flat, quality, ID, BUY_CITIES, SELL_LIST, {
    minVolume: 25, sideMode: true, ...(options || {}),
  });
}

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    X.setInstant(false);
    X.setRoutes(true);
    X.clearOverrides();
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} - ${e.message}`);
    failed++;
  }
}

console.log("Quality-consistent flip route tests\n");

// -- The reported case ---------------------------------------------------
test("Rootbound Staff: the Good pair is evaluated and loses on its own merits", () => {
  // The exact numbers from the capture. Quality 2 is where the live ask is,
  // but the Black Market pays LESS for a Good one, so the pair is a loss and
  // the (stale) Normal pair still wins the row. What must not happen is the
  // Good book being invisible, or its 698,874 being paired with the NORMAL bid.
  const flat = flatOf({ [CAE]: [3, 549999, 0], [BM]: [755274, 798998, 366] });
  const quality = qualityOf({
    2: { [CAE]: [0, 698874, 0], [BM]: [469836, 499973, 704] },
    3: { [CAE]: [0, 698941, 0], [BM]: [434472, 499972, 439] },
  });
  // Instant Buy/Sell, the mode the report was filed in: the buy leg pays the
  // ask, the sell leg hits the bid.
  X.setInstant(true);
  const r = run(flat, quality, { minVolume: 0 });
  assert.strictEqual(r.quality, 1, "the Normal pair still pays best");
  assert.strictEqual(r.buyPrice, 549999);
  assert.strictEqual(r.sellPrice, 755274);
  assert.deepStrictEqual(r.byQuality.map((b) => b.quality), [1, 2, 3], "every quality reported");
  const q2 = r.byQuality.find((b) => b.quality === 2);
  assert.strictEqual(q2.buyPrice, 698874, "the live Good ask is visible");
  assert.strictEqual(q2.sellPrice, 469836, "paired with the GOOD bid, never the Normal one");
  assert.ok(q2.profit < 0, "and it is the loss it really is");
});

test("a quality with no Normal book at all still routes", () => {
  const flat = { [ID]: {} };
  const quality = qualityOf({ 2: { [CAE]: [0, 1000, V_HI], [BM]: [3000, 3200, V_HI] } });
  X.setInstant(true);
  const r = run(flat, quality, { minVolume: 0 });
  assert.strictEqual(r.quality, 2);
  assert.strictEqual(r.buyCity, CAE);
  assert.strictEqual(r.sellCity, BM);
  assert.strictEqual(r.buyPrice, 1000);
  assert.strictEqual(r.sellPrice, 3000);
  assert.strictEqual(r.viewId, `${ID}#Q2`);
});

// -- Ranking -------------------------------------------------------------
test("a fatter same-quality spread wins the row", () => {
  const flat = flatOf({ [LYM]: [900, 1000, V_HI], [CAE]: [1400, 1500, V_HI] });
  const quality = qualityOf({ 3: { [LYM]: [900, 1000, V_HI], [CAE]: [2400, 2500, V_HI] } });
  const r = run(flat, quality);
  assert.strictEqual(r.quality, 3);
  assert.strictEqual(r.sellPrice, 2500);
});

test("an equal pair keeps quality 1, so the row does not shuffle", () => {
  const same = { [LYM]: [900, 1000, V_HI], [CAE]: [1400, 1500, V_HI] };
  const r = run(flatOf(same), qualityOf({ 2: same, 3: same }));
  assert.strictEqual(r.quality, 1);
  assert.strictEqual(r.viewId, ID);
});

test("a liquid pair outranks a thin pair that pays more", () => {
  // The same rule findBestFlipPair applies inside one quality (js/flip-route.js).
  const flat = flatOf({ [LYM]: [900, 1000, V_HI], [CAE]: [1900, 2000, V_HI] });
  const quality = qualityOf({ 2: { [LYM]: [900, 1000, 0], [CAE]: [4900, 5000, 0] } });
  const r = run(flat, quality, { minVolume: 25 });
  assert.strictEqual(r.quality, 1, "the thin Good pair pays more but nothing trades there");
  const q2 = r.byQuality.find((b) => b.quality === 2);
  assert.ok(q2.profit > 0, "it is still reported, just not chosen");
});

test("with the volume gate off, the fatter thin pair wins", () => {
  const flat = flatOf({ [LYM]: [900, 1000, V_HI], [CAE]: [1900, 2000, V_HI] });
  const quality = qualityOf({ 2: { [LYM]: [900, 1000, 0], [CAE]: [4900, 5000, 0] } });
  const r = run(flat, quality, { minVolume: 0 });
  assert.strictEqual(r.quality, 2);
});

test("no priced book anywhere answers 'no route' rather than throwing", () => {
  const r = run({ [ID]: {} }, null);
  assert.strictEqual(r.buyCity, null);
  assert.strictEqual(r.sellCity, null);
  assert.strictEqual(r.buyPrice, 0);
  assert.strictEqual(r.quality, 1);
  assert.deepStrictEqual(r.byQuality, []);
});

// -- The per-quality isolation the synthetic view id buys ----------------
test("each quality is priced from its own book only", () => {
  // A Normal outlier is fenced out of the Normal pair; the Good book, whose
  // ordinary prices are fifty times larger, is untouched by it. The outlier
  // sits at Fort Sterling: Caerleon is exempt from the fence now
  // (plan-caerleon-exempt.md), so a Caerleon junk ask would be kept as-is.
  const flat = flatOf({
    [LYM]: [900, 1000, V_HI], [MAR]: [950, 1050, V_HI],
    [THE]: [980, 1100, V_HI], [FST]: [1000, 999999, V_HI],
  });
  const quality = qualityOf({
    2: {
      [LYM]: [49000, 50000, V_HI], [MAR]: [49500, 50500, V_HI],
      [THE]: [49800, 51000, V_HI], [CAE]: [60000, 62000, V_HI],
    },
  });
  const r = run(flat, quality);
  const q1 = r.byQuality.find((b) => b.quality === 1);
  assert.strictEqual(q1.sellPrice, 1100, "999,999 is fenced out of the Normal book");
  const q2 = r.byQuality.find((b) => b.quality === 2);
  assert.strictEqual(q2.sellPrice, 62000, "62,000 is ordinary for a Good book, and kept");
  assert.strictEqual(r.quality, 2);
});

test("an override on one quality leaves the others alone", () => {
  const flat = flatOf({ [LYM]: [900, 1000, V_HI], [CAE]: [1400, 1500, V_HI] });
  const quality = qualityOf({ 2: { [LYM]: [900, 1000, V_HI], [CAE]: [1400, 1500, V_HI] } });
  // Pin a fat Good ask in Caerleon; the Normal pair must not see it.
  X.setOverride(`${ID}#Q2`, CAE, { sellOrder: 9000, use: "sell" });
  const r = run(flat, quality);
  assert.strictEqual(r.quality, 2);
  assert.strictEqual(r.sellPrice, 9000);
  const q1 = r.byQuality.find((b) => b.quality === 1);
  assert.strictEqual(q1.sellPrice, 1500, "the Normal pair is untouched");
});

// -- A quality may only take the row if it can say when it was seen --------
test("an undated non-Normal book is reported but never takes the row", () => {
  // The Rerolling fetch used to drop the dates, so a stored quality book can
  // be weeks old with nothing on the row to admit it. It must not outrank a
  // Normal price the reader can actually judge.
  const flat = flatOf({ [LYM]: [900, 1000, V_HI], [CAE]: [1400, 1500, V_HI] });
  const quality = qualityOf({ 2: { [LYM]: [900, 1000, V_HI], [CAE]: [9400, 9500, V_HI] } }, false);
  const r = run(flat, quality);
  assert.strictEqual(r.quality, 1, "the undated Good pair pays more but cannot be dated");
  const q2 = r.byQuality.find((b) => b.quality === 2);
  assert.ok(q2, "and it is still shown");
  assert.strictEqual(q2.datable, false);
});

test("the same book, dated, does take the row", () => {
  const flat = flatOf({ [LYM]: [900, 1000, V_HI], [CAE]: [1400, 1500, V_HI] });
  const quality = qualityOf({ 2: { [LYM]: [900, 1000, V_HI], [CAE]: [9400, 9500, V_HI] } });
  assert.strictEqual(run(flat, quality).quality, 2);
});

test("an undated Normal book is still the baseline", () => {
  // Quality 1 is never gated: it is what the table shows today, and gating it
  // would blank rows rather than improve them.
  const flat = { [ID]: book({ [LYM]: [900, 1000, V_HI], [CAE]: [1400, 1500, V_HI] }, false) };
  const r = run(flat, null);
  assert.strictEqual(r.quality, 1);
  assert.strictEqual(r.sellPrice, 1500);
});

test("a pinned leg counts as dated - the number is the user's", () => {
  const flat = flatOf({ [LYM]: [900, 1000, V_HI], [CAE]: [1400, 1500, V_HI] });
  const quality = qualityOf({ 2: { [LYM]: [900, 1000, V_HI], [CAE]: [9400, 9500, V_HI] } }, false);
  X.setOverride(ID + "#Q2", LYM, { buyOrder: 900, use: "buy" });
  X.setOverride(ID + "#Q2", CAE, { sellOrder: 9500, use: "sell" });
  assert.strictEqual(run(flat, quality).quality, 2);
});

// -- One-sided books: a reading, not a route ------------------------------
// Reported as "Elder's Hellion Shoes [T8.4] Black Market price not detected by
// the sniffer". It was detected — T8_SHOES_LEATHER_HELL@4 held a Black Market
// bid at qualities 1-3 and a Caerleon ask at quality 4, so no single quality
// was a matched pair and every one of them used to be discarded here.
const HELLION_BID = 3850938;
const HELLION_ASK = 16999999;

test("a bid with nobody asking is reported, with the side it has", () => {
  X.setInstant(true);
  const r = run({}, qualityOf({ 3: { [BM]: [HELLION_BID, 0, 0] } }), { minVolume: 0 });
  const q3 = r.byQuality.find((e) => e.quality === 3);
  assert.ok(q3, "the quality-3 book must be reported");
  assert.strictEqual(q3.routable, false);
  assert.strictEqual(q3.sellCity, BM);
  assert.strictEqual(q3.sellPrice, HELLION_BID);
  assert.strictEqual(q3.buyCity, null);
  assert.strictEqual(q3.buyPrice, 0);
  assert.strictEqual(q3.profit, null);
});

test("an ask with nobody bidding is reported the same way", () => {
  X.setInstant(true);
  const r = run({}, qualityOf({ 4: { [CAE]: [0, HELLION_ASK, 0] } }), { minVolume: 0 });
  const q4 = r.byQuality.find((e) => e.quality === 4);
  assert.ok(q4, "the quality-4 book must be reported");
  assert.strictEqual(q4.routable, false);
  assert.strictEqual(q4.buyCity, CAE);
  assert.strictEqual(q4.buyPrice, HELLION_ASK);
  assert.strictEqual(q4.sellCity, null);
  assert.strictEqual(q4.sellPrice, 0);
});

test("the reported item: every quality reported, none of them a route", () => {
  X.setInstant(true);
  const r = run({}, qualityOf({
    1: { [BM]: [13182057, 0, 0] },
    2: { [BM]: [3977892, 0, 0] },
    3: { [BM]: [HELLION_BID, 0, 0] },
    4: { [CAE]: [0, HELLION_ASK, 0] },
  }), { minVolume: 0 });
  assert.strictEqual(r.buyCity, null, "no quality is a matched pair");
  assert.strictEqual(r.sellCity, null);
  assert.deepStrictEqual(r.byQuality.map((e) => e.quality), [2, 3, 4],
    "quality 1 lives in the flat map, which is empty here");
  assert.ok(r.byQuality.every((e) => e.routable === false));
});

test("a one-sided quote never takes the row from a real pair", () => {
  X.setInstant(true);
  const quality = qualityOf({
    2: { [LYM]: [0, 1000, V_HI], [MAR]: [9000, 0, V_HI] },
    3: { [BM]: [HELLION_BID, 0, 0] },
  });
  const r = run({}, quality, { minVolume: 0 });
  assert.strictEqual(r.quality, 2, "the routable quality wins");
  assert.strictEqual(r.sellPrice, 9000);
  const q3 = r.byQuality.find((e) => e.quality === 3);
  assert.strictEqual(q3.routable, false);
});

test("a quality with no price at all is still not reported", () => {
  X.setInstant(true);
  const r = run({}, qualityOf({ 3: { [BM]: [0, 0, 12] } }), { minVolume: 0 });
  assert.deepStrictEqual(r.byQuality, [], "volume alone is not a price");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
