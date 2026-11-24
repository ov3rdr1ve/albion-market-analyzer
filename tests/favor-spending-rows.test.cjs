/**
 * Test: buildFavorSpendingRows — the Energy Manipulator (Favor) rows that get
 * merged into the Faction Spending table.
 *
 * Black-box contract (synthetic marketData → row fields):
 *   - 20 rows total: 1 Conqueror's Chest + 15 Rune/Soul/Relic tokens + 4 mounts.
 *   - Every row carries currency:"Favor", fpCost:0, silverPerFp:0 (so it renders
 *     "—" in the FP columns) and a positive favorCost.
 *   - Token rows: silverPerFavor = netSilverAfterFees(bestSell) / favorCost.
 *   - Mount rows: netSilver = mountNet − (base mount + mats), priced cheapest
 *     across cities; silverPerFavor = that profit / favorCost.
 *   - Conqueror's Chest: non-tradeable fixed yield (overrideable); default 0
 *     yields silverPerFavor 0; an override sets the yield.
 *   - Missing market data → gross 0, silverPerFavor 0, empty sellCity.
 *
 * Loads the real js/render-favor-spending.js via Module._compile with faithful
 * mirrors of the utils.js helpers (same harness style as
 * tests/faction-spending-route-filter.test.cjs).
 *
 * Run: node tests/favor-spending-rows.test.cjs
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

// Per-test override map, e.g. { "ID|City": price }.
let _overrides = {};

const stubs = `
${favCostsSrc}
${fpCostsSrc}

const CITIES = ["Caerleon","Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch"];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = [...CITIES];

function getOverridePrice(itemId, city) {
  const k = itemId + "|" + city;
  return Object.prototype.hasOwnProperty.call(_overrides, k) ? _overrides[k] : null;
}
function getIQRBounds() { return { lower: 0, upper: Infinity }; }
// Pricing Model stubs shaped like js/utils.js: instant buys at the ask and
// sells into the bid, market orders the other way round. Default is market
// orders; tests that need the other model call __setMode and restore it.
let _mode = "market";
function getOrderType() { return _mode; }
function __setMode(m) { _mode = m; }
function getBuyPrice(itemData, city, bounds, itemId) {
  const ov = getOverridePrice(itemId, city);
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return (_mode === "instant" ? itemData[city].sell_price : itemData[city].buy_price) || 0;
}
function getSellPrice(itemData, city, bounds, itemId) {
  const ov = getOverridePrice(itemId, city);
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return (_mode === "instant" ? itemData[city].buy_price : itemData[city].sell_price) || 0;
}
function findBestSellCity(marketData, itemId, cities, minVolume, excludeBuyCity, originCity) {
  let bestPrice = 0, bestCity = null;
  cities.forEach((c) => {
    const p = getSellPrice(marketData[itemId], c, null, itemId);
    const v = (marketData[itemId] && marketData[itemId][c] && marketData[itemId][c].volume_24h) || 0;
    if (p > 0 && (v >= minVolume || getOverridePrice(itemId, c) !== null) && p > bestPrice) {
      bestPrice = p; bestCity = c;
    }
  });
  return { city: bestCity, price: bestPrice };
}
function getItemDisplayName(id) { return id; }
const ITEM_NAMES_MAP = {};
`;

const mod = new Module("render-favor-spending-test");
mod._compile(
  stubs + renderSrc + `
  module.exports = { buildFavorSpendingRows, __setMode, setOverrides: (o) => { _overrides = o || {}; } };`,
  "render-favor-spending.js"
);
const { buildFavorSpendingRows, setOverrides, __setMode } = mod.exports;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

function mkMarket(spec) {
  // spec: { itemId: { City: price } }, or { City: [buy, sell] } for a book whose
  // two sides differ (that is how the Pricing Model becomes visible).
  const md = {};
  for (const [id, cityPrices] of Object.entries(spec)) {
    md[id] = {};
    for (const [city, price] of Object.entries(cityPrices)) {
      const [buy, sell] = Array.isArray(price) ? price : [price, price];
      md[id][city] = { sell_price: sell, buy_price: buy, volume_24h: 100 };
    }
  }
  return md;
}

// net after 4% premium sales tax + the 2.5% sell-order setup fee, matching
// netSilverAfterFees (js/data-faction-fp-costs.js).
const net = (g) => Math.round(g * (1 - 0.04 - 0.025));

console.log("Favor Spending rows (Energy Manipulator) tests\n");

setOverrides({});

test("produces 52 rows: 1 chest + 1 energy + 15 tokens + 5 shards + 1 tome + 20 crests + 1 faerie + 4 babies + 4 mounts", () => {
  const rows = buildFavorSpendingRows(mkMarket({}));
  assert.strictEqual(rows.length, 52);
  assert.strictEqual(rows.filter((r) => r.category === "Conqueror Chest").length, 1);
  assert.strictEqual(rows.filter((r) => r.category === "Siphoned Energy").length, 1);
  assert.strictEqual(rows.filter((r) => /^Energy: /.test(r.category)).length, 15);
  assert.strictEqual(rows.filter((r) => r.category === "Avalonian Shard").length, 5);
  assert.strictEqual(rows.filter((r) => r.category === "Tome").length, 1);
  assert.strictEqual(rows.filter((r) => r.category === "Avalonian Crest").length, 5);
  assert.strictEqual(rows.filter((r) => r.category === "Smuggler Crest").length, 5);
  assert.strictEqual(rows.filter((r) => r.category === "Demon Crest").length, 5);
  assert.strictEqual(rows.filter((r) => r.category === "Brecilien Crest").length, 5);
  assert.strictEqual(rows.filter((r) => r.category === "Antiquarian Baby").length, 2);
  assert.strictEqual(rows.filter((r) => r.category === "Faerie Fire").length, 1);
  assert.strictEqual(rows.filter((r) => r.category === "Mystic Owl Baby").length, 2);
  assert.strictEqual(rows.filter((r) => r.category === "Energy Mount").length, 4);
});

test("Elder's Tome: 2,000 Favor, fame metric, 100 fame/Favor, non-tradable, no silver", () => {
  const rows = buildFavorSpendingRows(mkMarket({}));
  const r = rows.find((x) => x.itemId === "T8_SKILLBOOK_NONTRADABLE");
  assert.ok(r, "tome row present");
  assert.strictEqual(r.category, "Tome");
  assert.strictEqual(r.favorCost, 2000);
  assert.strictEqual(r.metric, "fame");
  assert.strictEqual(r.fameValue, 200000);
  assert.strictEqual(r.famePerFavor, 100);
  assert.strictEqual(r.tradeable, false);
  assert.strictEqual(r.silverPerFavor, 0);
  assert.strictEqual(r.netSilver, 0);
});

test("Avalonian Crest T8: 3,400 Favor, tradable, silverPerFavor = net/3400", () => {
  const rows = buildFavorSpendingRows(mkMarket({ T8_CAPEITEM_AVALON_BP: { Caerleon: 120000 } }));
  const r = rows.find((x) => x.itemId === "T8_CAPEITEM_AVALON_BP");
  assert.ok(r, "Avalonian crest row present");
  assert.strictEqual(r.category, "Avalonian Crest");
  assert.strictEqual(r.favorCost, 3400);
  assert.strictEqual(r.tradeable, true);
  assert.strictEqual(r.metric, "silver");
  assert.strictEqual(r.netSilver, net(120000));
  assert.ok(Math.abs(r.silverPerFavor - net(120000) / 3400) < 1e-9);
});

test("Smuggler Crest T4: 90 Favor, sold direct, silverPerFavor = net/90", () => {
  const rows = buildFavorSpendingRows(mkMarket({ T4_CAPEITEM_SMUGGLER_BP: { Martlock: 8000 } }));
  const r = rows.find((x) => x.itemId === "T4_CAPEITEM_SMUGGLER_BP");
  assert.ok(r, "Smuggler crest row present");
  assert.strictEqual(r.category, "Smuggler Crest");
  assert.strictEqual(r.favorCost, 90);
  assert.strictEqual(r.sellCity, "Martlock");
  assert.strictEqual(r.netSilver, net(8000));
  assert.ok(Math.abs(r.silverPerFavor - net(8000) / 90) < 1e-9);
});

test("Demon Crest T8: 1,500 Favor (Antiquarian schedule), silverPerFavor = net/1500", () => {
  const rows = buildFavorSpendingRows(mkMarket({ T8_CAPEITEM_DEMON_BP: { Caerleon: 90000 } }));
  const r = rows.find((x) => x.itemId === "T8_CAPEITEM_DEMON_BP");
  assert.ok(r, "Demon crest row present");
  assert.strictEqual(r.category, "Demon Crest");
  assert.strictEqual(r.favorCost, 1500);
  assert.strictEqual(r.tradeable, true);
  assert.strictEqual(r.netSilver, net(90000));
  assert.ok(Math.abs(r.silverPerFavor - net(90000) / 1500) < 1e-9);
});

test("Demon Crest T4: 300 Favor, sold direct, silverPerFavor = net/300", () => {
  const rows = buildFavorSpendingRows(mkMarket({ T4_CAPEITEM_DEMON_BP: { Bridgewatch: 12000 } }));
  const r = rows.find((x) => x.itemId === "T4_CAPEITEM_DEMON_BP");
  assert.strictEqual(r.favorCost, 300);
  assert.strictEqual(r.sellCity, "Bridgewatch");
  assert.ok(Math.abs(r.silverPerFavor - net(12000) / 300) < 1e-9);
});

test("Brecilien Crest T8: 3,400 Favor (Eralia Wayfarer), silverPerFavor = net/3400", () => {
  const rows = buildFavorSpendingRows(mkMarket({ T8_CAPEITEM_FW_BRECILIEN_BP: { Caerleon: 120000 } }));
  const r = rows.find((x) => x.itemId === "T8_CAPEITEM_FW_BRECILIEN_BP");
  assert.ok(r, "Brecilien crest row present");
  assert.strictEqual(r.category, "Brecilien Crest");
  assert.strictEqual(r.favorCost, 3400);
  assert.strictEqual(r.tradeable, true);
  assert.strictEqual(r.netSilver, net(120000));
  assert.ok(Math.abs(r.silverPerFavor - net(120000) / 3400) < 1e-9);
});

test("Brecilien Crest T4: 90 Favor, sold direct, silverPerFavor = net/90", () => {
  const rows = buildFavorSpendingRows(mkMarket({ T4_CAPEITEM_FW_BRECILIEN_BP: { Martlock: 8000 } }));
  const r = rows.find((x) => x.itemId === "T4_CAPEITEM_FW_BRECILIEN_BP");
  assert.strictEqual(r.favorCost, 90);
  assert.strictEqual(r.sellCity, "Martlock");
  assert.ok(Math.abs(r.silverPerFavor - net(8000) / 90) < 1e-9);
});

test("Faerie Fire: 675 Favor (QUESTITEM_TOKEN_MISTS), sold raw, silverPerFavor = net/675", () => {
  const rows = buildFavorSpendingRows(mkMarket({ QUESTITEM_TOKEN_MISTS: { Caerleon: 3000 } }));
  const r = rows.find((x) => x.itemId === "QUESTITEM_TOKEN_MISTS");
  assert.ok(r, "Faerie Fire row present");
  assert.strictEqual(r.category, "Faerie Fire");
  assert.strictEqual(r.favorCost, 675);
  assert.strictEqual(r.tradeable, true);
  assert.strictEqual(r.netSilver, net(3000));
  assert.ok(Math.abs(r.silverPerFavor - net(3000) / 675) < 1e-9);
});

test("Mystic Owlet: 675 Favor, sold-raw silverPerFavor = net/675, breed fields present", () => {
  const rows = buildFavorSpendingRows(mkMarket({ T5_FARM_OWL_FW_BRECILIEN_BABY: { Caerleon: 40000 } }));
  const r = rows.find((x) => x.itemId === "T5_FARM_OWL_FW_BRECILIEN_BABY");
  assert.ok(r, "Mystic Owlet row present");
  assert.strictEqual(r.category, "Mystic Owl Baby");
  assert.strictEqual(r.favorCost, 675);
  assert.strictEqual(r.tradeable, true);
  assert.strictEqual(r.netSilver, net(40000));
  assert.ok(Math.abs(r.silverPerFavor - net(40000) / 675) < 1e-9);
  // Breed comparison fields exist (breedData null here — no mounts table in harness).
  assert.ok("breedSilverPerFavor" in r);
  assert.strictEqual(r.breedSilverPerFavor, 0);
});

test("Elite Mystic Owlet: 11,250 Favor, sold raw, silverPerFavor = net/11250", () => {
  const rows = buildFavorSpendingRows(mkMarket({ T8_FARM_OWL_FW_BRECILIEN_BABY: { Caerleon: 1500000 } }));
  const r = rows.find((x) => x.itemId === "T8_FARM_OWL_FW_BRECILIEN_BABY");
  assert.ok(r, "Elite Mystic Owlet row present");
  assert.strictEqual(r.favorCost, 11250);
  assert.ok(Math.abs(r.silverPerFavor - net(1500000) / 11250) < 1e-9);
});

test("Hellspinner Baby: 675 Favor, sold raw, silverPerFavor = net/675", () => {
  const rows = buildFavorSpendingRows(mkMarket({ T5_FARM_SPIDER_HELL_BABY: { Caerleon: 50000 } }));
  const r = rows.find((x) => x.itemId === "T5_FARM_SPIDER_HELL_BABY");
  assert.ok(r, "Hellspinner baby row present");
  assert.strictEqual(r.category, "Antiquarian Baby");
  assert.strictEqual(r.favorCost, 675);
  assert.strictEqual(r.tradeable, true);
  assert.strictEqual(r.netSilver, net(50000));
  assert.ok(Math.abs(r.silverPerFavor - net(50000) / 675) < 1e-9);
  // Breed comparison fields exist (breedData null here — no mounts table in harness).
  assert.ok("breedSilverPerFavor" in r);
  assert.strictEqual(r.breedSilverPerFavor, 0);
});

test("Soulspinner Baby: 11,250 Favor, sold raw, silverPerFavor = net/11250", () => {
  const rows = buildFavorSpendingRows(mkMarket({ T8_FARM_SPIDER_HELL_BABY: { Caerleon: 2000000 } }));
  const r = rows.find((x) => x.itemId === "T8_FARM_SPIDER_HELL_BABY");
  assert.ok(r, "Soulspinner baby row present");
  assert.strictEqual(r.favorCost, 11250);
  assert.ok(Math.abs(r.silverPerFavor - net(2000000) / 11250) < 1e-9);
});

test("baby with no market data → gross 0, silverPerFavor 0, empty sellCity", () => {
  const rows = buildFavorSpendingRows(mkMarket({}));
  const r = rows.find((x) => x.itemId === "T8_FARM_SPIDER_HELL_BABY");
  assert.strictEqual(r.sellPrice, 0);
  assert.strictEqual(r.silverPerFavor, 0);
  assert.strictEqual(r.sellCity, "");
});

test("crest with no market data → gross 0, silverPerFavor 0, empty sellCity", () => {
  const rows = buildFavorSpendingRows(mkMarket({}));
  const r = rows.find((x) => x.itemId === "T6_CAPEITEM_AVALON_BP");
  assert.strictEqual(r.sellPrice, 0);
  assert.strictEqual(r.silverPerFavor, 0);
  assert.strictEqual(r.sellCity, "");
});

test("Siphoned Energy: 150 Favor for 1, sold raw → silverPerFavor = net/150", () => {
  const rows = buildFavorSpendingRows(mkMarket({ UNIQUE_GVGTOKEN_GENERIC: { Caerleon: 6000 } }));
  const r = rows.find((x) => x.itemId === "UNIQUE_GVGTOKEN_GENERIC");
  assert.ok(r, "Siphoned Energy row present");
  assert.strictEqual(r.favorCost, 150);
  assert.strictEqual(r.tradeable, true);
  assert.strictEqual(r.netSilver, net(6000));
  assert.ok(Math.abs(r.silverPerFavor - net(6000) / 150) < 1e-9);
});

test("each Favor row is tagged with its vendor group (favorFaction)", () => {
  const rows = buildFavorSpendingRows(mkMarket({}));
  const facOf = (id) => rows.find((r) => r.itemId === id)?.favorFaction;
  // Energy Manipulator (Mattina) — default group.
  assert.strictEqual(facOf("UNIQUE_GVGTOKEN_GENERIC"), "Energy Manipulator");
  assert.strictEqual(facOf("T4_RUNE"), "Energy Manipulator");
  assert.strictEqual(facOf("T8_SHARD_AVALONIAN"), "Energy Manipulator");
  assert.strictEqual(facOf("T8_CAPEITEM_AVALON_BP"), "Energy Manipulator");
  assert.strictEqual(facOf("T8_SKILLBOOK_NONTRADABLE"), "Energy Manipulator");
  assert.strictEqual(facOf("T6_MOUNT_SIEGE_BALLISTA"), "Energy Manipulator");
  // Smuggler's Den (Shadow Hand / Maggy Slade).
  assert.strictEqual(facOf("T8_CAPEITEM_SMUGGLER_BP"), "Smuggler's Den");
  // The Antiquarian.
  assert.strictEqual(facOf("T8_CAPEITEM_DEMON_BP"), "The Antiquarian");
  assert.strictEqual(facOf("T5_FARM_SPIDER_HELL_BABY"), "The Antiquarian");
  // Brecilien (Eralia Wayfarer).
  assert.strictEqual(facOf("T8_CAPEITEM_FW_BRECILIEN_BP"), "Brecilien");
  assert.strictEqual(facOf("T5_FARM_OWL_FW_BRECILIEN_BABY"), "Brecilien");
  assert.strictEqual(facOf("QUESTITEM_TOKEN_MISTS"), "Brecilien");
  // Conqueror's Chest is the Energy Manipulator's.
  assert.strictEqual(rows.find((r) => r.category === "Conqueror Chest").favorFaction, "Energy Manipulator");
});

test("every Favor row has currency Favor, fpCost 0, silverPerFp 0, positive favorCost", () => {
  const rows = buildFavorSpendingRows(mkMarket({}));
  rows.forEach((r) => {
    assert.strictEqual(r.currency, "Favor", `${r.itemId} currency`);
    assert.strictEqual(r.fpCost, 0, `${r.itemId} fpCost`);
    assert.strictEqual(r.silverPerFp, 0, `${r.itemId} silverPerFp`);
    assert.ok(r.favorCost > 0, `${r.itemId} favorCost`);
  });
});

test("Adept's Rune (T4) sold at 300 → favorCost 150, silverPerFavor = net/150", () => {
  const rows = buildFavorSpendingRows(mkMarket({ T4_RUNE: { Caerleon: 300 } }));
  const r = rows.find((x) => x.itemId === "T4_RUNE");
  assert.strictEqual(r.favorCost, 150);
  assert.strictEqual(r.sellCity, "Caerleon");
  assert.strictEqual(r.netSilver, net(300));
  assert.ok(Math.abs(r.silverPerFavor - net(300) / 150) < 1e-9);
});

test("Elder's Relic (T8) sold at 200,000 → favorCost 8100", () => {
  const rows = buildFavorSpendingRows(mkMarket({ T8_RELIC: { Caerleon: 200000 } }));
  const r = rows.find((x) => x.itemId === "T8_RELIC");
  assert.strictEqual(r.favorCost, 8100);
  assert.ok(Math.abs(r.silverPerFavor - net(200000) / 8100) < 1e-9);
});

test("Elder's Avalonian Shard: flat 3,400 Favor, silverPerFavor = net/3400", () => {
  const rows = buildFavorSpendingRows(mkMarket({ T8_SHARD_AVALONIAN: { Caerleon: 150000 } }));
  const r = rows.find((x) => x.itemId === "T8_SHARD_AVALONIAN");
  assert.ok(r, "Avalonian shard row present");
  assert.strictEqual(r.category, "Avalonian Shard");
  assert.strictEqual(r.favorCost, 3400);
  assert.strictEqual(r.tradeable, true);
  assert.strictEqual(r.netSilver, net(150000));
  assert.ok(Math.abs(r.silverPerFavor - net(150000) / 3400) < 1e-9);
});

test("Adept's Avalonian Shard: 90 Favor", () => {
  const rows = buildFavorSpendingRows(mkMarket({ T4_SHARD_AVALONIAN: { Caerleon: 5000 } }));
  const r = rows.find((x) => x.itemId === "T4_SHARD_AVALONIAN");
  assert.strictEqual(r.favorCost, 90);
});

test("token with no market data → gross 0, silverPerFavor 0, empty sellCity", () => {
  const rows = buildFavorSpendingRows(mkMarket({}));
  const r = rows.find((x) => x.itemId === "T6_SOUL");
  assert.strictEqual(r.sellPrice, 0);
  assert.strictEqual(r.silverPerFavor, 0);
  assert.strictEqual(r.sellCity, "");
});

test("Siege Ballista profit nets base mount + mats off the mount sale", () => {
  const rows = buildFavorSpendingRows(mkMarket({
    T6_MOUNT_SIEGE_BALLISTA: { Caerleon: 2000000 },
    T6_MOUNT_OX: { Martlock: 200000 },
    T6_METALBAR: { Bridgewatch: 1000 },
    T6_LEATHER: { Thetford: 800 },
    T6_PLANKS: { Lymhurst: 600 },
  }));
  const r = rows.find((x) => x.itemId === "T6_MOUNT_SIEGE_BALLISTA");
  const inputCost = 200000 + 1000 * 20 + 800 * 20 + 600 * 20; // 248,000
  const profit = net(2000000) - inputCost;
  assert.strictEqual(r.favorCost, 375000);
  assert.strictEqual(r.netSilver, profit);
  assert.ok(Math.abs(r.silverPerFavor - profit / 375000) < 1e-9);
});

test("Instant: an illiquid base mount is priced at its ask and still netted off", () => {
  // Elder's Command Mammoth: base mount only has sell listings (buy_price 0).
  // Under Instant you fill those listings, so the 220M base + leather must
  // still be netted off the mount sale.
  __setMode("instant");
  const md = {
    "T8_MOUNT_MAMMOTH_BATTLE@1": { Caerleon: { sell_price: 310000000, buy_price: 300000000, volume_24h: 5 } },
    "T8_MOUNT_MAMMOTH_TRANSPORT": { Martlock: { sell_price: 220000000, buy_price: 0, volume_24h: 1 } },
    "T8_LEATHER": { Thetford: { sell_price: 5000, buy_price: 0, volume_24h: 100 } },
  };
  const rows = buildFavorSpendingRows(md);
  const r = rows.find((x) => x.itemId === "T8_MOUNT_MAMMOTH_BATTLE@1");
  const inputCost = 220000000 + 5000 * 20; // 220,100,000
  const profit = net(300000000) - inputCost;
  assert.strictEqual(r.netSilver, profit, `expected ${profit}, got ${r.netSilver}`);
  assert.ok(r.netSilver < net(300000000), "base mount + mats must be subtracted");
  __setMode("market");
});

test("mount with no sale price → silverPerFavor 0 (no negative from inputs alone)", () => {
  const rows = buildFavorSpendingRows(mkMarket({ T6_MOUNT_OX: { Martlock: 200000 } }));
  const r = rows.find((x) => x.itemId === "T6_MOUNT_SIEGE_BALLISTA");
  assert.strictEqual(r.sellPrice, 0);
  assert.strictEqual(r.silverPerFavor, 0);
});

test("mount row carries a mountInputs breakdown (base mount + each mat, priced)", () => {
  setOverrides({});
  const rows = buildFavorSpendingRows(mkMarket({
    T6_MOUNT_SIEGE_BALLISTA: { Caerleon: 2000000 },
    T6_MOUNT_OX: { Martlock: 200000 },
    T6_METALBAR: { Bridgewatch: 1000 },
    T6_LEATHER: { Thetford: 800 },
    T6_PLANKS: { Lymhurst: 600 },
  }));
  const r = rows.find((x) => x.itemId === "T6_MOUNT_SIEGE_BALLISTA");
  assert.ok(r.mountInputs, "mountInputs present");
  assert.strictEqual(r.mountInputs.baseMount.id, "T6_MOUNT_OX");
  assert.strictEqual(r.mountInputs.baseMount.price, 200000);
  assert.strictEqual(r.mountInputs.baseMount.city, "Martlock");
  assert.strictEqual(r.mountInputs.mats.length, 3);
  const metal = r.mountInputs.mats.find((x) => x.id === "T6_METALBAR");
  assert.strictEqual(metal.count, 20);
  assert.strictEqual(metal.subtotal, 20000); // 1000 × 20
  assert.strictEqual(r.mountInputs.inputCost, 200000 + 20000 + 16000 + 12000);
  assert.strictEqual(r.mountInputs.inputsKnown, true);
});

test("missing input price → inputsKnown false, silverPerFavor suppressed, net is upper bound", () => {
  setOverrides({});
  // Base mount + 2 of 3 mats priced; T6_PLANKS missing → input incomplete.
  const rows = buildFavorSpendingRows(mkMarket({
    T6_MOUNT_SIEGE_BALLISTA: { Caerleon: 2000000 },
    T6_MOUNT_OX: { Martlock: 200000 },
    T6_METALBAR: { Bridgewatch: 1000 },
    T6_LEATHER: { Thetford: 800 },
  }));
  const r = rows.find((x) => x.itemId === "T6_MOUNT_SIEGE_BALLISTA");
  assert.strictEqual(r.mountInputs.inputsKnown, false);
  // silver/Favor must NOT be presented as a real efficiency when inputs missing.
  assert.strictEqual(r.silverPerFavor, 0);
  // netSilver still nets the KNOWN inputs (planks counted as 0 → upper bound).
  const knownInputs = 200000 + 1000 * 20 + 800 * 20; // 236,000
  assert.strictEqual(r.netSilver, net(2000000) - knownInputs);
  assert.ok(/missing/i.test(r.note), "note flags the missing input");
});

test("override on an illiquid base mount with NO market data is still deducted", () => {
  // T6_MOUNT_OX absent from marketData entirely (zero live orders), but the
  // user has hand-set its price via override — its cost must still be netted.
  setOverrides({ "T6_MOUNT_OX|Martlock": 200000 });
  const rows = buildFavorSpendingRows(mkMarket({
    T6_MOUNT_SIEGE_BALLISTA: { Caerleon: 2000000 },
    T6_METALBAR: { Bridgewatch: 1000 },
    T6_LEATHER: { Thetford: 800 },
    T6_PLANKS: { Lymhurst: 600 },
  }));
  const r = rows.find((x) => x.itemId === "T6_MOUNT_SIEGE_BALLISTA");
  assert.strictEqual(r.mountInputs.baseMount.price, 200000);
  assert.strictEqual(r.mountInputs.inputsKnown, true);
  const inputCost = 200000 + 1000 * 20 + 800 * 20 + 600 * 20; // 248,000
  assert.strictEqual(r.netSilver, net(2000000) - inputCost);
  setOverrides({});
});

// ── The input cost follows the Pricing Model ───────────────────────────────
// Base mounts are thinly traded: a listing with no buy order behind it prices
// under Instant (you fill the listing) but not under Market Orders (there is no
// bid to place your buy order against). A dropped input must suppress
// silver/Favor, never inflate the net — the row then reads "—" and the price
// can be hand-set. See tests/black-market-order-type.test.cjs for the rule.

test("Instant prices a listings-only base mount, Market Orders drops it", () => {
  setOverrides({});
  const spec = {
    T6_MOUNT_SIEGE_BALLISTA: { Caerleon: [1900000, 2000000] },
    T6_MOUNT_OX: { Martlock: [0, 200000] },   // listed, nobody bidding
    T6_METALBAR: { Bridgewatch: [900, 1000] },
    T6_LEATHER: { Thetford: [700, 800] },
    T6_PLANKS: { Lymhurst: [500, 600] },
  };

  __setMode("instant");
  const instant = buildFavorSpendingRows(mkMarket(spec))
    .find((x) => x.itemId === "T6_MOUNT_SIEGE_BALLISTA");
  assert.strictEqual(instant.mountInputs.baseMount.price, 200000, "instant fills the listing");
  assert.strictEqual(instant.mountInputs.inputsKnown, true);

  __setMode("market");
  const market = buildFavorSpendingRows(mkMarket(spec))
    .find((x) => x.itemId === "T6_MOUNT_SIEGE_BALLISTA");
  assert.strictEqual(market.mountInputs.baseMount.price, 0, "no bid to buy against");
  assert.strictEqual(market.mountInputs.inputsKnown, false);
  assert.strictEqual(market.silverPerFavor, 0, "suppressed rather than inflated");
  assert.ok(/missing/i.test(market.note), "note flags the missing input");
});

test("under Market Orders a hand-set override still prices the input", () => {
  setOverrides({ "T6_MOUNT_OX|Martlock": 180000 });
  __setMode("market");
  const r = buildFavorSpendingRows(mkMarket({
    T6_MOUNT_SIEGE_BALLISTA: { Caerleon: [1900000, 2000000] },
    T6_MOUNT_OX: { Martlock: [0, 200000] },
    T6_METALBAR: { Bridgewatch: [900, 1000] },
    T6_LEATHER: { Thetford: [700, 800] },
    T6_PLANKS: { Lymhurst: [500, 600] },
  })).find((x) => x.itemId === "T6_MOUNT_SIEGE_BALLISTA");
  assert.strictEqual(r.mountInputs.baseMount.price, 180000);
  assert.strictEqual(r.mountInputs.inputsKnown, true);
  setOverrides({});
});

test("Conqueror's Chest: default yield 0 → favorCost 6750, silverPerFavor 0, not tradeable", () => {
  setOverrides({});
  const rows = buildFavorSpendingRows(mkMarket({}));
  const r = rows.find((x) => x.category === "Conqueror Chest");
  assert.strictEqual(r.favorCost, 6750);
  assert.strictEqual(r.tradeable, false);
  assert.strictEqual(r.silverPerFavor, 0);
});

test("Conqueror's Chest: yield override sets silver/Favor", () => {
  setOverrides({ "UNIQUE_LOOTCHEST_CONQUEROR_FAVOR_PURCHASE|Caerleon": 1000000 });
  const rows = buildFavorSpendingRows(mkMarket({}));
  const r = rows.find((x) => x.category === "Conqueror Chest");
  assert.strictEqual(r.netSilver, 1000000);
  assert.ok(Math.abs(r.silverPerFavor - 1000000 / 6750) < 1e-9);
  setOverrides({});
});

test("Conqueror's Chest: yield override set in a NON-Caerleon city is also read", () => {
  // The Energy Manipulator stands in every city, so the user must be able to
  // set the yield wherever they play — not only at Caerleon.
  setOverrides({ "UNIQUE_LOOTCHEST_CONQUEROR_FAVOR_PURCHASE|Martlock": 810000 });
  const rows = buildFavorSpendingRows(mkMarket({}));
  const r = rows.find((x) => x.category === "Conqueror Chest");
  assert.strictEqual(r.netSilver, 810000);
  assert.ok(Math.abs(r.silverPerFavor - 810000 / 6750) < 1e-9);
  setOverrides({});
});

// ── Energy Mount all-in economics (the board's pure-profit metric) ──────────
// The exchange's Favor is backed by m.energy Siphoned Energy turned in at the
// Energy Manipulator. The Faction table's own netSilver/silverPerFavor stay
// Favor-denominated (energy NOT deducted — the row ranks against the sold-raw
// Siphoned Energy baseline in the same table), but the Top-10 board's "pure
// profit" must cost that energy at its cheapest market price, so the all-in
// figures ride along additively: mountInputs.energy / mountInputs.energyKnown /
// mountInputs.pureInputCost / row.pureProfitSilver. Suppressed (0) whenever any
// input incl. energy is unpriced — an unpriced input is not a free input.

const BALLISTA_MARKET = {
  T6_MOUNT_SIEGE_BALLISTA: { Caerleon: 2000000 },
  T6_MOUNT_OX: { Martlock: 200000 },
  T6_METALBAR: { Bridgewatch: 1000 },
  T6_LEATHER: { Thetford: 800 },
  T6_PLANKS: { Lymhurst: 600 },
  UNIQUE_GVGTOKEN_GENERIC: { Caerleon: 6000, Thetford: 5000 },
};

test("mountInputs.energy: cheapest energy city, count × price subtotal", () => {
  setOverrides({});
  const r = buildFavorSpendingRows(mkMarket(BALLISTA_MARKET))
    .find((x) => x.itemId === "T6_MOUNT_SIEGE_BALLISTA");
  assert.ok(r.mountInputs.energy, "energy input present");
  assert.strictEqual(r.mountInputs.energy.id, "UNIQUE_GVGTOKEN_GENERIC");
  assert.strictEqual(r.mountInputs.energy.count, 2500);
  assert.strictEqual(r.mountInputs.energy.price, 5000, "cheapest city wins");
  assert.strictEqual(r.mountInputs.energy.city, "Thetford");
  assert.strictEqual(r.mountInputs.energy.subtotal, 5000 * 2500);
  assert.strictEqual(r.mountInputs.energyKnown, true);
});

test("pureInputCost = base + mats + energy; pureProfitSilver = mountNet − it", () => {
  setOverrides({});
  const r = buildFavorSpendingRows(mkMarket(BALLISTA_MARKET))
    .find((x) => x.itemId === "T6_MOUNT_SIEGE_BALLISTA");
  const matsAndBase = 200000 + 1000 * 20 + 800 * 20 + 600 * 20; // 248,000
  assert.strictEqual(r.mountInputs.pureInputCost, matsAndBase + 12500000);
  assert.strictEqual(r.pureProfitSilver, net(2000000) - (matsAndBase + 12500000));
});

test("netSilver/silverPerFavor keep Favor semantics — energy NOT deducted", () => {
  setOverrides({});
  const r = buildFavorSpendingRows(mkMarket(BALLISTA_MARKET))
    .find((x) => x.itemId === "T6_MOUNT_SIEGE_BALLISTA");
  const inputCost = 200000 + 1000 * 20 + 800 * 20 + 600 * 20;
  assert.strictEqual(r.netSilver, net(2000000) - inputCost);
  assert.ok(Math.abs(r.silverPerFavor - (net(2000000) - inputCost) / 375000) < 1e-9);
});

test("energy unpriced → energyKnown false, pureProfitSilver suppressed to 0", () => {
  setOverrides({});
  const rows = buildFavorSpendingRows(mkMarket({
    T6_MOUNT_SIEGE_BALLISTA: { Caerleon: 2000000 },
    T6_MOUNT_OX: { Martlock: 200000 },
    T6_METALBAR: { Bridgewatch: 1000 },
    T6_LEATHER: { Thetford: 800 },
    T6_PLANKS: { Lymhurst: 600 },
  }));
  const r = rows.find((x) => x.itemId === "T6_MOUNT_SIEGE_BALLISTA");
  assert.strictEqual(r.mountInputs.energyKnown, false);
  assert.strictEqual(r.mountInputs.energy.price, 0);
  assert.strictEqual(r.pureProfitSilver, 0, "unpriced energy must not rank as free");
  assert.strictEqual(r.mountInputs.inputsKnown, true, "base + mats are still known");
});

test("unpriced base mount suppresses pureProfitSilver even with energy priced", () => {
  setOverrides({});
  const rows = buildFavorSpendingRows(mkMarket({
    T6_MOUNT_SIEGE_BALLISTA: { Caerleon: 2000000 },
    T6_METALBAR: { Bridgewatch: 1000 },
    T6_LEATHER: { Thetford: 800 },
    T6_PLANKS: { Lymhurst: 600 },
    UNIQUE_GVGTOKEN_GENERIC: { Thetford: 5000 },
  }));
  const r = rows.find((x) => x.itemId === "T6_MOUNT_SIEGE_BALLISTA");
  assert.strictEqual(r.mountInputs.inputsKnown, false);
  assert.strictEqual(r.mountInputs.energyKnown, true);
  assert.strictEqual(r.pureProfitSilver, 0);
});

test("an energy price override is honored like every other input", () => {
  setOverrides({ "UNIQUE_GVGTOKEN_GENERIC|Caerleon": 4000 });
  const r = buildFavorSpendingRows(mkMarket({
    ...BALLISTA_MARKET, UNIQUE_GVGTOKEN_GENERIC: { Caerleon: 6000 },
  })).find((x) => x.itemId === "T6_MOUNT_SIEGE_BALLISTA");
  assert.strictEqual(r.mountInputs.energy.price, 4000);
  assert.strictEqual(r.mountInputs.pureInputCost, 248000 + 4000 * 2500);
  setOverrides({});
});

test("every MOUNT_EXCHANGE carries energy, pureInputCost and pureProfitSilver", () => {
  setOverrides({});
  const md = mkMarket({
    T6_MOUNT_SIEGE_BALLISTA: { Caerleon: 2000000 },
    T6_MOUNT_OX: { Martlock: 200000 },
    T6_METALBAR: { Bridgewatch: 1000 },
    T6_LEATHER: { Thetford: 800 },
    T6_PLANKS: { Lymhurst: 600 },
    T7_MOUNT_SWAMPDRAGON_BATTLE: { Caerleon: 43000000 },
    T7_MOUNT_ARMORED_SWAMPDRAGON_BATTLE: { Thetford: 42749999 },
    T7_MOUNT_SWAMPDRAGON: { Martlock: 1500000 },
    T7_CLOTH: { Lymhurst: 2000 },
    T7_METALBAR: { Bridgewatch: 3000 },
    "T8_MOUNT_MAMMOTH_BATTLE@1": { Caerleon: 310000000 },
    T8_MOUNT_MAMMOTH_TRANSPORT: { Martlock: 220000000 },
    T8_LEATHER: { Thetford: 5000 },
    UNIQUE_GVGTOKEN_GENERIC: { Thetford: 5000 },
  });
  // id → { energy, basePlusMats, gross }
  const EXPECT = {
    "T6_MOUNT_SIEGE_BALLISTA": { energy: 2500, basePlusMats: 248000, gross: 2000000 },
    "T7_MOUNT_SWAMPDRAGON_BATTLE": { energy: 5000, basePlusMats: 1540000, gross: 43000000 },
    "T7_MOUNT_ARMORED_SWAMPDRAGON_BATTLE": { energy: 5000, basePlusMats: 1560000, gross: 42749999 },
    "T8_MOUNT_MAMMOTH_BATTLE@1": { energy: 10000, basePlusMats: 220100000, gross: 310000000 },
  };
  const rows = buildFavorSpendingRows(md).filter((r) => r.category === "Energy Mount");
  assert.strictEqual(rows.length, 4);
  rows.forEach((r) => {
    const x = EXPECT[r.itemId];
    assert.ok(x, `unexpected mount row ${r.itemId}`);
    const pure = x.basePlusMats + 5000 * x.energy;
    assert.strictEqual(r.mountInputs.energy.count, x.energy, `${r.itemId} energy count`);
    assert.strictEqual(r.mountInputs.energy.price, 5000, `${r.itemId} energy price`);
    assert.strictEqual(r.mountInputs.pureInputCost, pure, `${r.itemId} pureInputCost`);
    assert.strictEqual(r.pureProfitSilver, net(x.gross) - pure, `${r.itemId} pureProfitSilver`);
    assert.strictEqual(r.netSilver, net(x.gross) - x.basePlusMats, `${r.itemId} netSilver keeps Favor view`);
    assert.strictEqual(r.mountInputs.energyKnown, true);
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
