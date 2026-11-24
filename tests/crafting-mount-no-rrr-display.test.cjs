/**
 * Test: mount inputs (e.g. Saddled Swamp Dragon for Avalonian Basilisk) must
 * render as fully consumed in the Crafting table, not reduced by RRR.
 *
 * Bug: render-crafting.js had three truncated isArtifact checks that only
 * matched ARTEFACT / QUESTITEM_TOKEN / _FACTION_ — so _MOUNT_, _FARM_, and
 * UNIQUE_GVGTOKEN inputs were treated as returnable. The display showed
 * "(~0.6x consumed)" for a Saddled Swamp Dragon even though crafting one
 * Avalonian Basilisk fully consumes the dragon. The three predicates have since
 * been collapsed into the single `isNonReturnableCraftMat` helper, so they can
 * no longer drift apart.
 *
 * This file:
 *   1. Source-level regression: the single `isNonReturnableCraftMat` helper must
 *      list the full set of exclusions, and the route-path call sites must
 *      delegate to it (no re-implemented inline copies that could go stale).
 *   2. Formula-level black-box: mirrors the renderer's per-material logic and
 *      asserts that mount/farm/gvg/cape inputs resolve to m.count (no RRR), while
 *      ordinary inputs (planks, cloth, bars) get reduced by RRR.
 *
 * Run: node tests/crafting-mount-no-rrr-display.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// 1. Source-level: every isArtifact predicate is complete
const src = fs.readFileSync(
  path.join(__dirname, "..", "js", "render-crafting.js"),
  "utf-8",
);

const REQUIRED_TOKENS = [
  "ARTEFACT",
  "QUESTITEM_TOKEN",
  "_FACTION_",
  "UNIQUE_GVGTOKEN",
  "_FARM_",
  "_MOUNT_",
  "ALCHEMY_RARE",
];

console.log("\n=== render-crafting.js isNonReturnableCraftMat helper ===");

// The canonical predicate body (the function declaration).
const helperMatch = src.match(/function\s+isNonReturnableCraftMat\s*\(matId\)\s*\{([\s\S]*?)\n\}/);

test("isNonReturnableCraftMat helper exists", () => {
  assert.ok(helperMatch, "expected a single isNonReturnableCraftMat helper in js/render-crafting.js");
});

REQUIRED_TOKENS.forEach((token) => {
  test(`isNonReturnableCraftMat includes ${token}`, () => {
    assert.ok(helperMatch && helperMatch[1].includes(token),
      `helper missing "${token}" — it must guard mount/farm/gvg/cape inputs from RRR.`);
  });
});

// Route-path call sites must DELEGATE to the helper, not re-implement it inline
// (the old bug was three divergent inline copies). Every `const isArtifact = ...`
// must resolve via isNonReturnableCraftMat.
const isArtifactAssigns = [...src.matchAll(/const\s+isArtifact\s*=\s*([\s\S]*?);/g)];
test("every isArtifact assignment delegates to isNonReturnableCraftMat", () => {
  assert.ok(isArtifactAssigns.length >= 2, "expected the route-path isArtifact call sites");
  const inline = isArtifactAssigns
    .map((m, i) => ({ body: m[1], line: src.slice(0, m.index).split("\n").length, i }))
    .filter((p) => !p.body.includes("isNonReturnableCraftMat"));
  if (inline.length) {
    assert.fail(`re-implemented isArtifact predicate at line(s) ${inline.map(p=>p.line).join(", ")} — call isNonReturnableCraftMat instead.`);
  }
});

// 2. Formula-level black-box
function isArtifactMat(matId) {
  return (
    matId.includes("ARTEFACT") ||
    matId.includes("QUESTITEM_TOKEN") ||
    matId.includes("_FACTION_") ||
    matId.includes("UNIQUE_GVGTOKEN") ||
    matId.includes("_FARM_") ||
    matId.includes("_MOUNT_") ||
    matId.includes("ALCHEMY_RARE") ||
    matId.includes("_CAPEITEM_") ||
    /^T\d+_CAPE(@\d+)?$/.test(matId) ||
    /^T\d+_(HEAD|ARMOR|SHOES)_(CLOTH|LEATHER|PLATE)_SET[123](@\d+)?$/.test(matId)
  );
}

// Mirror the renderer's effectiveCount for the "(~Xx consumed)" display tag.
function consumedDisplay(matId, count, rrr) {
  return isArtifactMat(matId) ? count : +(count * (1 - rrr)).toFixed(1);
}

console.log("\n=== Mount/farm inputs render as fully consumed ===");

// Avalonian Basilisk recipe (T7_MOUNT_SWAMPDRAGON_AVALON_BASILISK):
//   1x T7_MOUNT_SWAMPDRAGON + 5000x QUESTITEM_TOKEN_AVALON
const RRR_FOCUS = 0.479; // typical battlemount craft RRR with focus

test("Saddled Swamp Dragon: 1x consumed (not reduced by RRR)", () => {
  const got = consumedDisplay("T7_MOUNT_SWAMPDRAGON", 1, RRR_FOCUS);
  assert.strictEqual(got, 1, `expected 1x consumed, got ${got}x`);
});

test("Avalonian Energy: 5000x consumed (artifact, not reduced)", () => {
  const got = consumedDisplay("QUESTITEM_TOKEN_AVALON", 5000, RRR_FOCUS);
  assert.strictEqual(got, 5000, `expected 5000x consumed, got ${got}x`);
});

test("Grown farm animal (T5_FARM_HORSE_GROWN): 1x consumed (no RRR)", () => {
  const got = consumedDisplay("T5_FARM_HORSE_GROWN", 1, RRR_FOCUS);
  assert.strictEqual(got, 1);
});

test("Siphoned Energy (UNIQUE_GVGTOKEN_GENERIC): no RRR", () => {
  const got = consumedDisplay("UNIQUE_GVGTOKEN_GENERIC", 200, RRR_FOCUS);
  assert.strictEqual(got, 200);
});

test("Faction heart (T1_FACTION_STEPPE_TOKEN_1): no RRR", () => {
  const got = consumedDisplay("T1_FACTION_STEPPE_TOKEN_1", 50, RRR_FOCUS);
  assert.strictEqual(got, 50);
});

test("Shapeshifter creature drop (T3_ALCHEMY_RARE_PANTHER): 2x consumed (maxreturnamount=0)", () => {
  const got = consumedDisplay("T3_ALCHEMY_RARE_PANTHER", 2, RRR_FOCUS);
  assert.strictEqual(got, 2, `expected 2x consumed, got ${got}x`);
});

// Cape combine: base cape + cape artifact (both maxreturnamount=0) → fully
// consumed, no phantom RRR discount on the dominant base-cape cost.
test("Base cape in a combine (T4_CAPE): 1x consumed (no RRR)", () => {
  assert.strictEqual(consumedDisplay("T4_CAPE", 1, RRR_FOCUS), 1);
});

test("Cape artifact (T4_CAPEITEM_AVALON_BP): 1x consumed (no RRR)", () => {
  assert.strictEqual(consumedDisplay("T4_CAPEITEM_AVALON_BP", 1, RRR_FOCUS), 1);
});

test("Enchanted base cape (T6_CAPE@2): 1x consumed (no RRR)", () => {
  assert.strictEqual(consumedDisplay("T6_CAPE@2", 1, RRR_FOCUS), 1);
});

// Royal armor combine: base SETn armor (maxreturnamount=0) + Royal tokens →
// the base armor is fully consumed, no phantom RRR on the dominant cost.
test("Base SET1 armor in a royal combine (T8_ARMOR_CLOTH_SET1): 1x consumed", () => {
  assert.strictEqual(consumedDisplay("T8_ARMOR_CLOTH_SET1", 1, RRR_FOCUS), 1);
});

test("Royal Sigil (QUESTITEM_TOKEN_ROYAL_T4): fully consumed", () => {
  assert.strictEqual(consumedDisplay("QUESTITEM_TOKEN_ROYAL_T4", 2, RRR_FOCUS), 2);
});

// Raw resources are still returnable — guard against over-broad matching.
test("Raw cloth (T8_CLOTH) still gets RRR (not caught by SET/cape patterns)", () => {
  assert.notStrictEqual(consumedDisplay("T8_CLOTH", 8, RRR_FOCUS), 8);
});

console.log("\n=== Ordinary materials still get RRR reduction ===");

test("T5_PLANKS at rrr=0.479: ~3.1x consumed for count=6", () => {
  const got = consumedDisplay("T5_PLANKS", 6, 0.479);
  assert.strictEqual(got, 3.1);
});

test("T6_LEATHER at rrr=0.479: ~5.2x consumed for count=10", () => {
  const got = consumedDisplay("T6_LEATHER", 10, 0.479);
  assert.strictEqual(got, 5.2);
});

test("T4_CLOTH at rrr=0.0: full count consumed (no focus, no spec)", () => {
  const got = consumedDisplay("T4_CLOTH", 8, 0);
  assert.strictEqual(got, 8);
});

// Regression guard: pre-fix predicate (missing _MOUNT_) would have produced
// the wrong output. Make sure the truncated check would have failed this fixture.
test("regression: truncated predicate would mis-handle the dragon", () => {
  function buggyIsArtifact(id) {
    return (
      id.includes("ARTEFACT") ||
      id.includes("QUESTITEM_TOKEN") ||
      id.includes("_FACTION_")
    );
  }
  const buggy = buggyIsArtifact("T7_MOUNT_SWAMPDRAGON")
    ? 1
    : +(1 * (1 - RRR_FOCUS)).toFixed(1);
  assert.notStrictEqual(buggy, 1, "the truncated predicate would have produced the buggy ~0.5x value");
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
