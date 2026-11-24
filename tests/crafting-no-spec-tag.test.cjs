/**
 * Test: the Crafting table flags a "(no spec)" hint when an item is crafted in a
 * city that lacks its craft spec — e.g. a Caerleon-spec shapeshifter staff built
 * in a royal city because Black/Red Zone Routes are off (Caerleon unreachable).
 *
 * The displayed craft city is then arbitrary among equal-RRR royals, so the tag
 * tells the user the city carries no spec bonus. Mirrors the consumables table.
 *
 * Black-box: drive the REAL getNoSpecLabel (extracted from js/render-crafting.js)
 * with a stub CITY_CRAFT_SPEC and assert the rendered hint.
 *
 * Run: node tests/crafting-no-spec-tag.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Tag text runs through tx(english, slug); en-mode identity keeps assertions in English.
globalThis.tx = globalThis.tx || ((en) => en);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// ── Extract the real helpers from the shipped source ──
const renderCraftingSrc = fs.readFileSync(
  path.join(__dirname, "..", "js", "render-crafting.js"),
  "utf-8",
);
const getSpecSrc = renderCraftingSrc.match(/function getSpecCraftCity[\s\S]*?\n\}/);
const getNoSpecSrc = renderCraftingSrc.match(/function getNoSpecLabel[\s\S]*?\n\}/);
assert.ok(getSpecSrc, "getSpecCraftCity not found in render-crafting.js");
assert.ok(getNoSpecSrc, "getNoSpecLabel not found in render-crafting.js");

// Reality-shaped stub: shapeshifterstaff is a Caerleon spec, sword a Lymhurst spec.
const CITY_CRAFT_SPEC = {
  Lymhurst: ["sword"],
  Caerleon: ["shapeshifterstaff", "knuckles", "food"],
};
const getNoSpecLabel = new Function(
  "CITY_CRAFT_SPEC",
  `${getSpecSrc[0]}\n${getNoSpecSrc[0]}\n return getNoSpecLabel;`,
)(CITY_CRAFT_SPEC);

console.log("Crafting (no spec) Tag Tests\n");

// ── The reported case: Caerleon-spec staff crafted in a royal city ──

test("shapeshifter staff in Lymhurst (BMR off) → shows (no spec)", () => {
  const html = getNoSpecLabel("Lymhurst", "shapeshifterstaff");
  assert.ok(html.includes("(no spec)"), `expected (no spec), got: ${html}`);
});

test("the staff tag names Caerleon as the spec city and the red-zone caveat", () => {
  const html = getNoSpecLabel("Lymhurst", "shapeshifterstaff");
  assert.ok(html.includes("Caerleon is the spec city"), `tooltip should name Caerleon: ${html}`);
  assert.ok(/red-zone routes off/.test(html), `tooltip should mention red-zone routes: ${html}`);
});

test("shapeshifter staff in Caerleon (BMR on) → no tag (spec applies)", () => {
  assert.strictEqual(getNoSpecLabel("Caerleon", "shapeshifterstaff"), "");
});

// ── General behaviour for other craft types ──

test("sword in Caerleon → (no spec); names Lymhurst, no red-zone caveat", () => {
  const html = getNoSpecLabel("Caerleon", "sword");
  assert.ok(html.includes("(no spec)"), `expected (no spec), got: ${html}`);
  assert.ok(html.includes("Lymhurst is the spec city"), `should name Lymhurst: ${html}`);
  assert.ok(!/red-zone routes off/.test(html), "Lymhurst spec should not carry the Caerleon caveat");
});

test("sword in Lymhurst (its spec city) → no tag", () => {
  assert.strictEqual(getNoSpecLabel("Lymhurst", "sword"), "");
});

test("non-spec craft type (null) → no tag", () => {
  assert.strictEqual(getNoSpecLabel("Lymhurst", null), "");
});

test("unknown craft type with no spec city → no tag", () => {
  assert.strictEqual(getNoSpecLabel("Martlock", "furnitureitem"), "");
});

// ── Source-level guard: both craft-city cells thread the tag ──

test("both crafting row paths render getNoSpecLabel(craftCity, item.craftType)", () => {
  // The no-data row lives in its own file since render-crafting.js hit the
  // 800-line cap; read the whole family so the split is not a missing path.
  const familySrc = renderCraftingSrc + "\n" + fs.readFileSync(
    path.join(__dirname, "..", "js", "render-crafting-no-data-row.js"), "utf-8");
  const calls = (familySrc.match(/getNoSpecLabel\(craftCity, item\.craftType\)/g) || []).length;
  assert.ok(calls >= 2, `expected the tag wired into both row paths (no-data + valid), found ${calls}`);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
