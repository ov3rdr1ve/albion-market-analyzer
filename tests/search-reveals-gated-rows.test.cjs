/**
 * Black-box tests for js/table-search-reveal.js — the rule that lets a typed
 * search query REVEAL rows the profitability gate would otherwise drop.
 *
 * The feature: applyTableSearchFilter (js/table-search.js) runs after the render
 * and can only hide painted rows, so a row updateTableDisplay filtered out is
 * unreachable by search. js/sorting.js therefore reads the query BEFORE it
 * gates, and keeps any row whose own IDENTITY (row key + item id + item name +
 * display name) matches every term. That is what brings the unpriced
 * "Master's <Faction> Cape [T6]" rows back onto the Crafting Planner.
 *
 * Pure input->output: a tiny fake `document`, no DOM, no network, no prices.
 *
 * Run: node tests/search-reveals-gated-rows.test.cjs
 */

const assert = require("assert");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

// ── fake DOM: only getElementById("search-<tableId>") is ever consulted ───────
function mountSearchBoxes(boxes) {
  global.document = {
    getElementById: (id) =>
      Object.prototype.hasOwnProperty.call(boxes, id) ? { value: boxes[id] } : null,
  };
}
mountSearchBoxes({});

// The module reads getRowKey / getItemDisplayName as optional globals, exactly
// the way it does in the browser. Supply the real row-key helper and a display
// name map that knows an id the catalogue name does NOT spell out, so the test
// can tell the two haystack sources apart.
global.getRowKey = require("../js/sorting-row-key.js").getRowKey;
global.getItemDisplayName = (id) =>
  id === "T6_CAPEITEM_KEEPER" ? "Master's Keeper Cape [T6]" : id;

const { tableSearchTerms, rowRevealedBySearch } = require("../js/table-search-reveal.js");

console.log("Search Reveals Gated Rows Tests\n");

// ── tableSearchTerms ─────────────────────────────────────────────────────────

const TERM_CASES = [
  { name: "no search box for the table", boxes: {}, tableId: "craft-planner-table", expect: [] },
  { name: "empty box", boxes: { "search-craft-planner-table": "" }, tableId: "craft-planner-table", expect: [] },
  { name: "whitespace-only box", boxes: { "search-craft-planner-table": "   " }, tableId: "craft-planner-table", expect: [] },
  {
    name: "padded, mixed-case, multi-space query splits + lowercases",
    boxes: { "search-craft-planner-table": "  Master's   Cape " },
    tableId: "craft-planner-table",
    expect: ["master's", "cape"],
  },
  {
    name: "single term",
    boxes: { "search-crafting-table": "planks" },
    tableId: "crafting-table",
    expect: ["planks"],
  },
  {
    name: "volume-table keeps its own object filter — never reveals",
    boxes: { "search-volume-table": "cape" },
    tableId: "volume-table",
    expect: [],
  },
  { name: "no tableId", boxes: { "search-craft-planner-table": "cape" }, tableId: null, expect: [] },
];

TERM_CASES.forEach(({ name, boxes, tableId, expect }) => {
  test(`tableSearchTerms — ${name}`, () => {
    mountSearchBoxes(boxes);
    assert.deepStrictEqual(tableSearchTerms(tableId), expect);
  });
});

test("tableSearchTerms — no document at all", () => {
  const saved = global.document;
  delete global.document;
  try {
    assert.deepStrictEqual(tableSearchTerms("craft-planner-table"), []);
  } finally {
    global.document = saved;
  }
});

// ── rowRevealedBySearch ──────────────────────────────────────────────────────

const plainCape = { item: { id: "T6_CAPE", name: "Master's Cape [T6]" }, combinedProfit: -4200 };
const bridgewatchCape = { item: { id: "T6_CAPEITEM_FW_BRIDGEWATCH", name: "Master's Bridgewatch Cape [T6]" }, noData: true };
const adeptCape = { item: { id: "T4_CAPEITEM_FW_BRIDGEWATCH", name: "Adept's Bridgewatch Cape [T4]" }, noData: true };
const avalonCape = { item: { id: "T6_CAPEITEM_AVALON", name: "Master's Avalonian Cape [T6]" }, combinedProfit: 62649 };
// Name absent from the catalogue entry — only getItemDisplayName knows it.
const keeperCape = { item: { id: "T6_CAPEITEM_KEEPER" }, noData: true };

