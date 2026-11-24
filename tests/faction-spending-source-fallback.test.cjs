/**
 * Test: Faction Spending computes its feeder caches on demand.
 *
 * The S/FP (Bred) column and the breed-inputs sub-row read
 * tableState["mounts-table"].data. Render gating skips collapsed
 * tables, so after a fresh boot (prices restored from disk, Mounts/Transport
 * still collapsed) those caches are empty and every Baby row is a dead "—"
 * with no expand toggle.
 *
 * Covers:
 *  - renderFactionSpendingTable force-computes the mounts cache when empty
 *    (same thing Scan Faction Spending's handler does first)
 *  - Baby rows then expose the .breed-toggle expander + hidden detail row
 *    with editable baby / saddled / food / leather price spans
 *  - S/FP (Bred) shows a numeric breed ratio instead of "—"
 *  - No redundant recompute when the cache is already populated
 *  - A throwing feeder renderer must not break the table
 *  - Heart rows get no Profit/10k Focus and never trigger a transport recompute
 *  - Sandboxes without the feeder renderers (legacy stubs) keep working
 *
 * Run: node tests/faction-spending-source-fallback.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const readFile = (p) => fs.readFileSync(path.join(__dirname, "..", "js", p), "utf8");
const fpCostsSrc = readFile("data-faction-fp-costs.js");
const renderSrc = readFile("render-faction-spending.js");
const focusValueSrc = readFile("faction-focus-value.js");

const BABY_ID = "T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY";
const SADDLED_ID = "T5_MOUNT_SWAMPDRAGON_FW_THETFORD";
const HEART_ID = "T1_FACTION_SWAMP_TOKEN_1";

/** A mounts-table breeding row, shaped like the real renderer's output. */
function mountsRow() {
  return {
    item: { babyId: BABY_ID, grownId: "T5_FARM_SWAMPDRAGON_FW_THETFORD_GROWN" },
    recipe: {
      id: SADDLED_ID,
      materials: [
        { matId: "T5_FARM_SWAMPDRAGON_FW_THETFORD_GROWN", count: 1 },
        { matId: "T5_LEATHER", count: 20 },
        { matId: HEART_ID, count: 5 },
      ],
    },
    sellItemId: SADDLED_ID,
    sellPot: { city: "Fort Sterling", price: 480000 },
    feed: {
      id: "T5_MEAT", city: "Fort Sterling", price: 1200, pieces: 29,
      silverPerNutrition: 12, hasData: true,
    },
    feedCost: 34800,
    saddlerMatPrices: {
      "T5_LEATHER": { price: 1500, city: "Fort Sterling" },
      [HEART_ID]: { price: 30000, city: "Thetford" },
    },
    saddlerCity: "Fort Sterling",
    saddlerRrr: 0.3,
    silverPerFp: 25.21,
    focusCost: 100,
    fpAdjustedProfit: 8000,
    fpAdjustedProfitFocusOn: 12345,
    section: "royal",
  };
}

/** A transport refining row that prices a heart-eligible route. */
function transportRow() {
  return {
    route: { resourceType: "fiber", rawId: "T1_FIBER", refinedId: "T4_CLOTH" },
    refineCity: "Thetford",
    focusCost: 10,
    marginInfo: { profit: 5000 },
    profitFocusOn: 5000,
    rrr: 0.3,
    rrrFocusOn: 0.3,
    rawUnitCost: 300,
  };
}

/** Minimal market data: one baby and one heart priced in Thetford. */
function marketData() {
  return {
    [BABY_ID]: { "Thetford": { sell_price: 47000, buy_price: 45000, volume_24h: 800 } },
    [HEART_ID]: { "Thetford": { sell_price: 30000, buy_price: 28000, volume_24h: 200 } },
  };
}

/**
 * Compile render-faction-spending (+ faction-focus-value) with stubs.
 * `withFeederRenderers` installs spy renderMountsTable/renderTransportTable
 * that fill their tableState caches exactly like the real renderers do.
 */
