/**
 * Tests: Artifact rolling CAMPAIGN economics (js/rolling-strategy.js).
 *
 * `rollCampaignEconomics` answers the question the group-header row asks:
 * "if I buy fragments and roll this pool, playing the optimal-stopping policy,
 *  what do I actually make — per campaign, per fragment, and as a margin?"
 *
 * Behaviour under test (black-box, parameterized):
 *  - hunt groups pay for MORE than one roll, so the margin/per-fragment figures
 *    must be normalized by the EXPECTED total spend, not the first roll alone;
 *  - keep-any / unprofitable groups are single-roll, and the dud outcome is
 *    salvaged (so profit uses E[max(v, salvage)], never a bare E[v]);
 *  - per-fragment profit is the campaign profit divided by the fragments the
 *    campaign really burns (rollFrags first roll, rollFrags−salvageFrags each
 *    reroll) — this is the "how much extra is one relic worth" number;
 *  - degenerate inputs (empty pool, zero fragments) do not produce NaN/Infinity.
 *
 * Run: node tests/rolling-campaign-economics.test.cjs
 */
const assert = require("assert");
const {
  classifyRollGroup,
  rollCampaignEconomics,
} = require("../js/rolling-strategy.js");

// ── Production constants mirrored so the test exercises the real numbers ─────
const SALVAGE_FRAGS = 10; // 20% of the artifact's 50-fragment recipe
const SALVAGE_SILVER = 0; // salvaging returns silver, never charges a fee
const BUY_FEE = 0.025;
const SALV_SELL_TAX = 0.04; // instant-sell tax only (no setup fee)
const SELL_TAX = 0.065;

const salvageVal = (fragPrice) =>
  SALVAGE_FRAGS * fragPrice * (1 - SALV_SELL_TAX) + SALVAGE_SILVER;
const rollCost = (frags, fragPrice) => frags * fragPrice * (1 + BUY_FEE);
const net = (raw) => raw * (1 - SELL_TAX);

