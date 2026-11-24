/**
 * Test: the Consumables no-data row keeps every price cell editable.
 *
 * Bug (reported): "when prices unavailable consumables table just shows '-' and
 * doesn't let me set prices manually". js/render-consumables.js replaced the
 * whole priced half of an unpriced row with eight dead "—" cells: no ingredient
 * spans, no sell-price cell, and a plain-text Route column. That is the one
 * state a price cell exists FOR, and it was the only state without one. The row
 * was also 11 <td>s in a 12-column table (index.html), so it sat misaligned.
 *
 * Every other table renders the editable cell at price 0 — priceTd and
 * matPriceSpan (js/app.js) both emit "no data — click to set" inside a cell that
 * is still class="price-editable". The Crafting table's own no-data branch
 * (js/render-crafting.js) is the reference: real prices + source city for the
 * inputs that HAVE one, the lone blocker isolated as "no data".
 *
 * Black-box: feed row objects straight to the real renderConsumableNoDataRow and
 * read the HTML it returns. The cell helpers are stubbed with the same class
 * names the real ones emit (same approach as show-all-no-data-rows.test.cjs).
 *
 * Run: node tests/consumables-no-data-editable.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

// Stubs mirroring the real helpers' observable contract: the class name and the
// data attributes the delegated click handler in js/app.js reads.
const stubs = `
const CRAFT_CITIES = ["Caerleon","Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const SELL_CITIES = [...CRAFT_CITIES, "Black Market"];
let _market = {};
let _forces = {};
function __setMarket(m) { _market = m || {}; }
function __setForces(f) { _forces = f || {}; }
function tx(en) { return en; }
function getItemDisplayName(id) { return id; }
function addTdForKey() { return '<td class="cell-add"><button></button></td>'; }
function getCityForce(itemId, side) { return _forces[itemId + ":" + side] || null; }
function isInvalidCrossRoute(a, b) {
  const caer = (c) => c === "Caerleon" || c === "Black Market";
  return caer(a) !== caer(b);
}
function getSellPrice(itemData, city) {
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].sell_price || 0;
}
function getConsumableCraftType(id) { return id.includes("_POTION_") ? "potion" : "food"; }
function bestMatBuySource(matId, craftCity) {
  const data = _market[matId] || {};
  let bestCity = null, bestPrice = 0;
  for (const city of CRAFT_CITIES) {
    if (isInvalidCrossRoute(city, craftCity)) continue;
    const p = (data[city] && data[city].buy_price) || 0;
    if (p > 0 && (bestCity === null || p < bestPrice)) { bestPrice = p; bestCity = city; }
  }
  return { price: bestCity ? bestPrice : 0, city: bestCity };
}
function matPriceSpan(matId, city, price) {
  return '<span class="price-editable mat-price-inline" data-item-id="' + matId
    + '" data-city="' + (city || "") + '" data-city-list="buy">@ '
    + (price > 0 ? price : "no data") + ' ea</span>';
}
function priceTd(price, itemId, city) {
  const body = price > 0 ? String(price) : "no data — click to set";
  return '<td class="cell-num price-editable" data-item-id="' + itemId
    + '" data-city="' + city + '" data-city-list="sell">' + body + '</td>';
}
function aggregateCostTd(cost, extraClass) {
  return '<td class="' + (extraClass || "") + '">' + (cost > 0 ? cost : "—") + '</td>';
}
`;

const mod = new Module("consumables-no-data-editable");
mod._compile(
  stubs + J("route-cell.js") + J("render-consumable-no-data-row.js")
    + "\nmodule.exports = { renderConsumableNoDataRow, __setMarket, __setForces };",
  "consumables-no-data-editable.js",
);
const { renderConsumableNoDataRow, __setMarket, __setForces } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name + " — " + e.message); failed++; }
}

const NAME_CELL = '<td class="cell-item">Pie</td>';

/** Count <td> opens — the row's column count. */
const tdCount = (html) => (html.match(/<td[\s>]/g) || []).length;

