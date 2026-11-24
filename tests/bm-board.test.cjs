/**
 * The Black Market board — assembly and the bid-age column.
 *
 * A third board beside the two Top-10s, holding the best plays that END at the
 * Black Market. It exists because the Black Market's numbers are the ones most
 * likely to be quietly wrong: its book is one-way, it is exempt from the outlier
 * fence, and the reported bug was a row quoting a bid the player had personally
 * sold into, badged `0m ago`.
 *
 * Two things are load-bearing and pinned here:
 *   - the Black Market gate runs BEFORE each feeder is ranked, so a Black
 *     Market play that is not in the top ten of its own table still reaches the
 *     board. Filtering after ranking would hide exactly the rows this is for.
 *   - the Bid Age column tells an age from "gone" from "yours", because a board
 *     that printed all three the same way would be the original bug again.
 *
 * Black box over the real js/joined-summary-sources.js + js/render-bm-board.js,
 * fed a synthetic tableState. No DOM, no live API.
 *
 * Run: node tests/bm-board.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

globalThis.tx = globalThis.tx || ((en) => en);
globalThis.dispName = globalThis.dispName || ((id, fallback) => fallback);
globalThis.getRowKey = function (row, tableId) {
  const part = row?.item?.id || row?.item?.name || row?.itemId || row?.name || "";
  return part ? `${tableId}|${part}` : "";
};
globalThis.formatSilver = (n) => Math.round(n).toLocaleString("en-US");
globalThis.getProfitClass = () => "profit-high";

// The real Transport Ox capacity and the real formula (js/calculations.js);
// only the weight TABLE is synthetic, so an assertion can name its own kg.
const OX_CAPACITY_KG = 3200;
const WEIGHTS = { LIGHT: 0.1, HEAVY: 32, MID: 6.4, BOULDER: 5000 };
globalThis.getItemWeight = (id) => WEIGHTS[String(id).split("@")[0]] ?? 1;
globalThis.calculateOxLoad = (profitPerItem, weightPerItem) => {
  if (!weightPerItem || weightPerItem <= 0) return { itemsPerLoad: 0, profitPerLoad: 0 };
  const itemsPerLoad = Math.floor(OX_CAPACITY_KG / weightPerItem);
  return { itemsPerLoad, profitPerLoad: profitPerItem * itemsPerLoad };
};
globalThis.formatPriceAge = (dateStr) => {
  if (!dateStr) return null;
  const ms = Date.now() - Date.parse(dateStr);
  if (!Number.isFinite(ms)) return null;
  return ms < 3600000
    ? { label: `${Math.round(ms / 60000)}m ago`, color: "#5e9e78" }
    : { label: `${Math.round(ms / 3600000)}h ago`, color: "#9e8840" };
};

const freshness = require(path.join(__dirname, "..", "js", "price-freshness.js"));
const { readIndexHtml } = require("./helpers/page-source.cjs");
globalThis.bookEmptySince = freshness.bookEmptySince;
globalThis.priceDateFor = freshness.priceDateFor;
globalThis.getOrderType = () => "instant";

let _own = {};
globalThis.isOwnMarketPrice = (itemId, quality, city, side, price) =>
  _own[[itemId, quality, city, side, price].join("|")] === true;

// Faithful priceTd: the board's sell/input cells go through the real
// joinedSellCell, which needs it defined to render an editable cell at all —
// and its `note` slot is where the quality ladder prints. Records the
// quality/note threading for the assertions below.
const priceTdCalls = [];
globalThis.priceTd = function (price, itemId, city, side = "sell", extraClass = "silver-val",
                               showCity = false, quality = null, sideOverride = false, note = "") {
  priceTdCalls.push({ price, itemId, city, side, quality, sideOverride, note });
  const q = quality != null ? ` data-quality="${quality}"` : "";
  return `<td class="${extraClass} cell-num price-editable" data-item-id="${itemId}"`
    + ` data-city="${city}" data-city-list="${side}"${q}>${globalThis.formatSilver(price)}${note || ""}</td>`;
};

// The REAL quality chip, sliced out of js/render-flipping.js — which, whole,
// needs a browser's worth of globals to compile. The anchors fail loudly if
// the function moves; the chip's own behavior is covered by
// tests/flipping-quality-row.test.cjs.
const flipSrc = fs.readFileSync(path.join(__dirname, "..", "js", "render-flipping.js"), "utf8");
const chipStart = flipSrc.indexOf("const FLIP_QUALITY_NAMES");
const chipEnd = flipSrc.indexOf("function flipQualityNote");
assert.ok(chipStart >= 0 && chipEnd > chipStart,
  "could not locate flipQualityChip in render-flipping.js");
const chipMod = new Module("bm-board-chip");
chipMod._compile(
  `function tx(en) { return en; }\n${flipSrc.slice(chipStart, chipEnd)}`
  + "\nmodule.exports = { flipQualityChip };",
  "render-flipping.js",
);
globalThis.flipQualityChip = chipMod.exports.flipQualityChip;

const BM = require(path.join(__dirname, "..", "js", "render-bm-board.js"));
const { getTableSpecificSortValue } = require(path.join(__dirname, "..", "js", "sorting-values-tables.js"));

globalThis.tableState = {};
function setTables(map) {
  globalThis.tableState = {};
  Object.entries(map).forEach(([id, rows]) => {
    globalThis.tableState[id] = { data: rows };
  });
}

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    _own = {};
    globalThis.lastMarketData = {};
    globalThis.lastQualityMarketData = {};
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    if (process.env.VERBOSE) console.error(e.stack);
    failed++;
  }
}

const MIN_5 = new Date(Date.now() - 5 * 60000).toISOString();
const HOURS_3 = new Date(Date.now() - 3 * 3600000).toISOString();

function flipRow(id, profit, sellCity = "Black Market", vol = 100) {
  return {
    item: { id, name: id }, tier: 8,
    buy: { city: "Caerleon", price: 1000 },
    sell: { city: sellCity, price: 1000 + profit },
    marginInfo: { profit, margin: 50 },
    dailyVol: vol,
  };
}

function craftRow(id, profit, sellCity = "Black Market") {
  return {
    item: { id, name: id },
    craftCity: "Lymhurst",
    sellGear: { city: sellCity, price: 100000 },
    totalInputCost: 100000 - profit,
    marginInfo: { profit, margin: 40 },
    sellVol: 100,
    focusCost: 500,
    profitPer10kFocus: profit * 20,
  };
}

/** A Consumables row (js/joined-summary-sources.js) — the reported bogus source. */
function potionRow(id, profit, sellCity = "Black Market") {
  return {
    item: { id, name: id },
    craftCity: "Caerleon",
    buyMat: { city: "Caerleon", price: 426 },
    sellPot: { city: sellCity, price: 426 + profit },
    totalInputCost: 426,
    marginInfo: { profit, margin: 16 },
    dailyVol: 442843,
  };
}

