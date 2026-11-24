/**
 * Test: the Crafting table's Pure Profit twin — plan.md step 1 (TDD red).
 *
 * A crafting route's Pure Profit subtracts every material at market. The twin
 * prices the SAME route with the gatherable ingredients at zero, keeping every
 * non-material silver term (plan.md per-table rules):
 *
 *   selfFoundProfit = sellPrice × (1 − PREMIUM_TAX)
 *                     − (artifact cost ×(1 + SETUP_FEE)      [bought, not gatherable]
 *                        + station fee                        [flat silver]
 *                        + recipe silver                      [flat silver]
 *                        + travel legs (haul-out/product)     [kept]
 *                       )
 *
 * Zeroed: every recipe ingredient that is a resource (the RRR-returned mats).
 * Their (1 + SETUP_FEE) multiplier leaves with them — no market buy, no buy
 * order fee — while the artifact's setup fee stays (it is still bought).
 *
 * Black-box: drive the REAL computeCraftRoutesForCity (js/render-crafting.js)
 * with injected prices, exactly like tests/crafting-silver-focus-focus-toggle
 * does, and assert the twin on the returned route's marginInfo (falling back to
 * a row field). Exact silver values computed by hand below.
 *
 * Tax getter control (repo convention): the live PREMIUM_TAX getter from
 * js/calculations.js resolves the #premium-account checkbox stub
 * (_els["premium-account"].checked) and a fixed "market" order type, so
 * PREMIUM_TAX = 0.065 / SETUP_FEE = 0.025 until the box flips.
 *
 * RED BY DESIGN: nothing writes marginInfo.selfFoundProfit yet, so every twin
 * assertion fails on the missing field. The primary-profit assertions are
 * regressions and pass before AND after the feature.
 *
 * All prices simulated; no live API.
 *
 * Run: node --test tests/crafting-self-found-profit.test.cjs
 */

const assert = require("assert");
const { test } = require("node:test");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const J = (f) => fs.readFileSync(path.join(ROOT, "js", f), "utf8").replace(/\r\n/g, "\n");

const STATION_FEE = 500;   // flat silver the stubbed station charges per craft
const PRODUCT_TRAVEL = 40; // Brecilien haul-out fee per product leg (stubbed)

const sandbox = `
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];

const _els = {
  "premium-account": { checked: true },
  "station-fee": { value: "0" },
};
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const window = { addEventListener: () => {} };
// The live PREMIUM_TAX / SETUP_FEE getters (js/calculations.js) resolve these.
function isPremiumEnabled() {
  const cb = document.getElementById("premium-account");
  return !cb || cb.checked;
}
function getOrderType() { return "market"; }

function isBlackRedZoneEnabled() { return true; }   // BMR on: every city pairs
function isValidSourceCity() { return true; }
function isFocusEnabled() { return false; }
function isInvalidCrossRoute() { return false; }
function getCityForce() { return null; }
function getOverridePrice() { return null; }
function getIQRBounds() { return { upper: Infinity }; }
function getBuyPrice(itemData, city) { return (itemData && itemData[city] && itemData[city].buy_price) || 0; }
function getSellPrice(itemData, city) { return (itemData && itemData[city] && itemData[city].sell_price) || 0; }
function getTierFromId(id) { const m = String(id).match(/^T(\\d+)/); return m ? parseInt(m[1], 10) : 4; }
function getFocusCost() { return 0; }               // not focus-craftable: keeps RRR at base
function calcStationFeeSilver() { return ${STATION_FEE}; }
// Only a leg OUT of Brecilien hauls anything; every other pair is free.
function legBrecilienCost(from, to, id, count) {
  return (from === "Brecilien" && to !== "Brecilien") ? ${PRODUCT_TRAVEL} : 0;
}
`;

const mod = new Module("crafting-self-found-profit-test");
mod._compile(
  sandbox + J("data-city-bonuses.js") + (J("calculations.js") + J("calculations-margins.js")) + J("render-crafting.js") +
    "\nmodule.exports = { computeCraftRoutesForCity, getCraftRRR, _els," +
    " fees: { premiumTax: () => PREMIUM_TAX, setupFee: () => SETUP_FEE } };",
  "crafting-self-found-profit.js",
);
const X = mod.exports;
const { computeCraftRoutesForCity, getCraftRRR, _els } = X;

const ITEM = { id: "T4_TEST_ARMOR", name: "Test Armor", craftType: "x" }; // no spec: base RRR
const CLOTH = "T4_CLOTH";
const ART = "T4_ARTEFACT_TEST";      // matches isNonReturnableCraftMat (ARTEFACT)

function market({ cloth = 1000, artifact = 10000, sellCaerleon = 60000, sellLymhurst = 50000 } = {}) {
  return {
    [CLOTH]: { Lymhurst: { buy_price: cloth, sell_price: cloth + 10, volume_24h: 9999 } },
    [ART]: { Lymhurst: { buy_price: artifact, sell_price: artifact + 10, volume_24h: 9999 } },
    T4_TEST_ARMOR: {
      Caerleon: { buy_price: 1, sell_price: sellCaerleon, volume_24h: 9999 },
      Lymhurst: { buy_price: 1, sell_price: sellLymhurst, volume_24h: 9999 },
    },
  };
}

// The twin lands on marginInfo.selfFoundProfit (a route IS the row's pricing
// core); accept a row-level field too, as plan.md allows either shape.
const sfOf = (route) => {
  if (route.marginInfo && route.marginInfo.selfFoundProfit !== undefined) {
    return route.marginInfo.selfFoundProfit;
  }
  return route.selfFoundProfit;
};

const near = (a, b) => Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-9);

