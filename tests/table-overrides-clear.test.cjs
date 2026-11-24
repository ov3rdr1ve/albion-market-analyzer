/**
 * Black-box tests for the per-table "Clear overrides" button
 * (js/table-overrides.js).
 *
 * The feature: each table's header grows a ↺ Clear button that wipes the
 * manually entered prices, volumes and pinned buy/sell cities for THAT table's
 * items only — the header's Clear Settings button is all-or-nothing, which is
 * why nobody used it. "That table's items" = the ids on its rows' data-row-key
 * plus the data-item-id of every editable cell it renders.
 *
 * The counting/clearing functions take the three stores as arguments, so these
 * are pure input→output assertions — no globals, no localStorage, no DOM except
 * a hand-built one for tableItemIds.
 *
 * Run: node tests/table-overrides-clear.test.cjs
 */

const assert = require("assert");
const {
  keyBelongsTo,
  countTableOverrides,
  clearTableOverrides,
  tableItemIds,
} = require("../js/table-overrides.js");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

/** The three manual stores in the shapes utils.js persists. */
function makeStores() {
  return {
    prices: {
      T4_ORE: { Thetford: { buyOrder: 100, use: "buy" }, Caerleon: { sellOrder: 120, use: "sell" } },
      T4_METALBAR: { Thetford: { buyOrder: 400, use: "buy" } },
      "T6_2H_BOW#Q3": { Lymhurst: { sellOrder: 90000, use: "sell" } },
      T8_HIDE: { Martlock: { buyOrder: 900, use: "buy" } },
    },
    volumes: {
      T4_ORE: { Thetford: { volume: 5000 } },
      T8_HIDE: { Martlock: { volume: 100 } },
    },
    cityForces: {
      T4_ORE: { buy: "Thetford", sell: "Caerleon" },
      T8_HIDE: { sell: "Martlock" },
    },
  };
}

console.log("Per-table Clear Overrides Tests\n");

// ── which stored keys belong to a table ──────────────────────────────────────

test("an exact id belongs to itself", () => {
  assert.strictEqual(keyBelongsTo("T4_ORE", new Set(["T4_ORE"])), true);
});

test("a quality-rerolling key belongs to its base item", () => {
  assert.strictEqual(keyBelongsTo("T6_2H_BOW#Q3", new Set(["T6_2H_BOW"])), true);
});

test("an unrelated id does not belong", () => {
  assert.strictEqual(keyBelongsTo("T4_PLANKS", new Set(["T4_ORE"])), false);
  assert.strictEqual(keyBelongsTo("T6_2H_BOW#Q3", new Set(["T6_2H_CROSSBOW"])), false);
});

// ── counting ─────────────────────────────────────────────────────────────────

test("counts one per (item, city) price, volume and pinned side", () => {
  // T4_ORE: 2 prices + 1 volume + 2 pins = 5
  assert.strictEqual(countTableOverrides(new Set(["T4_ORE"]), makeStores()), 5);
});

test("a quality key is counted against the base item", () => {
  assert.strictEqual(countTableOverrides(new Set(["T6_2H_BOW"]), makeStores()), 1);
});

test("ids with nothing stored count zero", () => {
  assert.strictEqual(countTableOverrides(new Set(["T3_PLANKS"]), makeStores()), 0);
});

test("counting never mutates the stores", () => {
  const stores = makeStores();
  countTableOverrides(new Set(["T4_ORE"]), stores);
  assert.deepStrictEqual(stores, makeStores());
});

// ── clearing ─────────────────────────────────────────────────────────────────

test("clearing removes exactly the listed ids and reports the count", () => {
  const stores = makeStores();
  const removed = clearTableOverrides(new Set(["T4_ORE", "T4_METALBAR"]), stores);
  assert.strictEqual(removed, 6); // 5 for the ore + 1 metal-bar price
  assert.strictEqual(stores.prices.T4_ORE, undefined);
  assert.strictEqual(stores.prices.T4_METALBAR, undefined);
  assert.strictEqual(stores.volumes.T4_ORE, undefined);
  assert.strictEqual(stores.cityForces.T4_ORE, undefined);
});

test("another table's overrides survive", () => {
  const stores = makeStores();
  clearTableOverrides(new Set(["T4_ORE", "T4_METALBAR"]), stores);
  assert.deepStrictEqual(stores.prices.T8_HIDE, { Martlock: { buyOrder: 900, use: "buy" } });
  assert.deepStrictEqual(stores.volumes.T8_HIDE, { Martlock: { volume: 100 } });
  assert.deepStrictEqual(stores.cityForces.T8_HIDE, { sell: "Martlock" });
});

test("clearing a base item also clears its per-quality overrides", () => {
  const stores = makeStores();
  clearTableOverrides(new Set(["T6_2H_BOW"]), stores);
  assert.strictEqual(stores.prices["T6_2H_BOW#Q3"], undefined);
});

test("clearing ids with nothing stored is a no-op returning 0", () => {
  const stores = makeStores();
  assert.strictEqual(clearTableOverrides(new Set(["T3_PLANKS"]), stores), 0);
  assert.deepStrictEqual(stores, makeStores());
});

test("the reported count equals what counting predicted", () => {
  const ids = new Set(["T4_ORE", "T8_HIDE"]);
  const stores = makeStores();
  assert.strictEqual(clearTableOverrides(ids, stores), countTableOverrides(ids, makeStores()));
});

test("a missing store is tolerated (nothing to count, nothing to clear)", () => {
  assert.strictEqual(countTableOverrides(new Set(["T4_ORE"]), {}), 0);
  assert.strictEqual(clearTableOverrides(new Set(["T4_ORE"]), {}), 0);
});

// ── collecting a table's ids from the DOM ────────────────────────────────────

test("ids come from BOTH the row keys and the editable cells", () => {
  global.document = {
    querySelectorAll(sel) {
      if (sel.includes("tr[data-row-key]")) {
        return [
          { getAttribute: () => "T4_ORE|T4_METALBAR|Thetford|" },
          { getAttribute: () => "T5_ORE|T5_METALBAR|Lymhurst|" },
        ];
      }
      // Material price cells the row key never names.
      return [{ getAttribute: () => "T4_JOURNAL_HIDE_FULL" }];
    },
  };
  assert.deepStrictEqual(
    [...tableItemIds("transport-table")].sort(),
    ["T4_JOURNAL_HIDE_FULL", "T4_METALBAR", "T4_ORE", "T5_METALBAR", "T5_ORE"],
  );
});

test("a table with no rendered rows yields no ids (so the button clears nothing)", () => {
  global.document = { querySelectorAll: () => [] };
  assert.strictEqual(tableItemIds("crafting-table").size, 0);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
