/**
 * Test: Caerleon is exempt from the cross-city outlier gates — both roles,
 * every gate — the treatment the Black Market already gets
 * (plan-caerleon-exempt.md).
 *
 * Why: after the ×8/×6 cap raise (plan-outlier-cap.md) Caerleon rows still read
 * "outlier ignored" — rare items legitimately quote an order of magnitude above
 * the royal median there (a lone royal pair anchors the median low), and no
 * fixed cap covers every real spread. User decision: Caerleon joins the Black
 * Market's exemption, so a Caerleon price is NEVER judged by a cross-city
 * comparison and NEVER pooled into one. Royals keep full gating.
 *
 * Five gates, black box:
 *   1. getBuyPrice / getSellPrice (js/utils.js) return a Caerleon leg ungated.
 *   2. getIQRBounds (js/utils.js) leaves Caerleon out of every pool.
 *   3. rejectedOutlierPrice (js/price-book-fallback.js) never names a Caerleon
 *      leg, so the rendered cell shows the price, not "outlier ignored".
 *   4. clampFallbackOutliers (js/api.js) neither clamps a Caerleon side nor
 *      uses a Caerleon quote as another city's reference.
 *   5. guardInventedPrices (js/invented-price-guard.js) spares Caerleon legs
 *      and takes no reference from them.
 *
 * Controls pin the other half of the deal: a royal leg at the same magnitude
 * is still rejected everywhere, and the Black Market's behavior is unchanged.
 *
 * Run: node tests/caerleon-outlier-exempt.test.cjs
 */

const assert = require("assert");
const { appSource } = require("./helpers/app-source.cjs");
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const stripExports = (src) => src.replace(/if \(typeof module[\s\S]*$/, "");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// ── Realm 1: the real gate — price-book-fallback.js BEFORE utils.js ────────
const sandbox = {};
sandbox.window = sandbox;
sandbox.console = console;
const elements = {
  "sort-instant": { checked: false }, // legacy single toggle: market mode
  "buy-instant": { checked: false },
  "sell-instant": { checked: false },
};
sandbox.document = { getElementById: (id) => elements[id] || null };
sandbox.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};
const ctx = vm.createContext(sandbox);
vm.runInContext(read("js/price-book-fallback.js"), ctx, { filename: "price-book-fallback.js" });
const utilsCode = (read("js/utils.js") + read("js/utils-item-ids.js") + read("js/utils-overrides.js") + read("js/utils-focus-fees.js"))
  + "\n;globalThis.__exp = { getIQRBounds, getBuyPrice, getSellPrice, isPriceOutlier, sideUpper, rejectedOutlierPrice };";
vm.runInContext(utilsCode, ctx, { filename: "utils.js" });
const { getIQRBounds, getBuyPrice, getSellPrice, rejectedOutlierPrice } = sandbox.__exp;

const setMode = (mode) => {
  // The per-side radios win over the legacy toggle when present, so drive all
  // three — the pre-split "both legs move together" behavior.
  const instant = mode === "instant";
  for (const k of Object.keys(elements)) elements[k].checked = instant;
};
const inMode = (mode, fn) => { setMode(mode); try { fn(); } finally { setMode("market"); } };

