/**
 * Test: a Flipping route may not be built on a number nobody can trade.
 *
 * Reported twice from the live app, both times on a Black Market row:
 *
 *   "i sold t7 warbow, but sell price in flipping table doesnt update since i
 *    closed this black market order"
 *
 * Two different numbers can sit on the board looking perfectly healthy:
 *
 *   - one whose book has since been READ WITHOUT IT. The app flags such a price
 *     and keeps it (bookEmptySince, js/price-freshness.js) — a missing order is
 *     evidence, not proof, and packets get dropped. Fine to print in grey; not
 *     fine to plan a trade on.
 *   - one that is the PLAYER'S OWN standing order. Routing against it books a
 *     profit against yourself, and closing the order changes nothing on the
 *     board because nothing ever told the app it was yours.
 *
 * Both are now refused at the leg, before any pair is scored, so the route falls
 * to the next real price instead of vanishing.
 *
 * Black-box over the real js/utils.js + js/price-freshness.js + js/flip-route.js
 * with synthetic books. No DOM, no live API.
 *
 * Run: node tests/flip-own-order-gate.test.cjs
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
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const window = { addEventListener: () => {} };
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
const FOCUS_COSTS = {};
let recipeCache = {};
let lastMarketData = null;
let _own = {};
function isOwnMarketPrice(itemId, quality, city, side, price) {
  return _own[[itemId, quality, city, side, price].join("|")] === true;
}
function setOwn(itemId, quality, city, side, price) {
  _own[[itemId, quality, city, side, price].join("|")] = true;
}
function clearOwn() { _own = {}; }
function setInstant(on) { _instant = !!on; }
`;

const mod = new Module("flip-own-order-gate");
mod._compile(
  stubs
    + J("data-city-bonuses.js") + (J("calculations.js") + J("calculations-margins.js")) + J("travel-cost.js")
    + (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) + J("price-freshness.js") + J("flip-route.js")
    + "\nmodule.exports = { findBestFlipPair, flipLegs, flipLegUsable, setOwn, clearOwn, setInstant, setOverrideEntry, clearOverridePrice };",
  "flip-own-order-gate.js",
);
const X = mod.exports;

const CAE = "Caerleon";
const BM = "Black Market";
const ITEM = "T7_2H_WARBOW";
const BUY_CITIES = ["Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Brecilien"];
const SELL = [...BUY_CITIES, BM];

const MIN_5 = new Date(Date.now() - 5 * 60000).toISOString();
const HOURS_3 = new Date(Date.now() - 3 * 3600000).toISOString();

/** A flat book: city → entry. */
function book(entries) {
  return { [ITEM]: entries };
}

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    X.clearOwn();
    X.setInstant(true);
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

// The app sells INTO the Black Market's bids, so the sell leg reads buy_price
// under instant orders — the mode the reported screenshots were taken in.
const bid = (price, over = {}) => ({
  buy_price: price, buy_date: MIN_5, sell_price: 0, sell_date: null,
  volume_24h: 100, ...over,
});
const ask = (price, over = {}) => ({
  buy_price: 0, buy_date: null, sell_price: price, sell_date: MIN_5,
  volume_24h: 100, ...over,
});

// ── a price the book was read without ──────────────────────────────────────

test("a bid the book was read without does not carry the sell leg", () => {
  const md = book({
    [CAE]: ask(147996),
    [BM]: bid(838798, { buy_date: HOURS_3, buy_seen: MIN_5 }),
  });
  const pair = X.findBestFlipPair(md, ITEM, BUY_CITIES, SELL, { sideMode: true });
  assert.notStrictEqual(pair.sellCity, BM, "the Black Market bid is gone from the book");
});

test("the route falls to the next real bid rather than vanishing", () => {
  const md = book({
    [CAE]: ask(100000),
    [BM]: bid(838798, { buy_date: HOURS_3, buy_seen: MIN_5 }),
    Lymhurst: bid(200000),
  });
  const pair = X.findBestFlipPair(md, ITEM, BUY_CITIES, SELL, { sideMode: true });
  assert.strictEqual(pair.sellCity, "Lymhurst");
  assert.strictEqual(pair.sellPrice, 200000);
});

