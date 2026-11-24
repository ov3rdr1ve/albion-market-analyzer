/**
 * Test: the market price of a point of journal fame (js/journal-fame-price.js).
 *
 * Every self-fill play in this app spends fame it used to treat as free, on the
 * reasoning that you were gathering anyway. True of the ACTIVITY, not of the
 * FAME: a point of fame has exactly one alternative use — fill the journal and
 * SELL it full, which is the Journal Filling table's whole play — so the market
 * margin on that journal is the price tag on the fame that filled it.
 *
 *   pricePerFame = (full sell net of tax − empty buy) ÷ maxfame
 *
 * What this pins down:
 *   1. It is the Journal Filling table's own margin, per tier, from live prices
 *      — calcJournalEconomics does the tax, so the two can never disagree.
 *   2. A NEGATIVE margin is not a negative price. Nobody sells a journal at a
 *      loss, so the alternative use is worth nothing and the price floors at 0.
 *      A negative would PAY the self-fill play for a bad journal market.
 *   3. Either leg unpriced ⇒ 0 and hasData:false, so the caller can label its
 *      figure gross rather than blanking the row. The sell play buys an empty
 *      every cycle, so a full price with no empty price is not that play.
 *   4. The tiers really do price fame differently — the point of the whole
 *      exercise.
 *   5. Results are cached per marketData IDENTITY, so a fresh scan is never
 *      answered from a stale entry.
 *   6. getJournalFameBill serves BOTH readings at once, and says which one it
 *      ranked on. The self-fill loops charge the MARGIN — the alternative play
 *      sells the journal full and must re-buy an empty to keep cycling, so the
 *      empty is on the alternative's side of the ledger even though the
 *      self-fill loop itself never buys one. The whole full sell is kept as the
 *      pessimistic BOUND (liquidate the journal, never replace it), and is what
 *      the bill falls back to when no empty trades — a tier with no empty market
 *      must still be billed, or it competes gross against tiers billed in full.
 *
 * Black-box: synthetic market, no live API, no DOM.
 *
 * Run: node tests/journal-fame-price.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const loadSrc = (rel) =>
  fs.readFileSync(path.join(__dirname, "..", rel), "utf8").replace(/if \(typeof module[\s\S]*$/, "");

const CITIES = ["Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Brecilien"];

const sandbox = `
var renderPassSeq = 0;
globalThis.__setPass = (n) => { renderPassSeq = n; };
function getOrderType() { return "instant"; }
function _laborerCityCandidates() { return { cities: ${JSON.stringify(CITIES)} }; }
function findBestSellCity(marketData, itemId, cities) {
  let bestCity = null, bestPrice = 0;
  for (const c of cities) {
    const p = (marketData[itemId] && marketData[itemId][c] && marketData[itemId][c].sell) || 0;
    if (p <= 0) continue;
    if (!bestCity || p > bestPrice) { bestCity = c; bestPrice = p; }
  }
  return { city: bestCity, price: bestPrice };
}
function findBestBuyCity(marketData, itemId, cities) {
  let bestCity = null, bestPrice = 0;
  for (const c of cities) {
    const p = (marketData[itemId] && marketData[itemId][c] && marketData[itemId][c].buy) || 0;
    if (p <= 0) continue;
    if (!bestCity || p < bestPrice) { bestCity = c; bestPrice = p; }
  }
  return { city: bestCity, price: bestPrice };
}
`;

// The REAL economics, so the fame price can never drift from the Journal
// Filling table's margin.
const { calcJournalEconomics, PREMIUM_TAX } = require("../js/calculations.js");
global.calcJournalEconomics = calcJournalEconomics;

const mod = new Module("journal-fame-price-test");
mod._compile(
  sandbox + loadSrc("js/journal-fame-price.js") +
    "\nvar __deps = []; function recordPriceDependency() { __deps.push(...arguments); }" +
    "\nmodule.exports = { getJournalFamePrice, getJournalFameCost, getJournalFameBill, resetJournalFamePriceCache, takeDeps() { const d = __deps; __deps = []; return d; } };",
  "journal-fame-price.js",
);
const { getJournalFamePrice, getJournalFameCost, getJournalFameBill, resetJournalFamePriceCache, takeDeps } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// ── fixtures ───────────────────────────────────────────────────────────────
// One journal tier priced in one city, so the expected value is arithmetic a
// reader can check by hand.
function market(pairs) {
  const md = {};
  Object.entries(pairs).forEach(([id, { full, empty }]) => {
    md[id] = {};
    CITIES.forEach((c) => { md[id][c] = { sell: full || 0, buy: empty || 0 }; });
  });
  return md;
}
const ORE = (tier) => `T${tier}_JOURNAL_ORE`;
function oreMarket(tier, full, empty) {
  return market({ [`${ORE(tier)}_FULL`]: { full }, [`${ORE(tier)}_EMPTY`]: { empty } });
}

console.log("Journal fame price\n");

// ── 1. it is the Journal Filling table's own margin ────────────────────────
test("price per fame = (full net of tax − empty) ÷ maxfame", () => {
  const md = oreMarket(8, 30000, 3000);
  const r = getJournalFamePrice({ slug: "ORE", tier: 8, maxfame: 28800, marketData: md });
  const expected = (30000 * (1 - PREMIUM_TAX) - 3000) / 28800;
  assert.strictEqual(r.hasData, true);
  assert.ok(Math.abs(r.pricePerFame - expected) < 1e-12, `${r.pricePerFame} != ${expected}`);
  assert.ok(Math.abs(r.margin - (30000 * (1 - PREMIUM_TAX) - 3000)) < 1e-9);
  assert.strictEqual(r.fullGross, 30000);
  assert.strictEqual(r.emptyCost, 3000);
});

test("the sales tax is applied to the full sell, not skipped", () => {
  const md = oreMarket(8, 30000, 3000);
  const r = getJournalFamePrice({ slug: "ORE", tier: 8, maxfame: 28800, marketData: md });
  const untaxed = (30000 - 3000) / 28800;
  assert.ok(r.pricePerFame < untaxed, "an untaxed price would overcharge the fame");
});

test("the bill for one journal is price x its maxfame", () => {
  const md = oreMarket(8, 30000, 3000);
  const r = getJournalFamePrice({ slug: "ORE", tier: 8, maxfame: 28800, marketData: md });
  assert.ok(Math.abs(getJournalFameCost(r, 28800) - r.pricePerFame * 28800) < 1e-9);
  assert.strictEqual(getJournalFameCost(r, 0), 0, "no fame, no bill");
  assert.strictEqual(getJournalFameCost(null, 28800), 0);
});

// ── 2. a loss-making journal is worth nothing, never less ──────────────────
console.log("\n=== A negative margin is not a negative price ===");

const LOSS_CASES = [
  { name: "full sells for less than an empty costs", full: 1000, empty: 5000 },
  { name: "the tax alone turns the margin negative", full: 3000, empty: 2900 },
];
for (const c of LOSS_CASES) {
  test(`${c.name} — price floors at 0`, () => {
    const r = getJournalFamePrice({ slug: "ORE", tier: 8, maxfame: 28800, marketData: oreMarket(8, c.full, c.empty) });
    assert.strictEqual(r.hasData, true, "it IS priced — the margin is simply bad");
    assert.strictEqual(r.pricePerFame, 0, "a bad journal market must not PAY the self-fill play");
    assert.ok(r.margin < 0, "and the underlying margin is still reported as negative");
  });
}

// ── 3. unpriced degrades to 0, and says so ─────────────────────────────────
console.log("\n=== Unpriced is 0, and reports itself ===");

const NO_DATA_CASES = [
  { name: "nothing priced at all", md: () => ({}) },
  { name: "full priced, no empty to replace it", md: () => market({ [`${ORE(8)}_FULL`]: { full: 30000 } }) },
  { name: "empty priced, full unsellable", md: () => market({ [`${ORE(8)}_EMPTY`]: { empty: 3000 } }) },
];
for (const c of NO_DATA_CASES) {
  test(`${c.name} — hasData:false and a 0 price`, () => {
    const r = getJournalFamePrice({ slug: "ORE", tier: 8, maxfame: 28800, marketData: c.md() });
    assert.strictEqual(r.hasData, false);
    assert.strictEqual(r.pricePerFame, 0);
    assert.strictEqual(getJournalFameCost(r, 28800), 0);
  });
}

const BAD_ARGS = [
  { name: "no slug", args: { tier: 8, maxfame: 28800 } },
  { name: "no tier", args: { slug: "ORE", maxfame: 28800 } },
  { name: "no maxfame", args: { slug: "ORE", tier: 8 } },
  { name: "no market data", args: { slug: "ORE", tier: 8, maxfame: 28800 } },
];
for (const c of BAD_ARGS) {
  test(`${c.name} — returns a zeroed object rather than throwing`, () => {
    const r = getJournalFamePrice({ marketData: oreMarket(8, 30000, 3000), ...c.args, ...(c.name === "no market data" ? { marketData: null } : {}) });
    assert.strictEqual(r.pricePerFame, 0);
    assert.strictEqual(r.hasData, false);
  });
}

test("no arguments at all is still an object, not a crash", () => {
  const r = getJournalFamePrice();
  assert.strictEqual(r.pricePerFame, 0);
  assert.strictEqual(r.hasData, false);
});

// ── 4. the tiers price fame differently — the whole point ──────────────────
console.log("\n=== Different tiers, different fame prices ===");

test("the same journal margin over a bigger maxfame is a cheaper point of fame", () => {
  const t3 = getJournalFamePrice({ slug: "ORE", tier: 3, maxfame: 900, marketData: oreMarket(3, 5000, 500) });
  const t8 = getJournalFamePrice({ slug: "ORE", tier: 8, maxfame: 28800, marketData: oreMarket(8, 5000, 500) });
  assert.ok(t3.pricePerFame > t8.pricePerFame * 30,
    `a T3 point of fame should cost far more here: ${t3.pricePerFame} vs ${t8.pricePerFame}`);
});

test("each tier reads its OWN ids, so one tier's prices never leak into another", () => {
  const md = { ...oreMarket(8, 30000, 3000), ...oreMarket(3, 1100, 180) };
  const t8 = getJournalFamePrice({ slug: "ORE", tier: 8, maxfame: 28800, marketData: md });
  const t3 = getJournalFamePrice({ slug: "ORE", tier: 3, maxfame: 900, marketData: md });
  assert.strictEqual(t8.fullGross, 30000);
  assert.strictEqual(t3.fullGross, 1100);
});

test("a crafting journal slug prices the same way — the ids are the only difference", () => {
  const md = market({ T8_JOURNAL_WARRIOR_FULL: { full: 40000 }, T8_JOURNAL_WARRIOR_EMPTY: { empty: 4000 } });
  const r = getJournalFamePrice({ slug: "WARRIOR", tier: 8, maxfame: 58590, marketData: md });
  assert.strictEqual(r.hasData, true);
  assert.ok(Math.abs(r.pricePerFame - (40000 * (1 - PREMIUM_TAX) - 4000) / 58590) < 1e-12);
});

// ── 5. caching is per market snapshot ──────────────────────────────────────
console.log("\n=== The cache never outlives its market data ===");

test("repeated calls on one market are identical", () => {
  const md = oreMarket(8, 30000, 3000);
  const a = getJournalFamePrice({ slug: "ORE", tier: 8, maxfame: 28800, marketData: md });
  const b = getJournalFamePrice({ slug: "ORE", tier: 8, maxfame: 28800, marketData: md });
  assert.deepStrictEqual(a, b);
});

test("a NEW market object is priced afresh, not served from the cache", () => {
  const before = getJournalFamePrice({ slug: "ORE", tier: 8, maxfame: 28800, marketData: oreMarket(8, 30000, 3000) });
  const after = getJournalFamePrice({ slug: "ORE", tier: 8, maxfame: 28800, marketData: oreMarket(8, 60000, 3000) });
  assert.ok(after.pricePerFame > before.pricePerFame * 1.5,
    `a rescan must move the price: ${before.pricePerFame} then ${after.pricePerFame}`);
});

// The app's price map is ONE object mutated in place: a sniffer capture, a
// price override and an order-type toggle all move journal prices without a new
// object. Keyed on identity alone, the cache answered every later render with
// the first price it saw. Each render pass now starts from an empty cache.
test("the same market object mutated in place is re-priced after a cache reset", () => {
  const md = oreMarket(8, 30000, 3000);
  const before = getJournalFamePrice({ slug: "ORE", tier: 8, maxfame: 28800, marketData: md });
  CITIES.forEach((c) => { md[`${ORE(8)}_FULL`][c].sell = 60000; });
  const cached = getJournalFamePrice({ slug: "ORE", tier: 8, maxfame: 28800, marketData: md });
  assert.deepStrictEqual(cached, before, "inside one pass the cache still answers");
  resetJournalFamePriceCache();
  const after = getJournalFamePrice({ slug: "ORE", tier: 8, maxfame: 28800, marketData: md });
  assert.ok(after.pricePerFame > before.pricePerFame * 1.5,
    `a reset must re-read the mutated map: ${before.pricePerFame} then ${after.pricePerFame}`);
});

// The Crafting Planner recomputes only the rows whose prices moved, so a row
// has to learn which journal ids it read — on a cache hit as much as a miss.
[
  ["a cache miss", false],
  ["a cache hit", true],
].forEach(([label, warm]) => {
  test(`${label} still reports the journal ids it priced`, () => {
    resetJournalFamePriceCache();
    const md = oreMarket(7, 20000, 2000);
    if (warm) getJournalFamePrice({ slug: "ORE", tier: 7, maxfame: 14400, marketData: md });
    takeDeps();
    getJournalFamePrice({ slug: "ORE", tier: 7, maxfame: 14400, marketData: md });
    const deps = takeDeps();
    assert.ok(deps.includes("T7_JOURNAL_ORE_FULL") && deps.includes("T7_JOURNAL_ORE_EMPTY"), `deps ${deps}`);
  });
});

test("a new render pass re-reads a market mutated in place", () => {
  const md = oreMarket(6, 10000, 1000);
  globalThis.__setPass(1);
  const before = getJournalFamePrice({ slug: "ORE", tier: 6, maxfame: 7200, marketData: md });
  CITIES.forEach((c) => { md[`${ORE(6)}_FULL`][c].sell = 30000; });
  const same = getJournalFamePrice({ slug: "ORE", tier: 6, maxfame: 7200, marketData: md });
  assert.deepStrictEqual(same, before, "one pass, one answer");
  globalThis.__setPass(2);
  const after = getJournalFamePrice({ slug: "ORE", tier: 6, maxfame: 7200, marketData: md });
  assert.ok(after.pricePerFame > before.pricePerFame * 2, `${before.pricePerFame} then ${after.pricePerFame}`);
});

// ── 6. the bill: both readings, and which one is ranked ────────────────────
console.log("\n=== The fame bill serves both readings ===");

const MARGIN = (full, empty) => full * (1 - PREMIUM_TAX) - empty;
const FULLNET = (full) => full * (1 - PREMIUM_TAX);

test("both legs priced — the RANKED bill is the margin, the bound is the full sell", () => {
  const md = oreMarket(8, 30000, 3000);
  const b = getJournalFameBill({ slug: "ORE", tier: 8, maxfame: 28800, marketData: md });
  assert.strictEqual(b.hasData, true);
  assert.strictEqual(b.basis, "margin");
  assert.ok(Math.abs(b.cost - MARGIN(30000, 3000)) < 1e-9, `ranked bill ${b.cost}`);
  assert.ok(Math.abs(b.margin.cost - MARGIN(30000, 3000)) < 1e-9);
  assert.ok(Math.abs(b.full.cost - FULLNET(30000)) < 1e-9, `bound ${b.full.cost}`);
  assert.ok(Math.abs(b.pricePerFame * 28800 - b.cost) < 1e-9, "price x fame must be the bill");
});

test("the bound is never cheaper than the ranked bill — the empty is worth >= 0", () => {
  const CASES = [
    { full: 30000, empty: 3000 },
    { full: 30000, empty: 0 },
    { full: 5000, empty: 4900 },
    { full: 1000, empty: 5000 },
  ];
  for (const c of CASES) {
    const b = getJournalFameBill({ slug: "ORE", tier: 8, maxfame: 28800, marketData: oreMarket(8, c.full, c.empty) });
    assert.ok(b.full.cost >= b.cost - 1e-9,
      `full ${c.full} / empty ${c.empty}: bound ${b.full.cost} < ranked ${b.cost}`);
  }
});

// A full sale you cannot repeat is not the alternative play: selling the journal
// consumes it, and with no empty on the market there is nothing to buy to run
// that play again. So there is no margin, and therefore no bill — the whole sale
// is reported as the liquidation bound and nothing more. Charging it as the bill
// (what this did until 2026-08-04) invented a cost roughly twice the real margin
// on exactly the thinnest markets on the board — fisherman empties above all —
// which is how a self-fill play that buys nothing came to print a loss.
test("no empty market — no margin, so no bill; the full sale is only the bound", () => {
  const md = market({ [`${ORE(8)}_FULL`]: { full: 30000 } });
  const b = getJournalFameBill({ slug: "ORE", tier: 8, maxfame: 28800, marketData: md });
  assert.strictEqual(b.hasData, false, "no empty listing → no comparison to make");
  assert.strictEqual(b.basis, "full", "…and the basis says which leg was missing");
  assert.strictEqual(b.cost, 0, "nothing is billed");
  assert.strictEqual(b.pricePerFame, 0);
  assert.ok(Math.abs(b.full.cost - FULLNET(30000)) < 1e-9, "the liquidation bound is still reported");
  assert.strictEqual(b.margin.hasData, false, "the margin reading has no data to stand on");
});

// The self-fill loops ask per city, because the payload they compare it against
// is earned in one. Asked across the whole list, findBestSellCity/findBestBuyCity
// take the dearest full and the cheapest empty from two DIFFERENT cities with no
// haul between them — a free arbitrage subtracted from single-city revenue.
test("a one-city bill is that city's own margin, not the cross-city best", () => {
  const md = market({});
  const FULL = `${ORE(8)}_FULL`, EMPTY = `${ORE(8)}_EMPTY`;
  md[FULL] = { Lymhurst: { sell: 30000, buy: 0 }, Martlock: { sell: 12000, buy: 0 } };
  md[EMPTY] = { Lymhurst: { sell: 0, buy: 9000 }, Martlock: { sell: 0, buy: 1000 } };

  const all = getJournalFameBill({ slug: "ORE", tier: 8, maxfame: 28800, marketData: md });
  // Best sell is Lymhurst's 30,000, cheapest empty is Martlock's 1,000 — a margin
  // neither city can actually offer.
  assert.ok(Math.abs(all.cost - MARGIN(30000, 1000)) < 1e-9, `cross-city ${all.cost}`);

  const lym = getJournalFameBill({ slug: "ORE", tier: 8, maxfame: 28800, marketData: md, cities: ["Lymhurst"] });
  assert.ok(Math.abs(lym.cost - MARGIN(30000, 9000)) < 1e-9, `Lymhurst ${lym.cost}`);
  const mar = getJournalFameBill({ slug: "ORE", tier: 8, maxfame: 28800, marketData: md, cities: ["Martlock"] });
  assert.ok(Math.abs(mar.cost - MARGIN(12000, 1000)) < 1e-9, `Martlock ${mar.cost}`);

  // Every real city's margin is at or below the fabricated cross-city one.
  assert.ok(lym.cost <= all.cost + 1e-9 && mar.cost <= all.cost + 1e-9,
    "the cross-city reading is an upper bound no single city can match");
});

test("the per-marketData cache keys on the city list, so one city is never served the all-cities answer", () => {
  const md = market({});
  const FULL = `${ORE(7)}_FULL`, EMPTY = `${ORE(7)}_EMPTY`;
  md[FULL] = { Lymhurst: { sell: 20000, buy: 0 }, Martlock: { sell: 8000, buy: 0 } };
  md[EMPTY] = { Lymhurst: { sell: 0, buy: 6000 }, Martlock: { sell: 0, buy: 500 } };
  const args = { slug: "ORE", tier: 7, maxfame: 14400, marketData: md };
  // Warm the all-cities entry FIRST — the order that would poison a key without
  // the city in it.
  const all = getJournalFameBill(args).cost;
  const mar = getJournalFameBill({ ...args, cities: ["Martlock"] }).cost;
  const lym = getJournalFameBill({ ...args, cities: ["Lymhurst"] }).cost;
  assert.ok(Math.abs(mar - MARGIN(8000, 500)) < 1e-9, `Martlock ${mar} (all-cities was ${all})`);
  assert.ok(Math.abs(lym - MARGIN(20000, 6000)) < 1e-9, `Lymhurst ${lym}`);
  assert.notStrictEqual(mar, lym);
});

test("no full sell — nothing to charge the fame at, basis 'none'", () => {
  const md = market({ [`${ORE(8)}_EMPTY`]: { empty: 3000 } });
  const b = getJournalFameBill({ slug: "ORE", tier: 8, maxfame: 28800, marketData: md });
  assert.strictEqual(b.hasData, false);
  assert.strictEqual(b.basis, "none");
  assert.strictEqual(b.cost, 0);
  assert.strictEqual(b.full.cost, 0);
});

test("a loss-making journal bills 0 on the margin, never a negative", () => {
  const b = getJournalFameBill({ slug: "ORE", tier: 8, maxfame: 28800, marketData: oreMarket(8, 1000, 5000) });
  assert.strictEqual(b.basis, "margin", "both legs price — the margin is simply bad");
  assert.strictEqual(b.cost, 0, "a bad journal market must not PAY the self-fill play");
  assert.ok(b.full.cost > 0, "the pessimistic bound still charges the full sale");
});

test("a dearer EMPTY journal lowers the ranked bill but never the bound", () => {
  const cheap = getJournalFameBill({ slug: "ORE", tier: 8, maxfame: 28800, marketData: oreMarket(8, 30000, 1000) });
  const dear = getJournalFameBill({ slug: "ORE", tier: 8, maxfame: 28800, marketData: oreMarket(8, 30000, 9000) });
  assert.ok(dear.cost < cheap.cost, "the empty you must re-buy is part of the alternative play's cost");
  assert.ok(Math.abs(dear.full.cost - cheap.full.cost) < 1e-9, "the bound liquidates, so it never buys an empty");
});

test("the cities and the underlying prices are reported for the tooltip", () => {
  const md = oreMarket(8, 30000, 3000);
  const b = getJournalFameBill({ slug: "ORE", tier: 8, maxfame: 28800, marketData: md, cities: CITIES });
  assert.strictEqual(b.fullGross, 30000);
  assert.strictEqual(b.emptyCost, 3000);
  assert.ok(CITIES.includes(b.fullCity));
  assert.ok(CITIES.includes(b.emptyCity));
});

const BILL_BAD_ARGS = [
  { name: "no slug", args: { tier: 8, maxfame: 28800 } },
  { name: "no maxfame", args: { slug: "ORE", tier: 8 } },
  { name: "no market data", args: { slug: "ORE", tier: 8, maxfame: 28800, marketData: null } },
];
for (const c of BILL_BAD_ARGS) {
  test(`bill — ${c.name} returns a zeroed object rather than throwing`, () => {
    const b = getJournalFameBill({ marketData: oreMarket(8, 30000, 3000), ...c.args });
    assert.strictEqual(b.hasData, false);
    assert.strictEqual(b.basis, "none");
    assert.strictEqual(b.cost, 0);
  });
}

test("bill — no arguments at all is still an object, not a crash", () => {
  const b = getJournalFameBill();
  assert.strictEqual(b.hasData, false);
  assert.strictEqual(b.cost, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
