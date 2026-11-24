/**
 * Test: the Artifact Rolling table sources its fragments the way the Crafting
 * Planner sources its materials — cheapest of buying the fragment and
 * transmuting a cheaper node up (Soul → Relic, 5× T5 → T6) — and prints one
 * "best path: …" line naming the route under the fragment price.
 *
 * Asserted through the real renderRollingTable (row data + row HTML), the real
 * fragment DP (js/fragment-transmute-sourcing.js) and fee tables
 * (js/data-transmute.js), plus the Craft List extractor for the shopping list.
 *
 * Black-box over synthetic market data. No live API or DB.
 *
 * Run: node tests/rolling-fragment-best-path-render.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const stubs = `
const _els = {
  "include-caerleon": { checked: true },
  "sort-instant": { checked: false },
};
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const window = { addEventListener: () => {} };
const tableState = { "rolling-table": { data: [], html: [] } };
function renderTableData(id, rows, fmt) {
  tableState[id].data = rows;
  tableState[id].html = rows.map((r, i) => { try { return fmt(r, i); } catch (e) { return "ERR:" + e.message; } });
}
function priceTd(price, itemId, city) {
  return '<td class="price-editable" data-item-id="' + itemId + '" data-city="' + city + '" data-city-list="sell">' + price + '</td>';
}
function profitTd() { return "<td></td>"; }
function getProfitClass() { return ""; }
function addTdForKey() { return '<td class="cell-add"></td>'; }
function getRowKey(row) { return (row.artId || "?") + "|" + (row.cat || ""); }
function dispName(id, name) { return name || id; }
function tx(en) { return en; }
function formatSilver(n) { return String(Math.round(Number(n) || 0)); }
function formatPriceAge() { return null; }
const ITEM_NAMES_MAP = {
  T5_RELIC: "Expert's Relic", T6_RELIC: "Master's Relic",
  T5_SOUL: "Expert's Soul", T6_SOUL: "Master's Soul",
};
ITEM_NAMES_MAP.T6_ARTEFACT_TOKEN_FAVOR_3 = "Master's Crystallized Magic";
const CRAFTING_ITEMS = [];
const FLIPPING_ITEMS = [];
let lastMarketData = null;
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
`;

const sources =
  J("data-city-bonuses.js") +
  (J("calculations.js") + J("calculations-margins.js")) +
  J("travel-cost.js") +
  J("mp-bonus.js") +
  (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) +
  J("price-freshness.js") +
  J("data-artifacts.js") +
  J("gear-token-substitute.js") +
  J("data-transmute.js") +
  J("fragment-transmute-sourcing.js") +
  J("render-craft-planner-paths.js") +
  J("rolling-strategy.js") +
  J("render-rolling.js");

const mod = new Module("rolling-fragment-best-path-render");
mod._compile(
  stubs + sources +
    "\nmodule.exports = { tableState, renderRollingTable, CITIES, TRANSMUTE_SILVER_COST," +
    " artifactSalvageValue, getSetupFee: () => SETUP_FEE };",
  "rolling-fragment-best-path-render.js",
);
const X = mod.exports;
const { extractCraftListRow } = require(path.join(__dirname, "..", "js", "craft-list-materials.js"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name + " — " + e.message); failed++; }
}

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: expected ${b}, got ${a}`);

/**
 * Render with every city quoting `prices` ({id: buyPrice}) and every T6 Relic
 * artifact listed, then return the first T6 Relic artifact row and its HTML.
 */
