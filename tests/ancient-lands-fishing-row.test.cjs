/**
 * Test: the Ancient Lands fishing rows in the Gathering table (Dragonfire,
 * 2026-08-31).
 *
 * Leyfin are rare freshwater fish that exist ONLY inside the instanced Ancient
 * Lands. They are therefore not a seventh entry in FISH_RARE_BIOMES: folding
 * them into the merged open-world fishing rows would raise every fishing tier's
 * silver/hour with a fish you cannot catch in the open world. Instead they get
 * three rows of their own (T3 / T5 / T7 — the tiers the fish exist at), each
 * pricing the leyfin itself as the staple catch with its own throughput
 * estimate.
 *
 * Two properties matter and are asserted here:
 *   1. the six open-world fishing rows are byte-for-byte unchanged;
 *   2. an Ancient Lands row never collides with an open-world row under
 *      getRowKey — the gathering key is rawId|section, so the staple id has to
 *      differ, which is why the leyfin (not the common) is the row's rawId.
 *
 * Black-box: reads the real catalog + row-key modules. No live API or DB.
 *
 * Run: node tests/ancient-lands-fishing-row.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

function load(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const mod = new Module("ancient-fishing-test");
mod._compile(
  load("js/data-gathering.js") +
    load("js/sorting-row-key.js") +
    "\nmodule.exports = { getGatheringResources, getGatheringItemIds, GATHERING_PROFESSIONS, FISH_RARE_BIOMES, FISH_RARE_WEIGHT_KG, ANCIENT_FISH_UNITS_PER_HOUR, ANCIENT_FISH_TIERS, getRowKey };",
  "ancient-fishing-test.js"
);
const {
  getGatheringResources,
  getGatheringItemIds,
  GATHERING_PROFESSIONS,
  FISH_RARE_WEIGHT_KG,
  ANCIENT_FISH_UNITS_PER_HOUR,
  ANCIENT_FISH_TIERS,
  getRowKey,
} = mod.exports;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name + " — " + e.message); failed++; }
}

const rows = getGatheringResources();
const ancient = rows.filter((r) => r.ancient);
const openWater = rows.filter((r) => r.kind === "fishing" && !r.ancient);

console.log("\n=== Exactly three Ancient Lands rows, at T3 / T5 / T7 ===");
test("three rows exist", () => {
  assert.strictEqual(ancient.length, 3, "expected 3 Ancient Lands fishing rows");
});
test("their tiers are 3 / 5 / 7", () => {
  assert.deepStrictEqual(ancient.map((r) => r.tier).sort((a, b) => a - b), [3, 5, 7]);
});
test("ANCIENT_FISH_TIERS is the single source of those tiers", () => {
  assert.deepStrictEqual([...ANCIENT_FISH_TIERS], [3, 5, 7]);
});

console.log("\n=== Each row prices the leyfin as its staple catch ===");
for (const tier of [3, 5, 7]) {
  const row = ancient.find((r) => r.tier === tier);
  const leyfin = "T" + tier + "_FISH_FRESHWATER_DRAGON_AREA_RARE";
  test("T" + tier + " row's staple is " + leyfin, () => {
    assert.ok(row, "no Ancient Lands row at T" + tier);
    assert.strictEqual(row.freshCommonId, leyfin);
    assert.deepStrictEqual(row.marketIds, [leyfin],
      "an Ancient Lands row prices exactly one id");
  });
  test("T" + tier + " row folds in no second catch", () => {
    // There is no known common/rare split inside the instance, so the row does
    // not invent one: share 0, no rare ids, no saltwater side.
    assert.strictEqual(row.rareShare, 0);
    assert.deepStrictEqual(row.freshRareIds, []);
    assert.strictEqual(row.saltCommonId, null);
    assert.strictEqual(row.saltRareId, null);
  });
  test("T" + tier + " row carries the real rare-fish weight", () => {
    assert.strictEqual(row.commonWeightKg, FISH_RARE_WEIGHT_KG[tier]);
  });
  test("T" + tier + " row uses the Ancient Lands throughput estimate", () => {
    assert.strictEqual(row.unitsPerHour, ANCIENT_FISH_UNITS_PER_HOUR[tier]);
    assert.ok(row.unitsPerHour > 0, "throughput must be a positive estimate");
  });
  test("T" + tier + " row is badged as its own profession", () => {
    assert.strictEqual(row.profession, GATHERING_PROFESSIONS.fishAncient);
    assert.strictEqual(row.profession.label, "Ancient Lands Fishing");
  });
  test("T" + tier + " row renders under its own name", () => {
    assert.ok(/leyfin/i.test(row.rowName || ""),
      "row name \"" + row.rowName + "\" should say leyfin, not \"T" + tier + " fish\"");
  });
}

console.log("\n=== The open-world fishing rows did not move ===");
test("still one merged row per gathering tier (T2–T8)", () => {
  assert.deepStrictEqual(
    openWater.map((r) => r.tier).sort((a, b) => a - b),
    [2, 3, 4, 5, 6, 7, 8]
  );
});
for (const row of openWater) {
  test("T" + row.tier + " open-world row still prices both waters", () => {
    assert.strictEqual(row.freshCommonId, "T" + row.tier + "_FISH_FRESHWATER_ALL_COMMON");
    assert.strictEqual(row.saltCommonId, "T" + row.tier + "_FISH_SALTWATER_ALL_COMMON");
    assert.ok(!row.ancient, "an open-world row must not be flagged ancient");
  });
  test("T" + row.tier + " open-world row folds in no leyfin", () => {
    const leyfins = row.marketIds.filter((id) => id.includes("DRAGON_AREA"));
    assert.deepStrictEqual(leyfins, [],
      "the open-world silver/hour must not include an instanced-only fish");
  });
}
test("open-world rows still fold in six biome rares at T3/T5/T7", () => {
  for (const tier of [3, 5, 7]) {
    const row = openWater.find((r) => r.tier === tier);
    assert.strictEqual(row.freshRareIds.length, 6,
      "T" + tier + " should still see six biome rares");
  }
});

console.log("\n=== Row identity: no collision with the open-world rows ===");
// The renderer sets rawId to whichever water it priced (buildFishingRow), so an
// open-world row's key is always one of its two commons. An Ancient Lands row
// has a single candidate — the leyfin. Disjoint candidate sets ⇒ disjoint keys.
const openWaterStaples = new Set(
  openWater.flatMap((r) => [r.freshCommonId, r.saltCommonId].filter(Boolean))
);
test("no Ancient Lands staple can also be an open-world staple", () => {
  for (const r of ancient) {
    assert.ok(!openWaterStaples.has(r.freshCommonId),
      r.freshCommonId + " is also an open-world staple — the rows would share a key");
  }
});
test("the three Ancient Lands rows key apart from each other", () => {
  const keys = ancient.map((r) => getRowKey({ ...r, rawId: r.freshCommonId }, "gathering-table"));
  assert.strictEqual(new Set(keys).size, 3, "Ancient Lands rows share a key");
});

console.log("\n=== The scan fetches every leyfin id ===");
test("getGatheringItemIds includes all three leyfin", () => {
  const ids = new Set(getGatheringItemIds());
  for (const tier of [3, 5, 7]) {
    assert.ok(ids.has("T" + tier + "_FISH_FRESHWATER_DRAGON_AREA_RARE"),
      "T" + tier + " leyfin missing from the gathering scan ids");
  }
});

console.log("\n" + "=".repeat(50));
console.log("Total: " + (passed + failed) + " | Passed: " + passed + " | Failed: " + failed);
if (failed > 0) process.exit(1);
