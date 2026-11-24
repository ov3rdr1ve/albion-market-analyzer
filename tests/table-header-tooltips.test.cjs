/**
 * Every column header of an add-capable table explains itself.
 *
 * A table with the "+" column can be sent to My Crafting List, and the list
 * CLONES those headers — tooltip included (js/render-craft-list-header.js). So a
 * header with no `title` is a column that explains itself nowhere: not in its
 * own table, and not in the list. 90 of them were in exactly that state.
 *
 * The guard is deliberately narrow: it covers the tables the list can pull
 * from, not every table in the app.
 *
 * Run: node tests/table-header-tooltips.test.cjs
 */
const assert = require("assert");
const { readIndexHtml } = require("./helpers/page-source.cjs");

const html = readIndexHtml();

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

/** The <thead> markup of one table, by id. */
function theadOf(tableId) {
  const at = html.indexOf(`<table id="${tableId}"`);
  assert.notStrictEqual(at, -1, `no table #${tableId} in index.html`);
  const end = html.indexOf("</thead>", at);
  assert.notStrictEqual(end, -1, `#${tableId} has no <thead>`);
  return html.slice(at, end);
}

/** Every header cell of a table as { label, tag }. */
function headersOf(tableId) {
  const out = [];
  const re = /<th\b[^>]*>([\s\S]*?)<\/th>/g;
  let m;
  const head = theadOf(tableId);
  while ((m = re.exec(head)) !== null) {
    out.push({ tag: m[0].slice(0, m[0].indexOf(">") + 1), label: m[1].replace(/<[^>]+>/g, "").trim() });
  }
  return out;
}

// Every profit table the guard covers: the ones carrying the "+" column (a
// source My Crafting List can hold a row from), plus Volume — same audience,
// same columns-that-explain-nothing problem, no "+" of its own.
const COVERED = [
  "flipping-table", "skins-trading-table", "volume-table", "crafting-table",
  "craft-planner-table", "transport-table", "consumable-table", "rolling-table",
  "enchanting-table", "transmute-table", "rerolling-table", "gathering-table",
  "farming-table", "mounts-table", "laborers-table", "journal-filling-table",
  "buildings-table", "faction-spending-table",
];

test("every table with a + column is covered by this guard", () => {
  const withAdd = [];
  const re = /<table id="([\w-]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const id = m[1];
    const end = html.indexOf("</thead>", m.index);
    if (end !== -1 && html.slice(m.index, end).includes('class="cell-add"')) withAdd.push(id);
  }
  const uncovered = withAdd.filter((id) => !COVERED.includes(id));
  assert.deepStrictEqual(uncovered, [], `add-capable but unguarded: ${uncovered.join(", ")}`);
});

COVERED.forEach((tableId) => {
  test(`${tableId}: every header carries a tooltip`, () => {
    const missing = headersOf(tableId)
      .filter((h) => !/title="[^"]+"/.test(h.tag))
      .map((h) => h.label || "(the + column)");
    assert.deepStrictEqual(missing, [], `no title= on: ${missing.join(", ")}`);
  });

  test(`${tableId}: every tooltip is translatable`, () => {
    const untagged = headersOf(tableId)
      .filter((h) => /title="[^"]+"/.test(h.tag) && !/data-i18n-title="/.test(h.tag))
      .map((h) => h.label || "(the + column)");
    assert.deepStrictEqual(untagged, [],
      `no data-i18n-title on: ${untagged.join(", ")} — re-run scripts/gen-i18n-index.cjs`);
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
