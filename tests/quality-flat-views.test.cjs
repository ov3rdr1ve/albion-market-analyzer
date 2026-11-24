/**
 * Test: per-quality views of the flat price map (js/quality-flat-views.js).
 *
 * Why it exists: the flat map every table reads is projected from quality 1
 * alone (flattenQuality(map, 1) in js/render-monitor.js, flattenCaptured(...,1)
 * in js/captured-prices-store.js). A captured Good/Outstanding order book —
 * 291 item/city slots in a real capture file — could therefore never reach the
 * Flipping table. Reported as "the sniffer sees Caerleon but the Rootbound
 * Staff's instant buy price never updates": Caerleon had no NORMAL listing at
 * all, the four asks in the game panel were quality 2 and 3.
 *
 * A view is keyed by the synthetic quality id (`ITEM#Q2`), which is what lets
 * getBuyPrice / getIQRBounds / volumeAt / getOverrideField / findBestFlipPair
 * read it unchanged, with a per-quality IQR pool and per-quality overrides.
 *
 * Black-box: real js/quality-flat-views.js, synthetic maps, no DOM, no API.
 *
 * Run: node tests/quality-flat-views.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const mod = new Module("quality-flat-views");
mod._compile(
  J("quality-flat-views.js") +
    "\nmodule.exports = { qualityViewsFor, qualityViewId, QUALITY_LEVELS };",
  "quality-flat-views.js",
);
const X = mod.exports;

const CAE = "Caerleon";
const BM = "Black Market";
const ID = "T7_2H_SHAPESHIFTER_SET2";

/** {city: [buy, sell, vol]} -> {city: entry} */
function book(entries) {
  const out = {};
  Object.entries(entries).forEach(([city, [buy, sell, vol]]) => {
    out[city] = { buy_price: buy, sell_price: sell, volume_24h: vol || 0 };
  });
  return out;
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Quality flat view tests\n");

// ── The view id ──────────────────────────────────────────────────────────
[
  [1, ID],
  [2, `${ID}#Q2`],
  [3, `${ID}#Q3`],
  [5, `${ID}#Q5`],
  [null, ID],
].forEach(([q, expected]) => {
  test(`quality ${q} keys the view as ${expected}`, () => {
    assert.strictEqual(X.qualityViewId(ID, q), expected);
  });
});

// ── Quality 1 is the identity view ───────────────────────────────────────
test("quality 1 hands back the flat map itself, unwrapped", () => {
  const flat = { [ID]: book({ [CAE]: [3, 549999, 0], [BM]: [755274, 798998, 366] }) };
  const views = X.qualityViewsFor(ID, flat, null);
  assert.strictEqual(views.length, 1, "no quality block -> quality 1 only");
  assert.strictEqual(views[0].quality, 1);
  assert.strictEqual(views[0].viewId, ID);
  assert.strictEqual(views[0].data, flat, "must be the same object, not a copy");
});

test("quality 1 is offered even when the item is absent from the flat map", () => {
  // findBestFlipPair answers 'no pair' for a missing item, exactly as today —
  // dropping the view here would change nothing but hide the baseline.
  const views = X.qualityViewsFor(ID, {}, null);
  assert.strictEqual(views.length, 1);
  assert.strictEqual(views[0].quality, 1);
});

// ── Higher qualities ─────────────────────────────────────────────────────
test("a quality-2 block becomes a view keyed ITEM#Q2", () => {
  const flat = { [ID]: book({ [CAE]: [3, 549999, 0] }) };
  const quality = { [ID]: { 2: book({ [CAE]: [0, 698874, 0], [BM]: [469836, 499973, 704] }) } };
  const views = X.qualityViewsFor(ID, flat, quality);
  assert.strictEqual(views.length, 2);
  const q2 = views[1];
  assert.strictEqual(q2.quality, 2);
  assert.strictEqual(q2.viewId, `${ID}#Q2`);
  assert.strictEqual(q2.data[`${ID}#Q2`][CAE].sell_price, 698874);
  assert.strictEqual(q2.data[`${ID}#Q2`][BM].buy_price, 469836);
  assert.strictEqual(q2.data[ID], undefined, "the base id must not be in a quality view");
});

test("views come back quality-ascending, quality 1 first", () => {
  const flat = { [ID]: book({ [CAE]: [1, 2, 0] }) };
  const quality = {
    [ID]: {
      3: book({ [CAE]: [0, 300, 0] }),
      2: book({ [CAE]: [0, 200, 0] }),
      5: book({ [CAE]: [0, 500, 0] }),
    },
  };
  const views = X.qualityViewsFor(ID, flat, quality);
  assert.deepStrictEqual(views.map((v) => v.quality), [1, 2, 3, 5]);
});

test("a quality block with no nonzero price is skipped", () => {
  const flat = { [ID]: book({ [CAE]: [1, 2, 0] }) };
  const quality = { [ID]: { 2: book({ [CAE]: [0, 0, 312], [BM]: [0, 0, 0] }) } };
  const views = X.qualityViewsFor(ID, flat, quality);
  assert.deepStrictEqual(views.map((v) => v.quality), [1], "volume alone is not a price");
});

test("a buy-only quality block still makes a view", () => {
  const flat = { [ID]: book({ [CAE]: [1, 2, 0] }) };
  const quality = { [ID]: { 4: book({ [BM]: [2526, 0, 152] }) } };
  const views = X.qualityViewsFor(ID, flat, quality);
  assert.deepStrictEqual(views.map((v) => v.quality), [1, 4]);
});

test("another item's quality block is never borrowed", () => {
  const flat = { [ID]: book({ [CAE]: [1, 2, 0] }) };
  const quality = { OTHER: { 2: book({ [CAE]: [0, 999, 0] }) } };
  assert.deepStrictEqual(X.qualityViewsFor(ID, flat, quality).map((v) => v.quality), [1]);
});

test("the qualities option narrows what is considered", () => {
  const flat = { [ID]: book({ [CAE]: [1, 2, 0] }) };
  const quality = { [ID]: { 2: book({ [CAE]: [0, 200, 0] }), 3: book({ [CAE]: [0, 300, 0] }) } };
  const views = X.qualityViewsFor(ID, flat, quality, { qualities: [1, 3] });
  assert.deepStrictEqual(views.map((v) => v.quality), [1, 3]);
});

test("null maps do not throw", () => {
  assert.deepStrictEqual(X.qualityViewsFor(ID, null, null).map((v) => v.quality), [1]);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
