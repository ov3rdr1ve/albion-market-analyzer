/**
 * Test: a price the outlier gate threw away says so, instead of "no data".
 *
 * Reported on the Consumables Caerleon row: "Avalonian Energy @ no data", yet
 * the price editor listed Caerleon at 712,435. Both were true — the book held
 * that ask, and the IQR gate (js/utils.js iqrUpper) rejected it against the
 * ~7,000 every other city quotes — but the cell gave no hint that a price had
 * been seen and ignored. It now reads "outlier ignored", names the rejected
 * number in its tooltip, and stays click-to-set.
 *
 * Two layers, black box:
 *   - rejectedOutlierPrice (js/price-book-fallback.js) against the REAL
 *     getIQRBounds / sideUpper from js/utils.js.
 *   - priceTd / matPriceSpan (js/app.js), compiled against stubs.
 *
 * Run: node tests/price-outlier-label.test.cjs
 */

const fs = require("fs");
const { appSource } = require("./helpers/app-source.cjs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const lift = (src, name) => {
  const m = new RegExp(`\\nfunction ${name}\\([\\s\\S]*?\\n}\\n`).exec(src);
  assert.ok(m, `${name} not found`);
  return m[0];
};
// getIQRBounds references this const, so the lifted realm needs the real
// declaration alongside the lifted functions.
const liftDecl = (src, name) => {
  const m = new RegExp(`\\nconst ${name} = [\\s\\S]*?;\\n`).exec(src);
  assert.ok(m, `${name} not found`);
  return m[0];
};

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name + " — " + e.message); failed++; }
}

const utils = (read("js/utils.js") + read("js/utils-item-ids.js") + read("js/utils-overrides.js") + read("js/utils-focus-fees.js"));
const app = appSource();
const ID = "QUESTITEM_TOKEN_AVALON";
const cell = (buy, sell) => ({ buy_price: buy, sell_price: sell, volume_24h: 100 });
const ROYALS = {
  Brecilien: cell(6240, 6300), Bridgewatch: cell(6590, 7029), "Fort Sterling": cell(6465, 7186),
  Lymhurst: cell(6608, 6938), Martlock: cell(6087, 6680), Thetford: cell(6621, 6989),
};
const WITH_TROLL = { ...ROYALS, Bridgewatch: cell(6870, 712435) };
// Caerleon is exempt from the gate (plan-caerleon-exempt.md), so the troll
// fixtures above pin the rejection rule on Bridgewatch; the exemption itself
// gets its own case next to the Black Market one.

function build(orderType, override = null) {
  const m = new Module("price-outlier-label-" + orderType);
  m._compile(
    `var lastMarketData = {}; var lastQualityMarketData = null;
     function tx(en) { return en; }
     function formatSilver(n) { return String(Math.round(Number(n) || 0)); }
     function getOrderType() { return ${JSON.stringify(orderType)}; }
     function getOverridePrice() { return ${JSON.stringify(override)}; }
     function getOverrideField() { return ${JSON.stringify(override)}; }
     function qualityOverrideKey(id) { return id; }
     function bookDatesTitle() { return "dates"; }
     function formatPriceAge() { return null; }
     ${liftDecl(utils, "IQR_EXEMPT_CITIES")}
     ${lift(utils, "iqrUpper")}
     ${lift(utils, "getIQRBounds")}
     ${lift(utils, "isPriceOutlier")}
     ${lift(utils, "sideUpper")}
     ${read("js/price-book-fallback.js").replace(/if \(typeof module[\s\S]*$/, "")}
     ${read("js/price-freshness.js").replace(/if \(typeof module[\s\S]*$/, "")}
     ${lift(app, "_noInstantOrders")}
     ${lift(app, "_outlierIgnored")}
     ${lift(app, "_outlierIgnoredTip")}
     ${lift(app, "priceTd")}
     ${lift(app, "matPriceSpan")}
     module.exports = { rejectedOutlierPrice, getIQRBounds, isPriceOutlier, priceTd, matPriceSpan, setMarket: (md) => { lastMarketData = md; } };`,
    path.join(ROOT, "js", "price-outlier-label-test.js"),
  );
  return m.exports;
}
const INSTANT = build("instant");
const MARKET = build("market");

console.log("rejectedOutlierPrice\n");

// [label, R, itemData, city, side, want]
[
  ["instant buy reads the troll ask → rejected", INSTANT, WITH_TROLL, "Bridgewatch", "buy", { city: "Bridgewatch", price: 712435 }],
  ["a normal ask is not rejected", INSTANT, WITH_TROLL, "Lymhurst", "buy", null],
  ["market-order buy reads the bid, which is fine", MARKET, WITH_TROLL, "Bridgewatch", "buy", null],
  ["market-order SELL reads the troll ask → rejected", MARKET, WITH_TROLL, "Bridgewatch", "sell", { city: "Bridgewatch", price: 712435 }],
  ["no cell for the city", INSTANT, ROYALS, "Caerleon", "buy", null],
  ["no item data", INSTANT, null, "Caerleon", "buy", null],
  ["anywhere: the one city with a rejected ask", INSTANT, WITH_TROLL, null, "buy", { city: "Bridgewatch", price: 712435 }],
  ["anywhere: nothing rejected", INSTANT, ROYALS, null, "buy", null],
  ["the Black Market is never judged", MARKET, { ...ROYALS, "Black Market": cell(0, 900000) }, "Black Market", "sell", null],
  ["Caerleon is never judged (plan-caerleon-exempt.md)", MARKET, { ...ROYALS, Caerleon: cell(0, 900000) }, "Caerleon", "sell", null],
].forEach(([label, R, data, city, side, want]) => {
  test(label, () => {
    assert.deepStrictEqual(R.rejectedOutlierPrice(data, ID, city, side), want);
  });
});

