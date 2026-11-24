/**
 * Tests: Artifact rolling strategy decision logic (js/rolling-strategy.js).
 *
 * Behaviour under test (black-box, parameterized):
 *  - classifyRollGroup picks hunt / keep-any / unprofitable from the pool EV.
 *  - decideRowAction maps each artifact to sell / reroll / salvage / skip.
 *  - INVARIANT: 'reroll' is advised ONLY inside a hunt group. In every other
 *    mode the advice is terminal (sell or salvage) — you never gamble again.
 *    This is the bug the table had: reroll badges appeared in keep-any groups
 *    (and the hunt-mode header label never rendered), so the advice looked
 *    arbitrary.
 *
 * Run: node tests/rolling-strategy.test.cjs
 */
const assert = require("assert");
const {
  solveOptimalThreshold,
  classifyRollGroup,
  decideRowAction,
} = require("../js/rolling-strategy.js");

// ── Production constants mirrored so the test exercises the real numbers ─────
const SALVAGE_RETURN = 10; // fragments recovered per salvage (20% of the 50-frag recipe)
const SALVAGE_SILVER = 0; // salvaging returns silver, it never charges a fee
const BUY_FEE = 0.025; // 2.5% setup fee buying fragments
const SALV_SELL_TAX = 0.04; // tax selling recovered fragments to buy orders
const SELL_TAX = 0.065; // 6.5% market tax selling the artifact

// net silver recovered from salvaging one artifact (10 frags, no fee)
const salvageVal = (fragPrice) =>
  SALVAGE_RETURN * fragPrice * (1 - SALV_SELL_TAX) + SALVAGE_SILVER;
// net silver burned per reroll = full roll cost − salvage recovery
const netReroll = (rollFrags, fragPrice) =>
  rollFrags * fragPrice * (1 + BUY_FEE) - salvageVal(fragPrice);
// net (post-tax) sell revenue for a raw sell price
const net = (raw) => raw * (1 - SELL_TAX);

// T4 Relic "Any" pool from the reported screenshot (36 frags @ 368 silver each)
const SCREENSHOT_RAW = {
  WarpedRavenPlate: 4667, UnholyScroll: 88000, PreservedRocks: 6040,
  PreservedLog: 4581, PreservedAnimalFur: 70000, PossessedCatalyst: 4975,
  KeeperAxeheads: 85552, InscribedStone: 10500, InscribedBindings: 5557,
  ImbuedMaceHead: 4435, GhastlyVisor: 39972, GhastlyScroll: 11000,
  GhastlyLeather: 4694, GhastlyCandle: 12996, GhastlyBlades: 29900,
  GhastlyBindings: 26251, EngravedLog: 4390, CursedFrozenCrystal: 10000,
  CursedBlades: 4431, CursedBarbs: 4895, CarvedSkullPadding: 12000,
  CarvedBone: 73897, BloodforgedSpikes: 25000, BloodforgedCatalyst: 5866,
  AlluringPadding: 33996, AlluringBolts: 6994, AlluringBindings: 18800,
  AlluringAmulet: 28354,
};
const SCREENSHOT_POOL = Object.values(SCREENSHOT_RAW).map(net);
const SCREENSHOT_FRAG = 368;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.error(`  FAIL: ${name}\n    ${e.message}`); }
}

// ── solveOptimalThreshold ───────────────────────────────────────────────────
console.log("solveOptimalThreshold:");

test("empty pool returns 0 (no crash)", () => {
  assert.strictEqual(solveOptimalThreshold([], 1000), 0);
});

test("huge reroll cost drives T* below the cheapest artifact (never reroll)", () => {
  const vals = [100, 200, 300];
  const T = solveOptimalThreshold(vals, 5_000_000);
  assert.ok(T < Math.min(...vals), "T* should sink below min value");
});

// ── classifyRollGroup ───────────────────────────────────────────────────────
console.log("\nclassifyRollGroup:");

test("cheap frags + big jackpot spread → hunt", () => {
  const { type, Tstar } = classifyRollGroup(
    SCREENSHOT_POOL, netReroll(36, SCREENSHOT_FRAG),
  );
  assert.strictEqual(type, "hunt");
  assert.ok(
    Tstar > 0 && Tstar < Math.max(...SCREENSHOT_POOL),
    "Tstar must sit strictly between 0 and the jackpot value",
  );
});

