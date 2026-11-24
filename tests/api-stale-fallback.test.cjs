/**
 * Test: api.js price/history fallback merge — sanity-bounds the
 * `avg_price × 0.95` (buy) and `avg_price × 1.05` (sell) fallbacks so that
 * a chronic-no-buyer item (e.g. T8 full gathering journals where
 * `buy_price_max` is always 0 but `sell_price_min` is hundreds of thousands)
 * doesn't display a stale ~46k price pulled from historical avg_price that
 * predates the current market level.
 *
 * Specifically:
 *   - When `buy_price_max=0` AND `sell_price_min > 2 × (avg_price × 0.95)`,
 *     the history is stale; fall back to `sell_price_min × 0.95` instead.
 *   - When `sell_price_min=0` AND `buy_price_max > (avg_price × 1.05)`, the
 *     history is stale on the sell side; fall back to `buy_price_max` so the
 *     row reflects what a seller would actually clear at.
 *
 * Run: node tests/api-stale-fallback.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

// Load api.js — it exports `mergeEntryWithHistory` as a pure helper when
// loaded under CommonJS (browser doesn't see the export branch).
const apiSrc = fs.readFileSync(
  path.join(__dirname, "..", "js", "api.js"),
  "utf8",
);

const mod = new Module("api-stale-fallback-test");
// fetch isn't actually invoked by the helper, but api.js references it at
// module scope (in fetchWithRetry etc.) — provide a noop stub so eval succeeds.
const sandbox = `
const fetch = () => Promise.resolve({ ok: false, status: 0 });
const document = { getElementById: () => null };
`;
mod._compile(sandbox + apiSrc, "api.js");
const { mergeEntryWithHistory } = mod.exports;

assert.ok(
  typeof mergeEntryWithHistory === "function",
  "api.js must export mergeEntryWithHistory for testability",
);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const NO_DATE = "0001-01-01T00:00:00";

function entry({ bid = 0, ask = 0, askDate = NO_DATE, bidDate = NO_DATE } = {}) {
  return {
    buy_price_max: bid,
    sell_price_min: ask,
    buy_price_max_date: bidDate,
    sell_price_min_date: askDate,
  };
}

function history(...points) {
  // points: [{count, avg, ts}, ...]
  return {
    data: points.map((p) => ({
      item_count: p.count,
      avg_price: p.avg,
      timestamp: p.ts,
    })),
  };
}

// ──────────────────────────────────────────────────────────────────────────
console.log("\n=== Pass-through (no fallback needed) ===");

test("Both bid and ask present → values pass through unchanged", () => {
  const r = mergeEntryWithHistory(
    entry({ bid: 100, ask: 120, askDate: "2026-05-25", bidDate: "2026-05-25" }),
    null,
  );
  assert.strictEqual(r.buy_price, 100);
  assert.strictEqual(r.sell_price, 120);
  assert.strictEqual(r.used_fallback, false);
});

test("Both bid and ask present + history → still no fallback, but volume sums", () => {
  const r = mergeEntryWithHistory(
    entry({ bid: 100, ask: 120 }),
    history(
      { count: 5, avg: 110, ts: "2026-05-01" },
      { count: 3, avg: 110, ts: "2026-05-02" },
    ),
  );
  assert.strictEqual(r.buy_price, 100);
  assert.strictEqual(r.sell_price, 120);
  assert.strictEqual(r.volume_24h, 8);
  assert.strictEqual(r.used_fallback, false);
});

test("No data, no history → all zeros", () => {
  const r = mergeEntryWithHistory(entry(), null);
  assert.strictEqual(r.buy_price, 0);
  assert.strictEqual(r.sell_price, 0);
  assert.strictEqual(r.volume_24h, 0);
  assert.strictEqual(r.used_fallback, false);
});

// ──────────────────────────────────────────────────────────────────────────
console.log("\n=== Standard avg_price fallback (history close to live) ===");

test("bid=0, ask>0, history avg near ask → buy uses avg×0.95", () => {
  // Normal-spread case: ask 100, history says items traded around 95. The
  // fallback estimate of what a buyer would pay (~90) is consistent with
  // current market level.
  const r = mergeEntryWithHistory(
    entry({ ask: 100, askDate: "2026-05-25" }),
    history({ count: 5, avg: 95, ts: "2026-04-30" }),
  );
  assert.strictEqual(r.buy_price, Math.round(95 * 0.95));
  assert.strictEqual(r.used_fallback, true);
});

test("ask=0, bid>0, history avg near bid → sell uses avg×1.05", () => {
  // Mirror: bid 100, history avg 105. Sell estimate ~110.
  const r = mergeEntryWithHistory(
    entry({ bid: 100, bidDate: "2026-05-25" }),
    history({ count: 5, avg: 105, ts: "2026-04-30" }),
  );
  assert.strictEqual(r.sell_price, Math.round(105 * 1.05));
  assert.strictEqual(r.used_fallback, true);
});

// ──────────────────────────────────────────────────────────────────────────
console.log("\n=== Stale-history sanity bound (the bug this file exists for) ===");

test("T8 full journal scenario: ask=730k, history says 49k → buy uses ask×0.95, not 46k", () => {
  // The user-reported case: T8_JOURNAL_HIDE_FULL at Lymhurst has
  // sell_price_min=729993 but buy_price_max=0; the 24h history is stuck on
  // ~49k avg_price from stale trades. Without the fix the cell would show
  // 46.5k (avg*0.95); with the fix it shows ~693k (ask*0.95).
  const r = mergeEntryWithHistory(
    entry({ ask: 730000, askDate: "2026-05-25" }),
    history({ count: 50, avg: 49000, ts: "2026-05-08" }),
  );
  assert.strictEqual(r.buy_price, Math.round(730000 * 0.95));
  assert.strictEqual(r.used_fallback, true);
});

test("bid=0, ask wildly above history (> 2× avg×0.95) → buy uses ask×0.95 (stale-history detected)", () => {
  // Generic case at the boundary: ask is more than 2× the standard fallback,
  // indicating history is from a lower-priced era.
  const r = mergeEntryWithHistory(
    entry({ ask: 1000 }),
    history({ count: 5, avg: 200, ts: "2026-04-01" }),
  );
  // Standard fallback would be 200*0.95=190; ask*0.5=500 > 190, so trigger
  // the stale-history bound → use ask*0.95 = 950.
  assert.strictEqual(r.buy_price, Math.round(1000 * 0.95));
});

test("bid=0, ask close to 2× standard fallback (boundary) → uses standard avg×0.95", () => {
  // Just below the trigger: ask is 2× avg*0.95 - 1 = ~189. Not stale enough.
  // ask=189, avg=100 → standard fallback = 95. ask*0.5 = 94.5 ≤ 95.
  const r = mergeEntryWithHistory(
    entry({ ask: 189 }),
    history({ count: 5, avg: 100, ts: "2026-05-01" }),
  );
  assert.strictEqual(r.buy_price, Math.round(100 * 0.95));
});

test("ask=0, bid wildly above history → sell uses bid (the floor), not avg×1.05", () => {
  // Inverse-stale: bidders at 1000, history avg 100. A seller would clear at
  // the bid (1000) instantly — sell estimate must not fall below bid.
  const r = mergeEntryWithHistory(
    entry({ bid: 1000 }),
    history({ count: 5, avg: 100, ts: "2026-04-01" }),
  );
  // Standard fallback would be 100*1.05=105; bid=1000 > 105 → use bid.
  assert.strictEqual(r.sell_price, 1000);
});

test("ask=0, bid below standard sell fallback → uses standard avg×1.05 (no clamp)", () => {
  // bid=50, avg=100 → standard sell fallback = 105. bid (50) < 105, no clamp.
  const r = mergeEntryWithHistory(
    entry({ bid: 50 }),
    history({ count: 5, avg: 100, ts: "2026-05-01" }),
  );
  assert.strictEqual(r.sell_price, Math.round(100 * 1.05));
});

test("bid=0, ask LOWER than history avg → buy clamps DOWN to ask×0.95 (avoid buy > ask)", () => {
  // Stale-high history case (T8 trophy ORE full at Fort Sterling-like): the
  // city has no current market on either side, but the avg_price encodes an
  // older, higher market level. Without the down-clamp, the fallback would
  // produce a buy estimate ABOVE the live ask — economically nonsensical.
  // ask=200, avg=1000 → avg*0.95=950, but 950 > 200, so clamp to 200*0.95=190.
  const r = mergeEntryWithHistory(
    entry({ ask: 200 }),
    history({ count: 5, avg: 1000, ts: "2026-05-01" }),
  );
  assert.strictEqual(r.buy_price, Math.round(200 * 0.95));
});

// ──────────────────────────────────────────────────────────────────────────
console.log("\n=== Both-zero gate (suppress invented values from dormant histories) ===");

test("bid=0 AND ask=0 with history avg=49k → buy_price=sell_price=0 (no fallback)", () => {
  // T8_JOURNAL_HIDE_EMPTY at Fort Sterling-like: no live market either side,
  // but 24h history records ~49k. Pre-fix this surfaced 46k buy / 51k sell;
  // post-fix the row shows no-data and the user overrides manually.
  const r = mergeEntryWithHistory(
    entry(),
    history({ count: 33, avg: 49000, ts: "2026-05-08" }),
  );
  assert.strictEqual(r.buy_price, 0);
  assert.strictEqual(r.sell_price, 0);
  assert.strictEqual(r.used_fallback, false);
  // Volume still sums from history — the row's vol badge can still indicate
  // historical activity even when no fallback is applied.
  assert.strictEqual(r.volume_24h, 33);
});

test("bid=0 AND ask=0, stale-high history (370k) → no fallback, both 0", () => {
  // T8_JOURNAL_TROPHY_ORE_EMPTY at Fort Sterling — history avg is wildly
  // above current cross-city ask (50k at Bridgewatch). Pre-fix the row
  // displayed ~389k sell, swapping visually with the FULL journal column
  // (which itself had a stale-low avg). Post-fix neither side is invented.
  const r = mergeEntryWithHistory(
    entry(),
    history({ count: 17, avg: 370000, ts: "2026-05-12" }),
  );
  assert.strictEqual(r.buy_price, 0);
  assert.strictEqual(r.sell_price, 0);
});

test("bid=0 AND ask=0, NO history → still both 0 (sanity)", () => {
  const r = mergeEntryWithHistory(entry(), null);
  assert.strictEqual(r.buy_price, 0);
  assert.strictEqual(r.sell_price, 0);
  assert.strictEqual(r.used_fallback, false);
});

test("bid>0 AND ask>0 with history avg present → live values pass through, fallback skipped", () => {
  // Sanity: when both sides have real data, the fallback path is never
  // entered. Same as the pass-through test but with history present.
  const r = mergeEntryWithHistory(
    entry({ bid: 80, ask: 120 }),
    history({ count: 50, avg: 200, ts: "2026-04-01" }),
  );
  assert.strictEqual(r.buy_price, 80);
  assert.strictEqual(r.sell_price, 120);
  assert.strictEqual(r.used_fallback, false);
});

// ──────────────────────────────────────────────────────────────────────────
console.log("\n=== Edge cases ===");

test("Empty history data array → no fallback, both sides zero", () => {
  const r = mergeEntryWithHistory(entry({ ask: 100 }), { data: [] });
  assert.strictEqual(r.buy_price, 0);
  assert.strictEqual(r.sell_price, 100);
  assert.strictEqual(r.volume_24h, 0);
});

test("History contains only zero-avg entries → no fallback applied", () => {
  // validRecent.avg_price > 0 filter excludes these; falls through to no-fallback.
  const r = mergeEntryWithHistory(
    entry({ ask: 100 }),
    history({ count: 5, avg: 0, ts: "2026-05-01" }),
  );
  assert.strictEqual(r.buy_price, 0);
  assert.strictEqual(r.sell_price, 100);
  assert.strictEqual(r.volume_24h, 5);
});

test("Most-recent history entry wins (descending sort)", () => {
  // Older entry has 100, newer has 200. Fallback should use the newer (200).
  const r = mergeEntryWithHistory(
    entry({ ask: 250 }),
    history(
      { count: 5, avg: 100, ts: "2026-04-01" },
      { count: 3, avg: 200, ts: "2026-05-01" },
    ),
  );
  // Standard fallback: 200*0.95=190. ask*0.5=125 ≤ 190 → standard wins.
  assert.strictEqual(r.buy_price, Math.round(200 * 0.95));
});

test("used_fallback flag set when a fallback was applied", () => {
  const r = mergeEntryWithHistory(
    entry({ ask: 100 }),
    history({ count: 5, avg: 95, ts: "2026-05-01" }),
  );
  assert.strictEqual(r.used_fallback, true);
});

test("sell_date / buy_date prefer live API date when present, fall back to history timestamp", () => {
  const r1 = mergeEntryWithHistory(
    entry({ ask: 100, askDate: "2026-05-25" }),
    history({ count: 5, avg: 95, ts: "2026-05-01T00:00:00" }),
  );
  assert.strictEqual(r1.sell_date, "2026-05-25", "live ask date wins for sell_date");
  assert.strictEqual(r1.buy_date, "2026-05-01T00:00:00", "fallback uses history ts for buy_date");

  const r2 = mergeEntryWithHistory(
    entry({ bid: 80, bidDate: "2026-05-25" }),
    history({ count: 5, avg: 100, ts: "2026-05-01T00:00:00" }),
  );
  assert.strictEqual(r2.buy_date, "2026-05-25", "live bid date wins for buy_date");
  assert.strictEqual(r2.sell_date, "2026-05-01T00:00:00", "fallback uses history ts for sell_date");
});

// ──────────────────────────────────────────────────────────────────────────
console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
