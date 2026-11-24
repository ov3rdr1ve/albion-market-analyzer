/**
 * Test: Faction Spending FP-cost lookup and silver-per-FP calculation.
 *
 * Covers:
 *  - FACTION_FP_COSTS map has all hearts (3000), crests (400/2250/3000/7500/15000),
 *    babies (T5: 3000, T8: 50000 — in-game verified), iron chests (9000).
 *  - calculateSilverPerFp returns silver-yield divided by FP-cost.
 *  - Tax/setup-fee adjustment matches PREMIUM_TAX (6.5%) + SETUP_FEE (2.5%).
 *
 * Run: node tests/faction-spending.test.cjs
 */

const path = require("path");
const assert = require("assert");

const fp = require(path.join(__dirname, "..", "js", "data-faction-fp-costs.js"));
const {
  FACTION_FP_COSTS,
  getFpCost,
  netSilverAfterFees,
  calculateSilverPerFp,
} = fp;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Faction Spending FP-cost & silver/FP tests\n");

// --- Heart fragments ---
const heartIds = [
  "T1_FACTION_SWAMP_TOKEN_1",
  "T1_FACTION_FOREST_TOKEN_1",
  "T1_FACTION_MOUNTAIN_TOKEN_1",
  "T1_FACTION_HIGHLAND_TOKEN_1",
  "T1_FACTION_STEPPE_TOKEN_1",
  "T1_FACTION_CAERLEON_TOKEN_1",
];
heartIds.forEach((id) => {
  test(`heart ${id} costs 3000 FP`, () => {
    assert.strictEqual(FACTION_FP_COSTS[id], 3000);
  });
});

// --- Crests (5 tiers × 5 royal cities) ---
const crestCases = [
  ["T4_CAPEITEM_FW_THETFORD_BP", 400],
  ["T5_CAPEITEM_FW_THETFORD_BP", 2250],
  ["T6_CAPEITEM_FW_THETFORD_BP", 3000],
  ["T7_CAPEITEM_FW_THETFORD_BP", 7500],
  ["T8_CAPEITEM_FW_THETFORD_BP", 15000],
  ["T4_CAPEITEM_FW_LYMHURST_BP", 400],
  ["T8_CAPEITEM_FW_LYMHURST_BP", 15000],
  ["T4_CAPEITEM_FW_BRIDGEWATCH_BP", 400],
  ["T4_CAPEITEM_FW_FORTSTERLING_BP", 400],
  ["T4_CAPEITEM_FW_MARTLOCK_BP", 400],
];
crestCases.forEach(([id, expected]) => {
  test(`crest ${id} costs ${expected} FP`, () => {
    assert.strictEqual(FACTION_FP_COSTS[id], expected);
  });
});

// --- Brecilien is a FAVOR vendor (Eralia Wayfarer), NOT FP ---
// Its crests + Mystic Owl babies must NOT appear in the FP cost map; they're
// modelled in the Favor section (js/data-favor-costs.js). Regression guard
// against re-adding them under the (incorrect) royal FP ladder.
[4, 5, 6, 7, 8].forEach((t) => {
  test(`Brecilien crest T${t} is NOT FP-priced (it's a Favor purchase)`, () => {
    assert.strictEqual(getFpCost(`T${t}_CAPEITEM_FW_BRECILIEN_BP`), 0);
    assert.ok(!(`T${t}_CAPEITEM_FW_BRECILIEN_BP` in FACTION_FP_COSTS));
  });
});

// --- Babies ---
const babyCases = [
  ["T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY", 3000],
  ["T5_FARM_DIREBEAR_FW_FORTSTERLING_BABY", 3000],
  ["T5_FARM_DIREBOAR_FW_LYMHURST_BABY", 3000],
  ["T5_FARM_RAM_FW_MARTLOCK_BABY", 3000],
  ["T5_FARM_MOABIRD_FW_BRIDGEWATCH_BABY", 3000],
  ["T5_FARM_GREYWOLF_FW_CAERLEON_BABY", 3000],
  ["T8_FARM_SWAMPDRAGON_FW_THETFORD_BABY", 50000],
  ["T8_FARM_DIREBEAR_FW_FORTSTERLING_BABY", 50000],
  ["T8_FARM_DIREBOAR_FW_LYMHURST_BABY", 50000],
  ["T8_FARM_RAM_FW_MARTLOCK_BABY", 50000],
  ["T8_FARM_MOABIRD_FW_BRIDGEWATCH_BABY", 50000],
  ["T8_FARM_GREYWOLF_FW_CAERLEON_BABY", 50000],
];
babyCases.forEach(([id, expected]) => {
  test(`baby ${id} costs ${expected} FP`, () => {
    assert.strictEqual(FACTION_FP_COSTS[id], expected);
  });
});

// --- Mystic Owl babies are a FAVOR purchase, NOT FP ---
["T5_FARM_OWL_FW_BRECILIEN_BABY", "T8_FARM_OWL_FW_BRECILIEN_BABY"].forEach((id) => {
  test(`owl baby ${id} is NOT FP-priced (it's a Favor purchase)`, () => {
    assert.strictEqual(getFpCost(id), 0);
    assert.ok(!(id in FACTION_FP_COSTS));
  });
});

