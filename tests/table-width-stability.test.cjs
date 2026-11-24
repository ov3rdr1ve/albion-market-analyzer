/**
 * A table's width must not depend on transient state.
 *
 * Every data table in the app sizes its columns from their content —
 * `.table-wrap > .data-table` is `width: max-content`, and the craft list's
 * `.cl-group-wrap > table.cl-inner` is an auto-layout table at its wrap's width —
 * so anything that changes a cell's intrinsic width while a re-render pass runs
 * moves the real columns and the table visibly steps out and back. Three things did that:
 *
 *   a mark that padded its cell   .pe-pending set padding-right on the cell the
 *                                 user typed into. It lost to `.data-table td`
 *                                 on specificity so it never fired there, but a
 *                                 mark must not be able to move a column at
 *                                 all — hence the rule, not just the removal;
 *
 *   a sentence in a colspan cell  "Computing… this row fills when Crafting
 *                                 (w/ Focus) is done." set the craft list's
 *                                 group table width until the real row landed;
 *
 *   an expanded detail row        the breeding ▾ grid demanded ~960px of fixed
 *                                 tracks from a cell spanning the whole table.
 *
 * The fix is one CSS class, `.row-fluid` (width: 0 removes the content from
 * intrinsic sizing; min-width: 100% still fills the cell at layout time), on
 * every full-row cell's content — plus colspans that match the real column
 * count, since an over-long one invents columns that are also real width.
 *
 * Black-box over the shipped sources: the generated HTML strings and the
 * stylesheet text. No DOM, no browser, no data.
 *
 * Run: node tests/table-width-stability.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { readIndexHtml, readStyles } = require("./helpers/page-source.cjs");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

// Newlines normalised: the working tree is checked out CRLF on Windows, and
// every selector and snippet below is written with plain \n.
const read = (rel) =>
  fs.readFileSync(path.join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

/**
 * The source around the first occurrence of `needle`, so a failure prints a
 * readable window instead of the whole file.
 */
function near(src, needle, after = 260) {
  const at = src.indexOf(needle);
  assert.ok(at !== -1, `"${needle}" is not in the source any more`);
  return src.slice(at, at + needle.length + after);
}

// The craft list's rules were split into css/craft-list.css when styles.css
// outgrew the 800-line limit; index.html loads it right after styles.css.
const CSS = [readStyles(), ...["css/craft-list.css"].map(read)].join("\n");
const INDEX = readIndexHtml();

