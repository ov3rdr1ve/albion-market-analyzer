/**
 * Test: Dragon Sanctuary Waystones (Dragonfire, 2026-08-31).
 *
 * A Waystone opens a Dragon Sanctuary raid. Twelve of them exist — tiers T6/T7/
 * T8 × four difficulties D1–D4, which items.xml carries as enchantment levels
 * 1–4, so the marketplace ids end in @1…@4. They are crafted at the Artifact
 * Foundry from Waystone Fragments, and like the other Foundry maps they are
 * unlike every ordinary craft:
 *
 *   • the fragments carry maxreturnamount="0" — no Resource Return Rate;
 *   • there is no craftingfocus attribute, so the focus toggle stays inert;
 *   • there is no silver fee and no itemvalue, so there is no station fee
 *     either (unlike the dungeon/hellgate maps, which do charge silver).
 *
 * items.xml also lists two ladder routes per Waystone (3× the difficulty
 * below, or 3× the tier below at the same difficulty). Those are deliberately
 * NOT the priced recipe — which of the three is cheapest depends on live
 * prices, and that is a Craft Planner question. The catalog prices the
 * fragment route and the file documents the other two.
 *
 * Black-box: reads the real catalog and cross-checks every number against
 * items.xml. No live API or DB.
 *
 * Run: node tests/spirit-waystones.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

function load(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const TIERS = [6, 7, 8];
const DIFFICULTIES = [1, 2, 3, 4];
const FRAGMENTS_FOR = { 1: 100, 2: 300, 3: 900, 4: 2700 };
const TIER_WORD = { 6: "Master's", 7: "Grandmaster's", 8: "Elder's" };
const QUALITY_WORD = { 1: "", 2: "Uncommon ", 3: "Rare ", 4: "Exceptional " };

const mod = new Module("waystones-test");
mod._compile(
  load("js/data-waystones.js") +
    load("js/item-names.js") +
    "\nmodule.exports = { WAYSTONES, WAYSTONE_FRAGMENT_IDS, injectWaystones, ITEM_NAMES_MAP };",
  "waystones-test.js"
);
const { WAYSTONES, WAYSTONE_FRAGMENT_IDS, injectWaystones, ITEM_NAMES_MAP } = mod.exports;

const ITEMS_XML = load("data/dumps/items.xml");
const FOCUS_COSTS = require("../js/focus-costs.json");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name + " — " + e.message); failed++; }
}

const CASES = TIERS.flatMap((t) =>
  DIFFICULTIES.map((d) => ({
    tier: t,
    diff: d,
    baseId: "T" + t + "_RANDOM_DUNGEON_ELITE_DRAGON_TOKEN_D" + d,
    marketId: "T" + t + "_RANDOM_DUNGEON_ELITE_DRAGON_TOKEN_D" + d + "@" + d,
    fragId: "T" + t + "_SHARD_RANDOM_DUNGEON_ELITE_DRAGON_TOKEN",
    fragments: FRAGMENTS_FOR[d],
    name: QUALITY_WORD[d] + TIER_WORD[t] + " Dragon Sanctuary Waystone [T" + t + "]",
  }))
);

const byId = new Map(WAYSTONES.map((w) => [w.id, w]));

console.log("\n=== Twelve Waystones: T6/T7/T8 × D1–D4 ===");
test("the catalog holds exactly 12 rows", () => {
  assert.strictEqual(WAYSTONES.length, 12);
});
test("three fragment ids, one per tier", () => {
  assert.deepStrictEqual([...WAYSTONE_FRAGMENT_IDS].sort(),
    TIERS.map((t) => "T" + t + "_SHARD_RANDOM_DUNGEON_ELITE_DRAGON_TOKEN").sort());
});

console.log("\n=== Market ids carry the difficulty as an enchant level ===");
for (const c of CASES) {
  test(c.baseId + " is priced as " + c.marketId, () => {
    const w = byId.get(c.marketId);
    assert.ok(w, c.marketId + " missing from WAYSTONES");
  });
  test(c.baseId + " really has enchantmentlevel=\"" + c.diff + "\"", () => {
    const tag = ITEMS_XML.match(
      new RegExp('<consumablefrominventoryitem uniquename="' + c.baseId + '"[^>]*>')
    );
    assert.ok(tag, c.baseId + " is not in items.xml");
    assert.ok(tag[0].includes('enchantmentlevel="' + c.diff + '"'),
      c.baseId + " enchant level is not " + c.diff);
  });
}

console.log("\n=== The priced route is the fragment route ===");
for (const c of CASES) {
  test(c.marketId + " = " + c.fragments + " × " + c.fragId, () => {
    const w = byId.get(c.marketId);
    assert.deepStrictEqual(w.materials.map((m) => [m.matId, m.count]),
      [[c.fragId, c.fragments]]);
  });
  test(c.marketId + " refunds nothing", () => {
    assert.strictEqual(byId.get(c.marketId).noReturn, true);
  });
  test(c.marketId + " charges no silver and no station fee", () => {
    const w = byId.get(c.marketId);
    assert.strictEqual(w.silverCost, 0);
    assert.strictEqual(w.nutritionPerCraft, 0);
  });
  test(c.marketId + " costs no focus", () => {
    const f = FOCUS_COSTS[c.baseId];
    assert.ok(f === undefined || f === 0, c.baseId + " should be focus-free (got " + f + ")");
  });
  test(c.marketId + " renders as \"" + c.name + "\"", () => {
    const w = byId.get(c.marketId);
    assert.strictEqual(w.name, c.name);
  });
}

console.log("\n=== items.xml agrees on the fragment counts ===");
for (const c of CASES) {
  test(c.baseId + " really melds from " + c.fragments + " fragments", () => {
    const block = ITEMS_XML.match(
      new RegExp('<consumablefrominventoryitem uniquename="' + c.baseId +
        '"[\\s\\S]*?</consumablefrominventoryitem>')
    );
    assert.ok(block, c.baseId + " block not found");
    const frag = block[0].match(
      new RegExp('<craftresource uniquename="' + c.fragId + '" count="(\\d+)"')
    );
    assert.ok(frag, c.baseId + " has no fragment route");
    assert.strictEqual(Number(frag[1]), c.fragments);
    assert.ok(block[0].includes('maxreturnamount="0"'), "fragments must not be refunded");
  });
}

console.log("\n=== Fragments are named and flip-priced ===");
for (const tier of TIERS) {
  const id = "T" + tier + "_SHARD_RANDOM_DUNGEON_ELITE_DRAGON_TOKEN";
  test(id + " renders as \"" + TIER_WORD[tier] + " Waystone Fragment\"", () => {
    assert.strictEqual(ITEM_NAMES_MAP[id], TIER_WORD[tier] + " Waystone Fragment");
  });
}

console.log("\n=== Injection into a crafting catalog ===");
test("injectWaystones appends every row exactly once", () => {
  const catalog = [];
  injectWaystones(catalog);
  assert.strictEqual(catalog.length, 12);
  injectWaystones(catalog);
  assert.strictEqual(catalog.length, 12, "a second call must not duplicate rows");
});
test("injectWaystones leaves a non-array alone", () => {
  assert.strictEqual(injectWaystones(null), null);
});
test("injected rows are copies, not shared references", () => {
  const catalog = [];
  injectWaystones(catalog);
  catalog[0].name = "mutated";
  assert.notStrictEqual(WAYSTONES[0].name, "mutated");
});

console.log("\n" + "=".repeat(50));
console.log("Total: " + (passed + failed) + " | Passed: " + passed + " | Failed: " + failed);
if (failed > 0) process.exit(1);