// ── what reaches the board ─────────────────────────────────────────────────

console.log("\n=== only plays that sell at the Black Market ===");

test("a royal-city play never reaches the board", () => {
  setTables({ "flipping-table": [flipRow("A", 5000, "Martlock")] });
  assert.strictEqual(BM.collectBlackMarketRows().length, 0);
});

test("a Black Market play does", () => {
  setTables({ "flipping-table": [flipRow("A", 5000)] });
  const rows = BM.collectBlackMarketRows();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].sellCity, "Black Market");
});

// The Black Market's book is the mob loot table read backwards: equipment only
// (js/black-market-items.js). Reported: the board offered "sell Potatoes
// [T6 Ingredient] at the Black Market", plus two fish, none of which the
// merchant has ever bought. js/utils.js refuses to price those legs now, but a
// feeder that prices itself can still hand the board a finished row, so the
// board drops them too.
test("a play that sells something the Black Market does not buy is dropped", () => {
  setTables({
    "consumable-table": [potionRow("T6_POTATO", 69), potionRow("T7_FISH_FRESHWATER_HIGHLANDS_RARE", 11106)],
    "flipping-table": [flipRow("T8_MAIN_SWORD", 5000)],
  });
  const board = BM.collectBlackMarketRows();
  assert.deepStrictEqual(board.map((r) => r.sellItemId), ["T8_MAIN_SWORD"]);
});

