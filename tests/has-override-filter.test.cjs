/**
 * Test: Rows with hasOverride survive the profitability filter.
 *
 * The filter in sorting.js updateTableDisplay preserves rows where
 * hasOverride is truthy, even when margin is negative.
 *
 * Run: node tests/has-override-filter.test.cjs
 */

const assert = require("assert");

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

// Replicate the filter from sorting.js:303-313
function applyFilter(rows, showAll, tableId) {
  return showAll
    ? rows
    : rows.filter(
        (row) =>
          tableId === "volume-table" ||
          row.hasOverride ||
          row.hasNoFragData ||
          row.hasNoArtData ||
          (row.marginInfo && row.marginInfo.margin >= 0),
      );
}

console.log("hasOverride Filter Tests\n");

// ── showAll = true passes everything ──

test("showAll=true passes all rows regardless of override or margin", () => {
  const rows = [
    { marginInfo: { margin: -50 }, hasOverride: false },
    { marginInfo: { margin: 10 }, hasOverride: false },
    { marginInfo: { margin: -5 }, hasOverride: true },
  ];
  const result = applyFilter(rows, true, "crafting-table");
  assert.strictEqual(result.length, 3);
});

// ── showAll = false: hasOverride keeps negative-margin rows ──

test("negative margin row WITH hasOverride is preserved", () => {
  const rows = [
    { marginInfo: { margin: -20 }, hasOverride: true },
  ];
  const result = applyFilter(rows, false, "crafting-table");
  assert.strictEqual(result.length, 1);
});

test("negative margin row WITHOUT hasOverride is filtered out", () => {
  const rows = [
    { marginInfo: { margin: -20 }, hasOverride: false },
  ];
  const result = applyFilter(rows, false, "crafting-table");
  assert.strictEqual(result.length, 0);
});

test("negative margin row with undefined hasOverride is filtered out", () => {
  const rows = [
    { marginInfo: { margin: -20 } },
  ];
  const result = applyFilter(rows, false, "crafting-table");
  assert.strictEqual(result.length, 0);
});

test("positive margin row without hasOverride is preserved", () => {
  const rows = [
    { marginInfo: { margin: 5 }, hasOverride: false },
  ];
  const result = applyFilter(rows, false, "crafting-table");
  assert.strictEqual(result.length, 1);
});

// ── Mixed rows ──

test("mixed rows: only profitable + overridden survive filter", () => {
  const rows = [
    { marginInfo: { margin: 15 }, hasOverride: false },   // keep (profitable)
    { marginInfo: { margin: -10 }, hasOverride: true },    // keep (override)
    { marginInfo: { margin: -30 }, hasOverride: false },   // drop
    { marginInfo: { margin: -5 } },                        // drop (no hasOverride)
    { marginInfo: { margin: 0 }, hasOverride: false },     // keep (margin >= 0)
  ];
  const result = applyFilter(rows, false, "crafting-table");
  assert.strictEqual(result.length, 3);
  assert.ok(result[0].marginInfo.margin === 15);
  assert.ok(result[1].hasOverride === true);
  assert.ok(result[2].marginInfo.margin === 0);
});

// ── volume-table bypasses filter ──

test("volume-table always passes all rows", () => {
  const rows = [
    { marginInfo: { margin: -50 }, hasOverride: false },
    { marginInfo: { margin: -999 } },
  ];
  const result = applyFilter(rows, false, "volume-table");
  assert.strictEqual(result.length, 2);
});

// ── hasNoFragData / hasNoArtData also bypass ──

test("hasNoFragData row is preserved even with negative margin", () => {
  const rows = [
    { marginInfo: { margin: -1 }, hasNoFragData: true },
  ];
  const result = applyFilter(rows, false, "rolling-table");
  assert.strictEqual(result.length, 1);
});

test("hasNoArtData row is preserved even with negative margin", () => {
  const rows = [
    { marginInfo: { margin: -1 }, hasNoArtData: true },
  ];
  const result = applyFilter(rows, false, "rolling-table");
  assert.strictEqual(result.length, 1);
});

