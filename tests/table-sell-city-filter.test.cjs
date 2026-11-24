/**
 * Test: a City pick RE-PRICES the table instead of just filtering its rows.
 *
 * Every profit row keeps one sell city — the best-margin one — so a picker that
 * only hides rows can only ever surface rows that already chose the pick.
 * Measured on a real scan, that made the Black Market look arbitrary: a city
 * sale is quoted at the ask while BM is quoted at the bid, so T6_BAG@1
 * (Caerleon ask 89,999 vs BM bid 88,410) and T6_BAG@3 named a city and
 * vanished under the pick, while @2 and @4 stayed.
 *
 * So while a pick is active the row sells THERE, temporarily, and reverts the
 * moment the picker goes back to All. Zone rules are untouched: a pick the
 * craft/refine city cannot reach yields no row for that section, which is what
 * "the Caerleon section owns the Black Market routes" already meant.
 *
 * Black-box over the helper (js/table-sell-city.js) and the real planner row
 * builder + renderer. Synthetic prices, no market API, no DOM.
 *
 * Run: node tests/table-sell-city-filter.test.cjs
 */

const assert = require("assert");
const {
  computeCraftPlannerRow, setTableSellCity, getTableSellCity, sellCityFilterChanged,
  clearTableSellCities, effectiveSellCities, sellPinOverriddenByFilter,
  sellCityOptionsFor, buyCityOptionsFor, tableRepricesOnCityPick,
  __setForce, __setCrossRoute, __reset,
} = require("./helpers/craft-planner-pricing-harness.cjs");
const {
  renderCraftPlannerTable, captured,
  setTableSellCity: setRenderSellCity, clearTableSellCities: clearRenderSellCities,
  __setCrossRoute: __renderCrossRoute,
} = require("./helpers/craft-planner-render-harness.cjs");

const BM = "Black Market";
const FS = "Fort Sterling";
const PLANNER = "craft-planner-table";
const ROYAL = ["Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Brecilien"];
const ALL_SELL = ["Caerleon", ...ROYAL, BM];
const ALL_BUY = ["Caerleon", ...ROYAL];

// The real rule (isInvalidCrossRoute, js/utils.js): the Black Market is
// sellable from Caerleon alone, and with Black/Red Zone Routes off royal <->
// Caerleon hauling is dead.
function realCrossRoute(buyCity, sellCity) {
  if (!buyCity || !sellCity) return true;
  if (sellCity === BM && buyCity !== "Caerleon") return true;
  if (ROYAL.includes(buyCity) && sellCity === "Caerleon") return true;
  if (buyCity === "Caerleon" && ROYAL.includes(sellCity)) return true;
  return false;
}

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    __reset(); clearTableSellCities(); clearRenderSellCities();
    fn();
    console.log(`  PASS: ${name}`); passed++;
  } catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("City pick re-prices the table\n");

// ── The helper's precedence rule ───────────────────────────────────────────

test("no pick, no pin: the caller's full list comes back untouched", () => {
  assert.deepStrictEqual(
    effectiveSellCities(PLANNER, "Caerleon", null, ALL_SELL), ALL_SELL);
});

test("no pick, reachable pin: the pin alone (today's behaviour)", () => {
  __setCrossRoute(realCrossRoute);
  assert.deepStrictEqual(
    effectiveSellCities(PLANNER, "Caerleon", BM, ALL_SELL), [BM]);
});

[
  ["a royal city", "Martlock", "Thetford", ["Thetford"]],
  ["the Black Market from Caerleon", "Caerleon", BM, [BM]],
  ["the Black Market from a royal city", "Martlock", BM, []],
].forEach(([label, fromCity, pick, want]) => {
  test(`an active pick outranks everything — ${label}`, () => {
    __setCrossRoute(realCrossRoute);
    setTableSellCity(PLANNER, pick);
    assert.deepStrictEqual(
      effectiveSellCities(PLANNER, fromCity, "Lymhurst", ALL_SELL), want);
  });
});