test("gear of every kind the merchant deals in stays on the board", () => {
  const gear = [
    "T8_MAIN_SWORD", "T7_2H_BOW", "T6_MAIN_FIRESTAFF", "T5_OFF_SHIELD",
    "T4_ARMOR_PLATE_SET1", "T4_CAPE", "T6_BAG", "T5_2H_TOOL_PICK",
    "T6_BACKPACK_GATHERER_ORE",
  ];
  setTables({ "flipping-table": gear.map((id, i) => flipRow(id, 5000 + i)) });
  assert.strictEqual(BM.collectBlackMarketRows().length, gear.length);
});

// A Laborers cycle sells a MIX — no single item to judge, and its own feeder
// chose the city. It must not be filtered out by an id it does not have.
test("a row with no sell item id is kept", () => {
  assert.strictEqual(BM.bmBoardSellable({ sellItemId: null }), true);
  assert.strictEqual(BM.bmBoardSellable({}), true);
});

test("every feeder that can reach the Black Market is eligible", () => {
  setTables({
    "flipping-table": [flipRow("F", 5000)],
    "crafting-table": [craftRow("C", 9000)],
  });
  const tables = BM.collectBlackMarketRows().map((r) => r.tableId).sort();
  assert.deepStrictEqual(tables, ["crafting-table", "flipping-table"]);
});

// The whole reason the gate is an extraFilter on collectJoinedBoard rather than
// a filter on the finished board: a feeder is ranked ten deep, and its Black
// Market plays are usually not its ten richest.
test("a Black Market play outside its own table's top ten still reaches the board", () => {
  const rows = Array.from({ length: 30 }, (_, i) => flipRow(`F${i}`, 100000 + i, "Martlock"));
  rows.push(flipRow("BM_ONE", 500, "Black Market"));
  setTables({ "flipping-table": rows });
  const board = BM.collectBlackMarketRows();
  assert.strictEqual(board.length, 1);
  assert.strictEqual(board[0].itemName, "BM_ONE [T8]");
});

test("the board is ranked by pure profit, richest first", () => {
  setTables({
    "flipping-table": [flipRow("A", 100), flipRow("C", 9000), flipRow("B", 3000)],
  });
  assert.deepStrictEqual(
    BM.collectBlackMarketRows().map((r) => r.pureProfit),
    [9000, 3000, 100],
  );
});

// Not a Top 10. The two boards above curate the whole app down to ten plays;
// this one is already narrowed to a single destination, so a cap would hide
// real Black Market plays rather than rank them.
test("every qualifying play is listed, not the ten best", () => {
  setTables({
    "flipping-table": Array.from({ length: 25 }, (_, i) => flipRow(`F${i}`, 1000 + i)),
  });
  assert.strictEqual(BM.collectBlackMarketRows().length, 25);
});

test("one feeder may contribute more than ten rows on its own", () => {
  setTables({
    "flipping-table": Array.from({ length: 40 }, (_, i) => flipRow(`F${i}`, 1000 + i)),
    "crafting-table": [craftRow("C", 500)],
  });
  const rows = BM.collectBlackMarketRows();
  assert.strictEqual(rows.length, 41);
  assert.strictEqual(rows.filter((r) => r.tableId === "flipping-table").length, 40);
});