// ── Realm 2: the rendered cell — app.js lifts over the real gate ───────────
const lift = (src, name) => {
  const m = new RegExp(`\\nfunction ${name}\\([\\s\\S]*?\\n}\\n`).exec(src);
  assert.ok(m, `${name} not found`);
  return m[0];
};
// getBuyPrice / getSellPrice / getIQRBounds reference this const, so the
// lifted realm needs the real declaration alongside the lifted functions.
const liftDecl = (src, name) => {
  const m = new RegExp(`\\nconst ${name} = [\\s\\S]*?;\\n`).exec(src);
  assert.ok(m, `${name} not found`);
  return m[0];
};
function build(orderType) {
  const utils = (read("js/utils.js") + read("js/utils-item-ids.js") + read("js/utils-overrides.js") + read("js/utils-focus-fees.js"));
  const app = appSource();
  const m = new Module("caerleon-outlier-exempt-" + orderType);
  m._compile(
    `var lastMarketData = {}; var lastQualityMarketData = null;
     function tx(en) { return en; }
     function formatSilver(n) { return String(Math.round(Number(n) || 0)); }
     function getOrderType() { return ${JSON.stringify(orderType)}; }
     function getOverridePrice() { return null; }
     function getOverrideField() { return null; }
     function qualityOverrideKey(id) { return id; }
     function bookDatesTitle() { return "dates"; }
     function formatPriceAge() { return null; }
     ${liftDecl(utils, "IQR_EXEMPT_CITIES")}
     ${lift(utils, "iqrUpper")}
     ${lift(utils, "getIQRBounds")}
     ${lift(utils, "isPriceOutlier")}
     ${lift(utils, "sideUpper")}
     ${lift(utils, "_bookLeg")}
     ${lift(utils, "_isSnifferLeg")}
     ${lift(utils, "getBuyPrice")}
     ${lift(utils, "getSellPrice")}
     ${stripExports(read("js/price-book-fallback.js"))}
     ${stripExports(read("js/price-freshness.js"))}
     ${lift(app, "_noInstantOrders")}
     ${lift(app, "_outlierIgnored")}
     ${lift(app, "_outlierIgnoredTip")}
     ${lift(app, "priceTd")}
     ${lift(app, "matPriceSpan")}
     module.exports = {
       rejectedOutlierPrice, getIQRBounds, getBuyPrice, getSellPrice,
       priceTd, matPriceSpan,
       setMarket: (md) => { lastMarketData = md; },
     };`,
    path.join(ROOT, "js", "caerleon-outlier-exempt-test.js"),
  );
  return m.exports;
}
const MARKET_R = build("market");
const INSTANT_R = build("instant");

// ── Realm 3: the two invented-price gates ──────────────────────────────────
const { clampFallbackOutliers } = (() => {
  const m = new Module("caerleon-clamp-test");
  m._compile(
    `const fetch = () => Promise.resolve({ ok: false, status: 0 });
     const document = { getElementById: () => null };\n` + read("js/api.js"),
    "api.js",
  );
  return m.exports;
})();
const { guardInventedPrices } = require(path.join(ROOT, "js", "invented-price-guard.js"));

// ── Fixtures ───────────────────────────────────────────────────────────────
const ID = "QUESTITEM_TOKEN_AVALON";
const BM = "Black Market";
const CAE = "Caerleon";
const entry = (buy, sell) => ({ buy_price: buy, sell_price: sell, volume_24h: 100 });
// Six royal cities quoting a tight 1000-1200 band (median ~1075).
const ROYAL_CITIES = ["Brecilien", "Bridgewatch", "Fort Sterling", "Lymhurst", "Martlock", "Thetford"];
const royals = (ask) => {
  const d = {};
  ROYAL_CITIES.forEach((c, i) => { d[c] = entry(980 + i * 5, ask ?? 1000 + i * 40); });
  return d;
};
const merged = ({ buy = 0, sell = 0, fb = false } = {}) => ({
  buy_price: buy, sell_price: sell, sell_date: null, buy_date: null, volume_24h: 100, used_fallback: fb,
});
const live = ({ bid = 0, ask = 0 } = {}) => ({ bid, ask });
const real = (buy, sell, extra = {}) => ({
  buy_price: buy, sell_price: sell, buy_date: "2026-09-11T06:00:00", sell_date: "2026-09-11T06:00:00",
  volume_24h: 1000, used_fallback: false, sell_fallback: false, buy_fallback: false, ...extra,
});

