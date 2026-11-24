/**
 * Top-10 boards — per-table source descriptor tests.
 *
 * Each profit table caches its computed rows in tableState[<id>].data after its
 * renderer runs. js/joined-summary-sources.js says, per table, which field
 * holds the profit, which (if any) holds the focus figures, which rows are
 * placeholders, and how a source row becomes a flat board row. This file tests
 * those four parts directly, plus the ranker they feed.
 *
 * Covered:
 *   - pickTopNBy: descending order, stable ties, drops zero/negative/non-finite
 *   - every source's normalize(): the field mapping for that table's row shape
 *   - the special cases: Rolling (no marginInfo, no vol), Faction Spending
 *     (netSilver + tradeable filter), Laborers (margin === -1 placeholders),
 *     Crafting (sellVol, not dailyVol)
 *   - which tables carry a focus metric, and why the others do not
 *
 * Run: node tests/joined-summary-extractors.test.cjs
 */

const assert = require("assert");
const path = require("path");

// ── Browser-side helpers the sources call: stub via globalThis ──
// getRowKey(row, tableId) -> string. The real one lives in sorting.js and
// derives a stable identity. For tests, a deterministic stub is enough.
globalThis.getRowKey = function (row, tableId) {
  const part = row?.item?.id || row?.item?.name || row?.itemId || row?.name || "?";
  return `${tableId}|${part}`;
};
globalThis.tx = globalThis.tx || ((en) => en);
globalThis.dispName = globalThis.dispName || ((id, fallback) => fallback);

const { JOINED_SOURCES, _jsFocus } =
  require(path.join(__dirname, "..", "js", "joined-summary-sources.js"));
const { pickTopNBy, pickTopByThroughput } =
  require(path.join(__dirname, "..", "js", "render-joined-summary.js"));

/** Rank a table's rows the way a board does, and normalize the winner. */
function topOf(tableId, rows, n = 1) {
  const src = JOINED_SOURCES[tableId];
  const kept = src.filter ? rows.filter((r) => r && src.filter(r)) : rows;
  const picks = pickTopNBy(kept, src.profit, n);
  return picks.map(({ row }) => {
    const out = src.normalize(row);
    out.throughput = (out.pureProfit || 0) * (out.dailyVol || 0);
    return out;
  });
}
const top1 = (tableId, rows) => topOf(tableId, rows, 1)[0] || null;

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    if (process.env.VERBOSE) console.error(e.stack);
    failed++;
  }
}

console.log("\n=== pickTopNBy ===");

test("returns the n highest scores, best first", () => {
  const rows = [{ p: 100 }, { p: 500 }, { p: 200 }, { p: 50 }];
  const top = pickTopNBy(rows, (r) => r.p, 3);
  assert.deepStrictEqual(top.map((t) => t.row.p), [500, 200, 100]);
});

test("returns fewer than n when there are not enough rows", () => {
  const top = pickTopNBy([{ p: 10 }, { p: 20 }], (r) => r.p, 10);
  assert.strictEqual(top.length, 2);
});

test("ties keep input order, so the board does not reshuffle between renders", () => {
  const rows = [{ id: "a", p: 100 }, { id: "b", p: 100 }, { id: "c", p: 100 }];
  const top = pickTopNBy(rows, (r) => r.p, 3);
  assert.deepStrictEqual(top.map((t) => t.row.id), ["a", "b", "c"]);
});

test("drops zero and negative scores — the boards are opportunity lists", () => {
  const rows = [{ p: -100 }, { p: 0 }, { p: 5 }];
  const top = pickTopNBy(rows, (r) => r.p, 10);
  assert.deepStrictEqual(top.map((t) => t.row.p), [5]);
});

test("drops non-finite scores (NaN, Infinity)", () => {
  const rows = [{ p: NaN }, { p: Infinity }, { p: 50 }];
  const top = pickTopNBy(rows, (r) => r.p, 10);
  assert.deepStrictEqual(top.map((t) => t.row.p), [50]);
});

