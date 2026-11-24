/**
 * Test: Daily-Vol helper functions in utils.js.
 *
 *   getMinVol2(md, id1, c1, id2, c2) — bottleneck volume across TWO different
 *     traded items/legs (buy id1 @ c1, sell id2 @ c2). Used by Transmute and
 *     Farming, whose buy and sell legs are different items.
 *   getCityVol(md, id, city) — one item's volume at one city (override-aware).
 *     Used by multi-material craft/breed rows as the output sell-city volume.
 *
 * Both must honor manual volume overrides (getOverrideVolume) over live data.
 *
 * Run: node tests/vol-helpers.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const src = ["utils", "utils-item-ids", "utils-overrides", "utils-focus-fees"].map((n) => fs.readFileSync(path.join(__dirname, "..", "js", n + ".js"), "utf8")).join("\n");
const mod = new Module("utils-vol");
const sandbox =
  "const window={};const localStorage={getItem:()=>null,setItem:()=>{}};" +
  "const document={getElementById:()=>null};";
mod._compile(
  sandbox + src + "\nmodule.exports={getMinVol,getMinVol2,getCityVol,volumeOverrides};",
  "utils.js",
);
const { getMinVol, getMinVol2, getCityVol, volumeOverrides } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name}\n    ${e.message}`); }
}

console.log("Daily-Vol helpers\n");

const md = {
  SEED: { Brecilien: { volume_24h: 9000 }, "Fort Sterling": { volume_24h: 0 } },
  CROP: { "Fort Sterling": { volume_24h: 55 }, Brecilien: { volume_24h: 0 } },
};

test("getCityVol reads the item's volume at that city", () => {
  assert.strictEqual(getCityVol(md, "CROP", "Fort Sterling"), 55);
});

test("getCityVol is 0 for a missing item/city", () => {
  assert.strictEqual(getCityVol(md, "CROP", "Martlock"), 0);
  assert.strictEqual(getCityVol(md, "NOPE", "Fort Sterling"), 0);
});

test("getMinVol2 pairs source@buyCity and target@sellCity (bottleneck)", () => {
  // seed liquid at buy, crop thin at sell -> min = 55 (the real bottleneck)
  assert.strictEqual(getMinVol2(md, "SEED", "Brecilien", "CROP", "Fort Sterling"), 55);
});

test("getMinVol2 does NOT read the output at the buy city (old bug = 0)", () => {
  // CROP has 0 vol at Brecilien; a one-item getMinVol(CROP, buy, sell) would be
  // 0. getMinVol2 avoids that by reading SEED on the buy leg.
  assert.strictEqual(getMinVol(md, "CROP", "Brecilien", "Fort Sterling"), 0);
  assert.notStrictEqual(getMinVol2(md, "SEED", "Brecilien", "CROP", "Fort Sterling"), 0);
});

test("manual volume overrides win over live data (getCityVol)", () => {
  volumeOverrides.CROP = { "Fort Sterling": { volume: 12345 } };
  assert.strictEqual(getCityVol(md, "CROP", "Fort Sterling"), 12345);
  delete volumeOverrides.CROP;
});

test("manual volume overrides win over live data (getMinVol2 legs)", () => {
  volumeOverrides.SEED = { Brecilien: { volume: 3 } }; // force buy leg to bottleneck
  assert.strictEqual(getMinVol2(md, "SEED", "Brecilien", "CROP", "Fort Sterling"), 3);
  delete volumeOverrides.SEED;
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