// Caerleon at ~50× the royal median — the reported shape (rare mounts, thin
// books): 1-2 royal quotes anchor the median low, the ask is legitimate.
const CAE_50X = { ...royals(), [CAE]: entry(0, 55000) };
const CAE_50X_BID = { ...royals(), [CAE]: entry(54000, 0) };

console.log("1. The gate: a Caerleon leg is returned however far above the royal median\n");

test("getBuyPrice returns a Caerleon ask 50× the royal median (instant reads the ask)", () => {
  inMode("instant", () => {
    assert.strictEqual(getBuyPrice(CAE_50X, CAE, getIQRBounds(CAE_50X), ID), 55000);
  });
});

test("getSellPrice returns a Caerleon ask 50× the royal median (market)", () => {
  assert.strictEqual(getSellPrice(CAE_50X, CAE, getIQRBounds(CAE_50X), ID), 55000);
});

test("getSellPrice returns a Caerleon BID far above the royal bids (instant)", () => {
  inMode("instant", () => {
    assert.strictEqual(getSellPrice(CAE_50X_BID, CAE, getIQRBounds(CAE_50X_BID), ID), 54000);
  });
});

test("getBuyPrice returns a Caerleon BID far above the royal bids (market)", () => {
  assert.strictEqual(getBuyPrice(CAE_50X_BID, CAE, getIQRBounds(CAE_50X_BID), ID), 54000);
});

console.log("\n2. The pools: Caerleon is in neither reference distribution\n");

["sellUpper", "buyUpper"].forEach((field) => {
  const data = field === "sellUpper" ? CAE_50X : CAE_50X_BID;
  test(`${field} is identical with and without the Caerleon entry`, () => {
    const without = {};
    Object.entries(data).forEach(([c, v]) => { if (c !== CAE) without[c] = v; });
    assert.strictEqual(getIQRBounds(data)[field], getIQRBounds(without)[field]);
  });
});

test("royal junk is still rejected by a fence Caerleon's huge quote cannot lift", () => {
  const data = { ...royals(), [CAE]: entry(0, 55000), "Fort Sterling": entry(0, 999999) };
  assert.strictEqual(getSellPrice(data, "Fort Sterling", getIQRBounds(data), ID), 0,
    "the typo ask must still be rejected");
});

console.log("\n3. The label: rejectedOutlierPrice never names a Caerleon leg\n");

test("rejectedOutlierPrice never reports the Caerleon ask (explicit city)", () => {
  assert.strictEqual(rejectedOutlierPrice(CAE_50X, ID, CAE, "sell"), null);
});

test("rejectedOutlierPrice never reports the Caerleon ask (anywhere)", () => {
  assert.strictEqual(rejectedOutlierPrice(CAE_50X, ID, null, "sell"), null);
});

test("rejectedOutlierPrice never reports the Caerleon ask on an instant buy leg", () => {
  inMode("instant", () => {
    assert.strictEqual(rejectedOutlierPrice(CAE_50X, ID, CAE, "buy"), null);
  });
});

test("rendered sell cell: the Caerleon price prints, not 'outlier ignored'", () => {
  MARKET_R.setMarket({ [ID]: CAE_50X });
  const p = MARKET_R.getSellPrice(CAE_50X, CAE, MARKET_R.getIQRBounds(CAE_50X), ID);
  const html = MARKET_R.priceTd(p, ID, CAE, "sell");
  assert.ok(p > 0, "the gate must return the price, got " + p);
  assert.ok(!html.includes("outlier ignored"), html);
  assert.ok(html.includes("55000"), html);
});

test("rendered material span: an instant buy at Caerleon prints the ask", () => {
  INSTANT_R.setMarket({ [ID]: CAE_50X });
  const p = INSTANT_R.getBuyPrice(CAE_50X, CAE, INSTANT_R.getIQRBounds(CAE_50X), ID);
  const html = INSTANT_R.matPriceSpan(ID, CAE, p);
  assert.ok(p > 0, "the gate must return the price, got " + p);
  assert.ok(!html.includes("outlier ignored"), html);
  assert.ok(html.includes("55000"), html);
});

