/**
 * Test: the sticky Material column does not paint over the City column in the
 * "Materials to Buy" sub-table.
 *
 * Bug (reported): city names rendered left-clipped — "rtlock" for Martlock,
 * "nhurst" for Lymhurst. Not a width cap. `.cell-item` is sticky and opaque and
 * sits at `left: 30px` to clear the "+" gutter every profit table has. The
 * Materials to Buy rows have NO gutter, so styles.css already zeroes that offset
 * for gutter-less rows — but the compact restatement (`left: 22px`) scores
 * (0,3,2) against the escape hatch's (0,3,1), and compact density is ON by
 * default (js/app-zoom.js). Compact won, the Material cell shifted 22px right of
 * its own column, and its opaque background covered the first 22px of City.
 *
 * Fix: give the escape hatch a `body.compact` counterpart.
 *
 * Black-box: reads the shipped css/styles.css and index.html, no browser.
 *
 * Run: node tests/craft-list-mats-sticky-offset.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { readIndexHtml, readStyles } = require("./helpers/page-source.cjs");

const css = readStyles();
const html = readIndexHtml();

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.error(`  FAIL: ${name}\n    ${e.message}`); }
}

/** Every rule as { selectors: [..], body, index }, comments stripped. */
function parseRules(src) {
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(clean))) {
    const sel = m[1].trim();
    if (!sel || sel.startsWith("@")) continue;
    rules.push({
      selectors: sel.split(",").map((s) => s.trim()).filter(Boolean),
      body: m[2],
      index: m.index,
    });
  }
  return rules;
}

/** CSS specificity (ids, classes/attrs/pseudo-classes, types) of one selector. */
function specificity(sel) {
  // :not()/:has() are transparent — their arguments count normally.
  const inner = sel.replace(/:(not|has|is|where)\(/g, "(");
  const ids = (inner.match(/#[\w-]+/g) || []).length;
  const classes = (inner.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+(?!\()/g) || []).length;
  const types = (inner.replace(/[.#][\w-]+|\[[^\]]+\]|:[\w-]+/g, "").match(/\b[a-z][\w-]*\b/g) || []).length;
  return [ids, classes, types];
}
const cmpSpec = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);

const rules = parseRules(css);

/** Winning `left` for a .cell-item cell, given the matching context. */
function resolveLeft({ compact, hasGutterSibling }) {
  let winner = null;
  for (const rule of rules) {
    const left = /(?:^|[;{\s])left\s*:\s*([^;]+)/.exec(rule.body);
    if (!left) continue;
    for (const sel of rule.selectors) {
      if (!/\.cell-item\b/.test(sel)) continue;
      if (/\bth\.cell-item\b/.test(sel) && !/\btd\.cell-item\b/.test(sel)) continue;
      if (/body\.compact/.test(sel) && !compact) continue;
      if (/:not\(:has\(> \.cell-add\)\)/.test(sel) && hasGutterSibling) continue;
      const spec = specificity(sel);
      if (!winner || cmpSpec(spec, winner.spec) > 0 ||
          (cmpSpec(spec, winner.spec) === 0 && rule.index > winner.index)) {
        winner = { spec, index: rule.index, value: left[1].trim(), sel };
      }
    }
  }
  return winner;
}

console.log("\n=== Sticky offset resolution ===");

test("gutter-less row under compact resolves to left: 0 (the reported clipping)", () => {
  const w = resolveLeft({ compact: true, hasGutterSibling: false });
  assert.ok(w, "no rule sets `left` on .cell-item at all");
  assert.strictEqual(w.value, "0",
    `compact gutter-less .cell-item resolved to "${w.value}" via "${w.sel}" — it must be 0 or it covers the next column`);
});

test("gutter-less row without compact still resolves to left: 0", () => {
  const w = resolveLeft({ compact: false, hasGutterSibling: false });
  assert.strictEqual(w.value, "0", `resolved to "${w.value}" via "${w.sel}"`);
});

test("a row WITH a + gutter keeps its offset (22px compact, 30px normal)", () => {
  assert.strictEqual(resolveLeft({ compact: true, hasGutterSibling: true }).value, "22px");
  assert.strictEqual(resolveLeft({ compact: false, hasGutterSibling: true }).value, "30px");
});

console.log("\n=== Preconditions this test depends on ===");

test("the compact 22px rule really does exist (otherwise the test proves nothing)", () => {
  assert.ok(/body\.compact[^{]*\.cell-item[^{]*\{[^}]*left:\s*22px/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")),
    "expected a `body.compact … .cell-item { left: 22px }` rule");
});

test("the Materials to Buy table is a .data-table with no + gutter column", () => {
  const tbl = /<table id="craft-list-mats-table"[\s\S]*?<\/thead>/.exec(html);
  assert.ok(tbl, "#craft-list-mats-table not found in index.html");
  assert.ok(/class="data-table"/.test(tbl[0]), "the sticky rules only apply inside .data-table");
  assert.ok(!/cell-add/.test(tbl[0]), "precondition: this table has no + gutter column");
});

test("its Material cells are the sticky ones", () => {
  const js = fs.readFileSync(path.join(__dirname, "..", "js", "render-craft-list.js"), "utf8");
  assert.ok(/cell-item/.test(js), "render-craft-list.js no longer emits cell-item — retarget this test");
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
