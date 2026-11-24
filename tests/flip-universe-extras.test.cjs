/**
 * Test: the families js/data-flip-extras.js owns reach the Flipping board.
 *
 * Reported: "Tomes of Insight are absent from the Flipping table" - not even
 * under Show All. The Tome is one of a dozen families that no PRODUCTION catalog
 * owns (trophies, house furniture, tomes, the saltwater catch, crests, journals,
 * dungeon maps, remains, essences, mount-upgrade kits, faction tokens); they all
 * arrive through the same file and the same union, so they all appear or all
 * vanish together. This drives the real path end to end:
 *
 *   FLIP_EXTRA_IDS (js/data-flip-extras.js)
 *     -> getAllFlippingItems (js/utils.js)
 *     -> expandFlipItems (js/flip-enchant-variants.js)
 *     -> buildFlipRowsForItem (js/render-flipping.js)
 *
 * and asserts a row comes out both when the item has a book and when it has
 * none - an unpriced flip is a `noData` row that stays on the board, never a
 * silent drop.
 *
 * Only T4_SKILLBOOK_STANDARD trades: every other tier of the Tome of Insight is
 * T*_SKILLBOOK_NONTRADABLE in items.xml. The five GATHER tome lines are separate
 * items and do trade at T4-T8.
 *
 * Simulated prices only, no live API.
 *
 * Run: node tests/flip-universe-extras.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const load = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

// -- The app's own catalogs, plus stubs for everything a flip row touches ----
const utilsSrc = (load("js/utils.js") + load("js/utils-item-ids.js") + load("js/utils-overrides.js") + load("js/utils-focus-fees.js"));
const universeSlice = utilsSrc.slice(
  utilsSrc.indexOf("function getAllFlippingItems"),
  utilsSrc.indexOf("function getTransportItemIds"),
);
assert.ok(universeSlice.includes("FLIP_EXTRA_IDS"), "failed to slice getAllFlippingItems out of utils.js");

const sandbox = `
function getItemDisplayName(id) { return id; }
function getTierFromId(id) { const m = String(id).match(/^T(\\d)/); return m ? +m[1] : 0; }
function getLuxuryFlipInfo() { return null; }
function isBlackRedZoneEnabled() { return false; }
function getOrderType() { return "sell"; }
function getOverrideField() { return null; }
function getItemWeight() { return 1; }
function isSuspectMargin() { return false; }
function calculateOxLoad(profit) { return { profitPerLoad: profit }; }
function calculateFlipMargin(buy, sell) {
  const profit = sell - buy;
  return { profit, margin: buy > 0 ? (profit / buy) * 100 : -1 };
}
function getMinVol() { return 9999; }
function effectiveFlipCities(tableId, side, all) { return all; }
let testMarket = {};
function findBestFlipPair(marketData, itemId, buyCities, sellCities) {
  const book = marketData[itemId] || {};
  let best = null;
  for (const b of buyCities) {
    for (const s of sellCities) {
      const buy = book[b] && book[b].sell_price;   // you BUY from a sell order
      const sell = book[s] && book[s].buy_price;   // you SELL into a buy order
      if (!(buy > 0) || !(sell > 0)) continue;
      const profit = sell - buy;
      if (!best || profit > best.profit) best = { buyCity: b, buyPrice: buy, sellCity: s, sellPrice: sell, profit, quality: 1 };
    }
  }
  return best || { buyCity: null, sellCity: null, byQuality: [] };
}
`;

const mod = new Module("flip-universe-extras");
mod._compile(
  sandbox +
    load("js/data.js") +
    load("js/data-flip-extras.js") +
    universeSlice +
    load("js/flip-enchant-variants.js") +
    load("js/render-flipping.js") +
    "\nmodule.exports = { getAllFlippingItems, expandFlipItems, buildFlipRowsForItem, FLIP_EXTRA_IDS, FLIP_TOME_IDS, FLIP_TROPHY_IDS, FLIP_CREST_IDS, FLIP_JOURNAL_IDS };",
  "flip-universe-extras.js",
);
const {
  getAllFlippingItems, expandFlipItems, buildFlipRowsForItem,
  FLIP_EXTRA_IDS, FLIP_TOME_IDS,
} = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

const TOME = "T4_SKILLBOOK_STANDARD";
const universe = getAllFlippingItems();
const ids = new Set(universe.map((i) => i.id));
const expanded = expandFlipItems(universe, { expanded: new Set(), enchSel: "", autoLevels: () => [] });
const expandedIds = new Set(expanded.map((i) => i.id));

console.log("\n=== Flipping universe: the data-flip-extras families ===");

// -- 1. The catalog file itself ---------------------------------------------
test("the Tome of Insight is in FLIP_TOME_IDS", () => {
  assert.ok(FLIP_TOME_IDS.includes(TOME), FLIP_TOME_IDS.join(", "));
});

test("the gathering tomes are T4-T8, five lines", () => {
  const gather = FLIP_TOME_IDS.filter((id) => id.includes("_GATHER_"));
  assert.strictEqual(gather.length, 25);
});

test("FLIP_EXTRA_IDS folds the tomes in", () => {
  FLIP_TOME_IDS.forEach((id) => assert.ok(FLIP_EXTRA_IDS.includes(id), `missing ${id}`));
});

// -- 2. The union ------------------------------------------------------------
// One id per family: they share a source file and a single union line, so a
// break takes all of them at once.
const familySamples = [
  ["Tome of Insight", TOME],
  ["gathering tome", "T8_SKILLBOOK_GATHER_ORE"],
  ["laborer trophy", "T5_FURNITUREITEM_TROPHY_ORE"],
  ["house furniture", "T6_FURNITUREITEM_BED"],
  ["saltwater catch", "T6_FISH_SALTWATER_ALL_COMMON"],
  ["cape crest", "T8_CAPEITEM_UNDEAD_BP"],
  ["journal", "T7_JOURNAL_HIDE_EMPTY"],
  ["dungeon map", "T6_CORRUPTED_LETHAL_MAP"],
  ["animal remains", "T5_ALCHEMY_RARE_PANTHER"],
  ["essence", "T6_ESSENCE_POTION"],
  ["mount upgrade kit", "T8_MOUNTUPGRADE_COUGAR_KEEPER"],
  ["faction token", "QUESTITEM_TOKEN_MORGANA"],
];
for (const [label, id] of familySamples) {
  test(`getAllFlippingItems carries the ${label} (${id})`, () => {
    assert.ok(ids.has(id), `${id} missing from the ${universe.length}-item universe`);
  });
  test(`expandFlipItems keeps the ${label} on the board`, () => {
    assert.ok(expandedIds.has(id), `${id} lost in the enchant expansion`);
  });
}

test("a tome is flat - the expansion adds no .1-.4 ladder for it", () => {
  assert.ok(!expanded.some((i) => i.id.startsWith(TOME + "@")));
});

// -- 3. The row -------------------------------------------------------------
function rowsFor(id, market) {
  const item = universe.find((i) => i.id === id);
  assert.ok(item, `${id} not in the universe`);
  return buildFlipRowsForItem(item, market);
}

test("a priced tome yields a real route", () => {
  const rows = rowsFor(TOME, {
    [TOME]: {
      Martlock: { sell_price: 1_000, buy_price: 800, volume_24h: 9999 },
      Caerleon: { sell_price: 2_000, buy_price: 1_900, volume_24h: 9999 },
    },
  });
  const priced = rows.filter((r) => !r.noData);
  assert.ok(priced.length > 0, `expected a priced row, got ${JSON.stringify(rows.map((r) => r.section))}`);
  assert.ok(priced.every((r) => r.item.id === TOME));
});

test("an unpriced tome still yields a row (noData), never a silent drop", () => {
  const rows = rowsFor(TOME, {});
  assert.ok(rows.length > 0, "the row left the board entirely");
  assert.ok(rows.every((r) => r.noData));
});

test("with zone routes off the tome gets a royal and a Caerleon row", () => {
  const rows = rowsFor(TOME, {});
  assert.deepStrictEqual(rows.map((r) => r.section).sort(), ["caerleon", "royal"]);
});

test("the row's tier comes off the id", () => {
  assert.strictEqual(rowsFor(TOME, {})[0].tier, 4);
});

test("every extras family builds a row", () => {
  for (const [label, id] of familySamples) {
    assert.ok(rowsFor(id, {}).length > 0, `${label} (${id}) built no row`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