console.log("\n4. The clamp: Caerleon is neither clamped nor a reference\n");

test("a Caerleon history-invented ask 50× the live refs survives", () => {
  const cityMap = {
    [CAE]: merged({ sell: 55000, fb: true }),
    Lymhurst: merged({ sell: 1100 }),
    Martlock: merged({ sell: 1200 }),
  };
  const liveMap = { [CAE]: live(), Lymhurst: live({ ask: 1100 }), Martlock: live({ ask: 1200 }) };
  clampFallbackOutliers(cityMap, liveMap);
  assert.strictEqual(cityMap[CAE].sell_price, 55000);
});

test("a stale-low Caerleon history-invented side survives too (÷3 band dropped)", () => {
  const cityMap = {
    [CAE]: merged({ sell: 30, fb: true }),
    Lymhurst: merged({ sell: 1100 }),
    Martlock: merged({ sell: 1200 }),
  };
  const liveMap = { [CAE]: live(), Lymhurst: live({ ask: 1100 }), Martlock: live({ ask: 1200 }) };
  clampFallbackOutliers(cityMap, liveMap);
  assert.strictEqual(cityMap[CAE].sell_price, 30);
});

test("a live Caerleon bid never anchors another city's clamp", () => {
  // If Caerleon counted, the buy refs would be [1000, 500000] → median 250500
  // → Bridgewatch's invented 40000 outside every band → dropped. With Caerleon
  // exempt there is ONE reference, too weak to reject on.
  const cityMap = {
    Bridgewatch: merged({ buy: 40000, fb: true }),
    Lymhurst: merged({ buy: 1000 }),
    [CAE]: merged({ buy: 500000 }),
  };
  const liveMap = {
    Bridgewatch: live({ ask: 42000 }),
    Lymhurst: live({ bid: 1000 }),
    [CAE]: live({ bid: 500000 }),
  };
  clampFallbackOutliers(cityMap, liveMap);
  assert.strictEqual(cityMap.Bridgewatch.buy_price, 40000);
});

console.log("\n5. The invented guard: Caerleon legs are spared and no reference\n");

function ROYAL_REALS() {
  const d = {};
  ROYAL_CITIES.forEach((c, i) => { d[c] = real(980 + i * 5, 1000 + i * 40); });
  return d;
}

test("guardInventedPrices spares a Caerleon ask invented at 50× the royals", () => {
  const map = {
    ...ROYAL_REALS(),
    [CAE]: { ...real(6870, 55000), used_fallback: true, sell_fallback: true },
  };
  guardInventedPrices(map);
  assert.strictEqual(map[CAE].sell_price, 55000);
});

test("a real Caerleon quote is not a reference for the guard", () => {
  // Refs WITH Caerleon: [1000, 1200, 1300] → median 1200 → band tops at 3600
  // → the invented 3400 survives. Without it: [1000, 1200] → median 1100 →
  // band tops at 3300 → the 3400 is dropped. Caerleon must not shield it.
  const map = {
    Lymhurst: real(0, 1000),
    Martlock: real(0, 1200),
    [CAE]: real(0, 1300),
    Bridgewatch: { ...real(0, 3400), used_fallback: true, sell_fallback: true },
  };
  guardInventedPrices(map);
  assert.strictEqual(map.Bridgewatch.sell_price, 0,
    "the invented ask must be judged by the royals alone");
});

console.log("\n6. Controls: a royal leg at the same magnitude is still rejected everywhere\n");

test("a royal ask 50× the median is still rejected by getSellPrice", () => {
  const data = { ...royals(), "Fort Sterling": entry(0, 55000) };
  assert.strictEqual(getSellPrice(data, "Fort Sterling", getIQRBounds(data), ID), 0);
});

