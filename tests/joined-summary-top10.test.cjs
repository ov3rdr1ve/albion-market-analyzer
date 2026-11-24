/**
 * Top-10 boards — assembly tests.
 *
 * The two boards replaced a single "best of each category" table that showed
 * one row per feeder ranked by `pureProfit × dailyVol`. They are true global
 * Top 10s: every feeder's rows compete together, so one hot category may own
 * several rows or none.
 *
 * The ranking is two-stage for cost — each table is ranked on its own rows and
 * only its top 10 are normalized, because normalizing all ~2900 flipping rows
 * on every captured price patch is not affordable. That shortcut is exact, and
 * this file pins it against a brute-force ranking that normalizes everything.
 *
 * Also covered: the focus board only draws on the five tables that publish a
 * profit-per-10k-focus figure, zero-focus rows never appear on it, and the
 * royal / Caerleon duplicate of one flip does not take two slots.
 *
 * Black box over the real js/joined-summary-sources.js + the real collectors,
 * fed a synthetic tableState. No DOM, no live API.
 *
 * Run: node tests/joined-summary-top10.test.cjs
 */

const assert = require("assert");
const path = require("path");

globalThis.tx = globalThis.tx || ((en) => en);
globalThis.dispName = globalThis.dispName || ((id, fallback) => fallback);
globalThis.getRowKey = function (row, tableId) {
  const part = row?.item?.id || row?.item?.name || row?.itemId || row?.name || "";
  return part ? `${tableId}|${part}` : "";
};

const { JOINED_SOURCES } =
  require(path.join(__dirname, "..", "js", "joined-summary-sources.js"));
const {
  JOINED_TOP_N, joinedRowKey,
  collectTopProfitRows, collectTopFocusRows,
} = require(path.join(__dirname, "..", "js", "render-joined-summary.js"));

// The collectors read the global `tableState` the app declares in sorting.js.
globalThis.tableState = {};
function setTables(map) {
  globalThis.tableState = {};
  Object.entries(map).forEach(([id, rows]) => {
    globalThis.tableState[id] = { data: rows };
  });
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    if (process.env.VERBOSE) console.error(e.stack);
    failed++;
  }
}

// ── Row factories, one per shape the boards have to understand ─────────────

function flipRow(id, profit, vol = 100, section) {
  return {
    item: { id, name: id }, tier: 4,
    buy: { city: "Lymhurst", price: 1000 },
    sell: { city: "Martlock", price: 1000 + profit },
    marginInfo: { profit, margin: 50 },
    dailyVol: vol, section,
  };
}

function craftRow(id, profit, focusCost = 500, per10k = null) {
  return {
    item: { id, name: id },
    craftCity: "Lymhurst",
    sellGear: { city: "Martlock", price: 100000 },
    totalInputCost: 100000 - profit,
    marginInfo: { profit, margin: 40 },
    sellVol: 100,
    focusCost,
    profitPer10kFocus: per10k === null ? profit * Math.floor(10000 / (focusCost || 1)) : per10k,
  };
}

function mountRow(id, profit, focusCost, per10k) {
  return {
    item: { id, name: id }, isBreeding: false,
    craftCity: "Lymhurst",
    buyMat: { city: "Lymhurst", price: 1000 },
    sellPot: { city: "Martlock", price: 100000 },
    totalInputCost: 50000,
    marginInfo: { profit, margin: 40 },
    dailyVol: 10,
    focusCost, profitPer10kFocus: per10k,
  };
}

// Farming carries both figures: the huge marginal rate must never be what the
// focus board ranks on — only the per-10k throughput is. Pass focusCost 0 (or
// omit per10k) for a row that spends no focus.
function farmRow(id, profit, focusCost = 0, per10k = 0) {
  return {
    item: { id, name: id },
    buySeed: { city: "Thetford", price: 100 },
    sellCrop: { city: "Lymhurst", price: 100 + profit },
    totalInputCost: 100,
    marginInfo: { profit, margin: 200 },
    dailyVol: 500,
    profitPerFocus: 999999,
    bestFocusPlay: { kind: "water", focusCost: focusCost || 100, profitDelta: 99999900 },
    focusCost,
    profitPer10kFocus: per10k,
  };
}

console.log("\n=== the profit board is a global Top 10 ===");

test("shows exactly ten rows when more than ten candidates exist", () => {
  setTables({
    "flipping-table": Array.from({ length: 30 }, (_, i) => flipRow(`F${i}`, 100 + i)),
    "crafting-table": Array.from({ length: 30 }, (_, i) => craftRow(`C${i}`, 200 + i)),
  });
  assert.strictEqual(collectTopProfitRows().length, JOINED_TOP_N);
});