// ── Placeholder rows (margin -1 or -999) ──

test("placeholder row with margin -1 and no flags is filtered out", () => {
  const rows = [
    { marginInfo: { margin: -1 } },
  ];
  const result = applyFilter(rows, false, "crafting-table");
  assert.strictEqual(result.length, 0);
});

test("placeholder row with margin -1 but hasOverride is preserved", () => {
  const rows = [
    { marginInfo: { margin: -1 }, hasOverride: true },
  ];
  const result = applyFilter(rows, false, "crafting-table");
  assert.strictEqual(result.length, 1);
});

// ── Per-table hasOverride computation (simulated) ──

const _overrides = {};
function getOverridePrice(itemId, city) {
  return _overrides[`${itemId}:${city}`] ?? null;
}

test("crafting hasOverride: detects material override", () => {
  _overrides["T5_PLANKS:Lymhurst"] = 1500;
  const materials = [{ matId: "T5_PLANKS", count: 6 }];
  const matBestPrices = { T5_PLANKS: { price: 1500, city: "Lymhurst" } };
  const hasOverride =
    materials.some(m => getOverridePrice(m.matId, matBestPrices[m.matId]?.city) !== null) ||
    getOverridePrice("T5_SWORD", "Bridgewatch") !== null;
  assert.strictEqual(hasOverride, true);
  delete _overrides["T5_PLANKS:Lymhurst"];
});

test("crafting hasOverride: detects sell item override", () => {
  _overrides["T5_SWORD:Bridgewatch"] = 50000;
  const materials = [{ matId: "T5_PLANKS", count: 6 }];
  const matBestPrices = { T5_PLANKS: { price: 1500, city: "Lymhurst" } };
  const hasOverride =
    materials.some(m => getOverridePrice(m.matId, matBestPrices[m.matId]?.city) !== null) ||
    getOverridePrice("T5_SWORD", "Bridgewatch") !== null;
  assert.strictEqual(hasOverride, true);
  delete _overrides["T5_SWORD:Bridgewatch"];
});

test("crafting hasOverride: false when no overrides", () => {
  const materials = [{ matId: "T5_PLANKS", count: 6 }];
  const matBestPrices = { T5_PLANKS: { price: 1500, city: "Lymhurst" } };
  const hasOverride =
    materials.some(m => getOverridePrice(m.matId, matBestPrices[m.matId]?.city) !== null) ||
    getOverridePrice("T5_SWORD", "Bridgewatch") !== null;
  assert.strictEqual(hasOverride, false);
});

test("farming hasOverride: detects seed override", () => {
  _overrides["T5_SEED:Martlock"] = 200;
  const hasOverride = !!(
    getOverridePrice("T5_SEED", "Martlock") ||
    getOverridePrice("T5_CROP", "Lymhurst")
  );
  assert.strictEqual(hasOverride, true);
  delete _overrides["T5_SEED:Martlock"];
});

test("transport hasOverride: detects refined sell override", () => {
  _overrides["T5_METALBAR:Caerleon"] = 5000;
  const hasOverride =
    getOverridePrice("T5_ORE", "Lymhurst") !== null ||
    getOverridePrice("T5_METALBAR", "Caerleon") !== null;
  assert.strictEqual(hasOverride, true);
  delete _overrides["T5_METALBAR:Caerleon"];
});

test("rerolling hasOverride: detects buy city override", () => {
  _overrides["T6_HEAD_CLOTH_SET1:Bridgewatch"] = 30000;
  const hasOverride = !!(
    getOverridePrice("T6_HEAD_CLOTH_SET1", "Bridgewatch") ||
    getOverridePrice("T6_HEAD_CLOTH_SET1", "Caerleon")
  );
  assert.strictEqual(hasOverride, true);
  delete _overrides["T6_HEAD_CLOTH_SET1:Bridgewatch"];
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
