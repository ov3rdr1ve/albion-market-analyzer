/**
 * Test: the Enchanting, Transmute and Rerolling tables' Pure Profit twins —
 * plan.md step 1 (TDD red).
 *
 * Per-table rules (plan.md):
 *   Enchanting — runes/souls/relics are farmable drops → their cost AND its
 *     setup fee are zeroed; the bought base item, ITS setup fee and the sell
 *     tax stay:
 *       twin = sellPrice × (1 − PREMIUM_TAX) − sourcePrice × (1 + SETUP_FEE)
 *   Transmute — the input resource is gatherable → zeroed; the flat transmute
 *     silver, the station fee and the sell tax stay:
 *       twin = sellPrice × (1 − PREMIUM_TAX) − (silverCost + stationFee)
 *   Rerolling — the reroll walk is PURE SILVER (getExpectedRerollCost bills
 *     item value, js/data-rerolling.js), never a market mat: nothing in the
 *     row is gatherable. The twin therefore exists and COINCIDES with the
 *     primary profit (kept: item cost, its setup fee, the reroll silver, the
 *     sell tax). The contract pins the field's presence and that identity, so
 *     a downstream consumer (the craft list) always finds a twin here.
 *
 * Black-box: three harnesses, one per renderer, mirroring
 * tests/suspect-margin-flag.test.cjs — synthetic market data → the real
 * renderers, rows captured from a renderTableData stub. No DOM writes, no
 * live API.
 *
 * Tax getter control (repo convention): the enchanting/rerolling harnesses
 * load the real js/utils.js + js/calculations.js, so PREMIUM_TAX/SETUP_FEE are
 * the live getters resolving the #premium-account checkbox stub; the order
 * radios are absent, which means "market" (SETUP_FEE 0.025). The transmute
 * harness stands the same getters up with explicit isPremiumEnabled stubs.
 *
 * RED BY DESIGN: no renderer writes selfFoundProfit yet — the twin assertions
 * fail on the missing field. Primary-profit assertions are regressions and
 * pass before AND after.
 *
 * Run: node --test tests/enchant-transmute-reroll-self-found.test.cjs
 */

const assert = require("assert");
const { test } = require("node:test");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const J = (f) => fs.readFileSync(path.join(ROOT, "js", f), "utf8").replace(/\r\n/g, "\n");

// Cell text runs through tx(english, slug); en-mode identity keeps assertions
// in English.
globalThis.tx = globalThis.tx || ((en) => en);

const near = (a, b) => Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-9);

// The twin lands on marginInfo.selfFoundProfit; accept a row field (plan.md
// allows either shape).
const sfOf = (row) => {
  if (row.marginInfo && row.marginInfo.selfFoundProfit !== undefined) {
    return row.marginInfo.selfFoundProfit;
  }
  return row.selfFoundProfit;
};

// ── Shared browser shims (utils.js's getters resolve #premium-account) ───────
const domStubs = `
const _els = {
  "premium-account": { checked: true },
  "use-focus": { checked: false },
  "station-fee": { value: "0" },
};
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const window = { addEventListener: () => {} };
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
`;