// The cap is gone; the profitability gate is not. A board of losing plays would
// be a census, which is what pickTopNBy has always refused to produce.
test("a play that loses silver is still left off", () => {
  setTables({
    "flipping-table": [flipRow("WIN", 5000), flipRow("FLAT", 0), flipRow("LOSS", -3000)],
  });
  assert.deepStrictEqual(
    BM.collectBlackMarketRows().map((r) => r.itemName),
    ["WIN [T8]"],
  );
});

test("an empty tableState is an empty board, not a crash", () => {
  setTables({});
  assert.deepStrictEqual(BM.collectBlackMarketRows(), []);
});

test("a feeder whose rows carry no sell city contributes nothing", () => {
  setTables({ "flipping-table": [{ item: { id: "X", name: "X" }, tier: 8, marginInfo: { profit: 9 } }] });
  assert.strictEqual(BM.collectBlackMarketRows().length, 0);
});

// Rerolling reaches the Black Market like any other feeder: its Caerleon branch
// sells to ["Caerleon", "Black Market"] (js/render-rerolling.js:47). Its rows
// price a SPECIFIC quality — the transition's target — so the board's bid must
// be read from that quality's book, not from the flat Normal one.
function rerollRow(id, profit, to = 3, sellCity = "Black Market") {
  return {
    item: { id, name: id }, tier: 8,
    transition: { from: 1, to },
    transitionLabel: "Normal → Outstanding",
    buyCity: "Caerleon", buyPrice: 1000,
    sellCity, sellPrice: 100000,
    totalInputCost: 100000 - profit,
    marginInfo: { profit, margin: 30 },
  };
}

test("a Quality Rerolling play that sells at the Black Market is on the board", () => {
  setTables({ "rerolling-table": [rerollRow("T8_2H_WILDSTAFF", 7000)] });
  const rows = BM.collectBlackMarketRows();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].tableId, "rerolling-table");
  assert.strictEqual(rows[0].category, "Quality Rerolling");
  assert.strictEqual(rows[0].sellQuality, 3, "the transition's target quality");
});

test("a Quality Rerolling play that sells in a royal city is not", () => {
  setTables({ "rerolling-table": [rerollRow("T8_2H_WILDSTAFF", 7000, 3, "Caerleon")] });
  assert.strictEqual(BM.collectBlackMarketRows().length, 0);
});

test("a rerolling row's bid age is read from the target quality's book", () => {
  setTables({ "rerolling-table": [rerollRow("T8_2H_WILDSTAFF", 7000, 4)] });
  globalThis.lastMarketData = {
    T8_2H_WILDSTAFF: { "Black Market": { buy_price: 1, buy_date: MIN_5 } },
  };
  globalThis.lastQualityMarketData = {
    T8_2H_WILDSTAFF: {
      4: { "Black Market": { buy_price: 100000, buy_date: HOURS_3, buy_seen: MIN_5 } },
    },
  };
  const row = BM.collectBlackMarketRows()[0];
  assert.ok(BM.bmBoardAgeCell(row).includes("gone"));
});

// ── a flipping row's quality ────────────────────────────────────────────────
//
// The board's biggest feeder prices a SPECIFIC quality — js/flip-route-quality.js
// routes each quality's book on its own, the Black Market's included — and its
// rows carry it. The source used to drop that field, leaving a Good bid on the
// board reading as a Normal one: no chip, a Bid Age taken from the wrong book,
// and an override key the flipping table would never match.

console.log("\n=== a flipping row's quality ===");

function qualityFlipRow(id, profit, quality) {
  return { ...flipRow(id, profit), quality };
}

test("a quality flip landing on the board publishes its sellQuality", () => {
  setTables({ "flipping-table": [qualityFlipRow("T8_2H_WILDSTAFF", 7000, 2)] });
  const rows = BM.collectBlackMarketRows();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].sellQuality, 2, "the quality the pair was priced at");
});

