/**
 * Test: a self-fill play's PROFIT is its payload, and can never be negative.
 *
 * Reported: every self-filled FISHERMAN journal showed a negative profit. The
 * arithmetic was doing what it was told — `netPayout = payload − fameBill`,
 * where the bill is the journal's own market margin — but that bill is the
 * revenue of a DIFFERENT play (fill it and sell it full), not a cost of this
 * one. This loop buys nothing: you gather, the laborer works, the same journal
 * comes back empty. With no outlay there is no way to lose money, so subtracting
 * the other play's revenue turned "this journal sells well" into "this play
 * loses money".
 *
 * Fishing hit it first because it is the extreme of both halves at once: the
 * smallest laborer payload on the board (T8 baseloot 25.119 against a
 * gatherer's 38.4, and a catch is one fish from a pool of cheap commons) and the
 * scarcest fame per hour (~10,200/h at T8 against land's ~38,300), so the market
 * rightly prices a fisherman's journal high per point of fame. payload − margin
 * was therefore negative at EVERY tier, and because fisher journals have no fill
 * window the loop had all seven tiers to be negative at.
 *
 * What this file pins:
 *   1. The reported rate is the payload per hour / per craft, always > 0 when
 *      the payload prices — for every journal family, gathering and crafting.
 *   2. It stays positive however dear the journal market gets.
 *   3. The comparison against selling survives, as `net*`, with the right sign.
 *   4. The winning tier is the one that pays most, not the one that best beats
 *      the market.
 *   5. The rendered cell carries no loss colour, and says which play the market
 *      prefers in words instead.
 *
 * Black-box: one synthetic market, no live API, no DOM.
 *
 * Run: node tests/laborer-self-fill-gross-face.test.cjs
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
function formatFillHours(h) { return h.toFixed(1) + " h"; }
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

global.calcJournalEconomics = require("../js/calculations.js").calcJournalEconomics;

const mod = new Module("laborer-self-fill-gross-face-test");
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
    loadFile("js/laborer-craft-fill.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/laborer-self-fill.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/laborer-journal-play.js").replace(/if \(typeof module[\s\S]*$/, "") +
    "\nmodule.exports = { LABORERS, LABORER_TIERS, LABORER_MODE, getLaborersItemIds, " +
    "_laborerJournalRowSpec, computeLaborerSelfFill, selfFillLines, selfFillCell, " +
    "craftFillLines, selfFillValue, journalPlayValue };",
  "laborer-self-fill-gross-face.js",
);

global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const {
  LABORERS, LABORER_MODE, getLaborersItemIds, _laborerJournalRowSpec,
  computeLaborerSelfFill, selfFillLines, selfFillCell, 
  selfFillValue, journalPlayValue,
} = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}
const CITY = "Lymhurst";
const CITIES = ["Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Brecilien"];
// The old Gathering Tier control's key is gone; clear any legacy value so the
// rows here price at the always-match default.
store.delete("journalFillTier");

// ── synthetic market ───────────────────────────────────────────────────────
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}

/**
 * `journalScale` multiplies every journal price, FULL priced ten times the
 * EMPTY so the margin is positive in whichever city the payload picks. At a big
 * enough scale the journal is worth far more sold than the laborer returns —
 * the exact market that used to paint the whole column red.
 */
function market(journalScale = 1) {
  const md = {};
  getLaborersItemIds().forEach((id) => {
    md[id] = {};
    const isJournal = id.includes("_JOURNAL_");
    CITIES.forEach((c) => {
      const price = isJournal
        ? Math.max(1, Math.round((id.endsWith("_FULL") ? 100000 : 10000) * journalScale))
        : 40 + (hash(id + c) % 9000);
      md[id][c] = { buy_price: price, sell_price: price, volume_24h: 9999 };
    });
  });
  return md;
}

const GATHERERS = LABORERS.filter((l) => l.modes.includes(LABORER_MODE.RESOURCE));
const CRAFTERS = LABORERS.filter((l) => l.modes.includes(LABORER_MODE.CRAFTING));
const FISHERMAN = GATHERERS.filter((l) => l.slug === "FISHING");
const TIERS = [4, 5, 6, 7, 8];
// 1x is an ordinary market; 100x is one where selling the journal dwarfs the
// payload, which is the fisherman's real situation and used to read as a loss.
const SCALES = [0.01, 1, 100];

assert.ok(FISHERMAN.length === 1, "the fixture must actually contain the Fisherman");

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== The reported rate is the payload, and is never negative ===");

