/**
 * Crafting Planner: a Sell price that came from a Good+ ask must open THAT
 * quality's order book in the price editor.
 *
 * Reported: Elder's Shadowcaller (T8_MAIN_CURSEDSTAFF_AVALON@4) at Fort
 * Sterling. The sniffer stored the asks under quality 4 (29,999,980) and the
 * Normal book holds only a 3,999,999 bid. The planner already prices the sale
 * from the Excellent ask (row.sellQuality = 4, "Excellent ask" label), but the
 * Sell cell was drawn with NO data-quality — so clicking it opened the Normal
 * book: "Fort Sterling — — · 3,999,999" and an empty SELL ORDER field. The user
 * saw "only buy orders" while the row was priced off an ask.
 *
 * Contract pinned here (black-box over the rendered markup):
 *   - a row priced from a quality-q ask (q = 2..5) renders its Sell cell AND
 *     its Route cell's sell leg with data-quality="q";
 *   - a row priced from a Normal ask (sellQuality null) and a no-data row
 *     (sellQuality absent) carry no data-quality — today's markup.
 *
 * sellQuality 1 is not reachable through the pricing path (the fallback scans
 * qualities 2..5 only), so it is not exercised here.
 *
 * Run: node tests/craft-planner-sell-quality-cell.test.cjs
 */

const assert = require("assert");
const { renderCraftPlannerTable, captured, __setQualityMap } =
  require("./helpers/craft-planner-render-harness.cjs");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
  finally { __setQualityMap({}); }
}

const FS = "Fort Sterling";
const ITEM = "T8_FURNITUREITEM_TABLE";

// Materials priced; the product has NO Normal ask anywhere, so only a Good+ ask
// can price it (the planner's quality fallback, js/craft-planner-quality.js).
const FALLBACK_MARKET = {
  T8_PLANKS: { [FS]: { buy_price: 1000, volume_24h: 500 } },
  T8_METALBAR: { [FS]: { buy_price: 1200, sell_price: 1300, volume_24h: 500 } },
};

// A Normal-ask market: the product sells at a quality-1 ask.
const NORMAL_MARKET = {
  T8_PLANKS: { [FS]: { buy_price: 1000, sell_price: 1100, volume_24h: 500 } },
  T8_METALBAR: { [FS]: { buy_price: 1200, sell_price: 1300, volume_24h: 500 } },
  T8_FURNITUREITEM_TABLE: { [FS]: { sell_price: 60000, volume_24h: 80 } },
  T8_ARMOR_PLATE_SET1: { [FS]: { sell_price: 80000, volume_24h: 120 } },
};

/** The priced Sell td: the only `silver-val price-editable` td in the row. */
function sellTdOf(html) {
  const start = html.indexOf('<td class="silver-val price-editable"');
  assert.ok(start >= 0, "row markup missing its sell price td: " + html.slice(0, 300));
  return html.slice(start, html.indexOf(">", start) + 1);
}

/** The opening tag of the Route cell's sell leg (js/route-cell.js routeLeg). */
function routeSellLegOf(html) {
  const m = html.match(/<span class="price-editable route-city"[^>]*data-city-list="sell"[^>]*>/);
  assert.ok(m, "row markup missing the Route cell's sell leg: " + html.slice(0, 400));
  return m[0];
}

function dataQualityOf(tag) {
  const m = tag.match(/\sdata-quality="([^"]*)"/);
  return m ? m[1] : null;
}

function renderWithAsk(quality, price) {
  __setQualityMap({ [ITEM]: { [quality]: { Lymhurst: { buy_price: 0, sell_price: price } } } });
  renderCraftPlannerTable(FALLBACK_MARKET);
  const i = captured.rows.findIndex((r) => !r.noData && r.item.id === ITEM && r.sellQuality === quality);
  assert.ok(i >= 0, `fixture sanity: expected the ${ITEM} row priced from its q${quality} ask`);
  return { row: captured.rows[i], html: captured.html[i] };
}

console.log("Craft Planner — Sell cell carries the fallback ask's quality\n");

// ── Priced from a Good+ ask → the editor must open that quality's book ──────

[
  { quality: 2, price: 30000000 },
  { quality: 4, price: 29999980 },
  { quality: 5, price: 31000000 },
].forEach(({ quality, price }) => {
  test(`sellQuality ${quality}: the Sell cell carries data-quality="${quality}"`, () => {
    const { row, html } = renderWithAsk(quality, price);
    assert.strictEqual(row.sellPrice, price, "fixture sanity: the row sells into the fallback ask");
    const td = sellTdOf(html);
    assert.strictEqual(dataQualityOf(td), String(quality), "Sell td: " + td);
  });

  test(`sellQuality ${quality}: the Route cell's sell leg carries data-quality="${quality}"`, () => {
    const { html } = renderWithAsk(quality, price);
    const leg = routeSellLegOf(html);
    assert.strictEqual(dataQualityOf(leg), String(quality), "Route sell leg: " + leg);
  });

  test(`sellQuality ${quality}: the data-quality cell keeps the table's cell-count parity`, () => {
    renderWithAsk(quality, price);
    const counts = new Set(captured.html.map((h) => (h.match(/<td\b/g) || []).length));
    assert.strictEqual(counts.size, 1, `ragged rows: ${[...counts].join("/")}`);
  });
});

// ── Normal ask / no data → no data-quality (unchanged markup) ───────────────

[
  {
    name: "a Normal-ask priced row (sellQuality null)",
    market: NORMAL_MARKET,
    qualityMap: {},
    pick: (r) => !r.noData && r.item.id === ITEM,
    sanity: (r) => assert.ok(r.sellQuality == null, "fixture sanity: Normal ask carries no quality"),
  },
  {
    name: "a Normal-ask row even when a Good+ ask exists elsewhere (tier 1 wins)",
    market: NORMAL_MARKET,
    qualityMap: { [ITEM]: { 4: { Lymhurst: { sell_price: 99000000 } } } },
    pick: (r) => !r.noData && r.item.id === ITEM,
    sanity: (r) => assert.ok(r.sellQuality == null, "fixture sanity: Normal ask carries no quality"),
  },
  {
    name: "a no-data row (sellQuality absent)",
    market: NORMAL_MARKET,
    qualityMap: {},
    pick: (r) => r.noData && r.item.id === "T8_2H_HOLYSTAFF",
    sanity: (r) => assert.strictEqual(r.sellQuality, undefined, "fixture sanity: no quality on a no-data row"),
  },
].forEach(({ name, market, qualityMap, pick, sanity }) => {
  test(`${name}: Sell cell has no data-quality`, () => {
    __setQualityMap(qualityMap);
    renderCraftPlannerTable(market);
    const i = captured.rows.findIndex(pick);
    assert.ok(i >= 0, "fixture sanity: row not found");
    sanity(captured.rows[i]);
    const td = sellTdOf(captured.html[i]);
    assert.strictEqual(dataQualityOf(td), null, "Sell td: " + td);
  });

  test(`${name}: Route sell leg (when present) has no data-quality`, () => {
    __setQualityMap(qualityMap);
    renderCraftPlannerTable(market);
    const i = captured.rows.findIndex(pick);
    assert.ok(i >= 0, "fixture sanity: row not found");
    const m = captured.html[i].match(/<span class="price-editable route-city"[^>]*data-city-list="sell"[^>]*>/);
    if (m) assert.strictEqual(dataQualityOf(m[0]), null, "Route sell leg: " + m[0]);
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