test("a Normal flip publishes none — quality 1 IS the flat book", () => {
  setTables({ "flipping-table": [qualityFlipRow("T8_2H_WILDSTAFF", 7000, 1)] });
  assert.strictEqual(BM.collectBlackMarketRows()[0].sellQuality, null);
});

test("a quality flip's sell cell is keyed to its quality", () => {
  setTables({ "flipping-table": [qualityFlipRow("T8_2H_WILDSTAFF", 7000, 2)] });
  priceTdCalls.length = 0;
  BM.formatBmBoardRow(BM.collectBlackMarketRows()[0], 0);
  const sell = priceTdCalls.find((x) => x.side === "sell");
  assert.ok(sell, "the bid cell rendered");
  assert.strictEqual(sell.quality, 2, "the same key the flipping table writes");
});

test("a quality flip's bid age is read from its own quality's book", () => {
  setTables({ "flipping-table": [qualityFlipRow("T8_2H_WILDSTAFF", 7000, 2)] });
  // Two clocks, one discriminator: the flat Normal book's bid is three hours
  // old, the Good book's five minutes. The bid was priced from the Good book,
  // so the cell that says "3h ago" read the wrong one.
  globalThis.lastMarketData = {
    T8_2H_WILDSTAFF: { "Black Market": { buy_price: 1, buy_date: HOURS_3 } },
  };
  globalThis.lastQualityMarketData = {
    T8_2H_WILDSTAFF: {
      2: { "Black Market": { buy_price: 8000, buy_date: MIN_5 } },
    },
  };
  const row = BM.collectBlackMarketRows()[0];
  const cell = BM.bmBoardAgeCell(row);
  assert.ok(cell.includes("5m ago"), cell);
  assert.ok(!cell.includes("3h"), cell);
});

test("the player's own quality bid says so", () => {
  setTables({ "flipping-table": [qualityFlipRow("T8_2H_WILDSTAFF", 7000, 2)] });
  globalThis.lastQualityMarketData = {
    T8_2H_WILDSTAFF: { 2: { "Black Market": { buy_price: 8000, buy_date: MIN_5 } } },
  };
  _own[["T8_2H_WILDSTAFF", 2, "Black Market", "sell", 8000].join("|")] = true;
  const row = BM.collectBlackMarketRows()[0];
  assert.ok(BM.bmBoardAgeCell(row).includes("yours"));
});

// ── the bid-age column ─────────────────────────────────────────────────────

console.log("\n=== the Bid Age column ===");

const boardRow = (over = {}) => ({
  sellItemId: "T8_2H_WILDSTAFF", sellQuality: 1, sellPrice: 838798, ...over,
});

test("a fresh bid prints its age", () => {
  globalThis.lastMarketData = {
    T8_2H_WILDSTAFF: { "Black Market": { buy_price: 838798, buy_date: MIN_5 } },
  };
  const cell = BM.bmBoardAgeCell(boardRow());
  assert.ok(cell.includes("5m ago"), cell);
});

test("a bid the book was read without says it is gone", () => {
  globalThis.lastMarketData = {
    T8_2H_WILDSTAFF: {
      "Black Market": { buy_price: 838798, buy_date: HOURS_3, buy_seen: MIN_5 },
    },
  };
  assert.ok(BM.bmBoardAgeCell(boardRow()).includes("gone"));
});

test("the player's own order says so, and outranks the age", () => {
  globalThis.lastMarketData = {
    T8_2H_WILDSTAFF: { "Black Market": { buy_price: 838798, buy_date: MIN_5 } },
  };
  _own[["T8_2H_WILDSTAFF", 1, "Black Market", "sell", 838798].join("|")] = true;
  const cell = BM.bmBoardAgeCell(boardRow());
  assert.ok(cell.includes("yours"), cell);
  assert.ok(!cell.includes("5m ago"));
});