// `artPrice` is one number for both books, or { buy, sell } to split them.
function renderT6Relic(prices, artPrice = 2_000_000) {
  const artBuy = typeof artPrice === "object" ? artPrice.buy : artPrice;
  const artSell = typeof artPrice === "object" ? artPrice.sell : artPrice;
  const rows = X.tableState["rolling-table"];
  X.renderRollingTable({});
  const md = {};
  const put = (id, b, s) => X.CITIES.forEach((c) => { (md[id] ||= {})[c] = { buy_price: b, sell_price: s, volume_24h: 500 }; });
  Object.entries(prices).forEach(([id, p]) => put(id, p, p));
  rows.data.forEach((r) => { if (r.tier === 6 && r.rollType === "Relic") put(r.artId, artBuy, artSell); });
  X.renderRollingTable(md);
  const i = rows.data.findIndex((r) => r.tier === 6 && r.rollType === "Relic" && r.artId);
  assert.ok(i >= 0, "no T6 Relic row");
  return { row: rows.data[i], html: String(rows.html[i]) };
}

const fragCell = (html) => {
  const m = html.match(/<td class="silver-val price-editable"[^>]*data-city-list="buy"[^>]*>[\s\S]*?<\/td>/);
  assert.ok(m, "fragment cell missing");
  return m[0];
};

console.log("Artifact Rolling — fragment best path\n");

test("a dear Relic is sourced from a cheaper Soul, transmuted up", () => {
  const { row } = renderT6Relic({ T6_RELIC: 40_000, T6_SOUL: 10_000 });
  assert.strictEqual(row.fragSourcing.source, "transmute");
  assert.strictEqual(row.fragBuyId, "T6_SOUL");
  assert.strictEqual(row.fragBuyPrice, 10_000);
  const perUnit = 10_000 * (1 + X.getSetupFee()) + X.TRANSMUTE_SILVER_COST.SOUL_RELIC[6];
  close(row.fragSourcing.perUnit, perUnit, "per-fragment cost");
  close(row.rollCostSilver, row.rollCost * perUnit, "roll cost");
});

test("the transmuted fragment cell edits the Soul and names the route", () => {
  const { row, html } = renderT6Relic({ T6_RELIC: 40_000, T6_SOUL: 10_000 });
  const cell = fragCell(html);
  assert.ok(cell.includes('data-item-id="T6_SOUL"'), "cell must edit the bought node");
  assert.ok(cell.includes("best path"), "best path line missing");
  assert.ok(cell.includes("(via transmute)"), "transmute tag missing");
  assert.ok(cell.includes(`${row.rollCost}× Master's Soul`), "bought count + name missing");
  assert.ok(cell.includes("buy Master's Soul"), "best path must name the bought node");
});

test("salvage stays valued at the Relic's own market price", () => {
  const { row } = renderT6Relic({ T6_RELIC: 40_000, T6_SOUL: 10_000 });
  assert.strictEqual(row.fragSalvagePrice, 40_000);
});

test("a cheap Relic is bought outright — no transmute tag", () => {
  const { row, html } = renderT6Relic({ T6_RELIC: 12_000, T6_SOUL: 10_000 });
  assert.strictEqual(row.fragSourcing.source, "market");
  assert.strictEqual(row.fragBuyId, "T6_RELIC");
  close(row.rollCostSilver, row.rollCost * 12_000 * (1 + X.getSetupFee()), "roll cost");
  const cell = fragCell(html);
  assert.ok(cell.includes('data-item-id="T6_RELIC"'));
  assert.ok(cell.includes("best path") && cell.includes("buy it"), "buy-it line missing");
  assert.ok(!cell.includes("via transmute"), "no transmute on a market buy");
});

test("5× T5 Relic tier-up is used when it wins", () => {
  const { row } = renderT6Relic({ T6_RELIC: 40_000, T5_RELIC: 1_000 });
  assert.strictEqual(row.fragBuyId, "T5_RELIC");
  assert.strictEqual(row.fragSourcing.buyCount, 5);
  close(row.rollCostSilver, row.rollCost * 5 * 1_000 * (1 + X.getSetupFee()), "roll cost");
});

test("an unlisted Relic still rolls off a transmuted Soul; salvage falls back to that cost", () => {
  const { row, html } = renderT6Relic({ T6_SOUL: 10_000 });
  assert.strictEqual(row.hasNoFragData, false);
  assert.strictEqual(row.fragSourcing.source, "transmute");
  close(row.fragSalvagePrice, row.fragSourcing.perUnit, "salvage price");
  assert.ok(!fragCell(html).includes("no data"), "row must not read no data");
});

