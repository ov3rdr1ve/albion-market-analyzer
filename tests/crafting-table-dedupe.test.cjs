/**
 * Test: dedupeCraftingRows collapses the per-craft-city rows emitted by
 * render-crafting.js down to the single most-profitable route per item.
 *
 * Non-specialized items (craftType: null) are computed once per Royal City but
 * produce identical economics. When the craft is profitable the rows converge
 * on one best sell city; when it is UNPROFITABLE each craft city falls back to
 * its own local sell (the `margin > 0 || sc === craftCity` gate), so the rows
 * diverge by sell city/price/margin. Either way the dedupe keeps only the
 * highest-margin row per (item, zone section) — the Royal best and, separately,
 * the Caerleon route.
 *
 * Run: node tests/crafting-table-dedupe.test.cjs
 */

const assert = require("assert");

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

// ── Replicate dedupeCraftingRows from js/render-crafting.js ──

function dedupeCraftingRows(rowData) {
  const isNoData = (row) => row.marginInfo && row.marginInfo.margin === -1;
  const sellsWhereCrafted = (row) =>
    !!(row.sellGear && row.craftCity && row.sellGear.city === row.craftCity);
  const best = new Map();
  rowData.forEach((row) => {
    const key = `${row.item.id}|${row.section}`;
    const cur = best.get(key);
    if (!cur) {
      best.set(key, row);
      return;
    }
    const curNo = isNoData(cur);
    const rowNo = isNoData(row);
    if (curNo && !rowNo) {
      best.set(key, row);
    } else if (!curNo && !rowNo) {
      if (row.marginInfo.margin > cur.marginInfo.margin) {
        best.set(key, row); // strictly higher margin wins
      } else if (
        row.marginInfo.margin === cur.marginInfo.margin &&
        sellsWhereCrafted(row) && !sellsWhereCrafted(cur)
      ) {
        // Tie: among economically identical Royal routes, prefer crafting in the
        // city you'll sell in (no finished-good haul). Falls back to first-seen
        // when the best sell city isn't a Royal craft candidate (BM / Caerleon).
        best.set(key, row);
      }
    }
  });
  const keep = new Set(best.values());
  return rowData.filter((row) => keep.has(row));
}

// ── Builders ──
// section defaults to "royal"; Caerleon rows pass section:"caerleon".

function successRow({ id, craftCity, sellCity, totalInputCost, sellPrice, margin = 10, section = "royal" }) {
  return {
    item: { id },
    craftCity,
    sellGear: { city: sellCity, price: sellPrice },
    totalInputCost,
    marginInfo: { margin },
    section,
  };
}

function noDataRow({ id, craftCity, section = "royal" }) {
  return {
    item: { id },
    craftCity,
    marginInfo: { margin: -1 },
    section,
  };
}

console.log("Crafting Table Dedupe Tests\n");

// ── Scenario 1: non-specialized item, 5 identical rows → 1 ──

test("5 identical Royal City rows collapse to the row that crafts where it sells", () => {
  const rows = [
    successRow({ id: "UNIQUE_HIDEOUT", craftCity: "Lymhurst",      sellCity: "Fort Sterling", totalInputCost: 15048325, sellPrice: 23300000 }),
    successRow({ id: "UNIQUE_HIDEOUT", craftCity: "Fort Sterling", sellCity: "Fort Sterling", totalInputCost: 15048325, sellPrice: 23300000 }),
    successRow({ id: "UNIQUE_HIDEOUT", craftCity: "Thetford",      sellCity: "Fort Sterling", totalInputCost: 15048325, sellPrice: 23300000 }),
    successRow({ id: "UNIQUE_HIDEOUT", craftCity: "Martlock",      sellCity: "Fort Sterling", totalInputCost: 15048325, sellPrice: 23300000 }),
    successRow({ id: "UNIQUE_HIDEOUT", craftCity: "Bridgewatch",   sellCity: "Fort Sterling", totalInputCost: 15048325, sellPrice: 23300000 }),
  ];
  const result = dedupeCraftingRows(rows);
  assert.strictEqual(result.length, 1);
  // Tied margins → prefer crafting in the sell city (no finished-good haul).
  assert.strictEqual(result[0].craftCity, "Fort Sterling", "should pick the local craft+sell row");
});