// ═══ 1. Enchanting ═══════════════════════════════════════════════════════════
{
  const stubs = domStubs + `
const CRAFTING_ITEMS = [
  { id: "T6_2H_BOW_KEEPER", name: "Bow of Badon [T6]", isGearRecipe: true,
    materials: [{ matId: "T6_PLANKS", count: 20 }, { matId: "T6_ARTEFACT_2H_BOW_KEEPER", count: 1 }] },
];
let recipeCache = {};
let lastMarketData = null;
const ITEM_NAMES_MAP = {};
function dispName(id, name){ return name || id; }
function matPriceSpan(id, city, price){ return "<span data-item-id='"+id+"'>@ "+price+"</span>"; }
function suspectMarginBadge(){ return ""; }
function aggregateCostTd(c, cls) { return '<td class="' + (cls || "silver-val cell-num") + '">' + (Number(c) > 0 ? c : "—") + '</td>'; }
function priceTd(p){ return "<td>"+p+"</td>"; }
function profitTd(mi){ return "<td>"+(mi&&mi.profit)+"</td>"; }
function pureProfitTd(mi){ return "<td>"+(mi&&mi.profit)+"</td>"; }
function addTdForKey(){ return '<td class="cell-add"></td>'; }
function getRowKey(row){ return (row.item&&row.item.id) + "|" + row.transitionLabel; }
const captured = { rows: [], html: [] };
function renderTableData(id, rows, fmt){
  captured.rows = rows;
  captured.html = rows.map((r,i) => { try { return fmt(r,i); } catch(e){ return "ERR:"+e.message; } });
}
`;
  const mod = new Module("enchant-self-found-test");
  mod._compile(
    stubs + J("data-city-bonuses.js") + (J("calculations.js") + J("calculations-margins.js")) + J("travel-cost.js") + (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) +
      J("data-enchanting.js") + J("render-enchanting.js") +
      // Declared last so it wins over utils.js's version, which walks every
      // item catalog this harness doesn't load.
      "\nfunction getItemDisplayName(id){ return id; }" +
      "\nfunction fees(){ return { premiumTax: PREMIUM_TAX, setupFee: SETUP_FEE }; }" +
      "\nmodule.exports = { renderEnchantingTable, captured, fees, _els };",
    "enchant-self-found.js",
  );
  const X = mod.exports;

  // .0 bow bought at 100,000; runes deliberately expensive at 40,000 each (the
  // zeroing must ignore them); .1 bow sells at 300,000 in Martlock.
  const enchantedMarket = () => ({
    T6_2H_BOW_KEEPER: { Lymhurst: { sell_price: 100000, buy_price: 100000, volume_24h: 99 } },
    T6_RUNE: { Lymhurst: { sell_price: 40000, buy_price: 40000, volume_24h: 99 } },
    "T6_2H_BOW_KEEPER@1": { Martlock: { sell_price: 300000, buy_price: 300000, volume_24h: 99 } },
  });

  X.renderEnchantingTable(enchantedMarket());
  const row01 = X.captured.rows.find((r) => r.item && r.transitionLabel === ".0 → .1");

  test("enchanting: fixture sanity — the .0 → .1 row prices with a real rune leg", () => {
    assert.ok(row01, ".0 → .1 row should exist");
    assert.ok(row01.matCount > 0 && row01.matPrice > 0, "the rune leg must cost something");
    assert.ok(row01.totalMatCost > 0, "the zeroed leg must be non-trivial in this fixture");
    assert.ok(row01.sourcePrice === 100000, "the base item is bought at 100,000");
    assert.ok(row01.sellPrice === 300000, "the .1 bow sells at 300,000");
  });

  test("enchanting: twin zeroes the runes, keeps the base item, its setup fee and the tax", () => {
    assert.strictEqual(typeof sfOf(row01), "number",
      "marginInfo.selfFoundProfit missing on the enchanting row (feature not implemented)");
    // 300,000 x 0.935 - 100,000 x 1.025 = 280,500 - 102,500 = 178,000 —
    // independent of the (expensive) rune leg by construction.
    const want = 300000 * (1 - X.fees().premiumTax) - 100000 * (1 + X.fees().setupFee);
    assert.ok(near(sfOf(row01), want), `twin ${sfOf(row01)} != ${want}`);
    assert.ok(row01.marginInfo.profit < sfOf(row01),
      "the bought profit must sit below the self-found twin with expensive runes");
  });

  test("enchanting: regression, the bought profit keeps today's formula", () => {
    const want = 300000 * (1 - X.fees().premiumTax)
      - (row01.sourcePrice * (1 + X.fees().setupFee) + row01.totalMatCost * (1 + X.fees().setupFee));
    assert.ok(near(row01.marginInfo.profit, want),
      `primary profit ${row01.marginInfo.profit} drifted from the hand formula ${want}`);
  });

  test("enchanting: the twin follows the live premium-account getter", () => {
    X._els["premium-account"].checked = false;
    try {
      X.renderEnchantingTable(enchantedMarket());
      const off = X.captured.rows.find((r) => r.item && r.transitionLabel === ".0 → .1");
      // 300,000 x 0.895 - 102,500 = 268,500 - 102,500 = 166,000.
      const want = 300000 * (1 - X.fees().premiumTax) - 100000 * (1 + X.fees().setupFee);
      assert.strictEqual(typeof sfOf(off), "number", "selfFoundProfit missing (premium-off)");
      assert.ok(near(sfOf(off), want), `twin ${sfOf(off)} != ${want}`);
    } finally {
      X._els["premium-account"].checked = true;
    }
  });
}