test("a quality above Normal is read from its own book", () => {
  globalThis.lastMarketData = {
    T8_2H_WILDSTAFF: { "Black Market": { buy_price: 1, buy_date: MIN_5 } },
  };
  globalThis.lastQualityMarketData = {
    T8_2H_WILDSTAFF: {
      3: { "Black Market": { buy_price: 500, buy_date: HOURS_3, buy_seen: MIN_5 } },
    },
  };
  assert.ok(BM.bmBoardAgeCell(boardRow({ sellQuality: 3, sellPrice: 500 })).includes("gone"));
});

test("a row with no priced item id prints a dash rather than guessing", () => {
  assert.ok(BM.bmBoardAgeCell(boardRow({ sellItemId: null })).includes("—"));
});

test("an unpriced book prints a dash", () => {
  globalThis.lastMarketData = { T8_2H_WILDSTAFF: {} };
  assert.ok(BM.bmBoardAgeCell(boardRow()).includes("—"));
});

// ── the Profit/Ox column ───────────────────────────────────────
//
// Every play on this board ends somewhere you have to HAUL to, so the board
// borrows the Flipping table's silver-per-ox-load figure. Two things matter:
// it is driven by the item's WEIGHT, and it refuses to multiply a profit that
// is not per sold unit (`sellUnits: null`) — doing that would inflate a
// per-cycle figure by the whole batch.

console.log("\n=== the Profit/Ox column ===");

function farmRow(seedId, cropId, profit, sellCity = "Black Market") {
  return {
    item: { id: seedId, name: seedId, outputId: cropId },
    buySeed: { city: "Martlock", price: 100 },
    sellCrop: { city: sellCity, price: 1000 },
    totalInputCost: 1000 - profit,
    marginInfo: { profit, margin: 20 },
    dailyVol: 50,
  };
}

function laborerRow(profit, trophyId, sellCity = "Black Market") {
  return {
    item: { name: "Trophy Laborer" }, mode: "trophy", trophyId,
    buy: { city: "Bridgewatch", price: 100 },
    sell: { city: sellCity, price: 5000 },
    totalInputCost: 5000 - profit,
    marginInfo: { profit, margin: 25 },
  };
}

test("a play's Profit/Ox is its profit times the items an ox carries", () => {
  setTables({ "flipping-table": [flipRow("MID", 5000)] });
  const row = BM.collectBlackMarketRows()[0];
  // 3200 kg / 6.4 kg = 500 items, each worth 5,000.
  assert.strictEqual(row.oxLoad.itemsPerLoad, 500);
  assert.strictEqual(row.oxLoad.profitPerLoad, 2500000);
});

test("the column is weight-driven: same profit, different haul", () => {
  setTables({ "flipping-table": [flipRow("LIGHT", 1000), flipRow("HEAVY", 1000)] });
  const byName = {};
  BM.collectBlackMarketRows().forEach((r) => { byName[r.sellItemId] = r.oxLoad.profitPerLoad; });
  assert.strictEqual(byName.LIGHT, 32000 * 1000);
  assert.strictEqual(byName.HEAVY, 100 * 1000);
  assert.ok(byName.LIGHT > byName.HEAVY, "the light item hauls better on the same margin");
});

test("a crafting play is hauled by the gear it sells, not by its inputs", () => {
  setTables({ "crafting-table": [craftRow("HEAVY", 9000)] });
  const row = BM.collectBlackMarketRows()[0];
  assert.strictEqual(row.oxLoad.itemsPerLoad, 100);
  assert.strictEqual(row.oxLoad.profitPerLoad, 900000);
});

// The gate. These feeders price a CYCLE, not one sold item.
test("a farming cycle carries no Profit/Ox at all", () => {
  setTables({ "farming-table": [farmRow("SEED", "LIGHT", 4000)] });
  const row = BM.collectBlackMarketRows()[0];
  assert.strictEqual(row.sellUnits, null);
  assert.strictEqual(row.oxLoad, null);
  assert.strictEqual(row.pureProfit, 4000, "the gate touches nothing else");
});

