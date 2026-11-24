/**
 * The Black Market board's per-quality bid ladder (js/bm-quality-ladder.js).
 *
 * The board collects plays from every feeder, and only two of them (Flipping,
 * Quality Rerolling) price a specific quality. Everything else — Crafting,
 * Enchanting, Transmute — is priced from the flat book, which is the Normal
 * quality alone (the flat map is a quality-1 projection, never an aggregate).
 * Their rows cannot carry a quality; what they CAN show is what the Black
 * Market bids for the OTHER qualities of the same item, because the per-quality
 * books (lastQualityMarketData) hold exactly that wherever a capture or scan
 * has seen it.
 *
 * bmQualityNote(row) is that ladder, as the `note` HTML a price cell appends:
 * one line per quality with a live quote, the quality the row itself was
 * priced at marked, and nothing at all when there is nothing to compare.
 *
 * Black box over the real module, fed synthetic books and scripted readers.
 * No DOM, no live API.
 *
 * Run: node tests/bm-quality-ladder.test.cjs
 */

const assert = require("assert");
const path = require("path");

const LADDER = require(path.join(__dirname, "..", "js", "bm-quality-ladder.js"));

globalThis.tx = globalThis.tx || ((en) => en);
globalThis.formatSilver = (n) => Math.round(n).toLocaleString("en-US");
// Instant mode: a sell leg reads the BID (buy_price) — the Black Market's
// one-way book. The raw fallback and the age field picker both follow this.
globalThis.getOrderType = () => "instant";

globalThis.formatPriceAge = (dateStr) => {
  if (!dateStr) return null;
  const ms = Date.now() - Date.parse(dateStr);
  if (!Number.isFinite(ms)) return null;
  return ms < 3600000
    ? { label: `${Math.round(ms / 60000)}m ago`, color: "#5e9e78" }
    : { label: `${Math.round(ms / 3600000)}h ago`, color: "#9e8840" };
};
// The real field picker (js/price-freshness.js): a line must be dated from the
// book it was priced from — the same rule priceTd follows.
const freshness = require(path.join(__dirname, "..", "js", "price-freshness.js"));
globalThis.priceDateFor = freshness.priceDateFor;

const MIN_5 = new Date(Date.now() - 5 * 60000).toISOString();
const HOURS_3 = new Date(Date.now() - 3 * 3600000).toISOString();

const ID = "T8_2H_WILDSTAFF";

// Scripted readers. When present, the ladder must quote THEM — they are what
// the row's own cell was priced through (order mode and overrides included).
// When absent, it falls back to the raw books.
function setReaders({ sell = null, qualitySell = null } = {}) {
  if (sell) globalThis.getSellPrice = sell; else delete globalThis.getSellPrice;
  if (qualitySell) globalThis.getQualitySellPrice = qualitySell; else delete globalThis.getQualitySellPrice;
}

function setBooks({ flat = {}, quality = {} } = {}) {
  globalThis.lastMarketData = flat;
  globalThis.lastQualityMarketData = quality;
}

// Normal, Outstanding and Excellent quote; Good and Masterpiece have no book.
const FULL_BOOKS = {
  flat: { [ID]: { "Black Market": { buy_price: 1240000, buy_date: MIN_5 } } },
  quality: {
    [ID]: {
      3: { "Black Market": { buy_price: 2090000, buy_date: HOURS_3 } },
      4: { "Black Market": { buy_price: 2640000, buy_date: MIN_5 } },
    },
  },
};

const craftingRow = () => ({ sellItemId: ID, sellQuality: null, sellPrice: 1240000 });
const flipRow = () => ({ sellItemId: ID, sellQuality: 3, sellPrice: 2090000 });

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    setBooks();
    setReaders();
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    if (process.env.VERBOSE) console.error(e.stack);
    failed++;
  }
}

console.log("Black Market quality ladder tests\n");

// ── when there is nothing to say ───────────────────────────────────────────

test("a row with no sell item id asks for no ladder", () => {
  assert.strictEqual(LADDER.bmQualityNote(null), "");
  assert.strictEqual(LADDER.bmQualityNote({}), "");
  assert.strictEqual(LADDER.bmQualityNote({ sellItemId: null }), "",
    "a Laborers mix has no single item to ladder");
});

test("an item with a single quoted quality renders a 1-line ladder", () => {
  setBooks({ flat: { [ID]: { "Black Market": { buy_price: 1240000, buy_date: MIN_5 } } } });
  const html = LADDER.bmQualityNote(craftingRow());
  assert.ok(html.includes("▸Q1"), "shows Q1");
  assert.ok(html.includes("1,240,000"), "shows amount");
  assert.ok(html.includes("5m ago"), "shows age");
});