test("ignores null/undefined entries and an empty input", () => {
  assert.deepStrictEqual(pickTopNBy([], (r) => r.p, 5), []);
  assert.strictEqual(pickTopNBy([null, undefined, { p: 7 }], (r) => r.p, 5).length, 1);
});

// The old one-winner-per-table ranker is still exported; the boards no longer
// use it, but nothing else should silently start behaving differently either.
test("pickTopByThroughput still scores profit × vol and breaks ties on profit", () => {
  const rows = [{ profit: 100, vol: 100 }, { profit: 200, vol: 50 }];
  const top = pickTopByThroughput(rows, (r) => r.profit, (r) => r.vol);
  assert.strictEqual(top._score, 10000);
  assert.strictEqual(top.row.profit, 200);
});

console.log("\n=== the editable-price fields are declared by every source ===");

// The board's Best Sell Price cell is editable only when normalize() names the
// item the price belongs to. `undefined` and `null` render the same inert cell,
// so a source that simply forgot the field would look identical to one that
// deliberately opted out — declare all three, always. Which id each source picks
// is asserted per feeder in tests/joined-summary-editable-prices.
// Every nested object a normalize() reads through, empty. Normalizers are fed
// well-formed feeder rows, so they dereference these without guarding.
const EMPTY_ROW = () => ({
  item: {}, route: {}, marginInfo: {}, transition: {},
  buy: {}, sell: {}, sellGear: {}, sellRefined: {}, sellPot: {}, sellCrop: {},
});

test("every normalize() declares sellItemId / sellQuality / sellSideOverride", () => {
  for (const [tableId, src] of Object.entries(JOINED_SOURCES)) {
    const out = src.normalize(EMPTY_ROW());
    for (const field of ["sellItemId", "sellQuality", "sellSideOverride"]) {
      assert.ok(field in out, `${tableId}.normalize() is missing ${field}`);
    }
    assert.strictEqual(typeof out.sellSideOverride, "boolean",
      `${tableId}.sellSideOverride must be a boolean — it is passed straight to priceTd`);
  }
});

// A board row is COLLECTED from one table and may be best READ in another, so
// every normalize() names its own Jump destination. Eleven of the twelve simply
// name themselves; crafting sends its rows to the Craft Planner, where the same
// play shows where its materials come from instead of only what they cost.
test("every normalize() declares where its Jump goes", () => {
  for (const [tableId, src] of Object.entries(JOINED_SOURCES)) {
    const out = src.normalize(EMPTY_ROW());
    for (const field of ["jumpTableId", "jumpRowKey", "jumpFallbackTableId"]) {
      assert.ok(field in out, `${tableId}.normalize() is missing ${field}`);
    }
  }
});

test("crafting jumps to the Craft Planner and falls back to its own table", () => {
  const out = JOINED_SOURCES["crafting-table"].normalize(EMPTY_ROW());
  assert.strictEqual(out.jumpTableId, "craft-planner-table");
  assert.strictEqual(out.jumpFallbackTableId, "crafting-table");
  // No key travels with it: the planner keys `id|craftCity|section` and keeps
  // one row per item under whichever craft city pays more.
  assert.strictEqual(out.jumpRowKey, "");
});

// The planner holds no refining, transmute or enchanting rows — those are
// sourcing decisions INSIDE a craft row — so sending them there would land on
// nothing.
test("every other feeder still jumps to its own table", () => {
  for (const [tableId, src] of Object.entries(JOINED_SOURCES)) {
    if (tableId === "crafting-table") continue;
    const out = src.normalize(EMPTY_ROW());
    assert.strictEqual(out.jumpTableId, tableId, `${tableId} changed destination`);
    assert.strictEqual(out.jumpFallbackTableId, null, `${tableId} grew a fallback`);
    assert.strictEqual(out.jumpRowKey, null, `${tableId} overrode its row key`);
  }
});

console.log("\n=== flipping-table ===");

