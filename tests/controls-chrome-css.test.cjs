/**
 * Test (TLD, UI): the app-wide control chrome in css/controls.css.
 *
 * Two native widgets were leaking the OS light theme into the dark app: the
 * spinner arrows on every <input type="number"> outside the price popup, and
 * the window scrollbar. Both are styled globally now, so this pins that the
 * sheet is linked and keeps its selectors app-wide (not re-scoped to one
 * widget, which is how the leak happened in the first place).
 *
 * Run: node tests/controls-chrome-css.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { readIndexHtml, readStyles } = require("./helpers/page-source.cjs");

const ROOT = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(ROOT, "css", "controls.css"), "utf-8");
const html = readIndexHtml();

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Control Chrome CSS Tests\n");

test("index.html links the sheet", () => {
  assert.ok(/<link rel="stylesheet" href="css\/controls\.css"/.test(html));
});

const REQUIRED_RULES = [
  { name: "hides the WebKit spinner on every number input", pattern: /input\[type="number"\]::-webkit-inner-spin-button/ },
  { name: "hides the outer spinner too", pattern: /input\[type="number"\]::-webkit-outer-spin-button/ },
  { name: "sets appearance: textfield for Firefox/standard", pattern: /input\[type="number"\]\s*\{[^}]*appearance:\s*textfield/ },
  { name: "declares the standard scrollbar-color", pattern: /scrollbar-color:\s*#374151\s+#1a1b1e/ },
  { name: "styles the WebKit scrollbar thumb", pattern: /::-webkit-scrollbar-thumb\s*\{/ },
  { name: "styles the WebKit scrollbar track", pattern: /::-webkit-scrollbar-track\s*\{/ },
  { name: "drops the unstyleable stepper buttons", pattern: /::-webkit-scrollbar-button\s*\{[^}]*display:\s*none/ },
];

REQUIRED_RULES.forEach((rule) => {
  test(`css: ${rule.name}`, () => {
    assert.ok(rule.pattern.test(css), `missing rule: ${rule.pattern}`);
  });
});

test("css: the spinner rules stay app-wide, not scoped to one class", () => {
  const spinnerLines = css
    .split("\n")
    .filter((line) => line.includes("-webkit-inner-spin-button"));
  assert.ok(spinnerLines.length > 0);
  spinnerLines.forEach((line) => {
    assert.ok(
      line.trim().startsWith('input[type="number"]'),
      `spinner rule re-scoped to a widget: ${line.trim()}`
    );
  });
});

test("css: the track and page background agree", () => {
  const styles = readStyles();
  const page = /body\s*\{[^}]*background-color:\s*(#[0-9a-f]{6})/i.exec(styles);
  assert.ok(page, "body background not found in styles.css");
  const track = /::-webkit-scrollbar-track\s*\{[^}]*background:\s*(#[0-9a-f]{6})/i.exec(css);
  assert.ok(track, "scrollbar track background not found");
  assert.strictEqual(track[1].toLowerCase(), page[1].toLowerCase());
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