test("a bid the book still holds routes normally", () => {
  const md = book({ [CAE]: ask(147996), [BM]: bid(257703, { buy_seen: HOURS_3 }) });
  const pair = X.findBestFlipPair(md, ITEM, BUY_CITIES, SELL, { sideMode: true });
  assert.strictEqual(pair.sellCity, BM);
  assert.strictEqual(pair.sellPrice, 257703);
});

test("the buy leg is gated the same way", () => {
  const md = book({
    [CAE]: ask(50000, { sell_date: HOURS_3, sell_seen: MIN_5 }),
    Lymhurst: ask(90000),
    [BM]: bid(257703),
  });
  const pair = X.findBestFlipPair(md, ITEM, BUY_CITIES, SELL, { sideMode: true });
  assert.strictEqual(pair.buyCity, "Lymhurst", "the Caerleon ask is no longer listed");
});

// ── the player's own order ─────────────────────────────────────────────────

test("your own listing is not the market's best sell price", () => {
  const md = book({ [CAE]: ask(147996), [BM]: bid(373848) });
  X.setOwn(ITEM, 1, BM, "sell", 373848);
  const pair = X.findBestFlipPair(md, ITEM, BUY_CITIES, SELL, { sideMode: true });
  assert.notStrictEqual(pair.sellCity, BM);
});

test("someone else's order at the same price still routes", () => {
  const md = book({ [CAE]: ask(147996), [BM]: bid(373848) });
  X.setOwn(ITEM, 1, BM, "sell", 999999);
  const pair = X.findBestFlipPair(md, ITEM, BUY_CITIES, SELL, { sideMode: true });
  assert.strictEqual(pair.sellCity, BM);
});

test("an order of yours at another city does not gate this one", () => {
  const md = book({ [CAE]: ask(147996), [BM]: bid(373848) });
  X.setOwn(ITEM, 1, "Lymhurst", "sell", 373848);
  const pair = X.findBestFlipPair(md, ITEM, BUY_CITIES, SELL, { sideMode: true });
  assert.strictEqual(pair.sellCity, BM);
});

test("a quality view files the order under the REAL item id, not the view id", () => {
  const md = { [`${ITEM}#Q3`]: { [CAE]: ask(147996), [BM]: bid(373848) } };
  X.setOwn(ITEM, 3, BM, "sell", 373848);
  const viewPair = X.findBestFlipPair(md, `${ITEM}#Q3`, BUY_CITIES, SELL, {
    sideMode: true, ownItemId: ITEM, quality: 3,
  });
  assert.notStrictEqual(viewPair.sellCity, BM);
  // The same call without the real id has nothing to match on, which is exactly
  // the bug this argument exists to prevent.
  const blind = X.findBestFlipPair(md, `${ITEM}#Q3`, BUY_CITIES, SELL, { sideMode: true });
  assert.strictEqual(blind.sellCity, BM);
});

// ── an override outranks both ──────────────────────────────────────────────

test("a price typed by hand is a decision, not a reading", () => {
  const md = book({
    [CAE]: ask(147996),
    [BM]: bid(838798, { buy_date: HOURS_3, buy_seen: MIN_5 }),
  });
  X.setOwn(ITEM, 1, BM, "sell", 838798);
  X.setOverrideEntry(ITEM, BM, { sellOrder: 838798, use: "sell" });
  const pair = X.findBestFlipPair(md, ITEM, BUY_CITIES, SELL, { sideMode: true });
  assert.strictEqual(pair.sellCity, BM);
  X.clearOverridePrice(ITEM, BM);
});

// ── the predicate on its own ───────────────────────────────────────────────

// Under instant orders a sell cell reads the BID book (js/price-freshness.js),
// which is the mode the harness runs and the one the reports were filed in.
[
  ["a clean entry", { buy_price: 10, buy_date: MIN_5 }, "sell", false, true],
  ["a flagged entry", { buy_price: 10, buy_date: HOURS_3, buy_seen: MIN_5 }, "sell", false, false],
  ["a flagged entry with an override", { buy_price: 10, buy_date: HOURS_3, buy_seen: MIN_5 }, "sell", true, true],
  ["no entry at all", null, "sell", false, true],
].forEach(([name, entry, side, override, usable]) => {
  test(`flipLegUsable: ${name} is ${usable ? "usable" : "refused"}`, () => {
    assert.strictEqual(
      X.flipLegUsable(entry, ITEM, 1, BM, side, 10, override),
      usable,
    );
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
