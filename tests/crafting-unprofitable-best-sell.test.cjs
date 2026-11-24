/**
 * Test: a LOSS-MAKING craft still sells at the city that pays the most.
 *
 * Bug (reported on My Crafting List): a Lymhurst craft that loses money stayed
 * on Lymhurst's 380,127 instant-sell bid while Martlock paid 450,000. The
 * `margin > 0 || sc === craftCity` gate in computeCraftRoutesForCity kept only
 * the craft city's own sell once no sell was profitable, and the callers read
 * routes[0] — so the local, lower price won by default. A specialized item has
 * a single royal craft candidate, so no other craft city's row could rescue it
 * in dedupeCraftingRows either.
 *
 * Fix: every priced sell is a route; routes are ranked by margin alone.
 *
 * Run: node tests/crafting-unprofitable-best-sell.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

// Instant sells: the sell leg reads the bid (buy_price), as in the report.
const stubs = `
const _els = { "sell-instant": { checked: true }, "buy-instant": { checked: true } };
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null };
const localStorage = { _s: {}, getItem(k){ return this._s[k] ?? null; }, setItem(k,v){ this._s[k]=v; }, removeItem(k){ delete this._s[k]; } };
const window = { addEventListener: () => {} };
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
const FOCUS_COSTS = {};
let recipeCache = {};
let lastMarketData = null;
`;

const mod = new Module("crafting-unprofitable-best-sell");
mod._compile(
  stubs +
    J("data-city-bonuses.js") +
    (J("calculations.js") + J("calculations-margins.js")) +
    J("travel-cost.js") +
    (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) +
    J("render-crafting.js") +
    "\nmodule.exports = { computeCraftRoutesForCity, setCityForce, clearCityForce, setOverrideEntry };",
  "crafting-unprofitable-best-sell.js",
);
const X = mod.exports;

const MAT = "T6_MAT_A";
const OUT = "T6_TESTCAPE";
const item = { id: OUT, name: "Test", craftType: null, materials: [{ matId: MAT, count: 8 }] };

// Materials cost ~1.2M per craft: every sell below loses money.
function market() {
  const md = {};
  const put = (id, c, b, s, v) => {
    (md[id] = md[id] || {})[c] = { buy_price: b, sell_price: s, volume_24h: v };
  };
  ["Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch"]
    .forEach((c) => put(MAT, c, 150000, 151000, 500));
  put(OUT, "Lymhurst", 380127, 0, 10);
  put(OUT, "Fort Sterling", 277020, 0, 10);
  put(OUT, "Martlock", 450000, 0, 10);
  put(OUT, "Bridgewatch", 335999, 0, 10);
  return md;
}

const best = () => X.computeCraftRoutesForCity("Lymhurst", item, item.materials, market())[0];

let passed = 0, failed = 0;
function test(name, fn) {
  X.clearCityForce(OUT, "sell");
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Crafting: unprofitable craft sells at the best price\n");

test("loss-making Lymhurst craft sells at Martlock's higher bid, not locally", () => {
  const r = best();
  assert.ok(r.marginInfo.margin < 0, "fixture must be unprofitable");
  assert.strictEqual(r.sellCity, "Martlock");
  assert.strictEqual(r.sellPrice, 450000);
});

test("every priced sell is offered, ranked by margin", () => {
  const routes = X.computeCraftRoutesForCity("Lymhurst", item, item.materials, market());
  assert.deepStrictEqual(routes.map((r) => r.sellCity),
    ["Martlock", "Lymhurst", "Bridgewatch", "Fort Sterling"]);
});

test("a sell pin still wins on a loss-making craft", () => {
  X.setCityForce(OUT, "sell", "Fort Sterling");
  assert.strictEqual(best().sellCity, "Fort Sterling");
});

test("an override at another city is picked up when it pays more", () => {
  X.setOverrideEntry(OUT, "Thetford", { buyOrder: 500000, use: "auto" });
  assert.strictEqual(best().sellCity, "Thetford");
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed ? 1 : 0);