test("picks the most profitable flipping row and normalizes it", () => {
  const rows = [
    {
      item: { id: "T4_SWORD", name: "Adept's Sword" },
      tier: 4,
      buy: { city: "Lymhurst", price: 1000 },
      sell: { city: "Martlock", price: 2000 },
      marginInfo: { profit: 800, margin: 80 },
      dailyVol: 50,
    },
    {
      item: { id: "T5_BOW", name: "Expert's Bow" },
      tier: 5,
      buy: { city: "Thetford", price: 2000 },
      sell: { city: "Caerleon", price: 4000 },
      marginInfo: { profit: 1500, margin: 75 },
      dailyVol: 200,
    },
  ];
  const out = top1("flipping-table", rows);
  assert.strictEqual(out.category, "Flipping");
  assert.strictEqual(out.tableId, "flipping-table");
  assert.ok(out.itemName.includes("Expert's Bow"));
  assert.strictEqual(out.pureProfit, 1500);
  assert.strictEqual(out.dailyVol, 200);
  assert.strictEqual(out.throughput, 300000);
  assert.strictEqual(out.volIsUnknown, false);
  assert.strictEqual(out.buyCity, "Thetford");
  assert.strictEqual(out.sellCity, "Caerleon");
});

// Board-of-ten, not board-of-one: a hot category may own several rows.
test("a table can contribute several rows, in profit order", () => {
  const rows = [800, 1500, 1200].map((profit, i) => ({
    item: { id: `T4_X${i}`, name: `Item ${i}` },
    tier: 4,
    buy: { city: "Lymhurst", price: 1000 },
    sell: { city: "Martlock", price: 1000 + profit },
    marginInfo: { profit, margin: 50 },
    dailyVol: 10,
  }));
  const out = topOf("flipping-table", rows, 3);
  assert.deepStrictEqual(out.map((r) => r.pureProfit), [1500, 1200, 800]);
});

test("empty rows and all-unprofitable rows contribute nothing", () => {
  assert.deepStrictEqual(topOf("flipping-table", [], 10), []);
  const losers = [{
    item: { id: "X", name: "X" }, tier: 4, buy: {}, sell: {},
    marginInfo: { profit: -10, margin: -1 }, dailyVol: 100,
  }];
  assert.deepStrictEqual(topOf("flipping-table", losers, 10), []);
});

test("flipping spends no focus, so it has no focus metric", () => {
  assert.strictEqual(JOINED_SOURCES["flipping-table"].focus({ focusCost: 500 }), null);
});

console.log("\n=== crafting-table (uses sellVol, not dailyVol) ===");

test("reads sellVol, not dailyVol", () => {
  const rows = [
    {
      item: { id: "T6_HORSE", name: "Armored Horse [T6]" },
      craftCity: "Lymhurst",
      sellGear: { city: "Martlock", price: 270000 },
      totalInputCost: 139174,
      marginInfo: { profit: 113276, margin: 81.39 },
      sellVol: 2241,
      dailyVol: 0, // would-be 0 if we wrongly read this
    },
  ];
  const out = top1("crafting-table", rows);
  assert.strictEqual(out.category, "Crafting");
  assert.ok(out.itemName.includes("Armored Horse"));
  assert.strictEqual(out.pureProfit, 113276);
  assert.strictEqual(out.dailyVol, 2241);
  assert.strictEqual(out.throughput, 113276 * 2241);
});

console.log("\n=== transport-table ===");

test("normalizes a transport refining row", () => {
  globalThis.ITEM_NAMES_MAP = { T5_METALBAR: "Steel Bar" };
  const rows = [
    {
      route: { rawId: "T5_ORE", refinedId: "T5_METALBAR", resourceType: "metal" },
      refineCity: "Bridgewatch",
      buyRaw: { city: "Bridgewatch", price: 200 },
      sellRefined: { city: "Caerleon", price: 500 },
      totalRawCost: 1800,
      marginInfo: { profit: 300, margin: 16 },
      dailyVol: 5000,
    },
  ];
  const out = top1("transport-table", rows);
  assert.strictEqual(out.category, "Transport / Refining");
  assert.strictEqual(out.itemName, "Steel Bar");
  assert.strictEqual(out.throughput, 1500000);
  assert.ok(out.routeLabel.includes("Bridgewatch"));
});

