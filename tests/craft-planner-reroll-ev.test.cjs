/**
 * Tests (TDD): the Crafting Planner "Reroll EV" column.
 *
 * A planner row obtains its item at Normal quality (Q1). At a repair station the
 * item's quality can be rerolled (silver cost, stochastic outcome, never lowers
 * quality). The column shows the expected silver UPLIFT of optimally rerolling
 * before selling, versus selling at Normal, at the row's sell city.
 *
 * Optimal stopping over the REROLL_MATRIX walk (qualities only move up, so one
 * descending pass is exact):
 *
 *   V(5) = sell(5)
 *   V(q) = max( sell(q), ( Σ_{q' > q} P(q→q')·V(q') − cost(q) ) / (1 − P(q→q)) )
 *
 * (the spec's Σ_{q' ≥ q} form solved for V(q): the stay mass re-enters the same
 * choice — "keep rerolling while it pays"). cost(q) bills the item value at the
 * CURRENT quality's modifier, then the global discount. By construction
 * uplift = V(1) − sell(1) ≥ 0 — the walk can always stop and sell — and
 * uplift ≤ max sell − sell(1), so a flat price ladder must price at exactly 0
 * and the cell shows a dash. The cell shows a number only when rerolling pays.
 *
 * Null contract: the item must be base equipment T4-T8 (getEquipmentSlot +
 * tier gate), and every quality price the walk can REACH from Q1 must be
 * present (read > 0) at the city. With the real matrix the walk can land on
 * every quality 1..5, so one missing quality price → null.
 *
 * Black-box over the real js/craft-planner-reroll-ev.js with the real
 * js/data-rerolling.js + js/data-enchanting.js and stubbed market/discount/
 * i18n/format globals. Hand-solved expected values below assume
 * ITEM_VALUES.T4_2H_BOW = 100 and a ×0.9 global discount unless stated.
 *
 * Run: node tests/craft-planner-reroll-ev.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const load = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

// Stubs + the real data modules + the module under test, in one scope, so the
// module's call-time global reads (ITEM_VALUES, lastQualityMarketData,
// getQualitySellPrice, applyGlobalDiscount, REROLL_MATRIX, tx, formatSilver)
// resolve exactly as they do in the browser. `withTx=false` builds a sandbox
// without tx to prove the guard falls back to inline English.
function loadModule({ withTx = true, discountFactor = 0.9, bowValue = 100 } = {}) {
  const sandbox = `
var ITEM_VALUES = { T4_2H_BOW: ${bowValue}, T6_MAIN_SWORD: 400 };
var lastQualityMarketData = null;
var DISCOUNT_FACTOR = ${discountFactor};
function applyGlobalDiscount(n) { return n * DISCOUNT_FACTOR; }
function getQualitySellPrice(data, itemId, quality, city) {
  const cell = data && data[itemId] && data[itemId][quality] && data[itemId][quality][city];
  return cell ? (cell.sell_price || 0) : 0;
}
function formatSilver(n) { return n == null ? "N/A" : Math.round(n).toLocaleString("en-US"); }
${withTx ? 'function tx(en, slug) { return en; }' : ''}
`;
  const mod = new Module(`craft-planner-reroll-ev-test-${withTx ? "tx" : "notx"}-${discountFactor}`);
  mod._compile(
    sandbox
    + load("js/data-enchanting.js")
    + load("js/data-rerolling.js")
    + load("js/craft-planner-reroll-ev.js")
    + "\nmodule.exports = { computeRerollEvUplift, rerollEvCell, REROLL_MATRIX,"
    + " REROLL_COST_MODIFIER, setMarket(d) { lastQualityMarketData = d; },"
    + " setDiscountFactor(f) { DISCOUNT_FACTOR = f; } };",
    "craft-planner-reroll-ev-test.js",
  );
  return mod.exports;
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}
// The cell's visible text: everything between its last `>` and `</td>`.
// (Attribute values like the dim color #6b7280 contain hex digits, so a raw
// "no digits" regex over the whole <td> would misfire.)
const cellText = (html) => {
  const m = html.match(/>([^<]*)<\/td>$/);
  return m ? m[1].trim() : html;
};
const close = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol,
    `${msg}: expected ~${expected}, got ${actual}`);

const CITY = "Martlock";
const BOW = "T4_2H_BOW";

/** A per-quality sell-price market stub: five prices for one item at one city. */
function ladderMarket(s1, s2, s3, s4, s5, city = CITY, itemId = BOW) {
  const prices = [s1, s2, s3, s4, s5];
  const qualities = {};
  prices.forEach((p, i) => {
    qualities[i + 1] = { [city]: { sell_price: p, buy_price: p } };
  });
  return { [itemId]: qualities };
}

console.log("\n=== Flat / degenerate ladders ===");