console.log("\nrendered\n");

test("material span: an ignored outlier says so and stays editable", () => {
  INSTANT.setMarket({ [ID]: WITH_TROLL });
  const html = INSTANT.matPriceSpan(ID, "Bridgewatch", 0);
  assert.ok(html.includes("outlier ignored"), html);
  assert.ok(html.includes("712435"), "the rejected number is not named: " + html);
  assert.ok(html.includes("price-editable") && html.includes(`data-item-id="${ID}"`) && html.includes('data-city="Bridgewatch"'), html);
  assert.ok(!html.includes("no data"), html);
});

test("material span: nothing rejected keeps plain no data", () => {
  INSTANT.setMarket({ [ID]: ROYALS });
  const html = INSTANT.matPriceSpan(ID, "Caerleon", 0);
  assert.ok(html.includes("no data") && !html.includes("outlier ignored"), html);
});

test("material span: a real price prints the price", () => {
  INSTANT.setMarket({ [ID]: WITH_TROLL });
  const html = INSTANT.matPriceSpan(ID, "Lymhurst", 6938);
  assert.ok(html.includes("@ 6938") && !html.includes("outlier ignored"), html);
});

test("material span: an override is shown, never the label", () => {
  const R = build("instant", 5000);
  R.setMarket({ [ID]: WITH_TROLL });
  const html = R.matPriceSpan(ID, "Caerleon", 5000);
  assert.ok(!html.includes("outlier ignored"), html);
});

test("price cell: an ignored outlier on the buy side says so", () => {
  INSTANT.setMarket({ [ID]: WITH_TROLL });
  const html = INSTANT.priceTd(0, ID, "Bridgewatch", "buy");
  assert.ok(html.includes("outlier ignored") && html.includes("712435"), html);
  assert.ok(html.includes("price-editable"), html);
});

test("price cell: a city with nothing keeps no data", () => {
  INSTANT.setMarket({ [ID]: ROYALS });
  const html = INSTANT.priceTd(0, ID, "Caerleon", "buy");
  assert.ok(html.includes("no data") && !html.includes("outlier ignored"), html);
});

test("the Spanish table carries the new strings", () => {
  const es = read("js/i18n-strings-es.js");
  ["r_outlier_ignored_click_to_set", "r_tip_outlier_ignored"].forEach((k) => {
    assert.ok(new RegExp(`${k}\\s*:`).test(es), `ES missing ${k}`);
  });
});

console.log("\nmedian cap (plan-outlier-cap.md): ×4 → ×8 for 3-6 samples, ×3 → ×6 below 3\n");

// The raised caps let genuine red-zone premiums (a Caerleon asking ~3-6× the
// royal median) through the gate while order-of-magnitude junk stays rejected.
//
// Below 3 samples a judged price is itself its pool's upper median, so no
// in-pool value can ever exceed the bound; those cases pin the BOUND through
// the exact expression the gate runs in getBuyPrice/getSellPrice
// (js/utils.js): isPriceOutlier(price, { upper: sideUpper(bounds, side) }).

// n=4 sell pools: three ~1k asks plus the premium city (its own ask is pooled).
// The premium/junk city is a generic royal — Caerleon is exempt from the gate
// entirely now (plan-caerleon-exempt.md), so the cap pins on "D".
const PREMIUM_4 = { A: cell(0, 1000), B: cell(0, 1100), C: cell(0, 1200), D: cell(0, 6000) };
const JUNK_4 = { A: cell(0, 1000), B: cell(0, 1100), C: cell(0, 1200), D: cell(0, 60000) };

[
  ["cap: n=4 — a 6× premium ask is kept (old ×4 cap rejected it)", MARKET, PREMIUM_4, "D", "sell", null],
  ["cap: n=4 — a 50× junk ask is still rejected", MARKET, JUNK_4, "D", "sell", { city: "D", price: 60000 }],
].forEach(([label, R, data, city, side, want]) => {
  test(label, () => {
    assert.deepStrictEqual(R.rejectedOutlierPrice(data, ID, city, side), want);
  });
});

test("cap: n<3 — a 5× median bid is inside the ×6 cap", () => {
  const b = INSTANT.getIQRBounds({ Brecilien: cell(1000, 0), Bridgewatch: cell(1000, 0) });
  assert.strictEqual(INSTANT.isPriceOutlier(5000, { upper: b.buyUpper }), false,
    "a 5× median bid must not be an outlier under the ×6 cap");
});

test("cap: n<3 — a 50× median bid is still an outlier", () => {
  const b = INSTANT.getIQRBounds({ Brecilien: cell(1000, 0), Bridgewatch: cell(1000, 0) });
  assert.strictEqual(INSTANT.isPriceOutlier(50000, { upper: b.buyUpper }), true,
    "order-of-magnitude junk must stay rejected");
});

test("cap: n=4 tight spread — the IQR fence still binds under the raised cap", () => {
  // Sells 1000/1100/1200/1300: q3 + 3·IQR = 1300 + 600 = 1900, BELOW the new
  // cap (1200 × 8 = 9600). 5000 would pass the raised cap yet must still be
  // rejected — by the fence, which stays binding whenever it is tighter.
  const b = MARKET.getIQRBounds({ A: cell(0, 1000), B: cell(0, 1100), C: cell(0, 1200), D: cell(0, 1300) });
  assert.ok(b.sellUpper < 5000 && 5000 < 1200 * 8,
    `fixture must sit between fence (${b.sellUpper}) and cap (9600)`);
  assert.strictEqual(MARKET.isPriceOutlier(5000, { upper: b.sellUpper }), true,
    "the fence, not the cap, must reject this");
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