console.log("\n=== rolling-table — no marginInfo.profit, no dailyVol ===");

test("computes profit as sellRevenue - rollCostSilver and marks volIsUnknown", () => {
  const rows = [
    {
      tier: 7, rollType: "Soul", cat: "Warrior",
      artId: "T7_ARTEFACT_2H_SOMETHING",
      artName: "Knightly Greatsword",
      fragBuyCity: "Lymhurst", fragBuyPrice: 5000,
      bestSellCity: "Martlock", bestSellPrice: 800000,
      rollCostSilver: 256000,
      sellRevenue: 748000,
      margin: 192,
    },
    {
      tier: 4, rollType: "Rune", cat: "Any",
      artId: "T4_ARTEFACT_X", artName: "Rune Cape",
      fragBuyCity: "Bridgewatch", fragBuyPrice: 100,
      bestSellCity: "Thetford", bestSellPrice: 15000,
      rollCostSilver: 3690,
      sellRevenue: 14025,
      margin: 280,
    },
  ];
  const out = top1("rolling-table", rows);
  assert.strictEqual(out.category, "Artifact Rolling");
  assert.strictEqual(out.pureProfit, 748000 - 256000);
  assert.strictEqual(out.dailyVol, 0);
  assert.strictEqual(out.throughput, 0, "no volume means no throughput to show");
  assert.strictEqual(out.volIsUnknown, true);
  assert.strictEqual(out.note, "vol unknown");
});

test("skips rows with no fragment or artifact market data", () => {
  const rows = [
    {
      tier: 7, rollType: "Soul", cat: "Warrior",
      artName: "Bad row", fragBuyPrice: 0,
      bestSellPrice: 100000, rollCostSilver: 0, sellRevenue: 900000,
      hasNoFragData: true,
    },
    {
      tier: 6, rollType: "Rune", cat: "Any",
      artName: "Good row", fragBuyPrice: 200,
      bestSellCity: "Martlock", bestSellPrice: 50000,
      rollCostSilver: 8000, sellRevenue: 46750, margin: 484,
    },
  ];
  const out = top1("rolling-table", rows);
  assert.ok(out.itemName.includes("Good row"), "the fatter no-data row must not win");
});

console.log("\n=== faction-spending-table — tradeable-only, netSilver-based ===");

test("only considers tradeable rows; ranks by netSilver", () => {
  const rows = [
    {
      itemId: "T8_ARTEFACT_BABY_T8_HORSE",
      name: "T8 Elite Horse Baby", category: "Babies",
      fpCost: 50000, sellCity: "Caerleon",
      sellPrice: 500000, netSilver: 467500,
      silverPerFp: 9.35, dailyVol: 100,
      tradeable: true,
    },
    {
      itemId: "T8_FACTION_HEART", name: "Heart", category: "Heart",
      fpCost: 5000, sellCity: "Lymhurst",
      sellPrice: 12000, netSilver: 11220,
      silverPerFp: 2.24, dailyVol: 500,
      tradeable: true,
    },
    {
      itemId: "CHEST_T6", name: "Chest", category: "Chest",
      fpCost: 30000, sellPrice: 900000, netSilver: 900000,
      silverPerFp: 6.67, dailyVol: 0,
      tradeable: false,
    },
  ];
  const out = top1("faction-spending-table", rows);
  assert.strictEqual(out.category, "Faction Spending");
  assert.strictEqual(out.itemName, "T8 Elite Horse Baby");
  assert.strictEqual(out.note, "FP-gated");
  assert.strictEqual(out.inputCost, 0, "FP-denominated, so no silver input cost");
  assert.strictEqual(out.pureProfit, 467500);
  assert.strictEqual(out.dailyVol, 100);
});

test("no tradeable rows means no contribution", () => {
  const rows = [{ itemId: "C1", name: "Chest", tradeable: false, netSilver: 100000, dailyVol: 0 }];
  assert.deepStrictEqual(topOf("faction-spending-table", rows, 10), []);
});

