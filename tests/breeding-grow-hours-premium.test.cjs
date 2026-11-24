/**
 * Test: the grow time a breeding row prints follows the Premium Account toggle.
 *
 * Premium halves baby growth time. getBreedingMeta().growHours is the
 * NON-Premium base (the nurture-cycle invariant ceil(growHours / 2 / 24) ===
 * maxNurtures depends on it), and getBreedingGrowHours(meta) is the figure to
 * DISPLAY: base / 2 with Premium, the base without.
 *
 * Black-box: sandboxed copies of js/render-mounts.js (helpers) and
 * js/render-mounts-breeding-row.js, stubbed dependencies, no live API.
 *
 * Run: node tests/breeding-grow-hours-premium.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");
const mountsSrc = read("render-mounts.js");
const helperSource = mountsSrc.slice(0, mountsSrc.indexOf("function renderMountsTable"));

// premium: true | false | "absent" (isPremiumEnabled not defined at all)
function makeSandbox(premium) {
  const stubs = {
    tx: (en) => en,
    txFood: (s) => s,
    ITEM_NAMES_MAP: {},
    getItemDisplayName: (id) => id,
    getTierFromId: (id) => parseInt(String(id).match(/^T(\d+)/)?.[1] || "4", 10),
    getIQRBounds: () => null,
    getOverridePrice: () => null,
    getCityForce: () => null,
    getBuyPrice: () => 0,
    matPriceSpan: () => "",
    formatSilver: (n) => String(Math.round(n || 0)),
    formatFocusCost: (n) => String(n),
    priceTd: () => "",
    profitTd: () => "",
    pureProfitTd: () => "",
    addTdForKey: () => "",
    dispName: (id, name) => name || id,
    focusPlayCell: () => "",
    getProfitClass: () => "",
    brecilienFeeBadge: () => "",
    isFocusEnabled: () => false,
  };
  if (premium !== "absent") stubs.isPremiumEnabled = () => premium;
  const ctx = vm.createContext({ ...stubs, module: { exports: {} }, console });
  const code = read("rrr-eligible.js") + read("data-mounts.js") + helperSource
    + read("render-mounts-breeding-row.js")
    + "\nglobalThis.__nurtureData = BREEDING_NURTURE_DATA;";
  vm.runInContext(code, ctx);
  return ctx;
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

console.log("\n=== Breeding: grow hours follow Premium ===");

// [babyId, non-Premium hours, Premium hours]
const cases = [
  ["T3_FARM_HORSE_BABY", 44, 22],
  ["T4_FARM_HORSE_BABY", 92, 46],
  ["T5_FARM_HORSE_BABY", 140, 70],
  ["T6_FARM_HORSE_BABY", 188, 94],
  ["T7_FARM_HORSE_BABY", 236, 118],
  ["T8_FARM_HORSE_BABY", 284, 142],
  ["T3_FARM_CHICKEN_BABY", 44, 22],   // livestock short-grow line
  ["T8_FARM_COW_BABY", 44, 22],
  ["T8_FARM_DRAKE_BABY", 668, 334],  // Firewing Drake override
];

for (const [babyId, off, on] of cases) {
  test(`${babyId}: Premium ON -> ${on}h, OFF -> ${off}h`, () => {
    const onCtx = makeSandbox(true), offCtx = makeSandbox(false);
    assert.strictEqual(onCtx.getBreedingGrowHours(onCtx.getBreedingMeta({ babyId })), on);
    assert.strictEqual(offCtx.getBreedingGrowHours(offCtx.getBreedingMeta({ babyId })), off);
  });

  test(`${babyId}: meta.growHours stays the non-Premium base ${off} in both states`, () => {
    for (const p of [true, false]) {
      const c = makeSandbox(p);
      assert.strictEqual(c.getBreedingMeta({ babyId }).growHours, off);
    }
  });
}

test("isPremiumEnabled absent -> treated as Premium ON", () => {
  const c = makeSandbox("absent");
  assert.strictEqual(c.getBreedingGrowHours(c.getBreedingMeta({ babyId: "T8_FARM_HORSE_BABY" })), 142);
});

test("maxNurtures is identical in both Premium states", () => {
  const a = makeSandbox(true), b = makeSandbox(false);
  for (const babyId of Object.keys(a.__nurtureData)) {
    assert.strictEqual(a.getBreedingMeta({ babyId }).maxNurtures,
      b.getBreedingMeta({ babyId }).maxNurtures, babyId);
  }
});

// Minimal row: only the fields the meta line and the cells read.
function rowFor(ctx, babyId) {
  const item = { id: "X", name: "X", babyId, grownId: "G", babyName: "Baby" };
  const zero = { price: 0, city: "Martlock" };
  return {
    item, meta: ctx.getBreedingMeta(item), feed: null, recipe: null,
    buyMat: zero, sellPot: zero, marginInfo: { profit: 0, margin: 0 },
    profitPerFocus: 0, nurtureEv: 0, focusCost: 0, totalInputCost: 0,
    totalFavorCost: 0, totalFpCost: 0, silverPerFp: 0, babyRawSilverPerFp: 0,
  };
}

for (const [premium, hours] of [[true, 142], [false, 284]]) {
  test(`rendered T8 horse row prints "${hours}h grow" (Premium ${premium ? "ON" : "OFF"})`, () => {
    const c = makeSandbox(premium);
    const html = c.renderBreedingMountRow(rowFor(c, "T8_FARM_HORSE_BABY"), 0, "k");
    assert.ok(html.includes(`${hours}h grow`), `row html lacks "${hours}h grow"`);
    const other = premium ? "284h grow" : "142h grow";
    assert.ok(!html.includes(other), `row html must not contain "${other}"`);
  });
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
