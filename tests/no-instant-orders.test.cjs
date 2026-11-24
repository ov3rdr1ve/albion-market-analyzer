/**
 * Test: an Instant buy with buy orders but no sell orders says "no instant
 * orders" and stays click-to-set.
 *
 * Reported 2026-09-11 on the Crafting Planner: a Tame Firewing Drake was bought
 * "@ 1,500,003 ea (from Fort Sterling)" — a standing BUY order, in a market with
 * no seller. Once that fallback was stopped the row quoted Martlock's bid
 * instead. User's call: an Instant buy never reads a bid; the cell shows "no
 * instant orders" with the option to set a price.
 *
 * Two layers, black box:
 *   - onlyBuyOrders (js/price-book-fallback.js): someone is bidding, nobody is
 *     selling — at one city, or across every city of the item.
 *   - priceTd / matPriceSpan (js/app.js), compiled against stubs: the label, and
 *     the editable span kept intact.
 *
 * Run: node tests/no-instant-orders.test.cjs
 */

const fs = require("fs");
const { appSource } = require("./helpers/app-source.cjs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name + " — " + e.message); failed++; }
}

const ID = "T8_FARM_DRAKE_GROWN";
const FS = "Fort Sterling";
const MARTLOCK = "Martlock";
const cell = (buy, sell) => ({ buy_price: buy, sell_price: sell, volume_24h: 0 });

// ── onlyBuyOrders ──────────────────────────────────────────────────────────
function helper() {
  const m = new Module("no-instant-orders-helper");
  m._compile(
    `var lastMarketData = null; var lastQualityMarketData = null;
     ${read("js/price-book-fallback.js").replace(/if \(typeof module[\s\S]*$/, "")}
     module.exports = { onlyBuyOrders, setMaps(f, q) { lastMarketData = f; lastQualityMarketData = q; } };`,
    path.join(ROOT, "js", "no-instant-orders-helper-test.js"),
  );
  return m.exports;
}
const H = helper();

console.log("No instant orders — detection\n");

// [label, itemData, city, want]
[
  ["a bid and no ask at the city", { [FS]: cell(1500003, 0) }, FS, true],
  ["an ask at the city", { [FS]: cell(1500003, 1800000) }, FS, false],
  ["an ask and no bid", { [FS]: cell(0, 1800000) }, FS, false],
  ["an empty cell", { [FS]: cell(0, 0) }, FS, false],
  ["no cell for the city", { [MARTLOCK]: cell(2000012, 0) }, FS, false],
  ["no item data at all", null, FS, false],
  ["item-wide: bids somewhere, asks nowhere", { [FS]: cell(1500003, 0), [MARTLOCK]: cell(2000012, 0), Lymhurst: cell(0, 0) }, null, true],
  ["item-wide: an ask in any city", { [FS]: cell(1500003, 0), [MARTLOCK]: cell(0, 2500000) }, null, false],
  ["item-wide: nothing anywhere", { [FS]: cell(0, 0) }, null, false],
].forEach(([label, data, city, want]) => {
  test(`onlyBuyOrders — ${label}`, () => {
    H.setMaps(null, null);
    assert.strictEqual(H.onlyBuyOrders(data, ID, city), want);
  });
});

test("onlyBuyOrders — a Good ask on the live cell is a seller", () => {
  const flat = { [ID]: { [FS]: cell(1500003, 0) } };
  H.setMaps(flat, { [ID]: { 1: { [FS]: cell(1500003, 0) }, 2: { [FS]: cell(0, 1900000) } } });
  assert.strictEqual(H.onlyBuyOrders(flat[ID], ID, FS), false);
});

test("onlyBuyOrders — a Good bid on the live cell is a buyer", () => {
  const flat = { [ID]: { [FS]: cell(0, 0) } };
  H.setMaps(flat, { [ID]: { 1: { [FS]: cell(0, 0) }, 3: { [FS]: cell(1400000, 0) } } });
  assert.strictEqual(H.onlyBuyOrders(flat[ID], ID, FS), true);
});

// ── the rendered label ─────────────────────────────────────────────────────
const appSrc = appSource();
const priceTdSrc = /\nfunction priceTd\([\s\S]*?\n}\n/.exec(appSrc);
const matSpanSrc = /\nfunction matPriceSpan\([\s\S]*?\n}\n/.exec(appSrc);
const labelSrc = /\nfunction _noInstantOrders\([\s\S]*?\n}\n/.exec(appSrc);
assert.ok(priceTdSrc && matSpanSrc && labelSrc, "priceTd / matPriceSpan / _noInstantOrders missing from js/app.js");