function makeSandbox({ withFeederRenderers = true, mountsRendererThrows = false } = {}) {
  const spyState = { mountsCalls: 0, transportCalls: 0, lastMountsArg: null, lastTransportArg: null };

  const stubs = `
${fpCostsSrc}
let _renderedRows = [];
let _renderTableArgs = null;
const tableState = {
  "mounts-table": { data: [] },
  "transport-table": { data: [] },
  "faction-spending-table": { data: [] },
};
function renderTableData(tbodyId, rows, formatter) {
  _renderTableArgs = { tbodyId, rows };
  _renderedRows = rows.map((r, i) => formatter(r, i));
  tableState[tbodyId].data = rows;
}
function findBestSellCity(md, itemId, cities) {
  for (const c of cities) {
    const p = md?.[itemId]?.[c]?.sell_price || 0;
    if (p > 0) return { city: c, price: p };
  }
  return { city: null, price: 0 };
}
function netSilverAfterFees(gross) { return Math.max(0, Math.floor(gross * 0.91)); }
function calculateSilverPerFp(silver, fp) { return fp > 0 ? silver / fp : 0; }
function getOverridePrice() { return null; }
function getItemDisplayName(id) { return id; }
function formatSilver(n) { return String(Math.round(n)).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ","); }
function priceTd(price, itemId, city) {
  return \`<td class="silver-val price-editable" data-item-id="\${itemId}" data-city="\${city}" data-raw-price="\${price}">\${price}</td>\`;
}
function volTd(v, itemId, city) { return \`<td>\${v}</td>\`; }
function matPriceSpan(matId, city, price) {
  return \`<span class="price-editable mat-price-inline" data-item-id="\${matId}" data-city="\${city}" data-raw-price="\${price}" data-city-list="buy">@ \${price} ea</span>\`;
}
function addTdForKey(tableId, rowKey) { return \`<td class="cell-add">+</td>\`; }
function getRowKey(row) { return row.itemId; }
function categoryLabel(c) { return c; }
function formatFocusCost(n) { return String(n); }
const CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Caerleon","Brecilien","Black Market"];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = CITIES.filter((c) => c !== "Black Market");
const FACTION_CHESTS = [];
const HEART_BY_RESOURCE = { fiber: "${HEART_ID}" };
function calculateProfitPer10kFocus(profit, focusCost) {
  return profit * Math.floor(10000 / Math.max(1, focusCost));
}
`;

  const feederRenderers = withFeederRenderers ? `
function renderMountsTable(md) {
  __spy.mountsCalls++;
  __spy.lastMountsArg = md;
  if (${mountsRendererThrows}) throw new Error("boom");
  tableState["mounts-table"].data = [${JSON.stringify(mountsRow())}];
}
function renderTransportTable(md) {
  __spy.transportCalls++;
  __spy.lastTransportArg = md;
  tableState["transport-table"].data = [${JSON.stringify(transportRow())}];
}
` : "";

  const tail = `
    module.exports = {
      renderFactionSpendingTable,
      buildFactionSpendingRows,
      _renderBreedDetailRow,
      _expandedBreedBabies,
      tableState,
      get _renderedRows() { return _renderedRows; },
      get spy() { return typeof __spy !== "undefined" ? __spy : null; },
    };`;

  globalThis.tx = globalThis.tx || ((en) => en);
  globalThis.dispName = globalThis.dispName || ((id, fallback) => fallback);
  const mod = new Module("faction-spending-fallback-test");
  mod._compile(
    stubs + (withFeederRenderers ? "const __spy = " + JSON.stringify(spyState) + ";\n" : "")
    + feederRenderers + renderSrc + focusValueSrc + tail,
    "faction-spending-fallback-sandbox.js"
  );
  return mod.exports;
}

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

/** Render through the real entry point; pair each row with its HTML. */
function render(sandbox, md) {
  sandbox.renderFactionSpendingTable(md);
  const rows = sandbox.tableState["faction-spending-table"].data;
  const htmls = sandbox._renderedRows;
  return rows.map((row, i) => ({ row, html: htmls[i] || "" }));
}

function babyRow(rendered) {
  const entry = rendered.find((e) => e.row.itemId === BABY_ID);
  assert.ok(entry, `no ${BABY_ID} row built`);
  return entry;
}

console.log("Faction Spending feeder-cache fallback tests\n");