// ── Energy Mount rows (Favor-backed battle mounts) ──────────────────────────
// Their netSilver is Favor-denominated (the 5,000-energy cost is NOT deducted —
// that is the Faction table's own ranking semantics), but the board must rank
// and display them by the all-in pureProfitSilver with the energy costed at
// market. Ranking by netSilver here would put a basilisk on Top 10 with a ~40M
// "profit" that assumes the energy was free.
test("Energy Mount row ranks and normalizes by its all-in pure profit", () => {
  const rows = [
    {
      itemId: "T7_MOUNT_ARMORED_SWAMPDRAGON_BATTLE", name: "Venom Basilisk",
      category: "Energy Mount", currency: "Favor",
      fpCost: 0, favorCost: 750000, sellCity: "Thetford",
      sellPrice: 42749999, netSilver: 40449987, pureProfitSilver: 1500000,
      tradeable: true, dailyVol: 3,
      mountInputs: { pureInputCost: 40326531, inputCost: 2500000, inputsKnown: true },
    },
    {
      itemId: "T7_MOUNT_SWAMPDRAGON_BATTLE", name: "Flame Basilisk",
      category: "Energy Mount", currency: "Favor",
      fpCost: 0, favorCost: 750000, sellCity: "Caerleon",
      sellPrice: 43000000, netSilver: 40700000, pureProfitSilver: 0,
      tradeable: true, dailyVol: 2,
      mountInputs: { pureInputCost: 40700000, inputCost: 1540000, inputsKnown: false },
    },
  ];
  const out = top1("faction-spending-table", rows);
  assert.strictEqual(out.itemName, "Venom Basilisk", "ranked by pureProfitSilver, not netSilver");
  assert.strictEqual(out.pureProfit, 1500000);
  assert.strictEqual(out.inputCost, 40326531, "input cost = base mount + mats + energy");
  assert.notStrictEqual(out.note, "FP-gated");
  assert.ok(out.routeLabel.includes("750,000 Favor"), out.routeLabel);
  assert.ok(!out.routeLabel.includes("0 FP"), out.routeLabel);
});

test("a suppressed Energy Mount (pureProfitSilver 0) is dropped, never ranked", () => {
  const rows = [{
    itemId: "T8_MOUNT_MAMMOTH_BATTLE@1", name: "Elder's Command Mammoth",
    category: "Energy Mount", currency: "Favor",
    fpCost: 0, favorCost: 1500000, sellCity: "Caerleon",
    sellPrice: 310000000, netSilver: 80000000, pureProfitSilver: 0,
    tradeable: true, dailyVol: 1,
    mountInputs: { pureInputCost: 230000000, inputsKnown: false },
  }];
  assert.deepStrictEqual(topOf("faction-spending-table", rows, 10), []);
});

test("plain Favor row: note Favor-gated, route shows Favor not '0 FP'", () => {
  const out = JOINED_SOURCES["faction-spending-table"].normalize({
    itemId: "T8_RELIC", name: "Elder's Relic",
    fpCost: 0, favorCost: 8100, sellCity: "Martlock",
    sellPrice: 200000, netSilver: 187000, tradeable: true,
  });
  assert.strictEqual(out.note, "Favor-gated");
  assert.strictEqual(out.inputCost, 0);
  assert.ok(out.routeLabel.includes("8,100 Favor"), out.routeLabel);
  assert.ok(!out.routeLabel.includes("0 FP"), out.routeLabel);
});

// Its focus figures are FP-denominated, which is a different currency from a
// focus bar — the whole reason it is off the focus board.
test("faction spending has no focus metric even when it carries focus fields", () => {
  const src = JOINED_SOURCES["faction-spending-table"];
  assert.strictEqual(src.focus({ fpFocusPer10k: 9999, nurtureFocusCost: 100 }), null);
});

console.log("\n=== laborers-table — no vol, placeholder rows skipped ===");

