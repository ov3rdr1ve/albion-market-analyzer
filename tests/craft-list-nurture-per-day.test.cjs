/**
 * My Crafting List — a nurture ladder is billed to the budget PER DAY.
 *
 * Nurturing has a 24h cooldown and is hard-capped at the number of days the
 * baby takes to grow with Premium, so a T6 Moose's "4x @ 125 focus = 500 focus
 * total" is 125 a day for four days. The budget box is a DAILY pool (~10,000
 * regenerated a day), so billing the whole ladder against it read 144 moose as
 * 72,000 focus — 62,000 of it "unfocused" — when a day of that plan only ever
 * has to cover 144 x 125 = 18,000.
 *
 * Only the CHARGE is per day. An unfunded baby forfeits the whole ladder, so
 * its focus-off profit still subtracts the full delta, and silver-per-focus is
 * unchanged: dividing cost and gain by the same number of days leaves the
 * ranking the greedy allocator sorts on exactly where it was.
 *
 * Black box over the shipped modules — synthetic rows, no DOM, no market data.
 *
 * Run: node tests/craft-list-nurture-per-day.test.cjs
 */
const assert = require("assert");
const path = require("path");

const {
  extractCraftListRow,
  summarizeCraftList,
} = require(path.join(__dirname, "..", "js", "craft-list-materials.js"));
const {
  allocateCraftListFocus,
  craftListFocusRate,
} = require(path.join(__dirname, "..", "js", "craft-list-focus-budget.js"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

// The reported row: T6 Moose, all breeding nodes at 100 (125 focus a nurture),
// four nurture cycles, the nurture play winning over the saddler craft.
function mooseRow(over) {
  return Object.assign({
    isBreeding: true,
    item: { babyId: "T6_FARM_GIANTSTAG_MOOSE_BABY", id: "T6_MOUNT_GIANTSTAG_MOOSE", name: "Moose [T6]" },
    meta: { maxNurtures: 4, focusPerNurture: 125, totalNurtureFocus: 500 },
    craftCity: "Brecilien",
    sellPot: { city: "Lymhurst", price: 469899 },
    buyMat: { city: "Brecilien" },
    totalInputCost: 269453,
    marginInfo: { profit: 217907 },
    focusCost: 500,
    focusProfitDelta: 48005,
    bestFocusPlay: { kind: "nurture", focusCost: 500, profitDelta: 48005 },
    rrr: 0,
    materials: [],
  }, over || {});
}

// A saddler craft is one sitting, not a ladder.
function saddlerRow() {
  return mooseRow({
    focusCost: 3283,
    focusProfitDelta: 23164,
    bestFocusPlay: { kind: "saddler", focusCost: 3283, profitDelta: 23164 },
  });
}

console.log("Craft List — nurture focus per day\n");

// ── the charge ─────────────────────────────────────────────────────────────

[
  // [name, row, expectedFocusCost, expectedDays]
  ["a 4-cycle nurture bills one day of the ladder", mooseRow(), 125, 4],
  ["a 1-cycle nurture bills the whole charge", mooseRow({
    meta: { maxNurtures: 1, focusPerNurture: 125, totalNurtureFocus: 125 },
    focusCost: 125,
    bestFocusPlay: { kind: "nurture", focusCost: 125, profitDelta: 12000 },
  }), 125, 1],
  ["a saddler craft is never spread over days", saddlerRow(), 3283, 1],
  ["a row with no meta keeps its whole charge", mooseRow({ meta: undefined }), 500, 1],
].forEach(([name, row, focus, days]) => {
  test(name, () => {
    const e = extractCraftListRow("mounts-table", row);
    assert.strictEqual(Math.round(e.focusCost * 100) / 100, focus, "focusCost");
    assert.strictEqual(e.focusDays, days, "focusDays");
  });
});

test("dividing cost and gain by the same days leaves silver/focus alone", () => {
  const e = extractCraftListRow("mounts-table", mooseRow());
  assert.strictEqual(craftListFocusRate(e), 48005 / 500);
});

test("an unfunded baby forfeits the WHOLE ladder, not one day of it", () => {
  const e = extractCraftListRow("mounts-table", mooseRow());
  assert.strictEqual(e.unitProfit, 217907);
  assert.strictEqual(e.unitProfitNoFocus, 217907 - 48005);
  assert.strictEqual(e.laborerProfitNoFocus, 217907 - 48005);
});

// ── the reported basket ────────────────────────────────────────────────────

test("144 moose need 18,000 focus a day, not 72,000", () => {
  const entries = [Object.assign(extractCraftListRow("mounts-table", mooseRow()), { qty: 144 })];
  const alloc = allocateCraftListFocus(entries, 10000);
  assert.strictEqual(alloc.focusNeeded, 144 * 125);
  assert.strictEqual(alloc.focusUsed, 10000, "the whole bar is spent");
  assert.strictEqual(alloc.focusUnfunded, 18000 - 10000);
  assert.strictEqual(alloc.splits[0].fundedQty, 80, "10,000 / 125");
  assert.strictEqual(alloc.splits[0].unfundedQty, 64);
});

test("the footer reports the daily draw and how long the instalment runs", () => {
  const entries = [Object.assign(extractCraftListRow("mounts-table", mooseRow()), { qty: 144 })];
  const totals = summarizeCraftList(entries, allocateCraftListFocus(entries, 10000));
  assert.strictEqual(totals.totalFocus, 10000);
  assert.strictEqual(totals.focusNeeded, 18000);
  assert.strictEqual(totals.focusUnfunded, 8000);
  assert.strictEqual(totals.focusDays, 4);
});

test("a basket of instant crafts stays a one-sitting spend", () => {
  const entries = [Object.assign(extractCraftListRow("mounts-table", saddlerRow()), { qty: 2 })];
  const totals = summarizeCraftList(entries, allocateCraftListFocus(entries, 10000));
  assert.strictEqual(totals.focusDays, 1);
  assert.strictEqual(totals.focusNeeded, 2 * 3283);
});

test("a parked row does not stretch the list's instalment", () => {
  const entries = [Object.assign(extractCraftListRow("mounts-table", mooseRow()), { qty: 0 })];
  assert.strictEqual(summarizeCraftList(entries, null).focusDays, 1);
});

// ── the footer label follows focusDays ─────────────────────────────────────

const fs = require("fs");
const footerSrc = fs
  .readFileSync(path.join(__dirname, "..", "js", "render-craft-list-footer.js"), "utf-8")
  .split("\r\n").join("\n");

test("the footer labels a multi-day basket focus/day", () => {
  assert.ok(/totals\.focusDays/.test(footerSrc), "the footer must read totals.focusDays");
  assert.ok(/r_cl_focus_per_day/.test(footerSrc), "a per-day label needs its own string");
  assert.ok(/focus\/day/.test(footerSrc), 'the EN fallback should read "focus/day"');
});

test("ES rows carry the per-day label and its tooltip", () => {
  const es = fs
    .readFileSync(path.join(__dirname, "..", "js", "i18n-strings-es-rows.js"), "utf-8")
    .split("\r\n").join("\n");
  assert.ok(/r_cl_focus_per_day:/.test(es), "missing ES r_cl_focus_per_day");
  assert.ok(/r_cl_focus_per_day_tip:/.test(es), "missing ES r_cl_focus_per_day_tip");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