test("an item with no books at all renders nothing", () => {
  assert.strictEqual(LADDER.bmQualityNote(craftingRow()), "");
});

test("books for other items are ignored", () => {
  setBooks({
    flat: { T4_BAG: { "Black Market": { buy_price: 100, buy_date: MIN_5 } } },
    quality: { T4_BAG: { 2: { "Black Market": { buy_price: 200, buy_date: MIN_5 } } } },
  });
  assert.strictEqual(LADDER.bmQualityNote(craftingRow()), "");
});

// ── the lines ──────────────────────────────────────────────────────────────

test("every quoted quality gets a line, in quality order", () => {
  setBooks(FULL_BOOKS);
  const html = LADDER.bmQualityNote(craftingRow());
  assert.ok(html.includes("Q1"), html);
  assert.ok(html.includes("Q3"), html);
  assert.ok(html.includes("Q4"), html);
  assert.ok(!html.includes("Q2"), "Good has no book — no line");
  assert.ok(!html.includes("Q5"), "Masterpiece has no book — no line");
  const i1 = html.indexOf("Q1"), i3 = html.indexOf("Q3"), i4 = html.indexOf("Q4");
  assert.ok(i1 < i3 && i3 < i4, "ascending quality order");
});

test("the amounts are the books' bids", () => {
  setBooks(FULL_BOOKS);
  const html = LADDER.bmQualityNote(craftingRow());
  assert.ok(html.includes("1,240,000"), html);
  assert.ok(html.includes("2,090,000"), html);
  assert.ok(html.includes("2,640,000"), html);
});

test("each line is dated from its own quality's book", () => {
  setBooks(FULL_BOOKS);
  const html = LADDER.bmQualityNote(craftingRow());
  assert.ok(html.includes("5m ago"), html);
  assert.ok(html.includes("3h ago"), "the Outstanding line carries its own, older clock");
});

test("the tooltip names the quality", () => {
  setBooks(FULL_BOOKS);
  const html = LADDER.bmQualityNote(craftingRow());
  assert.ok(html.includes("Outstanding"), html);
  assert.ok(html.includes("Normal"), html);
});

// ── the marker ─────────────────────────────────────────────────────────────

test("a flat-priced row marks Normal — the quality its number IS", () => {
  setBooks(FULL_BOOKS);
  const html = LADDER.bmQualityNote(craftingRow());
  assert.ok(html.includes("▸Q1"), html);
  assert.strictEqual((html.match(/qbrk-take/g) || []).length, 1, "exactly one marked line");
});

test("a quality-priced row marks its own quality", () => {
  setBooks(FULL_BOOKS);
  const html = LADDER.bmQualityNote(flipRow());
  assert.ok(html.includes("▸Q3"), html);
  assert.ok(!html.includes("▸Q1"), html);
  assert.strictEqual((html.match(/qbrk-take/g) || []).length, 1);
});

test("a taken quality without a quote leaves every line unmarked", () => {
  setBooks(FULL_BOOKS);
  const html = LADDER.bmQualityNote({ sellItemId: ID, sellQuality: 5, sellPrice: 2090000 });
  assert.ok(html.includes("Q1"), "the other lines still render");
  assert.strictEqual((html.match(/qbrk-take/g) || []).length, 0);
});

// ── pricing through the app's own readers ──────────────────────────────────

test("amounts come from the app's readers when they are loaded", () => {
  setBooks(FULL_BOOKS);
  // Scripted as if the user had pinned every quality: the reader's number,
  // not the book's, is what the row's cell shows — so it is what the ladder
  // must show too.
  setReaders({
    sell: () => 1300000,
    qualitySell: (_qd, _id, q) => ({ 3: 2100000, 4: 2700000 }[q] || 0),
  });
  const html = LADDER.bmQualityNote(craftingRow());
  assert.ok(html.includes("1,300,000"), html);
  assert.ok(html.includes("2,100,000"), html);
  assert.ok(html.includes("2,700,000"), html);
  assert.ok(!html.includes("1,240,000"), "the raw book's bid is not what the cell prints");
});