/** The body of a CSS rule, by exact selector at the start of a line. */
function ruleBody(css, selector) {
  const at = css.indexOf(`\n${selector} {`);
  assert.ok(at !== -1, `no rule for "${selector}"`);
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

console.log("\n=== The .row-fluid utility ===");

test("declares width: 0 so content leaves intrinsic sizing", () => {
  const body = ruleBody(CSS, ".row-fluid");
  assert.match(body, /width:\s*0\s*;/, ".row-fluid must set width: 0");
});

test("declares min-width: 100% so it still fills the cell", () => {
  const body = ruleBody(CSS, ".row-fluid");
  assert.match(body, /min-width:\s*100%\s*;/, ".row-fluid must set min-width: 100%");
});

test("is a block, or width/min-width would not apply to a span", () => {
  const body = ruleBody(CSS, ".row-fluid");
  assert.match(body, /display:\s*block\s*;/);
});

console.log("\n=== A mark never changes layout ===");

// Parameterised over both marks: they are the same report at two scopes, and
// either one padding its cell is a jump.
[
  [".pe-pending", "the cell the user typed into"],
].forEach(([selector, what]) => {
  test(`${selector} (${what}) sets no padding`, () => {
    const body = ruleBody(CSS, selector);
    assert.ok(!/padding/.test(body), `${selector} must not touch padding: ${body.trim()}`);
  });

  test(`${selector} positions its ring absolutely, inside the cell`, () => {
    const body = ruleBody(CSS, `${selector}::after`);
    assert.match(body, /position:\s*absolute/);
    assert.match(body, /right:\s*0\s*;/, "the ring belongs in the existing padding");
  });
});

test("compact mode shrinks the ring to fit its 0.22rem padding", () => {
  const body = ruleBody(CSS, "body.compact .pe-pending::after");
  const size = /width:\s*(\d+)px/.exec(body);
  assert.ok(size, "compact rings must set a width");
  assert.ok(Number(size[1]) <= 6, `compact ring is ${size[1]}px, wider than the padding`);
});

console.log("\n=== Full-row cells carry .row-fluid ===");

// One case per full-row cell that appears or disappears while a pass runs.
// The assertion is the same for all of them, which is the point: a colspan cell
// whose text is loose in the <td> is the bug.
[
  ["js/table-loading-mark.js", "the boot loading row", 'colspan="${cols}"'],
  ["js/render-craft-list.js", "placeholder / Computing… row", 'colspan="${span}"'],
  ["js/render-craft-list.js", "empty list row", 'colspan="1" class="cl-empty"'],
  // The board and the footer line live in js/render-craft-list-footer.js; the
  // rows stayed in js/render-craft-list.js when that file hit the 800-line cap.
  ["js/render-craft-list-footer.js", "empty materials board", 'colspan="5"'],
  ["js/render-faction-spending.js", "breeding detail row", 'class="breed-detail-cell"'],
  ["js/render-favor-spending.js", "mount-input detail row", 'class="breed-detail-cell"'],
  ["js/sorting.js", "no profitable loops", "padding: 2rem;"],
].forEach(([file, what, opener]) => {
  test(`${file} — ${what}`, () => {
    const window = near(read(file), opener);
    assert.ok(
      window.includes("row-fluid"),
      `no .row-fluid after ${opener}:\n${window}`,
    );
  });
});

test("index.html ships its static empty rows the same way", () => {
  ["r_cl_empty_static", "r_cl_no_materials_static"].forEach((slug) => {
    const at = INDEX.indexOf(slug);
    assert.ok(at !== -1, `${slug} is gone from index.html`);
    const around = INDEX.slice(Math.max(0, at - 200), at);
    assert.ok(around.includes("row-fluid"), `${slug} is not wrapped in .row-fluid`);
  });
});

console.log("\n=== Colspans match the real column count ===");

test("the craft list placeholder spans its own group, not 20 columns", () => {
  const src = read("js/render-craft-list.js");
  assert.ok(!/colspan="20"/.test(src), 'colspan="20" is back in the craft list');
  assert.match(src, /_clGroupColCount\s*\(/, "the count must be read, not written down");
});

test("the craft list shell is one column wide", () => {
  // The shell table has no <thead> — band rows, group tables and the totals row
  // all sit in a single column, and `table-layout: fixed` sizes it from the
  // FIRST row it sees. A colspan of 12 there made twelve of them.
  assert.ok(!/colspan="12" class="cl-empty"/.test(INDEX));
  assert.match(read("js/render-craft-list.js"), /colspan="1" class="cl-empty"/);
});

test("both detail rows read the faction table's column count", () => {
  assert.match(read("js/render-faction-spending.js"), /function _fsColCount\(/);
  ["js/render-faction-spending.js", "js/render-favor-spending.js"].forEach((file) => {
    const src = read(file);
    assert.ok(
      !/colspan="12" class="breed-detail-cell"/.test(src),
      `${file} still hard-codes 12 columns`,
    );
    assert.match(src, /_fsColCount/, `${file} must read the count`);
  });
});

console.log("\n=== The breeding grid yields to its cell ===");

test("no track floor wider than the table can be", () => {
  const body = ruleBody(CSS, ".breed-detail-grid");
  const cols = /grid-template-columns:([^;]+);/.exec(body);
  assert.ok(cols, ".breed-detail-grid must declare its columns");
  const floors = [...cols[1].matchAll(/minmax\(\s*(?:min\(\s*)?(\d+)px/g)].map((m) => Number(m[1]));
  assert.ok(floors.length, "expected minmax() floors");
  floors.forEach((px) => {
    assert.ok(px <= 200, `a ${px}px floor forces the table wider`);
  });
  assert.match(cols[1], /min\(\s*\d+px\s*,\s*100%\s*\)/, "the floor must yield to the cell");
});

test("a held craft-list row is marked without costing layout", () => {
  // It carries the previous pass's numbers, so it has to be distinguishable —
  // but with a box-shadow, never padding or a border, or holding the row would
  // move the columns it exists to keep still.
  const body = ruleBody(CSS, "#craft-list-table tr.cl-held > td:first-child");
  assert.match(body, /box-shadow:\s*inset/);
  assert.ok(!/padding|border-|width/.test(body), `cl-held must not affect layout: ${body.trim()}`);
});

test("the expandable panels scroll instead of widening their tables", () => {
  [".cp-paths-wrap", ".jb-detail-wrap"].forEach((selector) => {
    const body = ruleBody(CSS, selector);
    assert.match(body, /width:\s*0\s*;/, `${selector} must not size its table`);
    assert.match(body, /min-width:\s*100%/, `${selector} must still fill the cell`);
    assert.match(body, /overflow-x:\s*auto/, `${selector} must stay scrollable`);
  });
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