test("marks volIsUnknown, uses cycles=1, skips margin=-1 placeholders", () => {
  const rows = [
    {
      item: { id: "Trophy|T8_J", name: "T8 Hunter Apprentice" },
      tier: 8, mode: "Trophy",
      buy: { city: "Martlock", price: 5000 },
      sell: { city: "Martlock", price: 2000 },
      totalInputCost: 5125,
      marginInfo: { profit: 15000, margin: 200 },
    },
    {
      item: { id: "Resource|T6_J", name: "T6 Gatherer" },
      tier: 6, mode: "Resource",
      buy: { city: "", price: 0 }, sell: { city: "", price: 0 },
      totalInputCost: 0,
      marginInfo: { profit: 99999, margin: -1 }, // placeholder -> skip
    },
    {
      item: { id: "Crafting|T7_J", name: "T7 Crafter" },
      tier: 7, mode: "Crafting",
      buy: { city: "Lymhurst", price: 4000 },
      sell: { city: "Lymhurst", price: 1800 },
      totalInputCost: 4100,
      marginInfo: { profit: 8000, margin: 195 },
    },
  ];
  const out = top1("laborers-table", rows);
  assert.strictEqual(out.category, "Laborers");
  assert.strictEqual(out.pureProfit, 15000, "the 99,999 placeholder must not win");
  assert.strictEqual(out.dailyVol, 1);
  assert.strictEqual(out.volIsUnknown, true);
  assert.strictEqual(out.note, "per cycle");
  assert.ok(out.itemName.includes("Trophy"));
});

test("every row a placeholder means no contribution", () => {
  const rows = [{
    item: { name: "x" }, mode: "Trophy", buy: {}, sell: {},
    marginInfo: { profit: 100, margin: -1 }, totalInputCost: 0,
  }];
  assert.deepStrictEqual(topOf("laborers-table", rows, 10), []);
});

console.log("\n=== rerolling / enchanting / transmute / farming / consumable / mounts ===");

test("rerolling surfaces the winning row's per-quality dailyVol", () => {
  const rows = [
    {
      item: { id: "T5_BAG", name: "Expert's Bag" }, tier: 5, transitionLabel: "0→1",
      buyCity: "Lymhurst", buyPrice: 50000,
      sellCity: "Martlock", sellPrice: 90000,
      totalInputCost: 60000,
      marginInfo: { profit: 24050, margin: 40 }, dailyVol: 12,
    },
    {
      item: { id: "T7_AXE", name: "Master's Axe" }, tier: 7, transitionLabel: "1→2",
      buyCity: "Thetford", buyPrice: 200000,
      sellCity: "Caerleon", sellPrice: 380000,
      totalInputCost: 250000,
      marginInfo: { profit: 105000, margin: 42 }, dailyVol: 47,
    },
  ];
  const out = top1("rerolling-table", rows);
  assert.strictEqual(out.category, "Quality Rerolling");
  assert.strictEqual(out.volIsUnknown, false);
  assert.strictEqual(out.dailyVol, 47);
  assert.strictEqual(out.pureProfit, 105000);
});

test("enchanting normalizes a typical row", () => {
  const out = top1("enchanting-table", [{
    item: { id: "T6_BAG", name: "Master's Bag" }, tier: 6, transitionLabel: ".0→.1",
    sourceCity: "Lymhurst", sellCity: "Martlock", sellPrice: 80000,
    totalInputCost: 50000, marginInfo: { profit: 22000, margin: 44 }, dailyVol: 30,
  }]);
  assert.strictEqual(out.category, "Enchanting");
  assert.strictEqual(out.throughput, 22000 * 30);
});

test("transmute normalizes a typical row", () => {
  const out = top1("transmute-table", [{
    tier: 6, transition: { from: "Rune", to: "Soul" },
    sourceId: "T6_RUNE", targetId: "T6_SOUL",
    buyCity: "Bridgewatch", buyPrice: 8000,
    sellCity: "Martlock", sellPrice: 22000,
    totalInputCost: 9500, marginInfo: { profit: 10800, margin: 113 }, dailyVol: 40,
  }]);
  assert.strictEqual(out.category, "Transmute");
  assert.strictEqual(out.throughput, 10800 * 40);
  assert.ok(out.itemName.includes("Rune"));
});