const REVEAL_CASES = [
  { name: "no terms reveals nothing (gate unchanged when nobody typed)", row: plainCape, terms: [], expect: false },
  { name: "plain cape matches its own name", row: plainCape, terms: ["master's", "cape"], expect: true },
  { name: "unpriced faction cape matches (AND of terms, not substring)", row: bridgewatchCape, terms: ["master's", "cape"], expect: true },
  { name: "wrong tier does not match", row: adeptCape, terms: ["master's", "cape"], expect: false },
  { name: "profitable row still matches", row: avalonCape, terms: ["master's", "cape"], expect: true },
  { name: "id-only query matches", row: avalonCape, terms: ["t6_capeitem_avalon"], expect: true },
  { name: "display name fills in for a row with no catalogue name", row: keeperCape, terms: ["keeper", "cape"], expect: true },
  { name: "one term missing fails the whole query", row: avalonCape, terms: ["master's", "bridgewatch"], expect: false },
  { name: "unrelated query", row: plainCape, terms: ["soldier", "armor"], expect: false },
  { name: "null row", row: null, terms: ["cape"], expect: false },
  { name: "row with no item", row: { noData: true }, terms: ["cape"], expect: false },
  { name: "terms not an array", row: plainCape, terms: "cape", expect: false },
];

REVEAL_CASES.forEach(({ name, row, terms, expect }) => {
  test(`rowRevealedBySearch — ${name}`, () => {
    assert.strictEqual(rowRevealedBySearch(row, "craft-planner-table", terms), expect);
  });
});

test("rowRevealedBySearch — a match that exists only in the recipe is NOT revealed", () => {
  // The DOM pass (rowMatches, js/table-search.js) matches rendered recipe text
  // and is therefore a superset; the reveal reads identity only, so a row whose
  // materials happen to mention the query is not resurrected wholesale.
  const soldierArmor = { item: { id: "T8_ARMOR_PLATE_SET1", name: "Soldier Armor [T8]" }, noData: true };
  assert.strictEqual(rowRevealedBySearch(soldierArmor, "craft-planner-table", ["master's", "cape"]), false);
});

// ── the gate as js/sorting.js composes it ────────────────────────────────────
// Mirrors the craft-planner clause of updateTableDisplay: reveal first, then the
// normal "priced and profitable" rule.

function plannerGate(rows, { showAll = false, terms = [] } = {}) {
  return showAll
    ? rows.slice()
    : rows.filter(
        (row) =>
          rowRevealedBySearch(row, "craft-planner-table", terms) ||
          (!row.noData && row.combinedProfit >= 0),
      );
}

const BOARD = [plainCape, bridgewatchCape, adeptCape, avalonCape, keeperCape];

test("gate — no query keeps only the priced, profitable cape", () => {
  assert.deepStrictEqual(plannerGate(BOARD).map((r) => r.item.id), ["T6_CAPEITEM_AVALON"]);
});

test("gate — a matching query brings back the no-data and loss-making capes", () => {
  const ids = plannerGate(BOARD, { terms: ["master's", "cape"] }).map((r) => r.item.id);
  assert.deepStrictEqual(ids, [
    "T6_CAPE",
    "T6_CAPEITEM_FW_BRIDGEWATCH",
    "T6_CAPEITEM_AVALON",
    "T6_CAPEITEM_KEEPER",
  ]);
});

test("gate — a non-matching no-data row stays dropped under a query", () => {
  const ids = plannerGate(BOARD, { terms: ["avalonian"] }).map((r) => r.item.id);
  assert.deepStrictEqual(ids, ["T6_CAPEITEM_AVALON"]);
});

test("gate — Show All is unaffected by the query", () => {
  assert.strictEqual(plannerGate(BOARD, { showAll: true, terms: ["master's", "cape"] }).length, BOARD.length);
  assert.strictEqual(plannerGate(BOARD, { showAll: true }).length, BOARD.length);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