test("a royal bid 50× the median is still rejected by getBuyPrice", () => {
  const data = royals(0);
  data["Fort Sterling"] = entry(54000, 0);
  assert.strictEqual(getBuyPrice(data, "Fort Sterling", getIQRBounds(data), ID), 0);
});

test("rejectedOutlierPrice still names the royal troll", () => {
  const data = { ...royals(), "Fort Sterling": entry(0, 999999) };
  const hit = rejectedOutlierPrice(data, ID, "Fort Sterling", "sell");
  assert.ok(hit, "expected Fort Sterling to be named");
  assert.strictEqual(hit.city, "Fort Sterling");
  assert.strictEqual(hit.price, 999999);
});

test("a royal history-invented side is still clamped", () => {
  const cityMap = {
    Bridgewatch: merged({ sell: 55000, fb: true }),
    Lymhurst: merged({ sell: 1100 }),
    Martlock: merged({ sell: 1200 }),
  };
  const liveMap = { Bridgewatch: live(), Lymhurst: live({ ask: 1100 }), Martlock: live({ ask: 1200 }) };
  clampFallbackOutliers(cityMap, liveMap);
  assert.strictEqual(cityMap.Bridgewatch.sell_price, 0);
});

test("a royal invented side is still guarded", () => {
  const map = {
    Lymhurst: real(0, 1000),
    Martlock: real(0, 1100),
    Bridgewatch: { ...real(0, 55000), used_fallback: true, sell_fallback: true },
  };
  guardInventedPrices(map);
  assert.strictEqual(map.Bridgewatch.sell_price, 0);
});

console.log("\n7. Mirrors: the Black Market treatment is unchanged and joined, not altered\n");

test("mirror: the BM premium ask is still returned by getSellPrice", () => {
  const data = { ...royals(), [BM]: entry(0, 900000) };
  assert.strictEqual(getSellPrice(data, BM, getIQRBounds(data), ID), 900000);
});

test("mirror: the BM is still in neither pool", () => {
  const withBm = { ...royals(), [BM]: entry(2686, 3093) };
  const without = {};
  Object.entries(withBm).forEach(([c, v]) => { if (c !== BM) without[c] = v; });
  assert.strictEqual(getIQRBounds(withBm).sellUpper, getIQRBounds(without).sellUpper);
  assert.strictEqual(getIQRBounds(withBm).buyUpper, getIQRBounds(without).buyUpper);
});

test("mirror: rejectedOutlierPrice still never judges the Black Market", () => {
  const data = { ...royals(), [BM]: entry(0, 900000) };
  assert.strictEqual(rejectedOutlierPrice(data, ID, BM, "sell"), null);
});

test("mirror: the BM is neither clamped nor a reference (clamp twins)", () => {
  const cityMap = {
    [BM]: merged({ buy: 500000, fb: true }),
    Lymhurst: merged({ buy: 1000 }),
    Martlock: merged({ buy: 1000 }),
    Thetford: merged({ buy: 1200 }),
  };
  const liveMap = {
    [BM]: live({ ask: 520000 }),
    Lymhurst: live({ bid: 1000 }),
    Martlock: live({ bid: 1000 }),
    Thetford: live({ bid: 1200 }),
  };
  clampFallbackOutliers(cityMap, liveMap);
  assert.strictEqual(cityMap[BM].buy_price, 500000, "BM premium is legitimate");

  const cityMap2 = {
    [BM]: merged({ buy: 500000 }),
    Lymhurst: merged({ buy: 1000 }),
    Bridgewatch: merged({ buy: 40000, fb: true }),
  };
  const liveMap2 = {
    [BM]: live({ bid: 500000 }),
    Lymhurst: live({ bid: 1000 }),
    Bridgewatch: live({ ask: 42000 }),
  };
  clampFallbackOutliers(cityMap2, liveMap2);
  assert.strictEqual(cityMap2.Bridgewatch.buy_price, 40000,
    "the BM bid must not anchor Bridgewatch's clamp");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
