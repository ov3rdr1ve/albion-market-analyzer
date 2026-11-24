/**
 * Test: the Building Costs "Best Journal" verdict equals the Laborers table's.
 *
 * Both columns answer the same question — which journal tier is most profitable
 * to feed this laborer — off the same lastMarketData. They were reported as
 * disagreeing (T7 in one table, T8 in the other), so this pins them together:
 * one synthetic market, every laborer, every tier, both code paths.
 *
 * Run: node tests/buildings-journal-parity.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

function loadFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

// No `document` here on purpose: the laborer-selector IIFE bails without one,
// which is what lets this test load the renderer for its pricing helpers alone.
const sandbox = `
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SETUP_FEE = 0.025;
const PREMIUM_TAX = 0.065;

function isBlackRedZoneEnabled() { return false; }
function getOrderType() { return "instant"; }
function getOverridePrice() { return null; }
function getOverrideVolume() { return null; }
function getCityForce() { return null; }
function getIQRBounds() { return { upper: Infinity }; }
function formatSilver(n) { return Math.round(n).toLocaleString(); }
function legBrecilienCost() { return 0; }
function applyGlobalDiscount(s) { return s; }
function getItemDisplayName(id) { return id; }
function tx(en) { return en; }
function getRowKey() { return ""; }
function matPriceSpan() { return ""; }
function renderTableData() {}

function getBuyPrice(itemData, city, bounds, itemId) {
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].sell_price || itemData[city].buy_price || 0;
}
function getSellPrice(itemData, city, bounds, itemId) {
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].buy_price || itemData[city].sell_price || 0;
}
function findBestBuyCity(marketData, itemId, cities) {
  let bestCity = null, bestPrice = 0;
  for (const c of cities) {
    const p = getBuyPrice(marketData[itemId], c, null, itemId);
    if (p <= 0) continue;
    if (!bestCity || p < bestPrice) { bestCity = c; bestPrice = p; }
  }
  return { city: bestCity, price: bestPrice, travelCost: 0 };
}
`;

const mod = new Module("buildings-journal-parity-test");
mod._compile(
  sandbox +
    loadFile("js/data-gathering.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/gather-fame-rates.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/data-journals.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/journal-fill-speed.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/data-laborers.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/laborers-pricing.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/render-laborers.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/data-buildings.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/buildings-upgrade-path.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/buildings-furnishing.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/laborer-journal-value.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/laborer-self-fill.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/render-buildings.js").replace(/if \(typeof module[\s\S]*$/, "") +
    "\nmodule.exports = { LABORERS, LABORER_TIERS, LABORER_MODE, getLaborersItemIds, " +
    "buildLaborersRowData, _bldBestJournalByTier };",
  "buildings-journal-parity.js",
);
const {
  LABORERS, LABORER_TIERS, LABORER_MODE, buildLaborersRowData, getLaborersItemIds,
  _bldBestJournalByTier,
} = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// Deterministic pseudo-market over every id the Laborers scan pulls, so routes
// form for every laborer and the lower-tier-journal play wins on some rows and
// loses on others. Prices vary per city so the route picker has a real choice.
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}
function syntheticMarket() {
  const md = {};
  const cities = ["Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Brecilien"];
  getLaborersItemIds().forEach((id) => {
    md[id] = {};
    cities.forEach((c) => {
      const price = 40 + (hash(id + c) % 9000);
      md[id][c] = { buy_price: price, sell_price: Math.round(price * 1.15), volume_24h: 9999 };
    });
  });
  return md;
}
const MD = syntheticMarket();

// The Laborers table's verdict for one laborer+tier: its best row for that
// laborer (the table gives each mode its own row, and the Buildings column keeps
// the most profitable of them).
function laborersVerdict(rows, laborer, tier) {
  const mine = rows.filter((r) => r.laborerName === laborer.name && r.tier === tier && r.bestJournal);
  if (mine.length === 0) return null;
  return mine.reduce((a, b) => (b.bestJournal.profit > a.bestJournal.profit ? b : a)).bestJournal;
}

console.log("\n=== Best Journal parity, every laborer × tier ===");

const ROWS = buildLaborersRowData(MD);

LABORERS.forEach((laborer) => {
  test(`${laborer.name}: the two tables name the same journal`, () => {
    const byTier = _bldBestJournalByTier(MD, laborer.slug);
    LABORER_TIERS.forEach((tier) => {
      const mine = byTier[tier] || null;
      const theirs = laborersVerdict(ROWS, laborer, tier);
      if (!theirs) {
        assert.strictEqual(mine, null, `T${tier}: Buildings claims a verdict the Laborers table has not got`);
        return;
      }
      assert.ok(mine, `T${tier}: Buildings has no verdict but the Laborers table does`);
      assert.strictEqual(mine.journalTier, theirs.journalTier, `T${tier}: journal tier`);
      assert.strictEqual(mine.yield, theirs.yield, `T${tier}: yield`);
      assert.ok(Math.abs(mine.profit - theirs.profit) < 0.01, `T${tier}: profit`);
    });
  });
});

console.log("\n=== The verdict carries who it is about ===");

test("every verdict names its laborer", () => {
  LABORERS.forEach((laborer) => {
    const byTier = _bldBestJournalByTier(MD, laborer.slug);
    LABORER_TIERS.forEach((tier) => {
      if (!byTier[tier]) return;
      assert.strictEqual(byTier[tier].laborerName, laborer.name,
        `${laborer.slug} T${tier} verdict must name the laborer it is about`);
    });
  });
});

test("an unknown laborer slug yields nothing rather than throwing", () => {
  assert.deepStrictEqual(_bldBestJournalByTier(MD, "NOT_A_LABORER"), {});
  assert.deepStrictEqual(_bldBestJournalByTier(MD, ""), {});
});

console.log("\n=== The self-fill verdict is the same in both tables too ===");

// The Fill Speed / Max Profit column is built in two places (render-laborers.js
// per row, render-buildings.js on the journal verdict). Pin them together for
// the same reason the Best Journal column above is pinned.
function laborersSelfFill(rows, laborer, tier) {
  const mine = rows.filter((r) => r.laborerName === laborer.name && r.tier === tier && r.bestJournal);
  if (mine.length === 0) return null;
  return mine.reduce((a, b) => (b.bestJournal.profit > a.bestJournal.profit ? b : a)).selfFill || null;
}

LABORERS.forEach((laborer) => {
  test(`${laborer.name}: the two tables agree on the self-fill play`, () => {
    const byTier = _bldBestJournalByTier(MD, laborer.slug);
    LABORER_TIERS.forEach((tier) => {
      const theirs = laborersSelfFill(ROWS, laborer, tier);
      const mine = byTier[tier] ? byTier[tier].selfFill : null;
      if (!theirs) { assert.ok(!mine || !mine.found, `T${tier}: Buildings invented a play`); return; }
      assert.ok(mine, `T${tier}: Buildings has no self-fill where the Laborers table does`);
      assert.strictEqual(mine.found, theirs.found, `T${tier}: found`);
      if (!theirs.found) {
        assert.strictEqual(mine.reason, theirs.reason, `T${tier}: reason`);
        return;
      }
      assert.strictEqual(mine.journalTier, theirs.journalTier, `T${tier}: journal tier`);
      assert.ok(Math.abs(mine.hours - theirs.hours) < 1e-9, `T${tier}: hours`);
      assert.ok(Math.abs(mine.silverPerHour - theirs.silverPerHour) < 0.01, `T${tier}: silver/hour`);
    });
  });
});

test("the six gathering laborers really do get a self-fill play here", () => {
  const gatherers = LABORERS.filter((l) => l.modes.includes(LABORER_MODE.RESOURCE));
  assert.strictEqual(gatherers.length, 6);
  gatherers.forEach((l) => {
    const sf = laborersSelfFill(ROWS, l, 8);
    assert.ok(sf && sf.found, `${l.name}: no self-fill play — parity would prove nothing`);
  });
});

test("a lower-tier journal wins somewhere in this market (the fixture is not trivial)", () => {
  const anyLower = LABORERS.some((l) => {
    const byTier = _bldBestJournalByTier(MD, l.slug);
    return LABORER_TIERS.some((t) => byTier[t] && byTier[t].journalTier < t);
  });
  assert.ok(anyLower, "no row prefers a lower-tier journal — parity would prove little");
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
