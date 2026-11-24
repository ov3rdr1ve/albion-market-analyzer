/**
 * Tests for calculateFees — the pure helper behind the top-of-page
 * Fees Calculator (js/render-fees-calculator.js).
 *
 * Black-box, parameterised. We cover all 4 buy/sell mode combinations,
 * both tax rates (Premium 4% / non-Premium 8%), and edge cases:
 *   - Zero / negative inputs are clamped to zero
 *   - profitPerItem is 0 when quantity is 0 (no NaN)
 *   - marginPct is 0 when buyCost is 0
 *   - Mode strings outside {"instant","market"} fall back to "market"
 *
 * Run: node tests/fees-calculator.test.cjs
 */

const assert = require("assert");
const {
  calculateFees,
  buildSavedRow,
  appendRow,
  removeRow,
  updateRow,
  summarizeTrades,
  SETUP_FEE_RATE,
  PREMIUM_TAX,
  NON_PREMIUM_TAX,
} = require("../js/render-fees-calculator.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}
function approx(actual, expected, eps = 0.0001) {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `expected ~${expected}, got ${actual}`,
  );
}

console.log("=== constants ===");

test("SETUP_FEE_RATE === 0.025", () => assert.strictEqual(SETUP_FEE_RATE, 0.025));
test("PREMIUM_TAX === 0.04",     () => assert.strictEqual(PREMIUM_TAX, 0.04));
test("NON_PREMIUM_TAX === 0.08", () => assert.strictEqual(NON_PREMIUM_TAX, 0.08));

console.log("\n=== buy-side fee per mode ===");

// buyCost = price × qty × (1 + 0 or 0.025 depending on mode)
const buyCases = [
  // [buyMode, expected multiplier]
  ["instant", 1.0],
  ["market",  1.025],
];
buyCases.forEach(([buyMode, mult]) => {
  test(`buyMode='${buyMode}' → buyCost = price×qty×${mult}`, () => {
    const r = calculateFees({ buyPrice: 1000, sellPrice: 0, quantity: 10, buyMode, sellMode: "market", premium: true });
    approx(r.buyCost, 1000 * 10 * mult);
    approx(r.buyGross, 10000);
    approx(r.buySetupFee, buyMode === "market" ? 10000 * 0.025 : 0);
  });
});

console.log("\n=== sell-side fee per mode (Premium=true, 4% tax) ===");

// sellRevenue = price × qty × (1 - tax - setup if market)
const sellCases = [
  // [sellMode, expected post-fee multiplier]
  ["instant", 1 - 0.04],            // 0.96 — tax only
  ["market",  1 - 0.04 - 0.025],    // 0.935 — tax + setup
];
sellCases.forEach(([sellMode, mult]) => {
  test(`sellMode='${sellMode}' → revenue = price×qty×${mult}`, () => {
    const r = calculateFees({ buyPrice: 0, sellPrice: 2000, quantity: 5, buyMode: "instant", sellMode, premium: true });
    approx(r.sellRevenue, 2000 * 5 * mult);
    approx(r.sellGross, 10000);
    approx(r.sellSalesTax, 10000 * 0.04);
    approx(r.sellSetupFee, sellMode === "market" ? 10000 * 0.025 : 0);
  });
});

console.log("\n=== Premium toggle ===");

test("premium=true → 4% sales tax", () => {
  const r = calculateFees({ buyPrice: 0, sellPrice: 10000, quantity: 1, buyMode: "instant", sellMode: "instant", premium: true });
  approx(r.salesTaxRate, 0.04);
  approx(r.sellSalesTax, 400);
  approx(r.sellRevenue, 9600);
});

test("premium=false → 8% sales tax", () => {
  const r = calculateFees({ buyPrice: 0, sellPrice: 10000, quantity: 1, buyMode: "instant", sellMode: "instant", premium: false });
  approx(r.salesTaxRate, 0.08);
  approx(r.sellSalesTax, 800);
  approx(r.sellRevenue, 9200);
});

test("premium omitted → defaults to true (4%)", () => {
  const r = calculateFees({ buyPrice: 0, sellPrice: 1000, quantity: 1, buyMode: "instant", sellMode: "instant" });
  approx(r.salesTaxRate, 0.04);
});

