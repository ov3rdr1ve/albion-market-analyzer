/**
 * Test: the 24h-volume liquidity gate follows the leg it belongs to.
 *
 * A market ORDER only ever fills if it sits in a book that trades, so a leg in
 * that mode prefers a city with >= 25 units of 24h volume. An instant fill has
 * no such question — the price it reads IS a live standing order — so its gate
 * is 0.
 *
 * The Buy and Sell Pricing Model radios move independently, so a mixed mode
 * (buy by market order, sell instantly) must gate the buy-city pick at 25 and
 * the sell-city pick at 0 — and the mirror. Before the split one number was
 * derived from the single toggle and handed to both sides, which over-filtered
 * whichever leg was instant.
 *
 * The shared routers take the sell-side number as an extra argument that
 * DEFAULTS to the buy-side one, so a caller passing a single value keeps the
 * old linked behaviour; that default is asserted here too.
 *
 * Black-box over the real js/flip-route.js + js/render-flipping.js,
 * js/farming-row-econ.js and js/render-journals.js. Synthetic books only — no
 * market API, no database.
 *
 * Run: node tests/order-type-side-volume-gate.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Module = require("module");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const THIN = "Martlock";     // the best price, but volume_24h 0
const DEEP = "Lymhurst";     // the liquid runner-up
const OTHER = "Thetford";    // the counterparty leg, always liquid
const POOL = [THIN, DEEP, OTHER];

/** One item's book: { city: [buy_price, sell_price, volume_24h] }. */
const md = (entries) => ({
  ITEM: Object.fromEntries(Object.entries(entries).map(
    ([city, [buy, sell, vol]]) => [city, { buy_price: buy, sell_price: sell, volume_24h: vol }],
  )),
});

// ── 1. flip-route, through the real render-flipping entry point ────────────
// In a mixed mode both legs of a flip read the SAME field (buy market and sell
// instant both read buy_price), so each direction needs its own book: one where
// the thin city is the bargain to BUY at, one where it is the fat bid to SELL
// into. A single book cannot be both.
console.log("buildFlipRoute");

const FLIP_STUBS = [
  "let _buyInstant = true, _sellInstant = true;",
  'const _els = { "buy-instant": { get checked() { return _buyInstant; } },',
  '               "sell-instant": { get checked() { return _sellInstant; } } };',
  "const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {},",
  "                   querySelector: () => null, querySelectorAll: () => [] };",
  "const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };",
  "const window = { addEventListener: () => {} };",
  'const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];',
  'const CITIES = ["Caerleon", ...ROYAL_CITIES];',
  'const BLACK_ZONE_CITIES = ["Smuggler\'s Den"];',
  'const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];',
  'const SELL_CITIES = [...CITIES, "Black Market"];',
  "const FOCUS_COSTS = {};",
  "let recipeCache = {};",
  "let lastMarketData = null;",
  "function setModes(b, s) { _buyInstant = !!b; _sellInstant = !!s; }",
  "",
].join("\n");

const flipMod = new Module("order-type-side-volume-gate-flip");
flipMod._compile(
  FLIP_STUBS
    + J("data-city-bonuses.js") + (J("calculations.js") + J("calculations-margins.js")) + J("travel-cost.js")
    + (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) + J("flip-route.js") + J("render-flipping.js")
    + "\nmodule.exports = { buildFlipRoute, setModes, getOrderType };",
  "order-type-side-volume-gate-flip.js",
);
const F = flipMod.exports;

// Prices stay in one band: getIQRBounds fences a lone far-out value, and a
// rejected counterparty leg would look like a gate result.
//
// CHEAP_THIN — the thin city is the bargain, so it is the BUY leg that wants it
// and the buy gate that can rule it out. Both fields carry the same numbers, so
// the book works whichever mode each leg is in.
const CHEAP_THIN = md({
  [THIN]: [100, 100, 0],
  [DEEP]: [120, 120, 999],
  [OTHER]: [300, 300, 999],
});

test("buy instant: the ungated buy leg takes the thin bargain", () => {
  F.setModes(true, true);
  const r = F.buildFlipRoute(CHEAP_THIN, "ITEM", POOL, POOL);
  assert.strictEqual(r.buyCity, THIN, "an instant buy needs no book depth");
  assert.strictEqual(r.sellCity, OTHER);
});

test("buy market: the gated buy leg skips the thin city", () => {
  F.setModes(false, true);
  const r = F.buildFlipRoute(CHEAP_THIN, "ITEM", POOL, POOL);
  assert.strictEqual(r.buyCity, DEEP);
  assert.strictEqual(r.sellCity, OTHER);
});

test("buy instant / sell market: the buy leg is still ungated", () => {
  F.setModes(true, false);
  const r = F.buildFlipRoute(CHEAP_THIN, "ITEM", POOL, POOL);
  assert.strictEqual(r.buyCity, THIN);
});

test("both market: every leg is gated, as before the split", () => {
  F.setModes(false, false);
  const r = F.buildFlipRoute(CHEAP_THIN, "ITEM", POOL, POOL);
  assert.strictEqual(r.buyCity, DEEP);
});

// DEAR_THIN — mirror: the thin city pays the most, so it is the SELL leg that
// wants it and the sell gate that can rule it out.
const DEAR_THIN = md({
  [THIN]: [300, 300, 0],
  [DEEP]: [120, 120, 999],
  [OTHER]: [100, 100, 999],
});

test("sell instant: the ungated sell leg takes the thin bid", () => {
  F.setModes(true, true);
  const r = F.buildFlipRoute(DEAR_THIN, "ITEM", POOL, POOL);
  assert.strictEqual(r.sellCity, THIN, "an instant sell needs no book depth");
  assert.strictEqual(r.buyCity, OTHER);
});