test("a pick the caller's list does not carry yields no sale", () => {
  // The Refining / Transports table sells into CITIES — refined bars are not
  // Black-Market-traded, so a BM pick leaves it with nothing rather than
  // inventing a market.
  setTableSellCity("transport-table", BM);
  const cities = ["Caerleon", ...ROYAL];
  assert.deepStrictEqual(
    effectiveSellCities("transport-table", "Caerleon", null, cities), []);
});

test("clearing the pick restores the full list (no state leaks)", () => {
  setTableSellCity(PLANNER, "Thetford");
  setTableSellCity(PLANNER, "");
  assert.strictEqual(getTableSellCity(PLANNER), null);
  assert.deepStrictEqual(effectiveSellCities(PLANNER, "Caerleon", null, ALL_SELL), ALL_SELL);
});

test("each table's pick is its own", () => {
  setTableSellCity(PLANNER, BM);
  assert.strictEqual(getTableSellCity("crafting-table"), null);
});

// ── Change detection (what decides a re-render) ────────────────────────────

test("sellCityFilterChanged reports a move once, then stays quiet", () => {
  assert.strictEqual(sellCityFilterChanged(PLANNER, BM), true, "first pick is a change");
  assert.strictEqual(sellCityFilterChanged(PLANNER, BM), false, "same value is not");
  assert.strictEqual(sellCityFilterChanged(PLANNER, "Thetford"), true);
  assert.strictEqual(sellCityFilterChanged(PLANNER, ""), true, "back to All is a change");
  assert.strictEqual(sellCityFilterChanged(PLANNER, ""), false);
});

test("sellCityFilterChanged also installs the pick", () => {
  sellCityFilterChanged(PLANNER, "Martlock");
  assert.strictEqual(getTableSellCity(PLANNER), "Martlock");
});

// ── Which tables re-price, and what their pickers offer ────────────────────

[
  ["craft-planner-table", true],
  ["crafting-table", true],
  ["transport-table", true],
  // A flip row is a city PAIR, but Flipping is the table with TWO pickers, so
  // each pick names its own leg. Filtering rendered rows instead of re-routing
  // made whole items leave the board (the T5/T7 bags under a Black Market pick).
  ["flipping-table", true],
  // Mounts re-price both legs on a pick: they source the baby, the feed and
  // every saddler mat wherever cheapest, and the grown/saddled result sells
  // under the pick too — same rule as the tables above.
  ["mounts-table", true],
  // Artifact Rolling: each artifact keeps its best sell city, so filtering hid
  // every artifact selling best elsewhere and left the group economics priced
  // best-anywhere. A pick prices every meld and sale at that city.
  ["rolling-table", true],
].forEach(([tableId, want]) => {
  test(`${tableId} re-prices on a City pick: ${want}`, () => {
    assert.strictEqual(tableRepricesOnCityPick(tableId), want);
  });
});

test("a re-pricing table offers every sell city, not only the winners", () => {
  const opts = sellCityOptionsFor(PLANNER);
  assert.ok(opts.includes(BM), "the Black Market must be pickable even when it wins nothing");
  assert.ok(opts.includes("Thetford"));
});

test("the Refining / Transports picker never offers the Black Market", () => {
  assert.ok(!sellCityOptionsFor("transport-table").includes(BM));
});

test("a table that only filters gets no forced option list", () => {
  // skins-trading-table is a DOM-filter-only table: its pickers prune to the
  // cities the rendered rows already name.
  assert.strictEqual(sellCityOptionsFor("skins-trading-table"), null);
});

test("Flipping offers every sell city, and every buy city on its second picker", () => {
  assert.ok(sellCityOptionsFor("flipping-table").includes(BM));
  const buys = buyCityOptionsFor("flipping-table");
  assert.ok(buys.includes("Caerleon"));
  assert.ok(!buys.includes(BM), "the Black Market is never a buy city");
});