test("shows fewer than ten when there are not enough candidates", () => {
  setTables({ "flipping-table": [flipRow("F1", 100), flipRow("F2", 50)] });
  assert.strictEqual(collectTopProfitRows().length, 2);
});

test("nothing to rank yields an empty board, not a row of blanks", () => {
  setTables({});
  assert.deepStrictEqual(collectTopProfitRows(), []);
  setTables({ "flipping-table": [] });
  assert.deepStrictEqual(collectTopProfitRows(), []);
});

// This is the behaviour change the user asked for: the old board reserved one
// slot per category whatever the numbers said.
test("one category may own several rows — even all ten", () => {
  setTables({
    "flipping-table": Array.from({ length: 12 }, (_, i) => flipRow(`F${i}`, 10000 + i)),
    "crafting-table": [craftRow("C0", 5)],
  });
  const board = collectTopProfitRows();
  assert.strictEqual(board.length, JOINED_TOP_N);
  assert.ok(board.every((r) => r.tableId === "flipping-table"),
    "the ten biggest profits all happen to be flips here");
});

test("rows come back in descending pure profit", () => {
  setTables({
    "flipping-table": [flipRow("F1", 300), flipRow("F2", 900), flipRow("F3", 600)],
    "crafting-table": [craftRow("C1", 750)],
  });
  const profits = collectTopProfitRows().map((r) => r.pureProfit);
  assert.deepStrictEqual(profits, [900, 750, 600, 300]);
});

test("unprofitable rows never reach the board", () => {
  setTables({ "flipping-table": [flipRow("F1", -500), flipRow("F2", 0), flipRow("F3", 10)] });
  const board = collectTopProfitRows();
  assert.strictEqual(board.length, 1);
  assert.strictEqual(board[0].pureProfit, 10);
});

// The per-table pre-slice is a cost shortcut, and a wrong one would silently
// drop a genuine winner. Brute force the same answer the slow way.
test("the per-table pre-slice matches ranking every normalized row", () => {
  const tables = {
    "flipping-table": Array.from({ length: 40 }, (_, i) => flipRow(`F${i}`, (i * 37) % 500 + 1)),
    "crafting-table": Array.from({ length: 40 }, (_, i) => craftRow(`C${i}`, (i * 53) % 500 + 1)),
    "farming-table": Array.from({ length: 40 }, (_, i) => farmRow(`R${i}`, (i * 71) % 500 + 1)),
  };
  setTables(tables);
  const fast = collectTopProfitRows().map((r) => r.pureProfit);

  const all = [];
  Object.entries(tables).forEach(([tableId, rows]) => {
    const src = JOINED_SOURCES[tableId];
    rows.forEach((r) => {
      const p = src.profit(r);
      if (p > 0) all.push(p);
    });
  });
  const slow = all.sort((a, b) => b - a).slice(0, JOINED_TOP_N);
  assert.deepStrictEqual(fast, slow);
});

console.log("\n=== the royal / Caerleon duplicate ===");

// With routes off, Flipping renders each item twice — a royal row and a
// Caerleon row. The boards no longer split by section, so both would show,
// stacked, saying nearly the same thing.
test("one item's two section rows take one slot, the better one", () => {
  const royal = flipRow("T4_BAG", 500, 100, "royal");
  const caerleon = { ...flipRow("T4_BAG", 900, 100, "caerleon") };
  setTables({ "flipping-table": [royal, caerleon] });
  const board = collectTopProfitRows();
  assert.strictEqual(board.length, 1, "the same item must not take two slots");
  assert.strictEqual(board[0].pureProfit, 900, "the better of the two survives");
});

test("different items are never deduped together", () => {
  setTables({ "flipping-table": [flipRow("T4_BAG", 500), flipRow("T5_BAG", 400)] });
  assert.strictEqual(collectTopProfitRows().length, 2);
});

// Faction spending rows have no id the stub can key on, so getRowKey returns
// "". Without the name+route fallback all ten would collapse onto one key.
test("rows whose source key is empty still keep each other apart", () => {
  const fac = (name, net) => ({
    itemId: "", name, tradeable: true, netSilver: net,
    dailyVol: 10, fpCost: 100, sellCity: "Caerleon", sellPrice: net,
  });
  setTables({ "faction-spending-table": [fac("Crest A", 900), fac("Crest B", 800)] });
  const board = collectTopProfitRows();
  assert.strictEqual(board.length, 2);
  assert.notStrictEqual(joinedRowKey(board[0]), joinedRowKey(board[1]));
});

console.log("\n=== the focus board ===");