// --- Iron chests ---
const chestCases = [
  ["UNIQUE_LOOTCHEST_FACTIONCAMPAIGN_REWARD_SWAMP_01", 9000],
  ["UNIQUE_LOOTCHEST_FACTIONCAMPAIGN_REWARD_FOREST_01", 9000],
  ["UNIQUE_LOOTCHEST_FACTIONCAMPAIGN_REWARD_MOUNTAIN_01", 9000],
  ["UNIQUE_LOOTCHEST_FACTIONCAMPAIGN_REWARD_HIGHLAND_01", 9000],
  ["UNIQUE_LOOTCHEST_FACTIONCAMPAIGN_REWARD_STEPPE_01", 9000],
  ["UNIQUE_LOOTCHEST_FACTIONCAMPAIGN_REWARD_CAERLEON_01", 9000],
];
chestCases.forEach(([id, expected]) => {
  test(`iron chest ${id} costs ${expected} FP`, () => {
    assert.strictEqual(FACTION_FP_COSTS[id], expected);
  });
});

// --- getFpCost ---
test("getFpCost returns 0 for unknown id", () => {
  assert.strictEqual(getFpCost("T4_PLANKS"), 0);
});
test("getFpCost returns 3000 for Vineheart", () => {
  assert.strictEqual(getFpCost("T1_FACTION_SWAMP_TOKEN_1"), 3000);
});
test("getFpCost returns 0 for null/undefined/empty", () => {
  assert.strictEqual(getFpCost(null), 0);
  assert.strictEqual(getFpCost(undefined), 0);
  assert.strictEqual(getFpCost(""), 0);
});

// --- netSilverAfterFees ---
// The premium rate used to be written as 6.5% — which already folds the 2.5%
// setup fee in — and then had the setup fee subtracted a second time. The tax
// alone is 4%; the setup fee is added once, and only when the sale is a market
// ORDER (js/calculations.js marketSetupFee).
test("netSilverAfterFees applies 4% premium tax + 2.5% setup fee", () => {
  // 100,000 * (1 - 0.04 - 0.025) = 93,500
  assert.strictEqual(netSilverAfterFees(100000, true), 93500);
});
test("netSilverAfterFees applies 8% non-premium tax + 2.5% setup fee", () => {
  // 100,000 * (1 - 0.08 - 0.025) = 89,500
  assert.strictEqual(netSilverAfterFees(100000, false), 89500);
});
test("netSilverAfterFees handles zero", () => {
  assert.strictEqual(netSilverAfterFees(0, true), 0);
});
test("netSilverAfterFees handles negative as zero", () => {
  assert.strictEqual(netSilverAfterFees(-100, true), 0);
});

// --- calculateSilverPerFp ---
test("calculateSilverPerFp returns 0 when fpCost is 0", () => {
  assert.strictEqual(calculateSilverPerFp(10000, 0), 0);
});
test("calculateSilverPerFp returns 0 when fpCost is negative", () => {
  assert.strictEqual(calculateSilverPerFp(10000, -1), 0);
});
test("calculateSilverPerFp returns silver/fp", () => {
  assert.strictEqual(calculateSilverPerFp(45000, 3000), 15);
});
test("calculateSilverPerFp Vineheart at 30K silver / 3000 FP = 10", () => {
  assert.strictEqual(calculateSilverPerFp(30000, 3000), 10);
});
test("calculateSilverPerFp T8 Elder Crest 260K silver / 15000 FP", () => {
  assert.ok(Math.abs(calculateSilverPerFp(260000, 15000) - 17.333) < 0.01);
});
test("calculateSilverPerFp T4 Adept Crest 14997 silver / 400 FP", () => {
  assert.ok(Math.abs(calculateSilverPerFp(14997, 400) - 37.4925) < 0.01);
});

// --- Composite: T5 saddled mount FP cost ---
test("T5 saddled swamp salamander total FP cost = 18000 (1 baby + 5 vineheart)", () => {
  const babyFp = getFpCost("T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY");
  const heartFp = getFpCost("T1_FACTION_SWAMP_TOKEN_1");
  assert.strictEqual(babyFp + 5 * heartFp, 18000);
});
test("T8 saddled elite swamp salamander total FP cost = 110000 (1 baby @ 50K + 20 vineheart @ 3K)", () => {
  const babyFp = getFpCost("T8_FARM_SWAMPDRAGON_FW_THETFORD_BABY");
  const heartFp = getFpCost("T1_FACTION_SWAMP_TOKEN_1");
  assert.strictEqual(babyFp + 20 * heartFp, 110000);
});

// --- Composite: salamander silver/FP at user's empirical scenario ---
test("T5 salamander 16.55M silver / 1.152M FP ≈ 14.36 silver/FP", () => {
  const ratio = calculateSilverPerFp(16550000, 1152000);
  assert.ok(Math.abs(ratio - 14.36) < 0.01, `Got ${ratio}`);
});
test("Iron chest at user's 73.8K avg / 9000 FP ≈ 8.20 silver/FP", () => {
  const ratio = calculateSilverPerFp(73800, 9000);
  assert.ok(Math.abs(ratio - 8.2) < 0.01, `Got ${ratio}`);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