test("a table whose Buy pick routes a leg has a fixed buy-side option list", () => {
  // Flipping routes both legs; the planner buys every material somewhere, so
  // its Buy pick names that city. Mounts, Crafting and the Refining / Transports
  // buy legs are user picks too — each pins where the table sources its inputs —
  // so they all get the fixed list (null = prune to what the rendered rows name).
  assert.deepStrictEqual(buyCityOptionsFor("flipping-table"), ALL_BUY);
  assert.deepStrictEqual(buyCityOptionsFor(PLANNER), ALL_BUY);
  assert.deepStrictEqual(buyCityOptionsFor("crafting-table"), ALL_BUY);
  assert.deepStrictEqual(buyCityOptionsFor("transport-table"), ALL_BUY);
  assert.deepStrictEqual(buyCityOptionsFor("mounts-table"), ALL_BUY);
});

// ── The pin-overridden report ──────────────────────────────────────────────

test("a pin overridden by the pick is reported, not swallowed", () => {
  setTableSellCity(PLANNER, BM);
  assert.strictEqual(sellPinOverriddenByFilter(PLANNER, "Caerleon", "Thetford"), "Thetford");
});

[
  ["no pick", null, "Thetford"],
  ["no pin", BM, null],
  ["pin equals pick", BM, BM],
].forEach(([label, pick, pin]) => {
  test(`nothing to report — ${label}`, () => {
    if (pick) setTableSellCity(PLANNER, pick);
    assert.strictEqual(sellPinOverriddenByFilter(PLANNER, "Caerleon", pin), null);
  });
});

// ── The planner row actually re-prices ─────────────────────────────────────

const BAG = { id: "T6_BAG", name: "Master's Bag [T6]", craftType: "bag" };
const BAG_MATS = [{ matId: "T6_CLOTH", count: 8 }, { matId: "T6_LEATHER", count: 8 }];

/** Materials priced in `city`; the bag itself priced per sell city. */
function market(city, sells) {
  const md = {
    T6_CLOTH:   { [city]: { buy_price: 3000, sell_price: 3100, volume_24h: 999 } },
    T6_LEATHER: { [city]: { buy_price: 5000, sell_price: 5100, volume_24h: 999 } },
    T6_BAG: {},
  };
  Object.entries(sells).forEach(([c, p]) => {
    md.T6_BAG[c] = { buy_price: p, sell_price: p, volume_24h: 999 };
  });
  return md;
}

test("with no pick the row still takes the best city", () => {
  __setCrossRoute(realCrossRoute);
  const row = computeCraftPlannerRow(BAG, BAG_MATS, market("Caerleon", { Caerleon: 90000, [BM]: 88000 }), "Caerleon");
  assert.strictEqual(row.sellCity, "Caerleon");
});

test("with a pick the row sells there even though another city pays more", () => {
  __setCrossRoute(realCrossRoute);
  setTableSellCity(PLANNER, BM);
  const md = market("Caerleon", { Caerleon: 90000, [BM]: 88000 });
  const row = computeCraftPlannerRow(BAG, BAG_MATS, md, "Caerleon");
  assert.strictEqual(row.sellCity, BM);
  assert.strictEqual(row.sellPrice, 88000);
});

test("the profit follows the picked city's price", () => {
  __setCrossRoute(realCrossRoute);
  const md = market("Caerleon", { Caerleon: 90000, [BM]: 88000 });
  const free = computeCraftPlannerRow(BAG, BAG_MATS, md, "Caerleon");
  setTableSellCity(PLANNER, BM);
  const picked = computeCraftPlannerRow(BAG, BAG_MATS, md, "Caerleon");
  assert.ok(picked.craftProfit < free.craftProfit,
    `picked ${picked.craftProfit} should trail unfiltered ${free.craftProfit}`);
});

