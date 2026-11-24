/**
 * Test: an unpriced mount craft still renders, with editable price cells.
 *
 * Bug: when a material had no listing at any city the craft city could reach,
 * renderMountsTable fell back to a bare `{ marginInfo: { margin: -1 } }`
 * sentinel — no `item` on it. The row formatter opens with
 * `if (!row.item) return ""`, so the row was not merely dashed out, it was
 * ABSENT: an unpriced mount craft could not be seen even under "Show All
 * Items", and there was nothing left on screen to click to supply the missing
 * price. Every other unpriced row in the app keeps its cells click-to-edit
 * (js/app.js priceTd / matPriceSpan), and the mounts table's own breeding rows
 * already did exactly that (breedingRowFor's placeholder-city fallback).
 *
 * Black-box: drive the real renderMountsTable over synthetic market data with
 * one input deliberately unlisted, then read the row object and its HTML.
 *
 * Run: node tests/mounts-unpriced-craft-row.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const stubs = `
const _els = {};
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const window = { addEventListener: () => {} };
const tableState = { "mounts-table": { data: [] }, "faction-spending-table": { data: [] } };
function renderTableData(id, rows, fmt) {
  tableState[id].data = rows;
  tableState[id].html = rows.map((r, i) => { try { return fmt(r, i); } catch (e) { return "ERR:" + e.message; } });
}
function priceTd(p, itemId, city) {
  const body = p > 0 ? String(p) : "no data — click to set";
  return '<td class="cell-num price-editable" data-item-id="' + itemId
    + '" data-city="' + city + '" data-city-list="sell">' + body + '</td>';
}
function aggregateCostTd(cost, extraClass) {
  return '<td class="' + (extraClass || "") + '">' + (cost > 0 ? cost : "—") + '</td>';
}
function volTd(){ return "<td></td>"; }
function profitTd(){ return "<td></td>"; }
function pureProfitTd(){ return "<td></td>"; }
function matPriceSpan(id, c, p) {
  return '<span class="price-editable mat-price-inline" data-item-id="' + id
    + '" data-city="' + (c || "") + '" data-city-list="buy">@ '
    + (p > 0 ? p : "no data") + ' ea</span>';
}
function getProfitClass(){ return ""; }
function getRowKey(row) { return ((row.item && row.item.id) || "?") + "|" + (row.section || ""); }
function addTdForKey() { return '<td class="cell-add"><button></button></td>'; }
function dispName(id, name) { return name || id; }
function tx(en) { return en; }
function brecilienFeeBadge() { return ""; }
function focusPlayCell() { return "<td></td>"; }
function formatSilver(n) { return String(n); }
function formatFocusCost(n) { return String(n); }
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
  J("travel-cost.js") +
  J("mp-bonus.js") +
  (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) +
  J("rrr-eligible.js") + J("render-mounts.js") + J("render-mounts-breeding-row.js")
  + J("render-mounts-craft-row.js");

const mod = new Module("mounts-unpriced-craft-row");
mod._compile(
  stubs + sources + "\nmodule.exports = { tableState, renderMountsTable, _els };",
  "mounts-unpriced-craft-row.js",
);
const X = mod.exports;

const entry = (buy, sell, vol) => ({ buy_price: buy, sell_price: sell, volume_24h: vol });

// Riding Horse T8 = 1x T8_FARM_HORSE_GROWN + 20x T8_LEATHER → T8_MOUNT_HORSE.
// `omit` names the input nobody has listed — the blocker that collapses the row.
function render(omit) {
  const md = {};
  const put = (id, c, b, s, v) => { (md[id] = md[id] || {})[c] = entry(b, s, v); };
  if (omit !== "T8_FARM_HORSE_GROWN") put("T8_FARM_HORSE_GROWN", "Lymhurst", 100000, 110000, 1000);
  if (omit !== "T8_LEATHER") put("T8_LEATHER", "Lymhurst", 9000, 9500, 1000);
  if (omit !== "T8_MOUNT_HORSE") put("T8_MOUNT_HORSE", "Lymhurst", 380000, 420000, 1000);
  X.renderMountsTable(md);
  return md;
}

const rowAt = () => {
  const rows = X.tableState["mounts-table"].data;
  const idx = rows.findIndex(
    (r) => r.item && r.item.id === "T8_MOUNT_HORSE" && r.isCraft && r.section === "royal",
  );
  return { row: rows[idx], html: idx >= 0 ? X.tableState["mounts-table"].html[idx] : null };
};

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name + " — " + e.message); failed++; }
}

console.log("Mounts — unpriced craft rows stay visible and editable\n");

// Parameterized over which single input is missing: the row must survive in
// every case, because every case is a price the user might want to type in.
const BLOCKERS = ["T8_FARM_HORSE_GROWN", "T8_LEATHER"];

BLOCKERS.forEach((omit) => {
  test("row survives when " + omit + " has no listing", () => {
    render(omit);
    const { row } = rowAt();
    assert.ok(row, "the craft row vanished entirely");
    assert.strictEqual(row.marginInfo.margin, -1, "row should be flagged as unpriced");
    assert.strictEqual(row.noData, true, "row should carry the noData flag");
  });

  test("its HTML is a real row, not an empty string (" + omit + ")", () => {
    render(omit);
    const { html } = rowAt();
    assert.ok(html && html.indexOf("<tr") === 0 || (html || "").trim().startsWith("<tr"),
      "expected a <tr>, got: " + String(html).slice(0, 80));
    assert.ok(!String(html).startsWith("ERR:"), "formatter threw: " + html);
  });

  test("the sell price cell is click-to-edit (" + omit + ")", () => {
    render(omit);
    const { html } = rowAt();
    assert.ok(/data-item-id="T8_MOUNT_HORSE"/.test(html), "no editable sell cell");
    assert.ok(/price-editable/.test(html), "sell cell is not editable");
  });

  test("every material keeps an editable span (" + omit + ")", () => {
    render(omit);
    const { html } = rowAt();
    assert.ok(/data-item-id="T8_FARM_HORSE_GROWN"/.test(html), "grown horse span missing");
    assert.ok(/data-item-id="T8_LEATHER"/.test(html), "leather span missing");
  });

  test("the input that IS priced still shows its price (" + omit + ")", () => {
    render(omit);
    const { html } = rowAt();
    const priced = omit === "T8_LEATHER" ? "100000" : "9000";
    assert.ok(html.includes("@ " + priced + " ea"),
      "the priceable input lost its price; row: " + html.slice(0, 300));
  });
});

test("the unpriced material's span names a city too", () => {
  // It priced nowhere, so its own city is null — but the editor still has to
  // open somewhere, and the craft city is where you would be standing.
  render("T8_LEATHER");
  const { html } = rowAt();
  const m = html.match(/data-item-id="T8_LEATHER"\s+data-city="([^"]*)"/);
  assert.ok(m, "leather span missing");
  assert.ok(m[1] && m[1] !== "null" && m[1] !== "undefined",
    'the blocker opens the editor on no city: "' + (m && m[1]) + '"');
});

test("the sell cell names a real city, never null", () => {
  render("T8_LEATHER");
  const { html } = rowAt();
  const m = html.match(/data-item-id="T8_MOUNT_HORSE"\s+data-city="([^"]*)"/);
  assert.ok(m, "sell cell missing");
  assert.ok(m[1] && m[1] !== "null" && m[1] !== "undefined", 'bad sell city "' + (m && m[1]) + '"');
});

test("an unpriced OUTPUT keeps the row too, with the sell cell to fill in", () => {
  // The second way a mount loses its route: every input prices, but nobody has
  // listed the mount itself, so no sell city clears the loop. That dropped the
  // row just as silently as a missing input did — and the cell the user needs
  // is precisely the sell price.
  render("T8_MOUNT_HORSE");
  const { row, html } = rowAt();
  assert.ok(row, "row vanished");
  assert.strictEqual(row.noData, true, "row should be flagged as unpriced");
  assert.ok(/data-item-id="T8_MOUNT_HORSE"/.test(html), "sell cell not editable");
  assert.ok(html.includes("click to set"), "sell cell does not invite an edit");
  // The inputs DID price, and say so.
  assert.ok(html.includes("@ 100000 ea"), "grown horse lost its price");
  assert.ok(html.includes("@ 9000 ea"), "leather lost its price");
});

test("a fully priced mount is untouched by the no-data path", () => {
  render(null);
  const { row } = rowAt();
  assert.ok(row, "row vanished");
  assert.ok(!row.noData, "a priced row must not be flagged noData");
  assert.ok(row.marginInfo.margin !== -1, "a priced row must have a real margin");
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
