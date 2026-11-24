/**
 * Test: the Mounts table's craft-row Pure Profit twin — plan.md step 1 (TDD
 * red) — and the breeding rows' ea54329 self-found line left untouched.
 *
 * Per-table rules (plan.md): on a mounts CRAFT row the saddle/mats (refined
 * leather) are gatherable → zeroed with their setup-fee share; the bought
 * mount input ("baby mount" — here the grown horse), its setup fee, any haul
 * leg and the sell tax stay:
 *
 *   twin = sellPrice × (1 − PREMIUM_TAX)
 *          − grown-horse term ×(1 + SETUP_FEE)      [a mount is not gatherable]
 *
 * The leather term is RRR-eligible (js/rrr-eligible.js) and leaves whole; the
 * grown horse is consumed 1:1 (no RRR return) and stays. Exact values by hand
 * below.
 *
 * BREEDING ROWS ARE ALREADY DONE (commit ea54329 priced the self-bred twin
 * into the "Profit / 10k Focus" cell): the regression half of this file
 * asserts they did NOT grow a second twin — no selfFoundProfit on the
 * marginInfo, no new line in the Pure Profit cell — while the ea54329 line
 * survives untouched in its own cell. Those assertions pass before AND after
 * the feature; the craft-row assertions are the red ones.
 *
 * Black-box: render the REAL renderMountsTable against synthetic market data
 * (harness mirrors tests/breeding-self-found-per10k-focus.test.cjs / tests/
 * mounts-unpriced-craft-row.test.cjs). No live APIs.
 *
 * Tax getter control (repo convention): the real js/utils.js +
 * js/calculations.js getters resolve the #premium-account checkbox stub;
 * market orders keep SETUP_FEE at 0.025.
 *
 * Run: node --test tests/mounts-craft-self-found-profit.test.cjs
 */

const assert = require("assert");
const { test } = require("node:test");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const J = (f) => fs.readFileSync(path.join(ROOT, "js", f), "utf8");

const stubs = `
const _els = { "use-focus": { checked: true }, "premium-account": { checked: true }, "station-fee": { value: "0" } };
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const window = { addEventListener: () => {} };
const tableState = { "mounts-table": { data: [] }, "faction-spending-table": { data: [] } };
function renderTableData(id, rows, fmt) { tableState[id].data = rows; tableState[id].html = rows.map((r,i)=>{ try { return fmt(r,i); } catch(e){ return "ERR:"+e.message; } }); }
function priceTd(p){ return "<td>"+p+"</td>"; }
function volTd(){ return "<td></td>"; }
function profitTd(){ return "<td></td>"; }
function pureProfitTd(){ return "<td></td>"; }
function matPriceSpan(id, c, p){ return "<span>"+p+"</span>"; }
function getProfitClass(){ return ""; }
function dispName(id, fallbackName){ return fallbackName; }
function tx(enText, slug){ return enText; }
function addTdForKey(){ return "<td></td>"; }
function brecilienFeeBadge(){ return ""; }
function focusPlayCell(){ return "<td></td>"; }
function formatSilver(n) { return Math.round(Number(n) || 0).toLocaleString("en-US"); }
function formatFocusCost(n) { return String(n); }
function formatBarCrafts(n) { return String(n); }
function matsNeededFor10kFocus() { return 0; }
const ITEM_NAMES_MAP = {};
let lastMpMarketData = null, lastMarketData = null;
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
const CRAFTING_ITEMS = [], FLIPPING_ITEMS = [], TRANSPORT_ITEMS = [], CONSUMABLES = [], FARMING_ITEMS = [], ARTIFACT_FLIP_ITEMS = [], GEAR_CAPES = [];
`;

const sources =
  J("focus-play.js") +
  J("data-faction-fp-costs.js") +
  J("focus-costs.js") +
  J("data-mounts.js") +
  J("data-city-bonuses.js") +
  (J("calculations.js") + J("calculations-margins.js")) +
  J("self-found-profit.js") +
  J("travel-cost.js") +
  J("mp-bonus.js") +
  (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) +
  J("sorting-row-key.js") +
  J("rrr-eligible.js") + J("render-mounts.js") + J("render-mounts-breeding-row.js") + J("render-mounts-craft-row.js");