console.log("\n=== all 4 mode combinations, end-to-end ===");

// Worked example: buy 100 units @ 5000, sell 100 units @ 6500, premium on
const baseInputs = { buyPrice: 5000, sellPrice: 6500, quantity: 100, premium: true };
const comboCases = [
  // [buyMode, sellMode, expectedBuyCost, expectedSellRevenue]
  ["instant", "instant", 500000,           650000 * (1 - 0.04)],
  ["market",  "instant", 500000 * 1.025,   650000 * (1 - 0.04)],
  ["instant", "market",  500000,           650000 * (1 - 0.04 - 0.025)],
  ["market",  "market",  500000 * 1.025,   650000 * (1 - 0.04 - 0.025)],
];
comboCases.forEach(([buyMode, sellMode, expBuy, expSell]) => {
  test(`buy=${buyMode}, sell=${sellMode} → buyCost=${expBuy}, revenue=${expSell}`, () => {
    const r = calculateFees({ ...baseInputs, buyMode, sellMode });
    approx(r.buyCost, expBuy);
    approx(r.sellRevenue, expSell);
    approx(r.netProfit, expSell - expBuy);
  });
});

console.log("\n=== profit / margin math ===");

test("profitPerItem = netProfit / quantity", () => {
  const r = calculateFees({ buyPrice: 100, sellPrice: 200, quantity: 7, buyMode: "instant", sellMode: "instant", premium: true });
  approx(r.profitPerItem, r.netProfit / 7);
});

test("marginPct = (netProfit / buyCost) × 100", () => {
  const r = calculateFees({ buyPrice: 1000, sellPrice: 1500, quantity: 10, buyMode: "market", sellMode: "market", premium: true });
  const expectedMargin = (r.netProfit / r.buyCost) * 100;
  approx(r.marginPct, expectedMargin);
});

test("negative profit when sell price too low", () => {
  const r = calculateFees({ buyPrice: 1000, sellPrice: 500, quantity: 1, buyMode: "market", sellMode: "market", premium: true });
  assert.ok(r.netProfit < 0, `expected negative, got ${r.netProfit}`);
  assert.ok(r.marginPct < 0, `expected negative margin, got ${r.marginPct}`);
});

test("zero margin when revenue equals cost exactly", () => {
  // Use instant/instant to keep math simple
  const r = calculateFees({ buyPrice: 960, sellPrice: 1000, quantity: 1, buyMode: "instant", sellMode: "instant", premium: true });
  // buyCost = 960, sellRevenue = 1000 × 0.96 = 960 → profit 0
  approx(r.netProfit, 0);
  approx(r.marginPct, 0);
});

console.log("\n=== edge cases ===");

test("quantity = 0 → all zeros, no NaN", () => {
  const r = calculateFees({ buyPrice: 1000, sellPrice: 2000, quantity: 0, buyMode: "market", sellMode: "market", premium: true });
  approx(r.buyCost, 0);
  approx(r.sellRevenue, 0);
  approx(r.netProfit, 0);
  approx(r.profitPerItem, 0);
  approx(r.marginPct, 0);
  assert.ok(!Number.isNaN(r.profitPerItem));
});

test("buyPrice = 0 → margin = 0 (no divide-by-zero)", () => {
  const r = calculateFees({ buyPrice: 0, sellPrice: 1000, quantity: 5, buyMode: "instant", sellMode: "instant", premium: true });
  approx(r.marginPct, 0);
  assert.ok(r.sellRevenue > 0);
  assert.ok(r.netProfit > 0);
});

test("negative inputs clamp to 0", () => {
  const r = calculateFees({ buyPrice: -100, sellPrice: -200, quantity: -5, buyMode: "market", sellMode: "market", premium: true });
  approx(r.buyCost, 0);
  approx(r.sellRevenue, 0);
  approx(r.netProfit, 0);
});

test("non-numeric strings clamp to 0", () => {
  const r = calculateFees({ buyPrice: "abc", sellPrice: "xyz", quantity: "qq", buyMode: "market", sellMode: "market", premium: true });
  approx(r.buyCost, 0);
  approx(r.sellRevenue, 0);
});