test("farming normalizes a typical row", () => {
  const out = top1("farming-table", [{
    item: { name: "Wheat", id: "T2_FARM_CARROT", outputId: "T2_CARROT", section: "crops" },
    buySeed: { city: "Thetford", price: 100 },
    sellCrop: { city: "Lymhurst", price: 800 },
    totalInputCost: 110, marginInfo: { profit: 650, margin: 590 }, dailyVol: 1200,
  }]);
  assert.strictEqual(out.category, "Farming");
  assert.strictEqual(out.throughput, 650 * 1200);
});

// Farming carries BOTH figures: profitPerFocus is the MARGINAL rate
// (profitDelta/focusCost, js/focus-play.js) behind its Silver/Focus column, and
// profitPer10kFocus is the throughput the board ranks on. The reader must take
// the per-10k field and ignore the marginal one — mixing the denominators is
// exactly the bug the two fields exist to avoid.
test("farming's focus metric is the per-10k figure, not its marginal rate", () => {
  const src = JOINED_SOURCES["farming-table"];
  assert.deepStrictEqual(
    src.focus({ profitPerFocus: 40, focusCost: 100, profitPer10kFocus: 4000 }),
    { cost: 100, per10k: 4000 },
  );
});

test("farming with a marginal rate but no per-10k figure stays off the board", () => {
  const src = JOINED_SOURCES["farming-table"];
  assert.strictEqual(src.focus({ profitPerFocus: 40, bestFocusPlay: { focusCost: 100 } }), null);
});

test("consumable normalizes a typical row", () => {
  const out = top1("consumable-table", [{
    item: { id: "T6_MEAL_STEW", name: "Master's Stew" },
    craftCity: "Martlock", sellPot: { city: "Caerleon", price: 1500 },
    totalInputCost: 800, marginInfo: { profit: 600, margin: 75 }, dailyVol: 800,
  }]);
  assert.strictEqual(out.category, "Consumables");
  assert.strictEqual(out.throughput, 600 * 800);
});

test("mounts normalizes a typical row (saddled craft)", () => {
  const out = top1("mounts-table", [{
    item: { id: "T6_MOUNT_ARMORED_HORSE", name: "Armored Horse" },
    isBreeding: false, craftCity: "Lymhurst",
    buyMat: { city: "Lymhurst", price: 73000 },
    sellPot: { city: "Martlock", price: 270000 },
    totalInputCost: 139174, marginInfo: { profit: 113276, margin: 81 }, dailyVol: 2241,
  }]);
  assert.strictEqual(out.category, "Breeding & Mounts");
  assert.strictEqual(out.throughput, 113276 * 2241);
});

console.log("\n=== which tables carry a focus metric ===");

const FOCUS_TABLES = [
  "crafting-table", "transport-table", "consumable-table", "farming-table", "mounts-table",
];
const NO_FOCUS_TABLES = [
  "flipping-table", "enchanting-table", "transmute-table",
  "rerolling-table", "rolling-table", "faction-spending-table", "laborers-table",
];

FOCUS_TABLES.forEach((tableId) => {
  test(`${tableId} reads focusCost + profitPer10kFocus`, () => {
    const f = JOINED_SOURCES[tableId].focus({ focusCost: 480, profitPer10kFocus: 250000 });
    assert.deepStrictEqual(f, { cost: 480, per10k: 250000 });
  });
});

NO_FOCUS_TABLES.forEach((tableId) => {
  test(`${tableId} never reaches the focus board`, () => {
    assert.strictEqual(
      JOINED_SOURCES[tableId].focus({ focusCost: 480, profitPer10kFocus: 250000 }), null,
    );
  });
});

// A combine craft (artifact capes, Royal armor) spends 0 focus. Scored as 0 it
// would rank as the worst focus play on the board rather than as no play at all.
test("a zero-focus craft is excluded, not ranked at zero", () => {
  assert.strictEqual(_jsFocus({ focusCost: 0, profitPer10kFocus: 0 }), null);
  assert.strictEqual(_jsFocus({ focusCost: 480, profitPer10kFocus: 0 }), null);
  assert.strictEqual(_jsFocus({ focusCost: 480, profitPer10kFocus: -5 }), null);
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
