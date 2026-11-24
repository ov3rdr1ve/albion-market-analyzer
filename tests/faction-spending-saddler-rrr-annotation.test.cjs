/**
 * Test: Faction Spending breed-input sub-row surfaces saddler RRR (focus
 * efficiency) on each saddler material line.
 *
 * Bug: render-faction-spending.js:266-280 listed saddler mats as just
 * "${count}× ${name} ${price}" with no annotation that the mat is partly
 * refunded by the craft station — even though the silver/FP number above
 * already factored RRR into the math via bd.saddlerMatCost. The display
 * lied by omission, so the user couldn't tell focus efficiency was applied.
 *
 * Fix: mirror the convention in render-mounts.js:562-568 — append
 * `(~Xx consumed)` for RRR-eligible refined mats (leather/cloth/metalbar/
 * planks/stoneblock) and `(no return)` for hearts / artifacts / grown
 * mount inputs. The effective-count number reads bd.saddlerRrr, which is
 * captured from the focus-aware mounts row data, so toggling "Use Focus"
 * updates the annotation live on the next render.
 *
 * Black-box: mirror the building rules and assert the line text/effective
 * count, then verify the focus toggle moves the displayed number.
 *
 * Run: node tests/faction-spending-saddler-rrr-annotation.test.cjs
 */

const assert = require("assert");

// ── Mirror getCraftRRR + isRrrEligible (calculations.js + render-mounts.js) ──
const BASE_CITY_BONUS = 0.18;
const FOCUS_BONUS = 0.59;
function calcRRR(bonus) { return bonus <= 0 ? 0 : bonus / (1 + bonus); }
function getCraftRRR(city, craftType, useFocus = true) {
  let bonus = BASE_CITY_BONUS;
  if (useFocus) bonus += FOCUS_BONUS;
  return calcRRR(bonus);
}
const REFINED_MAT_RE = /^T[1-8]_(LEATHER|CLOTH|METALBAR|PLANKS|STONEBLOCK)(_LEVEL\d)?$/;
function isRrrEligible(matId) { return REFINED_MAT_RE.test(matId); }

// ── Mirror the saddler-mat line builder from render-faction-spending.js ──────
// Returns just the suffix tag (`(~Xx consumed)` or `(no return)`) plus the
// numeric effective-count it embeds. Pure function, no DOM.
function buildSaddlerMatTag(matId, count, saddlerRrr) {
  const eligible = isRrrEligible(matId);
  const effectiveCount = eligible
    ? (count * (1 - saddlerRrr)).toFixed(1)
    : count.toString();
  const consumedTag = eligible
    ? `(~${effectiveCount}x consumed)`
    : `(no return)`;
  return { eligible, effectiveCount, consumedTag };
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("\n=== Faction Spending — saddler RRR annotation ===");

const RRR_ON = getCraftRRR("Fort Sterling", null, true);   // ≈ 0.4351
const RRR_OFF = getCraftRRR("Fort Sterling", null, false); // ≈ 0.1525

test("leather is RRR-eligible and shows (~Xx consumed)", () => {
  const t = buildSaddlerMatTag("T8_LEATHER_LEVEL1", 20, RRR_ON);
  assert.strictEqual(t.eligible, true, "T8_LEATHER_LEVEL1 should be RRR-eligible");
  assert.ok(t.consumedTag.startsWith("(~") && t.consumedTag.endsWith("x consumed)"),
    `tag should be parenthesized consumed annotation, got: ${t.consumedTag}`);
});

test("plain leather (no LEVEL suffix) is RRR-eligible", () => {
  const t = buildSaddlerMatTag("T6_LEATHER", 4, RRR_ON);
  assert.strictEqual(t.eligible, true);
});

test("vineheart / faction tokens are NOT eligible — show (no return)", () => {
  const t = buildSaddlerMatTag("T1_FACTION_FOREST_TOKEN_1", 20, RRR_ON);
  assert.strictEqual(t.eligible, false, "hearts are consumed 1:1, no return");
  assert.strictEqual(t.consumedTag, "(no return)");
});

test("grown mount input is NOT eligible — show (no return)", () => {
  const t = buildSaddlerMatTag("T8_FARM_SWAMPDRAGON_FW_THETFORD", 1, RRR_ON);
  assert.strictEqual(t.eligible, false);
  assert.strictEqual(t.consumedTag, "(no return)");
});

test("non-eligible mat ignores saddlerRrr — effective count == raw count", () => {
  const a = buildSaddlerMatTag("T1_FACTION_FOREST_TOKEN_1", 20, RRR_ON);
  const b = buildSaddlerMatTag("T1_FACTION_FOREST_TOKEN_1", 20, RRR_OFF);
  assert.strictEqual(a.effectiveCount, "20");
  assert.strictEqual(b.effectiveCount, "20");
});

test("focus-on collapses leather consumption — 20 → ~11.3", () => {
  const t = buildSaddlerMatTag("T8_LEATHER_LEVEL1", 20, RRR_ON);
  const expected = (20 * (1 - RRR_ON)).toFixed(1);
  assert.strictEqual(t.effectiveCount, expected);
  assert.ok(parseFloat(t.effectiveCount) < 20,
    "focus-on RRR should reduce displayed consumption below the recipe count");
});

test("focus-off shrinks RRR — leather effective count grows toward raw 20", () => {
  const on = parseFloat(buildSaddlerMatTag("T8_LEATHER_LEVEL1", 20, RRR_ON).effectiveCount);
  const off = parseFloat(buildSaddlerMatTag("T8_LEATHER_LEVEL1", 20, RRR_OFF).effectiveCount);
  assert.ok(off > on,
    `focus-off effective count (${off}) must be greater than focus-on (${on})`);
  assert.ok(off <= 20, "effective count never exceeds the recipe count");
});

test("regression — fortified leather (T8 LEVEL1) matches the screenshot row", () => {
  // Screenshot: 20× T8 Fortified Leather; saddler at Fort Sterling, focus on.
  const t = buildSaddlerMatTag("T8_LEATHER_LEVEL1", 20, RRR_ON);
  assert.strictEqual(t.eligible, true);
  assert.ok(t.consumedTag.includes("x consumed"));
});

test("regression — bd.saddlerRrr=0 (recipe-less row) still renders sensibly", () => {
  // When the mounts row had no saddler recipe, saddlerRrr falls through to 0.
  // Eligible mats then show the raw count, not NaN, not Infinity.
  const t = buildSaddlerMatTag("T8_LEATHER_LEVEL1", 20, 0);
  assert.strictEqual(t.effectiveCount, "20.0");
  assert.strictEqual(t.consumedTag, "(~20.0x consumed)");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