// ═══ 2. Transmute ════════════════════════════════════════════════════════════
{
  const stubs = domStubs + `
function getOrderType(){ return "market"; }
function isBlackRedZoneEnabled(){ return true; }
function isSuspectMargin(m){ return Number.isFinite(m) && m > 500; }
function suspectMarginBadge(row){ return row && row.suspectMargin ? "<span>⚠</span> " : ""; }
function getIQRBounds(){ return null; }
function calcStationFeeSilver(){ return 0; }
function getBuyPrice(data, city){ return data && data[city] ? (data[city].buy || 0) : 0; }
function getSellPrice(data, city){ return data && data[city] ? (data[city].sell || 0) : 0; }
function getCityForce(){ return null; }
function getOverridePrice(){ return null; }
function getMinVol(){ return 0; }
function getMinVol2(){ return 0; }
function isInvalidCrossRoute(){ return false; }
function formatSilver(n){ return String(n); }
function getItemDisplayName(id){ return id; }
function matPriceSpan(id, city, price){ return "<span data-item-id='"+id+"'>@ "+price+"</span>"; }
function resourceAliasSpan(){ return ""; }
function aggregateCostTd(c, cls) { return '<td class="' + (cls || "silver-val cell-num") + '">' + (Number(c) > 0 ? c : "—") + '</td>'; }
function priceTd(p){ return "<td>"+p+"</td>"; }
function profitTd(mi){ return "<td>"+(mi&&mi.profit)+"</td>"; }
function pureProfitTd(mi){ return "<td>"+(mi&&mi.profit)+"</td>"; }
function addTdForKey(){ return '<td class="cell-add"></td>'; }
function getRowKey(row){ return row.tier + "|" + (row.transition && row.transition.label); }
const captured = { rows: [], html: [] };
function renderTableData(id, rows, fmt){
  captured.rows = rows;
  captured.html = rows.map((r,i) => { try { return fmt(r,i); } catch(e){ return "ERR:"+e.message; } });
}
`;
  const mod = new Module("transmute-self-found-test");
  mod._compile(
    stubs + J("data-city-bonuses.js") + (J("calculations.js") + J("calculations-margins.js")) + J("resource-names.js") +
      J("data-transmute.js") + J("render-transmute.js") +
      "\nfunction fees(){ return { premiumTax: PREMIUM_TAX, setupFee: SETUP_FEE }; }" +
      "\nmodule.exports = { renderTransmuteTable, captured, getTransmuteRecipes, fees, _els };",
    "transmute-self-found.js",
  );
  const X = mod.exports;

  // T4 rock bought at 1,000 in Lymhurst → T5 rock sells at 3,000 in Martlock.
  const rockMarket = () => ({
    T4_ROCK: { Lymhurst: { buy: 1000, volume_24h: 999 } },
    T5_ROCK: { Martlock: { sell: 3000, volume_24h: 999 } },
  });

  X.renderTransmuteTable(rockMarket());
  const t5 = X.captured.rows.find((r) => r.transition && r.targetId === "T5_ROCK" && r.sourceId === "T4_ROCK");

  test("transmute: fixture sanity — the 4 → 5 rock row prices with real silver", () => {
    assert.ok(t5, "T4 → T5 rock row should exist");
    assert.ok(t5.buyPrice === 1000 && t5.sellPrice === 3000, "injected prices reached the row");
    assert.ok(t5.silverCost > 0, "the transmute silver must be a real kept term");
    assert.strictEqual(t5.stationFee, 0, "the fixture charges no station fee");
    assert.strictEqual(t5.sourceCount, 1, "a 1:1 tier-up keeps the hand math simple");
  });

  test("transmute: twin zeroes the input resource, keeps silver + fees + tax", () => {
    assert.strictEqual(typeof sfOf(t5), "number",
      "marginInfo.selfFoundProfit missing on the transmute row (feature not implemented)");
    // 3,000 x 0.935 - silverCost = 2,805 - silverCost. The 1,000 rock and its
    // setup fee are gone.
    const want = 3000 * (1 - X.fees().premiumTax) - (t5.silverCost + t5.stationFee);
    assert.ok(near(sfOf(t5), want), `twin ${sfOf(t5)} != ${want}`);
    assert.ok(t5.marginInfo.profit < sfOf(t5),
      "the bought profit must sit below the self-found twin");
  });

  test("transmute: regression, the bought profit keeps today's formula", () => {
    const want = 3000 * (1 - X.fees().premiumTax)
      - (1000 * (1 + X.fees().setupFee) + t5.silverCost + t5.stationFee);
    assert.ok(near(t5.marginInfo.profit, want),
      `primary profit ${t5.marginInfo.profit} drifted from the hand formula ${want}`);
  });

  test("transmute: the twin follows the live premium-account getter", () => {
    X._els["premium-account"].checked = false;
    try {
      X.renderTransmuteTable(rockMarket());
      const off = X.captured.rows.find((r) => r.transition && r.targetId === "T5_ROCK" && r.sourceId === "T4_ROCK");
      const want = 3000 * (1 - X.fees().premiumTax) - (off.silverCost + off.stationFee);
      assert.strictEqual(typeof sfOf(off), "number", "selfFoundProfit missing (premium-off)");
      assert.ok(near(sfOf(off), want), `twin ${sfOf(off)} != ${want}`);
    } finally {
      X._els["premium-account"].checked = true;
    }
  });
}

