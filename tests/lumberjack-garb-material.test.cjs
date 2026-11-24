/**
 * Test: Lumberjack Garb T8 must use T8_LEATHER (Fortified Leather), not T8_CLOTH (Gossamer).
 * Confirmed via Albion Online game API: 16x T8_LEATHER.
 *
 * Run: node tests/lumberjack-garb-material.test.cjs
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

// ── helpers ────────────────────────────────────────────────────────────
function loadFileContent(relPath) {
  return fs.readFileSync(path.join(__dirname, "..", relPath), "utf-8");
}

function extractArray(src, varName) {
  // Wrap in a function so `const` declarations work, then eval
  const fn = new Function(`${src}; return ${varName};`);
  return fn();
}

// ── load sources ───────────────────────────────────────────────────────
const dataSrc = loadFileContent("js/data.js");
const namesSrc = loadFileContent("js/item-names.js");
const gatherSrc = loadFileContent("js/gear-gatherer.js");

const CRAFTING_ITEMS = extractArray(dataSrc, "CRAFTING_ITEMS");
const GEAR_GATHERER = extractArray(gatherSrc, "GEAR_GATHERER");
const ITEM_NAMES_MAP = extractArray(namesSrc, "ITEM_NAMES_MAP");

// ── tests ──────────────────────────────────────────────────────────────

const ITEM_ID = "T8_ARMOR_GATHERER_WOOD";

// Test 1: CRAFTING_ITEMS entry uses T8_LEATHER
const craftEntry = CRAFTING_ITEMS.find((i) => i.id === ITEM_ID);
assert.ok(craftEntry, `${ITEM_ID} must exist in CRAFTING_ITEMS`);
assert.strictEqual(
  craftEntry.matId,
  "T8_LEATHER",
  `CRAFTING_ITEMS matId should be T8_LEATHER, got ${craftEntry.matId}`
);
assert.strictEqual(
  craftEntry.matCount,
  16,
  `CRAFTING_ITEMS matCount should be 16, got ${craftEntry.matCount}`
);

// Test 2: GEAR_GATHERER entry uses T8_LEATHER with count 16
const gearEntry = GEAR_GATHERER.find((i) => i.id === ITEM_ID);
assert.ok(gearEntry, `${ITEM_ID} must exist in GEAR_GATHERER`);
const mat = gearEntry.materials[0];
assert.strictEqual(
  mat.matId,
  "T8_LEATHER",
  `GEAR_GATHERER matId should be T8_LEATHER, got ${mat.matId}`
);
assert.strictEqual(
  mat.count,
  16,
  `GEAR_GATHERER count should be 16, got ${mat.count}`
);

// Test 3: T8_LEATHER resolves to "T8 Fortified Leather" in ITEM_NAMES_MAP
assert.strictEqual(
  ITEM_NAMES_MAP["T8_LEATHER"],
  "T8 Fortified Leather",
  `T8_LEATHER display name should be "T8 Fortified Leather"`
);

console.log("All Lumberjack Garb material tests passed.");