test("nothing priced on the fragment grid → no data, still click to set", () => {
  const { row, html } = renderT6Relic({});
  assert.strictEqual(row.hasNoFragData, true);
  assert.strictEqual(row.rollCostSilver, 0);
  assert.ok(fragCell(html).includes("click to set"));
});

test("the Craft List shops the bought node in the bought count", () => {
  const { row } = renderT6Relic({ T6_RELIC: 40_000, T5_RELIC: 1_000 });
  const entry = extractCraftListRow("rolling-table", row);
  assert.strictEqual(entry.materials.length, 1);
  assert.strictEqual(entry.materials[0].matId, "T5_RELIC");
  assert.strictEqual(entry.materials[0].count, row.rollCost * 5);
  assert.strictEqual(entry.materials[0].perUnit, 1_000);
});

// ── Crystallized token cheaper than the artifact ────────────────────────────
// A Relic artifact's slot in a gear craft can be filled by a Crystallized Magic
// token instead (js/gear-token-substitute.js). When the token costs less than
// the artifact, the artifact row says so.

const itemCell = (html) => {
  const m = html.match(/<td class="cell-item">[\s\S]*?<\/td>/);
  assert.ok(m, "artifact cell missing");
  return m[0];
};
const TOKEN = "T6_ARTEFACT_TOKEN_FAVOR_3";

test("a cheaper Crystallized token is shown on the artifact row", () => {
  const { row, html } = renderT6Relic({ T6_RELIC: 40_000, [TOKEN]: 900_000 });
  assert.ok(row.tokenSub, "expected tokenSub");
  assert.strictEqual(row.tokenSub.tokenId, TOKEN);
  assert.strictEqual(row.tokenSub.price, 900_000);
  assert.strictEqual(row.tokenSub.artPrice, 2_000_000);
  const cell = itemCell(html);
  assert.ok(cell.includes("best path"), "best path line missing");
  assert.ok(cell.includes("Master's Crystallized Magic"), "token must be named");
  assert.ok(/900[,.]?000/.test(cell), "token price must be shown");
  assert.ok(cell.includes("cheaper than"), "substitute tag missing");
});

test("a token dearer than the artifact is not shown", () => {
  const { row, html } = renderT6Relic({ T6_RELIC: 40_000, [TOKEN]: 3_000_000 });
  assert.strictEqual(row.tokenSub, null);
  assert.ok(!itemCell(html).includes("Crystallized"));
});

test("an unpriced token is not shown", () => {
  const { row, html } = renderT6Relic({ T6_RELIC: 40_000 });
  assert.strictEqual(row.tokenSub, null);
  assert.ok(!itemCell(html).includes("best path"));
});

// The Rolling table SELLS the artifact, so the token is weighed against the sale
// the row prints — a crafter paying less for the token will not pay that price —
// even when some city also lists the artifact itself below the token.
test("the token is weighed against the row's sale price, not the artifact's cheapest buy", () => {
  const { row, html } = renderT6Relic(
    { T6_RELIC: 40_000, [TOKEN]: 200_000 }, { buy: 150_000, sell: 318_999 });
  assert.ok(row.tokenSub, "a token below the printed sale must show");
  assert.strictEqual(row.tokenSub.artPrice, row.bestSellPrice);
  assert.ok(/318[,.]?999/.test(itemCell(html)), "tag must quote the row's sale price");
});

test("a sale below the token hides the line", () => {
  const { row } = renderT6Relic({ T6_RELIC: 40_000, [TOKEN]: 200_000 }, { buy: 150_000, sell: 189_980 });
  assert.strictEqual(row.tokenSub, null);
});

test("an artifact nobody lists is compared on nothing — no token line", () => {
  const { row } = renderT6Relic({ T6_RELIC: 40_000, [TOKEN]: 900_000 }, 0);
  assert.strictEqual(row.tokenSub, null);
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
