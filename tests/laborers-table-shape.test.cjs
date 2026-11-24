/**
 * Test: the Laborers table's column count holds together across index.html, the
 * renderer and the placeholder row.
 *
 * The table reached 15 columns and stopped fitting a 1440px screen, so three
 * columns were removed by folding each into a neighbour that already carried the
 * same information:
 *
 *   Tier                 → the Laborer cell already reads "T8 Tinker".
 *   Margin %             → a sub-line under Profit / Cycle (it is that profit
 *                          over the Filled Cost, both of which are on the row).
 *   Best Journal +       → one "Best Journal Play" cell, now that both plays are
 *   Fill Speed / Max        measured in silver per 22h laborer cycle.
 *   Profit
 *
 * Three separate places have to agree on the count, and nothing in the browser
 * complains when they do not — a short <tr> silently shifts every cell right of
 * the gap under the wrong header, and a stale colspan leaves the "Awaiting Scan"
 * row not spanning the table. So: headers, rendered cells, colspan.
 *
 * Also guards what the folds were for: the dropped Margin % column took the
 * click-to-change-sell-city affordance with it (it lived on profitTd), so the
 * merged Profit / Cycle cell has to carry it instead or the feature is gone.
 *
 * Static: parses index.html and js/render-laborers.js. No DOM, no market data.
 *
 * Run: node tests/laborers-table-shape.test.cjs
 */

const assert = require("assert");
const { appSource } = require("./helpers/app-source.cjs");
const fs = require("fs");
const path = require("path");
const { readIndexHtml } = require("./helpers/page-source.cjs");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const html = readIndexHtml();
const renderer = read("js/render-laborers.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const EXPECTED_COLUMNS = 12;

// The <table id="laborers-table"> … </table> block.
function laborersTable() {
  const start = html.indexOf('<table id="laborers-table"');
  assert.ok(start > -1, "the laborers table is gone from index.html");
  const end = html.indexOf("</table>", start);
  return html.slice(start, end);
}

// The template literal the renderer returns for one row.
function rowTemplate() {
  const start = renderer.indexOf("<tr data-row-key=");
  assert.ok(start > -1, "the laborers row template is gone from render-laborers.js");
  const end = renderer.indexOf("</tr>", start);
  return renderer.slice(start, end);
}

console.log("\n=== Laborers table: 12 columns, agreed on in three places ===");

test(`the header row has exactly ${EXPECTED_COLUMNS} <th>`, () => {
  const ths = laborersTable().match(/<th[\s>]/g) || [];
  assert.strictEqual(ths.length, EXPECTED_COLUMNS);
});

test(`the rendered row emits exactly ${EXPECTED_COLUMNS} cells`, () => {
  // One cell per line in the template: either a literal <td>…</td>, or a bare
  // ${...} interpolation of a cell helper (priceTd, profitWithMarginTd,
  // journalPlayCell, addTdForKey, …). Counting lines rather than matches is
  // what keeps `<td class="cell-item">${item.name}</td>` from scoring twice.
  const cells = rowTemplate()
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("<td") || /^\$\{[^}]+\}$/.test(l));
  assert.strictEqual(cells.length, EXPECTED_COLUMNS, cells.join(" | "));
});

test(`the "Awaiting Scan" placeholder spans ${EXPECTED_COLUMNS}`, () => {
  const m = laborersTable().match(/colspan="(\d+)"/);
  assert.ok(m, "no placeholder colspan found");
  assert.strictEqual(Number(m[1]), EXPECTED_COLUMNS);
});

console.log("\n=== The folded columns really are gone, and their content is not ===");

test("no standalone Tier column — the Laborer cell tiers the name instead", () => {
  assert.ok(!/data-sort="tier"/.test(laborersTable()), "a Tier header is back");
  assert.ok(/name: `T\$\{spec\.tier\} \$\{spec\.laborerName\}`/.test(renderer),
    "the Laborer name must still carry the tier, or the tier is lost entirely");
});

test("no standalone Margin % column, but the margin is still rendered", () => {
  assert.ok(!/data-sort="margin"/.test(laborersTable()), "a Margin % header is back");
  assert.ok(/profitWithMarginTd\(/.test(renderer),
    "Profit / Cycle must use the cell that carries the margin");
});

test("the merged Profit / Cycle cell keeps click-to-change-sell-city", () => {
  const app = appSource();
  const fn = app.slice(app.indexOf("function profitWithMarginTd"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.ok(body.includes('data-profit-cell="1"'), "the click handler's hook is missing");
  assert.ok(body.includes("profit-cell-clickable"), "the clickable class is missing");
  assert.ok(body.includes("data-row-idx"), "the handler needs the row index");
  assert.ok(body.includes("data-sell-city"), "the handler needs the current sell city");
});

test("one journal column, not two, and it sorts on the shared per-cycle unit", () => {
  const table = laborersTable();
  assert.ok(!/data-sort="bestJournalProfit"/.test(table), "the old Best Journal header is back");
  assert.ok(!/data-sort="selfFillPerFame"/.test(table), "the old Fill Speed header is back");
  assert.ok(/data-sort="journalPlay"/.test(table), "the merged header is missing");
  assert.ok(/journalPlayCell\(/.test(renderer), "the merged cell is not rendered");
});

console.log("\n=== The default sort points at a header that exists ===");

test("the saved default sort column is one of this table's headers", () => {
  const sorting = read("js/sorting.js");
  const m = sorting.match(/"laborers-table":\s*\{\s*sortCol:\s*"([^"]+)"/);
  assert.ok(m, "no default sort registered for the laborers table");
  const headers = [...laborersTable().matchAll(/data-sort="([^"]+)"/g)].map((x) => x[1]);
  assert.ok(headers.includes(m[1]),
    `default sorts on "${m[1]}", which is no longer a column: ${headers.join(", ")}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
