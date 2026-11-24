/**
 * Test: Favor (Energy Manipulator) rows respect the "Include Caerleon"
 * (Black/Red Zone Routes) toggle when choosing the best sell city.
 *
 * Bug being guarded: buildFavorSpendingRows used to call
 *   findBestSellCity(marketData, id, cities, 0, null, null)
 * passing `null` as the route origin, so isInvalidCrossRoute never ran and a
 * Favor item (Siphoned Energy, rune/soul/relic, Avalonian shard, crest, mount)
 * was valued at the Caerleon market price even with the toggle OFF — a
 * Royal↔Caerleon hop that crosses red/black zones.
 *
 * The Energy Manipulator NPC stands in every Royal City AND Caerleon, so there
 * is no single source faction. With the toggle OFF the user is assumed to
 * operate out of a Royal city, so the rows anchor to a royal origin and behave
 * exactly like the FP rows: never route through Caerleon unless the toggle is
 * enabled.
 *
 * Contract (parameterised, black-box on chosen sell city + gross price):
 *   - Toggle OFF: a Favor item is NOT valued in Caerleon; if Caerleon is its
 *     ONLY market, the row has no reachable sell city (empty city, 0 price).
 *   - Toggle ON: every city is reachable, so the globally-highest price wins.
 *
 * Loads the real js/render-favor-spending.js via Module._compile (same harness
 * as tests/favor-spending-rows.test.cjs) with faithful mirrors of
 * findBestSellCity / isInvalidCrossRoute so the actual production
 * buildFavorSpendingRows is exercised.
 *
 * Run: node tests/favor-spending-route-filter.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

// Row text runs through tx(english, slug); en-mode identity keeps assertions in English.
globalThis.tx = globalThis.tx || ((en) => en);
const assert = require("assert");

const favCostsSrc = fs.readFileSync(path.join(__dirname, "..", "js", "data-favor-costs.js"), "utf8");
const fpCostsSrc = fs.readFileSync(path.join(__dirname, "..", "js", "data-faction-fp-costs.js"), "utf8");
const renderSrc = fs.readFileSync(path.join(__dirname, "..", "js", "render-favor-spending.js"), "utf8");

let _overrides = {};
let _blackRedOn = false;

const stubs = `
${favCostsSrc}
${fpCostsSrc}

const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];

// Toggle state, flipped per-test via the exported setter.
function isBlackRedZoneEnabled() { return _blackRedOn; }

// Mirror of js/utils.js isInvalidCrossRoute.
function isInvalidCrossRoute(buyCity, sellCity) {
  if (!buyCity || !sellCity) return true;
  if (sellCity === "Black Market" && buyCity !== "Caerleon") return true;
  if (isBlackRedZoneEnabled()) return false;
  const buyIsRoyal = ROYAL_CITIES.includes(buyCity);
  const sellIsRoyal = ROYAL_CITIES.includes(sellCity);
  if (buyIsRoyal && sellCity === "Caerleon") return true;
  if (buyCity === "Caerleon" && sellIsRoyal) return true;
  return false;
}

function getOverridePrice(itemId, city) {
  const k = itemId + "|" + city;
  return Object.prototype.hasOwnProperty.call(_overrides, k) ? _overrides[k] : null;
}
function getIQRBounds() { return { lower: 0, upper: Infinity }; }
function getBuyPrice(itemData, city, bounds, itemId) {
  const ov = getOverridePrice(itemId, city);
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].sell_price || 0;
}
function getSellPrice(itemData, city, bounds, itemId) {
  const ov = getOverridePrice(itemId, city);
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].sell_price || 0;
}
// Mirror of js/utils.js findBestSellCity (honours excludeBuyCity route origin).
function getCityForce() { return null; }
function findBestSellCity(marketData, itemId, cities, minVolume, excludeBuyCity, originCity) {
  const forced = getCityForce(itemId, "sell");
  if (forced && cities.includes(forced)) {
    const p = getSellPrice(marketData[itemId], forced, null, itemId);
    return { city: forced, price: p > 0 ? p : 0, travelCost: 0 };
  }
  let bestPrice = 0, bestCity = null;
  cities.forEach((c) => {
    if (excludeBuyCity && isInvalidCrossRoute(excludeBuyCity, c)) return;
    const p = getSellPrice(marketData[itemId], c, null, itemId);
    const v = (marketData[itemId] && marketData[itemId][c] && marketData[itemId][c].volume_24h) || 0;
    if (p > 0 && (v >= minVolume || getOverridePrice(itemId, c) !== null) && p > bestPrice) {
      bestPrice = p; bestCity = c;
    }
  });
  return { city: bestCity, price: bestPrice, travelCost: 0 };
}
function getItemDisplayName(id) { return id; }
const ITEM_NAMES_MAP = {};
`;

const mod = new Module("render-favor-spending-route-test");
mod._compile(
  stubs + renderSrc + `
  module.exports = {
    buildFavorSpendingRows,
    setOverrides: (o) => { _overrides = o || {}; },
    setBlackRed: (v) => { _blackRedOn = !!v; },
  };`,
  "render-favor-spending.js"
);
const { buildFavorSpendingRows, setOverrides, setBlackRed } = mod.exports;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

function mkMarket(spec) {
  const md = {};
  for (const [id, cityPrices] of Object.entries(spec)) {
    md[id] = {};
    for (const [city, price] of Object.entries(cityPrices)) {
      md[id][city] = { sell_price: price, buy_price: price, volume_24h: 100 };
    }
  }
  return md;
}

console.log("Favor Spending route-filter (Include Caerleon) tests\n");
setOverrides({});

// Representative raw-sale rows across every Favor sub-category.
const cases = [
  { label: "Siphoned Energy", id: "UNIQUE_GVGTOKEN_GENERIC" },
  { label: "Elder's Relic (token)", id: "T8_RELIC" },
  { label: "Elder's Avalonian Shard", id: "T8_SHARD_AVALONIAN" },
  { label: "Elder's Avalonian Crest", id: "T8_CAPEITEM_AVALON_BP" },
  { label: "Adept's Smuggler Crest", id: "T4_CAPEITEM_SMUGGLER_BP" },
  { label: "Elder's Demon Crest", id: "T8_CAPEITEM_DEMON_BP" },
  { label: "Soulspinner Baby", id: "T8_FARM_SPIDER_HELL_BABY" },
];

cases.forEach((c) => {
  test(`OFF: ${c.label} — Caerleon highest → routes to Royal, not Caerleon`, () => {
    setBlackRed(false);
    const rows = buildFavorSpendingRows(mkMarket({ [c.id]: { Caerleon: 200000, Martlock: 150000 } }));
    const r = rows.find((x) => x.itemId === c.id);
    assert.ok(r, `${c.label} row present`);
    assert.notStrictEqual(r.sellCity, "Caerleon", "must not route through Caerleon");
    assert.strictEqual(r.sellCity, "Martlock");
    assert.strictEqual(r.sellPrice, 150000);
  });

  test(`ON:  ${c.label} — Caerleon highest → Caerleon wins`, () => {
    setBlackRed(true);
    const rows = buildFavorSpendingRows(mkMarket({ [c.id]: { Caerleon: 200000, Martlock: 150000 } }));
    const r = rows.find((x) => x.itemId === c.id);
    assert.strictEqual(r.sellCity, "Caerleon");
    assert.strictEqual(r.sellPrice, 200000);
  });

  test(`OFF: ${c.label} — Caerleon-only market → no reachable sell city`, () => {
    setBlackRed(false);
    const rows = buildFavorSpendingRows(mkMarket({ [c.id]: { Caerleon: 200000 } }));
    const r = rows.find((x) => x.itemId === c.id);
    assert.strictEqual(r.sellCity, "");
    assert.strictEqual(r.sellPrice, 0);
    assert.strictEqual(r.silverPerFavor, 0);
  });
});

// Energy Mount sale price also honours the route origin (sellCity only — net
// math is covered in favor-spending-rows.test.cjs).
test("OFF: Siege Ballista sale routes to Royal, not Caerleon", () => {
  setBlackRed(false);
  const rows = buildFavorSpendingRows(mkMarket({
    T6_MOUNT_SIEGE_BALLISTA: { Caerleon: 2000000, Martlock: 1500000 },
    T6_MOUNT_OX: { Martlock: 200000 },
    T6_METALBAR: { Bridgewatch: 1000 },
    T6_LEATHER: { Thetford: 800 },
    T6_PLANKS: { Lymhurst: 600 },
  }));
  const r = rows.find((x) => x.itemId === "T6_MOUNT_SIEGE_BALLISTA");
  assert.strictEqual(r.sellCity, "Martlock");
  assert.strictEqual(r.sellPrice, 1500000);
});

test("ON:  Siege Ballista sale → Caerleon (highest)", () => {
  setBlackRed(true);
  const rows = buildFavorSpendingRows(mkMarket({
    T6_MOUNT_SIEGE_BALLISTA: { Caerleon: 2000000, Martlock: 1500000 },
    T6_MOUNT_OX: { Martlock: 200000 },
    T6_METALBAR: { Bridgewatch: 1000 },
    T6_LEATHER: { Thetford: 800 },
    T6_PLANKS: { Lymhurst: 600 },
  }));
  const r = rows.find((x) => x.itemId === "T6_MOUNT_SIEGE_BALLISTA");
  assert.strictEqual(r.sellCity, "Caerleon");
  assert.strictEqual(r.sellPrice, 2000000);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
