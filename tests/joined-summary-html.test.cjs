/**
 * Top-10 boards — HTML formatter tests.
 *
 * formatJoinedRow (profit board, 10 columns) and formatJoinedFocusRow (focus
 * board, 11) each take a normalized board row and return a <tr> string. Tests
 * verify column count, special cell formatting (FP-gated input, vol-unknown
 * annotation, italic "—" for null margin), which cell carries the ranking
 * metric in bold, the category badge class, and the Jump-to anchor.
 *
 * Run: node tests/joined-summary-html.test.cjs
 */

const assert = require("assert");
const path = require("path");

// Badge text runs through tx(english, slug); en-mode identity keeps assertions in English.
globalThis.tx = globalThis.tx || ((en) => en);

// Stub browser-side helpers the formatter calls.
globalThis.formatSilver = function (n) {
  if (n === null || n === undefined) return "N/A";
  return Math.round(n).toLocaleString();
};
globalThis.getProfitClass = function (margin) {
  if (margin >= 20) return "profit-high";
  if (margin >= 10) return "profit-medium";
  if (margin > 0)   return "profit-low";
  return "profit-negative";
};
globalThis.getRowKey = function (row, tableId) {
  return `${tableId}|stub`;
};
globalThis.formatFocusCost = function (n) {
  return Math.round(n || 0).toLocaleString();
};
// The price cells go through the app-wide builders (js/app.js). Both emit ONE
// <td>, so the column counts below are unaffected by which branch is taken —
// but stubbing them is what makes those counts a real assertion rather than an
// accident of `typeof priceTd !== "function"` falling back to a plain cell.
globalThis.priceTd = function (price, itemId, city, side) {
  return `<td class="silver-val price-editable" data-item-id="${itemId}" data-city="${city}" data-city-list="${side}">${globalThis.formatSilver(price)}</td>`;
};
globalThis.aggregateCostTd = function (cost) {
  return `<td class="silver-val">${globalThis.formatSilver(cost)}</td>`;
};

const mod = require(path.join(__dirname, "..", "js", "render-joined-summary.js"));
const { formatJoinedRow, formatJoinedFocusRow } = mod;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// Counts every <td> in the returned string. The 10 / 11 assertions below hold
// only because a board row's detail panel is COLLAPSED by default — expanded, it
// appends a second <tr> with its own <td> (tests/joined-summary-detail-row).
function tdCount(html) {
  return (html.match(/<td/gi) || []).length;
}

const baseRow = {
  category: "Flipping",
  tableId: "flipping-table",
  itemName: "Adept's Sword [T4]",
  buyCity: "Lymhurst", sellCity: "Martlock",
  routeLabel: "Lymhurst -> Martlock",
  inputCost: 1000, sellPrice: 2000,
  marginPct: 80, pureProfit: 800, dailyVol: 50,
  volIsUnknown: false, throughput: 40000,
  note: "", rowKey: "flipping-table|stub", hasOverride: false,
};

const focusRow = {
  category: "Crafting",
  tableId: "crafting-table",
  itemName: "Grandmaster's Bag",
  buyCity: "Lymhurst", sellCity: "Martlock",
  routeLabel: "Craft: Lymhurst -> Sell: Martlock",
  inputCost: 100000, sellPrice: 160000,
  marginPct: 45, pureProfit: 45000, dailyVol: 120,
  volIsUnknown: false, throughput: 5400000,
  focusCost: 500, profitPer10kFocus: 900000,
  note: "", rowKey: "crafting-table|stub", hasOverride: false,
};

console.log("\n=== formatJoinedRow column structure ===");

test("emits a <tr> with all 10 columns", () => {
  const html = formatJoinedRow(baseRow, 0);
  assert.ok(/^\s*<tr/.test(html), "row must open with <tr>");
  assert.strictEqual(tdCount(html), 10, `expected 10 <td>, got ${tdCount(html)}`);
});