test("only the five focus-spending tables reach it", () => {
  setTables({
    "flipping-table": Array.from({ length: 20 }, (_, i) => flipRow(`F${i}`, 100000 + i)),
    "farming-table": [farmRow("R1", 100000, 100, 30000)],
    "crafting-table": [craftRow("C1", 1000, 500, 20000)],
    "mounts-table": [mountRow("M1", 5000, 1000, 50000)],
  });
  const board = collectTopFocusRows();
  const tables = new Set(board.map((r) => r.tableId));
  assert.deepStrictEqual(
    [...tables].sort(), ["crafting-table", "farming-table", "mounts-table"],
  );
});

// The marginal rate is 999,999 silver/focus on every farmRow — a hundred times
// anything else on the board. If the reader ever picked it up, farming would
// pin the top of the board on a figure in the wrong denominator.
test("farming ranks on its per-10k figure, never on its marginal rate", () => {
  setTables({
    "farming-table": [farmRow("Carrot", 100000, 100, 30000)],
    "crafting-table": [craftRow("C1", 1000, 500, 40000)],
  });
  const board = collectTopFocusRows();
  assert.strictEqual(board[0].tableId, "crafting-table");
  assert.strictEqual(board[1].tableId, "farming-table");
  assert.strictEqual(board[1].profitPer10kFocus, 30000);
  assert.strictEqual(board[1].focusCost, 100);
});

test("a farming row with no focus play is absent from the focus board", () => {
  setTables({ "farming-table": [farmRow("NoNurture", 100000)] });
  assert.deepStrictEqual(collectTopFocusRows(), []);
});

test("ranked by profit per 10k focus, not by pure profit", () => {
  setTables({
    // Big profit, expensive focus: 1,000,000 × 10 plays = 10,000,000.
    "crafting-table": [craftRow("Rich", 1000000, 1000, 10000000)],
    // Small profit, cheap focus: 1,000 × 20,000 plays = 20,000,000.
    "mounts-table": [mountRow("Cheap", 1000, 5, 20000000)],
  });
  const board = collectTopFocusRows();
  assert.strictEqual(board[0].itemName.replace(/\s*\(.*$/, ""), "Cheap");
  assert.strictEqual(board[0].profitPer10kFocus, 20000000);
  assert.strictEqual(board[1].profitPer10kFocus, 10000000);
});

test("every row carries the focus cost the figure was built from", () => {
  setTables({ "crafting-table": [craftRow("C1", 1000, 480, 20000)] });
  const [row] = collectTopFocusRows();
  assert.strictEqual(row.focusCost, 480);
  assert.strictEqual(row.profitPer10kFocus, 20000);
  assert.strictEqual(row.pureProfit, 1000, "pure profit is still carried, just not the ranking");
});

// A combine craft (artifact capes, Royal armor) spends no focus at all.
test("zero-focus rows are absent, not ranked at the bottom", () => {
  setTables({
    "crafting-table": [
      craftRow("Combine", 900000, 0, 0),
      craftRow("Normal", 1000, 500, 20000),
    ],
  });
  const board = collectTopFocusRows();
  assert.strictEqual(board.length, 1);
  assert.ok(board[0].itemName.includes("Normal"));
});

test("a table with no focus data at all contributes nothing", () => {
  setTables({ "crafting-table": [craftRow("C1", 1000, 0, 0)] });
  assert.deepStrictEqual(collectTopFocusRows(), []);
});

test("caps at ten like the profit board", () => {
  setTables({
    "crafting-table": Array.from({ length: 15 }, (_, i) => craftRow(`C${i}`, 1000 + i, 500, 10000 + i)),
    "consumable-table": Array.from({ length: 15 }, (_, i) => ({
      item: { id: `P${i}`, name: `P${i}` },
      craftCity: "Martlock", sellPot: { city: "Caerleon", price: 1500 },
      totalInputCost: 800, marginInfo: { profit: 600 + i, margin: 75 }, dailyVol: 800,
      focusCost: 120, profitPer10kFocus: 50000 + i,
    })),
  });
  assert.strictEqual(collectTopFocusRows().length, JOINED_TOP_N);
});

console.log("\n=== a source that throws does not take the board down ===");

test("one broken feeder is skipped, the rest still render", () => {
  const errors = [];
  const realError = console.error;
  console.error = (...a) => errors.push(a);
  try {
    setTables({
      // A row shape the normalizer cannot read: item is missing entirely.
      "flipping-table": [{ marginInfo: { profit: 900, margin: 10 }, dailyVol: 5 }],
      "crafting-table": [craftRow("C1", 700)],
    });
    const board = collectTopProfitRows();
    assert.strictEqual(board.length, 1);
    assert.strictEqual(board[0].tableId, "crafting-table");
    assert.ok(errors.length, "the failure must be logged, not swallowed silently");
  } finally {
    console.error = realError;
  }
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
