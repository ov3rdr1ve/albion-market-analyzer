/**
 * Test: cross-city sanity clamp on history-derived (fallback) prices.
 *
 * Why this exists: mergeEntryWithHistory fills a MISSING side from the 24h
 * history avg_price, sanity-bounded only against the OTHER side at the SAME
 * city. When that same-city anchor is itself a lone troll listing, the derived
 * price inherits the nonsense — e.g. T7_PLANKS at Caerleon showed a fallback
 * bid of 76,930 while Fort Sterling (10,056) and Lymhurst (8,589) carried the
 * real bids. That single value drove 83% of the T8 Tinker laborer payload.
 *
 * clampFallbackOutliers(cityMap, liveMap) is the second gate: a price that was
 * INVENTED from history is dropped when it sits outside [ref/3, ref×3], where
 * `ref` is the median of the same side's genuinely LIVE prices across the other
 * cities. Live prices are never touched — a real listing is real data, and is
 * gated elsewhere by the IQR bounds.
 *
 * Black Market is excluded from both the reference pool and the clamp: it
 * trades at a structurally different level from the royal markets. Caerleon
 * joined it (plan-caerleon-exempt.md), so the clamp's rules pin on royal cities
 * (Bridgewatch below) and Caerleon's exemption gets its own twin cases.
 *
 * Run: node tests/api-cross-city-fallback-clamp.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const apiSrc = fs.readFileSync(path.join(__dirname, "..", "js", "api.js"), "utf8");
const mod = new Module("api-cross-city-fallback-clamp-test");
const sandbox = `
const fetch = () => Promise.resolve({ ok: false, status: 0 });
const document = { getElementById: () => null };
`;
mod._compile(sandbox + apiSrc, "api.js");
const { clampFallbackOutliers } = mod.exports;

assert.ok(
  typeof clampFallbackOutliers === "function",
  "api.js must export clampFallbackOutliers for testability",
);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// Merged-entry shape as produced by mergeEntryWithHistory.
function merged({ buy = 0, sell = 0, fb = false } = {}) {
  return {
    buy_price: buy,
    sell_price: sell,
    sell_date: null,
    buy_date: null,
    volume_24h: 100,
    used_fallback: fb,
  };
}
// Raw AODP live sides for the same city (0 = no live order that side).
function live({ bid = 0, ask = 0 } = {}) {
  return { bid, ask };
}

// ──────────────────────────────────────────────────────────────────────────
console.log("\n=== The T7_PLANKS case ===");

// The reported T7_PLANKS shape. It happened at Caerleon, which is now exempt
// from the clamp entirely, so the victim here is Bridgewatch — a royal the
// clamp still owns.
function planksFixture() {
  return {
    cityMap: {
      Bridgewatch:     merged({ buy: 76930, sell: 80979, fb: true }),
      "Fort Sterling": merged({ buy: 10056, sell: 11486 }),
      Lymhurst:        merged({ buy: 8589,  sell: 12960 }),
    },
    liveMap: {
      Bridgewatch:     live({ bid: 0,     ask: 80979 }),  // lone troll ask
      "Fort Sterling": live({ bid: 10056, ask: 11486 }),
      Lymhurst:        live({ bid: 8589,  ask: 12960 }),
    },
  };
}

test("history-derived bid 8× above the cross-city live bids is dropped", () => {
  const { cityMap, liveMap } = planksFixture();
  clampFallbackOutliers(cityMap, liveMap);
  assert.strictEqual(cityMap.Bridgewatch.buy_price, 0);
});

test("the live ask at the same city is NOT touched (IQR bounds own that call)", () => {
  const { cityMap, liveMap } = planksFixture();
  clampFallbackOutliers(cityMap, liveMap);
  assert.strictEqual(cityMap.Bridgewatch.sell_price, 80979);
});

test("other cities' live prices pass through untouched", () => {
  const { cityMap, liveMap } = planksFixture();
  clampFallbackOutliers(cityMap, liveMap);
  assert.strictEqual(cityMap["Fort Sterling"].buy_price, 10056);
  assert.strictEqual(cityMap["Fort Sterling"].sell_price, 11486);
  assert.strictEqual(cityMap.Lymhurst.buy_price, 8589);
  assert.strictEqual(cityMap.Lymhurst.sell_price, 12960);
});

// ──────────────────────────────────────────────────────────────────────────
console.log("\n=== Clamp band ===");

function band({ fallbackPrice, refs }) {
  const cityMap = { Bridgewatch: merged({ buy: fallbackPrice, fb: true }) };
  const liveMap = { Bridgewatch: live({ ask: 1 }) };
  refs.forEach((p, i) => {
    const c = `City${i}`;
    cityMap[c] = merged({ buy: p });
    liveMap[c] = live({ bid: p });
  });
  clampFallbackOutliers(cityMap, liveMap);
  return cityMap.Bridgewatch.buy_price;
}

test("inside the band (≤3× the live median) survives", () => {
  assert.strictEqual(band({ fallbackPrice: 2900, refs: [1000, 1000] }), 2900);
});

test("exactly 3× the live median survives (boundary is inclusive)", () => {
  assert.strictEqual(band({ fallbackPrice: 3000, refs: [1000, 1000] }), 3000);
});

test("above 3× the live median is dropped", () => {
  assert.strictEqual(band({ fallbackPrice: 3001, refs: [1000, 1000] }), 0);
});

test("below one third of the live median is dropped (stale-low history)", () => {
  assert.strictEqual(band({ fallbackPrice: 300, refs: [1000, 1000] }), 0);
});

test("exactly one third of the live median survives", () => {
  assert.strictEqual(band({ fallbackPrice: 334, refs: [1000, 1000] }), 334);
});

test("median (not mean) anchors the band — one live outlier can't widen it", () => {
  // Live bids 1000, 1000, 1000, 900000. Mean would be ~225k (fallback 20k
  // survives); median is 1000 → 20k is 20× and gets dropped.
  assert.strictEqual(band({ fallbackPrice: 20000, refs: [1000, 1000, 1000, 900000] }), 0);
});

// ──────────────────────────────────────────────────────────────────────────
console.log("\n=== Guards: when the clamp must stay out of the way ===");

test("fewer than 2 live reference cities → no clamp (nothing to anchor on)", () => {
  const cityMap = {
    Bridgewatch: merged({ buy: 76930, fb: true }),
    Lymhurst: merged({ buy: 8589 }),
  };
  const liveMap = { Bridgewatch: live({ ask: 80979 }), Lymhurst: live({ bid: 8589 }) };
  clampFallbackOutliers(cityMap, liveMap);
  assert.strictEqual(cityMap.Bridgewatch.buy_price, 76930, "single anchor is too weak to reject on");
});

test("no live prices at all → every fallback survives", () => {
  const cityMap = {
    Bridgewatch: merged({ buy: 500, sell: 600, fb: true }),
    Lymhurst: merged({ buy: 90000, sell: 95000, fb: true }),
  };
  clampFallbackOutliers(cityMap, {});
  assert.strictEqual(cityMap.Bridgewatch.buy_price, 500);
  assert.strictEqual(cityMap.Lymhurst.buy_price, 90000);
});

test("entries without used_fallback are never clamped, however extreme", () => {
  const cityMap = {
    Bridgewatch: merged({ buy: 999999 }),
    Lymhurst: merged({ buy: 1000 }),
    Martlock: merged({ buy: 1000 }),
  };
  const liveMap = {
    Bridgewatch: live({ bid: 999999 }),
    Lymhurst: live({ bid: 1000 }),
    Martlock: live({ bid: 1000 }),
  };
  clampFallbackOutliers(cityMap, liveMap);
  assert.strictEqual(cityMap.Bridgewatch.buy_price, 999999);
});

test("Black Market is neither clamped nor used as a reference", () => {
  const cityMap = {
    "Black Market": merged({ buy: 500000, fb: true }),
    Lymhurst: merged({ buy: 1000 }),
    Martlock: merged({ buy: 1000 }),
    Thetford: merged({ buy: 1200 }),
  };
  const liveMap = {
    "Black Market": live({ ask: 520000 }),
    Lymhurst: live({ bid: 1000 }),
    Martlock: live({ bid: 1000 }),
    Thetford: live({ bid: 1200 }),
  };
  clampFallbackOutliers(cityMap, liveMap);
  assert.strictEqual(cityMap["Black Market"].buy_price, 500000, "BM premium is legitimate");
});

test("a Black Market fallback never anchors another city's clamp", () => {
  // Only ONE royal live bid + the BM live bid. If BM counted, there'd be 2
  // references; it must not, so the clamp stays out (guard above).
  const cityMap = {
    "Black Market": merged({ buy: 500000 }),
    Lymhurst: merged({ buy: 1000 }),
    Thetford: merged({ buy: 40000, fb: true }),
  };
  const liveMap = {
    "Black Market": live({ bid: 500000 }),
    Lymhurst: live({ bid: 1000 }),
    Thetford: live({ ask: 42000 }),
  };
  clampFallbackOutliers(cityMap, liveMap);
  assert.strictEqual(cityMap.Thetford.buy_price, 40000);
});

test("Caerleon is neither clamped nor used as a reference (plan-caerleon-exempt.md)", () => {
  // Twin of the two Black Market cases above: a 50× history-invented Caerleon
  // ask survives, and a live Caerleon bid leaves the lone royal anchor too weak
  // to clamp Bridgewatch's invented price.
  const cityMap = {
    Caerleon: merged({ buy: 0, sell: 55000, fb: true }),
    Bridgewatch: merged({ buy: 40000, fb: true }),
    Lymhurst: merged({ buy: 1000 }),
  };
  const liveMap = {
    Caerleon: live({ bid: 500000 }),
    Bridgewatch: live({ ask: 42000 }),
    Lymhurst: live({ bid: 1000 }),
  };
  clampFallbackOutliers(cityMap, liveMap);
  assert.strictEqual(cityMap.Caerleon.sell_price, 55000, "the Caerleon premium is legitimate");
  assert.strictEqual(cityMap.Bridgewatch.buy_price, 40000,
    "the Caerleon bid must not anchor Bridgewatch's clamp");
});

// ──────────────────────────────────────────────────────────────────────────
console.log("\n=== Side independence + flag bookkeeping ===");

test("each side clamps against its OWN side's live distribution", () => {
  // Bids cluster at 1,000; asks cluster at 100,000. A fallback ask of 120,000
  // is fine against the ask distribution even though it is 120× the bids.
  const cityMap = {
    Bridgewatch: merged({ sell: 120000, fb: true }),
    Lymhurst: merged({ buy: 1000, sell: 100000 }),
    Martlock: merged({ buy: 1000, sell: 100000 }),
  };
  const liveMap = {
    Bridgewatch: live({ bid: 900 }),
    Lymhurst: live({ bid: 1000, ask: 100000 }),
    Martlock: live({ bid: 1000, ask: 100000 }),
  };
  clampFallbackOutliers(cityMap, liveMap);
  assert.strictEqual(cityMap.Bridgewatch.sell_price, 120000);
});

test("both sides can be dropped independently", () => {
  const cityMap = {
    Bridgewatch: merged({ buy: 90000, sell: 95000, fb: true }),
    Lymhurst: merged({ buy: 1000, sell: 1100 }),
    Martlock: merged({ buy: 1000, sell: 1100 }),
  };
  const liveMap = {
    Bridgewatch: live(),
    Lymhurst: live({ bid: 1000, ask: 1100 }),
    Martlock: live({ bid: 1000, ask: 1100 }),
  };
  clampFallbackOutliers(cityMap, liveMap);
  assert.strictEqual(cityMap.Bridgewatch.buy_price, 0);
  assert.strictEqual(cityMap.Bridgewatch.sell_price, 0);
});

test("used_fallback clears when the clamp leaves nothing behind", () => {
  const cityMap = {
    Bridgewatch: merged({ buy: 90000, fb: true }),
    Lymhurst: merged({ buy: 1000 }),
    Martlock: merged({ buy: 1000 }),
  };
  const liveMap = {
    Bridgewatch: live(),
    Lymhurst: live({ bid: 1000 }),
    Martlock: live({ bid: 1000 }),
  };
  clampFallbackOutliers(cityMap, liveMap);
  assert.strictEqual(cityMap.Bridgewatch.used_fallback, false, "no invented value left → not a fallback row");
});

test("used_fallback stays true when a surviving side is still history-derived", () => {
  const cityMap = {
    Bridgewatch: merged({ buy: 90000, sell: 1200, fb: true }),
    Lymhurst: merged({ buy: 1000, sell: 1100 }),
    Martlock: merged({ buy: 1000, sell: 1100 }),
  };
  const liveMap = {
    Bridgewatch: live(),
    Lymhurst: live({ bid: 1000, ask: 1100 }),
    Martlock: live({ bid: 1000, ask: 1100 }),
  };
  clampFallbackOutliers(cityMap, liveMap);
  assert.strictEqual(cityMap.Bridgewatch.buy_price, 0);
  assert.strictEqual(cityMap.Bridgewatch.sell_price, 1200);
  assert.strictEqual(cityMap.Bridgewatch.used_fallback, true);
});

// ──────────────────────────────────────────────────────────────────────────
console.log("\n=== Edge cases ===");

test("missing / empty inputs are no-ops", () => {
  assert.doesNotThrow(() => clampFallbackOutliers(null, null));
  assert.doesNotThrow(() => clampFallbackOutliers({}, {}));
  assert.doesNotThrow(() => clampFallbackOutliers({ Caerleon: merged({ buy: 5, fb: true }) }, undefined));
});

test("zero-priced fallback sides are left alone (already no data)", () => {
  const cityMap = {
    Bridgewatch: merged({ buy: 0, sell: 0, fb: true }),
    Lymhurst: merged({ buy: 1000 }),
    Martlock: merged({ buy: 1000 }),
  };
  const liveMap = { Bridgewatch: live(), Lymhurst: live({ bid: 1000 }), Martlock: live({ bid: 1000 }) };
  clampFallbackOutliers(cityMap, liveMap);
  assert.strictEqual(cityMap.Bridgewatch.buy_price, 0);
  assert.strictEqual(cityMap.Bridgewatch.sell_price, 0);
});

test("volume and dates are never modified", () => {
  const cityMap = { Bridgewatch: merged({ buy: 90000, fb: true }) };
  cityMap.Bridgewatch.buy_date = "2026-07-27T20:45:00";
  cityMap.Lymhurst = merged({ buy: 1000 });
  cityMap.Martlock = merged({ buy: 1000 });
  const liveMap = { Bridgewatch: live(), Lymhurst: live({ bid: 1000 }), Martlock: live({ bid: 1000 }) };
  clampFallbackOutliers(cityMap, liveMap);
  assert.strictEqual(cityMap.Bridgewatch.volume_24h, 100);
  assert.strictEqual(cityMap.Bridgewatch.buy_date, "2026-07-27T20:45:00");
});

// ──────────────────────────────────────────────────────────────────────────
console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