[1000, 12345.67].forEach((p) => {
  test(`a flat ${p} ladder prices the reroll at exactly 0 (no premium, no reason)`, () => {
    const m = loadModule();
    m.setMarket(ladderMarket(p, p, p, p, p));
    assert.strictEqual(m.computeRerollEvUplift(BOW, CITY), 0);
  });
});

test("a flat ladder's cell is a dim dash, not a zero figure", () => {
  const m = loadModule();
  m.setMarket(ladderMarket(1000, 1000, 1000, 1000, 1000));
  const html = m.rerollEvCell(BOW, CITY);
  assert.ok(html.includes("—"), `expected a dash: ${html}`);
  assert.ok(cellText(html) === "—", `expected a bare dash: ${html}`);
});

console.log("\n=== Exact hand-solved walks ===");

// ITEM_VALUES.T4_2H_BOW = 100; discount ×0.9 → costs 396 / 495 / 594 / 2475.
// V5=20000; V4=max(6000,(100−2475)/0.005)=6000; V3=(2994+20−594)/0.5=4840;
// V2=(0.6·4840+594+20−495)/0.7=4318.5714…; V1=0.8·V2+0.15·4840+300+20−396
// = 4104.8571…; uplift = 3104.8571…
[
  [0.9, 3104.857143],
  [1.0, 2887.685714], // same walk, undiscounted costs (440/550/660/2750)
].forEach(([factor, expected]) => {
  test(`hand-solved Normal→top walk bills discounted costs (×${factor} discount)`, () => {
    const m = loadModule({ discountFactor: factor });
    m.setMarket(ladderMarket(1000, 1500, 2500, 6000, 20000));
    close(m.computeRerollEvUplift(BOW, CITY), expected, 1e-4, `uplift @d=${factor}`);
  });
});

test("the walk stops where rerolling stops paying (sell beats the walk mid-ladder)", () => {
  // Q2-Q4's rerolls lose against a flat 5000 shelf, so only the cheap Normal
  // step pays: V5..V2 all sit at 5000 and V1 = 0.8·5000+0.15·5000+0.05·5000
  // +0.001·5000 − 396 = 4609 → uplift 3609.
  const m = loadModule();
  m.setMarket(ladderMarket(1000, 5000, 5000, 5000, 5000));
  close(m.computeRerollEvUplift(BOW, CITY), 3609, 1e-6, "uplift (single paying step)");
});

console.log("\n=== Bounds and monotonicity ===");

[
  [1000, 1200, 1500, 2000, 3000],
  [500, 900, 2000, 5000, 12000],
  [100, 100, 100, 100, 101000],
  [1000, 1500, 2500, 6000, 20000],
].forEach((prices) => {
  test(`uplift is never above sell(5) − sell(1) for [${prices}]`, () => {
    const m = loadModule();
    m.setMarket(ladderMarket(...prices));
    const uplift = m.computeRerollEvUplift(BOW, CITY);
    assert.ok(uplift !== null, "expected a number");
    assert.ok(uplift >= 0, `uplift must be ≥ 0, got ${uplift}`);
    assert.ok(uplift <= prices[4] - prices[0] + 1e-9,
      `uplift ${uplift} beats the best quality's spread ${prices[4] - prices[0]}`);
  });
});

[6000, 8000, 12000, 20000, 60000, 500000].forEach((q5) => {
  test(`raising the Masterpiece price to ${q5} never lowers the uplift`, () => {
    const m = loadModule();
    m.setMarket(ladderMarket(1000, 1500, 2500, 6000, q5));
    const uplift = m.computeRerollEvUplift(BOW, CITY);
    m.setMarket(ladderMarket(1000, 1500, 2500, 6000, q5 * 2));
    const raised = m.computeRerollEvUplift(BOW, CITY);
    assert.ok(raised >= uplift - 1e-9,
      `uplift dropped: ${uplift} @Q5=${q5} → ${raised} @Q5=${q5 * 2}`);
  });
});

console.log("\n=== Reroll cost billing ===");

test("a huge item value drives the uplift to 0 (reroll never pays)", () => {
  const m = loadModule();
  m.setMarket(ladderMarket(1000, 1500, 2500, 6000, 20000));
  assert.ok(m.computeRerollEvUplift(BOW, CITY) > 0, "sanity: the modest ladder pays");
  // Same ladder, item value 1e9: every reroll step bills 1e9 × 4.4 and up,
  // so the walk never beats selling at Normal.
  const big = loadModule({ bowValue: 1e9 });
  big.setMarket(ladderMarket(1000, 1500, 2500, 6000, 20000));
  assert.strictEqual(big.computeRerollEvUplift(BOW, CITY), 0);
});

