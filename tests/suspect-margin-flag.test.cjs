/**
 * Test: an over-MAX_MARGIN_PERCENT route is FLAGGED, not silently dropped.
 *
 * A margin above MAX_MARGIN_PERCENT (500%) is treated as bad market data — a
 * stale listing, a one-off order. Transmute, Enchanting and Rerolling used to
 * `return` on such rows at BUILD time, so the route was invisible in every
 * mode, "Show All" included, and there was nothing to click to override the bad
 * price. Filtering them out of the default view instead was the same story for
 * anyone not running Show All. So the row is kept with `suspectMargin: true`,
 * rendered with a ⚠ badge, and shown: it is MARKED, never hidden.
 *
 * Covers: the isSuspectMargin/suspectMarginBadge helpers (utils.js), all three
 * renderers, and the display-filter predicate that no longer reads the flag.
 *
 * Black-box: synthetic marketData → the real renderers, rows captured from a
 * renderTableData stub. No DOM, no live API.
 *
 * Run: node tests/suspect-margin-flag.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");
// Cell text runs through tx(english, slug); en-mode identity keeps assertions in English.
globalThis.tx = globalThis.tx || ((en) => en);

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name}\n    ${e.message}`); }
}

console.log("Suspect (>MAX_MARGIN_PERCENT) margins are flagged, not dropped\n");

// ── Shared browser shims ─────────────────────────────────────────────────────
const domStubs = `
const _els = { "sort-instant": { checked: true } };   // order type "buy" -> MIN_VOLUME 0
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const window = { addEventListener: () => {} };
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
`;

// ── 1. utils.js helpers ──────────────────────────────────────────────────────
{
  const mod = new Module("suspect-margin-utils");
  mod._compile(
    domStubs + (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) +
      "\nmodule.exports = { MAX_MARGIN_PERCENT, isSuspectMargin, suspectMarginBadge };",
    "smu.js",
  );
  const { MAX_MARGIN_PERCENT, isSuspectMargin, suspectMarginBadge } = mod.exports;

  test("isSuspectMargin: true strictly above the cap, false at/below it", () => {
    assert.strictEqual(isSuspectMargin(MAX_MARGIN_PERCENT + 0.01), true);
    assert.strictEqual(isSuspectMargin(MAX_MARGIN_PERCENT), false);
    assert.strictEqual(isSuspectMargin(0), false);
    assert.strictEqual(isSuspectMargin(-999), false);
  });

  test("isSuspectMargin: non-finite margins are not flagged", () => {
    assert.strictEqual(isSuspectMargin(Infinity), false);
    assert.strictEqual(isSuspectMargin(NaN), false);
    assert.strictEqual(isSuspectMargin(undefined), false);
  });

  test("suspectMarginBadge: only flagged rows get the ⚠ badge", () => {
    assert.ok(suspectMarginBadge({ suspectMargin: true }).includes("⚠"));
    assert.strictEqual(suspectMarginBadge({ suspectMargin: false }), "");
    assert.strictEqual(suspectMarginBadge({}), "");
    assert.strictEqual(suspectMarginBadge(null), "");
  });

  test("suspectMarginBadge: carries a title explaining the flag", () =>
    assert.ok(/title="[^"]*bad market data/i.test(suspectMarginBadge({ suspectMargin: true }))));
}

// ── 2. Display filter: a flag MARKS a row, it never removes it ───────────────
// Mirrors the predicate in sorting.js updateTableDisplay (same shape as
// tests/has-override-filter.test.cjs). Filtering flagged rows out of the default
// view had the same effect as the build-time drop it replaced for anyone not
// running Show All — the item simply was not there — so the flag now feeds the
// ⚠ badge and nothing else.
{
  const applyFilter = (rows, showAll) =>
    showAll ? rows.slice()
            : rows.filter((row) =>
                row.hasOverride || (row.marginInfo && row.marginInfo.margin >= 0));

  const rows = [
    { id: "sane", marginInfo: { margin: 42 } },
    { id: "suspect", marginInfo: { margin: 9000 }, suspectMargin: true },
    { id: "suspect-with-override", marginInfo: { margin: 9000 }, suspectMargin: true, hasOverride: true },
    { id: "loss", marginInfo: { margin: -5 } },
  ];

  test("filter: a flagged row stays in the default view", () =>
    assert.deepStrictEqual(applyFilter(rows, false).map((r) => r.id),
      ["sane", "suspect", "suspect-with-override"]));

  test("filter: the flag is not a licence to show losses", () =>
    assert.ok(!applyFilter(rows, false).some((r) => r.id === "loss")));

  test("filter: Show All still reveals everything", () =>
    assert.deepStrictEqual(applyFilter(rows, true).map((r) => r.id),
      ["sane", "suspect", "suspect-with-override", "loss"]));
}

// ── 3. Transmute renderer ────────────────────────────────────────────────────
{
  const stubs = domStubs + `
const SETUP_FEE = 0.025, PREMIUM_TAX = 0.04, MAX_MARGIN_PERCENT = 500;
function isSuspectMargin(m){ return Number.isFinite(m) && m > MAX_MARGIN_PERCENT; }
function suspectMarginBadge(row){ return row && row.suspectMargin ? "<span title='bad market data'>⚠</span> " : ""; }
function getOrderType(){ return "buy"; }
function isBlackRedZoneEnabled(){ return true; }
function getIQRBounds(){ return null; }
function calcStationFeeSilver(){ return 0; }
function getBuyPrice(data, city){ return data && data[city] ? (data[city].buy || 0) : 0; }
function getSellPrice(data, city){ return data && data[city] ? (data[city].sell || 0) : 0; }
function getCityForce(){ return null; }
function getOverridePrice(){ return null; }
function isInvalidCrossRoute(){ return false; }
function getMinVol2(){ return 123; }
function formatSilver(n){ return String(n); }
function getItemDisplayName(id){ return resourceShortName(id) || id; }
function matPriceSpan(id, city, price){ return "<span data-item-id='"+id+"'>@ "+price+"</span>"; }
function resourceAliasSpan(){ return ""; }
// Read-only aggregate cost cell (js/app.js aggregateCostTd) — the Input Cost
// column is a sum, so it is not a click-to-override price cell.
function aggregateCostTd(c, cls) { return '<td class="' + (cls || "silver-val cell-num") + '">' + (Number(c) > 0 ? c : "—") + '</td>'; }
function priceTd(p){ return "<td>"+p+"</td>"; }
function profitTd(mi){ return "<td>"+(mi&&mi.profit)+"</td>"; }
function pureProfitTd(mi){ return "<td>"+(mi&&mi.profit)+"</td>"; }
// The "+" column cell (js/table-add-button.js) — every row template emits it.
function addTdForKey(){ return '<td class="cell-add"></td>'; }
function getRowKey(row){ return row.tier + "|" + (row.transition && row.transition.label); }
const captured = { rows: [], html: [] };
function renderTableData(id, rows, fmt){
  captured.rows = rows;
  captured.html = rows.map((r,i) => { try { return fmt(r,i); } catch(e){ return "ERR:"+e.message; } });
}
`;
  const mod = new Module("suspect-margin-transmute");
  mod._compile(
    stubs + J("resource-names.js") + J("data-transmute.js") + J("render-transmute.js") +
      "\nmodule.exports = { renderTransmuteTable, captured };",
    "smt.js",
  );
  const { renderTransmuteTable, captured } = mod.exports;

  // T4 rock at 4 silver, T5 rock selling for 500,000 → margin far over 500%.
  renderTransmuteTable({
    T4_ROCK: { Lymhurst: { buy: 4, volume_24h: 999 } },
    T5_ROCK: { Martlock: { sell: 500000, volume_24h: 999 } },
  });
  const rocks = captured.rows.filter((r) => r.transition && /rock/.test(r.transition.label));
  const t5 = rocks.find((r) => r.targetId === "T5_ROCK");
  const html = captured.html.filter((h) => h && h.includes("<tr")).join("\n");

  test("transmute: no formatter errors", () =>
    assert.ok(!captured.html.some((h) => h && h.includes("ERR:"))));

  test("transmute: the bugged-margin row is kept, not dropped", () => {
    assert.ok(t5, "T4 → T5 rock row should exist");
    assert.ok(t5.marginInfo.margin > 500, `margin should be over the cap, got ${t5.marginInfo.margin}`);
  });

  test("transmute: the row is flagged and rendered with the ⚠ badge", () => {
    assert.strictEqual(t5.suspectMargin, true);
    assert.ok(html.includes("⚠"), "badge missing from rendered HTML");
  });

  test("transmute: a normal-margin row is NOT flagged", () => {
    renderTransmuteTable({
      T4_ROCK: { Lymhurst: { buy: 1000, volume_24h: 999 } },
      T5_ROCK: { Martlock: { sell: 3000, volume_24h: 999 } },
    });
    const sane = captured.rows.find((r) => r.targetId === "T5_ROCK");
    assert.ok(sane, "row should render");
    assert.ok(!sane.suspectMargin, `margin ${sane.marginInfo.margin} must not be flagged`);
    assert.ok(!captured.html.join("").includes("⚠"), "no badge on sane rows");
  });

  test("transmute: a suspect chain candidate never wins its group over a sane one", () => {
    // 4 → 5 → 6 (only chain to T6) vs the same group: rig T6 sell so the chain is
    // sane, and check the group still emits the sane candidate unflagged.
    renderTransmuteTable({
      T4_ROCK: { Lymhurst: { buy: 1000, volume_24h: 999 } },
      T5_ROCK: { Brecilien: { buy: 2000, volume_24h: 999 } },
      T6_ROCK: { Martlock: { sell: 12000, volume_24h: 999 } },
    });
    const toT6 = captured.rows.filter((r) => r.transition && r.targetId === "T6_ROCK");
    assert.ok(toT6.length > 0, "some route to T6 should render");
    assert.ok(toT6.some((r) => !r.suspectMargin), "a sane route to T6 must be present");
  });
}

// ── 4. Enchanting renderer ───────────────────────────────────────────────────
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
// Read-only aggregate cost cell (js/app.js aggregateCostTd) — the Input Cost
// column is a sum, so it is not a click-to-override price cell.
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
  const mod = new Module("suspect-margin-enchanting");
  mod._compile(
    stubs + J("data-city-bonuses.js") + (J("calculations.js") + J("calculations-margins.js")) + J("travel-cost.js") + (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) +
      J("data-enchanting.js") + J("render-enchanting.js") +
      // Declared last so it wins over utils.js's version, which walks every item
      // catalog (FLIPPING_ITEMS, CONSUMABLES, …) this harness doesn't load.
      "\nfunction getItemDisplayName(id){ return id; }" +
      "\nmodule.exports = { renderEnchantingTable, captured };",
    "sme.js",
  );
  const { renderEnchantingTable, captured } = mod.exports;

  // .0 bow + its runes cheap, .1 bow selling absurdly high → margin over the cap.
  const md = {
    T6_2H_BOW_KEEPER: { Lymhurst: { sell_price: 1000, buy_price: 1000, volume_24h: 99 } },
    T6_RUNE: { Lymhurst: { sell_price: 10, buy_price: 10, volume_24h: 99 } },
    "T6_2H_BOW_KEEPER@1": { Martlock: { sell_price: 90000000, buy_price: 90000000, volume_24h: 99 } },
  };
  renderEnchantingTable(md);
  const row01 = captured.rows.find((r) => r.item && r.transitionLabel === ".0 → .1");
  const html = captured.html.filter((h) => h && h.includes("<tr")).join("\n");

  test("enchanting: no formatter errors", () =>
    assert.deepStrictEqual(captured.html.filter((h) => h && h.includes("ERR:")), []));

  test("enchanting: the bugged-margin row is kept and flagged", () => {
    assert.ok(row01, ".0 → .1 row should exist");
    assert.ok(row01.marginInfo.margin > 500, `margin over cap expected, got ${row01.marginInfo.margin}`);
    assert.strictEqual(row01.suspectMargin, true);
    assert.ok(html.includes("⚠"), "badge missing from rendered HTML");
  });

  test("enchanting: a normal-margin row is NOT flagged", () => {
    renderEnchantingTable({
      T6_2H_BOW_KEEPER: { Lymhurst: { sell_price: 100000, buy_price: 100000, volume_24h: 99 } },
      T6_RUNE: { Lymhurst: { sell_price: 500, buy_price: 500, volume_24h: 99 } },
      "T6_2H_BOW_KEEPER@1": { Martlock: { sell_price: 300000, buy_price: 300000, volume_24h: 99 } },
    });
    const sane = captured.rows.find((r) => r.item && r.transitionLabel === ".0 → .1");
    assert.ok(sane, "row should render");
    assert.ok(!sane.suspectMargin, `margin ${sane.marginInfo.margin} must not be flagged`);
  });
}

// ── 5. Rerolling renderer ────────────────────────────────────────────────────
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
// Read-only aggregate cost cell (js/app.js aggregateCostTd) — the Input Cost
// column is a sum, so it is not a click-to-override price cell.
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
  const mod = new Module("suspect-margin-rerolling");
  mod._compile(
    stubs + J("data-city-bonuses.js") + (J("calculations.js") + J("calculations-margins.js")) + J("travel-cost.js") + (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) +
      J("data-enchanting.js") + J("data-rerolling.js") + J("render-rerolling.js") +
      "\nmodule.exports = { renderRerollingTable, captured };",
    "smr.js",
  );
  const { renderRerollingTable, captured } = mod.exports;

  // qualityData shape: [itemId][quality][city]. Normal cheap, Good absurd.
  const qd = {
    T8_SHOES_PLATE_SET3: {
      1: { Lymhurst: { buy_price: 100, sell_price: 100, volume_24h: 99 } },
      2: { Martlock: { buy_price: 50000000, sell_price: 50000000, volume_24h: 99 } },
    },
  };
  renderRerollingTable(qd);
  const good = captured.rows.find((r) => r.item && r.transition && r.transition.from === 1 && r.transition.to === 2);
  const html = captured.html.filter((h) => h && h.includes("<tr")).join("\n");

  test("rerolling: no formatter errors", () =>
    assert.ok(!captured.html.some((h) => h && h.includes("ERR:"))));

  test("rerolling: the bugged-margin row is kept and flagged", () => {
    assert.ok(good, "Normal → Good row should exist");
    assert.ok(good.marginInfo.margin > 500, `margin over cap expected, got ${good.marginInfo.margin}`);
    assert.strictEqual(good.suspectMargin, true);
    assert.ok(html.includes("⚠"), "badge missing from rendered HTML");
  });

  test("rerolling: a normal-margin row is NOT flagged", () => {
    renderRerollingTable({
      T8_SHOES_PLATE_SET3: {
        1: { Lymhurst: { buy_price: 1000000, sell_price: 1000000, volume_24h: 99 } },
        2: { Martlock: { buy_price: 1500000, sell_price: 1500000, volume_24h: 99 } },
      },
    });
    const sane = captured.rows.find((r) => r.item && r.transition && r.transition.from === 1 && r.transition.to === 2);
    assert.ok(sane, "row should render");
    assert.ok(!sane.suspectMargin, `margin ${sane.marginInfo.margin} must not be flagged`);
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
