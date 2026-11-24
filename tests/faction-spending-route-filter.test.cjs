/**
 * Test: Faction Spending raw-sale rows respect the "Black/Red Zone Routes"
 * toggle when choosing the best sell city.
 *
 * Bug being guarded: buildFactionSpendRow used to call
 *   findBestSellCity(marketData, itemId, cities, 0, null)
 * passing `null` as the route origin, so isInvalidCrossRoute never ran and a
 * royal-sourced crest/heart/baby (e.g. an item bought with FP at the Thetford
 * NPC) would be valued at the Caerleon market price even with Black/Red Zone
 * Routes disabled — a Royal→Caerleon hop that crosses red/black zones.
 *
 * Fix: pass the item's source faction city (getItemFaction(itemId)) as the
 * route origin so findBestSellCity filters Royal↔Caerleon (and the reverse)
 * exactly like every other table.
 *
 * Contract (parameterised, black-box on the chosen sell city + gross price):
 *   - Toggle OFF: a royal-sourced item must NOT be valued in Caerleon; a
 *     Caerleon-sourced item must NOT be valued in a Royal city.
 *   - Toggle ON: every city is reachable, so the globally-highest price wins.
 *
 * Loads the real js/render-faction-spending.js via Module._compile (same
 * harness as tests/faction-spending-breed-detail.test.cjs) with faithful
 * mirrors of findBestSellCity / isInvalidCrossRoute / getItemFaction so the
 * actual production buildFactionSpendRow is exercised.
 *
 * Run: node tests/faction-spending-route-filter.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

// Row text runs through tx(english, slug); en-mode identity keeps assertions in English.
globalThis.tx = globalThis.tx || ((en) => en);
const assert = require("assert");

const fpCostsSrc = fs.readFileSync(
  path.join(__dirname, "..", "js", "data-faction-fp-costs.js"),
  "utf8"
);
const renderSrc = fs.readFileSync(
  path.join(__dirname, "..", "js", "render-faction-spending.js"),
  "utf8"
);

// --- stubs: faithful mirrors of the utils.js helpers buildFactionSpendRow needs ---
const stubs = `
${fpCostsSrc}

const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const FACTION_CHESTS = [];
const DEFAULT_CHEST_AVG_YIELD = 73800;
const tableState = { "mounts-table": { data: [] } };

// Toggle state, flipped per-test via the exported setter.
let _blackRedOn = false;
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

// Mirror of js/utils.js getItemFaction (+ helpers).
const FW_CITY_SUFFIX_MAP = {
  THETFORD: "Thetford", LYMHURST: "Lymhurst", FORTSTERLING: "Fort Sterling",
  BRIDGEWATCH: "Bridgewatch", MARTLOCK: "Martlock", CAERLEON: "Caerleon",
};
function getFactionLockCity(itemId) {
  if (!itemId || typeof itemId !== "string") return null;
  const m = itemId.match(/_FW_([A-Z]+)(?:_|$)/);
  if (!m) return null;
  return FW_CITY_SUFFIX_MAP[m[1]] || null;
}
const FACTION_BIOME_TO_CITY = {
  SWAMP: "Thetford", FOREST: "Lymhurst", MOUNTAIN: "Fort Sterling",
  HIGHLAND: "Martlock", STEPPE: "Bridgewatch", CAERLEON: "Caerleon",
};
function getItemFaction(itemId) {
  if (!itemId || typeof itemId !== "string") return null;
  const fwCity = getFactionLockCity(itemId);
  if (fwCity) return fwCity;
  const heart = itemId.match(/^T1_FACTION_([A-Z]+)_TOKEN_/);
  if (heart) return FACTION_BIOME_TO_CITY[heart[1]] || null;
  const chest = itemId.match(/FACTIONCAMPAIGN_REWARD_([A-Z]+)_/);
  if (chest) return FACTION_BIOME_TO_CITY[chest[1]] || null;
  return null;
}

// Mirror of js/utils.js findBestSellCity (honours excludeBuyCity route origin).
function getCityForce() { return null; }
function getOverridePrice() { return null; }
function getIQRBounds() { return { lower: 0, upper: Infinity }; }
function getSellPrice(itemData, city) {
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].sell_price || 0;
}
function findBestSellCity(marketData, itemId, cities, minVolume, excludeBuyCity) {
  const forced = getCityForce(itemId, "sell");
  if (forced && cities.includes(forced)) {
    const p = getSellPrice(marketData[itemId], forced);
    return { city: forced, price: p > 0 ? p : 0 };
  }
  let bestPrice = 0, bestCity = null;
  cities.forEach((c) => {
    if (excludeBuyCity && isInvalidCrossRoute(excludeBuyCity, c)) return;
    const p = getSellPrice(marketData[itemId], c);
    const v = (marketData[itemId] && marketData[itemId][c] && marketData[itemId][c].volume_24h) || 0;
    if (p > 0 && (v >= minVolume || getOverridePrice(itemId, c) !== null) && p > bestPrice) {
      bestPrice = p; bestCity = c;
    }
  });
  return { city: bestCity, price: bestPrice };
}

function getItemDisplayName(id) { return id; }
const ITEM_NAMES_MAP = {};
function renderTableData() {}
// no \`document\` global — the faction filter + init IIFEs short-circuit on it
`;

const mod = new Module("render-faction-spending-route-test");
mod._compile(
  stubs +
    renderSrc +
    `
    module.exports = {
      buildFactionSpendRow,
      buildFactionSpendingRows,
      setBlackRed: (v) => { _blackRedOn = !!v; },
    };`,
  "render-faction-spending.js"
);

const { buildFactionSpendRow, buildFactionSpendingRows, setBlackRed } = mod.exports;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

function mkMarket(itemId, cityPrices) {
  const data = {};
  for (const [city, price] of Object.entries(cityPrices)) {
    data[city] = { sell_price: price, volume_24h: 100 };
  }
  return { [itemId]: data };
}

function rawRow(itemId, market) {
  return buildFactionSpendRow(itemId, market, { tradeable: true, category: "x" });
}

console.log("Faction Spending route-filter (Black/Red Zone Routes) tests\n");

// ── Royal-sourced rows: Caerleon must be excluded when toggle OFF ──────────
const royalCases = [
  {
    label: "Thetford crest (Caerleon highest)",
    id: "T4_CAPEITEM_FW_THETFORD_BP",
    prices: { Caerleon: 20000, Thetford: 15000, Lymhurst: 14000 },
    offCity: "Thetford", offPrice: 15000,
    onCity: "Caerleon", onPrice: 20000,
  },
  {
    label: "Thetford baby (Caerleon highest, Bridgewatch 2nd)",
    id: "T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY",
    prices: { Caerleon: 95000, Thetford: 80000, Bridgewatch: 85000 },
    offCity: "Bridgewatch", offPrice: 85000,
    onCity: "Caerleon", onPrice: 95000,
  },
  {
    label: "Swamp heart → Thetford (Caerleon highest)",
    id: "T1_FACTION_SWAMP_TOKEN_1",
    prices: { Caerleon: 40000, Martlock: 35000 },
    offCity: "Martlock", offPrice: 35000,
    onCity: "Caerleon", onPrice: 40000,
  },
];

royalCases.forEach((c) => {
  test(`OFF: ${c.label} → ${c.offCity}, not Caerleon`, () => {
    setBlackRed(false);
    const row = rawRow(c.id, mkMarket(c.id, c.prices));
    assert.notStrictEqual(row.sellCity, "Caerleon", "must not route through Caerleon");
    assert.strictEqual(row.sellCity, c.offCity);
    assert.strictEqual(row.sellPrice, c.offPrice);
  });
  test(`ON:  ${c.label} → Caerleon (highest)`, () => {
    setBlackRed(true);
    const row = rawRow(c.id, mkMarket(c.id, c.prices));
    assert.strictEqual(row.sellCity, c.onCity);
    assert.strictEqual(row.sellPrice, c.onPrice);
  });
});

// ── Caerleon-sourced rows: Royal cities must be excluded when toggle OFF ────
const caerleonCases = [
  {
    label: "Caerleon baby (Lymhurst higher than Caerleon)",
    id: "T5_FARM_GREYWOLF_FW_CAERLEON_BABY",
    prices: { Caerleon: 90000, Lymhurst: 120000 },
    offCity: "Caerleon", offPrice: 90000,
    onCity: "Lymhurst", onPrice: 120000,
  },
  {
    label: "Shadow heart → Caerleon (Thetford higher)",
    id: "T1_FACTION_CAERLEON_TOKEN_1",
    prices: { Caerleon: 50000, Thetford: 70000 },
    offCity: "Caerleon", offPrice: 50000,
    onCity: "Thetford", onPrice: 70000,
  },
];

caerleonCases.forEach((c) => {
  test(`OFF: ${c.label} → Caerleon, no Royal hop`, () => {
    setBlackRed(false);
    const row = rawRow(c.id, mkMarket(c.id, c.prices));
    assert.strictEqual(row.sellCity, c.offCity);
    assert.strictEqual(row.sellPrice, c.offPrice);
  });
  test(`ON:  ${c.label} → ${c.onCity} (highest)`, () => {
    setBlackRed(true);
    const row = rawRow(c.id, mkMarket(c.id, c.prices));
    assert.strictEqual(row.sellCity, c.onCity);
    assert.strictEqual(row.sellPrice, c.onPrice);
  });
});

// ── Integration: the exact screenshot scenario through buildFactionSpendingRows ─
test("OFF: Thetford crest + baby rows in full table avoid Caerleon", () => {
  setBlackRed(false);
  const market = {
    ...mkMarket("T4_CAPEITEM_FW_THETFORD_BP", { Caerleon: 20000, Thetford: 15000 }),
    ...mkMarket("T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY", { Caerleon: 95000, Thetford: 80000 }),
  };
  const rows = buildFactionSpendingRows(market);
  const crest = rows.find((r) => r.itemId === "T4_CAPEITEM_FW_THETFORD_BP");
  const baby = rows.find((r) => r.itemId === "T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY");
  assert.ok(crest, "crest row present");
  assert.ok(baby, "baby row present");
  assert.strictEqual(crest.sellCity, "Thetford");
  assert.strictEqual(baby.sellCity, "Thetford");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