// ── Scenario 1b: best sell city is NOT a Royal craft candidate → first-seen ──
// When the global best sell is Black Market / Caerleon, no Royal craft row is
// "local", so the tie-break has nothing to prefer and keeps the first-seen city.

test("tied Royal rows selling to Black Market keep first-seen craft city", () => {
  const rows = [
    successRow({ id: "UNIQUE_HIDEOUT", craftCity: "Lymhurst",      sellCity: "Black Market", totalInputCost: 15048325, sellPrice: 23300000 }),
    successRow({ id: "UNIQUE_HIDEOUT", craftCity: "Fort Sterling", sellCity: "Black Market", totalInputCost: 15048325, sellPrice: 23300000 }),
    successRow({ id: "UNIQUE_HIDEOUT", craftCity: "Thetford",      sellCity: "Black Market", totalInputCost: 15048325, sellPrice: 23300000 }),
  ];
  const result = dedupeCraftingRows(rows);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].craftCity, "Lymhurst", "no local row → first-seen survives");
});

// ── Scenario 2: specialized item, spec city vs Caerleon differ ──

test("specialized item: Royal route and Caerleon route both preserved", () => {
  const rows = [
    successRow({ id: "T6_SWORD", craftCity: "Lymhurst", sellCity: "Lymhurst", totalInputCost: 800000, sellPrice: 1200000, section: "royal" }),
    successRow({ id: "T6_SWORD", craftCity: "Caerleon", sellCity: "Caerleon", totalInputCost: 750000, sellPrice: 1200000, section: "caerleon" }),
  ];
  const result = dedupeCraftingRows(rows);
  assert.strictEqual(result.length, 2);
});

// ── Scenario 3: multiple no-data rows for same item → 1 ──

test("5 no-data rows for same item collapse to 1", () => {
  const rows = [
    noDataRow({ id: "UNIQUE_HIDEOUT", craftCity: "Lymhurst" }),
    noDataRow({ id: "UNIQUE_HIDEOUT", craftCity: "Fort Sterling" }),
    noDataRow({ id: "UNIQUE_HIDEOUT", craftCity: "Thetford" }),
    noDataRow({ id: "UNIQUE_HIDEOUT", craftCity: "Martlock" }),
    noDataRow({ id: "UNIQUE_HIDEOUT", craftCity: "Bridgewatch" }),
  ];
  const result = dedupeCraftingRows(rows);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].craftCity, "Lymhurst");
});

// ── Scenario 4: distinct items untouched ──

test("3 rows for 3 different items all preserved", () => {
  const rows = [
    successRow({ id: "UNIQUE_HIDEOUT",       craftCity: "Lymhurst", sellCity: "Fort Sterling", totalInputCost: 15048325, sellPrice: 23300000 }),
    successRow({ id: "T5_FURNITUREITEM_CHEST", craftCity: "Lymhurst", sellCity: "Fort Sterling", totalInputCost: 10000,    sellPrice: 15000 }),
    successRow({ id: "T6_SWORD",               craftCity: "Lymhurst", sellCity: "Caerleon",      totalInputCost: 800000,   sellPrice: 1200000 }),
  ];
  const result = dedupeCraftingRows(rows);
  assert.strictEqual(result.length, 3);
});

// ── Scenario 5: enchant variants distinct (different ids) ──

test("base item and enchant variant with identical economics stay separate", () => {
  const rows = [
    successRow({ id: "T6_SWORD",   craftCity: "Lymhurst", sellCity: "Caerleon", totalInputCost: 800000, sellPrice: 1200000 }),
    successRow({ id: "T6_SWORD@1", craftCity: "Lymhurst", sellCity: "Caerleon", totalInputCost: 800000, sellPrice: 1200000 }),
  ];
  const result = dedupeCraftingRows(rows);
  assert.strictEqual(result.length, 2);
});

// ── Scenario 6: unprofitable item — craft cities diverge by local sell ──
// This is the reported bug: an unprofitable mount/craft shows one row per Royal
// craft city, each pinned to its own local sell at a different (negative) margin.
// Only the most-profitable (least-negative) route should survive.