test("a laborer cycle carries none either, trophy id or not", () => {
  setTables({ "laborers-table": [laborerRow(4000, "LIGHT")] });
  assert.strictEqual(BM.collectBlackMarketRows()[0].oxLoad, null);
  setTables({ "laborers-table": [laborerRow(4000, null)] });
  assert.strictEqual(BM.collectBlackMarketRows()[0].oxLoad, null);
});

test("a play whose sold item has no id prints nothing rather than guessing", () => {
  assert.strictEqual(BM.bmBoardOxLoad({ sellItemId: null, sellUnits: 1, pureProfit: 5000 }), null);
});

test("an item too heavy for a single ox load carries no figure", () => {
  assert.strictEqual(
    BM.bmBoardOxLoad({ sellItemId: "BOULDER", sellUnits: 1, pureProfit: 5000 }),
    null,
    "nothing fits, so there is no load to price",
  );
});

test("a play covering more than one unit divides before it multiplies", () => {
  const one = BM.bmBoardOxLoad({ sellItemId: "MID", sellUnits: 1, pureProfit: 4000 });
  const four = BM.bmBoardOxLoad({ sellItemId: "MID", sellUnits: 4, pureProfit: 4000 });
  assert.strictEqual(four.profitPerLoad, one.profitPerLoad / 4);
});

// ── sorting ─────────────────────────────────────────────────

console.log("\n=== sorting the Profit/Ox column ===");

test("the board answers profitPerLoad off the row", () => {
  const row = { oxLoad: { itemsPerLoad: 500, profitPerLoad: 2500000 } };
  assert.strictEqual(
    getTableSpecificSortValue(row, "profitPerLoad", "bm-board-table"),
    2500000,
  );
});

test("a row with no haul sorts below every row that has one", () => {
  assert.strictEqual(
    getTableSpecificSortValue({ oxLoad: null, pureProfit: 900000 }, "profitPerLoad", "bm-board-table"),
    -Infinity,
  );
});

// ── the rendered row and the markup around it ────────────────────────

console.log("\n=== the rendered cell ===");

test("the cell prints the haul, and a dash when there is none", () => {
  setTables({ "flipping-table": [flipRow("MID", 5000)] });
  const priced = BM.formatBmBoardRow(BM.collectBlackMarketRows()[0], 0);
  assert.ok(priced.includes("2,500,000"), priced);
  setTables({ "farming-table": [farmRow("SEED", "LIGHT", 4000)] });
  const dashed = BM.formatBmBoardRow(BM.collectBlackMarketRows()[0], 0);
  assert.strictEqual((dashed.match(/<td[^>]*>/g) || []).length, 12, "twelve columns");
  assert.ok(dashed.includes("—"), dashed);
});

test("the row renders exactly as many cells as the header declares", () => {
  setTables({ "flipping-table": [flipRow("MID", 5000)] });
  const html = BM.formatBmBoardRow(BM.collectBlackMarketRows()[0], 0);
  assert.strictEqual((html.match(/<td[^>]*>/g) || []).length, BM.BM_BOARD_COLS);
});

test("index.html declares the column, and the empty state spans it", () => {
  const html = readIndexHtml();
  const start = html.indexOf('<table id="bm-board-table"');
  assert.ok(start > 0, "the board's table");
  const table = html.slice(start, html.indexOf("</table>", start));
  assert.ok(table.includes('data-sort="profitPerLoad"'), "the column is sortable");
  assert.ok(table.includes('data-i18n="profit_ox"'), "and reuses the Flipping label");
  const heads = table.slice(0, table.indexOf("</thead>"));
  assert.strictEqual((heads.match(/<th[ >]/g) || []).length, BM.BM_BOARD_COLS);
  assert.ok(table.includes('colspan="12"'), "the empty state spans the new width");
});

