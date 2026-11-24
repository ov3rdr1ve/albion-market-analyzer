/**
 * Test: an unpriced SEED leg must not blank the whole Farming row.
 *
 * Bug: evaluateFarmingCity (js/farming-row-econ.js) returned null whenever the
 * seed/feed leg came back without a price, so every candidate farm city was
 * discarded and evaluateFarmingRow fell through to emptyFarmingRow(). The row
 * then lost its farm city, its +10% bonus AND the crop's own sell price — which
 * was known all along. Reported against Ghoul Yarrow [T8] after a Caerleon
 * capture: in `market` order type a buy cell reads buy_price, and a book with no
 * standing buy orders records buy_price 0 while sell_price is real.
 *
 * The seed cell staying blank is correct (the app never falls a buy cell through
 * to the sell field — js/utils.js). The rest of the row going blank with it is
 * the bug.
 *
 * Second half: with a free (0) seed price calcFarmingEconomics reports the whole
 * revenue as profit and the margin hits the 999 sentinel. A row that does not
 * know what its seeds cost must print no profit at all.
 *
 * Black-box: drive the real renderFarmingTable over synthetic market data and
 * read the row objects and the HTML. No network, no files.
 *
 * Run: node tests/farming-unpriced-seed-row.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const SOURCES = [
  "data-city-bonuses.js", "calculations.js", "calculations-margins.js", "travel-cost.js", "mp-bonus.js",
  "utils.js", "utils-item-ids.js", "utils-overrides.js", "utils-focus-fees.js", "focus-play.js", "focus-costs.js", "data-farming.js",
  "farming-row-econ.js", "render-farming.js",
].map(J).join("\n");

// The stub layer the other farming tests use: enough DOM for the toggles, and a
// priceTd/renderTableData pair that records what the renderer asked for.
function harness({ instant = false, blackRedZone = false } = {}) {
  const stubs = `
const _els = {
  "include-caerleon": { checked: true },
  "sort-instant": { checked: ${instant} },
  "use-focus": { checked: true },
  "premium-account": { checked: true },
};
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const window = { addEventListener: () => {} };
const tableState = { "farming-table": { data: [], html: [] } };
function renderTableData(id, rows, fmt) {
  tableState[id].data = rows;
  tableState[id].html = rows.map((r, i) => { try { return fmt(r, i); } catch (e) { return "ERR:" + e.message; } });
}
function priceTd(price, itemId, city, side) {
  const body = price > 0 ? String(price) : "no data — click to set";
  return '<td class="cell-num price-editable" data-item-id="' + itemId
    + '" data-city="' + city + '" data-city-list="' + (side || "sell") + '">' + body + '</td>';
}
function profitTd(info) { return '<td class="cell-margin" data-margin="' + (info ? info.margin : "") + '"></td>'; }
function volTd() { return "<td></td>"; }
function getProfitClass() { return ""; }
function addTdForKey() { return '<td class="cell-add"></td>'; }
function getRowKey(row) { return ((row.item && row.item.id) || "?") + "|" + (row.section || ""); }
function dispName(id, name) { return name || id; }
function tx(en) { return en; }
function focusPlayCell(play) { return '<td class="cell-focus-play">' + (play ? "play" : "—") + '</td>'; }
function formatSilver(n) { return String(Math.round(Number(n) || 0)); }
function formatFocusCost(n) { return String(Math.round(Number(n) || 0)); }
const ITEM_NAMES_MAP = {};
let lastMarketData = null;
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
function isBlackRedZoneEnabled() { return ${blackRedZone}; }
`;
  const mod = new Module("farming-unpriced-seed");
  mod._compile(
    stubs + SOURCES
      + "\nmodule.exports = { tableState, renderFarmingTable, getOrderType, CITIES, ROYAL_CITIES, SELL_CITIES };",
    "farming-unpriced-seed.js",
  );
  return mod.exports;
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name + " — " + e.message); failed++; }
}

// ── fixtures ────────────────────────────────────────────────────────────────

const SEED = "T8_FARM_YARROW_SEED";
const CROP = "T8_YARROW";
const WORM = "T1_WORM";

const cell = (buy, sell, vol = 0) => ({
  buy_price: buy, sell_price: sell, volume_24h: vol,
  buy_date: buy > 0 ? "2026-09-01T00:00:00" : null,
  sell_date: sell > 0 ? "2026-09-01T00:00:00" : null,
});

// The reported shape: one captured city, and the seed's BUY book is empty.
const CAERLEON_CAPTURE = {
  [SEED]: { Caerleon: cell(0, 49996) },
  [CROP]: { Caerleon: cell(398, 411) },
  [WORM]: { Caerleon: cell(120, 150) },
};

// Seed priced everywhere — the "nothing changed" control.
const FULLY_PRICED = {
  [SEED]: {
    Thetford: cell(29002, 30500, 900), "Fort Sterling": cell(31692, 32999, 6107),
    Bridgewatch: cell(29175, 31999, 990), Lymhurst: cell(0, 33088, 3607),
  },
  [CROP]: {
    Thetford: cell(410, 439, 200000), "Fort Sterling": cell(396, 414, 3108860),
    Bridgewatch: cell(417, 420, 263849), Lymhurst: cell(365, 429, 690922),
  },
  [WORM]: { Thetford: cell(120, 150, 5000) },
};

const rowsFor = (X, itemId) =>
  X.tableState["farming-table"].data
    .map((r, i) => ({ row: r, html: X.tableState["farming-table"].html[i] }))
    .filter((e) => e.row.item && e.row.item.id === itemId);

console.log("Farming — an unpriced seed leg keeps the rest of the row\n");

// ── 1. the reported regression, in both order types ─────────────────────────

[
  { instant: false, label: "market" },
  { instant: true, label: "instant" },
].forEach(({ instant, label }) => {
  test(`${label}: seed buy book empty, crop priced — the row still routes`, () => {
    const X = harness({ instant });
    X.renderFarmingTable(CAERLEON_CAPTURE);
    const entries = rowsFor(X, SEED);
    assert.ok(entries.length > 0, "no Ghoul Yarrow row at all");
    entries.forEach(({ row }) => {
      assert.ok(row.farmCity, `${row.section}: farm city was dropped`);
      assert.ok(row.sellCrop.city, `${row.section}: crop sell city was dropped`);
      assert.ok(row.sellCrop.price > 0, `${row.section}: crop sell price was dropped`);
    });
  });
});

test("market: the Sell cell prints the crop price the map already had", () => {
  const X = harness({ instant: false });
  X.renderFarmingTable(CAERLEON_CAPTURE);
  const { html } = rowsFor(X, SEED)[0];
  const sellCell = html.match(new RegExp(`data-item-id="${CROP}"[^>]*>([^<]*)`));
  assert.ok(sellCell, "no crop price cell rendered");
  assert.ok(!/no data/.test(sellCell[1]), "the crop cell is blank: " + sellCell[1]);
});

test("market: the Buy cell still says it has no seed price", () => {
  const X = harness({ instant: false });
  X.renderFarmingTable(CAERLEON_CAPTURE);
  const { html } = rowsFor(X, SEED)[0];
  const buyCell = html.match(new RegExp(`data-item-id="${SEED}"[^>]*>([^<]*)`));
  assert.ok(buyCell, "no seed price cell rendered");
  assert.ok(/no data/.test(buyCell[1]), "the seed cell invented a price: " + buyCell[1]);
});

test("market: the unpriced-seed cell still names a real city", () => {
  const X = harness({ instant: false });
  X.renderFarmingTable(CAERLEON_CAPTURE);
  const known = new Set(X.SELL_CITIES);
  rowsFor(X, SEED).forEach(({ html }) => {
    [...html.matchAll(/data-city="([^"]*)"/g)].forEach((m) => {
      assert.ok(known.has(m[1]), "unknown city: " + m[1]);
    });
  });
});

// ── 2. no profit may be built on a free seed ────────────────────────────────

test("an unpriced seed prints no profit and no 999 margin", () => {
  const X = harness({ instant: false });
  X.renderFarmingTable(CAERLEON_CAPTURE);
  rowsFor(X, SEED).forEach(({ row, html }) => {
    assert.strictEqual(row.seedPriced, false, `${row.section}: row claims a seed price`);
    assert.strictEqual(row.marginInfo.margin, -1, `${row.section}: margin ${row.marginInfo.margin}`);
    assert.strictEqual(row.bestFocusPlay, null, `${row.section}: a focus play was advertised`);
    const cells = [...html.matchAll(/<td[^>]*class="[^"]*silver-val[^"]*"[^>]*>([\s\S]*?)<\/td>/g)]
      .map((m) => m[1]);
    assert.ok(cells.length >= 3, "profit cells missing");
    cells.forEach((c) => {
      assert.ok(/—/.test(c), "a profit cell printed a number without a seed price: " + c);
    });
  });
});

test("an unpriced seed still renders the yield, cycle and seeds-to-plant cells", () => {
  const X = harness({ instant: false });
  X.renderFarmingTable(CAERLEON_CAPTURE);
  const { row, html } = rowsFor(X, SEED)[0];
  assert.ok(/22h/.test(html), "cycle time missing");
  assert.ok(row.outputsPerCycle > 0, "yield was dropped");
  assert.ok(/cell-focus-mats/.test(html), "seeds-to-plant cell missing");
});

// ── 3. controls — everything else is unchanged ──────────────────────────────

test("a fully priced seed keeps the bonus farm city and a real profit", () => {
  const X = harness({ instant: false });
  X.renderFarmingTable(FULLY_PRICED);
  const { row } = rowsFor(X, SEED).find((e) => e.row.section !== "caerleon");
  assert.strictEqual(row.seedPriced, true);
  assert.ok(row.buySeed.price > 0, "seed leg lost its price");
  assert.ok(row.sellCrop.price > 0, "crop leg lost its price");
  assert.strictEqual(row.farmCity, "Fort Sterling", "farm city moved: " + row.farmCity);
  assert.ok(row.cityYieldBonus > 0, "the +10% bonus was dropped");
  assert.notStrictEqual(row.marginInfo.margin, -1, "a priced row reported no input cost");
});

test("a priced candidate always outranks an unpriced one", () => {
  // Only Thetford quotes the seed; the bonus city (Fort Sterling) does not. The
  // row must still source from Thetford rather than fall into the unpriced pool.
  const md = {
    [SEED]: { Thetford: cell(29002, 30500, 900) },
    [CROP]: FULLY_PRICED[CROP],
    [WORM]: FULLY_PRICED[WORM],
  };
  const X = harness({ instant: false });
  X.renderFarmingTable(md);
  const { row } = rowsFor(X, SEED).find((e) => e.row.section !== "caerleon");
  assert.strictEqual(row.seedPriced, true);
  assert.strictEqual(row.buySeed.city, "Thetford");
  assert.ok(row.buySeed.price > 0);
});

test("seed priced, crop unpriced — unchanged: the row keeps its seed cell", () => {
  const md = { [SEED]: FULLY_PRICED[SEED] };
  const X = harness({ instant: false });
  X.renderFarmingTable(md);
  const { row } = rowsFor(X, SEED).find((e) => e.row.section !== "caerleon");
  assert.strictEqual(row.seedPriced, true);
  assert.ok(row.buySeed.price > 0, "seed leg was dropped with the crop");
  assert.strictEqual(row.sellCrop.price, 0);
});

test("an empty market is unchanged: rows render, both cells blank, no null city", () => {
  const X = harness({ instant: false });
  X.renderFarmingTable({});
  const html = X.tableState["farming-table"].html.join("\n");
  assert.ok(html.length > 0, "the table rendered nothing at all");
  assert.ok(!/data-city="null"/.test(html), 'a price cell points at the city "null"');
  assert.ok(html.includes("no data"), "the cells do not invite an edit");
});

// ── 4. a pasture row's feed leg follows the same rule ───────────────────────

test("byproduct: an unpriced feed crop keeps the produce sell leg", () => {
  const X0 = harness({ instant: false });
  X0.renderFarmingTable({});
  const pasture = X0.tableState["farming-table"].data
    .map((e) => e.item).find((i) => i && i.type === "byproduct");
  assert.ok(pasture, "no byproduct row in the catalog");

  const md = { [pasture.outputId]: { Martlock: cell(900, 950, 40000) } };
  const X = harness({ instant: false });
  X.renderFarmingTable(md);
  const { row } = rowsFor(X, pasture.id).find((e) => e.row.section !== "caerleon");
  assert.strictEqual(row.seedPriced, false, "the feed leg claims a price");
  assert.ok(row.farmCity, "farm city was dropped");
  assert.ok(row.sellCrop.city, "produce sell city was dropped");
  assert.ok(row.sellCrop.price > 0, "produce sell price was dropped");
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