test("expensive frags → keep-any (rolling marginal, never reroll)", () => {
  const raw = [50000, 80000, 150000, 100000, 250000, 70000, 60000, 400000, 120000, 90000];
  const { type, Tstar } = classifyRollGroup(raw.map(net), netReroll(50, 120000));
  assert.strictEqual(type, "keep-any");
  assert.ok(Tstar <= 0, "Tstar should be <= 0 when frags dwarf artifacts");
});

test("tight spread + cheap frags (all above T*) → keep-any", () => {
  const raw = [300000, 310000, 305000, 308000, 302000];
  const { type } = classifyRollGroup(raw.map(net), netReroll(36, 2000));
  assert.strictEqual(type, "keep-any");
});

// ── decideRowAction ─────────────────────────────────────────────────────────
console.log("\ndecideRowAction:");

test("hunt: artifact above T* → sell", () => {
  assert.strictEqual(
    decideRowAction("hunt", 17600, net(88000), salvageVal(368)), "sell",
  );
});

test("hunt: artifact below T* → reroll", () => {
  assert.strictEqual(
    decideRowAction("hunt", 17600, net(4667), salvageVal(368)), "reroll",
  );
});

test("keep-any: artifact worth more than salvage → sell", () => {
  assert.strictEqual(
    decideRowAction("keep-any", 5000, net(80000), salvageVal(2000)), "sell",
  );
});

test("keep-any: artifact worth less than salvage → salvage (NOT reroll)", () => {
  // frag 120k → salvage ~1.15M; artifact net 74.8k < salvage → salvage & cash out
  assert.strictEqual(
    decideRowAction("keep-any", -5_000_000, net(80000), salvageVal(120000)),
    "salvage",
  );
});

test("unprofitable: any artifact → skip (NOT reroll)", () => {
  assert.strictEqual(
    decideRowAction("unprofitable", 999999, net(50000), salvageVal(120000)),
    "skip",
  );
});

// ── The core invariant the user reported ────────────────────────────────────
console.log("\nINVARIANT — reroll only in hunt mode:");

test("reroll is never advised outside a hunt group", () => {
  const sv = salvageVal(368);
  for (const type of ["keep-any", "unprofitable"]) {
    for (const raw of [1, 4667, 18800, 88000, 5_000_000]) {
      const action = decideRowAction(type, 17600, net(raw), sv);
      assert.notStrictEqual(
        action, "reroll",
        `reroll leaked into "${type}" for raw=${raw}`,
      );
    }
  }
});

// ── End-to-end: the screenshot pool produces the expected keep/reroll split ──
console.log("\nScreenshot pool (T4 Relic, frag=368) keep/reroll split:");

test("jackpots sell, cheap artifacts reroll — matches the optimal threshold", () => {
  const { type, Tstar } = classifyRollGroup(
    SCREENSHOT_POOL, netReroll(36, SCREENSHOT_FRAG),
  );
  const sv = salvageVal(SCREENSHOT_FRAG);
  const act = (key) => decideRowAction(type, Tstar, net(SCREENSHOT_RAW[key]), sv);

  // High-value artifacts → sell
  for (const k of ["UnholyScroll", "KeeperAxeheads", "CarvedBone",
    "PreservedAnimalFur", "GhastlyVisor", "GhastlyBlades", "GhastlyBindings",
    "BloodforgedSpikes", "AlluringPadding", "AlluringAmulet"]) {
    assert.strictEqual(act(k), "sell", `${k} should be sell`);
  }
  // Cheap artifacts → reroll
  for (const k of ["WarpedRavenPlate", "PreservedRocks", "PreservedLog",
    "PossessedCatalyst", "InscribedStone", "ImbuedMaceHead", "GhastlyScroll",
    "GhastlyLeather", "GhastlyCandle", "EngravedLog", "CursedFrozenCrystal",
    "CursedBlades", "CursedBarbs", "CarvedSkullPadding", "BloodforgedCatalyst",
    "AlluringBolts"]) {
    assert.strictEqual(act(k), "reroll", `${k} should be reroll`);
  }
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
