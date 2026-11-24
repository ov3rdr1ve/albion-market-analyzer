/**
 * Test: "Scan Market Now" runScan must fetch data for every source table that
 * the joined summary reads from.
 *
 * Today the main scan only fetches IDs from getAllRequiredItemIds() + recipes
 * for Crafting/Consumables. Enchanting, Transmute, Rerolling (quality
 * endpoint), and Masterpiece quality=5 (mount/faction MP column) all required
 * separate per-table scans. The joined-summary feature extends the main scan
 * so a single click populates EVERY category.
 *
 * Asserts (string-level — adequate for catching wiring regressions):
 *   - utils.js getAllRequiredItemIds calls getAllEnchantItemIds + getTransmuteItemIds
 *   - app.js runScan invokes fetchPricesBatchWithQualities for quality + MP IDs
 *   - all three fetches run inside a single Promise.all (parallel, not serial)
 *   - the parallel result reaches lastQualityMarketData + lastMpMarketData
 *
 * Run: node tests/scan-all-tables-fetches-everything.test.cjs
 */

const assert = require("assert");
const { appSource } = require("./helpers/app-source.cjs");
const fs = require("fs");
const path = require("path");

const utilsSrc = ["utils", "utils-item-ids", "utils-overrides", "utils-focus-fees"].map((n) => fs.readFileSync(path.join(__dirname, "..", "js", n + ".js"), "utf8")).join("\n");
const appSrc   = appSource();

function extractFnBody(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `${signature} must be defined`);
  // The signature already includes the opening "{"; depth=1 at start so the
  // first balanced "}" closes the function (not the first nested block).
  let depth = 1;
  let end = -1;
  for (let i = start + signature.length; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  return src.slice(start, end);
}

const getAllRequiredBody = extractFnBody(utilsSrc, "function getAllRequiredItemIds() {");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("\n=== utils.js — getAllRequiredItemIds covers Enchanting + Transmute ===");

test("getAllRequiredItemIds calls getAllEnchantItemIds", () => {
  assert.ok(
    getAllRequiredBody.includes("getAllEnchantItemIds"),
    "getAllRequiredItemIds must include enchanting IDs so the main scan fetches them",
  );
});

test("getAllRequiredItemIds calls getTransmuteItemIds", () => {
  assert.ok(
    getAllRequiredBody.includes("getTransmuteItemIds"),
    "getAllRequiredItemIds must include transmute IDs",
  );
});

console.log("\n=== app.js — runScan fetches quality + MP data in parallel ===");

// Find the runScan function body. It's defined inside DOMContentLoaded handler
// so we can't use extractFnBody from the top; locate the inner const runScan.
const runScanSig = "const runScan = async () => {";
const runScanStart = appSrc.indexOf(runScanSig);
assert.ok(runScanStart >= 0, "const runScan = async () => { must exist in app.js");
// Signature already includes the opening "{"; depth=1 so the first balanced
// "}" closes the arrow body (not the first nested block).
let depth = 1, runScanEnd = -1;
for (let i = runScanStart + runScanSig.length; i < appSrc.length; i++) {
  const ch = appSrc[i];
  if (ch === "{") depth++;
  else if (ch === "}") { depth--; if (depth === 0) { runScanEnd = i + 1; break; } }
}
const runScanBody = appSrc.slice(runScanStart, runScanEnd);

test("runScan calls fetchPricesBatchWithQualities for Rerolling quality data", () => {
  assert.ok(
    /fetchPricesBatchWithQualities\(\s*qualityIds\s*,\s*\[\s*1\s*,\s*2\s*,\s*3\s*,\s*4\s*,\s*5\s*\]\s*\)/.test(runScanBody),
    "runScan must fetch quality=[1..5] for Rerolling IDs",
  );
});

test("runScan calls fetchPricesBatchWithQualities for Masterpiece (quality=5) IDs", () => {
  assert.ok(
    /fetchPricesBatchWithQualities\(\s*mpIds\s*,\s*\[\s*5\s*\]\s*\)/.test(runScanBody),
    "runScan must fetch quality=[5] for saddled-mount Masterpiece IDs",
  );
});

test("the three fetches run in a single Promise.all (parallel, not sequential)", () => {
  // Match: const [data, qualityMap, mpQualityMap] = await Promise.all([...
  assert.ok(
    /await\s+Promise\.all\s*\(\s*\[[\s\S]*?fetchPrices\([\s\S]*?fetchPricesBatchWithQualities[\s\S]*?fetchPricesBatchWithQualities[\s\S]*?\]\s*\)/
      .test(runScanBody),
    "all three fetches must be inside one Promise.all([...]) for parallelism",
  );
});

test("the parallel result reaches lastQualityMarketData and lastMpMarketData", () => {
  // Folded, not assigned: a scan that assigns wipes prices the fetch did not
  // carry — every on-demand item, and every city AODP has no data for today
  // (js/captured-prices-store.js applyQualityScanPatch).
  assert.ok(
    /applyQualityScanPatch\s*\(\s*lastQualityMarketData\s*,\s*qualityMap\s*\)/.test(runScanBody),
    "qualityMap must be folded into lastQualityMarketData",
  );
  assert.ok(
    /lastMpMarketData[\s\S]{0,200}flattenQualityToMp\s*\(\s*mpQualityMap\s*\)/.test(runScanBody),
    "mpQualityMap must reach lastMpMarketData (via flattenQualityToMp)",
  );
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