function renderer(orderType, override = null) {
  const m = new Module("no-instant-orders-render-" + orderType);
  m._compile(
    `var lastMarketData = {}; var lastQualityMarketData = null;
     function tx(en) { return en; }
     function formatSilver(n) { return String(Math.round(Number(n) || 0)); }
     function getOrderType() { return ${JSON.stringify(orderType)}; }
     function getOverridePrice() { return ${JSON.stringify(override)}; }
     function getOverrideField() { return ${JSON.stringify(override)}; }
     function qualityOverrideKey(id) { return id; }
     function bookDatesTitle() { return "dates"; }
     function formatPriceAge(d) { return d ? { label: "5m ago", color: "#9ca3af" } : null; }
     ${read("js/price-book-fallback.js").replace(/if \(typeof module[\s\S]*$/, "")}
     ${read("js/price-freshness.js").replace(/if \(typeof module[\s\S]*$/, "")}
     ${labelSrc[0]}
     ${priceTdSrc[0]}
     ${matSpanSrc[0]}
     module.exports = { priceTd, matPriceSpan, setMarket: (md) => { lastMarketData = md; } };`,
    path.join(ROOT, "js", "no-instant-orders-render-test.js"),
  );
  return m.exports;
}
const INSTANT = renderer("instant");
const MARKET = renderer("market");
const LABEL = "no instant orders";

console.log("\nNo instant orders — rendered\n");

const DRAKE = { [FS]: cell(1500003, 0), [MARTLOCK]: cell(2000012, 0) };

test("price cell: instant buy at a bid-only market says no instant orders", () => {
  INSTANT.setMarket({ [ID]: DRAKE });
  const html = INSTANT.priceTd(0, ID, FS, "buy");
  assert.ok(html.includes(LABEL), html);
  assert.ok(html.includes("click to set"), "the edit invitation was lost: " + html);
  assert.ok(html.includes("price-editable") && html.includes(`data-item-id="${ID}"`) && html.includes(`data-city="${FS}"`));
  assert.ok(!html.includes("no data"), "both labels at once: " + html);
});

[
  ["a market-order buy cell", MARKET, { [ID]: DRAKE }, "buy"],
  ["an instant SELL cell", INSTANT, { [ID]: DRAKE }, "sell"],
  ["a city with nothing at all", INSTANT, { [ID]: { [FS]: cell(0, 0) } }, "buy"],
].forEach(([label, R, market, side]) => {
  test(`price cell: ${label} keeps the plain no data`, () => {
    R.setMarket(market);
    const html = R.priceTd(0, ID, FS, side);
    assert.ok(!html.includes(LABEL), html);
    assert.ok(html.includes("no data"), html);
  });
});

test("price cell: an overridden price is shown, never the label", () => {
  const R = renderer("instant", 1234);
  R.setMarket({ [ID]: DRAKE });
  const html = R.priceTd(1234, ID, FS, "buy");
  assert.ok(!html.includes(LABEL), html);
});

test("planner material: no sell order in any city says no instant orders", () => {
  INSTANT.setMarket({ [ID]: DRAKE });
  // Unsourced: the planner passes the craft city, which has no cell of its own.
  const html = INSTANT.matPriceSpan(ID, "Lymhurst", 0);
  assert.ok(html.includes(LABEL), html);
  assert.ok(html.includes("click to set"), html);
  assert.ok(html.includes("price-editable") && html.includes('data-city-list="buy"'), "edit affordance lost: " + html);
  assert.ok(!html.includes("no data"), html);
});

test("planner material: a real price still prints the price", () => {
  INSTANT.setMarket({ [ID]: DRAKE });
  const html = INSTANT.matPriceSpan(ID, FS, 1800000);
  assert.ok(html.includes("@ 1800000"), html);
  assert.ok(!html.includes(LABEL), html);
});

test("planner material: nothing known anywhere keeps no data", () => {
  INSTANT.setMarket({ [ID]: { [FS]: cell(0, 0) } });
  const html = INSTANT.matPriceSpan(ID, FS, 0);
  assert.ok(html.includes("no data") && !html.includes(LABEL), html);
});

test("planner material: market orders keep no data", () => {
  MARKET.setMarket({ [ID]: { [FS]: cell(0, 1800000) } });
  const html = MARKET.matPriceSpan(ID, FS, 0);
  assert.ok(!html.includes(LABEL), html);
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
