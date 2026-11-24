// Run: node --test tests/faction-cape-silver-mats.test.cjs
/**
 * Test: crafted faction capes put their SILVER inputs on the shopping list
 * (TDD red — the hearts-are-FP correction is not implemented yet).
 *
 * A crafted royal cape's recipe (js/gear-capes.js) is base cape + crest +
 * city-heart fragments. Only the BASE CAPE is a silver market input:
 *  - the `*_BP` crest is paid in Faction Points (the row's fpCost
 *    denominator), and
 *  - the `T1_FACTION_*_TOKEN_*` city heart is ALSO paid in Faction Points
 *    (3,000 FP each, js/data-faction-fp-costs.js) — the current producer
 *    wrongly treats it as silver (it charges it into inputCost and lists it
 *    among silverMats).
 *
 * Contract under test (the planned fix):
 *  - js/faction-cape-craft.js stores each cape row's ONLY silver input — the
 *    base cape — on the row as structured lines in `row.silverMats`
 *    ({ matId, count, city, perUnit } per line, priced at the same cheapest
 *    buy that produced the row's inputCost); crest AND hearts never appear;
 *  - row.inputCost = the base cape's cost only, and row.fpCost = crest FP +
 *    heartCount × 3,000 FP (T4 Lymhurst: 400 + 3,000 = 3,400; T8:
 *    15,000 + 10 × 3,000 = 45,000);
 *  - the faction extractor, when the row has `silverMats`, outputs
 *    `inputCost` = the row's inputCost and `materials` = those lines in the
 *    exact shape aggregateCraftListMaterials consumes (the _clRecipeMats /
 *    _clMat shape: { matId, count, city, perUnit, note });
 *  - any row WITHOUT `silverMats` (crest rows, legacy stored shapes) keeps the
 *    legacy `{ inputCost: 0, materials: [] }`.
 *
 * Black-box: the REAL extractor + aggregator (standalone Node modules) over
 * rows built by the REAL js/faction-cape-craft.js, loaded browser-global style
 * via Module._compile with the real data files (GEAR_CAPES recipes, FP costs)
 * and simulated market data — same harness as
 * tests/faction-cape-craft.test.cjs, no browser, no live API. `silverMats` is
 * attached here from the file's own cheapest-buy helper over the same
 * simulated market, with crest + hearts filtered out, because the
 * producer-side hearts-are-FP fix does not exist yet.
 *
 * RED BY DESIGN: the producer-side cases fail against the current code — it
 * still charges the heart into inputCost (25,000 / 300,000), leaves fpCost on
 * the crest-only ladder (400 / 15,000) and lists the heart among raw
 * silverMats. The extractor pins pin the line SHAPE; the two legacy pins pass
 * before AND after the fix.
 */

const assert = require("assert");
const { test } = require("node:test");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");

// ── the list side: real extractor registry + shopping-list aggregator ────────

const {
  extractCraftListRow,
  aggregateCraftListMaterials,
} = require(path.join(ROOT, "js", "craft-list-materials.js"));

// ── the producer side: real faction-cape-craft.js over a simulated market ────

// Row text runs through tx(english, slug); en-mode identity keeps assertions in English.
globalThis.tx = globalThis.tx || ((en) => en);

const src = (f) => fs.readFileSync(path.join(ROOT, "js", f), "utf8");

// Stubs: faithful mirrors of the utils.js market helpers the cape builder
// calls (same approach as tests/faction-cape-craft.test.cjs).
const stubs = `
const ROYAL_CITIES = ["Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];

let _blackRedOn = false;
function isBlackRedZoneEnabled() { return _blackRedOn; }
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

const FW_CITY_SUFFIX_MAP = {
  THETFORD: "Thetford", LYMHURST: "Lymhurst", FORTSTERLING: "Fort Sterling",
  BRIDGEWATCH: "Bridgewatch", MARTLOCK: "Martlock", CAERLEON: "Caerleon",
};
function getItemFaction(itemId) {
  const m = String(itemId || "").match(/_FW_([A-Z]+)(?:_|$)/);
  return m ? (FW_CITY_SUFFIX_MAP[m[1]] || null) : null;
}

function getOverridePrice() { return null; }
function getSellPrice(itemData, city) {
  return (itemData && itemData[city] && itemData[city].sell_price) || 0;
}
function findBestSellCity(marketData, itemId, cities, minVolume, excludeBuyCity) {
  let bestPrice = 0, bestCity = null;
  (cities || []).forEach((c) => {
    if (excludeBuyCity && isInvalidCrossRoute(excludeBuyCity, c)) return;
    const p = getSellPrice(marketData[itemId], c);
    const v = (marketData[itemId] && marketData[itemId][c] && marketData[itemId][c].volume_24h) || 0;
    if (p > 0 && v >= minVolume && p > bestPrice) { bestPrice = p; bestCity = c; }
  });
  return { city: bestCity, price: bestPrice };
}
function getBuyPrice(itemData, city) {
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].buy_price || itemData[city].sell_price || 0;
}
function getItemDisplayName(id) { return id; }
function formatSilver(n) { return Math.round(n).toLocaleString(); }
const ITEM_NAMES_MAP = {};
`;

