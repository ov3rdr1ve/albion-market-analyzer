/**
 * Test: breeding nurture focus cost tracks the ⚙ Specs panel, and the row
 * never labels a mid-spec figure "(max spec)".
 *
 * The Destiny Board charges 1000 x 0.5^(FCE/10000) per nurture, FCE from
 * FARM_ANIMALS (Animal Breeder, +100/level) plus ONE specialist node
 * (+200/level: Horse Breeder, Rare Animals, …). The panel defaults are
 * mastery 100 / specialist 0 → 10,000 FCE → 500 focus, which the row used to
 * print as "500 focus (max spec)" — max spec is 125, and a player with 100
 * Breeder / 64 Rare Animals pays 206 in game (verified in-game 2026-09-10):
 *
 *   1000 x 0.5^((100x100 + 2x100x64) / 10000) = 1000 x 0.5^2.28 = 205.9 → 206
 *
 * Black box over the shipped modules — no DOM, no market data, no live calls.
 *
 * Run: node tests/breeding-nurture-focus-spec.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
// Working tree is CRLF on Windows (core.autocrlf); source regexes are LF.
const read = (rel) =>
  fs.readFileSync(path.join(ROOT, rel), "utf-8").split("\r\n").join("\n");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// Stitch the browser's shared script scope: spec tables + focus-spec runtime +
// breeding data + the getBreedingMeta/getNurtureFocusCost helpers.
function loadBreedingFocus(store = {}) {
  const localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i] ?? null,
  };
  const renderMountsSrc = read("js/render-mounts.js");
  const helperSource = renderMountsSrc.slice(
    0,
    renderMountsSrc.indexOf("function renderMountsTable")
  );
  return new Function(
    "localStorage",
    `${read("js/focus-spec-nodes.js")}
     ${read("js/focus-spec-items.js")}
     ${read("js/focus-spec.js")}
     ${read("js/data-mounts.js")}
     ${helperSource}
     return { getBreedingMeta, getNurtureFocusCost, specNodesForItem,
              setSpecLevel, withSpecScope, focusSpecMultiplier };`
  )(localStorage);
}

const SCOPE = "mounts-table";
const RARE_BABY = "T8_FARM_DIREBEAR_BABY";   // family: FARM_ANIMALS + FARM_ANIMALS_RARE
const COMMON_BABY = "T3_FARM_HORSE_BABY";    // family: FARM_ANIMALS + FARM_ANIMALS_HORSE

console.log("Breeding Nurture Focus Spec Tests\n");

// ── The number the table prints, against real spec shapes ──────────────────

test("rare babies pair Animal Breeder with the Rare Animals node", () => {
  const a = loadBreedingFocus();
  assert.deepStrictEqual(
    a.specNodesForItem(RARE_BABY),
    [["FARM_ANIMALS", 1], ["FARM_ANIMALS_RARE", 2]],
  );
});

[
  // [name, setup(fn), baby, expectedFocus, why]
  ["defaults (Breeder 100, specialist 0) = 500", (a) => {}, RARE_BABY, 500,
    "10,000 FCE from the mastery alone"],
  ["Breeder 100 + Rare Animals 64 = 206", (a) => a.setSpecLevel(SCOPE, "FARM_ANIMALS_RARE", 64), RARE_BABY, 206,
    "the player's in-game cost: 1000 x 0.5^2.28 = 205.9"],
  ["Rare Animals 64 leaves the horse row at its own level", (a) => a.setSpecLevel(SCOPE, "FARM_ANIMALS_RARE", 64), COMMON_BABY, 500,
    "specialists are per-animal; the horse node is still 0"],
  ["all breeding nodes 100 = 125", (a) => {
    a.setSpecLevel(SCOPE, "FARM_ANIMALS_RARE", 100);
    a.setSpecLevel(SCOPE, "FARM_ANIMALS_HORSE", 100);
  }, RARE_BABY, 125, "30,000 FCE — the game's floor"],
  ["Breeder 0 = 1000 (unspecced)", (a) => a.setSpecLevel(SCOPE, "FARM_ANIMALS", 0), RARE_BABY, 1000,
    "0 FCE → the raw activefarmfocuscost base"],
].forEach(([name, setup, baby, focus, why]) => {
  test(`${baby} — ${name}`, () => {
    const a = loadBreedingFocus();
    setup(a);
    assert.strictEqual(a.withSpecScope(SCOPE, () => a.getNurtureFocusCost(baby)), focus);
  });
});

// ── The row must not claim "(max spec)" for a mid-spec figure ───────────────

test("getBreedingMeta exposes the max-spec floor next to the spec-priced figure", () => {
  const a = loadBreedingFocus();
  a.withSpecScope(SCOPE, () => {
    const m = a.getBreedingMeta({ babyId: RARE_BABY });
    assert.strictEqual(m.focusPerNurtureMaxSpec, 125, "max-spec floor field");
    assert.strictEqual(m.focusPerNurture, 500, "default scope prices 500");
  });
  a.setSpecLevel(SCOPE, "FARM_ANIMALS_RARE", 100);
  a.withSpecScope(SCOPE, () => {
    const m = a.getBreedingMeta({ babyId: RARE_BABY });
    assert.strictEqual(m.focusPerNurture, 125);
    assert.strictEqual(m.focusPerNurtureMaxSpec, 125);
  });
});

const rowSrc = read("js/render-mounts-breeding-row.js");

test("nurture line qualifies the focus figure: max spec only at 125", () => {
  assert.ok(
    /focusPerNurtureMaxSpec/.test(rowSrc),
    "the row must compare against meta.focusPerNurtureMaxSpec before printing the qualifier",
  );
  assert.ok(
    /r_focus_your_spec/.test(rowSrc),
    "a mid-spec figure needs its own r_focus_your_spec qualifier string",
  );
  assert.ok(
    /focus \(your spec\)/.test(rowSrc),
    "the EN fallback for r_focus_your_spec should read \"focus (your spec)\"",
  );
});

test("nurture tooltip no longer claims every figure is max spec", () => {
  assert.ok(
    !/at max \(100\/100\) spec/.test(rowSrc),
    "the r_nurture_focus_tip copy must describe the ⚙ panel figure, not assume max",
  );
  assert.ok(
    / Specs levels| spec levels|your spec/.test(rowSrc),
    "the tooltip should point at the ⚙ Specs panel levels",
  );
});

const esRows = read("js/i18n-strings-es-rows.js");

test("ES row strings cover the new qualifier and reworded tooltip", () => {
  assert.ok(/r_focus_your_spec:/.test(esRows), "missing ES r_focus_your_spec");
  assert.ok(
    !/especialización máxima \(100\/100\) — 1\.000 antes de maestría/.test(esRows),
    "r_nurture_focus_tip ES still claims max-spec pricing",
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