test("numeric strings parsed", () => {
  const r = calculateFees({ buyPrice: "100", sellPrice: "200", quantity: "3", buyMode: "instant", sellMode: "instant", premium: true });
  approx(r.buyGross, 300);
  approx(r.sellGross, 600);
});

test("unknown mode string falls back to 'market'", () => {
  const r = calculateFees({ buyPrice: 1000, sellPrice: 0, quantity: 1, buyMode: "weird", sellMode: "alsoweird", premium: true });
  // both should be treated as market → buy setup fee applied
  approx(r.buySetupFee, 1000 * 0.025);
});

console.log("\n=== returned-shape sanity ===");

test("result includes all documented fields", () => {
  const r = calculateFees({ buyPrice: 1, sellPrice: 1, quantity: 1, buyMode: "market", sellMode: "market", premium: true });
  ["buyGross","buySetupFee","buyCost",
   "sellGross","sellSalesTax","sellSetupFee","sellRevenue",
   "netProfit","profitPerItem","marginPct","salesTaxRate",
   "buyMode","sellMode"].forEach((k) => {
    assert.ok(k in r, `missing field: ${k}`);
  });
});

console.log("\n=== matches PREMIUM_TAX + SETUP_FEE simplification used elsewhere ===");

// Other tables in the app use sellPrice × (1 − 0.065) and buyPrice × (1 + 0.025)
// for market/market trades. Our calculator must match that exactly when both
// sides are 'market' and Premium is on.
test("market/market premium matches (1 - 0.065) sell and (1 + 0.025) buy", () => {
  const r = calculateFees({ buyPrice: 4000, sellPrice: 5000, quantity: 25, buyMode: "market", sellMode: "market", premium: true });
  approx(r.buyCost, 4000 * 25 * 1.025);
  approx(r.sellRevenue, 5000 * 25 * (1 - 0.065));
});

// ═════════════════════════════════════════════════════════════════════
// Saved-Trades helpers (buildSavedRow / appendRow / removeRow / summarize)
// ═════════════════════════════════════════════════════════════════════

console.log("\n=== buildSavedRow shape ===");

const baseState = {
  name: "T6 Bag", city: "Martlock → Caerleon",
  buyPrice: 5000, sellPrice: 6500, quantity: 100,
  buyMode: "market", sellMode: "market", premium: true,
};

test("buildSavedRow returns all documented fields", () => {
  const row = buildSavedRow(baseState, () => "fixed-id");
  const required = ["id", "savedAt", "name", "city", "buyPrice", "sellPrice",
    "quantity", "buyMode", "sellMode", "premium",
    "buyCost", "sellRevenue", "netProfit", "marginPct", "salesTaxRate"];
  required.forEach((k) => assert.ok(k in row, `missing field: ${k}`));
});

test("buildSavedRow uses injected id fn", () => {
  const row = buildSavedRow(baseState, () => "fixed-id-123");
  assert.strictEqual(row.id, "fixed-id-123");
});

test("buildSavedRow without idFn auto-generates a row_-prefixed id", () => {
  const row = buildSavedRow(baseState);
  assert.ok(/^row_\d+_[a-z0-9]+$/.test(row.id), `bad id: ${row.id}`);
});

test("two auto-generated ids differ", () => {
  const a = buildSavedRow(baseState);
  const b = buildSavedRow(baseState);
  assert.notStrictEqual(a.id, b.id);
});

test("buildSavedRow trims name and city whitespace", () => {
  const row = buildSavedRow({ ...baseState, name: "  T6 Bag  ", city: "  Martlock  " }, () => "i");
  assert.strictEqual(row.name, "T6 Bag");
  assert.strictEqual(row.city, "Martlock");
});

test("buildSavedRow accepts missing name/city as empty strings", () => {
  const row = buildSavedRow({ buyPrice: 1, sellPrice: 1, quantity: 1, buyMode: "instant", sellMode: "instant", premium: true }, () => "i");
  assert.strictEqual(row.name, "");
  assert.strictEqual(row.city, "");
});

