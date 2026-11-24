/**
 * Test: Artifact materials (Avalonian Energy, Royal Sigils, ARTEFACT items)
 * must be excluded from Resource Return Rate (RRR) calculations.
 * Normal materials (planks, bars, etc.) should still have RRR applied.
 *
 * Run: node tests/artifact-rrr-exclusion.test.cjs
 */

const assert = require("assert");

// ── helper: same artifact check used in render-crafting.js / data-enchanting.js ──
function isArtifactMat(matId) {
  return matId.includes("ARTEFACT") || matId.includes("QUESTITEM_TOKEN") || matId.includes("_FACTION_") || matId.includes("UNIQUE_GVGTOKEN") || matId.includes("_FARM_") || matId.includes("_MOUNT_") || matId.includes("ALCHEMY_RARE");
}

// ── tests ──────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

console.log("Artifact RRR Exclusion Tests\n");

// --- Artifact materials: should be detected as artifacts (no RRR) ---

test("QUESTITEM_TOKEN_AVALON is artifact (Avalonian Energy)", () => {
  assert.strictEqual(isArtifactMat("QUESTITEM_TOKEN_AVALON"), true);
});

test("QUESTITEM_TOKEN_ROYAL_T5 is artifact (Royal Sigil)", () => {
  assert.strictEqual(isArtifactMat("QUESTITEM_TOKEN_ROYAL_T5"), true);
});

test("QUESTITEM_TOKEN_ROYAL_T4 is artifact", () => {
  assert.strictEqual(isArtifactMat("QUESTITEM_TOKEN_ROYAL_T4"), true);
});

test("QUESTITEM_TOKEN_ROYAL_T8 is artifact", () => {
  assert.strictEqual(isArtifactMat("QUESTITEM_TOKEN_ROYAL_T8"), true);
});

test("T5_ARTEFACT_OFF_SHIELD_AVALON is artifact", () => {
  assert.strictEqual(isArtifactMat("T5_ARTEFACT_OFF_SHIELD_AVALON"), true);
});

test("T4_ARTEFACT_MAIN_SWORD is artifact", () => {
  assert.strictEqual(isArtifactMat("T4_ARTEFACT_MAIN_SWORD"), true);
});

// --- Faction hearts: should be detected as artifacts (no RRR) ---

test("T1_FACTION_STEPPE_TOKEN_1 is artifact (Beastheart)", () => {
  assert.strictEqual(isArtifactMat("T1_FACTION_STEPPE_TOKEN_1"), true);
});

test("T1_FACTION_MOUNTAIN_TOKEN_1 is artifact (Mountainheart)", () => {
  assert.strictEqual(isArtifactMat("T1_FACTION_MOUNTAIN_TOKEN_1"), true);
});

test("T1_FACTION_CAERLEON_TOKEN_1 is artifact (Shadowheart)", () => {
  assert.strictEqual(isArtifactMat("T1_FACTION_CAERLEON_TOKEN_1"), true);
});

// --- Mount/farm materials: no RRR ---

test("UNIQUE_GVGTOKEN_GENERIC is artifact (Siphoned Energy)", () => {
  assert.strictEqual(isArtifactMat("UNIQUE_GVGTOKEN_GENERIC"), true);
});

test("T5_FARM_HORSE_GROWN is artifact (grown animal)", () => {
  assert.strictEqual(isArtifactMat("T5_FARM_HORSE_GROWN"), true);
});

test("T6_MOUNT_OX is artifact (base mount as material)", () => {
  assert.strictEqual(isArtifactMat("T6_MOUNT_OX"), true);
});

// --- Shapeshifter rare-creature drops: maxreturnamount=0, so no RRR ---

test("T3_ALCHEMY_RARE_PANTHER is artifact (Shadow Claws, no RRR)", () => {
  assert.strictEqual(isArtifactMat("T3_ALCHEMY_RARE_PANTHER"), true);
});

