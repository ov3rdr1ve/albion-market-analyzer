/**
 * Verdict logic for the AODP round-trip check.
 *
 * The question the script answers: did the prices this machine sniffed and
 * uploaded actually reach the Albion Online Data Project? The only evidence
 * available is what AODP serves back, so every case is a comparison of one
 * captured cell against one AODP row.
 *
 * Black-box: the classifier takes {captured, remote, nowMs} and returns a
 * verdict string. No network, no file system.
 */

const assert = require("assert");
const { classifyCell, pricesAgree, ISO_TOLERANCE_MS } = require("../scripts/aodp-upload-verify.cjs");

const CASES = [
  {
    name: "no AODP row at all → missing",
    captured: { sell_price: 100, sell_date: "2026-08-14T07:00:00.000Z" },
    remote: null,
    expect: "missing",
  },
  {
    name: "AODP row exists but every price is 0 → missing",
    captured: { sell_price: 100, sell_date: "2026-08-14T07:00:00.000Z" },
    remote: { sell_price_min: 0, buy_price_max: 0, sell_price_min_date: "0001-01-01T00:00:00" },
    expect: "missing",
  },
  {
    name: "same price, same second → landed",
    captured: { sell_price: 100, sell_date: "2026-08-14T07:00:00.000Z" },
    remote: { sell_price_min: 100, sell_price_min_date: "2026-08-14T07:00:00" },
    expect: "landed",
  },
  {
    name: "same price, AODP stamp within tolerance → landed",
    captured: { sell_price: 100, sell_date: "2026-08-14T07:00:00.000Z" },
    remote: { sell_price_min: 100, sell_price_min_date: "2026-08-14T07:00:04" },
    expect: "landed",
  },
  {
    name: "AODP has a NEWER reading than ours → newer-there",
    captured: { sell_price: 100, sell_date: "2026-08-14T07:00:00.000Z" },
    remote: { sell_price_min: 90, sell_price_min_date: "2026-08-14T09:00:00" },
    expect: "newer-there",
  },
  {
    name: "our capture is newer and AODP never got it → stale-there",
    captured: { sell_price: 100, sell_date: "2026-08-14T07:00:00.000Z" },
    remote: { sell_price_min: 90, sell_price_min_date: "2026-08-10T07:00:00" },
    expect: "stale-there",
  },
  {
    name: "AODP's 5-minute bucket floor of our capture → landed",
    captured: { sell_price: 100, sell_date: "2026-08-14T07:18:52.849Z" },
    remote: { sell_price_min: 100, sell_price_min_date: "2026-08-14T07:15:00" },
    expect: "landed",
  },
  {
    name: "one bucket earlier is genuinely older → stale-there",
    captured: { sell_price: 100, sell_date: "2026-08-14T07:18:52.849Z" },
    remote: { sell_price_min: 100, sell_price_min_date: "2026-08-14T07:10:00" },
    expect: "stale-there",
  },
  {
    name: "buy side alone is enough to land",
    captured: { buy_price: 55, buy_date: "2026-08-14T07:00:00.000Z" },
    remote: { buy_price_max: 55, buy_price_max_date: "2026-08-14T07:00:00", sell_price_min: 0 },
    expect: "landed",
  },
  {
    name: "price differs but stamp matches ours → landed (book moved, upload arrived)",
    captured: { sell_price: 100, sell_date: "2026-08-14T07:00:00.000Z" },
    remote: { sell_price_min: 120, sell_price_min_date: "2026-08-14T07:00:00" },
    expect: "landed",
  },
  {
    name: "capture with no usable date is not judged → undated",
    captured: { sell_price: 100 },
    remote: { sell_price_min: 100, sell_price_min_date: "2026-08-14T07:00:00" },
    expect: "undated",
  },
];

let failed = 0;
CASES.forEach((c) => {
  const got = classifyCell({ captured: c.captured, remote: c.remote });
  try {
    assert.strictEqual(got, c.expect);
    console.log(`ok   ${c.name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${c.name}: expected ${c.expect}, got ${got}`);
  }
});

// The tolerance exists because AODP truncates to the second and the ingest
// re-stamps on arrival; anything bigger would start calling other players'
// uploads ours.
assert.ok(ISO_TOLERANCE_MS >= 1000 && ISO_TOLERANCE_MS <= 60000, "tolerance out of range");

// Price agreement is the second axis: the stamp says WHEN, this says the
// numbers are the ones we sniffed.
const PRICE_CASES = [
  ["both sides equal", { sell_price: 10, buy_price: 5 }, { sell_price_min: 10, buy_price_max: 5 }, true],
  ["sell differs", { sell_price: 10, buy_price: 5 }, { sell_price_min: 11, buy_price_max: 5 }, false],
  ["side we never observed is ignored", { sell_price: 10 }, { sell_price_min: 10, buy_price_max: 999 }, true],
  ["nothing observed", {}, { sell_price_min: 10, buy_price_max: 5 }, false],
  ["no remote row", { sell_price: 10 }, null, false],
];
PRICE_CASES.forEach(([name, captured, remote, expect]) => {
  const got = pricesAgree(captured, remote);
  try {
    assert.strictEqual(got, expect);
    console.log(`ok   pricesAgree: ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL pricesAgree: ${name}: expected ${expect}, got ${got}`);
  }
});

if (failed) {
  console.log(`\n${failed} failing`);
  process.exit(1);
}
console.log(`\n${CASES.length + PRICE_CASES.length} passing`);
