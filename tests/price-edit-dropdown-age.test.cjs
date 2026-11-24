/**
 * Tests for the price age the inline price editor's city <select> now carries —
 * js/price-edit-dropdown.js (makeLabel, cityOptionHtml, displayOrderDates).
 *
 * The table's price cell has always badged its number with an age and a volume
 * in the freshness ramp's colour; the editor showed volume only, so the user
 * could not tell whether the price being overwritten was minutes or days old.
 *
 * Black-box: stub the globals the builder reads, drive buildCityOptions with
 * dated market entries, and assert on the returned label / markup. The ramp
 * itself is NOT copied — formatPriceAge is sliced out of js/app.js so the
 * buckets under test are the ones the tables use.
 *
 * Covers:
 *  - an age per side, sell dated from sell_date and buy from buy_date
 *  - a side with no date, and an unparseable date, print no parentheses
 *  - no age beside an absent price (the em-dash side)
 *  - an overridden side has no age; the other side keeps its own
 *  - volume still renders when neither book is dated
 *  - cityOptionHtml puts price / age / volume in separate spans, the ramp
 *    colour inline on the age only
 *  - the city / tier name is escaped
 *  - a no-data row degrades to plain text
 *
 * Run: node tests/price-edit-dropdown-age.test.cjs
 */

const assert = require("assert");
const { appSource } = require("./helpers/app-source.cjs");
const Module = require("module");

// --- The REAL freshness ramp, sliced out of js/app.js (no copy) so a change to
// the buckets or the colours shows up here. Same compile-a-slice pattern as
// tests/price-age-follows-order-field.test.cjs. ---
const appSrc = appSource();
const ageStart = appSrc.indexOf("function formatPriceAge");
const ageEnd = appSrc.indexOf("\n/**", ageStart);
assert.ok(ageStart >= 0 && ageEnd > ageStart, "could not locate formatPriceAge in js/app.js");
const ageMod = new Module("price-age-ramp");
ageMod._compile(
  appSrc.slice(ageStart, ageEnd) + "\nmodule.exports = formatPriceAge;",
  "app.js",
);
globalThis.formatPriceAge = ageMod.exports;

const GREEN = "#5e9e78";
const AMBER = "#9e8840";
const RED = "#9e5858";

// --- Globals the builder reads at call time. ---
let _priceOverrides = {};
globalThis.CITIES = ["Caerleon", "Lymhurst", "Bridgewatch", "Martlock", "Thetford"];
globalThis.SELL_CITIES = [...globalThis.CITIES, "Black Market"];
globalThis.FOOD_ITEMS = { meat: ["T3_MEAT", "T4_MEAT", "T5_MEAT"], plants: [], chocolate: [] };
globalThis.ITEM_NAMES_MAP = { T3_MEAT: "Raw Chicken" };
globalThis.getOverridePrice = (itemId, city) => {
  const e = _priceOverrides[itemId]?.[city];
  if (e == null || !e.use) return null;
  const v = e.use === "buy" ? e.buyOrder : e.sellOrder;
  return typeof v === "number" ? v : null;
};
globalThis.getOverrideField = (itemId, city, side) => {
  const e = _priceOverrides[itemId]?.[city];
  if (!e) return null;
  return (side === "buy" ? e.buyOrder : e.sellOrder) ?? null;
};
globalThis.getOrderType = () => "market";
globalThis.getItemDisplayName = (id) => id;

