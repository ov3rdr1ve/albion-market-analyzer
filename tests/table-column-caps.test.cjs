/**
 * Test: wide-cell width caps are attached to CLASSES the renderers emit, never
 * to column positions.
 *
 * The caps used to be written as `#crafting-table td:nth-child(9)`. Every column
 * inserted afterwards shifted the target: the Crafting table's 200px "Mats to
 * Buy" cap drifted onto "Profit / 10k Focus" (leaving the wide column uncapped,
 * so the table ran off-screen), the Consumables cap landed on "Pure Profit", and
 * the Crafting Planner's rules still assumed the 8-column layout it had before
 * "Laborer Journal" was inserted. Nothing failed loudly — the table just got
 * wider. This test makes that failure loud.
 *
 * Black-box: read css/styles.css, the renderers and index.html as text.
 *   1. no data table may carry a positional cap again
 *   2. every .cell-* class the CSS caps is emitted by at least one renderer
 *   3. every cell-* class a renderer emits is defined in the CSS
 *   4. each table's placeholder colspan matches its real column count
 *
 * Run: node tests/table-column-caps.test.cjs
 */

const assert = require("assert");
const { appSource } = require("./helpers/app-source.cjs");
const fs = require("fs");
const path = require("path");
const { readIndexHtml, readStyles } = require("./helpers/page-source.cjs");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// A table's renderer can be split across files to stay inside the 800-line cap
// (the mounts rows live in render-mounts-breeding-row.js and
// render-mounts-craft-row.js). Read the whole family, so a split never reads as
// a missing cell.
const RENDERER_FAMILY = {
  "js/render-mounts.js": [
    "js/render-mounts.js",
    "js/render-mounts-breeding-row.js",
    "js/render-mounts-craft-row.js",
  ],
  "js/render-consumables.js": [
    "js/render-consumables.js",
    "js/render-consumables-row.js",
    "js/render-consumable-chain-row.js",
    "js/render-consumable-no-data-row.js",
  ],
};
const readFamily = (rel) => (RENDERER_FAMILY[rel] || [rel]).map(read).join("\n");


// The width caps, the compact density and the craft list's own caps were split
// out of styles.css when it outgrew the project's 800-line limit; they ship as
// one cascade (index.html loads craft-list.css and table-density.css after
// styles.css), so the scanners below read them as one, in link order.
const css = [readStyles(), ...["css/craft-list.css", "css/table-density.css"].map(read)].join("\n");
const html = readIndexHtml();
// Any module that emits a <td>, not just the render-* files: cells for the
// wider columns now live in their own modules (laborer-journal-play.js,
// laborer-self-fill.js, …) so the render-* file stays under the size limit.
// The rule is "a capped class is emitted by SOME renderer", not "by a file
// whose name starts with render-".
const renderers = fs
  .readdirSync(path.join(ROOT, "js"))
  .filter((f) => f.endsWith(".js") && /<td[ >]/.test(read(`js/${f}`)));
const rendererSrc = renderers.map((f) => read(`js/${f}`)).join("\n");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// Every <table id> that renders market rows. Reference/static tables (city
// bonuses, zone tables) are hand-written in index.html and out of scope.
const DATA_TABLES = [
  "crafting-table", "craft-planner-table", "consumable-table", "transport-table",
  "mounts-table", "laborers-table", "faction-spending-table", "flipping-table",
  "volume-table", "farming-table", "gathering-table", "buildings-table",
];

console.log("\n=== Width caps are class-based, not positional ===");

test("no data table pins a width cap to a column position", () => {
  const offenders = DATA_TABLES.filter((id) =>
    new RegExp(`#${id}\\s+t[dh]:nth-child\\(`).test(css));
  assert.deepStrictEqual(offenders, [],
    `positional caps drift when a column is inserted — use a cell-* class instead: ${offenders.join(", ")}`);
});

test("every capped .cell-* class is actually emitted by a renderer", () => {
  const defined = [...new Set([...css.matchAll(/\.data-table\s+td\.(cell-[\w-]+)/g)].map((m) => m[1]))];
  assert.ok(defined.length >= 5, `expected the cell-* cap classes in the CSS, found ${defined.length}`);
  const orphans = defined.filter((c) => !new RegExp(`class="[^"]*\\b${c}\\b`).test(rendererSrc));
  assert.deepStrictEqual(orphans, [], `CSS caps nothing: ${orphans.join(", ")}`);
});

