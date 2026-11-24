/**
 * Test: refining station fee (nutrition) scales with ENCHANT, not just tier.
 *
 * Ground truth (Albion wiki, "assuming station silver cost of 1000 per 100
 * nutrition used"):
 *   Granite Block        (T5.0 stone)  3.6
 *   Marble Block         (T8.0 stone)  28.8
 *   Uncommon Pine Planks (T4.1 wood)   3.6   ← plain T4 is 1.8
 *
 * All three fall out of the game's own rule: nutrition = product itemvalue x
 * 0.1125, and a refined resource's items.xml itemvalue is
 * 16 * 2^(tier-4) * 2^enchant (T4 plank 16, T5 32 … T8 256; T5.1 64, T5.2 128,
 * T5.3 256, T5.4 512). So nutrition = 1.8 * 2^(tier-4+enchant).
 *
 * The generic calcStationFeeSilver estimate (14 item-value per material) was
 * used for every refine row: 12.5% short on plain refines (14 vs 16) and
 * completely flat across enchant, so a T8.4 refine was billed the T8.0 fee —
 * 16x too little.
 *
 * Enchanted-rock rows are the deliberate exception: they output a PLAIN stone
 * block, so keying the fee on the REFINED id bills them at the plain rate (the
 * wiki's Granite Block .3 row is 28.8 nutrition for 8 blocks = 3.6 each).
 *
 * Black-box: load the real js/utils.js and call the public helpers.
 *
 * Run: node tests/refining-station-fee-enchant.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Station fee input in silver per 100 nutrition (the wiki's own assumption).
const FEE_PER_100 = 1000;

const sandbox = {
  window: {},
  document: {
    getElementById: (id) => (id === "station-fee" ? { value: String(FEE_PER_100) } : null),
  },
  console,
  localStorage: { getItem: () => null, setItem: () => {} },
};
vm.createContext(sandbox);
for (const s of [
  "js/item-names.js", "js/resource-names.js", "js/data.js",
  "js/data-consumables.js", "js/data-mounts.js", "js/data-farming.js", "js/utils.js", "js/utils-item-ids.js", "js/utils-overrides.js", "js/utils-focus-fees.js",
]) {
  try { vm.runInContext(fs.readFileSync(path.join(__dirname, "..", s), "utf-8"), sandbox); }
  catch (e) { console.error(`Error loading ${s}: ${e.message}`); process.exit(1); }
}
const refineStationNutrition = vm.runInContext("refineStationNutrition", sandbox);
const refineStationFeeSilver = vm.runInContext("refineStationFeeSilver", sandbox);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name}\n    ${e.message}`); }
}
const close = (a, b, msg) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${msg}: expected ${b}, got ${a}`);

console.log("Refining station fee vs enchant\n");

// ── 1. Wiki-anchored spot values ──
const WIKI = [
  ["T5_STONEBLOCK", 3.6, "Granite Block"],
  ["T8_STONEBLOCK", 28.8, "Marble Block"],
  ["T4_PLANKS", 1.8, "Chestnut/T4 Planks"],
  ["T4_PLANKS_LEVEL1@1", 3.6, "Uncommon Pine Planks (T4.1)"],
];
WIKI.forEach(([id, want, label]) => {
  test(`${label}: nutrition ${want}`, () => {
    close(refineStationNutrition(id), want, id);
  });
});

// ── 2. Full ladder: doubles per tier AND per enchant ──
["PLANKS", "METALBAR", "LEATHER", "CLOTH"].forEach((fam) => {
  test(`${fam}: nutrition = 1.8 * 2^(tier-4+enchant) across T4–T8 x .0–.4`, () => {
    for (let tier = 4; tier <= 8; tier++) {
      for (let ench = 0; ench <= 4; ench++) {
        const id = ench ? `T${tier}_${fam}_LEVEL${ench}@${ench}` : `T${tier}_${fam}`;
        close(refineStationNutrition(id), 1.8 * Math.pow(2, tier - 4 + ench), id);
      }
    }
  });
});

test("T2/T3 refines keep the same ladder (0.45 / 0.9)", () => {
  close(refineStationNutrition("T2_PLANKS"), 0.45, "T2_PLANKS");
  close(refineStationNutrition("T3_PLANKS"), 0.9, "T3_PLANKS");
});

// ── 3. Enchant is what moved, not tier alone ──
test("each enchant level doubles the fee at a fixed tier", () => {
  for (let ench = 1; ench <= 4; ench++) {
    const plain = refineStationNutrition("T6_CLOTH");
    const got = refineStationNutrition(`T6_CLOTH_LEVEL${ench}@${ench}`);
    close(got, plain * Math.pow(2, ench), `T6 cloth .${ench}`);
  }
});

// ── 4. Enchanted-rock rows bill at the PLAIN block rate ──
test("enchanted rock refines to a plain block, so the fee stays the plain one", () => {
  // The row's refinedId is the plain block whatever the raw rock's enchant is.
  [4, 5, 6, 7, 8].forEach((tier) => {
    close(refineStationNutrition(`T${tier}_STONEBLOCK`), 1.8 * Math.pow(2, tier - 4),
      `T${tier}_STONEBLOCK`);
  });
});

// ── 5. Silver conversion honours the station-fee input ──
test("silver = (fee input / 100) * nutrition", () => {
  close(refineStationFeeSilver("T5_STONEBLOCK"), (FEE_PER_100 / 100) * 3.6, "T5 stone silver");
  close(refineStationFeeSilver("T4_PLANKS_LEVEL1@1"), (FEE_PER_100 / 100) * 3.6, "T4.1 plank silver");
  close(refineStationFeeSilver("T8_CLOTH_LEVEL4@4"), (FEE_PER_100 / 100) * 28.8 * 16, "T8.4 cloth silver");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