const mod = new Module("faction-cape-silver-mats-test");
mod._compile(
  stubs +
    src("data-faction-fp-costs.js") +
    src("gear-capes.js") +
    src("faction-cape-craft.js") +
    `
    module.exports = {
      buildFactionCapeCraftRows,
      GEAR_CAPES,
      getFpCost,
      // The file's own cheapest-buy lookup — silverMats is priced with the very
      // helper that priced the row's inputCost, so the two cannot drift.
      cheapestBuy: (marketData, itemId) => _capeCheapestBuy(marketData, itemId),
    };`,
  "faction-cape-silver-mats.test.js",
);

const { buildFactionCapeCraftRows, GEAR_CAPES, cheapestBuy } = mod.exports;

// ── simulated data ────────────────────────────────────────────────────────────

/** entries: { itemId: { city: { sell_price, buy_price } } } — all simulated. */
function mkMarket(entries) {
  const data = {};
  for (const [id, cities] of Object.entries(entries)) {
    data[id] = {};
    for (const [city, p] of Object.entries(cities)) {
      data[id][city] = { ...p, volume_24h: 100 };
    }
  }
  return data;
}

/**
 * A real crafted-cape Faction Spending row, with `silverMats` attached the way
 * the planned producer fix will: the recipe's ONLY silver inputs — the `*_BP`
 * crest AND the FP-purchased city hearts filtered out — each priced at the
 * same cheapest buy that produced the row's inputCost.
 */
// City-heart fragments are Faction-Point purchases (3,000 FP each in
// js/data-faction-fp-costs.js), never silver market inputs.
const isFactionHeart = (matId) => /^T1_FACTION_[A-Z]+_TOKEN_/.test(String(matId));

function capeRowWithSilverMats(capeId, market) {
  const { fpRows } = buildFactionCapeCraftRows(market);
  const row = fpRows.find((r) => r.itemId === capeId);
  assert.ok(row, `precondition: cape row built for ${capeId}`);
  const crestId = capeId + "_BP";
  const recipe = GEAR_CAPES.find((r) => r.id === capeId);
  assert.ok(recipe, `precondition: recipe for ${capeId}`);
  row.silverMats = recipe.materials
    .filter((m) => m.matId !== crestId && !isFactionHeart(m.matId))
    .map((m) => {
      const best = cheapestBuy(market, m.matId);
      return { matId: m.matId, count: m.count || 1, city: best.city, perUnit: best.price };
    });
  return row;
}

/** Order-independent projection of shopping lines onto their keyed fields. */
const linesOf = (materials) =>
  (materials || [])
    .map((m) => ({ matId: m.matId, count: m.count, city: m.city, perUnit: m.perUnit }))
    .sort((a, b) => String(a.matId).localeCompare(String(b.matId)));

// T4 Lymhurst cape: the ONLY silver input is base cape T4_CAPE ×1 @ Thetford
// 20,000 → row inputCost 20,000; fpCost = 400 (crest) + 3,000 (1× Treeheart)
// = 3,400. The crest CARRIES market data (9,000 in Lymhurst) and so does the
// heart (5,000 in Lymhurst) — both are paid in FP and both must be ignored:
// never shopped as silver, never part of inputCost. The seeds stay to prove it.
const T4_MARKET = mkMarket({
  T4_CAPEITEM_FW_LYMHURST: { Lymhurst: { sell_price: 100000 } },
  T4_CAPEITEM_FW_LYMHURST_BP: { Lymhurst: { sell_price: 9000 } },
  T4_CAPE: { Thetford: { buy_price: 20000 } },
  T1_FACTION_FOREST_TOKEN_1: { Lymhurst: { buy_price: 5000 } },
});

// ── the extractor contract ────────────────────────────────────────────────────