/** The route's PRIMARY pure profit, recomputed by hand from the injected prices. */
function primaryProfit(md, materials, craftCity, item = ITEM) {
  const rrr = item.noReturn ? 0 : getCraftRRR(craftCity, item.craftType, false);
  let mats = 0;
  materials.forEach((m) => {
    const isArtifact = m.matId === ART;
    const eff = isArtifact ? m.count : m.count * (1 - rrr);
    mats += md[m.matId].Lymhurst.buy_price * eff * (1 + X.fees.setupFee());
  });
  const routeCost = mats + STATION_FEE + (item.silverCost || 0)
    + (craftCity === "Brecilien" ? PRODUCT_TRAVEL : 0);
  return md[item.id].Caerleon.sell_price * (1 - X.fees.premiumTax()) - routeCost;
}

function bestRoute(materials, opts, item = ITEM) {
  const md = market(opts && opts.market);
  const craftCity = (opts && opts.craftCity) || "Lymhurst";
  const routes = computeCraftRoutesForCity(craftCity, item, materials, md);
  assert.ok(routes.length > 0, "the fixture must price at least one route");
  return { route: routes[0], md };
}

test("fixture sanity: the recipe prices and the primary profit is recomputable by hand", () => {
  const { route, md } = bestRoute([{ matId: CLOTH, count: 8 }]);
  const rrr = getCraftRRR("Lymhurst", "x", false);
  assert.strictEqual(route.sellCity, "Caerleon", "the best sell city is the highest price");
  assert.ok(route.matBestPrices[CLOTH].price === 1000, "cloth is bought at 1000");
  assert.ok(near(route.marginInfo.profit, primaryProfit(md, [{ matId: CLOTH, count: 8 }], "Lymhurst")),
    `primary profit ${route.marginInfo.profit} drifted from the hand formula`);
  assert.ok(rrr > 0 && rrr < 1, "base RRR must be a real fraction for the hand math");
});

test("resource-only recipe: twin keeps ONLY the station fee (ingredients zeroed)", () => {
  const { route } = bestRoute([{ matId: CLOTH, count: 8 }]);
  // 60,000 x (1 - 0.065) - 500 = 55,600. Cloth and its setup fee are gone.
  const want = 60000 * (1 - X.fees.premiumTax()) - STATION_FEE;
  assert.strictEqual(typeof sfOf(route), "number",
    "marginInfo.selfFoundProfit missing on the crafting route (feature not implemented)");
  assert.ok(near(sfOf(route), want), `twin ${sfOf(route)} != ${want}`);
});

test("the twin is INDEPENDENT of the zeroed ingredient's price", () => {
  const a = bestRoute([{ matId: CLOTH, count: 8 }]).route;
  const b = bestRoute([{ matId: CLOTH, count: 8 }], { market: { cloth: 4000 } }).route;
  assert.ok(near(sfOf(b), sfOf(a)),
    `twin moved with the cloth price (${sfOf(a)} → ${sfOf(b)}) — ingredients are not zeroed`);
  assert.ok(b.marginInfo.profit < a.marginInfo.profit,
    "the PRIMARY profit must still track the ingredient price");
});

test("artifact recipe: the artifact's cost AND its setup fee are kept", () => {
  const { route } = bestRoute([{ matId: CLOTH, count: 8 }, { matId: ART, count: 1 }]);
  // 60,000 x 0.935 - (10,000 x 1.025 + 500) = 56,100 - 10,750 = 45,350.
  const want = 60000 * (1 - X.fees.premiumTax()) - (10000 * (1 + X.fees.setupFee()) + STATION_FEE);
  assert.strictEqual(typeof sfOf(route), "number", "selfFoundProfit missing (artifact recipe)");
  assert.ok(near(sfOf(route), want), `twin ${sfOf(route)} != ${want}`);
  assert.ok(route.marginInfo.profit < sfOf(route),
    "the bought twin must sit below the self-found one here");
});

test("recipe silver is kept, and a Brecilien haul-out leg travels with the twin", () => {
  const item = { ...ITEM, silverCost: 2000 };
  const { route } = bestRoute([{ matId: CLOTH, count: 8 }], { craftCity: "Brecilien", market: {} }, item);
  // Best sell is still Caerleon (60,000), reached from Brecilien → 40 haul-out.
  // 60,000 x 0.935 - (500 + 2,000 + 40) = 56,100 - 2,540 = 53,560.
  const want = 60000 * (1 - X.fees.premiumTax()) - (STATION_FEE + 2000 + PRODUCT_TRAVEL);
  assert.strictEqual(typeof sfOf(route), "number", "selfFoundProfit missing (silver + travel)");
  assert.ok(near(sfOf(route), want), `twin ${sfOf(route)} != ${want}`);
  assert.ok(route.brecilienFee >= PRODUCT_TRAVEL, "the fixture must actually charge the haul leg");
});

test("the twin follows the LIVE premium-account getter (8% tax when Premium is off)", () => {
  _els["premium-account"].checked = false;
  try {
    const { route } = bestRoute([{ matId: CLOTH, count: 8 }]);
    const want = 60000 * (1 - X.fees.premiumTax()) - STATION_FEE; // 60,000 x 0.895 - 500 = 53,200
    assert.strictEqual(typeof sfOf(route), "number", "selfFoundProfit missing (premium-off)");
    assert.ok(near(sfOf(route), want), `twin ${sfOf(route)} != ${want}`);
  } finally {
    _els["premium-account"].checked = true;
  }
});

test("regression: the primary pure profit keeps today's formula", () => {
  const materials = [{ matId: CLOTH, count: 8 }, { matId: ART, count: 1 }];
  const { route, md } = bestRoute(materials);
  assert.ok(near(route.marginInfo.profit, primaryProfit(md, materials, "Lymhurst")),
    `primary profit ${route.marginInfo.profit} drifted from the hand formula`);
});