test("category badge has cat-{tableId} class", () => {
  const html = formatJoinedRow(baseRow, 0);
  assert.ok(html.includes("cat-flipping-table"), "missing per-table badge class");
});

// The board is ranked by pure profit now, so that is the cell the eye should
// land on — throughput stays as a plain informational column beside it.
test("pure profit is the bold cell, not throughput", () => {
  const html = formatJoinedRow(baseRow, 0);
  assert.ok(/<b>[^<]*800[^<]*<\/b>/.test(html), "pure profit should be wrapped in <b>");
  assert.ok(!/<b>[^<]*40,000[^<]*<\/b>/.test(html), "throughput must not be the bold cell");
});

test("throughput is still shown", () => {
  assert.ok(formatJoinedRow(baseRow, 0).includes("40,000"));
});

test("Jump anchor includes data-target-table and data-row-key", () => {
  const html = formatJoinedRow(baseRow, 0);
  assert.ok(html.includes('data-target-table="flipping-table"'));
  assert.ok(html.includes('data-row-key="flipping-table|stub"'));
  assert.ok(html.includes('class="joined-jump"'));
});

// A board row is COLLECTED from one table and may be best READ in another. The
// destination is the row's own field, so a feeder can send its rows somewhere
// more useful than the table it was ranked out of.
test("Jump follows the row's own destination when it names one", () => {
  const row = {
    ...baseRow,
    sellItemId: "T8_2H_AXE",
    jumpTableId: "craft-planner-table",
    jumpRowKey: "",
    jumpFallbackTableId: "crafting-table",
  };
  const html = formatJoinedRow(row, 0);
  assert.ok(html.includes('data-target-table="craft-planner-table"'));
  assert.ok(html.includes('data-fallback-table="crafting-table"'));
  assert.ok(html.includes('data-row-key=""'), "the planner keys rows differently — id only");
  assert.ok(html.includes('data-item-id="T8_2H_AXE"'), "the item id is the match");
});

test("a row with no destination of its own keeps the feeder's table and no fallback", () => {
  const html = formatJoinedRow(baseRow, 0);
  assert.ok(!html.includes("data-fallback-table"));
});

console.log("\n=== Special-case cell formatting ===");

test("null marginPct renders as italic em-dash", () => {
  const row = { ...baseRow, marginPct: null };
  const html = formatJoinedRow(row, 0);
  assert.ok(html.includes("—"), "must include em-dash");
  assert.ok(/font-style:\s*italic/.test(html), "em-dash should be italic");
});

test("FP-gated input cost (0 + note) renders as italic (FP)", () => {
  const row = {
    ...baseRow, inputCost: 0, note: "FP-gated", buyCity: "", marginPct: null,
    category: "Faction Spending", tableId: "faction-spending-table",
  };
  const html = formatJoinedRow(row, 0);
  assert.ok(html.includes("(FP)"), "FP-gated rows should show (FP) in input cell");
});

test("Favor-gated input cost (0 + note) renders as italic (Favor), not (FP)", () => {
  const row = {
    ...baseRow, inputCost: 0, note: "Favor-gated", buyCity: "", marginPct: null,
    category: "Faction Spending", tableId: "faction-spending-table",
  };
  const html = formatJoinedRow(row, 0);
  assert.ok(html.includes("(Favor)"), "Favor rows should show (Favor) in input cell");
  assert.ok(!html.includes("(FP)"), "Favor is a different currency from Faction Points");
});

test("Energy Mount row renders its aggregate input cost, not (FP)", () => {
  const row = {
    ...baseRow, inputCost: 40326531, note: "energy + mount + mats", buyCity: "",
    marginPct: null, pureProfit: 1500000, throughput: 4500000,
    category: "Faction Spending", tableId: "faction-spending-table",
  };
  const html = formatJoinedRow(row, 0);
  assert.ok(html.includes("40,326,531"), "the all-in cost (base + mats + energy) must show");
  assert.ok(!html.includes("(FP)"), "this row has real silver inputs — not FP-gated");
});