// ── the Item cell's quality chip and the bid ladder ─────────────────────────
//
// Two displays the board owed: WHICH quality a row's number is keyed under
// (the chip — Flipping and Rerolling rows carry one), and, for the feeders
// that have no quality of their own (Crafting, Enchanting, Transmute — all
// priced from the Normal-only flat book), what the Black Market bids for the
// OTHER qualities of the same item. The second is display-only: it reads the
// per-quality books capture and the scans already keep, and prices nothing.

console.log("\n=== the Item cell's chip and the bid ladder ===");

test("a quality flip's Item cell wears its chip", () => {
  setTables({ "flipping-table": [qualityFlipRow("T8_2H_WILDSTAFF", 7000, 2)] });
  const html = BM.formatBmBoardRow(BM.collectBlackMarketRows()[0], 0);
  assert.ok(html.includes("qual-chip"), html);
  assert.ok(html.includes("Q2"), html);
});

test("a Normal flip's Item cell wears none", () => {
  setTables({ "flipping-table": [qualityFlipRow("T8_2H_WILDSTAFF", 7000, 1)] });
  const html = BM.formatBmBoardRow(BM.collectBlackMarketRows()[0], 0);
  assert.ok(!html.includes("qual-chip"), html);
});

test("a Normal-priced play shows quality breakdown in both Bid and Pure Profit cells", () => {
  setTables({ "crafting-table": [craftRow("T8_2H_WILDSTAFF", 7000)] });
  globalThis.lastMarketData = {
    T8_2H_WILDSTAFF: { "Black Market": { buy_price: 100000, buy_date: MIN_5 } },
  };
  globalThis.lastQualityMarketData = {
    T8_2H_WILDSTAFF: {
      3: { "Black Market": { buy_price: 150000, buy_date: HOURS_3 } },
    },
  };
  const html = BM.formatBmBoardRow(BM.collectBlackMarketRows()[0], 0);
  assert.ok(html.includes("qual-breakdown"), "the ladder renders under the bid and profit");
  assert.ok(html.includes("150,000"), "the Outstanding bid the flat book cannot show");
  assert.ok(html.includes("3h ago"), "each line dated from its own book");
  assert.ok(html.includes("▸Q1"), "the row's own Normal number is marked");
  // Exactly 2 marked lines: one in Bid cell, one in Pure Profit cell
  assert.strictEqual((html.match(/qbrk-take/g) || []).length, 2);
  // Pure profit has breakdown
  assert.ok(html.includes("53,750") || html.includes("55,000"), "calculated profit for Q3 is present in profit breakdown");
});

test("a Normal-only book renders 1-line quality breakdown in Bid and Pure Profit cells", () => {
  setTables({ "crafting-table": [craftRow("T8_2H_WILDSTAFF", 7000)] });
  globalThis.lastMarketData = {
    T8_2H_WILDSTAFF: { "Black Market": { buy_price: 100000, buy_date: MIN_5 } },
  };
  const html = BM.formatBmBoardRow(BM.collectBlackMarketRows()[0], 0);
  assert.ok(html.includes("qual-breakdown"), "quality breakdown is shown for single quote");
  assert.ok(html.includes("▸Q1"), "shows Q1 marker");
  assert.strictEqual((html.match(/qbrk-take/g) || []).length, 2);
});

test("the board still renders twelve cells with a ladder in the bid and profit cells", () => {
  setTables({ "crafting-table": [craftRow("T8_2H_WILDSTAFF", 7000)] });
  globalThis.lastMarketData = {
    T8_2H_WILDSTAFF: { "Black Market": { buy_price: 100000, buy_date: MIN_5 } },
  };
  globalThis.lastQualityMarketData = {
    T8_2H_WILDSTAFF: { 3: { "Black Market": { buy_price: 150000, buy_date: HOURS_3 } } },
  };
  const html = BM.formatBmBoardRow(BM.collectBlackMarketRows()[0], 0);
  assert.strictEqual((html.match(/<td[^>]*>/g) || []).length, BM.BM_BOARD_COLS);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
