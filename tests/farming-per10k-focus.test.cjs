/**
 * Test: the Farming table's "Profit / 10k Focus" column.
 *
 * Farming spends focus every cycle — watering a crop/herb plot, or nurturing a
 * pasture animal — but until now it published only the MARGINAL rate
 * (profitPerFocus = play delta / focus cost) behind its Silver/Focus column.
 * The new column is the THROUGHPUT figure every other focus table reports:
 *
 *   profitPer10kFocus = watered cycle profit x floor(10000 / focusCost)
 *
 * The two are different denominators on purpose. This file pins:
 *   1. calcFarmingEconomics publishes profitPerCycleFocusOn, and it does NOT
 *      move with `useWater` — a full focus bar is focus-ON play by definition,
 *      so the column must not follow the global Use Focus checkbox.
 *   2. The per-10k arithmetic itself (whole cycles only, losses kept, no play
 *      means no figure).
 *   3. The index.html wiring: the header, its sort key, its position, and the
 *      placeholder colspan.
 *   4. That the Top 10 Profit / 10k Focus board reads farming's per-10k field
 *      and never its marginal rate.
 *
 * Black box over the shipped modules; no market data, no DOM, no live calls.
 *
 * Run: node tests/farming-per10k-focus.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { readIndexHtml } = require("./helpers/page-source.cjs");

const {
  calcFarmingEconomics,
  calculateProfitPer10kFocus,
  FOCUS_BAR,
} = require("../js/calculations.js");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

// A crop and a herb (watering raises the seed-return yield) plus a pasture
// animal (no watering bonus at all — its focus play is nurturing).
const CROP = {
  type: "crop", seedPrice: 300, outputSellPrice: 900,
  baseSeedYield: 0.5, wateringBonus: 0.25, plotsPerCycle: 9, cycleHours: 22,
};
const HERB = {
  type: "herb", seedPrice: 120, outputSellPrice: 410,
  baseSeedYield: 0.4, wateringBonus: 0.2, plotsPerCycle: 9, cycleHours: 22,
};
const BYPRODUCT = {
  type: "byproduct", seedPrice: 400, feedCount: 9, producePerCycle: 9.5,
  outputSellPrice: 700,
  baseSeedYield: 0, wateringBonus: 0, plotsPerCycle: 1, cycleHours: 22,
};

console.log("\n=== profitPerCycleFocusOn is the watered cycle, always ===");

[["crop", CROP], ["herb", HERB], ["byproduct", BYPRODUCT]].forEach(([label, base]) => {
  test(`${label}: the focus-ON cycle is identical with useWater on and off`, () => {
    const on = calcFarmingEconomics({ ...base, focusPerCycle: 100, useWater: true });
    const off = calcFarmingEconomics({ ...base, focusPerCycle: 100, useWater: false });
    assert.ok(Number.isFinite(on.profitPerCycleFocusOn), "no profitPerCycleFocusOn published");
    assert.strictEqual(on.profitPerCycleFocusOn, off.profitPerCycleFocusOn);
  });

  test(`${label}: the focus-ON cycle equals profitPerCycle when watering is ON`, () => {
    const on = calcFarmingEconomics({ ...base, focusPerCycle: 100, useWater: true });
    assert.strictEqual(on.profitPerCycleFocusOn, on.profitPerCycle);
  });
});

test("crop: profitPerCycle DOES follow useWater — only the focus-ON twin is fixed", () => {
  const on = calcFarmingEconomics({ ...CROP, focusPerCycle: 100, useWater: true });
  const off = calcFarmingEconomics({ ...CROP, focusPerCycle: 100, useWater: false });
  assert.notStrictEqual(on.profitPerCycle, off.profitPerCycle,
    "watering raises the seed-return yield, so the displayed cycle must differ");
});

test("byproduct: watered == dry, so the focus-ON cycle is the ordinary one", () => {
  const off = calcFarmingEconomics({ ...BYPRODUCT, focusPerCycle: 100, useWater: false });
  assert.strictEqual(off.profitPerCycleFocusOn, off.profitPerCycle,
    "a pasture animal gets no watering bonus; nurturing buys offspring, not more milk");
});

test("the marginal rate still comes from the delta, not the whole cycle", () => {
  const e = calcFarmingEconomics({ ...CROP, focusPerCycle: 100, useWater: true });
  assert.strictEqual(e.profitPerFocus, e.wateringProfitDelta / 100);
  assert.ok(e.wateringProfitDelta < e.profitPerCycleFocusOn,
    "the delta is a slice of the cycle, never the whole of it — the two columns differ");
});

console.log("\n=== the per-10k arithmetic ===");

[
  { focusCost: 100, cycles: 100 },
  { focusCost: 300, cycles: 33 },   // 33.33 -> 33; leftover focus buys nothing
  { focusCost: 7000, cycles: 1 },
  // A cycle dearer than the bar: the bar pays for a fraction of it, never 0.
  { focusCost: 12000, cycles: 10000 / 12000 },
].forEach(({ focusCost, cycles }) => {
  test(`focusCost ${focusCost}: ${cycles} cycles per ${FOCUS_BAR} bar`, () => {
    assert.strictEqual(calculateProfitPer10kFocus(1, focusCost), cycles);
  });
});

test("the figure is the watered cycle profit times those whole cycles", () => {
  const e = calcFarmingEconomics({ ...CROP, focusPerCycle: 250, useWater: false });
  const per10k = calculateProfitPer10kFocus(e.profitPerCycleFocusOn, 250);
  assert.strictEqual(per10k, e.profitPerCycleFocusOn * 40);
});

test("no focus play (focusCost 0) yields no figure, not a zero-profit claim", () => {
  assert.strictEqual(calculateProfitPer10kFocus(999999, 0), 0);
});

test("a losing cycle gives a negative figure — a loss is a real answer", () => {
  const loss = calcFarmingEconomics({
    ...CROP, seedPrice: 4000, outputSellPrice: 50, focusPerCycle: 100, useWater: true,
  });
  assert.ok(loss.profitPerCycleFocusOn < 0);
  assert.ok(calculateProfitPer10kFocus(loss.profitPerCycleFocusOn, 100) < 0);
});

console.log("\n=== the renderer publishes the row fields ===");

const renderSrc = read("js/render-farming.js");

test("the row carries focusCost, profitFocusOn and profitPer10kFocus", () => {
  ["focusCost:", "profitFocusOn:", "profitPer10kFocus:"].forEach((field) => {
    assert.ok(renderSrc.includes(field), `row does not publish ${field}`);
  });
});

test("the figure is built by the shared helper, not re-derived locally", () => {
  assert.ok(/calculateProfitPer10kFocus\(/.test(renderSrc));
  const localFloors = renderSrc.match(/Math\.floor\(\s*10000\s*\/[^)]*\)/g) || [];
  assert.deepStrictEqual(localFloors, ["Math.floor(10000 / row.focusCost)"],
    "the only local bar division may be the tooltip's cycle count");
});

test("focusCost comes from the winning play, so no play means 0", () => {
  assert.ok(/bestFocusPlay \? bestFocusPlay\.focusCost : 0/.test(renderSrc));
});

console.log("\n=== index.html wiring ===");

const html = readIndexHtml();
const farmingSection = (() => {
  const i = html.indexOf('<table id="farming-table"');
  assert.ok(i > 0, "no farming table in index.html");
  return html.slice(i, html.indexOf("</table>", i));
})();

test("the Farming table has a Profit / 10k Focus header on the shared sort key", () => {
  assert.ok(/data-sort="profitPer10kFocus"/.test(farmingSection));
  assert.ok(/>Profit \/ 10k Focus</.test(farmingSection));
});

test("it reuses the shared column label key", () => {
  const th = (farmingSection.match(/<th[^>]*data-sort="profitPer10kFocus"[^>]*>/) || [""])[0];
  assert.ok(/data-i18n="profit_10k_focus"/.test(th));
});

test("it sits before Silver / Focus, so the marginal pair still reads together", () => {
  const p10k = farmingSection.indexOf('data-sort="profitPer10kFocus"');
  const ppf = farmingSection.indexOf('data-sort="profitPerFocus"');
  const bf = farmingSection.indexOf('data-sort="bestFocus"');
  assert.ok(p10k < ppf && ppf < bf);
});

test("the awaiting-scan colspan still matches the header count", () => {
  const thCount = (farmingSection.match(/<th /g) || []).length;
  assert.strictEqual(Number((farmingSection.match(/colspan="(\d+)"/) || [])[1]), thCount);
});

test("the focus board subtitle counts Farming among the focus tables", () => {
  const sub = (html.match(/data-i18n="top_focus_subtitle"[^>]*>([^<]+)</) || [])[1] || "";
  assert.ok(/Farming/.test(sub), `subtitle still lists the old set: ${sub}`);
});

console.log("\n=== the Top 10 focus board reads the per-10k field ===");

const { JOINED_SOURCES } = require("../js/joined-summary-sources.js");

test("farming feeds the focus board off focusCost + profitPer10kFocus", () => {
  assert.deepStrictEqual(
    JOINED_SOURCES["farming-table"].focus({
      focusCost: 100, profitPer10kFocus: 5000, profitPerFocus: 999999,
    }),
    { cost: 100, per10k: 5000 },
  );
});

test("a farming row with no focus play never reaches the board", () => {
  assert.strictEqual(
    JOINED_SOURCES["farming-table"].focus({ focusCost: 0, profitPer10kFocus: 0 }), null,
  );
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed === 0 ? 0 : 1);