test("buildSavedRow copies calculated outputs from calculateFees", () => {
  const row = buildSavedRow(baseState, () => "i");
  const live = calculateFees(baseState);
  assert.strictEqual(row.buyCost, live.buyCost);
  assert.strictEqual(row.sellRevenue, live.sellRevenue);
  assert.strictEqual(row.netProfit, live.netProfit);
  assert.strictEqual(row.marginPct, live.marginPct);
});

test("buildSavedRow stores numeric inputs as numbers (not strings)", () => {
  const row = buildSavedRow({ ...baseState, buyPrice: "5000", quantity: "100" }, () => "i");
  assert.strictEqual(typeof row.buyPrice, "number");
  assert.strictEqual(typeof row.quantity, "number");
  assert.strictEqual(row.buyPrice, 5000);
});

test("buildSavedRow clamps negative inputs to 0", () => {
  const row = buildSavedRow({ ...baseState, buyPrice: -100, quantity: -5 }, () => "i");
  assert.strictEqual(row.buyPrice, 0);
  assert.strictEqual(row.quantity, 0);
});

test("buildSavedRow normalizes premium to a boolean", () => {
  const r1 = buildSavedRow({ ...baseState, premium: false }, () => "i");
  const r2 = buildSavedRow({ ...baseState, premium: true }, () => "i");
  assert.strictEqual(r1.premium, false);
  assert.strictEqual(r2.premium, true);
});

test("buildSavedRow premium defaults to true when omitted", () => {
  const r = buildSavedRow({ buyPrice: 1, sellPrice: 1, quantity: 1, buyMode: "market", sellMode: "market" }, () => "i");
  assert.strictEqual(r.premium, true);
});

console.log("\n=== appendRow / removeRow are non-mutating ===");

test("appendRow returns a new array with the row appended", () => {
  const list = [{ id: "a" }, { id: "b" }];
  const out = appendRow({ id: "c" }, list);
  assert.deepStrictEqual(out.map((r) => r.id), ["a", "b", "c"]);
  // original untouched
  assert.deepStrictEqual(list.map((r) => r.id), ["a", "b"]);
  assert.notStrictEqual(out, list);
});

test("appendRow tolerates non-array list (treats as empty)", () => {
  const out = appendRow({ id: "x" }, null);
  assert.deepStrictEqual(out, [{ id: "x" }]);
});

test("removeRow drops the row with matching id", () => {
  const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const out = removeRow("b", list);
  assert.deepStrictEqual(out.map((r) => r.id), ["a", "c"]);
});

test("removeRow returns same-content array when id not found", () => {
  const list = [{ id: "a" }, { id: "b" }];
  const out = removeRow("zzz", list);
  assert.deepStrictEqual(out.map((r) => r.id), ["a", "b"]);
});

test("removeRow does NOT mutate the input list", () => {
  const list = [{ id: "a" }, { id: "b" }];
  removeRow("a", list);
  assert.deepStrictEqual(list.map((r) => r.id), ["a", "b"]);
});

test("removeRow tolerates non-array list", () => {
  assert.deepStrictEqual(removeRow("a", null), []);
  assert.deepStrictEqual(removeRow("a", undefined), []);
});

console.log("\n=== updateRow (edit-in-place) ===");

test("updateRow replaces the matching row, preserving position", () => {
  const list = [{ id: "a", v: 1 }, { id: "b", v: 2 }, { id: "c", v: 3 }];
  const out = updateRow("b", { id: "b", v: 99 }, list);
  assert.deepStrictEqual(out.map((r) => r.id), ["a", "b", "c"]);
  assert.strictEqual(out[1].v, 99);
});

test("updateRow swaps in the exact object passed (by identity)", () => {
  const list = [{ id: "a" }, { id: "b" }];
  const replacement = { id: "b", edited: true };
  const out = updateRow("b", replacement, list);
  assert.strictEqual(out[1], replacement);
});

