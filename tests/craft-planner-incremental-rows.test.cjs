/**
 * Test: the Crafting Planner recomputes only the rows a captured price moved.
 *
 * Reported: a price the sniffer captured did not show in the Crafting Planner
 * until the table was updated by hand. The planner is the app's longest
 * renderer (seconds on a real price map); recomputing every row for every
 * captured patch is what kept it behind the capture stream.
 *
 * js/craft-planner-row-cache.js remembers, per catalogue item, the rows it
 * built and every price-map id those rows READ (a recording view over the map,
 * plus ids reported through recordPriceDependency for reads that bypass it). A
 * data-refresh pass then recomputes exactly the items whose ids moved.
 *
 * Pinned, black box:
 *   1. a full pass records each item's dependencies;
 *   2. a refresh recomputes only items that read a moved id, and reuses the
 *      other items' row objects untouched;
 *   3. a moved id nobody read recomputes nothing;
 *   4. no cache yet, no moved-id list, or changed settings → full recompute;
 *   5. ids reported through recordPriceDependency count as read;
 *   6. the result equals a full recompute over the same data;
 *   7. nothing is committed until the caller commits (a cancelled pass leaves
 *      the old cache in place).
 *
 * Run: node tests/craft-planner-incremental-rows.test.cjs
 */

