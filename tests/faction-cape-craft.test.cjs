/**
 * Test: crafted faction capes as Faction Spending rows.
 *
 * Every crest row in the Faction Spending table gets a crafted-cape
 * counterpart: the cape you craft from that crest (base cape + crest + faction
 * hearts / tokens). Crafting CONSUMES the crest, so the cape row spends the
 * crest's currency — FP for the royal-city ladders, Favor for the Avalon /
 * Smuggler / Demon / Brecilien crests — PLUS the city hearts the royal recipes
 * consume, which are Faction-Point purchases too (3,000 FP each,
 * js/data-faction-fp-costs.js), never silver. Its net silver is the cape sale
 * after fees minus the market cost of the SILVER inputs only, which puts
 * "sell the crest raw" and "craft it into a cape" side by side in the same
 * silver-per-FP (or per-Favor) sort.
 *
 * Contract (parameterised, black-box):
 *  - Royal city capes (T4–T8 × 5 cities, 25 rows): currency FP, fpCost =
 *    crest FP (400/2250/3000/7500/15000) + hearts × 3,000 FP (recipe counts
 *    1/1/3/5/10 for T4/T5/T6/T7/T8), category "Cape T{t}".
 *  - Favor-crest capes (Avalon/Smuggler/Demon/Brecilien × T4–T8, 20 rows):
 *    currency Favor, favorCost from the family's own schedule (Demon is
 *    steeper), favorFaction = the crest's vendor group, category
 *    "{Family} Cape". Their Mists/Avalon quest tokens (QUESTITEM_TOKEN_*)
 *    are silver market buys, not FP.
 *  - net = netSilverAfterFees(cape sale) − Σ(silver input buy price × count);
 *    the silver inputs are the base cape (plus quest tokens for the Favor
 *    families) — hearts never enter the sum.
 *  - A missing input price never inflates silently: inputsKnown=false and the
 *    row carries an "incomplete" warning note; the row still renders.
 *  - The row note lists every recipe material in recipe order; the crest AND
 *    the royal hearts are tagged with their currency cost ("400 FP",
 *    "3,000 FP", "90 Favor") instead of a buy city — they are paid in FP /
 *    Favor, so they never enter inputCost and never flip inputsKnown.
 *  - Scan universe: all 45 capes + every non-crest recipe mat (base capes,
 *    hearts, Mists/Avalon tokens).
 *  - Sell city respects the Black/Red Zone Routes toggle via the cape's
 *    faction city (royal) / a royal anchor (Favor).
 *  - Faction dropdown filter groups capes like their crest rows.
 *
 * Loads the real js/faction-cape-craft.js + js/render-faction-spending.js via
 * Module._compile (same harness as tests/faction-spending-route-filter.test.cjs)
 * with the real data files (fp costs, favor costs, GEAR_CAPES recipes) and
 * faithful mirrors of the utils.js market helpers.
 *
 * Run: node --test tests/faction-cape-craft.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

// Row text runs through tx(english, slug); en-mode identity keeps assertions in English.
globalThis.tx = globalThis.tx || ((en) => en);

const src = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");
const fpCostsSrc = src("data-faction-fp-costs.js");
const favorCostsSrc = src("data-favor-costs.js");
const gearCapesSrc = src("gear-capes.js");
const capeCraftSrc = src("faction-cape-craft.js");
const renderSrc = src("render-faction-spending.js");

// --- stubs: faithful mirrors of the utils.js helpers the modules need ---
// _factionFilter (below) is the mutable faction-dropdown value for the filter
// tests, read by buildFactionSpendingRows through document.getElementById.
const stubs = `
${fpCostsSrc}
${favorCostsSrc}
${gearCapesSrc}

const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const FACTION_CHESTS = [];
const DEFAULT_CHEST_AVG_YIELD = 73800;
const tableState = { "mounts-table": { data: [] }, "transport-table": { data: [] } };

// Mutable faction-dropdown value, flipped per-test via the exported setter.
let _factionFilter = "";

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

// Mirror of js/utils.js getSellPrice / findBestSellCity (honours route origin).
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

// Mirror of js/utils.js getBuyPrice (buy-order price, sell_price fallback).
function getBuyPrice(itemData, city) {
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].buy_price || itemData[city].sell_price || 0;
}

function getItemDisplayName(id) { return id; }
// Mirror of js/calculations.js formatSilver — the crest's currency cost in the
// row note runs through it ("15,000 FP").
function formatSilver(n) { return Math.round(n).toLocaleString(); }
const ITEM_NAMES_MAP = {};
function renderTableData() {}
// Favor rows are out of scope here — stub empty so buildFactionSpendingRows
// only exercises the FP rows + the crafted-cape rows under test.
function buildFavorSpendingRows() { return []; }

globalThis.document = {
  _factionFilterInit: false,
  _breedToggleInit: false,
  getElementById: (id) => (id === "faction-spending-filter")
    ? { value: _factionFilter, addEventListener: () => {} }
    : null,
  addEventListener: () => {},
  querySelectorAll: () => [],
};
`;

const mod = new Module("faction-cape-craft-test");
mod._compile(
  stubs +
    capeCraftSrc +
    renderSrc +
    `
    module.exports = {
      buildFactionCapeCraftRows,
      getFactionCapeCraftIds,
      buildFactionSpendingRows,
      setBlackRed: (v) => { _blackRedOn = !!v; },
      setFilter: (v) => { _factionFilter = v; },
      GEAR_CAPES,
      getFpCost,
      getFamilyCrestFavorCost,
      FAVOR_CREST_FAMILIES,
    };`,
  "faction-cape-craft.test.js"
);

const {
  buildFactionCapeCraftRows,
  getFactionCapeCraftIds,
  buildFactionSpendingRows,
  setBlackRed,
  setFilter,
  GEAR_CAPES,
  getFpCost,
  getFamilyCrestFavorCost,
  FAVOR_CREST_FAMILIES,
} = mod.exports;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const ROYAL_CITIES = ["THETFORD", "LYMHURST", "BRIDGEWATCH", "FORTSTERLING", "MARTLOCK"];
const FAVOR_ID_STEMS = FAVOR_CREST_FAMILIES.map((f) => f.idStem);
// Crest FP ladder (js/data-faction-fp-costs.js) + the per-tier heart counts in
// the royal recipes (js/gear-capes.js) — each heart costs 3,000 FP.
const TIER_FP = { 4: 400, 5: 2250, 6: 3000, 7: 7500, 8: 15000 };
const TIER_HEARTS = { 4: 1, 5: 1, 6: 3, 7: 5, 8: 10 };
const HEART_FP = 3000;

const allRoyalCapIds = [];
for (let t = 4; t <= 8; t++) ROYAL_CITIES.forEach((c) => allRoyalCapIds.push(`T${t}_CAPEITEM_FW_${c}`));
const allFavorCapIds = [];
for (let t = 4; t <= 8; t++) FAVOR_ID_STEMS.forEach((s) => allFavorCapIds.push(`T${t}_${s}`));

function mkMarket(entries) {
  // entries: { itemId: { city: { sell_price, buy_price } } }
  const data = {};
  for (const [id, cities] of Object.entries(entries)) {
    data[id] = {};
    for (const [city, p] of Object.entries(cities)) data[id][city] = { ...p, volume_24h: 100 };
  }
  return data;
}

// Recipe market inputs of a cape (everything except the crest).
function capeInputs(capeId) {
  const recipe = GEAR_CAPES.find((r) => r.id === capeId);
  const crestId = capeId + "_BP";
  return recipe.materials.filter((m) => m.matId !== crestId);
}

console.log("Faction cape craft rows tests\n");

// ── Data integrity: every cape row's recipe carries its crest, and the crest ─
// has a purchase cost in the matching currency.
[...allRoyalCapIds, ...allFavorCapIds].forEach((capeId) => {
  const isRoyal = allRoyalCapIds.includes(capeId);
  test(`recipe integrity: ${capeId}`, () => {
    const recipe = GEAR_CAPES.find((r) => r.id === capeId);
    assert.ok(recipe, "recipe exists in GEAR_CAPES");
    const crestId = capeId + "_BP";
    const crestMats = recipe.materials.filter((m) => m.matId === crestId);
    assert.strictEqual(crestMats.length, 1, "recipe consumes exactly 1 crest");
    assert.ok(capeInputs(capeId).length >= 1, "has market inputs beyond the crest");
    if (isRoyal) assert.ok(getFpCost(crestId) > 0, "crest is FP-priced");
    else {
      const fam = FAVOR_CREST_FAMILIES.find((f) => capeId.endsWith("_" + f.idStem));
      assert.ok(getFamilyCrestFavorCost(fam, parseInt(capeId[1], 10)) > 0, "crest is Favor-priced");
    }
  });
});

// ── Row counts ────────────────────────────────────────────────────────────────
test("25 royal FP rows + 20 Favor rows", () => {
  const { fpRows, favorRows } = buildFactionCapeCraftRows(mkMarket({}));
  assert.strictEqual(fpRows.length, 25);
  assert.strictEqual(favorRows.length, 20);
});

test("empty market data → empty row sets, no throw", () => {
  const { fpRows, favorRows } = buildFactionCapeCraftRows(null);
  assert.strictEqual(fpRows.length, 0);
  assert.strictEqual(favorRows.length, 0);
});

// ── Royal FP row economics ────────────────────────────────────────────────────
// T4 Lymhurst cape: crest 400 FP + 1× Treeheart @ 3,000 FP = 3,400 FP; the only
// silver input is T4_CAPE @ 20,000 (the heart is FP — its 5,000-silver seed
// must be ignored); cape sells 100,000 → net = 93,500 − 20,000 = 73,500;
// S/FP = 73,500 / 3,400 ≈ 21.6176.
test("T4 Lymhurst cape: FP cost incl. heart, category, net math, S/FP", () => {
  const market = mkMarket({
    T4_CAPEITEM_FW_LYMHURST: { Lymhurst: { sell_price: 100000 } },
    T4_CAPEITEM_FW_LYMHURST_BP: { Lymhurst: { sell_price: 9000 } },
    T4_CAPE: { Thetford: { buy_price: 20000 } },
    T1_FACTION_FOREST_TOKEN_1: { Lymhurst: { buy_price: 5000 } },
  });
  const { fpRows } = buildFactionCapeCraftRows(market);
  const row = fpRows.find((r) => r.itemId === "T4_CAPEITEM_FW_LYMHURST");
  assert.ok(row, "row present");
  assert.strictEqual(row.currency, "FP");
  assert.strictEqual(row.fpCost, 3400, "400 crest FP + 1× heart @ 3,000 FP");
  assert.strictEqual(row.category, "Cape T4");
  assert.strictEqual(row.sellCity, "Lymhurst");
  assert.strictEqual(row.sellPrice, 100000);
  assert.strictEqual(row.inputCost, 20000, "base cape only — the heart costs FP, not silver");
  assert.strictEqual(row.netSilver, 73500);
  assert.ok(Math.abs(row.silverPerFp - 73500 / 3400) < 0.01);
  assert.strictEqual(row.inputsKnown, true);
  assert.strictEqual(row.tradeable, true);
});

// Every royal tier folds its crest's FP ladder entry AND its hearts' FP in.
allRoyalCapIds.forEach((capeId) => {
  const tier = capeId[1];
  test(`royal ${capeId}: fpCost = crest FP + ${TIER_HEARTS[tier]}× heart @ 3,000 FP, category Cape T${tier}`, () => {
    const market = mkMarket({});
    const { fpRows } = buildFactionCapeCraftRows(market);
    const row = fpRows.find((r) => r.itemId === capeId);
    assert.ok(row, "row present even unpriced");
    assert.strictEqual(row.currency, "FP");
    assert.strictEqual(row.fpCost, TIER_FP[tier] + TIER_HEARTS[tier] * HEART_FP,
      "crest FP + hearts × 3,000 FP — hearts need no market price");
    assert.strictEqual(row.category, `Cape T${tier}`);
    assert.strictEqual(row.favorCost, 0);
    assert.strictEqual(row.silverPerFavor, 0);
  });
});

// ── Multi-count inputs: T8 Lymhurst cape consumes 10× hearts (FP, not silver) ─
test("T8 Lymhurst cape: 10× hearts are FP — only the base cape is deducted", () => {
  const market = mkMarket({
    T8_CAPEITEM_FW_LYMHURST: { Lymhurst: { sell_price: 1000000 } },
    T8_CAPE: { Thetford: { buy_price: 200000 } },
    T1_FACTION_FOREST_TOKEN_1: { Lymhurst: { buy_price: 10000 } },
  });
  const { fpRows } = buildFactionCapeCraftRows(market);
  const row = fpRows.find((r) => r.itemId === "T8_CAPEITEM_FW_LYMHURST");
  // net = 1,000,000 × 0.935 − 200,000 = 935,000 − 200,000 = 735,000
  // (the 10× hearts — seeded at 10,000 silver — must be ignored here).
  assert.strictEqual(row.netSilver, 735000);
  assert.strictEqual(row.fpCost, 45000, "15,000 crest FP + 10 × 3,000 heart FP");
  assert.ok(Math.abs(row.silverPerFp - 735000 / 45000) < 0.01);
});

// ── Favor cape rows ───────────────────────────────────────────────────────────
// T4 Avalon cape: crest = 90 Favor; inputs T4_CAPE @ 20,000 + 15× Avalon token
// @ 1,000; cape sells 100,000 → net = 93,500 − 35,000 = 58,500; S/Favor = 650.
test("T4 Avalon cape: Favor cost, vendor group, 15× token input, S/Favor", () => {
  const market = mkMarket({
    T4_CAPEITEM_AVALON: { Lymhurst: { sell_price: 100000 } },
    T4_CAPE: { Thetford: { buy_price: 20000 } },
    QUESTITEM_TOKEN_AVALON: { Caerleon: { buy_price: 1000 } },
  });
  const { favorRows } = buildFactionCapeCraftRows(market);
  const row = favorRows.find((r) => r.itemId === "T4_CAPEITEM_AVALON");
  assert.ok(row, "row present");
  assert.strictEqual(row.currency, "Favor");
  assert.strictEqual(row.favorCost, 90);
  assert.strictEqual(row.fpCost, 0);
  assert.strictEqual(row.silverPerFp, 0);
  assert.strictEqual(row.favorFaction, "Energy Manipulator");
  assert.strictEqual(row.category, "Avalonian Cape");
  assert.strictEqual(row.netSilver, 58500);
  assert.ok(Math.abs(row.silverPerFavor - 650) < 0.01);
  assert.strictEqual(row.metric, "silver");
});

// Favor families keep their own vendor group + schedule + category.
const favorCases = [
  ["T8_CAPEITEM_AVALON", 3400, "Energy Manipulator", "Avalonian Cape"],
  ["T4_CAPEITEM_SMUGGLER", 90, "Smuggler's Den", "Smuggler Cape"],
  ["T8_CAPEITEM_DEMON", 1500, "The Antiquarian", "Demon Cape"],
  ["T8_CAPEITEM_FW_BRECILIEN", 3400, "Brecilien", "Brecilien Cape"],
  ["T4_CAPEITEM_FW_BRECILIEN", 90, "Brecilien", "Brecilien Cape"],
];
favorCases.forEach(([capeId, favorCost, faction, category]) => {
  test(`favor ${capeId}: ${favorCost} Favor @ ${faction}`, () => {
    const { favorRows } = buildFactionCapeCraftRows(mkMarket({}));
    const row = favorRows.find((r) => r.itemId === capeId);
    assert.ok(row, "row present");
    assert.strictEqual(row.favorCost, favorCost);
    assert.strictEqual(row.favorFaction, faction);
    assert.strictEqual(row.category, category);
    assert.strictEqual(row.currency, "Favor");
  });
});

// ── Missing input price: row survives, flagged, never silently inflated ──────
test("missing T8_CAPE buy price → inputsKnown false + warning note; heart costs no silver", () => {
  const market = mkMarket({
    T8_CAPEITEM_FW_LYMHURST: { Lymhurst: { sell_price: 1000000 } },
    T1_FACTION_FOREST_TOKEN_1: { Lymhurst: { buy_price: 10000 } },
    // T8_CAPE deliberately unpriced
  });
  const { fpRows } = buildFactionCapeCraftRows(market);
  const row = fpRows.find((r) => r.itemId === "T8_CAPEITEM_FW_LYMHURST");
  assert.ok(row, "row still present");
  assert.strictEqual(row.inputsKnown, false);
  assert.ok(/incomplete/i.test(row.note), `note warns: ${row.note}`);
  // The heart is a FP purchase — it is neither a priced nor a missing silver
  // input: net uses 0 for the missing base cape only, and nothing else.
  assert.strictEqual(row.netSilver, 935000);
  assert.ok(!/@ Lymhurst/.test(row.note), `heart carries no buy city: ${row.note}`);
});

test("missing sell price → net 0, S/FP 0, row survives", () => {
  const market = mkMarket({
    T4_CAPEITEM_FW_LYMHURST_BP: { Lymhurst: { sell_price: 9000 } },
  });
  const { fpRows } = buildFactionCapeCraftRows(market);
  const row = fpRows.find((r) => r.itemId === "T4_CAPEITEM_FW_LYMHURST");
  assert.ok(row, "row present");
  assert.strictEqual(row.sellPrice, 0);
  assert.strictEqual(row.netSilver, 0);
  assert.strictEqual(row.silverPerFp, 0);
});

// ── Scan universe ─────────────────────────────────────────────────────────────
test("scan ids cover all 45 capes + base capes + tokens", () => {
  const ids = new Set(getFactionCapeCraftIds());
  [...allRoyalCapIds, ...allFavorCapIds].forEach((id) => assert.ok(ids.has(id), `missing ${id}`));
  for (let t = 4; t <= 8; t++) assert.ok(ids.has(`T${t}_CAPE`), `missing T${t}_CAPE`);
  assert.ok(ids.has("QUESTITEM_TOKEN_AVALON"), "missing Avalon token");
  assert.ok(ids.has("QUESTITEM_TOKEN_MISTS"), "missing Mists token");
  // Every recipe's non-crest mats must be priced too.
  [...allRoyalCapIds, ...allFavorCapIds].forEach((capeId) => {
    capeInputs(capeId).forEach((m) => assert.ok(ids.has(m.matId), `missing input ${m.matId} of ${capeId}`));
  });
});

// ── Route guard: royal capes don't value across Caerleon when toggle OFF ─────
test("OFF: Lymhurst cape sells Lymhurst, not Caerleon; ON: Caerleon wins", () => {
  const market = mkMarket({
    T4_CAPEITEM_FW_LYMHURST: { Caerleon: { sell_price: 200000 }, Lymhurst: { sell_price: 150000 } },
    T4_CAPE: { Thetford: { buy_price: 20000 } },
    T1_FACTION_FOREST_TOKEN_1: { Lymhurst: { buy_price: 5000 } },
  });
  setBlackRed(false);
  let row = buildFactionCapeCraftRows(market).fpRows.find((r) => r.itemId === "T4_CAPEITEM_FW_LYMHURST");
  assert.strictEqual(row.sellCity, "Lymhurst");
  assert.strictEqual(row.sellPrice, 150000);
  setBlackRed(true);
  row = buildFactionCapeCraftRows(market).fpRows.find((r) => r.itemId === "T4_CAPEITEM_FW_LYMHURST");
  assert.strictEqual(row.sellCity, "Caerleon");
  assert.strictEqual(row.sellPrice, 200000);
  setBlackRed(false);
});

// ── Faction dropdown filter: capes group like their crest rows ────────────────
function buildFilteredMarket() {
  return mkMarket({
    T4_CAPEITEM_FW_LYMHURST: { Lymhurst: { sell_price: 100000 } },
    T4_CAPEITEM_FW_LYMHURST_BP: { Lymhurst: { sell_price: 9000 } },
    T4_CAPEITEM_FW_THETFORD: { Thetford: { sell_price: 100000 } },
    T4_CAPEITEM_FW_THETFORD_BP: { Thetford: { sell_price: 9000 } },
    T4_CAPEITEM_AVALON: { Lymhurst: { sell_price: 100000 } },
    T4_CAPE: { Thetford: { buy_price: 20000 } },
    T1_FACTION_FOREST_TOKEN_1: { Lymhurst: { buy_price: 5000 } },
    T1_FACTION_SWAMP_TOKEN_1: { Thetford: { buy_price: 5000 } },
    QUESTITEM_TOKEN_AVALON: { Caerleon: { buy_price: 1000 } },
  });
}

test("filter '': Lymhurst + Thetford capes + Avalon cape all present", () => {
  setFilter("");
  const rows = buildFactionSpendingRows(buildFilteredMarket());
  assert.ok(rows.find((r) => r.itemId === "T4_CAPEITEM_FW_LYMHURST"), "Lymhurst cape");
  assert.ok(rows.find((r) => r.itemId === "T4_CAPEITEM_FW_THETFORD"), "Thetford cape");
  assert.ok(rows.find((r) => r.itemId === "T4_CAPEITEM_AVALON"), "Avalon cape");
});

test("filter 'Lymhurst': keeps Lymhurst cape, drops Thetford cape", () => {
  setFilter("Lymhurst");
  const rows = buildFactionSpendingRows(buildFilteredMarket());
  assert.ok(rows.find((r) => r.itemId === "T4_CAPEITEM_FW_LYMHURST"), "Lymhurst cape kept");
  assert.ok(!rows.find((r) => r.itemId === "T4_CAPEITEM_FW_THETFORD"), "Thetford cape dropped");
  assert.ok(!rows.find((r) => r.itemId === "T4_CAPEITEM_AVALON"), "Avalon cape dropped");
  setFilter("");
});

test("filter 'Energy Manipulator': keeps Avalon cape, drops royal capes", () => {
  setFilter("Energy Manipulator");
  const rows = buildFactionSpendingRows(buildFilteredMarket());
  assert.ok(rows.find((r) => r.itemId === "T4_CAPEITEM_AVALON"), "Avalon cape kept");
  assert.ok(!rows.find((r) => r.itemId === "T4_CAPEITEM_FW_LYMHURST"), "Lymhurst cape dropped");
  setFilter("");
});

// ── Crest rows untouched: the raw crest rows still exist beside the capes ────
test("raw crest rows unchanged alongside cape rows", () => {
  setFilter("");
  const rows = buildFactionSpendingRows(buildFilteredMarket());
  const crest = rows.find((r) => r.itemId === "T4_CAPEITEM_FW_LYMHURST_BP");
  assert.ok(crest, "raw Lymhurst crest row present");
  assert.strictEqual(crest.category, "Crest T4");
  assert.strictEqual(crest.netSilver, 9000 * 0.935);
});

// -- Row note lists the crest and the hearts as FP / Favor purchases ------
// Crest AND royal hearts are recipe materials paid in the row's currency, so
// they belong in the "crafted:" input list tagged with their currency cost
// ("400 FP", "3,000 FP") instead of a buy city — never in silver, exactly like
// the crest annotation. The Favor families' quest tokens stay silver market
// buys and keep their city.
const noteMarket = mkMarket({
  T4_CAPEITEM_FW_LYMHURST: { Lymhurst: { sell_price: 100000 } },
  T8_CAPEITEM_FW_LYMHURST: { Lymhurst: { sell_price: 1000000 } },
  T4_CAPEITEM_AVALON: { Lymhurst: { sell_price: 100000 } },
  T8_CAPEITEM_AVALON: { Lymhurst: { sell_price: 1000000 } },
  T4_CAPE: { Thetford: { buy_price: 20000 } },
  T8_CAPE: { Thetford: { buy_price: 200000 } },
  T1_FACTION_FOREST_TOKEN_1: { Lymhurst: { buy_price: 5000 } },
  QUESTITEM_TOKEN_AVALON: { Caerleon: { buy_price: 1000 } },
});

function noteFor(capeId) {
  const { fpRows, favorRows } = buildFactionCapeCraftRows(noteMarket);
  const row = [...fpRows, ...favorRows].find((r) => r.itemId === capeId);
  assert.ok(row, `row present: ${capeId}`);
  return row.note;
}

const crestNoteCases = [
  ["T4_CAPEITEM_FW_LYMHURST", "400 FP", "T4_CAPE", "1× T1_FACTION_FOREST_TOKEN_1 (3,000 FP)", true],
  ["T8_CAPEITEM_FW_LYMHURST", "15,000 FP", "T8_CAPE", "10× T1_FACTION_FOREST_TOKEN_1 (3,000 FP)", true],
  ["T4_CAPEITEM_AVALON", "90 Favor", "T4_CAPE", "15× QUESTITEM_TOKEN_AVALON", false],
  ["T8_CAPEITEM_AVALON", "3,400 Favor", "T8_CAPE", "150× QUESTITEM_TOKEN_AVALON", false],
];
crestNoteCases.forEach(([capeId, currency, baseCapeId, tokenPart, heartPaidInFp]) => {
  test(`note lists crest + inputs: ${capeId}`, () => {
    const note = noteFor(capeId);
    const crestId = capeId + "_BP";
    assert.ok(note.includes(`1× ${crestId}`), `crest named: ${note}`);
    assert.ok(note.includes(`(${currency})`), `crest carries its ${currency} cost: ${note}`);
    assert.ok(note.includes(baseCapeId), `base cape listed: ${note}`);
    assert.ok(note.includes(tokenPart), `heart/energy listed: ${note}`);
    if (heartPaidInFp) {
      // Royal hearts are FP purchases like the crest: FP-annotated, never a
      // silver buy with a city.
      assert.ok(!note.includes("T1_FACTION_FOREST_TOKEN_1 @"),
        `royal heart is FP-annotated, not a silver buy: ${note}`);
    }
    // Recipe order: base cape, crest, heart/energy.
    assert.ok(note.indexOf(baseCapeId) < note.indexOf(crestId), `base cape before crest: ${note}`);
    assert.ok(note.indexOf(crestId) < note.indexOf(tokenPart), `crest before heart/energy: ${note}`);
  });
});

test("crest + hearts in the note never cost silver: net + inputCost unchanged", () => {
  const { fpRows, favorRows } = buildFactionCapeCraftRows(noteMarket);
  const royal = fpRows.find((r) => r.itemId === "T4_CAPEITEM_FW_LYMHURST");
  // 100,000 × 0.935 − 20,000 = 73,500 — crest (400 FP) and heart (3,000 FP)
  // add nothing silver.
  assert.strictEqual(royal.inputCost, 20000);
  assert.strictEqual(royal.netSilver, 73500);
  assert.ok(Math.abs(royal.silverPerFp - 73500 / 3400) < 0.01);
  const avalon = favorRows.find((r) => r.itemId === "T4_CAPEITEM_AVALON");
  // 100,000 × 0.935 - (20,000 + 15 × 1,000) = 58,500 — the quest tokens stay
  // silver market buys.
  assert.strictEqual(avalon.inputCost, 35000);
  assert.strictEqual(avalon.netSilver, 58500);
  assert.ok(Math.abs(avalon.silverPerFavor - 650) < 0.01);
});

test("unpriced crest does not flag inputs incomplete", () => {
  // No crest market entry at all -- it is bought with FP, not silver.
  const { fpRows } = buildFactionCapeCraftRows(noteMarket);
  const row = fpRows.find((r) => r.itemId === "T4_CAPEITEM_FW_LYMHURST");
  assert.strictEqual(row.inputsKnown, true);
  assert.ok(!/incomplete/i.test(row.note), `no warning: ${row.note}`);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