const mod = new Module("mounts-craft-self-found-profit");
mod._compile(
  stubs + sources + "\nmodule.exports = { tableState, renderMountsTable, _els, formatSilver," +
    " fees: { premiumTax: () => PREMIUM_TAX, setupFee: () => SETUP_FEE } };",
  "mounts-craft-self-found-profit.js",
);
const X = mod.exports;

const priced = (buy, sell, vol) => ({ buy_price: buy, sell_price: sell, volume_24h: vol });
const BABY = "T8_FARM_HORSE_BABY";
const GROWN = "T8_FARM_HORSE_GROWN";
const SADDLED = "T8_MOUNT_HORSE";
const GROWN_PRICE = 100000;
const LEATHER_PRICE = 9000;

// Prices equal in every listed city, so the winning route's cities never move
// the hand math. The baby/feed set keeps the breeding rows valued (ea54329).
function market({ leather = LEATHER_PRICE } = {}) {
  const md = {};
  const put = (id, b, s, v) =>
    ["Lymhurst", "Martlock", "Caerleon"].forEach((c) => { (md[id] = md[id] || {})[c] = priced(b, s, v); });
  put(BABY, 60000, Math.round(60000 * 1.08), 500);
  put(GROWN, GROWN_PRICE, 110000, 500);
  put("T8_LEATHER", leather, leather + 500, 5000);
  put(SADDLED, 380000, 420000, 500);
  put("T3_WHEAT", 100, 110, 5000);
  return md;
}

function render(md) {
  X._els["use-focus"].checked = true;
  X.renderMountsTable(md);
  return {
    rows: X.tableState["mounts-table"].data.slice(),
    html: X.tableState["mounts-table"].html.slice(),
  };
}

const isCraftRow = (r) => r.isCraft && r.item && r.item.id === SADDLED;
const isBreedRow = (r) => !r.isCraft && r.item && r.item.babyId === BABY;

// The twin lands on marginInfo.selfFoundProfit; accept a row field (plan.md
// allows either shape).
const sfOf = (row) => {
  if (row.marginInfo && row.marginInfo.selfFoundProfit !== undefined) {
    return row.marginInfo.selfFoundProfit;
  }
  return row.selfFoundProfit;
};

const near = (a, b) => Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-9);

function saddledRow() {
  const s = render(market());
  const i = s.rows.findIndex((r) => isCraftRow(r) && r.section === "royal" && r.marginInfo.margin !== -1);
  assert.ok(i >= 0, "the fully-priced royal T8 saddled craft row must render");
  return { row: s.rows[i], html: s.html[i] };
}

// ── the craft-row twin ───────────────────────────────────────────────────────

test("fixture sanity: the saddled craft row prices grown horse + 20 leather", () => {
  const { row } = saddledRow();
  assert.strictEqual(row.matBestPrices[GROWN].price, GROWN_PRICE, "the grown horse is bought");
  assert.strictEqual(row.matBestPrices.T8_LEATHER.price, LEATHER_PRICE, "leather is injected");
  assert.ok(row.sellPot.price === 420000, "the saddled horse sells at 420,000");
  // The grown mount is NOT RRR-eligible (js/rrr-eligible.js): consumed 1:1.
  assert.ok(row.rrr > 0, "fixture precondition: focus-on RRR is a real fraction");
});

test("craft row twin: leather zeroed, bought grown mount + setup fee + tax kept", () => {
  const { row } = saddledRow();
  assert.strictEqual(typeof sfOf(row), "number",
    "selfFoundProfit missing on the mounts craft row (feature not implemented)");
  // 420,000 x (1 - 0.065) - 100,000 x 1.025 = 392,700 - 102,500 = 290,200.
  // The 20x leather term (RRR-eligible, gatherable) leaves with its setup fee.
  const want = 420000 * (1 - X.fees.premiumTax()) - GROWN_PRICE * (1 + X.fees.setupFee());
  assert.ok(near(sfOf(row), want), `twin ${sfOf(row)} != ${want}`);
});