test("every gathering laborer × tier × journal market reports a POSITIVE rate", () => {
  GATHERERS.forEach((l) => {
    TIERS.forEach((t) => {
      SCALES.forEach((scale) => {
        const spec = _laborerJournalRowSpec(l, t, LABORER_MODE.RESOURCE);
        const sf = computeLaborerSelfFill({ spec, marketData: market(scale), city: CITY, laborerTier: t });
        if (!sf.found) return;
        assert.ok(sf.silverPerHour > 0,
          `${l.name} T${t} @${scale}x: rate ${sf.silverPerHour}`);
        assert.ok(sf.payout > 0, `${l.name} T${t} @${scale}x: payout ${sf.payout}`);
        assert.ok(Math.abs(sf.silverPerHour * sf.hours - sf.payout) < 1e-6,
          `${l.name} T${t} @${scale}x: the rate is not the payload over its hours`);
      });
    });
  });
});

test("every crafting laborer reports a POSITIVE per-craft rate on the same markets", () => {
  CRAFTERS.forEach((l) => {
    TIERS.forEach((t) => {
      SCALES.forEach((scale) => {
        const spec = _laborerJournalRowSpec(l, t, LABORER_MODE.CRAFTING);
        const sf = computeLaborerSelfFill({ spec, marketData: market(scale), city: CITY, laborerTier: t });
        if (!sf.found) return;
        assert.strictEqual(sf.kind, "craft", `${l.name} T${t}: crafting rows are counted in crafts`);
        assert.ok(sf.silverPerCraft > 0, `${l.name} T${t} @${scale}x: rate ${sf.silverPerCraft}`);
      });
    });
  });
});

test("THE REPORT: a fisherman journal is positive at every tier, in every market", () => {
  const l = FISHERMAN[0];
  [2, 3, 4, 5, 6, 7, 8].forEach((t) => {
    SCALES.forEach((scale) => {
      const spec = _laborerJournalRowSpec(l, 8, LABORER_MODE.RESOURCE);
      const sf = computeLaborerSelfFill({ spec, marketData: market(scale), city: CITY, laborerTier: 8, onlyTier: t });
      if (!sf.found) return;
      assert.ok(sf.silverPerHour > 0, `Fisherman T${t} @${scale}x: rate ${sf.silverPerHour}`);
    });
  });
});

test("a fisher journal HAS no fill window, so all seven tiers are candidates — and none is a loss", () => {
  const spec = _laborerJournalRowSpec(FISHERMAN[0], 8, LABORER_MODE.RESOURCE);
  const sf = computeLaborerSelfFill({ spec, marketData: market(100), city: CITY, laborerTier: 8 });
  assert.deepStrictEqual(sf.candidateTiers, [2, 3, 4, 5, 6, 7, 8],
    "fishing is exempt from the ±2 window, so every tier is on offer");
  assert.ok(sf.silverPerHour > 0, `rate ${sf.silverPerHour}`);
});

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== The comparison against selling survives, with the right sign ===");

test("a journal market 10,000x dearer flips the comparison negative but not the rate", () => {
  GATHERERS.forEach((l) => {
    const spec = _laborerJournalRowSpec(l, 8, LABORER_MODE.RESOURCE);
    const cheap = computeLaborerSelfFill({ spec, marketData: market(0.01), city: CITY, laborerTier: 8, onlyTier: 8 });
    const dear = computeLaborerSelfFill({ spec, marketData: market(100), city: CITY, laborerTier: 8, onlyTier: 8 });
    if (!cheap.found || !dear.found) return;
    assert.ok(Math.abs(cheap.silverPerHour - dear.silverPerHour) < 1e-6,
      `${l.name}: the rate moved with journal prices`);
    assert.ok(dear.netSilverPerHour < 0, `${l.name}: a 100x journal market must beat the laborer`);
    assert.ok(dear.netSilverPerHour < cheap.netSilverPerHour, `${l.name}: comparison did not react`);
    assert.ok(Math.abs(dear.netPayout - (dear.payout - dear.fameCost)) < 1e-6,
      `${l.name}: the comparison is payload minus the bill`);
  });
});

test("the comparison is the payload's own city, never a cross-city arbitrage", () => {
  // Only Martlock lists an empty, and it lists it dear; Lymhurst's full sells
  // high. Priced across the list that is a fat margin no single city offers.
  const md = market(1);
  Object.keys(md).forEach((id) => {
    if (!id.includes("_JOURNAL_")) return;
    CITIES.forEach((c) => {
      const p = id.endsWith("_FULL")
        ? (c === "Lymhurst" ? 200000 : 20000)
        : (c === "Martlock" ? 1000 : 150000);
      md[id][c] = { buy_price: p, sell_price: p, volume_24h: 9999 };
    });
  });
  GATHERERS.forEach((l) => {
    const spec = _laborerJournalRowSpec(l, 8, LABORER_MODE.RESOURCE);
    const sf = computeLaborerSelfFill({ spec, marketData: md, city: CITY, laborerTier: 8, onlyTier: 8 });
    if (!sf.found || !sf.famePriced) return;
    const fullHere = md[`T8_JOURNAL_${spec.journalSlug}_FULL`][sf.city].buy_price;
    const emptyHere = md[`T8_JOURNAL_${spec.journalSlug}_EMPTY`][sf.city].sell_price;
    const marginHere = Math.max(0, fullHere * (1 - 0.065) - emptyHere);
    assert.ok(Math.abs(sf.fameCost - marginHere) < 1e-6,
      `${l.name} @${sf.city}: billed ${sf.fameCost}, that city's own margin is ${marginHere}`);
  });
});

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== The winning tier is the one that pays most ===");