// T4 Relic "Any" pool (36 frags @ 368 silver each) — wide spread ⇒ hunt.
const HUNT_RAW = [
  4667, 88000, 6040, 4581, 70000, 4975, 85552, 10500, 5557, 4435, 39972, 11000,
  4694, 12996, 29900, 26251, 4390, 10000, 4431, 4895, 12000, 73897, 25000,
  5866, 33996, 6994, 18800, 28354,
];
const HUNT_POOL = HUNT_RAW.map(net);
const HUNT_FRAG = 368;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.error(`  FAIL: ${name}\n    ${e.message}`); }
}
const close = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ~${b}`);

const huntEcon = () =>
  rollCampaignEconomics(
    HUNT_POOL, rollCost(36, HUNT_FRAG), salvageVal(HUNT_FRAG), 36, SALVAGE_FRAGS,
  );

// ── Shape & identities ──────────────────────────────────────────────────────
console.log("rollCampaignEconomics — identities:");

test("campaign profit for a hunt group is T* − salvage value", () => {
  const e = huntEcon();
  assert.strictEqual(e.type, "hunt");
  close(e.profitPerCampaign, e.Tstar - salvageVal(HUNT_FRAG), 1e-6,
    "profitPerCampaign");
});

test("expected rolls = 1 / P(sell) and always ≥ 1", () => {
  const e = huntEcon();
  const p = HUNT_POOL.filter((v) => v >= e.Tstar).length / HUNT_POOL.length;
  close(e.expectedRolls, 1 / p, 1e-6, "expectedRolls");
  assert.ok(e.expectedRolls >= 1);
});

test("a hunt group expects MORE than one roll (rerolls really happen)", () => {
  assert.ok(huntEcon().expectedRolls > 1.5,
    "wide-spread pool should reroll most outcomes");
});

test("expected fragments = first roll + (roll − salvage) per reroll", () => {
  const e = huntEcon();
  close(e.expectedFragments, 36 + 26 * (e.expectedRolls - 1), 1e-6,
    "expectedFragments");
});

test("expected cost = first roll + net reroll cost per reroll", () => {
  const e = huntEcon();
  const c = rollCost(36, HUNT_FRAG);
  close(e.expectedCost, c + (c - salvageVal(HUNT_FRAG)) * (e.expectedRolls - 1),
    1e-6, "expectedCost");
});

test("margin and per-fragment profit divide by the EXPECTED spend", () => {
  const e = huntEcon();
  close(e.marginPct, (e.profitPerCampaign / e.expectedCost) * 100, 1e-6, "marginPct");
  close(e.profitPerFragment, e.profitPerCampaign / e.expectedFragments, 1e-6,
    "profitPerFragment");
});

test("normalizing by expected spend is STRICTLY less optimistic than by one roll", () => {
  const e = huntEcon();
  const naiveMargin = (e.profitPerCampaign / rollCost(36, HUNT_FRAG)) * 100;
  const naivePerFrag = e.profitPerCampaign / 36;
  assert.ok(e.marginPct < naiveMargin,
    `expected-spend margin ${e.marginPct} should be below one-roll ${naiveMargin}`);
  assert.ok(e.profitPerFragment < naivePerFrag,
    "per-fragment profit must account for fragments burned on rerolls");
});

// ── keep-any: single roll, duds get salvaged ────────────────────────────────
console.log("\nkeep-any (rolling marginal — one roll, then sell or salvage):");

const KEEP_RAW = [50000, 80000, 150000, 100000, 250000, 70000, 60000, 400000, 120000, 90000];
const KEEP_POOL = KEEP_RAW.map(net);
const keepEcon = () =>
  rollCampaignEconomics(
    KEEP_POOL, rollCost(50, 120000), salvageVal(120000), 50, SALVAGE_FRAGS,
  );

test("keep-any never rerolls: expected rolls is exactly 1", () => {
  const e = keepEcon();
  assert.strictEqual(e.type, "keep-any");
  assert.strictEqual(e.expectedRolls, 1);
  assert.strictEqual(e.expectedFragments, 50);
});

test("keep-any profit = E[max(v, salvage)] − roll cost (duds are salvaged)", () => {
  const e = keepEcon();
  const s = salvageVal(120000);
  const c = rollCost(50, 120000);
  const expected =
    KEEP_POOL.reduce((a, v) => a + Math.max(v, s), 0) / KEEP_POOL.length - c;
  close(e.profitPerCampaign, expected, 1e-6, "profitPerCampaign");
});

test("keep-any profit is never worse than the naive E[v] − cost", () => {
  const e = keepEcon();
  const c = rollCost(50, 120000);
  const naive = KEEP_POOL.reduce((a, v) => a + v, 0) / KEEP_POOL.length - c;
  assert.ok(e.profitPerCampaign >= naive - 1e-9,
    "the salvage floor can only help");
});

test("expensive fragments make the campaign unprofitable (negative margin)", () => {
  const e = keepEcon();
  assert.ok(e.profitPerCampaign < 0 && e.marginPct < 0,
    "36-frag pool priced at 120k each cannot pay for itself");
});

// ── Monotonicity ────────────────────────────────────────────────────────────
console.log("\nMonotonicity:");

test("cheaper fragments never lower per-fragment profit", () => {
  let prev = -Infinity;
  for (const frag of [1200, 900, 600, 368, 200]) {
    const e = rollCampaignEconomics(
      HUNT_POOL, rollCost(36, frag), salvageVal(frag), 36, SALVAGE_FRAGS,
    );
    assert.ok(e.profitPerFragment >= prev,
      `frag ${frag}: ${e.profitPerFragment} < previous ${prev}`);
    prev = e.profitPerFragment;
  }
});

test("adding worthless artifacts to the pool lowers the campaign profit", () => {
  const rich = rollCampaignEconomics(
    HUNT_POOL, rollCost(36, HUNT_FRAG), salvageVal(HUNT_FRAG), 36, SALVAGE_FRAGS,
  );
  const diluted = rollCampaignEconomics(
    HUNT_POOL.concat(new Array(20).fill(0)),
    rollCost(36, HUNT_FRAG), salvageVal(HUNT_FRAG), 36, SALVAGE_FRAGS,
  );
  assert.ok(diluted.profitPerCampaign < rich.profitPerCampaign,
    "unsellable artifacts must dilute the expectation");
  assert.ok(diluted.profitPerFragment < rich.profitPerFragment,
    "each fragment is worth less when the pool is full of duds");
  // A worse pool LOWERS T* (rerolling buys you less), so the policy grows more
  // accepting — fewer rerolls, not more. Profit is what must fall, not n.
  assert.ok(diluted.Tstar < rich.Tstar, "a diluted pool lowers the threshold");
});

// ── Degenerate inputs ───────────────────────────────────────────────────────
console.log("\nDegenerate inputs:");

test("empty pool returns finite zeros", () => {
  const e = rollCampaignEconomics([], 10000, 500, 36, 10);
  for (const k of ["profitPerCampaign", "expectedRolls", "expectedCost",
    "expectedFragments", "marginPct", "profitPerFragment"]) {
    assert.ok(Number.isFinite(e[k]), `${k} must be finite, got ${e[k]}`);
  }
});

test("zero roll cost does not produce Infinity margin", () => {
  const e = rollCampaignEconomics([100, 200], 0, 0, 0, 0);
  assert.ok(Number.isFinite(e.marginPct) && Number.isFinite(e.profitPerFragment));
});

test("classifyRollGroup stays consistent with the economics type", () => {
  for (const [pool, frags, frag] of [
    [HUNT_POOL, 36, HUNT_FRAG], [KEEP_POOL, 50, 120000],
  ]) {
    const c = rollCost(frags, frag);
    const s = salvageVal(frag);
    const e = rollCampaignEconomics(pool, c, s, frags, SALVAGE_FRAGS);
    assert.strictEqual(e.type, classifyRollGroup(pool, c - s).type);
    close(e.Tstar, classifyRollGroup(pool, c - s).Tstar, 1e-6, "Tstar");
  }
});

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
