/**
 * Test: the Firewing Drake (Dragonfire, 2026-08-31) — Kennel row and Saddler
 * craft.
 *
 * The drake is the first animal in the game that eats MOUNTS. Every other
 * kennel or pasture animal accepts crops/herbs, meat, or (the Easter rabbit)
 * chocolate, and within each of those categories nutrition per piece is a flat
 * constant, so "cheapest feed" collapses to "cheapest item". Mounts break that:
 * their nutrition climbs steeply with tier (170 at T3 → 59 049 at T8), so the
 * cheapest feed is the cheapest per NUTRITION POINT and the number of animals
 * you burn depends on which one you picked.
 *
 * It is also an outlier on the two tier ladders: 668 h to grow and 147 696
 * nutrition, against 284 h / 19 728 for every other T8 baby. Both come straight
 * from items.xml and both must be pinned, not derived.
 *
 * Black-box: drives the real catalogs and the real findCheapestFeed /
 * getBreedingMeta out of js/render-mounts.js against a synthetic price sheet.
 * No live API or DB.
 *
 * Run: node tests/firewing-drake-breeding.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

function load(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const BABY = "T8_FARM_DRAKE_BABY";
const GROWN = "T8_FARM_DRAKE_GROWN";
const MOUNT = "T8_MOUNT_DRAKE_FIRE";

// ── Enough of the browser globals for render-mounts.js to parse and for
//    findCheapestFeed to run. ────────────────────────────────────────────────
const stubs = [
  "const CITIES = ['Bridgewatch','Fort Sterling','Lymhurst','Martlock','Thetford','Caerleon'];",
  "const ROYAL_CITIES = ['Bridgewatch','Fort Sterling','Lymhurst','Martlock','Thetford'];",
  "const SELL_CITIES = CITIES.concat(['Black Market']);",
  "const PREMIUM_TAX = 0.04;",
  "const SETUP_FEE = 0.025;",
  "function getTierFromId(id) { const m = id.match(/^T(\\d)/); return m ? parseInt(m[1], 10) : 0; }",
  "function getIQRBounds() { return null; }",
  "function getCityForce() { return null; }",
  "function getOverridePrice() { return null; }",
  "function getBuyPrice(d, city) { return (d && d[city] && d[city].sell_price) || 0; }",
  "function getSellPrice(d, city) { return (d && d[city] && d[city].buy_price) || 0; }",
  "function getItemDisplayName(id) { return id; }",
  "function tx(s) { return s; }",
  "function isBlackRedZoneEnabled() { return true; }",
  "const priceOverrides = {};",
  "",
].join("\n");

const mod = new Module("firewing-test");
mod._compile(
  stubs +
    load("js/data-mounts.js") +
    load("js/item-names.js") +
    load("js/render-mounts.js") +
    "\nmodule.exports = { MOUNT_RECIPES, BREEDING_ITEMS, BREEDING_NURTURE_DATA, ITEM_NAMES_MAP, getBreedingMeta, findCheapestFeed, getBreedingFeedIds, FOOD_ITEMS, FOOD_NUTRITION_PER_PIECE, MOUNT_FEED_NUTRITION };",
  "firewing-test.js"
);
const {
  MOUNT_RECIPES,
  BREEDING_ITEMS,
  BREEDING_NURTURE_DATA,
  ITEM_NAMES_MAP,
  getBreedingMeta,
  findCheapestFeed,
  getBreedingFeedIds,
  FOOD_ITEMS,
  MOUNT_FEED_NUTRITION,
} = mod.exports;

const ITEMS_XML = load("data/dumps/items.xml");
const FOCUS_COSTS = require("../js/focus-costs.json");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name + " — " + e.message); failed++; }
}

console.log("\n=== Saddler craft ===");
test("the Firewing Drake is a mount recipe", () => {
  const r = MOUNT_RECIPES.find((m) => m.id === MOUNT);
  assert.ok(r, MOUNT + " missing from MOUNT_RECIPES");
  assert.deepStrictEqual(r.materials.map((m) => [m.matId, m.count]),
    [[GROWN, 1], ["T8_LEATHER", 20]]);
  assert.ok(/Firewing Drake/.test(r.name), "name is \"" + r.name + "\"");
});
test("its focus cost comes from the dump", () => {
  assert.strictEqual(FOCUS_COSTS[MOUNT], 10053);
});
test("it is not a battlemount", () => {
  const r = MOUNT_RECIPES.find((m) => m.id === MOUNT);
  assert.ok(!r.craftType, "the drake is saddled like a riding mount");
});

console.log("\n=== Kennel row ===");
test("baby → grown pair is registered", () => {
  const b = BREEDING_ITEMS.find((i) => i.babyId === BABY);
  assert.ok(b, BABY + " missing from BREEDING_ITEMS");
  assert.strictEqual(b.grownId, GROWN);
});
test("the egg and the tame drake are named", () => {
  assert.strictEqual(ITEM_NAMES_MAP[BABY], "Firewing Drake Egg");
  assert.strictEqual(ITEM_NAMES_MAP[GROWN], "Tame Firewing Drake");
});
test("nurture ladder matches items.xml (14 cycles × 0.4%, no base offspring)", () => {
  const n = BREEDING_NURTURE_DATA[BABY];
  assert.ok(n, BABY + " missing from BREEDING_NURTURE_DATA");
  assert.strictEqual(n.maxCycles, 14);
  assert.ok(Math.abs(n.bonusPerCycle - 0.004) < 1e-9);
  assert.strictEqual(n.baseOffspring, 0);
});
test("items.xml really says offspring chance 0", () => {
  const block = ITEMS_XML.match(
    new RegExp('<farmableitem uniquename="' + BABY + '"[\\s\\S]*?</farmableitem>')
  );
  assert.ok(block, BABY + " is not in items.xml");
  assert.ok(/<offspring chance="0\.0"/.test(block[0]),
    "the drake must never breed itself back");
  assert.ok(/activefarmmaxcycles="14"/.test(block[0]));
  assert.ok(/<acceptedfood foodcategory="mount"\s*\/>/.test(block[0]),
    "the drake must accept mounts");
});

console.log("\n=== The two ladder outliers are pinned, not derived ===");
const meta = getBreedingMeta({ babyId: BABY, grownId: GROWN });
test("grow time is 668 h, not the T8 default of 284", () => {
  assert.strictEqual(meta.growHours, 668);
});
test("nutrition budget is 147 696, not the T8 default of 19 728", () => {
  assert.strictEqual(meta.nutritionMax, 147696);
});
test("food category is mounts", () => {
  assert.strictEqual(meta.foodCategory, "mounts");
  assert.strictEqual(meta.foodType, "Mounts");
});
test("every other T8 baby still uses the tier ladder", () => {
  const cow = getBreedingMeta({ babyId: "T8_FARM_COW_BABY", grownId: "T8_FARM_COW_GROWN" });
  assert.strictEqual(cow.foodCategory, "plants");
  const bear = getBreedingMeta({ babyId: "T8_FARM_DIREBEAR_BABY", grownId: "T8_FARM_DIREBEAR_GROWN" });
  assert.strictEqual(bear.foodCategory, "meat");
  assert.strictEqual(bear.growHours, 284);
  assert.strictEqual(bear.nutritionMax, 19728);
});

console.log("\n=== Mount feed: nutrition is per tier, so cost is per nutrition point ===");
test("the mounts food list exists and every id is a real mount", () => {
  const ids = FOOD_ITEMS.mounts;
  assert.ok(Array.isArray(ids) && ids.length > 0, "FOOD_ITEMS.mounts is empty");
  for (const id of ids) {
    assert.ok(/^T[3-8]_MOUNT_/.test(id), "bad feed mount id " + id);
    assert.ok(ITEMS_XML.includes('uniquename="' + id + '"'), id + " is not a real id");
  }
});
test("mount nutrition table matches items.xml", () => {
  assert.deepStrictEqual(MOUNT_FEED_NUTRITION,
    { 3: 170, 4: 583, 5: 1859, 6: 5905, 7: 18699, 8: 59049 });
  for (const [tier, nutrition] of Object.entries(MOUNT_FEED_NUTRITION)) {
    const tag = ITEMS_XML.match(
      new RegExp('<mount uniquename="T' + tier + '_MOUNT_HORSE"[^>]*>')
    );
    assert.ok(tag, "T" + tier + "_MOUNT_HORSE missing");
    assert.ok(tag[0].includes('nutrition="' + nutrition + '"'),
      "T" + tier + " horse nutrition is not " + nutrition);
  }
});
test("the scan fetches the feed mounts", () => {
  const ids = new Set(getBreedingFeedIds());
  for (const id of FOOD_ITEMS.mounts) {
    assert.ok(ids.has(id), id + " is not in the breeding feed scan list");
  }
});

test("cheapest feed is chosen per nutrition point, not per animal", () => {
  // A T8 horse at 4 000 000 is 67.7 silver/nutrition; a T3 horse at 20 000 is
  // 117.6. The T8 costs 200× more per animal and is still the right buy.
  const marketData = {
    T3_MOUNT_HORSE: { Martlock: { sell_price: 20000 } },
    T8_MOUNT_HORSE: { Martlock: { sell_price: 4000000 } },
  };
  const feed = findCheapestFeed(marketData, "mounts", ["Martlock"], "Martlock",
    meta.piecesNeeded, meta.tier, meta.nutritionMax);
  assert.strictEqual(feed.id, "T8_MOUNT_HORSE", "picked " + feed.id);
  assert.ok(Math.abs(feed.silverPerNutrition - 4000000 / 59049) < 1e-6);
});

test("pieces needed follow the mount actually picked", () => {
  const marketData = { T3_MOUNT_HORSE: { Martlock: { sell_price: 100 } } };
  const feed = findCheapestFeed(marketData, "mounts", ["Martlock"], "Martlock",
    meta.piecesNeeded, meta.tier, meta.nutritionMax);
  assert.strictEqual(feed.id, "T3_MOUNT_HORSE");
  assert.strictEqual(feed.pieces, Math.ceil(147696 / 170));
  assert.strictEqual(feed.totalCost, Math.ceil(147696 / 170) * 100);
});

test("crops and meat still price exactly as before", () => {
  // Uniform nutrition ⇒ cheapest per point is cheapest per piece; the ranking
  // change must not move any existing row.
  const marketData = {
    T1_CARROT: { Martlock: { sell_price: 300 } },
    T8_PUMPKIN: { Martlock: { sell_price: 100 } },
  };
  const cow = getBreedingMeta({ babyId: "T8_FARM_COW_BABY", grownId: "T8_FARM_COW_GROWN" });
  const feed = findCheapestFeed(marketData, "plants", ["Martlock"], "Martlock",
    cow.piecesNeeded, cow.tier, cow.nutritionMax);
  assert.strictEqual(feed.id, "T8_PUMPKIN");
  assert.strictEqual(feed.pieces, cow.piecesNeeded);
  assert.strictEqual(feed.totalCost, cow.piecesNeeded * 100);
});

test("no feed data anywhere still returns a tier-matched placeholder", () => {
  const feed = findCheapestFeed({}, "mounts", ["Martlock"], "Martlock",
    meta.piecesNeeded, meta.tier, meta.nutritionMax);
  assert.ok(feed, "a no-data row must still render an editable feed cell");
  assert.strictEqual(feed.hasData, false);
  assert.strictEqual(feed.price, 0);
  assert.strictEqual(feed.city, "Martlock");
  assert.strictEqual(feed.id, "T8_MOUNT_HORSE", "should fall back to the drake's own tier");
});

console.log("\n" + "=".repeat(50));
console.log("Total: " + (passed + failed) + " | Passed: " + passed + " | Failed: " + failed);
if (failed > 0) process.exit(1);