test("T4 Lymhurst cape row: only the base cape reaches the list, crest and heart never do", () => {
  const row = capeRowWithSilverMats("T4_CAPEITEM_FW_LYMHURST", T4_MARKET);
  // Producer preconditions: the heart is a FP purchase, not a silver one.
  assert.strictEqual(row.inputCost, 20000, "row inputCost = base cape only (heart is FP)");
  assert.strictEqual(row.fpCost, 3400, "crest 400 FP + 1× heart × 3,000 FP");

  const got = extractCraftListRow("faction-spending-table", row);
  assert.ok(got, "extractor returned a row");
  assert.strictEqual(got.itemId, "T4_CAPEITEM_FW_LYMHURST");
  // The row's REAL input cost survives — never the hardcoded 0.
  assert.strictEqual(got.inputCost, 20000);

  assert.deepStrictEqual(linesOf(got.materials), [
    { matId: "T4_CAPE", count: 1, city: "Thetford", perUnit: 20000 },
  ]);
  assert.ok(
    !got.materials.some((m) => isFactionHeart(m.matId)),
    "the faction heart is bought with FP — never on the shopping list",
  );
  // Lines are plain buys with a price and a city — nothing self-made, no crest.
  got.materials.forEach((m) => {
    assert.ok(m.perUnit > 0, `${m.matId} carries a price`);
    assert.ok(m.city, `${m.matId} carries a city`);
    assert.strictEqual(m.note, "", `${m.matId} is a plain buy, not self-made`);
    assert.ok(!/_BP/.test(m.matId), `no crest id on the shopping list: ${m.matId}`);
  });
});

test("T8 Lymhurst cape row: 10× hearts are FP — only the base cape reaches the list", () => {
  const market = mkMarket({
    T8_CAPEITEM_FW_LYMHURST: { Lymhurst: { sell_price: 1000000 } },
    T8_CAPE: { Thetford: { buy_price: 200000 } },
    // FP-purchased heart — its silver seed must be ignored entirely.
    T1_FACTION_FOREST_TOKEN_1: { Lymhurst: { buy_price: 10000 } },
  });
  const row = capeRowWithSilverMats("T8_CAPEITEM_FW_LYMHURST", market);
  assert.strictEqual(row.inputCost, 200000, "base cape only — the 10× hearts are FP");
  assert.strictEqual(row.fpCost, 45000, "crest 15,000 FP + 10× hearts × 3,000 FP");

  const got = extractCraftListRow("faction-spending-table", row);
  assert.strictEqual(got.inputCost, 200000);
  assert.deepStrictEqual(linesOf(got.materials), [
    { matId: "T8_CAPE", count: 1, city: "Thetford", perUnit: 200000 },
  ]);
  got.materials.forEach((m) => {
    assert.ok(!/_BP/.test(m.matId), `no crest id on the shopping list: ${m.matId}`);
    assert.ok(!isFactionHeart(m.matId), `no heart on the shopping list: ${m.matId}`);
  });
});

test("a pure FP crest row (no silverMats) keeps the legacy zero-cost shape", () => {
  // Shape mirrors the crest rows buildFactionSpendingRows produces (the same
  // pin as tests/craft-list-materials.test.cjs "faction-spending-table").
  const crestRow = {
    itemId: "T4_CAPEITEM_FW_LYMHURST_BP",
    name: "Adept's Lymhurst Crest",
    category: "Crest T4",
    currency: "FP",
    sellCity: "Lymhurst",
    sellPrice: 9000,
    netSilver: 9000 * 0.935,
    fpCost: 400,
    silverPerFp: (9000 * 0.935) / 400,
    metric: "silver",
  };
  const got = extractCraftListRow("faction-spending-table", crestRow);
  assert.ok(got, "extractor returned a row");
  assert.strictEqual(got.inputCost, 0);
  assert.deepStrictEqual(got.materials, []);
});

test("a cape row WITHOUT silverMats (legacy stored shape) keeps legacy too", () => {
  const row = capeRowWithSilverMats("T4_CAPEITEM_FW_LYMHURST", T4_MARKET);
  delete row.silverMats;
  const got = extractCraftListRow("faction-spending-table", row);
  assert.ok(got, "extractor returned a row");
  assert.strictEqual(got.inputCost, 0);
  assert.deepStrictEqual(got.materials, []);
});

// ── the shopping board ────────────────────────────────────────────────────────

