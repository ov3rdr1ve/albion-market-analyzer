/**
 * Test: ITEM_NAMES_MAP material names match the official in-game names.
 *
 * Source of truth is the repo's items.json (ao-bin-dumps, EN-US). Map names
 * carry a tier prefix ("T4 ", "T4.1 ") or a "[Tn]" suffix that is stripped
 * before comparing. Black-box: real map loaded, items.json read from disk.
 * No live API or DB.
 *
 * Run: node tests/item-names-official.test.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const MAP = vm.runInNewContext(read("js/item-names.js") + "\n;ITEM_NAMES_MAP");
const OFFICIAL = {};
for (const it of JSON.parse(read("data/dumps/items.json"))) {
  if (it.UniqueName && it.LocalizedNames) OFFICIAL[it.UniqueName] = it.LocalizedNames["EN-US"];
}

const strip = (s) => s.replace(/^T\d(\.\d)? /, "").replace(/\s*\[T\d\]$/, "");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name}\n    ${e.message}`); }
}

// id -> exact official name
const EXACT = {
  T8_HIDE: "Resilient Hide",
  T4_LEATHER: "Worked Leather",
  T6_HIDE: "Robust Hide",
  T2_LEATHER: "Stiff Leather",
  T2_PLANKS: "Birch Planks",
  T6_JOURNAL_TOOLMAKER_EMPTY: "Master Tinker's Journal (Empty)",
};
for (const [id, expect] of Object.entries(EXACT)) {
  test(`${id} is "${expect}"`, () => {
    assert(id in MAP, "missing id");
    if (id.includes("JOURNAL")) assert.strictEqual(MAP[id], expect);
    else assert.strictEqual(strip(MAP[id]), expect);
  });
}

test("T8_MOUNT_MAMMOTH_BATTLE@1 is Elder's Command Mammoth", () => {
  assert.strictEqual(MAP["T8_MOUNT_MAMMOTH_BATTLE@1"], "Elder's Command Mammoth");
});

// enchanted rows (no official unprefixed id): must carry the right material word
const CONTAINS = [
  ["T4_LEATHER_LEVEL1@1", "Worked Leather"], ["T4_LEATHER_LEVEL2@2", "Worked Leather"],
  ["T4_LEATHER_LEVEL3@3", "Worked Leather"], ["T4_LEATHER_LEVEL4@4", "Worked Leather"],
  ["T3_PLANKS", "Chestnut Planks"], ["T3_PLANKS@1", "Chestnut Planks"], ["T3_PLANKS@2", "Chestnut Planks"],
  ["T3_PLANKS@3", "Chestnut Planks"], ["T3_PLANKS@4", "Chestnut Planks"],
  ["T3_LEATHER", "Thick Leather"], ["T3_LEATHER@1", "Thick Leather"], ["T3_LEATHER@2", "Thick Leather"],
  ["T3_LEATHER@3", "Thick Leather"], ["T3_LEATHER@4", "Thick Leather"],
];
for (const [id, word] of CONTAINS) {
  test(`${id} contains "${word}"`, () => {
    assert(id in MAP, "missing id");
    assert(MAP[id].includes(word), `got "${MAP[id]}"`);
  });
}

test("no stale names: Thin Leather / T3 Birch Planks / T4 Stiff Leather", () => {
  const bad = Object.entries(MAP).filter(([id, n]) =>
    /Thin Leather/.test(n) || (/^T3/.test(id) && /Birch Planks/.test(n)) || (/^T4/.test(id) && /Stiff Leather/.test(n)));
  assert.deepStrictEqual(bad, []);
});

// sweep: every plain T2-T8 raw/refined resource id matches its official name
test("sweep: base resource ids match official EN-US names", () => {
  const re = /^T[2-8]_(WOOD|ORE|HIDE|FIBER|ROCK|PLANKS|METALBAR|LEATHER|CLOTH|STONEBLOCK)$/;
  const mismatches = [];
  for (const [id, name] of Object.entries(MAP)) {
    if (!re.test(id) || !OFFICIAL[id]) continue;
    if (strip(name) !== OFFICIAL[id]) mismatches.push(`${id}: "${name}" != "${OFFICIAL[id]}"`);
  }
  assert.deepStrictEqual(mismatches, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
