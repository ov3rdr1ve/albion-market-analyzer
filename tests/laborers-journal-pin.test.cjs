/**
 * Test: a pinned filled-journal buy price holds the Laborers row on its OWN tier.
 *
 * The row's price cells and Profit / Cycle normally describe the BEST journal
 * play, which may be a lower-tier journal. That made a hand-typed price look
 * like it was ignored: raising the T8 journal's price made T8 lose, so the row
 * re-rendered showing the T7 journal's market price instead of the number the
 * user had just typed — and left the pinned journal with no cell to correct or
 * clear it from.
 *
 * Rule under test: when the row's own-tier filled journal carries an
 * override-backed buy pin (what the price editor writes), the row displays and
 * prices THAT journal. `bestJournal` (the Best Journal Play column) keeps
 * reporting the unconstrained winner.
 *
 * Run: node tests/laborers-journal-pin.test.cjs
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

let testOverrides = {};
let testCityForce = {};
function isBlackRedZoneEnabled() { return false; }
function getOrderType() { return "instant"; }
function getOverridePrice(itemId, city) { return testOverrides[itemId + ":" + city] ?? null; }
function getOverrideVolume() { return null; }
function getCityForce(itemId, side) { return testCityForce[itemId]?.[side] ?? null; }
function getIQRBounds() { return { upper: Infinity }; }
function formatSilver(n) { return Math.round(n).toLocaleString(); }
function getBuyPrice(itemData, city, bounds, itemId) {
  const ov = itemId ? getOverridePrice(itemId, city) : null;
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].sell_price || itemData[city].buy_price || 0;
}
function getSellPrice(itemData, city, bounds, itemId) {
  const ov = itemId ? getOverridePrice(itemId, city) : null;
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].buy_price || itemData[city].sell_price || 0;
}
function legBrecilienCost() { return 0; }
function findBestBuyCity(marketData, itemId, cities, minVolume, destCity) {
  const itemData = marketData[itemId];
  const forced = getCityForce(itemId, "buy");
  if (forced && cities.includes(forced)) {
    const p = getBuyPrice(itemData, forced, null, itemId);
    return { city: forced, price: p > 0 ? p : 0, travelCost: 0 };
  }
  if (!itemData) return { city: null, price: 0, travelCost: 0 };
  let bestPrice = Infinity, bestCity = null;
  for (const c of cities) {
    const p = getBuyPrice(itemData, c, null, itemId);
    if (p <= 0) continue;
    if (p < bestPrice) { bestPrice = p; bestCity = c; }
  }
  return { city: bestCity, price: bestCity ? bestPrice : 0, travelCost: 0 };
}
function __setOverride(itemId, city, price) { testOverrides[itemId + ":" + city] = price; }
function __setCityForce(itemId, side, city) {
  if (!testCityForce[itemId]) testCityForce[itemId] = {};
  testCityForce[itemId][side] = city;
}
function __reset() { testOverrides = {}; testCityForce = {}; }
`;

const load = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

const mod = new Module("laborers-journal-pin-test");
mod._compile(
  sandbox +
    load("js/data-laborers.js") +
    load("js/laborers-pricing.js") +
    load("js/render-laborers.js") +
    "\nmodule.exports = { buildLaborersRowData, LABORER_MODE, _ownTierJournalPinned, " +
    "__setOverride, __setCityForce, __reset };",
  "laborers-journal-pin.js",
);

const {
  buildLaborersRowData, LABORER_MODE, _ownTierJournalPinned,
  __setOverride, __setCityForce, __reset,
} = mod.exports;

const CITY = "Lymhurst";
const LABORER = "Gamekeeper";               // HIDE resource laborer, all 7 tiers

let passed = 0, failed = 0;
function test(name, fn) {
  try { __reset(); fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// Journals get cheaper the lower the tier, loot gets cheaper too — the usual
// shape that makes a lower-tier journal (150% yield) beat the own-tier one.
function market() {
  const out = {};
  const put = (id, price) => {
    out[id] = { [CITY]: { buy_price: price, sell_price: price, volume_24h: 9999 } };
  };
  for (let t = 2; t <= 8; t++) {
    put(`T${t}_JOURNAL_HIDE_FULL`, 1000 * t);
    put(`T${t}_JOURNAL_HIDE_EMPTY`, 100 * t);
    put(`T${t}_HIDE`, 200 * t);
  }
  return out;
}

function hideRows(md) {
  return buildLaborersRowData(md)
    .filter((r) => r.item.name.includes(LABORER) && r.mode === LABORER_MODE.RESOURCE);
}

function rowForTier(md, tier) {
  return hideRows(md).find((r) => r.tier === tier);
}

// Pin exactly what the price editor writes: an override plus the city force.
function pinBuy(itemId, city, price) {
  __setOverride(itemId, city, price);
  __setCityForce(itemId, "buy", city);
}

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== Unpinned rows keep picking the best journal ===");

test("T8 row shows its own T8 journal when nothing is pinned", () => {
  const r = rowForTier(market(), 8);
  assert.strictEqual(r.filledId, "T8_JOURNAL_HIDE_FULL");
  assert.strictEqual(r.buy.price, 8000);
  assert.strictEqual(r.journalPinned, false);
});

test("Mid-tier rows still display the cheaper lower-tier journal", () => {
  const rows = hideRows(market());
  const r5 = rows.find((r) => r.tier === 5);
  assert.notStrictEqual(r5.filledId, "T5_JOURNAL_HIDE_FULL");
  assert.strictEqual(r5.bestJournal.journalTier < 5, true);
  assert.strictEqual(r5.journalPinned, false);
});

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== A pinned own-tier journal price holds the row ===");

[
  { label: "price raised far above market (own tier now loses)", price: 55555 },
  { label: "price lowered below market", price: 500 },
].forEach(({ label, price }) => {
  test(`T8 row keeps its own journal and the typed price — ${label}`, () => {
    pinBuy("T8_JOURNAL_HIDE_FULL", CITY, price);
    const r = rowForTier(market(), 8);
    assert.strictEqual(r.filledId, "T8_JOURNAL_HIDE_FULL", "cell must price the pinned journal");
    assert.strictEqual(r.buy.price, price, "cell must show the typed price");
    assert.strictEqual(r.buy.city, CITY);
  });
});

test("Pinned row's profit is computed from the pinned price", () => {
  pinBuy("T8_JOURNAL_HIDE_FULL", CITY, 5000000);
  const r = rowForTier(market(), 8);
  const expectedCost = 5000000 * 1.025;
  assert.ok(Math.abs(r.totalInputCost - expectedCost) < 0.01,
    `expected input cost ~${expectedCost}, got ${r.totalInputCost}`);
  assert.ok(r.marginInfo.profit < 0, "an absurd journal price must show a loss, not a swapped-in cheaper play");
});

test("Best Journal Play column still reports the unconstrained cheaper tier", () => {
  pinBuy("T8_JOURNAL_HIDE_FULL", CITY, 55555);
  const r = rowForTier(market(), 8);
  assert.strictEqual(r.journalPinned, true);
  assert.ok(r.bestJournal.journalTier < 8, "best journal must still scan lower tiers");
  assert.ok(r.bestJournal.profit > r.marginInfo.profit,
    "the unconstrained play must remain visible as the better one");
});

test("Pinning one tier does not hold any other tier's row", () => {
  pinBuy("T8_JOURNAL_HIDE_FULL", CITY, 55555);
  const rows = hideRows(market());
  rows.filter((r) => r.tier !== 8).forEach((r) => {
    assert.strictEqual(r.journalPinned, false, `T${r.tier} must stay unpinned`);
  });
});

test("Every tier becomes hand-pricable: pinning T5 puts the T5 journal back in its row", () => {
  pinBuy("T5_JOURNAL_HIDE_FULL", CITY, 4321);
  const r = rowForTier(market(), 5);
  assert.strictEqual(r.filledId, "T5_JOURNAL_HIDE_FULL");
  assert.strictEqual(r.buy.price, 4321);
});

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== What must NOT pin the row ===");

test("City force with no override behind it is inert", () => {
  __setCityForce("T8_JOURNAL_HIDE_FULL", "buy", CITY);   // e.g. left by a cleared override
  assert.strictEqual(_ownTierJournalPinned({ filledId: "T8_JOURNAL_HIDE_FULL" }), false);
  const r = rowForTier(market(), 8);
  assert.strictEqual(r.journalPinned, false);
});

test("An override with no force does not pin (import path, no user click)", () => {
  __setOverride("T8_JOURNAL_HIDE_FULL", CITY, 55555);
  assert.strictEqual(_ownTierJournalPinned({ filledId: "T8_JOURNAL_HIDE_FULL" }), false);
});

test("A sell-side pin on the EMPTY journal never holds the row", () => {
  __setOverride("T8_JOURNAL_HIDE_EMPTY", CITY, 70000);
  __setCityForce("T8_JOURNAL_HIDE_EMPTY", "sell", CITY);
  const r = rowForTier(market(), 8);
  assert.strictEqual(r.journalPinned, false);
});

test("Pin on a row with no payload data falls back to the best journal (no crash)", () => {
  pinBuy("T8_JOURNAL_HIDE_FULL", CITY, 55555);
  const md = market();
  delete md.T8_HIDE;                       // own-tier route can no longer be valued
  const r = rowForTier(md, 8);
  assert.ok(r, "row must still be produced");
  assert.strictEqual(r.journalPinned, false);
  assert.ok(r.bestJournal, "a lower-tier journal still carries the row");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