test("sell market: the gated sell leg skips the thin city", () => {
  F.setModes(true, false);
  const r = F.buildFlipRoute(DEAR_THIN, "ITEM", POOL, POOL);
  assert.strictEqual(r.sellCity, DEEP);
  assert.strictEqual(r.buyCity, OTHER);
});

test("buy market / sell instant: the sell leg is still ungated", () => {
  F.setModes(false, true);
  const r = F.buildFlipRoute(DEAR_THIN, "ITEM", POOL, POOL);
  assert.strictEqual(r.sellCity, THIN);
});

// ── 2. farming-row-econ: seed buy vs crop sell ─────────────────────────────
// Two cities, and the gate is handed in directly, so both legs can be driven
// against one book.
console.log("evaluateFarmingCity");
const farmMod = new Module("farming-row-econ");
farmMod._compile(
  J("farming-row-econ.js") + "\nmodule.exports = { evaluateFarmingCity };",
  "farming-row-econ.js",
);
const { evaluateFarmingCity } = farmMod.exports;

// THIN is the cheapest ask AND the fattest bid, so under Instant on either side
// it wins that leg outright — unless that leg's gate rules it out.
const TWO_CITY = md({
  [THIN]: [900, 100, 0],
  [DEEP]: [800, 200, 999],
}).ITEM;

/** Stand-in city finders applying the gate the way js/utils.js does. */
const legFinder = (field, cheapest) => (marketData, itemId, cities, minVolume) => {
  let best = { city: null, price: 0, travelCost: 0 };
  (cities || []).forEach((c) => {
    const e = marketData?.[itemId]?.[c];
    if (!e || !(e[field] > 0)) return;
    if ((e.volume_24h || 0) < (minVolume || 0)) return;
    if (!best.city || (cheapest ? e[field] < best.price : e[field] > best.price)) {
      best = { city: c, price: e[field], travelCost: 0 };
    }
  });
  return best;
};
const farmDeps = {
  marketData: { SEED: TWO_CITY, CROP: TWO_CITY },
  findBestBuyCity: legFinder("sell_price", true),   // instant buy reads the ask
  findBestSellCity: legFinder("buy_price", false),  // instant sell reads the bid
};
const FARM_ITEM = { id: "SEED", outputId: "CROP", type: "crop" };

test("seed buy gated at 25, crop sell ungated", () => {
  const r = evaluateFarmingCity(FARM_ITEM, DEEP, [THIN, DEEP], [THIN, DEEP],
    { minVolume: 25, minSellVolume: 0 }, farmDeps);
  assert.strictEqual(r.seedBuy.city, DEEP);
  assert.strictEqual(r.cropSell.city, THIN);
});

test("seed buy ungated, crop sell gated at 25", () => {
  const r = evaluateFarmingCity(FARM_ITEM, DEEP, [THIN, DEEP], [THIN, DEEP],
    { minVolume: 0, minSellVolume: 25 }, farmDeps);
  assert.strictEqual(r.seedBuy.city, THIN);
  assert.strictEqual(r.cropSell.city, DEEP);
});

test("minSellVolume omitted falls back to minVolume", () => {
  const r = evaluateFarmingCity(FARM_ITEM, DEEP, [THIN, DEEP], [THIN, DEEP],
    { minVolume: 25 }, farmDeps);
  assert.strictEqual(r.seedBuy.city, DEEP);
  assert.strictEqual(r.cropSell.city, DEEP);
});

// ── 3. render-journals: full journal SOLD, empty journal BOUGHT ────────────
console.log("priceJournalCandidate");
function journalSandbox() {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  sandbox.findBestBuyCity = legFinder("sell_price", true);
  sandbox.findBestSellCity = legFinder("buy_price", false);
  sandbox.calcJournalEconomics = ({ emptyCost, fullGross }) => ({
    fullNet: fullGross, marginPerJournal: fullGross - emptyCost,
    silverPerFame: 1, extraSilverPerHour: 0,
  });
  const ctx = vm.createContext(sandbox);
  vm.runInContext(
    J("render-journals.js") + "\n;globalThis.__exp = { priceJournalCandidate };",
    ctx, { filename: "render-journals.js" },
  );
  return sandbox.__exp;
}
const { priceJournalCandidate } = journalSandbox();
const JOURNAL_DATA = { FULL: TWO_CITY, EMPTY: TWO_CITY };
const CAND = { fullId: "FULL", emptyId: "EMPTY", maxfame: 1000 };

test("full sell gated at 25, empty buy ungated", () => {
  const p = priceJournalCandidate(JOURNAL_DATA, CAND, [THIN, DEEP], [THIN, DEEP], 25, null, null, 0);
  assert.strictEqual(p.fullCity, DEEP);
  assert.strictEqual(p.emptyCity, THIN);
});

test("full sell ungated, empty buy gated at 25", () => {
  const p = priceJournalCandidate(JOURNAL_DATA, CAND, [THIN, DEEP], [THIN, DEEP], 0, null, null, 25);
  assert.strictEqual(p.fullCity, THIN);
  assert.strictEqual(p.emptyCity, DEEP);
});

test("minVolBuy omitted falls back to minVol", () => {
  const p = priceJournalCandidate(JOURNAL_DATA, CAND, [THIN, DEEP], [THIN, DEEP], 25, null, null);
  assert.strictEqual(p.fullCity, DEEP);
  assert.strictEqual(p.emptyCity, DEEP);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