test("updateRow does NOT mutate the input list or its other rows", () => {
  const rowA = { id: "a", v: 1 };
  const list = [rowA, { id: "b", v: 2 }];
  const out = updateRow("b", { id: "b", v: 5 }, list);
  assert.notStrictEqual(out, list);
  assert.deepStrictEqual(list.map((r) => r.v), [1, 2]); // original untouched
  assert.strictEqual(out[0], rowA);                     // unrelated rows kept by reference
});

test("updateRow returns same-content array when id not found", () => {
  const list = [{ id: "a" }, { id: "b" }];
  const out = updateRow("zzz", { id: "zzz" }, list);
  assert.deepStrictEqual(out.map((r) => r.id), ["a", "b"]);
});

test("updateRow tolerates non-array list", () => {
  assert.deepStrictEqual(updateRow("a", { id: "a" }, null), []);
  assert.deepStrictEqual(updateRow("a", { id: "a" }, undefined), []);
});

test("end-to-end: buildSavedRow with same id + updateRow edits a row in place", () => {
  let list = [buildSavedRow({ ...baseState, buyPrice: 1000, sellPrice: 1200, quantity: 10 }, () => "keep-id")];
  // re-edit the same row: new inputs, SAME id
  const edited = buildSavedRow({ ...baseState, buyPrice: 1000, sellPrice: 2000, quantity: 10 }, () => "keep-id");
  list = updateRow("keep-id", edited, list);
  assert.strictEqual(list.length, 1);                 // no duplicate added
  assert.strictEqual(list[0].id, "keep-id");
  assert.strictEqual(list[0].sellPrice, 2000);        // reflects edited input
  assert.ok(list[0].netProfit > 0);
});

console.log("\n=== summarizeTrades ===");

test("empty list → zeros, count=0", () => {
  const s = summarizeTrades([]);
  assert.deepStrictEqual(s, { count: 0, totalBuyCost: 0, totalRevenue: 0, totalProfit: 0 });
});

test("non-array → zeros (defensive)", () => {
  const s = summarizeTrades(null);
  assert.strictEqual(s.count, 0);
  assert.strictEqual(s.totalProfit, 0);
});

test("single row → totals match that row", () => {
  const row = { buyCost: 100, sellRevenue: 200, netProfit: 100 };
  const s = summarizeTrades([row]);
  assert.strictEqual(s.count, 1);
  assert.strictEqual(s.totalBuyCost, 100);
  assert.strictEqual(s.totalRevenue, 200);
  assert.strictEqual(s.totalProfit, 100);
});

test("multiple rows → sums each numeric column", () => {
  const list = [
    { buyCost: 100, sellRevenue: 150, netProfit: 50 },
    { buyCost: 200, sellRevenue: 280, netProfit: 80 },
    { buyCost: 50,  sellRevenue: 40,  netProfit: -10 },
  ];
  const s = summarizeTrades(list);
  assert.strictEqual(s.count, 3);
  assert.strictEqual(s.totalBuyCost, 350);
  assert.strictEqual(s.totalRevenue, 470);
  assert.strictEqual(s.totalProfit, 120);
});

test("missing numeric fields treated as 0", () => {
  const s = summarizeTrades([{ buyCost: 100 }, { sellRevenue: 200 }, { netProfit: 50 }]);
  assert.strictEqual(s.count, 3);
  assert.strictEqual(s.totalBuyCost, 100);
  assert.strictEqual(s.totalRevenue, 200);
  assert.strictEqual(s.totalProfit, 50);
});

test("end-to-end: build → append × 3 → summarize matches sum of individual profits", () => {
  let list = [];
  const states = [
    { ...baseState, buyPrice: 1000, sellPrice: 1200, quantity: 10 },
    { ...baseState, buyPrice: 500,  sellPrice: 700,  quantity: 20 },
    { ...baseState, buyPrice: 2000, sellPrice: 1900, quantity: 5  }, // loss
  ];
  let i = 0;
  states.forEach((st) => {
    list = appendRow(buildSavedRow(st, () => `id-${i++}`), list);
  });
  assert.strictEqual(list.length, 3);
  const s = summarizeTrades(list);
  const expectedProfit = list.reduce((a, r) => a + r.netProfit, 0);
  assert.strictEqual(s.totalProfit, expectedProfit);
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