// ═══ 3. Rerolling ════════════════════════════════════════════════════════════
{
  const stubs = domStubs + `
// getRerollableItems() filters CRAFTING_ITEMS for T4-T8 gear recipes.
const CRAFTING_ITEMS = [
  { id: "T8_SHOES_PLATE_SET3", name: "Guardian Boots [T8]", isGearRecipe: true, materials: [] },
];
const ITEM_NAMES_MAP = {};
let recipeCache = {};
let lastMarketData = null;
function dispName(id, name){ return name || id; }
function getQualityVolume(){ return 99; }
function matPriceSpan(id, city, price){ return "<span>@ "+price+"</span>"; }
function suspectMarginBadge(){ return ""; }
function aggregateCostTd(c, cls) { return '<td class="' + (cls || "silver-val cell-num") + '">' + (Number(c) > 0 ? c : "—") + '</td>'; }
function priceTd(p){ return "<td>"+p+"</td>"; }
function profitTd(mi){ return "<td>"+(mi&&mi.profit)+"</td>"; }
function pureProfitTd(mi){ return "<td>"+(mi&&mi.profit)+"</td>"; }
function addTdForKey(){ return '<td class="cell-add"></td>'; }
function getRowKey(row){ return (row.item&&row.item.id) + "|" + row.transitionLabel; }
const captured = { rows: [], html: [] };
function renderTableData(id, rows, fmt){
  captured.rows = rows;
  captured.html = rows.map((r,i) => { try { return fmt(r,i); } catch(e){ return "ERR:"+e.message; } });
}
`;
  const mod = new Module("reroll-self-found-test");
  mod._compile(
    stubs + J("data-city-bonuses.js") + (J("calculations.js") + J("calculations-margins.js")) + J("travel-cost.js") + (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) +
      J("data-enchanting.js") + J("data-rerolling.js") + J("render-rerolling.js") +
      "\nfunction fees(){ return { premiumTax: PREMIUM_TAX, setupFee: SETUP_FEE }; }" +
      "\nmodule.exports = { renderRerollingTable, captured, fees, _els };",
    "reroll-self-found.js",
  );
  const X = mod.exports;

  // Normal quality bought at 1,000,000 in Lymhurst; Good sells at 1,500,000 in
  // Martlock. rerollCost is the walk's expected silver (item-value based).
  const rerollMarket = () => ({
    T8_SHOES_PLATE_SET3: {
      1: { Lymhurst: { buy_price: 1000000, sell_price: 1000000, volume_24h: 99 } },
      2: { Martlock: { buy_price: 1500000, sell_price: 1500000, volume_24h: 99 } },
    },
  });

  X.renderRerollingTable(rerollMarket());
  const good = X.captured.rows.find(
    (r) => r.item && r.transition && r.transition.from === 1 && r.transition.to === 2);

  test("rerolling: fixture sanity — the Normal → Good row prices with a real reroll bill", () => {
    assert.ok(good, "Normal → Good row should exist");
    assert.ok(good.buyPrice === 1000000 && good.sellPrice === 1500000, "injected prices reached the row");
    assert.ok(good.rerollCost > 0, "the reroll walk must cost silver in this fixture");
  });

  test("rerolling: the twin exists and coincides with the primary (nothing gatherable)", () => {
    assert.strictEqual(typeof sfOf(good), "number",
      "marginInfo.selfFoundProfit missing on the rerolling row (feature not implemented)");
    // Kept: the bought boots + their setup fee + the reroll silver + the sell
    // tax — exactly the primary formula. The reroll walk bills SILVER
    // (getExpectedRerollCost), never a market mat, so there is nothing to zero.
    assert.ok(near(sfOf(good), good.marginInfo.profit),
      `twin ${sfOf(good)} != primary ${good.marginInfo.profit} — a reroll buys no gatherable input`);
  });

  test("rerolling: regression, the bought profit keeps today's formula", () => {
    const want = good.sellPrice * (1 - X.fees().premiumTax)
      - (good.buyPrice * (1 + X.fees().setupFee) + good.rerollCost);
    assert.ok(near(good.marginInfo.profit, want),
      `primary profit ${good.marginInfo.profit} drifted from the hand formula ${want}`);
  });

  test("rerolling: the twin follows the live premium-account getter", () => {
    X._els["premium-account"].checked = false;
    try {
      X.renderRerollingTable(rerollMarket());
      const off = X.captured.rows.find(
        (r) => r.item && r.transition && r.transition.from === 1 && r.transition.to === 2);
      assert.strictEqual(typeof sfOf(off), "number", "selfFoundProfit missing (premium-off)");
      assert.ok(near(sfOf(off), off.marginInfo.profit),
        "the reroll twin must keep tracking the primary profit");
    } finally {
      X._els["premium-account"].checked = true;
    }
  });
}
