/**
 * Black-box tests for the per-table "Reset filters" button (js/table-filters.js)
 * and for search-box coverage across index.html.
 *
 * The feature: each table header ends with TWO reset controls that must not be
 * confused with each other —
 *   ✕ Reset filters  → empties the search box + every "All"-able picker in that
 *                      header. Touches no stored data.
 *   ↺ Clear overrides → deletes hand-typed prices/volumes/pinned cities
 *                      (js/table-overrides.js), and is not injected at all on
 *                      tables that price nothing.
 *
 * Pickers injected by this app are reset silently and the caller's onChange runs
 * ONCE; hand-written headers pickers (Rerolling transition, Faction Spending
 * faction) own their own listeners, so they get a real `change` event instead.
 *
 * Run: node tests/table-filter-reset.test.cjs
 */

const assert = require("assert");
const path = require("path");

const { resetTableFilters, clearFiltersButtonId } = require("../js/table-filters.js");
const { SEARCHABLE_TABLES, NO_OVERRIDE_TABLES } = require("../js/table-search.js");
const { readIndexHtml } = require("./helpers/page-source.cjs");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL: ${name} — ${e.message}`);
  }
}

// ── fake DOM ─────────────────────────────────────────────────────────────────
// A <select> needs options, a value, a class check and dispatchEvent; the <h2>
// only has to hand back the selects inside it.
function makeSelect({ value = "", ours = true, hasAll = true } = {}) {
  const sel = {
    value,
    options: hasAll ? [{ value: "" }, { value: "x" }] : [{ value: "a" }, { value: "b" }],
    classList: { contains: (c) => ours && c === "table-filter-select" },
    events: [],
    dispatchEvent(e) {
      sel.events.push(e.type);
      return true;
    },
  };
  return sel;
}

function makeHeader(selects) {
  const input = { value: "" };
  input.parentNode = { querySelectorAll: (q) => (q === "select" ? selects : []) };
  return input;
}

// ── resetting ────────────────────────────────────────────────────────────────

test("empties the search box", () => {
  const input = makeHeader([]);
  input.value = "relic t5";
  resetTableFilters(input, () => {});
  assert.strictEqual(input.value, "");
});

test("puts every injected picker back to All, silently, with ONE onChange", () => {
  const tier = makeSelect({ value: "6" });
  const city = makeSelect({ value: "Martlock" });
  const input = makeHeader([tier, city]);
  let changes = 0;
  resetTableFilters(input, () => changes++);
  assert.strictEqual(tier.value, "");
  assert.strictEqual(city.value, "");
  assert.deepStrictEqual(tier.events, [], "injected pickers must not fire change");
  assert.deepStrictEqual(city.events, []);
  assert.strictEqual(changes, 1, "one re-render, not one per picker");
});

test("hand-written pickers get a real change event (they own their listeners)", () => {
  const quality = makeSelect({ value: "Good→Outstanding", ours: false });
  const input = makeHeader([quality]);
  resetTableFilters(input, () => {});
  assert.strictEqual(quality.value, "");
  assert.deepStrictEqual(quality.events, ["change"]);
});

test("a select with no All option is left alone", () => {
  const mode = makeSelect({ value: "a", ours: false, hasAll: false });
  const input = makeHeader([mode]);
  resetTableFilters(input, () => {});
  assert.strictEqual(mode.value, "a", "a data selector is not a filter");
  assert.deepStrictEqual(mode.events, []);
});

test("an already-cleared picker fires nothing", () => {
  const faction = makeSelect({ value: "", ours: false });
  const input = makeHeader([faction]);
  resetTableFilters(input, () => {});
  assert.deepStrictEqual(faction.events, []);
});

test("still runs onChange when the header holds no pickers at all", () => {
  const input = makeHeader([]);
  let changes = 0;
  resetTableFilters(input, () => changes++);
  assert.strictEqual(changes, 1);
});

test("button id is namespaced per table", () => {
  assert.strictEqual(clearFiltersButtonId("rolling-table"), "clear-filters-rolling-table");
  assert.notStrictEqual(clearFiltersButtonId("a"), clearFiltersButtonId("b"));
});

// ── coverage: every search box in index.html is actually wired ───────────────
// #search-roads-zones-table sat in the markup for a while with nothing listening
// to it — the box looked live and typing did nothing until the next re-render.

const INDEX = readIndexHtml();

function searchInputTables() {
  return Array.from(INDEX.matchAll(/id="search-([a-z0-9-]+)"/g)).map((m) => m[1]);
}

function dataTableIds() {
  return Array.from(INDEX.matchAll(/<table id="([a-z0-9-]+)" class="data-table/g)).map((m) => m[1]);
}

// My Crafting List is wired by js/craft-list-filter.js instead: its rows live
// inside per-source INNER tables, and the generic pass reads the OUTER tbody, so
// it would hide whole groups rather than the rows in them. It is still a wired
// box — just not by this module — so it is named here rather than silently
// tolerated by a looser assertion.
const SEARCH_BOXES_WIRED_ELSEWHERE = ["craft-list-table"];

test("every search-<table> input in index.html is in SEARCHABLE_TABLES", () => {
  const missing = searchInputTables().filter(
    (id) => !SEARCHABLE_TABLES.includes(id) && !SEARCH_BOXES_WIRED_ELSEWHERE.includes(id),
  );
  assert.deepStrictEqual(missing, [], `unwired search boxes: ${missing.join(", ")}`);
});

test("the crafting list's box is wired by its own module", () => {
  const CLF = require(path.join(__dirname, "..", "js", "craft-list-filter.js"));
  SEARCH_BOXES_WIRED_ELSEWHERE.forEach((id) => {
    assert.strictEqual(CLF.TABLE_ID, id, `${id} has no module claiming it`);
    assert.strictEqual(CLF.INPUT_ID, "search-" + id);
    assert.strictEqual(typeof CLF.applyCraftListFilter, "function");
  });
  assert.ok(/src="js\/craft-list-filter\.js"/.test(INDEX),
    "js/craft-list-filter.js is not loaded in index.html");
});

test("every SEARCHABLE_TABLES entry has an input in index.html", () => {
  const inputs = new Set(searchInputTables());
  const orphans = SEARCHABLE_TABLES.filter((id) => !inputs.has(id));
  assert.deepStrictEqual(orphans, [], `no search box rendered for: ${orphans.join(", ")}`);
});

test("every scanned data table has a search box (volume keeps its own)", () => {
  // fc-saved-table is the flipping calculator's saved-trades list, not a scanned
  // market table: it has its own Clear All and never renders catalog rows. The
  // two craft-list tables are the same shape — the user's own short list of
  // picked rows, with a Clear List button and no catalog to filter.
  const exempt = new Set([
    "volume-table", "fc-saved-table", "craft-list-table", "craft-list-mats-table",
  ]);
  const inputs = new Set(searchInputTables());
  const missing = dataTableIds().filter((id) => !exempt.has(id) && !inputs.has(id));
  assert.deepStrictEqual(missing, [], `tables with no search box: ${missing.join(", ")}`);
});

test("the volume table keeps its own object-level search box", () => {
  assert.ok(INDEX.includes('id="volume-search"'));
  assert.ok(!SEARCHABLE_TABLES.includes("volume-table"), "volume must stay object-filtered");
});

// ── coverage: the Clear overrides button ────────────────────────────────────

test("Artifact Rolling gets both buttons (it prices fragments and artifacts)", () => {
  assert.ok(SEARCHABLE_TABLES.includes("rolling-table"));
  assert.ok(!NO_OVERRIDE_TABLES.has("rolling-table"));
});

test("reference and Roads tables get no Clear overrides button", () => {
  ["city-bonuses-table", "black-zone-bonuses-table", "black-zone-locations-table",
   "brecilien-fees-table", "roads-zones-table", "roads-portals-table"].forEach((id) => {
    assert.ok(NO_OVERRIDE_TABLES.has(id), `${id} prices nothing, button would be dead`);
  });
});

test("every priced table still gets a Clear overrides button", () => {
  const priced = SEARCHABLE_TABLES.filter((id) => !NO_OVERRIDE_TABLES.has(id));
  ["crafting-table", "flipping-table", "rolling-table", "rerolling-table",
   "transport-table", "faction-spending-table"].forEach((id) => {
    assert.ok(priced.includes(id), `${id} lost its Clear overrides button`);
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