// A T6 pie whose recipe is flour + butter + meat. Flour and butter are listed;
// the meat is the blocker nothing has priced, which is why the row collapsed.
const PIE = { id: "T6_MEAL_PIE", name: "Pie" };
const PIE_MATS = [
  { matId: "T6_FLOUR", count: 1 },
  { matId: "T6_BUTTER", count: 1 },
  { matId: "T6_MEAT", count: 5 },
];
const MARKET = {
  T6_FLOUR: { Martlock: { buy_price: 400, sell_price: 450 } },
  T6_BUTTER: { Lymhurst: { buy_price: 900, sell_price: 950 } },
};

function craftRow(extra) {
  return Object.assign(
    { item: PIE, mats: PIE_MATS, marginInfo: { margin: -1 } },
    extra || {},
  );
}

console.log("Consumables no-data row — editable cells\n");

test("renders exactly 12 columns, matching the table header", () => {
  __setMarket(MARKET); __setForces({});
  const html = renderConsumableNoDataRow(craftRow(), "T6_MEAL_PIE", NAME_CELL, MARKET);
  assert.strictEqual(tdCount(html), 12, "got " + tdCount(html) + " <td>s:\n" + html);
});

test("the sell price cell is editable even at price 0", () => {
  __setMarket(MARKET); __setForces({});
  const html = renderConsumableNoDataRow(craftRow(), "T6_MEAL_PIE", NAME_CELL, MARKET);
  assert.ok(
    /<td[^>]*class="[^"]*price-editable[^"]*"[^>]*data-item-id="T6_MEAL_PIE"/.test(html),
    "no editable sell cell for the consumable itself",
  );
  assert.ok(html.includes("click to set"), "sell cell does not invite an edit");
});

test("the sell cell names a real city, never null", () => {
  __setMarket(MARKET); __setForces({});
  const html = renderConsumableNoDataRow(craftRow(), "T6_MEAL_PIE", NAME_CELL, MARKET);
  const m = html.match(/data-item-id="T6_MEAL_PIE"\s+data-city="([^"]*)"/);
  assert.ok(m, "sell cell missing");
  assert.ok(m[1] && m[1] !== "null" && m[1] !== "undefined", 'bad sell city "' + (m && m[1]) + '"');
});

test("every ingredient gets its own editable span", () => {
  __setMarket(MARKET); __setForces({});
  const html = renderConsumableNoDataRow(craftRow(), "T6_MEAL_PIE", NAME_CELL, MARKET);
  for (const m of PIE_MATS) {
    assert.ok(
      html.includes('data-item-id="' + m.matId + '"'),
      m.matId + " has no editable price span",
    );
  }
});

test("priced ingredients show their real price and source city", () => {
  __setMarket(MARKET); __setForces({});
  const html = renderConsumableNoDataRow(craftRow(), "T6_MEAL_PIE", NAME_CELL, MARKET);
  assert.ok(/data-item-id="T6_FLOUR" data-city="Martlock"[^>]*>@ 400 /.test(html),
    "flour did not keep its live price / source city");
  assert.ok(/data-item-id="T6_BUTTER" data-city="Lymhurst"[^>]*>@ 900 /.test(html),
    "butter did not keep its live price / source city");
});

test("the lone unpriced ingredient is the only one reading 'no data'", () => {
  __setMarket(MARKET); __setForces({});
  const html = renderConsumableNoDataRow(craftRow(), "T6_MEAL_PIE", NAME_CELL, MARKET);
  const matNoData = (html.match(/mat-price-inline[^>]*>@ no data /g) || []).length;
  assert.strictEqual(matNoData, 1, "expected 1 unpriced ingredient, got " + matNoData);
  assert.ok(/data-item-id="T6_MEAT"[^>]*>@ no data /.test(html), "the blocker is not the meat");
});

test("the sell leg of the Route column is click-to-edit", () => {
  __setMarket(MARKET); __setForces({});
  const html = renderConsumableNoDataRow(craftRow(), "T6_MEAL_PIE", NAME_CELL, MARKET);
  assert.ok(/class="price-editable route-city"[^>]*data-item-id="T6_MEAL_PIE"/.test(html),
    "route sell city is dead text");
});