const assert = require("assert");
const {
  createPlannerRowCache, plannerRowsWithCache, commitPlannerRowCache, recordPriceDependency,
} = require("../js/craft-planner-row-cache.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// Three items: a table eats planks, a staff eats planks + an artifact, a bag
// eats leather and prices its journal through recordPriceDependency (the way
// the journal-fame cache reports a hit).
const ITEMS = [
  { id: "T8_TABLE", mats: ["T8_PLANKS"] },
  { id: "T8_STAFF", mats: ["T8_PLANKS", "T8_ARTEFACT"] },
  { id: "T8_BAG", mats: ["T8_LEATHER"], journal: "T8_JOURNAL_FULL" },
];

function market() {
  return {
    T8_PLANKS: { FS: { buy_price: 1000 } },
    T8_ARTEFACT: { FS: { buy_price: 50000 } },
    T8_LEATHER: { FS: { buy_price: 900 } },
    T8_TABLE: { FS: { sell_price: 60000 } },
    T8_STAFF: { FS: { sell_price: 900000 } },
    T8_BAG: { FS: { sell_price: 40000 } },
    T8_JOURNAL_FULL: { FS: { sell_price: 20000 } },
    UNRELATED: { FS: { sell_price: 1 } },
  };
}

/** A stand-in for _cpRowsForItem: one row per item, priced off the map. */
function makeCompute(calls) {
  return (item, md) => {
    calls.push(item.id);
    const cost = item.mats.reduce((s, m) => s + ((md[m] && md[m].FS.buy_price) || 0), 0);
    if (item.journal) recordPriceDependency(item.journal);
    const sell = (md[item.id] && md[item.id].FS.sell_price) || 0;
    return [{ item, profit: sell - cost }];
  };
}

function fullPass(cache, md, settings = "S") {
  const calls = [];
  const r = plannerRowsWithCache(ITEMS, md, makeCompute(calls), { cache, dirtyIds: null, settings });
  commitPlannerRowCache(cache, r);
  return { r, calls };
}

console.log("Planner incremental rows\n");

test("1. a full pass computes every item and records its dependencies", () => {
  const cache = createPlannerRowCache();
  const { r, calls } = fullPass(cache, market());
  assert.deepStrictEqual(calls, ["T8_TABLE", "T8_STAFF", "T8_BAG"]);
  assert.strictEqual(r.rows.length, 3);
  assert.ok(cache.entries.get("T8_STAFF").deps.has("T8_ARTEFACT"));
  assert.ok(cache.entries.get("T8_TABLE").deps.has("T8_TABLE"), "its own sell price is a dependency");
});

// [moved ids, items that must recompute]
[
  [["T8_PLANKS"], ["T8_TABLE", "T8_STAFF"]],
  [["T8_ARTEFACT"], ["T8_STAFF"]],
  [["T8_BAG"], ["T8_BAG"]],
  [["T8_JOURNAL_FULL"], ["T8_BAG"]],             // 5. reported, not proxied
  [["UNRELATED"], []],                            // 3.
  [["T8_LEATHER", "T8_ARTEFACT"], ["T8_STAFF", "T8_BAG"]],
].forEach(([moved, expect]) => {
  test(`2. moving ${moved.join("+")} recomputes ${expect.join("+") || "nothing"}`, () => {
    const cache = createPlannerRowCache();
    const md = market();
    const first = fullPass(cache, md).r;
    const calls = [];
    const r = plannerRowsWithCache(ITEMS, md, makeCompute(calls), { cache, dirtyIds: moved, settings: "S" });
    assert.deepStrictEqual(calls, expect);
    // Untouched items hand back the very same row objects.
    ITEMS.forEach((item, i) => {
      if (!expect.includes(item.id)) assert.strictEqual(r.rows[i], first.rows[i], `${item.id} was rebuilt`);
    });
  });
});

test("6. an incremental result equals a full recompute over the same data", () => {
  const cache = createPlannerRowCache();
  const md = market();
  fullPass(cache, md);
  md.T8_PLANKS.FS.buy_price = 5000;
  const inc = plannerRowsWithCache(ITEMS, md, makeCompute([]), { cache, dirtyIds: ["T8_PLANKS"], settings: "S" });
  const full = plannerRowsWithCache(ITEMS, md, makeCompute([]), { cache: createPlannerRowCache(), dirtyIds: null, settings: "S" });
  assert.deepStrictEqual(inc.rows.map((r) => r.profit), full.rows.map((r) => r.profit));
});

[
  ["no cache yet", (cache) => cache, ["T8_PLANKS"], "S"],
  ["no moved-id list (a gesture)", (cache, md) => { fullPass(cache, md); return cache; }, null, "S"],
  ["settings changed since the cache was built", (cache, md) => { fullPass(cache, md, "S"); return cache; }, ["T8_PLANKS"], "S2"],
].forEach(([name, prep, moved, settings]) => {
  test(`4. ${name} → full recompute`, () => {
    const md = market();
    const cache = prep(createPlannerRowCache(), md);
    const calls = [];
    plannerRowsWithCache(ITEMS, md, makeCompute(calls), { cache, dirtyIds: moved, settings });
    assert.deepStrictEqual(calls, ["T8_TABLE", "T8_STAFF", "T8_BAG"]);
  });
});

test("4b. an item new to the catalogue is computed even on a refresh", () => {
  const cache = createPlannerRowCache();
  const md = market();
  fullPass(cache, md);
  const calls = [];
  const more = [...ITEMS, { id: "T8_CHAIR", mats: ["T8_PLANKS"] }];
  plannerRowsWithCache(more, md, makeCompute(calls), { cache, dirtyIds: ["UNRELATED"], settings: "S" });
  assert.deepStrictEqual(calls, ["T8_CHAIR"]);
});

test("7. an uncommitted pass leaves the previous cache as it was", () => {
  const cache = createPlannerRowCache();
  const md = market();
  const first = fullPass(cache, md).r;
  md.T8_PLANKS.FS.buy_price = 5000;
  plannerRowsWithCache(ITEMS, md, makeCompute([]), { cache, dirtyIds: ["T8_PLANKS"], settings: "S" });
  assert.strictEqual(cache.entries.get("T8_TABLE").rows[0], first.rows[0]);
});

test("7b. invalidating the cache forces the next refresh to recompute everything", () => {
  const cache = createPlannerRowCache();
  const md = market();
  fullPass(cache, md);
  cache.valid = false;
  const calls = [];
  plannerRowsWithCache(ITEMS, md, makeCompute(calls), { cache, dirtyIds: ["UNRELATED"], settings: "S" });
  assert.strictEqual(calls.length, 3);
});

test("the recording view reads through to the real map", () => {
  const cache = createPlannerRowCache();
  const md = market();
  let seen = null;
  plannerRowsWithCache([ITEMS[0]], md, (item, view) => {
    seen = view.T8_PLANKS;
    return [{ item, has: "T8_PLANKS" in view }];
  }, { cache, dirtyIds: null, settings: "S" });
  assert.strictEqual(seen, md.T8_PLANKS, "the same cell object, not a copy");
});

test("recordPriceDependency outside a recording is a no-op", () => {
  assert.doesNotThrow(() => recordPriceDependency("T8_PLANKS"));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