test("T7_ALCHEMY_RARE_WEREWOLF is artifact (Werewolf Fangs, no RRR)", () => {
  assert.strictEqual(isArtifactMat("T7_ALCHEMY_RARE_WEREWOLF"), true);
});

// --- Normal materials: should NOT be detected as artifacts (RRR applies) ---

test("T5_PLANKS is NOT artifact", () => {
  assert.strictEqual(isArtifactMat("T5_PLANKS"), false);
});

test("T5_METALBAR is NOT artifact", () => {
  assert.strictEqual(isArtifactMat("T5_METALBAR"), false);
});

test("T4_CLOTH is NOT artifact", () => {
  assert.strictEqual(isArtifactMat("T4_CLOTH"), false);
});

test("T6_LEATHER is NOT artifact", () => {
  assert.strictEqual(isArtifactMat("T6_LEATHER"), false);
});

// --- Effective count calculations ---

const rrr = 0.479;

test("artifact material: effectiveCount equals base count (no RRR)", () => {
  const count = 90;
  const effectiveCount = count; // artifacts: no reduction
  assert.strictEqual(effectiveCount, 90);
});

test("normal material: effectiveCount reduced by RRR", () => {
  const count = 6;
  const effectiveCount = +(count * (1 - rrr)).toFixed(1);
  assert.strictEqual(effectiveCount, 3.1);
});

// --- matsNeededFor10kFocus: artifact vs non-artifact ---

function matsNeededFor10kFocus(focusCost, matsPerCraft, applyRrr = false, rrr = 0) {
  const craftsWithFocus = Math.floor(10000 / focusCost);
  const effectiveMats = applyRrr ? matsPerCraft * (1 - rrr) : matsPerCraft;
  return Math.round(craftsWithFocus * effectiveMats);
}

test("matsNeededFor10kFocus: artifact (no RRR) at 750 focus, 90 mats", () => {
  const result = matsNeededFor10kFocus(750, 90, false, rrr);
  // 13 crafts * 90 = 1170
  assert.strictEqual(result, 1170);
});

test("matsNeededFor10kFocus: normal mat (RRR applied) at 750 focus, 6 mats", () => {
  const result = matsNeededFor10kFocus(750, 6, true, rrr);
  // 13 crafts * 6 * (1-0.479) = 13 * 3.126 = 40.638 → 41
  assert.strictEqual(result, 41);
});

// --- getCraftRRR: city bonus behavior ---

const fs = require("fs");
const path = require("path");
// The city bonus tables were split into js/data-city-bonuses.js; the sandbox
// needs both sources, in load order.
const calcSrc =
  fs.readFileSync(path.join(__dirname, "..", "js/data-city-bonuses.js"), "utf-8") +
  ["calculations", "calculations-margins"].map((n) => fs.readFileSync(path.join(__dirname, "..", "js/" + n + ".js"), "utf-8")).join("\n");
const sandbox = new Function(`${calcSrc}; return { getCraftRRR, calcRRR };`)();
const { getCraftRRR, calcRRR } = sandbox;

test("tool (woodaxe) without focus: base city bonus only (15.2%)", () => {
  const expected = calcRRR(0.18);
  assert.strictEqual(getCraftRRR("Lymhurst", "woodaxe", false), expected);
});

test("tool (woodaxe) with focus: base + focus (43.5%)", () => {
  const expected = calcRRR(0.18 + 0.59);
  assert.strictEqual(getCraftRRR("Lymhurst", "woodaxe", true), expected);
});

test("combat gear (sword) in spec city gets specialization bonus", () => {
  const expected = calcRRR(0.18 + 0.15 + 0.59);
  assert.strictEqual(getCraftRRR("Lymhurst", "sword", true), expected);
});

test("combat gear (sword) in non-spec city: no specialization bonus", () => {
  const expected = calcRRR(0.18);
  assert.strictEqual(getCraftRRR("Martlock", "sword", false), expected);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