test("a leaf row with no recipe still edits both route legs", () => {
  __setMarket({}); __setForces({});
  const leaf = { item: { id: "T6_CARROT", name: "Carrot" }, marginInfo: { margin: -1 } };
  const html = renderConsumableNoDataRow(leaf, "T6_CARROT", NAME_CELL, {});
  assert.strictEqual(tdCount(html), 12, "got " + tdCount(html) + " <td>s");
  assert.ok(/route-city[^>]*data-city-list="buy"/.test(html), "no editable buy leg");
  assert.ok(/route-city[^>]*data-city-list="sell"/.test(html), "no editable sell leg");
});

test("a royal-section row never sells in Caerleon or the Black Market", () => {
  __setMarket(MARKET); __setForces({});
  const html = renderConsumableNoDataRow(craftRow({ section: "royal" }), "k", NAME_CELL, MARKET);
  const sell = html.match(/data-item-id="T6_MEAL_PIE"\s+data-city="([^"]*)"/);
  assert.notStrictEqual(sell[1], "Caerleon", "royal row sells in Caerleon");
  assert.notStrictEqual(sell[1], "Black Market", "royal row sells to the Black Market");
});

test("a Caerleon-section row crafts in Caerleon", () => {
  __setMarket(MARKET); __setForces({});
  const html = renderConsumableNoDataRow(craftRow({ section: "caerleon" }), "k", NAME_CELL, MARKET);
  assert.ok(html.includes("Caerleon"), "Caerleon section did not land in Caerleon");
});

test("a reachable sell-city pin wins the sell cell", () => {
  __setMarket(MARKET); __setForces({ "T6_MEAL_PIE:sell": "Thetford" });
  const html = renderConsumableNoDataRow(craftRow({ section: "royal" }), "k", NAME_CELL, MARKET);
  assert.ok(/data-item-id="T6_MEAL_PIE"\s+data-city="Thetford"/.test(html),
    "pinned sell city ignored");
});

test("an unreachable sell-city pin is dropped, not obeyed", () => {
  __setMarket(MARKET); __setForces({ "T6_MEAL_PIE:sell": "Black Market" });
  const html = renderConsumableNoDataRow(craftRow({ section: "royal" }), "k", NAME_CELL, MARKET);
  assert.ok(!/data-item-id="T6_MEAL_PIE"\s+data-city="Black Market"/.test(html),
    "royal row obeyed an unreachable Black Market pin");
});

test("a live sell price is shown rather than re-asked for", () => {
  const withSell = Object.assign({}, MARKET, {
    T6_MEAL_PIE: { Martlock: { sell_price: 7200, buy_price: 7000 } },
  });
  __setMarket(withSell); __setForces({ "T6_MEAL_PIE:sell": "Martlock" });
  const html = renderConsumableNoDataRow(craftRow({ section: "royal" }), "k", NAME_CELL, withSell);
  assert.ok(html.includes(">7200<"), "the known sell price was thrown away");
});

test("computed columns stay read-only", () => {
  __setMarket(MARKET); __setForces({});
  const html = renderConsumableNoDataRow(craftRow(), "k", NAME_CELL, MARKET);
  // One editable sell <td> only; Margin / Pure Profit / 10k / Silver-Focus /
  // Best Focus / Mats-to-buy have nothing to override.
  const editableTds = (html.match(/<td[^>]*class="[^"]*price-editable/g) || []).length;
  assert.strictEqual(editableTds, 1, "expected 1 editable <td>, got " + editableTds);
});

test("the row carries its row key", () => {
  __setMarket(MARKET); __setForces({});
  const html = renderConsumableNoDataRow(craftRow(), "T6_MEAL_PIE|Martlock", NAME_CELL, MARKET);
  assert.ok(html.includes('data-row-key="T6_MEAL_PIE|Martlock"'), "row key missing");
});

test("no item means no row", () => {
  __setMarket({}); __setForces({});
  assert.strictEqual(
    renderConsumableNoDataRow({ marginInfo: { margin: -1 } }, "k", NAME_CELL, {}),
    "",
  );
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
