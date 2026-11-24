/**
 * Test: js/buildings-furnishing.js — the laborer-slot allocator.
 *
 * Black-box: feed a slot budget and a price lookup in, assert the plan that
 * comes out. Loads the REAL js/data-buildings.js catalog (generated from
 * items.xml) so the rules under test — a bed serves 1 laborer, a table 4 below
 * T5 and 6 from T5 up, a trophy 3 — are the ones the app ships rather than
 * numbers restated here.
 *
 * The bug this guards: the old model treated a furniture slot as generic and
 * filled all 70 of a guild hall's slots with whichever single item was cheapest,
 * rendering "70x <bed>" for 15 laborers.
 *
 * Run: node tests/buildings-furnishing.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
function loadFile(rel) { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }

const mod = new Module("buildings-furnishing-test");
mod._compile(
  loadFile("js/data-buildings.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/buildings-furnishing.js").replace(/if \(typeof module[\s\S]*$/, "") +
    "\nmodule.exports = { planFurnishing, BUILDINGS, BUILDING_LABORER_FURNITURE, " +
    "getBuildingFurnitureByType, getTrophySlugForLaborer, getTrophyLineName, " +
    "formatTierRange };",
  "buildings-furnishing.js",
);
const { planFurnishing, BUILDINGS, 
  getBuildingFurnitureByType, getTrophySlugForLaborer, getTrophyLineName,
  formatTierRange } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// Flat price for everything — the plan's shape must not depend on prices.
const flat = (p = 1000) => () => ({ price: p, city: "Martlock" });

// Price by id so cheapest-first ordering can be steered.
const byId = (map, fallback = 1000) => (id) =>
  ({ price: map[id] !== undefined ? map[id] : fallback, city: "Martlock" });

function planFor(buildingId, opts = {}) {
  const b = BUILDINGS.find((x) => x.id === buildingId);
  assert.ok(b, `${buildingId} not in the catalog`);
  return planFurnishing({
    tier: b.tier,
    laborers: opts.laborers !== undefined ? opts.laborers : b.laborerSlots,
    furnitureSlots: opts.furnitureSlots !== undefined ? opts.furnitureSlots : b.furnitureSlots,
    laborerSlug: opts.laborerSlug || "WOOD",
    priceOf: opts.priceOf || flat(),
  });
}

const slotted = BUILDINGS.filter((b) => b.laborerSlots > 0 && b.furnitureSlots > 0);
const totalTrophies = (plan) => plan.trophies.reduce((s, t) => s + t.copies, 0);

// ── Beds and tables ────────────────────────────────────────────────────────
console.log("\n=== Beds and tables ===");

test("one bed per laborer, for every building with slots", () => {
  assert.ok(slotted.length >= 14, `expected houses + guild halls, got ${slotted.length}`);
  slotted.forEach((b) => {
    const plan = planFor(b.id);
    assert.strictEqual(plan.beds.count, b.laborerSlots,
      `${b.id}: ${plan.beds.count} beds for ${b.laborerSlots} laborers`);
  });
});

test("the bed and table are the building's OWN tier — they set base happiness", () => {
  slotted.forEach((b) => {
    assert.strictEqual(plan_tier(planFor(b.id).beds.id), b.tier, `${b.id}: bed tier`);
    assert.strictEqual(plan_tier(planFor(b.id).tables.id), b.tier, `${b.id}: table tier`);
  });
  function plan_tier(id) { return parseInt(id.match(/^T(\d)_/)[1], 10); }
});

test("table count honours the per-item split items.xml states, not a flat 6", () => {
  slotted.forEach((b) => {
    const table = getBuildingFurnitureByType("table", b.tier)[0];
    const expected = Math.ceil(b.laborerSlots / table.perItem);
    assert.strictEqual(planFor(b.id).tables.count, expected,
      `${b.id}: ${planFor(b.id).tables.count} tables, expected ceil(${b.laborerSlots}/${table.perItem})`);
  });
});

test("the T2-T4 table serves 4 laborers and the T5+ table serves 6", () => {
  // The forum's "1 table per 6 laborers" is only true from T5 up; below that a
  // 10-laborer guild hall needs 3 tables, not 2.
  assert.strictEqual(planFurnishing({
    tier: 3, laborers: 10, furnitureSlots: 35, laborerSlug: "WOOD", priceOf: flat(),
  }).tables.count, 3);
  assert.strictEqual(planFurnishing({
    tier: 5, laborers: 12, furnitureSlots: 70, laborerSlug: "WOOD", priceOf: flat(),
  }).tables.count, 2);
});

test("no laborers means no beds, no tables and no trophies", () => {
  const plan = planFurnishing({
    tier: 8, laborers: 0, furnitureSlots: 14, laborerSlug: "WOOD", priceOf: flat(),
  });
  assert.strictEqual(plan.beds.count, 0);
  assert.strictEqual(plan.tables.count, 0);
  assert.strictEqual(plan.trophies.length, 0);
  assert.strictEqual(plan.furnitureCost, 0);
});

// ── Trophies ───────────────────────────────────────────────────────────────
console.log("\n=== Trophies ===");

test("no plan holds a trophy above the building's own tier", () => {
  // A building holds furniture of its own tier or lower and nothing above, so a
  // plan naming a T8 trophy for a T6 house is naming an item that cannot be
  // placed. See wiki.albiononline.com/wiki/House — the rule is not in the dumps.
  slotted.forEach((b) => {
    planFor(b.id).trophies.forEach((t) =>
      assert.ok(t.tier <= b.tier, `${b.id} (T${b.tier}) was given ${t.id}`));
  });
});

test("the cap is a no-op at T8 — the whole ladder is legal there", () => {
  const plan = planFurnishing({
    tier: 8, laborers: 1, furnitureSlots: 100, laborerSlug: "WOOD", priceOf: flat(),
  });
  assert.strictEqual(plan.trophies.length, 14, "7 specialist tiers + 7 general");
});

test("a lower tier offers strictly fewer distinct trophies", () => {
  // Slots are held constant at a T8 house's 14 so only the tier window moves.
  const distinct = (tier) => planFurnishing({
    tier, laborers: 3, furnitureSlots: 14, laborerSlug: "WOOD", priceOf: flat(),
  }).trophies.length;
  assert.strictEqual(distinct(2), 2, "T2: one specialist + one general");
  assert.strictEqual(distinct(4), 6);
  assert.strictEqual(distinct(6), 10, "T2-T6 of both lines fills all 10 slots");
  assert.strictEqual(distinct(8), 10, "slots, not tiers, are the binding limit here");
});

test("every trophy in a plan is a DISTINCT item — happiness only stacks that way", () => {
  slotted.forEach((b) => {
    const ids = planFor(b.id).trophies.map((t) => t.id);
    assert.strictEqual(new Set(ids).size, ids.length, `${b.id}: repeated trophy id`);
  });
});

test("each distinct trophy is bought ceil(laborers/3) times to cover the crew", () => {
  slotted.forEach((b) => {
    const perItem = getBuildingFurnitureByType("trophy", b.tier)[0].perItem;
    const copies = Math.ceil(b.laborerSlots / perItem);
    planFor(b.id).trophies.forEach((t) =>
      assert.strictEqual(t.copies, copies, `${b.id}: ${t.id} bought ${t.copies}x, expected ${copies}x`));
  });
});

test("specialist trophies are taken before generals — +10 beats +5 per slot", () => {
  const plan = planFor("T8_PLAYERHOUSE", { laborerSlug: "WOOD" });
  const specialists = plan.trophies.filter((t) => /_TROPHY_WOOD$/.test(t.id));
  const generals = plan.trophies.filter((t) => /_TROPHY_GENERAL$/.test(t.id));
  assert.strictEqual(specialists.length, 7, "all 7 specialist tiers should fit first");
  assert.ok(generals.length > 0, "leftover slots should go to generals");
  const firstGeneral = plan.trophies.findIndex((t) => /_TROPHY_GENERAL$/.test(t.id));
  const lastSpecialist = plan.trophies.reduce(
    (acc, t, i) => (/_TROPHY_WOOD$/.test(t.id) ? i : acc), -1);
  assert.ok(lastSpecialist < firstGeneral, "specialists must be ordered ahead of generals");
});

test("within a group the cheapest tiers are taken first — happiness is tier-flat", () => {
  // Only 3 specialist tiers can fit, so the plan must pick the 3 cheapest.
  const prices = {
    T2_FURNITUREITEM_TROPHY_WOOD: 900, T3_FURNITUREITEM_TROPHY_WOOD: 100,
    T4_FURNITUREITEM_TROPHY_WOOD: 800, T5_FURNITUREITEM_TROPHY_WOOD: 200,
    T6_FURNITUREITEM_TROPHY_WOOD: 700, T7_FURNITUREITEM_TROPHY_WOOD: 300,
    T8_FURNITUREITEM_TROPHY_WOOD: 600,
  };
  const plan = planFurnishing({
    tier: 8, laborers: 1, furnitureSlots: 5, laborerSlug: "WOOD", priceOf: byId(prices, 5000),
  });
  // 1 bed + 1 table = 2 slots, 3 left.
  const picked = plan.trophies.map((t) => t.id);
  assert.deepStrictEqual(picked, [
    "T3_FURNITUREITEM_TROPHY_WOOD",
    "T5_FURNITUREITEM_TROPHY_WOOD",
    "T7_FURNITUREITEM_TROPHY_WOOD",
  ], `picked ${picked.join(", ")}`);
});

test("an unpriced trophy tier is skipped, not counted as free", () => {
  const priceOf = (id) => (/_TROPHY_WOOD$/.test(id) && !/^T8_/.test(id)
    ? { price: 0, city: null }
    : { price: 1000, city: "Martlock" });
  const plan = planFurnishing({
    tier: 8, laborers: 1, furnitureSlots: 14, laborerSlug: "WOOD", priceOf,
  });
  const wood = plan.trophies.filter((t) => /_TROPHY_WOOD$/.test(t.id));
  assert.strictEqual(wood.length, 1, "only the priced specialist tier is buyable");
  assert.strictEqual(wood[0].id, "T8_FURNITUREITEM_TROPHY_WOOD");
  assert.ok(plan.trophies.every((t) => t.price > 0), "nothing unpriced may enter the plan");
});

test("the trophy line follows the laborer, with the slug mismatches honoured", () => {
  // The Stonecutter's contract slug is STONE but its trophy is ROCK; the
  // Fisherman's is FISHERMAN / FISH.
  assert.strictEqual(getTrophySlugForLaborer("STONE"), "ROCK");
  assert.strictEqual(getTrophySlugForLaborer("FISHING"), "FISH");
  assert.strictEqual(getTrophySlugForLaborer("WOOD"), "WOOD");
  assert.strictEqual(getTrophySlugForLaborer("MERCENARY"), "MERCENARY");
  const rock = planFor("T8_PLAYERHOUSE", { laborerSlug: "STONE" });
  assert.ok(rock.trophies.some((t) => t.id.endsWith("_TROPHY_ROCK")), "expected Rock Trophies");
  assert.ok(!rock.trophies.some((t) => t.id.endsWith("_TROPHY_STONE")), "TROPHY_STONE is not an item");
  const fish = planFor("T8_PLAYERHOUSE", { laborerSlug: "FISHING" });
  assert.ok(fish.trophies.some((t) => t.id.endsWith("_TROPHY_FISH")), "expected Fish Trophies");
});

test("an unknown laborer slug still yields a valid plan, generals only", () => {
  const plan = planFor("T8_PLAYERHOUSE", { laborerSlug: "NOT_A_LABORER" });
  assert.strictEqual(plan.beds.count, 3);
  assert.ok(plan.trophies.every((t) => t.id.endsWith("_TROPHY_GENERAL")));
});

// ── Slot budget ────────────────────────────────────────────────────────────
console.log("\n=== Slot budget ===");

test("no plan ever exceeds the building's furniture limit", () => {
  slotted.forEach((b) => {
    const plan = planFor(b.id);
    assert.ok(plan.slotsUsed <= b.furnitureSlots,
      `${b.id}: used ${plan.slotsUsed} of ${b.furnitureSlots} slots`);
    assert.strictEqual(plan.slotsUsed, plan.beds.count + plan.tables.count + totalTrophies(plan),
      `${b.id}: slotsUsed does not match the items in the plan`);
    assert.strictEqual(plan.slotsSpare, b.furnitureSlots - plan.slotsUsed, `${b.id}: slotsSpare`);
  });
});

test("beds and tables always fit — they are mandatory, trophies are not", () => {
  slotted.forEach((b) => {
    const plan = planFor(b.id);
    assert.ok(plan.beds.count + plan.tables.count <= b.furnitureSlots,
      `${b.id}: mandatory furniture alone overflows the slot limit`);
    assert.ok(plan.bedsAndTablesFit, `${b.id}: expected the mandatory furniture to fit`);
  });
});

test("trophies are dropped whole-block, never part-covering the crew", () => {
  // 3 laborers need 1 copy each; 15 need 5. A budget that cannot hold a full
  // block must take no trophy at all rather than an uncovered partial one.
  const plan = planFurnishing({
    tier: 8, laborers: 15, furnitureSlots: 20, laborerSlug: "WOOD", priceOf: flat(),
  });
  assert.strictEqual(plan.beds.count, 15);
  assert.strictEqual(plan.tables.count, 3);      // ceil(15/6)
  assert.strictEqual(plan.trophies.length, 0, "2 spare slots cannot cover 15 laborers");
  assert.strictEqual(plan.slotsSpare, 2);
});

test("a slot budget too small even for beds reports the overflow instead of lying", () => {
  const plan = planFurnishing({
    tier: 8, laborers: 15, furnitureSlots: 5, laborerSlug: "WOOD", priceOf: flat(),
  });
  assert.strictEqual(plan.bedsAndTablesFit, false);
  assert.strictEqual(plan.trophies.length, 0);
});

// ── The reported real-world plans ──────────────────────────────────────────
console.log("\n=== Real buildings ===");

test("T8 House: 3 beds + 1 table + 10 trophies = 85/100 happiness, 0 spare", () => {
  const plan = planFor("T8_PLAYERHOUSE");
  assert.strictEqual(plan.beds.count, 3);
  assert.strictEqual(plan.tables.count, 1);
  assert.strictEqual(plan.trophies.length, 10, "10 distinct trophies, 1 copy each");
  assert.strictEqual(totalTrophies(plan), 10);
  assert.strictEqual(plan.trophyHappiness, 85, "7 specialist (+70) + 3 general (+15)");
  assert.strictEqual(plan.slotsUsed, 14);
  assert.strictEqual(plan.slotsSpare, 0);
});

test("T8 Guild Hall: 15 beds + 3 tables + 10 distinct x5 = 85/100, 2 spare", () => {
  const plan = planFor("T8_GUILDHALL");
  assert.strictEqual(plan.beds.count, 15);
  assert.strictEqual(plan.tables.count, 3);
  assert.strictEqual(plan.trophies.length, 10);
  assert.strictEqual(totalTrophies(plan), 50);
  assert.strictEqual(plan.trophyHappiness, 85);
  assert.strictEqual(plan.slotsUsed, 68);
  assert.strictEqual(plan.slotsSpare, 2);
});

test("T6 House: 10 trophies, none above T6 = 75/100, 0 spare", () => {
  // The reported bug: 14 slots less 3 beds and a table leave 10 trophy slots,
  // and the plan used to fill them with the cheapest tiers of the whole T2-T8
  // ladder — T7s and T8s a T6 house cannot hold. Capped, the T2-T6 window offers
  // exactly 5 specialist + 5 general, so the slots fill and the score is honest.
  const plan = planFor("T6_PLAYERHOUSE");
  assert.strictEqual(plan.beds.count, 3);
  assert.strictEqual(plan.tables.count, 1);
  assert.strictEqual(plan.trophies.length, 10);
  assert.ok(plan.trophies.every((t) => t.tier <= 6),
    `T7/T8 trophies in a T6 house: ${plan.trophies.map((t) => t.id).join(", ")}`);
  assert.strictEqual(plan.trophyHappiness, 75, "5 specialist (+50) + 5 general (+25)");
  assert.strictEqual(plan.slotsSpare, 0);
});

test("T2 House: 1 bed + 1 table + 2 trophies = 15/100, 1 spare", () => {
  // Only the T2 rung of each line exists for a T2 house, so a spare slot is left
  // over with nothing legal to put in it.
  const plan = planFor("T2_PLAYERHOUSE");
  assert.strictEqual(plan.beds.count, 1);
  assert.strictEqual(plan.tables.count, 1);
  assert.strictEqual(plan.trophies.length, 2);
  assert.deepStrictEqual(plan.trophies.map((t) => t.id), [
    "T2_FURNITUREITEM_TROPHY_WOOD",
    "T2_FURNITUREITEM_TROPHY_GENERAL",
  ]);
  assert.strictEqual(plan.trophyHappiness, 15, "1 specialist (+10) + 1 general (+5)");
  assert.strictEqual(plan.slotsSpare, 1);
});

test("T2 Guild Hall: 25 slots buy no more than the two T2 trophies", () => {
  // A big low-tier building is slot-rich and tier-poor: 7 laborers need 3 copies
  // of each distinct trophy, and only two distinct trophies are legal at all.
  const plan = planFor("T2_GUILDHALL");
  assert.strictEqual(plan.beds.count, 7);
  assert.strictEqual(plan.tables.count, 2);      // ceil(7/4)
  assert.strictEqual(plan.trophies.length, 2);
  assert.ok(plan.trophies.every((t) => t.tier === 2 && t.copies === 3));
  assert.strictEqual(plan.trophyHappiness, 15);
  assert.strictEqual(plan.slotsUsed, 15);
  assert.strictEqual(plan.slotsSpare, 10, "slots a T2 hall simply cannot use");
});

test("nothing renders 70 of one item any more", () => {
  const plan = planFor("T8_GUILDHALL");
  const counts = [plan.beds.count, plan.tables.count, ...plan.trophies.map((t) => t.copies)];
  assert.ok(Math.max(...counts) <= 15, `a single item is bought ${Math.max(...counts)}x`);
});

// ── Happiness ──────────────────────────────────────────────────────────────
console.log("\n=== Happiness ===");

test("trophy happiness is capped at 100 however many trophies fit", () => {
  const plan = planFurnishing({
    tier: 8, laborers: 1, furnitureSlots: 100, laborerSlug: "WOOD", priceOf: flat(),
  });
  // 7 specialist (+70) + 7 general (+35) = 105 raw.
  assert.strictEqual(plan.trophies.length, 14, "every distinct trophy of the line fits");
  assert.strictEqual(plan.trophyHappiness, 100, "the bonus is capped at 100");
});

test("happiness is the sum of the DISTINCT trophies taken, not of the copies", () => {
  // 15 laborers, 5 copies of each: happiness must not multiply by 5.
  const plan = planFor("T8_GUILDHALL");
  assert.strictEqual(plan.trophyHappiness, 85);
});

test("base happiness comes from the bed and table alone — 100x tier", () => {
  const plan = planFor("T8_PLAYERHOUSE");
  assert.strictEqual(plan.baseHappiness, 800, "T8 bed 400 + T8 table 400");
  assert.strictEqual(planFor("T2_PLAYERHOUSE").baseHappiness, 200);
});

// ── Cost ───────────────────────────────────────────────────────────────────
console.log("\n=== Cost ===");

test("furnitureCost totals every item at its own price", () => {
  const plan = planFor("T8_GUILDHALL", { priceOf: flat(1000) });
  assert.strictEqual(plan.furnitureCost, plan.slotsUsed * 1000);
});

test("cost follows the per-item price, not one blended figure", () => {
  const prices = { T8_FURNITUREITEM_BED: 450000, T8_FURNITUREITEM_TABLE: 380000 };
  const plan = planFor("T8_PLAYERHOUSE", { priceOf: byId(prices, 2000) });
  const expected = 3 * 450000 + 1 * 380000 + 10 * 2000;
  assert.strictEqual(plan.furnitureCost, expected);
});

test("allPriced is false when a mandatory item has no market", () => {
  const priceOf = (id) => (/_BED$/.test(id) ? { price: 0, city: null } : { price: 1000, city: "M" });
  const plan = planFor("T8_PLAYERHOUSE", { priceOf });
  assert.strictEqual(plan.allPriced, false, "an unpriced bed must blank the fitted row");
  assert.strictEqual(planFor("T8_PLAYERHOUSE").allPriced, true);
});

test("every id in a plan is a real game id", () => {
  slotted.forEach((b) => {
    const plan = planFor(b.id);
    [plan.beds.id, plan.tables.id, ...plan.trophies.map((t) => t.id)].forEach((id) =>
      assert.ok(/^T[1-8]_FURNITUREITEM_[A-Z_]+$/.test(id), `suspicious id: ${id}`));
  });
});

// ── Labels ─────────────────────────────────────────────────────────────────
console.log("\n=== Labels ===");

test("a trophy group is named after its LINE, not after one tier's item name", () => {
  // The Wood Trophy ladder's tiers have unrelated names (Birch Bonsai at T2),
  // so borrowing the cheapest tier's name labelled the whole group wrongly.
  assert.strictEqual(getTrophyLineName("T2_FURNITUREITEM_TROPHY_WOOD"), "Wood Trophy");
  assert.strictEqual(getTrophyLineName("T8_FURNITUREITEM_TROPHY_GENERAL"), "General Trophy");
  assert.strictEqual(getTrophyLineName("T5_FURNITUREITEM_TROPHY_MERCENARY"), "Mercenary Trophy");
  // The Stonecutter's trophy is TROPHY_ROCK ("Rock Trophy") even though the
  // laborer slug is STONE — the name follows the item, never the laborer.
  assert.strictEqual(getTrophyLineName("T8_FURNITUREITEM_TROPHY_ROCK"), "Rock Trophy");
  assert.strictEqual(getTrophyLineName("T8_FURNITUREITEM_TROPHY_FISH"), "Fish Trophy");
});

test("the line name matches TROPHY_LABORERS, so both code paths agree", () => {
  // getTrophyLineName prefers that catalog when it is loaded and derives the
  // name otherwise; the two must not disagree.
  const laborers = new Module("trophy-names");
  laborers._compile(loadFile("js/data-laborers.js"), "data-laborers.js");
  laborers.exports.TROPHY_LABORERS.forEach((line) => {
    const id = `T8_FURNITUREITEM_TROPHY_${line.trophySlug}`;
    assert.strictEqual(getTrophyLineName(id), line.name, `${id} derives a different name`);
  });
});

test("contiguous tiers render as a range, scattered tiers are listed", () => {
  // The plan buys the CHEAPEST tiers, so the picks are often not contiguous and
  // a range label would claim tiers that were never bought.
  assert.strictEqual(formatTierRange([2, 3, 4, 5, 6, 7, 8]), "T2–T8");
  assert.strictEqual(formatTierRange([2, 3, 4]), "T2–T4");
  assert.strictEqual(formatTierRange([8]), "T8");
  assert.strictEqual(formatTierRange([3, 5, 7]), "T3 T5 T7");
  assert.strictEqual(formatTierRange([7, 3, 5]), "T3 T5 T7", "unsorted input still sorts");
  assert.strictEqual(formatTierRange([]), "");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
