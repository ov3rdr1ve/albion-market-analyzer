/**
 * Test: the Pricing Model is TWO independent toggles — one per leg.
 *
 * The header used to carry a single "Pricing Model" radio group that forced
 * both legs of a trade into the same mode. Real play mixes them: buy patiently
 * with a market order and dump the output into standing bids, or grab mats off
 * the ask now and list the output to wait. So the control is split into a Buy
 * pair (#buy-instant / #buy-market) and a Sell pair (#sell-instant /
 * #sell-market), read through one side-aware primitive:
 *
 *   getOrderType("buy")  -> the Buy radios
 *   getOrderType("sell") -> the Sell radios
 *   getOrderType()       -> the buy side (the historical no-arg meaning)
 *
 * What must follow the side it belongs to:
 *
 *   leg   instant                  market order
 *   buy   reads sell_price (ask)   reads buy_price (bid),  + 2.5% setup fee
 *   sell  reads buy_price  (bid)   reads sell_price (ask), + 2.5% setup fee
 *
 * Two compatibility guarantees are asserted here because ~60 other harnesses
 * depend on them:
 *   - a DOM carrying only the pre-split #sort-instant still drives BOTH sides;
 *   - with no getOrderType in scope at all (plain `require`), the fees fall
 *     back to market orders + Premium, i.e. the historical 0.025 / 0.065.
 *
 * Black-box: compiles the real js/utils.js and js/calculations.js. Synthetic
 * order books only — no market API, no database.
 *
 * Run: node tests/order-type-split-sides.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

// ── Sandbox with the two radio pairs ───────────────────────────────────────
function makeSandbox({ legacyOnly = false } = {}) {
  const state = { buyInstant: true, sellInstant: true, legacyInstant: false, premium: true };
  const radio = (get) => ({ get checked() { return get(); } });
  const elements = legacyOnly
    ? { "sort-instant": radio(() => state.legacyInstant) }
    : {
      "buy-instant": radio(() => state.buyInstant),
      "buy-market": radio(() => !state.buyInstant),
      "sell-instant": radio(() => state.sellInstant),
      "sell-market": radio(() => !state.sellInstant),
    };
  elements["premium-account"] = radio(() => state.premium);

  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  sandbox.document = { getElementById: (id) => elements[id] || null };
  sandbox.localStorage = {
    _d: {},
    getItem(k) { return this._d[k] ?? null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; },
  };
  const ctx = vm.createContext(sandbox);
  const code = J("data-city-bonuses.js") + "\n" + (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) + "\n" + (J("calculations.js") + J("calculations-margins.js"))
    + "\n;globalThis.__exp = { getOrderType, getBuyOrderType, getSellOrderType,"
    + " minLiquidVolume, getIQRBounds, getBuyPrice, getSellPrice, marketSetupFee,"
    + " marketSalesTax, calculateRollingEV,"
    + " get SETUP_FEE() { return SETUP_FEE; }, get PREMIUM_TAX() { return PREMIUM_TAX; } };";
  vm.runInContext(code, ctx, { filename: "order-type-split-sides.js" });
  return { state, api: sandbox.__exp };
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}
const near = (a, b, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) < eps, `expected ${b}, got ${a}`);

const BOOK = { Martlock: { sell_price: 1000, buy_price: 600, volume_24h: 999 } };
const ASK = 1000;
const BID = 600;

// [buyInstant, sellInstant]
const COMBOS = [
  [true, true],
  [true, false],
  [false, true],
  [false, false],
];
const label = (b, s) => `buy ${b ? "instant" : "market"} / sell ${s ? "instant" : "market"}`;

// ── 1. Price-field selection is independent per side ───────────────────────
console.log("price field per side");
COMBOS.forEach(([b, s]) => {
  test(`${label(b, s)}: getBuyPrice reads the ${b ? "ask" : "bid"}`, () => {
    const { state, api } = makeSandbox();
    state.buyInstant = b; state.sellInstant = s;
    assert.strictEqual(api.getBuyPrice(BOOK, "Martlock", null, "X"), b ? ASK : BID);
  });
  test(`${label(b, s)}: getSellPrice reads the ${s ? "bid" : "ask"}`, () => {
    const { state, api } = makeSandbox();
    state.buyInstant = b; state.sellInstant = s;
    assert.strictEqual(api.getSellPrice(BOOK, "Martlock", null, "X"), s ? BID : ASK);
  });
});

test("getOrderType with no argument still means the buy side", () => {
  const { state, api } = makeSandbox();
  state.buyInstant = false; state.sellInstant = true;
  assert.strictEqual(api.getOrderType(), "market");
  assert.strictEqual(api.getOrderType("buy"), "market");
  assert.strictEqual(api.getOrderType("sell"), "instant");
  assert.strictEqual(api.getBuyOrderType(), "market");
  assert.strictEqual(api.getSellOrderType(), "instant");
});

// ── 2. The 2.5% setup fee follows its own leg ──────────────────────────────
console.log("setup fee per side");
[true, false].forEach((premium) => {
  const tax = premium ? 0.04 : 0.08;
  COMBOS.forEach(([b, s]) => {
    const setup = b ? 0 : 0.025;
    const sell = Math.round((tax + (s ? 0 : 0.025)) * 1e6) / 1e6;
    test(`${label(b, s)} / ${premium ? "premium" : "non-premium"}: SETUP_FEE ${setup}, PREMIUM_TAX ${sell}`, () => {
      const { state, api } = makeSandbox();
      state.buyInstant = b; state.sellInstant = s; state.premium = premium;
      near(api.SETUP_FEE, setup);
      near(api.PREMIUM_TAX, sell);
      near(api.marketSetupFee("buy"), setup);
      near(api.marketSetupFee("sell"), s ? 0 : 0.025);
      near(api.marketSalesTax(), tax);
    });
  });
});

test("marketSetupFee() with no argument is the buy leg", () => {
  const { state, api } = makeSandbox();
  state.buyInstant = false; state.sellInstant = true;
  near(api.marketSetupFee(), 0.025);
});

// ── 3. The two sell-side fee sites no longer read the BUY fee ──────────────
// calculateRollingEV values a salvaged artifact at the market fee only. That is
// a sale, so it must follow the SELL toggle: an instant sell pays nothing, a
// market sell pays 2.5% — regardless of how the fragments were bought.
console.log("salvage is priced on the sell leg");
test("salvage value ignores the buy toggle", () => {
  const { state, api } = makeSandbox();
  state.premium = true;
  // Fragment 100, salvage 50 back, the only artifact worth 1 so salvage always wins.
  const run = () => api.calculateRollingEV(100, [1], 50, 1).ev;
  state.sellInstant = true;
  state.buyInstant = true;
  const instantSellFastBuy = run();
  state.buyInstant = false;
  const instantSellSlowBuy = run();
  near(instantSellFastBuy, instantSellSlowBuy);
  near(instantSellFastBuy, 50 * 100); // no sell-side setup fee at all
});
test("salvage value follows the sell toggle", () => {
  const { state, api } = makeSandbox();
  state.premium = true; state.buyInstant = true;
  state.sellInstant = false;
  near(api.calculateRollingEV(100, [1], 50, 1).ev, 50 * 100 * (1 - 0.025));
});

// ── 4. The liquidity gate splits too ───────────────────────────────────────
// A market ORDER needs a real book to fill against; an instant fill does not.
console.log("liquidity gate per side");
COMBOS.forEach(([b, s]) => {
  test(`${label(b, s)}: minLiquidVolume buy ${b ? 0 : 25} / sell ${s ? 0 : 25}`, () => {
    const { state, api } = makeSandbox();
    state.buyInstant = b; state.sellInstant = s;
    assert.strictEqual(api.minLiquidVolume("buy"), b ? 0 : 25);
    assert.strictEqual(api.minLiquidVolume("sell"), s ? 0 : 25);
  });
});

// ── 5. Compatibility: the pre-split DOM still drives both sides ────────────
console.log("legacy #sort-instant DOM");
[true, false].forEach((instant) => {
  test(`#sort-instant ${instant ? "checked" : "unchecked"} drives buy AND sell`, () => {
    const { state, api } = makeSandbox({ legacyOnly: true });
    state.legacyInstant = instant;
    const want = instant ? "instant" : "market";
    assert.strictEqual(api.getOrderType("buy"), want);
    assert.strictEqual(api.getOrderType("sell"), want);
    assert.strictEqual(api.getBuyPrice(BOOK, "Martlock", null, "X"), instant ? ASK : BID);
    assert.strictEqual(api.getSellPrice(BOOK, "Martlock", null, "X"), instant ? BID : ASK);
    near(api.SETUP_FEE, instant ? 0 : 0.025);
    near(api.PREMIUM_TAX, instant ? 0.04 : 0.065);
  });
});

// ── 6. Compatibility: no getOrderType at all ⇒ historical baseline ─────────
console.log("plain require (no DOM, no getOrderType)");
test("defaults to market orders + Premium", () => {
  const bare = require("../js/calculations.js");
  near(bare.SETUP_FEE, 0.025);
  near(bare.PREMIUM_TAX, 0.065);
  near(bare.marketSetupFee("buy"), 0.025);
  near(bare.marketSetupFee("sell"), 0.025);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
