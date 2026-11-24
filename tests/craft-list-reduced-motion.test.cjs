/**
 * My Crafting List — reduced motion stops the row animations.
 *
 * `#craft-list-table tr.cl-pending td` pulses while a row computes. The
 * `animation: none` that cancels it under `prefers-reduced-motion` ties with
 * the pulse on specificity, so it only wins when it comes LATER in the cascade.
 * It used to sit in css/styles.css, which loads before css/craft-list.css, so
 * the pulse always won.
 *
 * Black box: read index.html's stylesheet links and the shipped CSS as text,
 * concatenated in link order — the cascade the page actually gets.
 *
 * Run: node tests/craft-list-reduced-motion.test.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { readIndexHtml } = require("./helpers/page-source.cjs");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const html = readIndexHtml();
const SHEETS = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
const CASCADE = SHEETS.map(read).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");

/** Split a selector list at top-level commas only. */
function splitSelectors(head) {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of head) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Every style rule with its selectors, body, enclosing @media text and position. */
function styleRules(css) {
  const rules = [];
  const stack = [];
  let head = "";
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") {
      const h = head.trim();
      head = "";
      if (h.startsWith("@")) { stack.push(h); continue; }
      const close = css.indexOf("}", i);
      rules.push({
        selectors: splitSelectors(h),
        body: css.slice(i + 1, close),
        media: stack.filter((s) => s.startsWith("@media")).join(" "),
        at: i,
      });
      i = close;
    } else if (ch === "}") {
      stack.pop();
      head = "";
    } else if (ch === ";" && stack.length === 0) {
      head = "";
    } else {
      head += ch;
    }
  }
  return rules;
}

const RULES = styleRules(CASCADE);

test("css/craft-list.css is linked after css/styles.css", () => {
  const styles = SHEETS.indexOf("css/styles.css");
  const list = SHEETS.indexOf("css/craft-list.css");
  assert.ok(styles !== -1 && list !== -1, `both sheets must be linked: ${SHEETS.join(", ")}`);
  assert.ok(list > styles, "craft-list.css must cascade after styles.css");
});

[
  ["#craft-list-table tr.cl-pending td", "cl-pending-pulse"],
].forEach(([selector, animation]) => {
  test(`${selector} animates (${animation}) outside reduced motion`, () => {
    const runs = RULES.filter((r) => !r.media && r.selectors.includes(selector)
      && new RegExp(String.raw`animation:\s*${animation}\b`).test(r.body));
    assert.ok(runs.length > 0, `no ${animation} rule for ${selector}`);
  });

  test(`reduced motion cancels ${selector}, later in the cascade than the animation`, () => {
    const runs = RULES.filter((r) => !r.media && r.selectors.includes(selector)
      && /animation:\s*(?!none)/.test(r.body));
    const stops = RULES.filter((r) => /prefers-reduced-motion:\s*reduce/.test(r.media)
      && r.selectors.includes(selector) && /animation:\s*none/.test(r.body));
    assert.ok(stops.length > 0, `no reduced-motion rule stops ${selector}`);
    const lastRun = Math.max(...runs.map((r) => r.at));
    const lastStop = Math.max(...stops.map((r) => r.at));
    assert.ok(lastStop > lastRun,
      `the reduced-motion rule for ${selector} cascades BEFORE its animation, so the animation wins`);
  });
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