test("volIsUnknown adds 'vol unknown' annotation to throughput cell", () => {
  const row = {
    ...baseRow, volIsUnknown: true, note: "vol unknown",
    category: "Artifact Rolling", tableId: "rolling-table",
    dailyVol: 0,
  };
  const html = formatJoinedRow(row, 0);
  assert.ok(html.includes("vol unknown"), "annotation must appear");
});

test("volIsUnknown=true renders vol cell as italic em-dash", () => {
  const row = { ...baseRow, volIsUnknown: true, dailyVol: 0, note: "vol unknown" };
  const html = formatJoinedRow(row, 0);
  // The vol cell is the 9th td; its content should be em-dash when unknown.
  const tds = html.match(/<td[^>]*>[\s\S]*?<\/td>/g);
  assert.ok(tds && tds.length >= 9, "should have at least 9 td matches");
  // Find a td that contains the em-dash and italic styling — the vol cell.
  const hasItalicDash = tds.some(td => td.includes("—") && /font-style:\s*italic/.test(td));
  assert.ok(hasItalicDash, "vol cell should be italic em-dash when volIsUnknown");
});

test("Laborers per-cycle row shows note in throughput tooltip", () => {
  const row = {
    ...baseRow, volIsUnknown: true, note: "per cycle",
    category: "Laborers", tableId: "laborers-table",
    dailyVol: 1, throughput: 15000,
  };
  const html = formatJoinedRow(row, 0);
  assert.ok(html.includes("per cycle"));
});

test("Profit class colors apply based on marginPct", () => {
  const high = formatJoinedRow({ ...baseRow, marginPct: 50 }, 0);
  assert.ok(high.includes("profit-high"));
  const med = formatJoinedRow({ ...baseRow, marginPct: 15 }, 0);
  assert.ok(med.includes("profit-medium"));
  const low = formatJoinedRow({ ...baseRow, marginPct: 5 }, 0);
  assert.ok(low.includes("profit-low"));
});

console.log("\n=== formatJoinedFocusRow ===");

test("emits a <tr> with all 11 columns", () => {
  const html = formatJoinedFocusRow(focusRow, 0);
  assert.ok(/^\s*<tr/.test(html), "row must open with <tr>");
  assert.strictEqual(tdCount(html), 11, `expected 11 <td>, got ${tdCount(html)}`);
});

test("carries the focus cost and the per-10k figure", () => {
  const html = formatJoinedFocusRow(focusRow, 0);
  assert.ok(html.includes("500"), "focus cost cell missing");
  assert.ok(html.includes("900,000"), "profit / 10k focus cell missing");
});

test("profit / 10k focus is the bold cell — it is the ranking metric", () => {
  const html = formatJoinedFocusRow(focusRow, 0);
  assert.ok(/<b>[^<]*900,000[^<]*<\/b>/.test(html));
});

test("the focus board carries no throughput column", () => {
  assert.ok(!formatJoinedFocusRow(focusRow, 0).includes("5,400,000"));
});

// The tooltip has to say where the number came from: 45,000 per craft × the 20
// crafts a 10,000-focus bar buys at 500 focus each.
test("the per-10k cell explains its own arithmetic", () => {
  const html = formatJoinedFocusRow(focusRow, 0);
  assert.ok(html.includes("45,000"), "per-play profit missing from the tooltip");
  assert.ok(html.includes("20 plays"), "play count missing from the tooltip");
});

test("badge, jump anchor and profit class work the same as the profit board", () => {
  const html = formatJoinedFocusRow(focusRow, 0);
  assert.ok(html.includes("cat-crafting-table"));
  assert.ok(html.includes('data-target-table="crafting-table"'));
  assert.ok(html.includes('data-row-key="crafting-table|stub"'));
  assert.ok(html.includes("profit-high"));
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
