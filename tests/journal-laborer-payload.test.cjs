/**
 * Test: the "Feed a Laborer" column (js/journal-laborer-payload.js).
 *
 * The Gathering and Journal Filling tables price ONE play — fill a journal, sell
 * it full. A filled journal has a second buyer: your own laborer, who 22h later
 * returns a payload AND the same journal, empty. This module prices that play so
 * the two sit side by side on the row where the decision is made.
 *
 * The loop it answers, in the user's words: fill journals yourself with a T8
 * fisherman, hand them to laborers you have plenty of, collect the returns.
 * Laborers are not the constraint — YOUR gathering hours are — so the column
 * ranks on silver per hour of gathering, and the ×N chip says how many laborers
 * that rate would need to keep fed.
 *
 * The claims pinned here:
 *   1. The payload comes from the SAME model the Laborers table uses
 *      (laborerSelfFillPayout / _computeRevenueForMode). A second copy of the
 *      yield or loot model in a renderer is how the two tables would drift.
 *   2. The laborer is the best one that helps, capped at T8 — so any journal
 *      below T8 earns the 150% tier-advantage yield and a T8 journal the
 *      same-tier 1.175.
 *   3. The comparison is against the journal's MARGIN — full sell net of tax,
 *      less the empty the SELLING play must re-buy to fill and sell another.
 *      This loop never buys an empty (the laborer hands one back); the play it
 *      is measured against does, so the empty sits on that side. The whole sale
 *      is reported as `advantageFull`, the pessimistic bound.
 *   4. Coverage — every journal family a gathering fame can fill resolves to a
 *      laborer spec; the mercenary pair and the crafting journals do not.
 *   5. Degradation — an unpriced payload reports hasData:false, and a journal
 *      with no FULL price still reports its payload with sellPriced:false rather
 *      than blanking the row or inventing a comparison.
 *   6. The rate is payload ÷ fill hours and is GROSS. The sell-it-full rate sits
 *      beside it in the same unit (the Fill Speed column, margin ÷ the same
 *      hours), so the comparison is on screen rather than netted into one
 *      number. Capacity is reported, never folded into the rate — that would
 *      switch the denominator from your hours to laborer-hours.
 *
 * Black-box: one synthetic market, no live API, no DOM.
 *
 * Run: node tests/journal-laborer-payload.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

function loadFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const store = new Map();

const sandbox = `
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
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
function tx(en) { return en; }

function getBuyPrice(itemData, city) {
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].sell_price || itemData[city].buy_price || 0;
}
function getSellPrice(itemData, city) {
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].buy_price || itemData[city].sell_price || 0;
}
function findBestBuyCity(marketData, itemId, cities) {
  let bestCity = null, bestPrice = 0;
  for (const c of cities) {
    const p = getBuyPrice(marketData[itemId], c);
    if (p <= 0) continue;
    if (!bestCity || p < bestPrice) { bestCity = c; bestPrice = p; }
  }
  return { city: bestCity, price: bestPrice, travelCost: 0 };
}
function findBestSellCity(marketData, itemId, cities) {
  let bestCity = null, bestPrice = 0;
  for (const c of cities) {
    const p = getSellPrice(marketData[itemId], c);
    if (p <= 0) continue;
    if (!bestCity || p > bestPrice) { bestCity = c; bestPrice = p; }
  }
  return { city: bestCity, price: bestPrice };
}
`;

// The REAL journal economics, so the sales tax this test asserts against can
// never drift from the Journal Filling table's own.
global.calcJournalEconomics = require("../js/calculations.js").calcJournalEconomics;

const mod = new Module("journal-laborer-payload-test");
mod._compile(
  sandbox +
    loadFile("js/data-gathering.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/gather-fame-rates.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/data-journals.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/journal-fill-speed.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/journal-fame-price.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/data-laborers.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/laborers-pricing.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/data-craft-planner.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/laborer-journal-value.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/laborer-self-fill.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/journal-laborer-payload.js").replace(/if \(typeof module[\s\S]*$/, "") +
    "\nmodule.exports = { LABORERS, TROPHY_LABORERS, LABORER_TIERS, LABORER_MODE, " +
    "getLaborersItemIds, getJournalPayloadScanIds, getLaborerJournalYield, " +
    "_computeRevenueForMode, getJournalMaxfame, getJournalFamePrice, getJournalFameBill, " +
    "JLP_LABORER_TIER, journalSlugToLaborerSpec, computeJournalLaborerPlay, " +
    "journalLaborerRate, journalLaborerTip, journalLaborerCell, " +
    "LABORER_CYCLE_HOURS, resolveJournalFill, laborerSlugToGatherType, " +
    "JOURNAL_SLUGS, JOURNAL_TIERS };",
  "journal-laborer-payload.js",
);

global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const {
  LABORER_MODE, getLaborersItemIds, getJournalPayloadScanIds,
  getLaborerJournalYield, _computeRevenueForMode, getJournalMaxfame, getJournalFamePrice, getJournalFameBill,
  JLP_LABORER_TIER, journalSlugToLaborerSpec, computeJournalLaborerPlay,
  journalLaborerRate, journalLaborerTip, journalLaborerCell,
  LABORER_CYCLE_HOURS, resolveJournalFill, laborerSlugToGatherType,
  JOURNAL_TIERS,
} = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}
const CITY = "Lymhurst";
const PREMIUM_TAX = 0.065;

// ── synthetic market ───────────────────────────────────────────────────────
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

// Every journal family a gathering fame can fill: the 6 resource journals and
// the 7 non-mercenary trophy lines.
const FILLABLE_SLUGS = ["ORE", "WOOD", "HIDE", "FIBER", "STONE", "FISHING",
  "TROPHY_ORE", "TROPHY_WOOD", "TROPHY_HIDE", "TROPHY_FIBER", "TROPHY_STONE",
  "TROPHY_FISHING", "TROPHY_GENERAL"];
const UNFILLABLE_SLUGS = ["TROPHY_MERCENARY", "MERCENARY", "WARRIOR", "HUNTER", "MAGE", "TOOLMAKER"];

// ── 1. coverage ────────────────────────────────────────────────────────────
console.log("\n=== Every journal a gathering fame fills resolves to a laborer ===");

for (const slug of FILLABLE_SLUGS) {
  test(`${slug} resolves to a laborer spec at every tier`, () => {
    JOURNAL_TIERS.forEach((tier) => {
      const spec = journalSlugToLaborerSpec(slug, tier);
      assert.ok(spec, `${slug} T${tier}: no spec`);
      assert.strictEqual(spec.tier, tier, `${slug} T${tier}: wrong tier`);
      assert.strictEqual(spec.journalSlug, slug, `${slug} T${tier}: wrong slug`);
    });
  });
}

for (const slug of UNFILLABLE_SLUGS) {
  test(`${slug} has no gathering-journal laborer play`, () => {
    JOURNAL_TIERS.forEach((tier) => {
      assert.strictEqual(journalSlugToLaborerSpec(slug, tier), null, `${slug} T${tier}`);
    });
  });
}

test("a missing slug or tier returns null rather than throwing", () => {
  [[null, 8], [undefined, 8], ["ORE", 0], ["ORE", null], ["NOPE", 8]].forEach(([s, t]) => {
    assert.strictEqual(journalSlugToLaborerSpec(s, t), null, `${s}/${t}`);
  });
});

test("every fillable journal produces a play on a priced market", () => {
  FILLABLE_SLUGS.forEach((slug) => {
    JOURNAL_TIERS.forEach((tier) => {
      const play = computeJournalLaborerPlay({ slug, tier, marketData: MD, city: CITY });
      assert.strictEqual(play.hasData, true, `${slug} T${tier}: no data`);
      assert.ok(play.payload > 0, `${slug} T${tier}: no payload`);
    });
  });
});

// ── 2. the payload is the Laborers table's own model ───────────────────────
console.log("\n=== The payload is the same model the Laborers table uses ===");

test("payload equals _computeRevenueForMode at the chosen city and yield", () => {
  FILLABLE_SLUGS.forEach((slug) => {
    JOURNAL_TIERS.forEach((tier) => {
      const play = computeJournalLaborerPlay({ slug, tier, marketData: MD, city: CITY });
      const spec = journalSlugToLaborerSpec(slug, tier);
      const direct = _computeRevenueForMode(
        { ...spec, tier, yield: getLaborerJournalYield(tier, play.laborerTier, slug) }, MD, play.city,
      );
      assert.ok(Math.abs(play.payload - direct.revenue) < 1e-6,
        `${slug} T${tier}: ${play.payload} != ${direct.revenue} at ${play.city}`);
    });
  });
});

test("the laborer is T8, and a journal below it runs at the 150% yield", () => {
  assert.strictEqual(JLP_LABORER_TIER, 8);
  FILLABLE_SLUGS.forEach((slug) => {
    JOURNAL_TIERS.forEach((tier) => {
      const play = computeJournalLaborerPlay({ slug, tier, marketData: MD, city: CITY });
      assert.strictEqual(play.laborerTier, 8, `${slug} T${tier}`);
      assert.strictEqual(play.yield, getLaborerJournalYield(tier, 8, slug), `${slug} T${tier}`);
      if (tier < 8) assert.strictEqual(play.yield, 1.5, `${slug} T${tier}: not the tier advantage`);
    });
  });
});

test("a T8 journal runs at whatever that laborer type's own trophies buy", () => {
  // No stored trophy happiness in this harness, so the max defaults apply. Every
  // fillable slug here is a gathering/mercenary line, which HAS a matching
  // trophy, so they reach the same 150% a lower-tier journal gets.
  FILLABLE_SLUGS.forEach((slug) => {
    const play = computeJournalLaborerPlay({ slug, tier: 8, marketData: MD, city: CITY });
    assert.strictEqual(play.yield, getLaborerJournalYield(8, 8, slug), slug);
  });
});

test("asking for a laborer below the journal's tier is floored at the journal's tier", () => {
  // A T3 laborer cannot hold a T7 journal at all; the column's job is the play's
  // ceiling, so it must not silently price an impossible pairing.
  const play = computeJournalLaborerPlay({ slug: "ORE", tier: 7, marketData: MD, city: CITY, laborerTier: 3 });
  assert.ok(play.laborerTier >= 7, `got T${play.laborerTier}`);
});

test("the play prices itself in the city that pays most", () => {
  const rich = "Bridgewatch";
  const md = syntheticMarket();
  // An absolute price, not a multiple: the synthetic bases span 40-9,040, so
  // ×10 on a cheap city can still lose to another city's expensive base.
  Object.keys(md).forEach((id) => {
    if (id.includes("_JOURNAL_")) return;
    md[id][rich] = { buy_price: 500000, sell_price: 575000, volume_24h: 9999 };
  });
  FILLABLE_SLUGS.forEach((slug) => {
    const play = computeJournalLaborerPlay({ slug, tier: 8, marketData: md, city: CITY });
    assert.strictEqual(play.city, rich, `${slug}: priced in ${play.city}`);
  });
});

test("the caller's city wins an exact tie, so the column does not wander", () => {
  const md = syntheticMarket();
  Object.keys(md).forEach((id) => {
    Object.keys(md[id]).forEach((c) => { md[id][c] = { buy_price: 500, sell_price: 575, volume_24h: 9999 }; });
  });
  FILLABLE_SLUGS.forEach((slug) => {
    const play = computeJournalLaborerPlay({ slug, tier: 8, marketData: md, city: CITY });
    assert.strictEqual(play.city, CITY, `${slug}: tie moved off ${CITY}`);
  });
});

// ── 3. the comparison: the journal's margin, with the full sale as the bound ─
console.log("\n=== The comparison is the journal's margin, bounded by the full sale ===");

// Both legs are quoted in the city the PAYLOAD is priced in. Across the whole
// list they would come from different cities with no haul between them — a free
// arbitrage compared against single-city revenue.
test("advantage is payload minus the MARGIN in the payload's city; the bound uses the whole sale", () => {
  FILLABLE_SLUGS.forEach((slug) => {
    JOURNAL_TIERS.forEach((tier) => {
      const play = computeJournalLaborerPlay({ slug, tier, marketData: MD, city: CITY });
      const bill = getJournalFameBill({
        slug, tier, maxfame: getJournalMaxfame(slug, tier), marketData: MD, cities: [play.city],
      });
      const price = getJournalFamePrice({
        slug, tier, maxfame: getJournalMaxfame(slug, tier), marketData: MD, cities: [play.city], emptyFree: true,
      });
      assert.ok(Math.abs(play.sellFull - price.fullNet) < 1e-6, `${slug} T${tier}: sell leg`);
      assert.strictEqual(play.fameBasis, bill.basis, `${slug} T${tier}: basis`);
      assert.ok(Math.abs(play.fameCost - bill.cost) < 1e-6, `${slug} T${tier}: ranked bill`);
      assert.ok(Math.abs(play.advantage - (play.payload - play.fameCost)) < 1e-6, `${slug} T${tier}: advantage`);
      assert.ok(Math.abs(play.advantageFull - (play.payload - play.sellFull)) < 1e-6, `${slug} T${tier}: bound`);
      assert.ok(play.advantageFull <= play.advantage + 1e-6, `${slug} T${tier}: bound above the ranked figure`);
    });
  });
});

// The empty journal is on the ALTERNATIVE play's side: selling this journal full
// means buying another empty to fill and sell again. This loop still never buys
// one. The BOUND liquidates instead, so nothing moves it.
test("a dearer EMPTY journal improves the ranked comparison and leaves the bound alone", () => {
  const dearEmpties = syntheticMarket();
  Object.keys(dearEmpties).forEach((id) => {
    if (!id.endsWith("_EMPTY")) return;
    Object.keys(dearEmpties[id]).forEach((c) => {
      dearEmpties[id][c] = { buy_price: 999999, sell_price: 999999, volume_24h: 9999 };
    });
  });
  FILLABLE_SLUGS.forEach((slug) => {
    const a = computeJournalLaborerPlay({ slug, tier: 8, marketData: MD, city: CITY });
    const b = computeJournalLaborerPlay({ slug, tier: 8, marketData: dearEmpties, city: CITY });
    assert.ok(b.advantage >= a.advantage - 1e-6,
      `${slug}: an unsellable alternative must not WORSEN the comparison (${a.advantage} -> ${b.advantage})`);
    assert.ok(Math.abs(b.advantage - b.payload) < 1e-6, `${slug}: a 0 bill leaves the payload standing alone`);
    assert.ok(Math.abs(a.advantageFull - b.advantageFull) < 1e-6,
      `${slug}: the bound liquidates, so the empty price must not touch it`);
  });
});

// A full sale you cannot repeat is not the alternative play: selling consumes
// the journal, and with no empty on the market there is nothing to buy to run it
// again. So there is no comparison — and the PAYLOAD, which buys nothing, still
// stands.
test("a journal with no EMPTY listing has no comparison, and still reports its payload", () => {
  const md = syntheticMarket();
  Object.keys(md).forEach((id) => { if (id.endsWith("_EMPTY")) delete md[id]; });
  FILLABLE_SLUGS.forEach((slug) => {
    const play = computeJournalLaborerPlay({ slug, tier: 8, marketData: md, city: CITY });
    assert.ok(play.payload > 0, `${slug}: the payload must still price`);
    assert.strictEqual(play.sellPriced, false, `${slug}: no empty listing → no margin to compare against`);
    assert.strictEqual(play.fameBasis, "full", `${slug}: should name which leg was missing`);
    assert.strictEqual(play.fameCost, 0, `${slug}: nothing is billed`);
    assert.strictEqual(play.advantage, play.payload, `${slug}: the comparison collapses to the payload`);
  });
});

test("the sell leg carries the 6.5% sales tax", () => {
  const play = computeJournalLaborerPlay({ slug: "ORE", tier: 8, marketData: MD, city: CITY });
  // In the payload's own city — the same city the comparison is drawn in.
  const gross = (MD["T8_JOURNAL_ORE_FULL"][play.city] || {}).buy_price || 0;
  assert.ok(Math.abs(play.sellFull - gross * (1 - PREMIUM_TAX)) < 1e-6,
    `${play.sellFull} != ${gross} net of tax`);
});

test("advantage goes NEGATIVE when the full journal outsells the payload", () => {
  const md = syntheticMarket();
  Object.keys(md).forEach((id) => {
    if (!id.endsWith("_FULL")) return;
    Object.keys(md[id]).forEach((c) => { md[id][c] = { buy_price: 5000000, sell_price: 5000000, volume_24h: 9999 }; });
  });
  FILLABLE_SLUGS.forEach((slug) => {
    const play = computeJournalLaborerPlay({ slug, tier: 8, marketData: md, city: CITY });
    assert.ok(play.advantage < 0, `${slug}: a 5M full journal must beat the payload`);
  });
});

// ── 4. degradation ─────────────────────────────────────────────────────────
console.log("\n=== Missing data degrades, never lies ===");

test("an unpriced payload reports hasData:false and zeroes, not undefined", () => {
  FILLABLE_SLUGS.forEach((slug) => {
    const play = computeJournalLaborerPlay({ slug, tier: 8, marketData: {}, city: CITY });
    assert.strictEqual(play.hasData, false, slug);
    assert.strictEqual(play.payload, 0, slug);
    assert.strictEqual(play.advantage, 0, slug);
    assert.strictEqual(play.advantageFull, 0, slug);
  });
});

test("no FULL journal price keeps the payload and reports sellPriced:false", () => {
  const md = syntheticMarket();
  Object.keys(md).forEach((id) => { if (id.endsWith("_FULL")) delete md[id]; });
  FILLABLE_SLUGS.forEach((slug) => {
    const play = computeJournalLaborerPlay({ slug, tier: 8, marketData: md, city: CITY });
    assert.strictEqual(play.hasData, true, slug);
    assert.ok(play.payload > 0, slug);
    assert.strictEqual(play.sellPriced, false, slug);
    assert.strictEqual(play.fameBasis, "none", slug);
    assert.strictEqual(play.sellFull, 0, slug);
    assert.strictEqual(play.advantage, play.payload, `${slug}: advantage must fall back to the payload`);
    assert.strictEqual(play.advantageFull, play.payload, `${slug}: so must the bound`);
  });
});

test("a missing play renders a dash and never throws", () => {
  [null, undefined, { hasData: false }].forEach((play) => {
    const html = journalLaborerCell(play);
    assert.ok(html.startsWith("<td"), "must still be a cell");
    assert.ok(html.includes("—"), "must dash");
  });
});

// ── 5. the hourly rate — the number the column ranks on ────────────────────
//
// The loop this answers: fill journals yourself, hand them to laborers you have
// plenty of, collect the returns. Laborers are not scarce, YOUR gathering hours
// are, so the tier choice is decided per hour of gathering — not per journal.
console.log("\n=== The rate is payload per hour of gathering ===");

// Hours a journal costs at a given gathering tier, from the app's own model.
function fillHoursFor(slug, tier, gatherTier) {
  const type = laborerSlugToGatherType(slug);
  const r = resolveJournalFill({
    type, journalTier: tier, maxfame: getJournalMaxfame(slug, tier),
    gatherTierOverride: gatherTier,
  });
  return r.fillable ? r.hours : 0;
}

test("perHour is payload ÷ hours, exactly", () => {
  FILLABLE_SLUGS.forEach((slug) => {
    JOURNAL_TIERS.forEach((tier) => {
      const hours = fillHoursFor(slug, tier, 8);
      if (!(hours > 0)) return;
      const play = computeJournalLaborerPlay({ slug, tier, marketData: MD, city: CITY });
      const rate = journalLaborerRate(play, hours);
      assert.ok(Math.abs(rate.perHour - play.payload / hours) < 1e-6, `${slug} T${tier}`);
    });
  });
});

test("laborersFed is the 22h cycle over the fill time, and never divides the rate", () => {
  assert.strictEqual(LABORER_CYCLE_HOURS, 22);
  const play = computeJournalLaborerPlay({ slug: "FISHING", tier: 2, marketData: MD, city: CITY });
  const hours = fillHoursFor("FISHING", 2, 8);
  const rate = journalLaborerRate(play, hours);
  assert.ok(Math.abs(rate.laborersFed - 22 / hours) < 1e-6, `laborersFed ${rate.laborersFed}`);
  assert.ok(Math.abs(rate.perHour - play.payload / hours) < 1e-6,
    "capacity must be reported beside the rate, never folded into it");
  assert.ok(rate.perHour > play.payload / 22,
    "a rate capped at the laborer cycle would be strictly smaller — it is not capped");
});

test("netPerHour is the advantage over the same hours", () => {
  FILLABLE_SLUGS.forEach((slug) => {
    const hours = fillHoursFor(slug, 8, 8);
    const play = computeJournalLaborerPlay({ slug, tier: 8, marketData: MD, city: CITY });
    const rate = journalLaborerRate(play, hours);
    assert.ok(Math.abs(rate.netPerHour - play.advantage / hours) < 1e-6, slug);
    // The margin floors at 0, so a city whose empty costs more than its full
    // sells bills nothing and the two coincide. It can never go the other way.
    assert.ok(rate.netPerHour <= rate.perHour + 1e-6, `${slug}: net above gross`);
  });
});

// A degenerate fill time must never reach the page as Infinity or NaN — the
// renderer prints this number.
const BAD_HOURS = [0, -1, null, undefined, NaN, Infinity, "abc"];
for (const h of BAD_HOURS) {
  test(`journalLaborerRate(${String(h)}) collapses to zeros, never Infinity`, () => {
    const play = computeJournalLaborerPlay({ slug: "ORE", tier: 8, marketData: MD, city: CITY });
    const rate = journalLaborerRate(play, h);
    assert.strictEqual(rate.perHour, 0);
    assert.strictEqual(rate.laborersFed, 0);
    assert.ok(Number.isFinite(rate.netPerHour));
  });
}

test("a play with no data has no rate", () => {
  const rate = journalLaborerRate(computeJournalLaborerPlay({ slug: "ORE", tier: 8, marketData: {}, city: CITY }), 1.5);
  assert.strictEqual(rate.perHour, 0);
});

// Fishing ignores the ±2 window, so at ONE gathering tier all seven of its tiers
// are rankable against each other — which is the whole point of the column for a
// fisherman. Land journals get three.
test("at T8 gathering, fishing ranks at 7 tiers and ore at 3", () => {
  const fish = JOURNAL_TIERS.filter((t) => fillHoursFor("FISHING", t, 8) > 0);
  const ore = JOURNAL_TIERS.filter((t) => fillHoursFor("ORE", t, 8) > 0);
  assert.deepStrictEqual(fish, [2, 3, 4, 5, 6, 7, 8]);
  assert.deepStrictEqual(ore, [6, 7, 8]);
});

// ── 6. the cell ────────────────────────────────────────────────────────────
console.log("\n=== The cell states its unit, its laborer and its capacity ===");

test("the cell leads with the payload and the rate it is ranked on", () => {
  const play = computeJournalLaborerPlay({ slug: "ORE", tier: 8, marketData: MD, city: CITY });
  const html = journalLaborerCell(play, { hours: fillHoursFor("ORE", 8, 8) });
  assert.ok(html.includes("/ journal"), "the per-journal unit must be on the face");
  assert.ok(html.includes("/ h self-fill"), "the ranked rate must be on the face");
  assert.ok(/×\d/.test(html), `the laborers-fed chip must be on the face: ${html}`);
  const pct = (getLaborerJournalYield(8, 8, "ORE") * 100).toFixed(1);
  assert.ok(html.includes(`T8 @${pct}%`), `the laborer and yield must be named: ${html}`);
  assert.ok(html.includes(play.city), "the city must be named");
});

test("no hours means no rate line, and the payload still shows", () => {
  const play = computeJournalLaborerPlay({ slug: "ORE", tier: 2, marketData: MD, city: CITY });
  const html = journalLaborerCell(play, { hours: 0 });
  assert.ok(html.includes("/ journal"), "the payload must survive");
  assert.ok(!html.includes("/ h self-fill"), "no rate may be claimed without hours");
  assert.ok(html.includes("no fill rate"), `must say why: ${html}`);
});

test("the rate is gross, so it is never red", () => {
  // Whether feeding BEATS selling is the Fill Speed column's job; a gross rate
  // cannot be negative and must not be coloured as though it could.
  const rich = syntheticMarket();
  Object.keys(rich).forEach((id) => {
    if (!id.endsWith("_FULL")) return;
    Object.keys(rich[id]).forEach((c) => { rich[id][c] = { buy_price: 5000000, sell_price: 5000000, volume_24h: 9999 }; });
  });
  const play = computeJournalLaborerPlay({ slug: "ORE", tier: 8, marketData: rich, city: CITY });
  assert.ok(play.advantage < 0, "fixture must be a losing play");
  const html = journalLaborerCell(play, { hours: fillHoursFor("ORE", 8, 8) });
  assert.ok(html.includes("#1f9d55"), "the gross rate stays green");
  assert.ok(!html.includes("#dc2626"), "nothing on the face may read as a negative rate");
});

test("the legacy positional emDash argument still works", () => {
  const html = journalLaborerCell(null, '<td class="x">—</td>');
  assert.strictEqual(html, '<td class="x">—</td>');
});

test("the tooltip never breaks the title attribute", () => {
  FILLABLE_SLUGS.forEach((slug) => {
    const play = computeJournalLaborerPlay({ slug, tier: 8, marketData: MD, city: CITY });
    const tip = journalLaborerTip(play, journalLaborerRate(play, fillHoursFor(slug, 8, 8)));
    assert.ok(!tip.includes('"'), `${slug}: raw quote in a title attribute`);
  });
});

// ── 6. the scan ids ────────────────────────────────────────────────────────
console.log("\n=== The scan pulls the payload ids and nothing else ===");

test("getJournalPayloadScanIds covers every payload the column prices", () => {
  const ids = new Set(getJournalPayloadScanIds());
  assert.ok(ids.size > 0, "no ids");
  FILLABLE_SLUGS.forEach((slug) => {
    JOURNAL_TIERS.forEach((tier) => {
      const spec = journalSlugToLaborerSpec(slug, tier);
      if (spec.mode === LABORER_MODE.TROPHY) {
        assert.ok(ids.has(spec.trophyId), `${slug} T${tier}: ${spec.trophyId} missing`);
      }
    });
  });
});

test("it carries no journals and no contracts — those are scanned already", () => {
  getJournalPayloadScanIds().forEach((id) => {
    assert.ok(!id.includes("_JOURNAL_"), `${id} is a journal`);
    assert.ok(!id.includes("LABOURER_CONTRACT"), `${id} is a contract`);
  });
});

test("the ids are deduped", () => {
  const ids = getJournalPayloadScanIds();
  assert.strictEqual(new Set(ids).size, ids.length);
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