test("the pick outranks a per-item sell pin, and the row says so", () => {
  __setCrossRoute(realCrossRoute);
  __setForce({ T6_BAG: { sell: "Caerleon" } });
  setTableSellCity(PLANNER, BM);
  const row = computeCraftPlannerRow(BAG, BAG_MATS, market("Caerleon", { Caerleon: 90000, [BM]: 88000 }), "Caerleon");
  assert.strictEqual(row.sellCity, BM);
  assert.strictEqual(row.sellPinFilteredTo, BM);
});

test("an unreachable pick leaves the row with no sale (zone rule unchanged)", () => {
  __setCrossRoute(realCrossRoute);
  setTableSellCity(PLANNER, BM);
  const row = computeCraftPlannerRow(BAG, BAG_MATS, market(FS, { [FS]: 95000, [BM]: 88000 }), FS);
  assert.strictEqual(row.noData, true, "a royal craft city cannot sell to the Black Market");
});

test("a picked city the item is unpriced in is a no-data row, not another city's sale", () => {
  __setCrossRoute(realCrossRoute);
  setTableSellCity(PLANNER, "Thetford");
  const row = computeCraftPlannerRow(BAG, BAG_MATS, market(FS, { [FS]: 95000 }), FS);
  assert.strictEqual(row.noData, true);
});

// ── The rendered row set ───────────────────────────────────────────────────

function renderMarket() {
  return {
    T8_PLANKS:   { [FS]: { buy_price: 1000, sell_price: 1100, volume_24h: 500 },
                   Caerleon: { buy_price: 1000, sell_price: 1100, volume_24h: 500 } },
    T8_METALBAR: { [FS]: { buy_price: 1200, sell_price: 1300, volume_24h: 500 },
                   Caerleon: { buy_price: 1200, sell_price: 1300, volume_24h: 500 } },
    T8_FURNITUREITEM_TABLE: { [FS]: { sell_price: 60000, volume_24h: 80 } },
    T8_ARMOR_PLATE_SET1: {
      [FS]: { sell_price: 90000, volume_24h: 120 },
      Caerleon: { sell_price: 80000, volume_24h: 120 },
      [BM]: { sell_price: 70000, buy_price: 70000, volume_24h: 50 },
    },
  };
}

test("a Black Market pick leaves only the Caerleon section", () => {
  __renderCrossRoute(realCrossRoute);
  setRenderSellCity(PLANNER, BM);
  renderCraftPlannerTable(renderMarket());
  const rows = captured.rows.filter((r) => r.item.id === "T8_ARMOR_PLATE_SET1");
  assert.ok(rows.length > 0, "expected rows for the armor");
  assert.ok(rows.every((r) => r.craftCity === "Caerleon"),
    "a royal craft city cannot reach the Black Market, so it builds no row");
  const priced = rows.filter((r) => !r.noData);
  assert.ok(priced.length > 0 && priced.every((r) => r.sellCity === BM));
  __renderCrossRoute(null);
});

test("clearing the pick brings the royal section back", () => {
  __renderCrossRoute(realCrossRoute);
  setRenderSellCity(PLANNER, BM);
  renderCraftPlannerTable(renderMarket());
  setRenderSellCity(PLANNER, "");
  renderCraftPlannerTable(renderMarket());
  const rows = captured.rows.filter((r) => r.item.id === "T8_ARMOR_PLATE_SET1");
  assert.ok(rows.some((r) => r.craftCity === FS), "the royal row is back");
  assert.ok(rows.some((r) => r.sellCity === FS), "and it sells at its own best city again");
  __renderCrossRoute(null);
});

test("the filtered render throws no formatter error", () => {
  __renderCrossRoute(realCrossRoute);
  setRenderSellCity(PLANNER, BM);
  renderCraftPlannerTable(renderMarket());
  assert.ok(!captured.html.join("\n").includes("ERR:"));
  __renderCrossRoute(null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
