/**
 * Test: the crafting NO-DATA placeholder row prices each material at its best
 * zone-valid city, not just the single craft city.
 *
 * Bug (reported): "Adept's Smuggler Cape [T4]" collapsed to a no-data row whose
 * three inputs — Adept's Cape, Adept's Smuggler Crest, Shadowheart — ALL showed
 * "@ no data ea", even though the cape and crest had live listings in several
 * cities. The recipe collapses whenever ONE input (the thinly-traded faction
 * token) has no price in any valid city; the old placeholder then priced every
 * material at the craft city ALONE, so well-traded inputs that happened to lack
 * a listing in that one city also rendered as "no data". The user only saw the
 * real prices appear after manually overriding the blocker — which flipped the
 * row onto the normal best-city sourcing path.
 *
 * Fix: bestMatBuySource() mirrors computeCraftRoutesForCity's sourcing scan, so
 * the placeholder shows the real price + source city for every priceable input
 * and isolates the genuine blocker (price 0 / city null) as the lone "no data".
 *
 * Black-box: feed synthetic marketData straight to the real bestMatBuySource.
 *
 * Run: node tests/crafting-no-data-best-source.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

// `include-caerleon` (BMR) and `sort-instant` (order type) are read off DOM
// elements; expose mutable stubs so each test can pin the zone + order mode.
const stubs = `
const _els = {
  "include-caerleon": { checked: false },   // BMR OFF: royal & Caerleon split
  "sort-instant": { checked: true },        // instant: getBuyPrice reads sell_price
};
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
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

const sources =
  J("data-city-bonuses.js") +
  (J("calculations.js") + J("calculations-margins.js")) +
  J("travel-cost.js") +
  (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) +
  J("render-crafting.js");

const mod = new Module("crafting-no-data-best-source");
mod._compile(
  stubs + sources + "\nmodule.exports = { bestMatBuySource, _els };",
  "crafting-no-data-best-source.js",
);
const X = mod.exports;

// Synthetic scan reproducing the reported case: cape + crest priced in several
// royal cities, the faction token unpriced everywhere (the collapse trigger).
function md() {
  const m = {};
  const put = (id, c, b, s, v) => {
    (m[id] = m[id] || {})[c] = { buy_price: b, sell_price: s, volume_24h: v };
  };
  // Adept's Cape — cheapest at Brecilien (1097), also Lymhurst/FS.
  put("T4_CAPE", "Lymhurst", 1578, 2173, 39005);
  put("T4_CAPE", "Fort Sterling", 1640, 3000, 25237);
  put("T4_CAPE", "Brecilien", 901, 1097, 12984);
  // Smuggler Crest — cheapest at Martlock (9969), also Lymhurst.
  put("T4_CAPEITEM_SMUGGLER_BP", "Lymhurst", 7603, 9998, 32869);
  put("T4_CAPEITEM_SMUGGLER_BP", "Martlock", 9471, 9969, 17595);
  // Crest also listed in Caerleon — used to prove the zone filter excludes it.
  put("T4_CAPEITEM_SMUGGLER_BP", "Caerleon", 0, 50, 5);
  // Shadowheart token — no live orders anywhere: the genuine blocker.
  put("T1_FACTION_CAERLEON_TOKEN_1", "Caerleon", 0, 0, 27944);
  put("T1_FACTION_CAERLEON_TOKEN_1", "Brecilien", 0, 0, 2326);
  return m;
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Crafting no-data best-source tests\n");

test("priceable material resolves to its cheapest zone-valid city", () => {
  const cape = X.bestMatBuySource("T4_CAPE", "Brecilien", md());
  assert.strictEqual(cape.price, 1097, "cape should price at cheapest royal");
  assert.strictEqual(cape.city, "Brecilien");
});

test("second priceable material sources from a DIFFERENT best city", () => {
  // The exact symptom: with craftCity=Brecilien, the crest is not listed in
  // Brecilien — old code showed it as "no data"; it must now source Martlock.
  const crest = X.bestMatBuySource("T4_CAPEITEM_SMUGGLER_BP", "Brecilien", md());
  assert.strictEqual(crest.price, 9969, "crest should price at Martlock");
  assert.strictEqual(crest.city, "Martlock");
});

test("genuinely unpriced material stays the lone blocker (0 / null)", () => {
  const tok = X.bestMatBuySource("T1_FACTION_CAERLEON_TOKEN_1", "Brecilien", md());
  assert.strictEqual(tok.price, 0, "token unpriced everywhere → price 0");
  assert.strictEqual(tok.city, null, "no source city for the blocker");
});

test("BMR OFF excludes Caerleon from a royal craft's sourcing", () => {
  // The crest's only sub-9969 Caerleon listing (50) must be ignored when crafting
  // royal-side, or the placeholder would advertise an impossible cross-zone haul.
  const crest = X.bestMatBuySource("T4_CAPEITEM_SMUGGLER_BP", "Brecilien", md());
  assert.notStrictEqual(crest.city, "Caerleon", "Caerleon excluded with BMR off");
});

test("BMR ON still excludes Caerleon from a royal craft's sourcing", () => {
  // A craft buys where it crafts: the material leg is zone-locked on BOTH
  // toggle settings, and Black/Red Zone Routes now governs the SALE only
  // (isValidSourceCity, js/utils.js — tests/zone-locked-sourcing.test.cjs).
  // This case used to expect the 50-silver Caerleon crest, which advertised
  // hauling materials out of Caerleon to a Brecilien station for free.
  X._els["include-caerleon"].checked = true;
  try {
    const crest = X.bestMatBuySource("T4_CAPEITEM_SMUGGLER_BP", "Brecilien", md());
    assert.strictEqual(crest.city, "Martlock", "cheapest ROYAL listing, not Caerleon");
    assert.strictEqual(crest.price, 9969);
  } finally {
    X._els["include-caerleon"].checked = false;
  }
});

test("BMR ON: a Caerleon craft still gets its own Caerleon listing", () => {
  // The mirror of the case above — zone-locking cuts the cross-zone haul, not
  // the city's own supply.
  X._els["include-caerleon"].checked = true;
  try {
    const crest = X.bestMatBuySource("T4_CAPEITEM_SMUGGLER_BP", "Caerleon", md());
    assert.strictEqual(crest.city, "Caerleon");
    assert.strictEqual(crest.price, 50);
  } finally {
    X._els["include-caerleon"].checked = false;
  }
});

test("Caerleon craft (BMR off) sources only from Caerleon", () => {
  // Mirror image: a Caerleon-spec craft must not source royal-city listings.
  const cape = X.bestMatBuySource("T4_CAPE", "Caerleon", md());
  assert.strictEqual(cape.price, 0, "no Caerleon listing for T4_CAPE → blocked");
  assert.strictEqual(cape.city, null);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