test("the discount is billed, not the gross fee (same walk, different discounts differ)", () => {
  const prices = [1000, 1500, 2500, 6000, 20000];
  const undiscounted = loadModule({ discountFactor: 1.0 });
  undiscounted.setMarket(ladderMarket(...prices));
  const discounted = loadModule({ discountFactor: 0.5 });
  discounted.setMarket(ladderMarket(...prices));
  const no = undiscounted.computeRerollEvUplift(BOW, CITY);
  const half = discounted.computeRerollEvUplift(BOW, CITY);
  assert.ok(half > no, `cheaper rerolls must not price lower: ${half} vs ${no}`);
  assert.ok(half < prices[4] - prices[0], "still inside the best-quality bound");
});

console.log("\n=== Null contract ===");

[
  ["T4_ARTEFACT_HEAD_LEATHER_DRAGON", "artifact material — no equipment slot"],
  ["T8_ORE", "raw resource — no equipment slot"],
  ["T3_BAG", "equipment slot but tier below 4"],
  ["T9_2H_BOW", "tier above 8"],
  ["T2_MAIN_SWORD", "tier below 4"],
].forEach(([itemId, why]) => {
  test(`null for ${itemId} — ${why}`, () => {
    const m = loadModule();
    m.setMarket(ladderMarket(1000, 1500, 2500, 6000, 20000, CITY, itemId));
    assert.strictEqual(m.computeRerollEvUplift(itemId, CITY), null, why);
  });
});

[5, 4, 3, 2, 1].forEach((missing) => {
  test(`null when Q${missing}'s sell price is missing at the city (walk reaches it)`, () => {
    const m = loadModule();
    const prices = [1000, 1500, 2500, 6000, 20000];
    prices[missing - 1] = 0; // getQualitySellPrice reads 0 → treated as no data
    m.setMarket(ladderMarket(...prices));
    assert.strictEqual(m.computeRerollEvUplift(BOW, CITY), null);
  });
});

test("null with no market data at all", () => {
  const m = loadModule();
  m.setMarket(null);
  assert.strictEqual(m.computeRerollEvUplift(BOW, CITY), null);
});

test("null when the city has no quality ladder for the item", () => {
  const m = loadModule();
  m.setMarket(ladderMarket(1000, 1500, 2500, 6000, 20000, "Bridgewatch"));
  assert.strictEqual(m.computeRerollEvUplift(BOW, CITY), null);
});

console.log("\n=== Cell HTML ===");

test("a paying walk renders a green silver-val cell with the formatted uplift", () => {
  const m = loadModule();
  m.setMarket(ladderMarket(1000, 1500, 2500, 6000, 20000));
  const html = m.rerollEvCell(BOW, CITY);
  assert.ok(html.startsWith("<td"), `expected a <td>: ${html}`);
  assert.ok(html.includes('class="silver-val'), `expected silver-val: ${html}`);
  assert.ok(html.includes("profit-high"), `expected the green tone: ${html}`);
  assert.ok(html.includes("+3,105"), `expected the formatted uplift: ${html}`);
  assert.ok(html.includes("title="), `expected a tooltip: ${html}`);
  assert.ok(html.includes("Expected extra silver per item"), `expected the tooltip text: ${html}`);
  assert.ok(!html.includes("undefined") && !html.includes("NaN") && !html.includes("ERR"),
    `no leakage: ${html}`);
});

test("a null cell is a dim dash with no figures and no leakage", () => {
  const m = loadModule();
  const html = m.rerollEvCell("T4_ARTEFACT_HEAD_LEATHER_DRAGON", CITY);
  assert.ok(html.startsWith("<td"), `expected a <td>: ${html}`);
  assert.ok(html.includes("—"), `expected a dash: ${html}`);
  assert.ok(html.includes("#6b7280"), `expected the dim tone: ${html}`);
  assert.ok(cellText(html) === "—", `expected a bare dash: ${html}`);
  assert.ok(!html.includes("undefined") && !html.includes("NaN") && !html.includes("ERR"),
    `no leakage: ${html}`);
});

test("a not-worth-it (0) cell reads as a dash, not a zero", () => {
  const m = loadModule();
  m.setMarket(ladderMarket(1000, 1000, 1000, 1000, 1000));
  const html = m.rerollEvCell(BOW, CITY);
  assert.ok(html.includes("—"), `expected a dash: ${html}`);
  assert.ok(cellText(html) === "—", `expected a bare dash: ${html}`);
});

test("without tx the cell still renders with inline English", () => {
  const m = loadModule({ withTx: false });
  m.setMarket(ladderMarket(1000, 1500, 2500, 6000, 20000));
  const html = m.rerollEvCell(BOW, CITY);
  assert.ok(html.includes("+3,105"), `expected the uplift: ${html}`);
  assert.ok(html.includes("Expected extra silver per item"), `expected inline English: ${html}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