test("aggregation: the base cape line scales with qty and no heart line exists", () => {
  const row = capeRowWithSilverMats("T4_CAPEITEM_FW_LYMHURST", T4_MARKET);
  const got = extractCraftListRow("faction-spending-table", row);
  const out = aggregateCraftListMaterials([{ ...got, qty: 3 }]);

  assert.strictEqual(out.lines.length, 1, "the single priced line survives (perUnit > 0)");
  const byId = Object.fromEntries(out.lines.map((l) => [l.matId, l]));
  assert.deepStrictEqual(
    {
      matId: "T4_CAPE",
      count: byId.T4_CAPE.count,
      city: byId.T4_CAPE.city,
      perUnit: byId.T4_CAPE.perUnit,
      total: byId.T4_CAPE.total,
    },
    { matId: "T4_CAPE", count: 3, city: "Thetford", perUnit: 20000, total: 60000 },
  );
  assert.strictEqual(out.grandTotal, 60000, "3 × base cape price — hearts cost FP, not silver");
});

test("consistency: the extracted lines sum to the row's own input cost", () => {
  [
    capeRowWithSilverMats("T4_CAPEITEM_FW_LYMHURST", T4_MARKET),
    capeRowWithSilverMats("T8_CAPEITEM_FW_LYMHURST", mkMarket({
      T8_CAPEITEM_FW_LYMHURST: { Lymhurst: { sell_price: 1000000 } },
      T8_CAPE: { Thetford: { buy_price: 200000 } },
      T1_FACTION_FOREST_TOKEN_1: { Lymhurst: { buy_price: 10000 } },
    })),
  ].forEach((row) => {
    const got = extractCraftListRow("faction-spending-table", row);
    assert.strictEqual(got.inputCost, row.inputCost,
      `${row.itemId}: the extractor passes the row's own inputCost through`);
    const sum = got.materials.reduce((s, m) => s + m.count * m.perUnit, 0);
    assert.strictEqual(sum, got.inputCost,
      `${row.itemId}: the same numbers and cities the row was costed with`);
  });
});

// ── producer-side pin ─────────────────────────────────────────────────────────
// The extractor can only shop what the row builder publishes: the producer half
// of the contract is buildFactionCapeCraftRows itself carrying the base cape —
// and nothing else — as structured silver lines on every cape row, plus an
// fpCost that folds the hearts' 3,000 FP each in. Raw builder output only —
// nothing attached by the test — so this fails (red) until
// js/faction-cape-craft.js stops charging the FP hearts as silver.

test("producer pin: silverMats = base cape only, fpCost = crest FP + hearts × 3,000 FP", () => {
  [
    ["T4_CAPEITEM_FW_LYMHURST", T4_MARKET, 3400],
    ["T8_CAPEITEM_FW_LYMHURST", mkMarket({
      T8_CAPEITEM_FW_LYMHURST: { Lymhurst: { sell_price: 1000000 } },
      T8_CAPE: { Thetford: { buy_price: 200000 } },
      T1_FACTION_FOREST_TOKEN_1: { Lymhurst: { buy_price: 10000 } },
    }), 45000],
  ].forEach(([capeId, market, fpCost]) => {
    const { fpRows } = buildFactionCapeCraftRows(market);
    const row = fpRows.find((r) => r.itemId === capeId);
    assert.ok(row, `precondition: cape row built for ${capeId}`);

    assert.strictEqual(row.fpCost, fpCost,
      `${capeId}: fpCost = crest FP + hearts × 3,000 FP (hearts are FP, not silver)`);
    assert.ok(Array.isArray(row.silverMats),
      `${capeId}: row.silverMats is an array (got ${typeof row.silverMats})`);
    assert.strictEqual(row.silverMats.length, 1,
      `${capeId}: exactly the base cape — never the _BP crest, never the FP heart`);
    const byId = Object.fromEntries(row.silverMats.map((m) => [m.matId, m]));
    assert.deepStrictEqual(
      Object.keys(byId).sort(),
      [`T${capeId[1]}_CAPE`],
      `${capeId}: the one silver input (base cape only, no heart, no _BP crest)`,
    );
    assert.strictEqual(byId[`T${capeId[1]}_CAPE`].count, 1,
      `${capeId}: one base cape`);
    row.silverMats.forEach((m) => {
      assert.ok(typeof m.perUnit === "number" && m.perUnit > 0,
        `${capeId}: ${m.matId} perUnit is a number > 0`);
      assert.strictEqual(typeof m.city, "string",
        `${capeId}: ${m.matId} city is a string`);
      assert.ok(m.city, `${capeId}: ${m.matId} city is non-empty`);
    });
    const sum = row.silverMats.reduce((s, m) => s + m.count * m.perUnit, 0);
    assert.strictEqual(sum, row.inputCost,
      `${capeId}: the silver lines sum to the row's own inputCost`);
  });
});