test("every cell-* class a renderer emits is capped by the CSS", () => {
  const emitted = [...new Set(
    [...rendererSrc.matchAll(/class="([^"]*\bcell-[\w-]+[^"]*)"/g)]
      .flatMap((m) => m[1].split(/\s+/))
      .filter((c) => c.startsWith("cell-")),
  )];
  assert.ok(emitted.length >= 5, `expected renderers to tag wide cells, found ${emitted.length}`);
  const undefinedClasses = emitted.filter((c) => !css.includes(`td.${c}`));
  assert.deepStrictEqual(undefinedClasses, [], `no CSS rule for: ${undefinedClasses.join(", ")}`);
});

console.log("\n=== The tables that overflow without caps carry them ===");

// The columns that hold multi-line content. Each must be tagged somewhere in
// its renderer, otherwise the table grows past the viewport again.
[
  ["render-crafting.js", ["cell-item", "cell-route", "cell-mats", "cell-focus-mats"]],
  ["render-consumables.js", ["cell-item", "cell-route", "cell-mats", "cell-focus-mats"]],
  ["render-transport.js", ["cell-item", "cell-route", "cell-mats", "cell-focus-mats"]],
  ["render-mounts.js", ["cell-item", "cell-route", "cell-mats", "cell-focus-mats"]],
  ["render-craft-planner.js", ["cell-item", "cell-route", "cell-mats", "cell-note"]],
  ["render-laborers.js", ["cell-item", "cell-route", "cell-note"]],
  ["render-buildings.js", ["cell-item", "cell-mats", "cell-note"]],
  ["render-faction-spending.js", ["cell-item"]],
  // Farming is 15 columns and My Crafting List clones them into an 18-column
  // group, so it is the widest table in the app after the list itself. Six of
  // its columns used to carry no cap class at all and the two Profit cells,
  // each with a second line naming the counterpart farm city, ran ~215px apiece.
  ["render-farming.js", ["cell-item", "cell-route", "cell-text", "cell-num", "cell-focus-mats", "cell-note"]],
].forEach(([file, classes]) => {
  test(`${file} tags ${classes.join(", ")}`, () => {
    const src = readFamily(`js/${file}`);
    const missing = classes.filter((c) => {
      if (new RegExp(`class="[^"]*\\b${c}\\b`).test(src)) return false;
      // The Route column is built by the shared routeCityCell (js/route-cell.js),
      // which emits the cap class itself — so calling it counts as tagging it.
      return !(c === "cell-route" && /routeCityCell\(/.test(src));
    });
    assert.deepStrictEqual(missing, [], `untagged wide cells: ${missing.join(", ")}`);
  });
});

test("routeCityCell is the only other place cell-route is emitted", () => {
  const src = read("js/route-cell.js");
  assert.ok(/class="cell-route"/.test(src),
    "the shared route cell must carry the width cap class itself");
});

test("price cells carry cell-num so the age/volume badge can wrap", () => {
  const app = appSource();
  assert.ok(/function priceTd[\s\S]*?cell-num/.test(app),
    "priceTd must tag its <td> with cell-num");
});

console.log("\n=== Placeholder colspans match the real column count ===");

test("every data table's 'Awaiting Scan' row spans exactly its columns", () => {
  const wrong = [];
  const tableRe = /<table id="([\w-]+)"[^>]*>([\s\S]*?)<\/table>/g;
  let m;
  while ((m = tableRe.exec(html))) {
    const [, id, body] = m;
    const headEnd = body.indexOf("</thead>");
    if (headEnd < 0) continue;
    const cols = [...body.slice(0, headEnd).matchAll(/<th\b/g)].length;
    for (const cs of body.slice(headEnd).matchAll(/colspan="(\d+)"/g)) {
      if (Number(cs[1]) !== cols) wrong.push(`${id}: colspan ${cs[1]} vs ${cols} columns`);
    }
  }
  assert.deepStrictEqual(wrong, [], wrong.join("; "));
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