test("craft row twin: independent of the leather price, primary is not", () => {
  const a = saddledRow().row;
  X.renderMountsTable(market({ leather: 20000 }));
  const b = X.tableState["mounts-table"].data.find(
    (r) => isCraftRow(r) && r.section === "royal" && r.marginInfo.margin !== -1);
  assert.strictEqual(typeof sfOf(b), "number", "selfFoundProfit missing (leather re-price)");
  assert.ok(near(sfOf(b), sfOf(a)),
    `twin moved with the leather price (${sfOf(a)} → ${sfOf(b)}) — the saddle mats are not zeroed`);
  assert.ok(b.marginInfo.profit < a.marginInfo.profit,
    "the PRIMARY profit must still track the leather price");
});

test("craft row twin: strictly above the bought profit (the zeroing is non-trivial)", () => {
  const { row } = saddledRow();
  assert.ok(row.marginInfo.profit > 0 && row.marginInfo.profit < sfOf(row),
    `bought ${row.marginInfo.profit} vs twin ${sfOf(row)}`);
});

test("craft row regression: the bought profit keeps today's formula", () => {
  const { row } = saddledRow();
  // Grown horse 1:1, leather 20x discounted by the row's own RRR.
  const want = 420000 * (1 - X.fees.premiumTax())
    - (GROWN_PRICE * (1 + X.fees.setupFee())
      + 20 * LEATHER_PRICE * (1 - row.rrr) * (1 + X.fees.setupFee()));
  assert.ok(near(row.marginInfo.profit, want),
    `primary profit ${row.marginInfo.profit} drifted from the hand formula ${want}`);
});

test("craft row Profit / 10k Focus: gathered line = the twin × the bar's crafts", () => {
  const { row, html } = saddledRow();
  assert.ok(row.focusCost > 0, "fixture precondition: the saddled horse is focus-craftable");
  assert.ok(near(row.profitFocusOnGathered, sfOf(row)), "gathered operand is not the craft twin");
  const crafts = row.focusCost > 10000 ? 10000 / row.focusCost : Math.floor(10000 / row.focusCost);
  assert.ok(near(row.profitPer10kFocusGathered, sfOf(row) * crafts),
    `profitPer10kFocusGathered ${row.profitPer10kFocusGathered} != ${sfOf(row) * crafts}`);
  assert.ok(row.profitPer10kFocusGathered > row.profitPer10kFocus, "gathered bar must beat the bought bar");
  assert.ok(html.includes(`>gathered ${X.formatSilver(row.profitPer10kFocusGathered)}</small>`),
    "the Profit / 10k Focus cell does not show the gathered line");
});

// ── the breeding rows are DONE (ea54329) and must not grow a second twin ─────

function breedRow() {
  const s = render(market());
  const i = s.rows.findIndex((r) => isBreedRow(r) && r.focusCost > 0 && r.profitPer10kFocus > 0);
  assert.ok(i >= 0, "a valued breeding row must render");
  return { row: s.rows[i], html: s.html[i] };
}

test("breeding regression: ea54329's self-found per-10k line is intact", () => {
  const { row, html } = breedRow();
  assert.strictEqual(typeof row.profitPer10kFocusSelfFound, "number",
    "the ea54329 field vanished from the breeding row");
  const tds = html.split(/<td\b/).slice(1);
  assert.strictEqual(tds.length, 15, "breeding row column count changed — cell indexes stale");
  const p10kCell = tds[8]; // Profit / 10k Focus (after pure profit)
  assert.ok(p10kCell.includes(X.formatSilver(row.profitPer10kFocus)),
    "the bought per-10k bar lost its value");
  const small = p10kCell.match(/<small[^>]*display:block[^>]*>[\s\S]*?<\/small>/);
  assert.ok(small, "the ea54329 self-found line vanished from the per-10k cell");
  assert.ok(small[0].includes(X.formatSilver(row.profitPer10kFocusSelfFound)),
    "the ea54329 line lost the self-found per-10k value");
});

test("breeding regression: NO self-gathered twin is added to a breeding row", () => {
  const { row, html } = breedRow();
  assert.strictEqual(row.marginInfo && row.marginInfo.selfFoundProfit, undefined,
    "a breeding row's marginInfo must not grow selfFoundProfit — its twin is the ea54329 line");
  assert.strictEqual(row.selfFoundProfit, undefined,
    "a breeding row must not grow a row-level selfFoundProfit either");
  const tds = html.split(/<td\b/).slice(1);
  const pureCell = tds[7]; // Pure Profit
  assert.ok(!pureCell.includes("<small"),
    "the breeding row's Pure Profit cell must not grow a self-gathered line");
});
