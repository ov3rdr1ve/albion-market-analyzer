/**
 * Test: Crystallized Spirit / Dread / Magic / Divinity are registered as
 * drop-only flip items at tiers T4-T8 with the correct Albion item IDs
 * (T{N}_ARTEFACT_TOKEN_FAVOR_{1..4}).
 *
 * Run: node tests/crystallized-items.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadScript(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf-8");
}

const sandbox = { window: {}, document: { getElementById: () => null }, exports: {} };
vm.createContext(sandbox);
try { vm.runInContext(loadScript("js/data.js"), sandbox); }
catch (e) { console.error(`Error loading js/data.js: ${e.message}`); process.exit(1); }
const FLIPPING_ITEMS = vm.runInContext("FLIPPING_ITEMS", sandbox);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Crystallized Items Tests\n");

const TIER_ADJ = { 4: "Adept's", 5: "Expert's", 6: "Master's", 7: "Grandmaster's", 8: "Elder's" };
const crystallized = [
  { flavor: 1, short: "Spirit" },
  { flavor: 2, short: "Dread" },
  { flavor: 3, short: "Magic" },
  { flavor: 4, short: "Divinity" },
];

for (const c of crystallized) {
  test(`Crystallized ${c.short}: T4-T8 present in FLIPPING_ITEMS`, () => {
    for (let t = 4; t <= 8; t++) {
      const id = `T${t}_ARTEFACT_TOKEN_FAVOR_${c.flavor}`;
      const expectedName = `${TIER_ADJ[t]} Crystallized ${c.short}`;
      const item = FLIPPING_ITEMS.find((i) => i.id === id);
      assert.ok(item, `Missing ${id}`);
      assert.strictEqual(item.name, expectedName, `${id} name mismatch`);
    }
  });
}

test("FLIPPING_ITEMS contains exactly 20 new Crystallized entries", () => {
  const matches = FLIPPING_ITEMS.filter((i) => /^T[4-8]_ARTEFACT_TOKEN_FAVOR_[1-4]$/.test(i.id));
  assert.strictEqual(matches.length, 20, `expected 20, got ${matches.length}`);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