const {
  buildCityOptions, cityOptionHtml, displayOrderDates,
} = require("../js/price-edit-dropdown.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// A timestamp `h` hours in the past, in the shape the price store writes.
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();

function makeMarket(entries) {
  const md = {};
  entries.forEach(({ id, city, buy, sell, vol, buyDate, sellDate }) => {
    if (!md[id]) md[id] = {};
    md[id][city] = {
      buy_price: buy ?? 0,
      sell_price: sell ?? 0,
      volume_24h: vol ?? 100,
      buy_date: buyDate,
      sell_date: sellDate,
    };
  });
  return md;
}

function setOverride(itemId, city, price, use = "buy") {
  if (!_priceOverrides[itemId]) _priceOverrides[itemId] = {};
  const e = { use };
  e[use === "buy" ? "buyOrder" : "sellOrder"] = price;
  _priceOverrides[itemId][city] = e;
}

const optFor = (r, city) => r.options.find((o) => o.city === city);

console.log("\n=== Price-edit dropdown: price age ===");

// ----- Label: one age per side -----

test("label: each order carries its OWN age (sell_date / buy_date)", () => {
  _priceOverrides = {};
  const market = makeMarket([{
    id: "T5_VINEHEART", city: "Martlock", sell: 2950, buy: 1812, vol: 14219,
    sellDate: ago(2), buyDate: ago(26),
  }]);
  const r = buildCityOptions("T5_VINEHEART", "buy", market);
  assert.strictEqual(
    optFor(r, "Martlock").label,
    "Martlock — 2,950 (2h ago) · 1,812 (1d ago) · 14,219 vol",
  );
});

test("label: an undated side prints no parentheses, the dated one still does", () => {
  _priceOverrides = {};
  const market = makeMarket([{
    id: "T5_VINEHEART", city: "Caerleon", sell: 950, buy: 900, vol: 3763,
    sellDate: ago(2),
  }]);
  const r = buildCityOptions("T5_VINEHEART", "sell", market);
  assert.strictEqual(optFor(r, "Caerleon").label, "Caerleon — 950 (2h ago) · 900 · 3,763 vol");
});

test("label: an unparseable date (AODP 0001-01-01) prints no parentheses", () => {
  _priceOverrides = {};
  const market = makeMarket([{
    id: "T5_VINEHEART", city: "Thetford", sell: 500, buy: 400, vol: 0,
    sellDate: "0001-01-01T00:00:00", buyDate: "0001-01-01T00:00:00",
  }]);
  const r = buildCityOptions("T5_VINEHEART", "buy", market);
  assert.strictEqual(optFor(r, "Thetford").label, "Thetford — 500 · 400");
});

test("label: no age beside an absent price, even when that book is dated", () => {
  // The ask is gone but its date survives in the entry. An age there would put
  // a timestamp on an em dash.
  _priceOverrides = {};
  const market = makeMarket([{
    id: "T5_VINEHEART", city: "Lymhurst", sell: 0, buy: 1404, vol: 0,
    sellDate: ago(3), buyDate: ago(3),
  }]);
  const r = buildCityOptions("T5_VINEHEART", "buy", market);
  assert.strictEqual(optFor(r, "Lymhurst").label, "Lymhurst — — · 1,404 (3h ago)");
});

test("label: an overridden side loses its age; the other side keeps its own", () => {
  _priceOverrides = {};
  const market = makeMarket([{
    id: "T5_VINEHEART", city: "Thetford", sell: 2000, buy: 1800, vol: 500,
    sellDate: ago(2), buyDate: ago(2),
  }]);
  setOverride("T5_VINEHEART", "Thetford", 1200, "buy");
  const r = buildCityOptions("T5_VINEHEART", "buy", market);
  assert.strictEqual(
    optFor(r, "Thetford").label,
    "Thetford — 2,000 (2h ago) · 1,200 · 500 vol ⚡",
  );
});

test("label: volume still renders when neither book is dated", () => {
  _priceOverrides = {};
  const market = makeMarket([
    { id: "T5_VINEHEART", city: "Martlock", sell: 2950, buy: 1812, vol: 14219 },
  ]);
  const r = buildCityOptions("T5_VINEHEART", "buy", market);
  assert.strictEqual(optFor(r, "Martlock").label, "Martlock — 2,950 · 1,812 · 14,219 vol");
});

test("label: the ramp's own wording is used (minutes under the hour)", () => {
  _priceOverrides = {};
  const market = makeMarket([{
    id: "T5_VINEHEART", city: "Caerleon", sell: 950, buy: 900, vol: 0,
    sellDate: ago(0.5), buyDate: ago(10),
  }]);
  const r = buildCityOptions("T5_VINEHEART", "sell", market);
  assert.strictEqual(optFor(r, "Caerleon").label, "Caerleon — 950 (30m ago) · 900 (10h ago)");
});

// ----- displayOrderDates -----

test("displayOrderDates: an override on one side nulls that date only", () => {
  _priceOverrides = {};
  setOverride("T5_VINEHEART", "Bridgewatch", 1500, "buy");
  const entry = { sell_date: ago(2), buy_date: ago(2) };
  const d = displayOrderDates("T5_VINEHEART", "Bridgewatch", entry);
  assert.strictEqual(d.buyDate, null);
  assert.strictEqual(d.sellDate, entry.sell_date);
});

test("displayOrderDates: no entry at all yields two nulls", () => {
  _priceOverrides = {};
  const d = displayOrderDates("T5_VINEHEART", "Bridgewatch", undefined);
  assert.deepStrictEqual(d, { sellDate: null, buyDate: null });
});

// ----- cityOptionHtml -----

test("html: price, age and volume land in three different spans", () => {
  _priceOverrides = {};
  const market = makeMarket([{
    id: "T5_VINEHEART", city: "Martlock", sell: 2950, buy: 1812, vol: 14219,
    sellDate: ago(2), buyDate: ago(26),
  }]);
  const r = buildCityOptions("T5_VINEHEART", "buy", market);
  const html = cityOptionHtml(optFor(r, "Martlock"));
  assert.ok(html.includes('<span class="pe-opt-price">2,950</span>'), "sell price span");
  assert.ok(html.includes('<span class="pe-opt-price">1,812</span>'), "buy price span");
  assert.ok(html.includes('<span class="pe-opt-vol">14,219 vol</span>'), "volume span");
  assert.ok(html.includes("pe-opt-age"), "age span");
});

test("html: the ramp colour is inline on the age, never on the price", () => {
  _priceOverrides = {};
  const market = makeMarket([{
    id: "T5_VINEHEART", city: "Martlock", sell: 2950, buy: 1812, vol: 0,
    sellDate: ago(2), buyDate: ago(26),
  }]);
  const r = buildCityOptions("T5_VINEHEART", "buy", market);
  const html = cityOptionHtml(optFor(r, "Martlock"));
  assert.ok(html.includes(`<span class="pe-opt-age" style="color:${GREEN}">(2h ago)</span>`));
  assert.ok(html.includes(`<span class="pe-opt-age" style="color:${RED}">(1d ago)</span>`));
  assert.ok(!/pe-opt-price" style/.test(html), "the price span carries no colour");
});

test("html: the amber bucket reaches the markup too", () => {
  _priceOverrides = {};
  const market = makeMarket([{
    id: "T5_VINEHEART", city: "Caerleon", sell: 950, buy: 0, vol: 0, sellDate: ago(10),
  }]);
  const r = buildCityOptions("T5_VINEHEART", "sell", market);
  const html = cityOptionHtml(optFor(r, "Caerleon"));
  assert.ok(html.includes(`style="color:${AMBER}">(10h ago)</span>`));
});

test("html: an undated book yields a price span and no age span", () => {
  _priceOverrides = {};
  const market = makeMarket([
    { id: "T5_VINEHEART", city: "Martlock", sell: 2950, buy: 1812, vol: 14219 },
  ]);
  const r = buildCityOptions("T5_VINEHEART", "buy", market);
  const html = cityOptionHtml(optFor(r, "Martlock"));
  assert.ok(html.includes('<span class="pe-opt-price">2,950</span>'));
  assert.ok(!html.includes("pe-opt-age"), "no age span");
  assert.ok(html.includes("pe-opt-vol"), "volume survives an undated book");
});

test("html: the override marker is its own span", () => {
  _priceOverrides = {};
  const market = makeMarket([{
    id: "T5_VINEHEART", city: "Thetford", sell: 2000, buy: 1800, vol: 500, sellDate: ago(2),
  }]);
  setOverride("T5_VINEHEART", "Thetford", 1200, "buy");
  const r = buildCityOptions("T5_VINEHEART", "buy", market);
  const html = cityOptionHtml(optFor(r, "Thetford"));
  assert.ok(html.includes('<span class="pe-opt-ov">⚡</span>'));
});

test("html: a no-data row degrades to plain text, no spans", () => {
  _priceOverrides = {};
  const r = buildCityOptions("T5_VINEHEART", "buy", {});
  const html = cityOptionHtml(optFor(r, "Caerleon"));
  assert.strictEqual(html, "Caerleon — no data");
});

test("html: food mode prints the resolved tier name, ages and all", () => {
  _priceOverrides = {};
  const market = makeMarket([{
    id: "T3_MEAT", city: "Caerleon", sell: 130, buy: 100, vol: 2000, buyDate: ago(2),
  }]);
  const r = buildCityOptions("T5_MEAT", "buy", market, { foodMode: true });
  const html = cityOptionHtml(optFor(r, "Caerleon"));
  assert.ok(html.startsWith("Caerleon Raw Chicken — "), html);
  assert.ok(html.includes(`style="color:${GREEN}">(2h ago)</span>`));
});

test("html: the city name is escaped", () => {
  const html = cityOptionHtml({
    city: '<img src=x onerror="boom">', itemId: "T5_VINEHEART", price: 900,
    sell: 950, buy: 900, sellDate: null, buyDate: null, volume: 0, override: false,
  });
  assert.ok(!html.includes("<img"), html);
  assert.ok(html.includes("&lt;img"), html);
});

test("html: an empty meta is survivable", () => {
  assert.strictEqual(cityOptionHtml(null), "");
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
