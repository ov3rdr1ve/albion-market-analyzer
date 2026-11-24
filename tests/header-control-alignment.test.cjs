/**
 * Test: controls inside a section <h2> sit on one horizontal line.
 *
 * The headers are flex bars with align-items:center, so everything in them
 * shares a centre line — EXCEPT a <button>, which inherits `margin-bottom:1rem`
 * from the global button rule. align-items:center centres the margin box, so
 * the button's border box rides half that margin (8px) above the filter box and
 * the tier/enchant pickers next to it. Headers must zero that margin, the same
 * way .controls already does.
 *
 * Also pins updateFocusHeading (js/app.js) to the heading's title <span>: it
 * used to write to the h2's first text node, which — once the i18n pass wrapped
 * the title in a <span> — was the indentation whitespace, so the Crafting
 * header rendered its title twice.
 *
 * jsdom isn't vendored here, so this asserts at the source level (same style as
 * header-controls-no-collapse.test.cjs). Computed geometry (every child of the
 * Refining/Transports header at centerY 447.5) was verified in-browser.
 *
 * Run: node tests/header-control-alignment.test.cjs
 */

const assert = require("assert");
const { appSource } = require("./helpers/app-source.cjs");
const fs = require("fs");
const path = require("path");
const { readIndexHtml, readStyles } = require("./helpers/page-source.cjs");

const root = path.join(__dirname, "..");
const html = readIndexHtml();
const css = readStyles();
const appJs = appSource();
const esJs = fs.readFileSync(path.join(root, "js", "i18n-strings-es.js"), "utf8");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// Rule bodies, looked up by exact selector text.
function ruleBody(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`(^|[},])\\s*${esc}\\s*[,{][^{}]*?\\{([^}]*)\\}`, "m"))
    || css.match(new RegExp(`(^|[},])\\s*${esc}\\s*\\{([^}]*)\\}`, "m"));
  return m ? m[2] : null;
}

console.log("\n=== the global button margin is neutralised in header bars ===");

test("the global button rule still carries a bottom margin", () => {
  // If this ever goes away the fix below is dead weight — but so is the bug.
  const body = ruleBody("button");
  assert.ok(body, "could not find the global button rule");
  assert.ok(
    /margin-bottom\s*:\s*1rem/.test(body),
    "expected the global button rule to set margin-bottom:1rem (the thing headers must cancel)",
  );
});

// Every horizontal control bar that centres its children must zero it.
[
  [".controls button", "the global controls bar"],
  ["h2 button", "section headings"],
].forEach(([selector, what]) => {
  test(`${what} zero the button bottom margin`, () => {
    const body = ruleBody(selector);
    assert.ok(body, `missing rule for \`${selector}\` — buttons in ${what} will sit 8px high`);
    assert.ok(
      /margin-bottom\s*:\s*0/.test(body),
      `\`${selector}\` must set margin-bottom:0 so the button centres with the inputs beside it`,
    );
  });
});

console.log("\n=== headers stay single-line horizontal bars ===");

const markup = html.replace(/<!--[\s\S]*?-->/g, ""); // comments mention <h2> in prose
const h2Tags = markup.match(/<h2\b[^>]*>/g) || [];

test("index.html still has section headers", () => {
  assert.ok(h2Tags.length > 10, `expected many <h2> section headers, found ${h2Tags.length}`);
});

test("every <h2> with controls lays them out in a centred flex row", () => {
  // A header that isn't a centring flex row can't put its controls on the
  // title's line at all.
  const bad = h2Tags.filter((tag) => {
    if (!/style="/.test(tag)) return false;
    return !/display\s*:\s*flex/.test(tag) || !/align-items\s*:\s*center/.test(tag);
  });
  assert.strictEqual(
    bad.length, 0,
    `these headers don't centre their controls on one line:\n    ${bad.join("\n    ")}`,
  );
});

test("no <h2> is switched to a column layout", () => {
  // Stacking controls under the title (or into per-header columns) is the
  // layout this header explicitly isn't.
  const stacked = h2Tags.filter((tag) => /display\s*:\s*grid|flex-direction\s*:\s*column/.test(tag));
  assert.strictEqual(stacked.length, 0, `these headers stack their controls:\n    ${stacked.join("\n    ")}`);
});

console.log("\n=== the focus heading writes to the title span, not a text node ===");

// The heading text is written by updateSpecHeadings() — updateFocusHeading is now
// a thin alias of it, because the title also reflects whether the ⚙ Specs panel
// has lowered any Destiny Board node for the Crafting table.
const focusFn = (appJs.match(/function updateSpecHeadings\(\)\s*\{[\s\S]*?\n\}/) || [])[0] || "";

test("updateSpecHeadings targets the title span", () => {
  assert.ok(focusFn, "could not locate updateSpecHeadings in app.js");
  assert.ok(
    /querySelector\(\s*"span\[data-i18n\]"\s*\)/.test(focusFn),
    "updateSpecHeadings must select the heading's [data-i18n] title span",
  );
});

test("updateSpecHeadings no longer hunts for a raw text node", () => {
  // Regression: it wrote to the h2's first TEXT_NODE. Once the title moved into
  // a <span> that node was the indentation whitespace, so the header painted
  // the title a second time.
  assert.ok(
    !/Node\.TEXT_NODE/.test(focusFn),
    "updateSpecHeadings must not write to a TEXT_NODE — it lands on whitespace and duplicates the title",
  );
});

test("both heading states still have an English label", () => {
  // Assembled from parts: "Crafting (" + w/ Focus | No Focus + ")". The heading
  // no longer names a spec level — levels are per-table adjustable, so the ⚙
  // button's asterisk carries that signal instead.
  assert.ok(/"w\/ Focus" : "No Focus"/.test(focusFn), "missing the focus-state text");
  assert.ok(/Crafting \(/.test(focusFn), "missing the heading stem");
  assert.ok(!/Maxed Specs|Custom Specs/.test(focusFn),
    "the heading must not claim a spec level any more");
});

test("both heading states are translated", () => {
  // "No Focus" is set in JS, so it is absent from index.html — the generator
  // carries it as a runtime string and Spanish must carry it too.
  assert.ok(/"crafting_w_focus" : "crafting_no_focus"/.test(focusFn),
    "updateSpecHeadings must build both focus slugs");
  ["crafting_w_focus", "crafting_no_focus"].forEach((slug) => {
    assert.ok(new RegExp(`\\b${slug}\\s*:`).test(esJs), `js/i18n-strings-es.js is missing ${slug}`);
  });
});

test("switching focus re-primes the cached English rather than dropping it", () => {
  // js/i18n.js caches an element's English in data-i18n-en, read off the live
  // textContent. Deleting it while Spanish was displayed cached the Spanish as
  // "the English", and switching back to English kept showing Spanish.
  assert.ok(
    /dataset\.i18nEn\s*=/.test(focusFn),
    "updateSpecHeadings must set dataset.i18nEn to the English label for the new slug",
  );
  assert.ok(
    !/delete\s+span\.dataset\.i18nEn/.test(focusFn),
    "deleting the i18n English cache lets a translated string be cached as English",
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
