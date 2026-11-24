/**
 * Test: gear CRAFT rows are always-visible valuations, not volume-gated trade
 * picks — same root cause as the mount tables (mount-craft-volume-gate.test.cjs,
 * faction-breed-thin-market.test.cjs).
 *
 * Bug (reported): a city-faction cape (e.g. Adept's Lymhurst Cape) had real
 * standing sell orders — 469,999 @ Lymhurst (1 vol), 202,714 @ Black Market
 * (2 vol) — visible in the price-edit dropdown, yet the crafting row collapsed
 * to "no data" / "—" profit. The per-order market volume gate (MIN_VOLUME=25)
 * dropped any output OR material that traded below 25/24h, so the whole route
 * was discarded even though IQR-valid prices existed. Faction capes, artifact
 * crests, and faction tokens all trade far below 25/24h.
 *
 * Fix: crafting valuations use MIN_VOLUME=0 (every recipe already gets a row,
 * the Vol/24h column surfaces thin liquidity, and getBuyPrice/getSellPrice still
 * apply IQR outlier rejection). Black-box: feed synthetic marketData straight to
 * the real computeCraftRoutesForCity and assert on the returned routes.
 *
 * Run: node tests/crafting-thin-volume-gate.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const stubs = `
const _els = {};
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const window = { addEventListener: () => {} };
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
const FOCUS_COSTS = {};      // getFocusCost -> 0 (focus column irrelevant here)
let recipeCache = {};
let lastMarketData = null;
`;

const sources =
  J("data-city-bonuses.js") +
  (J("calculations.js") + J("calculations-margins.js")) +
  J("travel-cost.js") +
  (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) +
  J("render-crafting.js");

const mod = new Module("crafting-thin-gate");
mod._compile(
  stubs + sources + "\nmodule.exports = { computeCraftRoutesForCity, getCraftingMaterials };",
  "crafting-thin-gate.js",
);
const X = mod.exports;

// Build synthetic market data: one material (T4_MAT_A) bought at Lymhurst, one
// output (T4_TESTCAPE) sold at Lymhurst — the craft city — so selling at the
// craft city always yields a route once the volume gate is lifted.
function routesFor({ matVol, sellVol, matBuy = 1000, sell = 5000 }) {
  const md = {};
  const put = (id, c, b, s, v) => {
    (md[id] = md[id] || {})[c] = { buy_price: b, sell_price: s, volume_24h: v };
  };
  put("T4_MAT_A", "Lymhurst", matBuy, matBuy + 100, matVol);
  put("T4_TESTCAPE", "Lymhurst", sell - 100, sell, sellVol);
  const item = {
    id: "T4_TESTCAPE",
    name: "Test Cape",
    craftType: null, // non-spec, non-focus → isolates the volume gate
    materials: [{ matId: "T4_MAT_A", count: 1 }],
  };
  return X.computeCraftRoutesForCity("Lymhurst", item, item.materials, md);
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const V_HI = 1000; // well above the old gate
const V_LO = 4;    // below the old MIN_VOLUME (25), like the 1–2 vol capes

console.log("Crafting thin-volume gate tests\n");

test("route resolves when OUTPUT trades below the old gate (sell vol=4)", () => {
  const routes = routesFor({ matVol: V_HI, sellVol: V_LO });
  assert.ok(routes.length > 0, "expected a route for a thinly-traded output");
  assert.strictEqual(routes[0].sellPrice, 5000, "thin sell price must be used");
  assert.strictEqual(routes[0].sellCity, "Lymhurst");
});

test("route resolves when MATERIAL trades below the old gate (mat vol=4)", () => {
  const routes = routesFor({ matVol: V_LO, sellVol: V_HI });
  assert.ok(routes.length > 0, "expected a route when the material is thin");
  assert.ok(routes[0].totalInputCost > 0, "input cost must compute from thin mat");
  assert.strictEqual(routes[0].matBestPrices.T4_MAT_A.city, "Lymhurst");
});

test("route resolves when BOTH output and material are thin (vol=4)", () => {
  const routes = routesFor({ matVol: V_LO, sellVol: V_LO });
  assert.ok(routes.length > 0, "expected a route when both sides are thin");
  assert.ok(
    routes[0].sellPrice > 0 && routes[0].totalInputCost > 0,
    "both sides must resolve",
  );
});

test("high-volume craft route unchanged — regression guard", () => {
  const routes = routesFor({ matVol: V_HI, sellVol: V_HI });
  assert.ok(routes.length > 0 && routes[0].sellPrice === 5000, "liquid route intact");
});

test("genuinely absent material data still yields no route (no false positive)", () => {
  // Material has NO market entry anywhere → allAvailable stays false even with
  // the gate lifted. The fix must not invent prices, only stop gating real ones.
  const md = {
    T4_TESTCAPE: { Lymhurst: { buy_price: 4900, sell_price: 5000, volume_24h: V_LO } },
  };
  const item = {
    id: "T4_TESTCAPE",
    name: "Test Cape",
    craftType: null,
    materials: [{ matId: "T4_MAT_MISSING", count: 1 }],
  };
  const routes = X.computeCraftRoutesForCity("Lymhurst", item, item.materials, md);
  assert.strictEqual(routes.length, 0, "no route when a material has no data at all");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