// ─── Empty mounts cache → force-compute + toggle appears ────────────────────
{
  const sandbox = makeSandbox();
  const md = marketData();

  test("force-computes the mounts cache when it is empty", () => {
    sandbox.tableState["mounts-table"].data = [];
    sandbox.tableState["transport-table"].data = [transportRow()]; // transport already priced
    const rows = sandbox.buildFactionSpendingRows(md);
    assert.ok(rows.length > 0, "no rows built");
    assert.strictEqual(sandbox.spy.mountsCalls, 1, "renderMountsTable not called once");
    assert.strictEqual(sandbox.spy.lastMountsArg, md, "renderMountsTable called with other data");
    assert.strictEqual(sandbox.tableState["mounts-table"].data.length, 1, "mounts cache still empty");
    assert.strictEqual(sandbox.spy.transportCalls, 0, "transport is not a feeder");
  });

  test("Baby row shows a numeric S/FP (Bred) value, not a dead dash", () => {
    const { html } = babyRow(render(sandbox, md));
    assert.ok(/25\.21/.test(html), `breed ratio missing:\n${html.slice(0, 400)}`);
    assert.ok(!/Breeding only applies to Baby rows/.test(html), "generic dash cell still shown");
  });

  test("Baby row renders the expand toggle + hidden breed-inputs sub-row", () => {
    const { html } = babyRow(render(sandbox, md));
    assert.ok(new RegExp(`class="breed-toggle" data-baby-id="${BABY_ID}"`).test(html),
      "no .breed-toggle button");
    assert.ok(new RegExp(`<tr class="breed-detail-row" data-baby-id="${BABY_ID}"`).test(html),
      "no .breed-detail-row in the DOM");
    assert.ok(/display:none/.test(html), "detail row should start collapsed");
  });

  test("breed sub-row exposes editable baby / saddled / food / leather prices", () => {
    const { html } = babyRow(render(sandbox, md));
    assert.ok(new RegExp(`data-item-id="${BABY_ID}"[^>]*data-city-list="sell"`).test(html),
      "no sell-side editable baby price");
    assert.ok(new RegExp(`data-item-id="${SADDLED_ID}"[^>]*data-city-list="sell"`).test(html),
      "no sell-side editable saddled-mount price");
    assert.ok(/data-item-id="T5_MEAT"[^>]*data-city-list="buy"/.test(html), "no editable food price");
    assert.ok(/data-item-id="T5_LEATHER"[^>]*data-city-list="buy"/.test(html), "no editable leather price");
  });

  test("Baby row carries the Profit/10k Focus value from breed data", () => {
    const { row, html } = babyRow(render(sandbox, md));
    assert.ok(row.breedData, "breedData missing on baby row");
    assert.ok(row.fpFocusInfo, "no baby focus value computed");
    // fpAdjustedProfitFocusOn 12345, nurture focus 100 → 12345 × (10000/100)
    assert.strictEqual(row.fpFocusInfo.per10k, 1234500);
    assert.ok(/1,234,500/.test(html), "formatted per-10k missing in HTML");
  });
}

// ─── Populated cache → no redundant recompute ───────────────────────────────
{
  const sandbox = makeSandbox();
  sandbox.tableState["mounts-table"].data = [mountsRow()];
  sandbox.tableState["transport-table"].data = [transportRow()];
  render(sandbox, marketData());

  test("does not recompute feeders whose caches are already populated", () => {
    assert.strictEqual(sandbox.spy.mountsCalls, 0, "renderMountsTable called despite populated cache");
    assert.strictEqual(sandbox.spy.transportCalls, 0, "renderTransportTable called despite populated cache");
  });

  test("populated-cache path still renders the breed toggle", () => {
    const { html } = babyRow(render(sandbox, marketData()));
    assert.ok(new RegExp(`class="breed-toggle" data-baby-id="${BABY_ID}"`).test(html),
      "toggle missing with pre-populated cache");
  });
}

// ─── Throwing feeder renderer must not break the table ──────────────────────
{
  const sandbox = makeSandbox({ mountsRendererThrows: true });

  test("a throwing renderMountsTable leaves the table renderable", () => {
    const rendered = render(sandbox, marketData());
    assert.ok(rendered.length > 0, "no rows rendered after feeder renderer threw");
    const { html } = babyRow(rendered);
    assert.ok(!/class="breed-toggle"/.test(html), "toggle shown without breed data");
    assert.ok(/Breeding only applies to Baby rows/.test(html),
      "expected the plain dash fallback cell");
  });
}

// ─── Hearts: no Profit/10k Focus, no transport recompute ────────────────────
// The user (2026-10-04): "treeheart should NOT have profit/10k focus". A heart
// row renders the dash, and the Refining table is no longer a feeder.
{
  const sandbox = makeSandbox();
  sandbox.tableState["mounts-table"].data = [mountsRow()];
  sandbox.tableState["transport-table"].data = [];

  test("heart row has no Profit/10k Focus and the transport cache is left alone", () => {
    const rendered = render(sandbox, marketData());
    assert.strictEqual(sandbox.spy.transportCalls, 0, "renderTransportTable should not be called");
    const heart = rendered.find((e) => e.row.itemId === HEART_ID);
    assert.ok(heart, "no heart row built");
    assert.strictEqual(heart.row.fpFocusInfo, null, "heart should carry no focus value");
    assert.strictEqual(heart.row.fpFocusPer10k, 0);
    assert.ok(/No focus-consuming use path for this item">—<\/td>\s*<\/tr>/.test(heart.html),
      `heart Profit / 10k Focus cell is not a dash:\n${heart.html.slice(-300)}`);
  });
}

// ─── Legacy sandbox: no feeder renderers defined at all ─────────────────────
{
  const sandbox = makeSandbox({ withFeederRenderers: false });

  test("builds rows without feeder renderers (legacy stubs)", () => {
    const rendered = render(sandbox, marketData());
    assert.ok(rendered.length > 0, "no rows rendered");
    const { html } = babyRow(rendered);
    assert.ok(!/class="breed-toggle"/.test(html), "unexpected toggle without a mounts source");
  });
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
