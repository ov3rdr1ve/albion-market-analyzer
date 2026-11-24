/**
 * Test: a Crafting Planner sell pin the row cannot reach.
 *
 * Committing a price override also pins the city it was typed at
 * (setCityForce, js/app.js). A pin only binds when the craft city can actually
 * reach it: the Black Market is sellable from Caerleon alone, and royal <->
 * Caerleon hauling needs Black/Red Zone Routes. When it does not bind, the row
 * quietly sells somewhere else at the market price — which reads, on My
 * Crafting List, as "my override disappeared" (the list replays this very row).
 *
 * So the row has to SAY it dropped the pin: `sellPinDropped` carries the city
 * the user pinned, on priced rows and on no-data rows alike.
 *
 * Black-box over computeCraftPlannerRow through the shared sandbox — synthetic
 * prices, no market API, no DOM.
 *
 * Run: node tests/craft-planner-sell-pin.test.cjs
 */

const assert = require("assert");
const { computeCraftPlannerRow, __setOverrides, __setForce, __setBMR,
  __setCrossRoute, __reset } = require("./helpers/craft-planner-pricing-harness.cjs");

let passed = 0, failed = 0;
function test(name, fn) {
  try { __reset(); fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const BM = "Black Market";

// The real rule, lifted from isInvalidCrossRoute (js/utils.js): the Black
// Market only from Caerleon; with routes off, royal <-> Caerleon is dead.
const ROYAL = ["Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Brecilien"];
function realCrossRoute(bmrOn) {
  return (buyCity, sellCity) => {
    if (!buyCity || !sellCity) return true;
    if (sellCity === BM && buyCity !== "Caerleon") return true;
    if (bmrOn) return false;
    if (ROYAL.includes(buyCity) && sellCity === "Caerleon") return true;
    if (buyCity === "Caerleon" && ROYAL.includes(sellCity)) return true;
    return false;
  };
}

// An enchanted Satchel of Insight — the row the defect was reported on. The
// tome is non-returnable (_SKILLBOOK_STANDARD), the cloth is an ordinary
// enchanted bar.
const SATCHEL = { id: "T6_BAG_INSIGHT@2", name: "Master's Satchel of Insight [T6.2]", craftType: "bag" };
const SATCHEL_MATS = [
  { matId: "T6_CLOTH_LEVEL2@2", count: 8 },
  { matId: "T4_SKILLBOOK_STANDARD", count: 1 },
];

/** Market with every material priced at `city`, and a sell price in each sell city. */
function market(city, sells) {
  const md = {
    "T6_CLOTH_LEVEL2@2": { [city]: { buy_price: 4000, sell_price: 4200, volume_24h: 999 } },
    T4_SKILLBOOK_STANDARD: { [city]: { buy_price: 9000, sell_price: 9200, volume_24h: 999 } },
    "T6_BAG_INSIGHT@2": {},
  };
  Object.entries(sells).forEach(([c, p]) => {
    md["T6_BAG_INSIGHT@2"][c] = { buy_price: p, sell_price: p, volume_24h: 999 };
  });
  return md;
}

/** The same row with NO material prices at all — the no-data branch. */
function unpricedMarket(sells) {
  const md = { "T6_BAG_INSIGHT@2": {} };
  Object.entries(sells).forEach(([c, p]) => {
    md["T6_BAG_INSIGHT@2"][c] = { buy_price: p, sell_price: p, volume_24h: 999 };
  });
  return md;
}

// A pinned price at the Black Market, far above every market listing, so a row
// that DOES bind the pin is unmistakable.
const PINNED = 900000;
function pinBlackMarket() {
  __setOverrides({ ["T6_BAG_INSIGHT@2:" + BM]: PINNED });
  __setForce({ "T6_BAG_INSIGHT@2": { sell: BM } });
}

// ── the pin binds, or it is reported ────────────────────────────────────────

[
  {
    name: "a Caerleon craft reaches the Black Market — the pin binds",
    craftCity: "Caerleon", bmr: false,
    wantCity: BM, wantPrice: PINNED, wantDropped: null,
  },
  {
    name: "a royal craft cannot reach the Black Market — the pin is reported dropped",
    craftCity: "Martlock", bmr: false,
    wantCity: "Martlock", wantPrice: 50000, wantDropped: BM,
  },
  {
    name: "a Brecilien craft cannot reach it either (the reported case)",
    craftCity: "Brecilien", bmr: false,
    // Caerleon is off-limits to a royal craft with routes off, so the row falls
    // back to Brecilien's own listing rather than the richer Caerleon one.
    sells: { Brecilien: 40000, Caerleon: 300000 },
    wantCity: "Brecilien", wantPrice: 40000, wantDropped: BM,
  },
  {
    name: "Black/Red Zone Routes does NOT open the Black Market to a royal craft",
    craftCity: "Martlock", bmr: true,
    wantCity: "Martlock", wantPrice: 50000, wantDropped: BM,
  },
].forEach(({ name, craftCity, bmr, sells, wantCity, wantPrice, wantDropped }) => {
  test(name, () => {
    __setBMR(bmr);
    __setCrossRoute(realCrossRoute(bmr));
    pinBlackMarket();
    const md = market(craftCity, sells || { Martlock: 50000, Caerleon: 30000 });
    const row = computeCraftPlannerRow(SATCHEL, SATCHEL_MATS, md, craftCity);
    assert.ok(!row.noData, "expected a priced row");
    assert.strictEqual(row.sellCity, wantCity);
    assert.strictEqual(row.sellPrice, wantPrice);
    assert.strictEqual(row.sellPinDropped, wantDropped);
  });
});

test("a pin at a reachable city binds and is never reported dropped", () => {
  __setCrossRoute(realCrossRoute(false));
  __setOverrides({ "T6_BAG_INSIGHT@2:Thetford": 123456 });
  __setForce({ "T6_BAG_INSIGHT@2": { sell: "Thetford" } });
  const md = market("Martlock", { Martlock: 500000, Thetford: 1000 });
  const row = computeCraftPlannerRow(SATCHEL, SATCHEL_MATS, md, "Martlock");
  assert.strictEqual(row.sellCity, "Thetford");
  assert.strictEqual(row.sellPrice, 123456);
  assert.strictEqual(row.sellPinDropped, null);
});

test("no pin at all leaves sellPinDropped null", () => {
  __setCrossRoute(realCrossRoute(false));
  const md = market("Martlock", { Martlock: 50000 });
  const row = computeCraftPlannerRow(SATCHEL, SATCHEL_MATS, md, "Martlock");
  assert.strictEqual(row.sellPinDropped, null);
});

// ── the no-data branches report it too ──────────────────────────────────────
//
// An unreachable pin is exactly the state a user lands in while filling prices
// in, so the row that has no numbers yet must carry the same explanation.

test("a row with unpriced materials still reports the dropped pin", () => {
  __setCrossRoute(realCrossRoute(false));
  pinBlackMarket();
  const md = unpricedMarket({ Martlock: 50000 });
  const row = computeCraftPlannerRow(SATCHEL, SATCHEL_MATS, md, "Martlock");
  assert.ok(row.noData, "expected the no-data branch");
  assert.strictEqual(row.sellPinDropped, BM);
});

test("a row with no reachable sell price at all still reports the dropped pin", () => {
  __setCrossRoute(realCrossRoute(false));
  pinBlackMarket();
  // The item is listed ONLY at the Black Market, which this craft cannot reach.
  const md = market("Martlock", {});
  const row = computeCraftPlannerRow(SATCHEL, SATCHEL_MATS, md, "Martlock");
  assert.ok(row.noData, "expected the no-data branch");
  assert.strictEqual(row.sellPinDropped, BM);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