test("a number that is not the book's wears the pin instead of an age", () => {
  setBooks(FULL_BOOKS);
  setReaders({
    sell: () => 1240000,
    qualitySell: (_qd, _id, q) => (q === 3 ? 5000000 : 2640000),
  });
  const html = LADDER.bmQualityNote(craftingRow());
  assert.ok(html.includes("⚡"), "the pinned Outstanding line");
  assert.ok(!html.includes("3h ago"),
    "an overridden number has no market age — any timestamp would describe another price");
  assert.ok(html.includes("5m ago"), "the unpinned lines keep theirs");
});

test("without the readers, the raw books are quoted", () => {
  setBooks(FULL_BOOKS);
  setReaders();
  const html = LADDER.bmQualityNote(craftingRow());
  assert.ok(html.includes("1,240,000"), html);
  assert.ok(html.includes("2,090,000"), html);
});

// ── the Pure Profit ladder (bmProfitQualityNote) ───────────────────────────

console.log("\nBlack Market Pure Profit quality ladder tests\n");

test("a row with no sell item id asks for no profit ladder", () => {
  assert.strictEqual(LADDER.bmProfitQualityNote(null), "");
  assert.strictEqual(LADDER.bmProfitQualityNote({}), "");
  assert.strictEqual(LADDER.bmProfitQualityNote({ sellItemId: null }), "");
});

test("an unpriced item renders no profit ladder", () => {
  assert.strictEqual(LADDER.bmProfitQualityNote(craftRowProfit(200000)), "");
});

function craftRowProfit(pureProfit = 206965, inputCost = 463612, sellPrice = 698518) {
  return {
    sellItemId: ID,
    sellQuality: 1,
    sellPrice,
    inputCost,
    pureProfit,
    sellUnits: 1,
  };
}

test("single quoted quality renders pure profit for Q1", () => {
  setBooks({ flat: { [ID]: { "Black Market": { buy_price: 698518, buy_date: MIN_5 } } } });
  const html = LADDER.bmProfitQualityNote(craftRowProfit(206965));
  assert.ok(html.includes("▸Q1"), "marks Q1");
  assert.ok(html.includes("206,965"), "shows exact pure profit");
});

test("multi-quality books render calculated pure profits matching sales tax", () => {
  // Setup books matching the user screenshot example:
  // Q1: 698,518 (profit 206,965)
  // Q2: 636,624 -> delta (636624 - 698518) * 0.96 = -59,418 -> profit 147,547
  // Q3: 517,257 -> delta (517257 - 698518) * 0.96 = -174,010 -> profit 32,955
  // Q4: 645,466 -> delta (645466 - 698518) * 0.96 = -50,930 -> profit 156,035
  // Q5: 499,573 -> delta (499573 - 698518) * 0.96 = -190,987 -> profit 15,978
  globalThis.PREMIUM_TAX = 0.04;
  setBooks({
    flat: { [ID]: { "Black Market": { buy_price: 698518, buy_date: MIN_5 } } },
    quality: {
      [ID]: {
        2: { "Black Market": { buy_price: 636624, buy_date: MIN_5 } },
        3: { "Black Market": { buy_price: 517257, buy_date: MIN_5 } },
        4: { "Black Market": { buy_price: 645466, buy_date: MIN_5 } },
        5: { "Black Market": { buy_price: 499573, buy_date: MIN_5 } },
      },
    },
  });
  const html = LADDER.bmProfitQualityNote(craftRowProfit(206965, 463612, 698518));
  assert.ok(html.includes("▸Q1"), "marks taken Q1");
  assert.ok(html.includes("206,965"), "Q1 profit matches");
  assert.ok(html.includes("147,547"), "Q2 profit matches");
  assert.ok(html.includes("32,954"), "Q3 profit matches");
  assert.ok(html.includes("156,035"), "Q4 profit matches");
  assert.ok(html.includes("15,978"), "Q5 profit matches");
});

test("a quality flip marks its own quality in profit ladder", () => {
  globalThis.PREMIUM_TAX = 0.04;
  setBooks({
    flat: { [ID]: { "Black Market": { buy_price: 100000, buy_date: MIN_5 } } },
    quality: {
      [ID]: {
        3: { "Black Market": { buy_price: 200000, buy_date: MIN_5 } },
      },
    },
  });
  const row = {
    sellItemId: ID,
    sellQuality: 3,
    sellPrice: 200000,
    inputCost: 50000,
    pureProfit: 142000,
    sellUnits: 1,
  };
  const html = LADDER.bmProfitQualityNote(row);
  assert.ok(html.includes("▸Q3"), "marks taken Q3");
  assert.ok(!html.includes("▸Q1"), "Q1 is not marked");
  assert.ok(html.includes("142,000"), "Q3 profit matches row.pureProfit");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