test("unprofitable item: 4 divergent Royal rows collapse to the best margin", () => {
  const rows = [
    successRow({ id: "T7_MOUNT_MONITORLIZARD_ADC", craftCity: "Fort Sterling", sellCity: "Fort Sterling", totalInputCost: 41554240, sellPrice: 42999999, margin: -3.25 }),
    successRow({ id: "T7_MOUNT_MONITORLIZARD_ADC", craftCity: "Lymhurst",      sellCity: "Lymhurst",      totalInputCost: 41554240, sellPrice: 41000000, margin: -7.75 }),
    successRow({ id: "T7_MOUNT_MONITORLIZARD_ADC", craftCity: "Thetford",      sellCity: "Thetford",      totalInputCost: 41554240, sellPrice: 39999999, margin: -10.0 }),
    successRow({ id: "T7_MOUNT_MONITORLIZARD_ADC", craftCity: "Martlock",      sellCity: "Martlock",      totalInputCost: 41554240, sellPrice: 39000000, margin: -12.25 }),
  ];
  const result = dedupeCraftingRows(rows);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].craftCity, "Fort Sterling");
  assert.strictEqual(result[0].marginInfo.margin, -3.25);
});

// ── Scenario 6b: best Royal row is not first-seen ──

test("most-profitable Royal row survives regardless of input order", () => {
  const rows = [
    successRow({ id: "T8_2H_AXE", craftCity: "Lymhurst",      sellCity: "Lymhurst",      totalInputCost: 100, sellPrice: 200, margin: 5 }),
    successRow({ id: "T8_2H_AXE", craftCity: "Martlock",      sellCity: "Martlock",      totalInputCost: 100, sellPrice: 260, margin: 30 }),
    successRow({ id: "T8_2H_AXE", craftCity: "Fort Sterling", sellCity: "Fort Sterling", totalInputCost: 100, sellPrice: 220, margin: 12 }),
  ];
  const result = dedupeCraftingRows(rows);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].craftCity, "Martlock");
});

// ── Scenario 7: mixed success + no-data for same item ──

test("no-data row for one item and success rows for another coexist", () => {
  const rows = [
    noDataRow({ id: "T8_RAREITEM", craftCity: "Lymhurst" }),
    successRow({ id: "T6_SWORD", craftCity: "Lymhurst", sellCity: "Caerleon", totalInputCost: 800000, sellPrice: 1200000 }),
    noDataRow({ id: "T8_RAREITEM", craftCity: "Fort Sterling" }),
  ];
  const result = dedupeCraftingRows(rows);
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].item.id, "T8_RAREITEM");
  assert.strictEqual(result[0].marginInfo.margin, -1);
  assert.strictEqual(result[1].item.id, "T6_SWORD");
});

// ── Scenario 7b: real route beats a no-data placeholder (same item+section) ──

test("a priced Royal route wins over a no-data row for the same item", () => {
  const rows = [
    noDataRow({ id: "T7_OFF_SHIELD", craftCity: "Thetford" }),
    successRow({ id: "T7_OFF_SHIELD", craftCity: "Lymhurst", sellCity: "Lymhurst", totalInputCost: 5000, sellPrice: 9000, margin: 20 }),
    noDataRow({ id: "T7_OFF_SHIELD", craftCity: "Martlock" }),
  ];
  const result = dedupeCraftingRows(rows);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].craftCity, "Lymhurst");
  assert.strictEqual(result[0].marginInfo.margin, 20);
});

// ── Scenario 8: empty input ──

test("empty rowData returns empty array", () => {
  const result = dedupeCraftingRows([]);
  assert.strictEqual(result.length, 0);
});

// ── Scenario 9: order preservation ──

test("dedupe preserves first-seen order across survivors", () => {
  const rows = [
    successRow({ id: "C", craftCity: "Lymhurst", sellCity: "Caerleon", totalInputCost: 300, sellPrice: 400 }),
    successRow({ id: "A", craftCity: "Lymhurst", sellCity: "Caerleon", totalInputCost: 100, sellPrice: 200 }),
    successRow({ id: "A", craftCity: "Thetford", sellCity: "Caerleon", totalInputCost: 100, sellPrice: 200 }), // dup of previous
    successRow({ id: "B", craftCity: "Lymhurst", sellCity: "Caerleon", totalInputCost: 150, sellPrice: 250 }),
  ];
  const result = dedupeCraftingRows(rows);
  assert.strictEqual(result.length, 3);
  assert.deepStrictEqual(result.map((r) => r.item.id), ["C", "A", "B"]);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