test("the chosen tier maximises the payload rate over every candidate", () => {
  GATHERERS.forEach((l) => {
    const md = market(100);
    const spec = _laborerJournalRowSpec(l, 8, LABORER_MODE.RESOURCE);
    const sf = computeLaborerSelfFill({ spec, marketData: md, city: CITY, laborerTier: 8 });
    if (!sf.found) return;
    sf.candidateTiers.forEach((t) => {
      const one = computeLaborerSelfFill({ spec, marketData: md, city: CITY, laborerTier: 8, onlyTier: t });
      if (!one.found) return;
      assert.ok(sf.silverPerHour >= one.silverPerHour - 1e-6,
        `${l.name}: T${t} pays ${one.silverPerHour}/h, better than the chosen T${sf.journalTier}'s ${sf.silverPerHour}/h`);
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== The cell shows no loss, and names the better play in words ===");

const LOSS_RED = "#dc2626";

test("no self-fill cell is painted with the loss colour, however dear the journals", () => {
  [...GATHERERS, ...CRAFTERS].forEach((l) => {
    SCALES.forEach((scale) => {
      const mode = l.modes.includes(LABORER_MODE.RESOURCE) ? LABORER_MODE.RESOURCE : LABORER_MODE.CRAFTING;
      const spec = _laborerJournalRowSpec(l, 8, mode);
      const sf = computeLaborerSelfFill({ spec, marketData: market(scale), city: CITY, laborerTier: 8 });
      if (!sf.found) return;
      const html = selfFillCell(sf, null);
      assert.ok(!html.includes(LOSS_RED), `${l.name} @${scale}x: cell carries the loss colour`);
      assert.ok(!/>-[\d,]/.test(html), `${l.name} @${scale}x: cell shows a negative figure`);
    });
  });
});

test("when the market wins, the cell says so instead of going negative", () => {
  const spec = _laborerJournalRowSpec(FISHERMAN[0], 8, LABORER_MODE.RESOURCE);
  const sf = computeLaborerSelfFill({ spec, marketData: market(100), city: CITY, laborerTier: 8 });
  assert.ok(sf.netSilverPerHour < 0, "fixture: the market must be the better play here");
  const html = selfFillCell(sf, null);
  assert.ok(html.includes("sells for"), `expected a "sells for … more" line, got: ${html}`);
  assert.ok(!html.includes(LOSS_RED), "and no loss colour");
});

test("when self-fill wins, the cell says how much it beats selling by", () => {
  const spec = _laborerJournalRowSpec(FISHERMAN[0], 8, LABORER_MODE.RESOURCE);
  const sf = computeLaborerSelfFill({ spec, marketData: market(0.01), city: CITY, laborerTier: 8 });
  assert.ok(sf.netSilverPerHour > 0, "fixture: self-fill must be the better play here");
  assert.ok(selfFillLines({ ...sf }).includes("beats selling it by"), "expected the beats-selling line");
});

test("the merged Best Journal Play column reports the same positive rate", () => {
  [...GATHERERS, ...CRAFTERS].forEach((l) => {
    const mode = l.modes.includes(LABORER_MODE.RESOURCE) ? LABORER_MODE.RESOURCE : LABORER_MODE.CRAFTING;
    const spec = _laborerJournalRowSpec(l, 8, mode);
    const sf = computeLaborerSelfFill({ spec, marketData: market(100), city: CITY, laborerTier: 8 });
    if (!sf.found) return;
    const v = selfFillValue(sf);
    assert.ok(v > 0, `${l.name}: merged column value ${v}`);
    const own = sf.kind === "craft" ? sf.silverPerCraft : sf.silverPerHour;
    assert.ok(Math.abs(v - own) < 1e-6, `${l.name}: merged column disagrees with the cell`);
    // Banded sort: gatherers sit above crafters, and no row lands in the
    // no-model band now that none of them can be negative.
    assert.ok(journalPlayValue(null, sf) > -2, `${l.name}: sorted as if it had no model`);
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
