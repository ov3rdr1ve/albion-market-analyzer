/**
 * A pinned price must come BACK.
 *
 * Every table in the app gets its numbers from getBuyPrice / getSellPrice and
 * picks its cities with findBestBuyCity / findBestSellCity, all in js/utils.js.
 * The whole override feature is those four functions preferring what the user
 * typed over what the market said — but nothing asserted the read-back, only
 * that an edited cell keeps its ⚡ marker. A cell can show the marker and the
 * old number at the same time (that is exactly the Crafting List bug), so the
 * marker is not evidence.
 *
 * Loads the REAL js/utils.js — no replica — so drift in the store's shape is a
 * failure here rather than a silent divergence. No DOM beyond the order-type
 * radio, no API, no storage on disk.
 *
 * Contract under test:
 *   use "auto"       follow the Instant/Market toggle, like an unedited cell
 *   use "buy"/"sell" PINNED — that field wins whatever the toggle says
 *   setCityForce     keeps the pinned city reachable to the route pickers
 *
 * Run: node tests/price-override-readback.test.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");

// ── the sandbox: a fake localStorage and the one radio getOrderType reads ────
const sandbox = `
const localStorage = {
  _d: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};
const _radio = { id: "sort-instant", checked: false };
const document = {
  getElementById(id) { return id === "sort-instant" ? _radio : null; },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  addEventListener() {},
};
const window = {};
`;

const src = sandbox
  + ["utils", "utils-item-ids", "utils-overrides", "utils-focus-fees"].map((n) => fs.readFileSync(path.join(ROOT, "js", n + ".js"), "utf8")).join("\n")
  + `
module.exports = {
  getBuyPrice, getSellPrice, findBestBuyCity, findBestSellCity,
  setOverrideEntry, clearOverridePrice, getOverridePrice, getOverrideField,
  setCityForce, clearCityForce, getIQRBounds,
  setInstant: (on) => { _radio.checked = !!on; },
  reset: () => {
    Object.keys(priceOverrides).forEach((k) => delete priceOverrides[k]);
    Object.keys(cityForceOverrides).forEach((k) => delete cityForceOverrides[k]);
    localStorage._d = {};
  },
};`;

const m = new Module("price-override-readback-test");
m._compile(src, path.join(ROOT, "js", "price-override-readback-test.js"));
const u = m.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

// ── market fixture ──────────────────────────────────────────────────────────
// One item, three cities. buy_price = the bid, sell_price = the ask.
const ITEM = "T5_BAG";
const MARKET = {
  [ITEM]: {
    Martlock:        { buy_price: 1000, sell_price: 1200, volume_24h: 500 },
    Lymhurst:        { buy_price: 1100, sell_price: 1300, volume_24h: 500 },
    "Fort Sterling": { buy_price:  900, sell_price: 1150, volume_24h: 500 },
  },
};
const CITIES = ["Martlock", "Lymhurst", "Fort Sterling"];
const bounds = () => u.getIQRBounds(MARKET[ITEM]);

// What an UNEDITED cell reads, per side × toggle — the baseline every "the
// override wins" assertion is measured against.
const UNEDITED = {
  "buy|market": 1000, // bid
  "buy|instant": 1200, // ask
  "sell|market": 1200, // listing a sell order
  "sell|instant": 1000, // selling into the bid
};

const read = (side, city = "Martlock") =>
  (side === "buy" ? u.getBuyPrice : u.getSellPrice)(MARKET[ITEM], city, bounds(), ITEM);

function withMode(mode, fn) {
  u.setInstant(mode === "instant");
  try { return fn(); } finally { u.setInstant(false); }
}

// ── 1. the baseline (no override) ───────────────────────────────────────────

console.log("\n=== an unedited cell follows the Instant/Market toggle ===");
for (const side of ["buy", "sell"]) {
  for (const mode of ["market", "instant"]) {
    test(`${side} price at ${mode} = ${UNEDITED[`${side}|${mode}`]}`, () => {
      u.reset();
      withMode(mode, () => assert.strictEqual(read(side), UNEDITED[`${side}|${mode}`]));
    });
  }
}

// ── 2. an edited price comes back ───────────────────────────────────────────

console.log("\n=== an edited price is what the tables read ===");

const OV = 7777;
for (const side of ["buy", "sell"]) {
  for (const mode of ["market", "instant"]) {
    test(`use:"${side}" is PINNED — read back on the ${side} side at ${mode}`, () => {
      u.reset();
      u.setOverrideEntry(ITEM, "Martlock", { [`${side}Order`]: OV, use: side });
      withMode(mode, () => assert.strictEqual(read(side), OV, "the typed price must win"));
    });
  }
}

test('use:"auto" with BOTH fields follows the toggle, like an unedited cell', () => {
  u.reset();
  u.setOverrideEntry(ITEM, "Martlock", { buyOrder: 111, sellOrder: 222, use: "auto" });
  // market: buy reads the bid field, sell reads the ask field
  withMode("market", () => {
    assert.strictEqual(read("buy"), 111);
    assert.strictEqual(read("sell"), 222);
  });
  // instant: buy reads the ask, sell reads the bid — the fields swap roles
  withMode("instant", () => {
    assert.strictEqual(read("buy"), 222);
    assert.strictEqual(read("sell"), 111);
  });
});

test('a "sell" pin overrides the BUY-side read too — that is what a pin is for', () => {
  u.reset();
  u.setOverrideEntry(ITEM, "Martlock", { sellOrder: 4242, use: "sell" });
  withMode("market", () => assert.strictEqual(read("buy"), 4242));
  withMode("instant", () => assert.strictEqual(read("buy"), 4242));
});

test("an override applies ONLY at the city it was typed at", () => {
  u.reset();
  u.setOverrideEntry(ITEM, "Martlock", { sellOrder: OV, use: "sell" });
  withMode("market", () => {
    assert.strictEqual(read("sell", "Martlock"), OV);
    assert.strictEqual(read("sell", "Lymhurst"), 1300, "Lymhurst keeps its market price");
  });
});

test("clearing the override hands the cell back to the market", () => {
  u.reset();
  u.setOverrideEntry(ITEM, "Martlock", { sellOrder: OV, use: "sell" });
  u.clearOverridePrice(ITEM, "Martlock");
  withMode("market", () => assert.strictEqual(read("sell"), 1200));
});

test("an override beats the IQR outlier gate that would zero a wild price", () => {
  u.reset();
  // 10× the cluster: an unedited price this far out is discarded as an outlier.
  u.setOverrideEntry(ITEM, "Martlock", { sellOrder: 999999, use: "sell" });
  withMode("market", () => assert.strictEqual(read("sell"), 999999));
});

// ── 3. the route pickers ────────────────────────────────────────────────────

console.log("\n=== a pinned city survives the route pickers ===");

test("findBestBuyCity picks the cheapest when nothing is pinned", () => {
  u.reset();
  withMode("market", () => {
    assert.strictEqual(u.findBestBuyCity(MARKET, ITEM, CITIES, 0).city, "Fort Sterling");
  });
});

test("findBestBuyCity returns the FORCED city even though it is dearer", () => {
  u.reset();
  u.setOverrideEntry(ITEM, "Lymhurst", { buyOrder: 5000, use: "buy" });
  u.setCityForce(ITEM, "buy", "Lymhurst");
  withMode("market", () => {
    const best = u.findBestBuyCity(MARKET, ITEM, CITIES, 0);
    assert.strictEqual(best.city, "Lymhurst");
    assert.strictEqual(best.price, 5000, "and at the pinned price");
  });
});

test("findBestSellCity picks the dearest when nothing is pinned", () => {
  u.reset();
  withMode("market", () => {
    assert.strictEqual(u.findBestSellCity(MARKET, ITEM, CITIES, 0).city, "Lymhurst");
  });
});

test("findBestSellCity returns the FORCED city even though it pays less", () => {
  u.reset();
  u.setOverrideEntry(ITEM, "Fort Sterling", { sellOrder: 300, use: "sell" });
  u.setCityForce(ITEM, "sell", "Fort Sterling");
  withMode("market", () => {
    const best = u.findBestSellCity(MARKET, ITEM, CITIES, 0);
    assert.strictEqual(best.city, "Fort Sterling");
    assert.strictEqual(best.price, 300);
  });
});

test("a force outside the caller's city list is ignored, not obeyed blindly", () => {
  u.reset();
  u.setOverrideEntry(ITEM, "Lymhurst", { sellOrder: 9000, use: "sell" });
  u.setCityForce(ITEM, "sell", "Lymhurst");
  withMode("market", () => {
    // A royal-only / section-locked caller that never offers Lymhurst.
    const best = u.findBestSellCity(MARKET, ITEM, ["Martlock", "Fort Sterling"], 0);
    assert.strictEqual(best.city, "Martlock");
  });
});

test("an overridden city clears the volume gate a thin market would fail", () => {
  u.reset();
  const THIN = { [ITEM]: { Martlock: { buy_price: 10, sell_price: 12, volume_24h: 0 } } };
  u.setOverrideEntry(ITEM, "Martlock", { sellOrder: 8888, use: "sell" });
  withMode("market", () => {
    const best = u.findBestSellCity(THIN, ITEM, ["Martlock"], 25);
    assert.strictEqual(best.city, "Martlock");
    assert.strictEqual(best.price, 8888);
  });
});

// ── 4. overrides survive a reload ───────────────────────────────────────────

console.log("\n=== round trip ===");

test("getOverrideField returns the raw stored side, for the editor prefill", () => {
  u.reset();
  u.setOverrideEntry(ITEM, "Martlock", { buyOrder: 11, sellOrder: 22, use: "auto" });
  assert.strictEqual(u.getOverrideField(ITEM, "Martlock", "buy"), 11);
  assert.strictEqual(u.getOverrideField(ITEM, "Martlock", "sell"), 22);
});

test("an entry whose active side has no value is not stored at all", () => {
  u.reset();
  u.setOverrideEntry(ITEM, "Martlock", { buyOrder: 0, use: "buy" });
  assert.strictEqual(u.getOverridePrice(ITEM, "Martlock"), null);
});

console.log(`\n${passed + failed} run | ${passed} passed | ${failed} failed`);
if (failed > 0) process.exit(1);
