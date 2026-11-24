/**
 * Tests for scripts/gen-i18n-index.cjs — the index.html i18n tagger.
 *
 * Black-box: we run the generator's pure core (tagHtml) over small HTML
 * fixtures and assert on the rewritten HTML + the emitted EN string table.
 * The real index.html is never touched.
 *
 * Regressions guarded:
 *   - re-running must be idempotent: an element that already carries
 *     data-i18n / data-i18n-ph / data-i18n-title is never tagged twice
 *     (the old version compared against the matched ATTRIBUTE, not the tag,
 *     so every run appended another data-i18n-title to the same element).
 *   - HTML comments are left alone (the old <h2> pass rewrote text inside them).
 *   - hand-authored slugs survive: their English text is harvested back into
 *     the generated table instead of being dropped.
 *
 * Run: node tests/gen-i18n-index.test.cjs
 */

const assert = require("assert");
const { tagHtml, RUNTIME_STRINGS } = require("../scripts/gen-i18n-index.cjs");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

const countOf = (s, needle) => s.split(needle).length - 1;

console.log("\n=== tagging fresh markup ===");

test("th text gets a data-i18n slug and lands in the EN table", () => {
  const { html, strings } = tagHtml('<table><thead><tr><th>Zone Quality</th></tr></thead></table>');
  assert.ok(html.includes('<th data-i18n="zone_quality">Zone Quality</th>'), html);
  assert.strictEqual(strings.zone_quality, "Zone Quality");
});

test("title and placeholder attributes get their own slugs", () => {
  const { html, strings } = tagHtml('<input title="Power Level" placeholder="Filter… e.g. q4" />');
  assert.ok(/data-i18n-title="power_level"/.test(html), html);
  assert.ok(/data-i18n-ph="filter_e_g_q4"/.test(html), html);
  assert.strictEqual(strings.power_level, "Power Level");
  assert.strictEqual(strings.filter_e_g_q4, "Filter… e.g. q4");
});

test("h2 leading title is wrapped in a span, child controls untouched", () => {
  const { html } = tagHtml('<h2>City Bonuses <input id="s" /></h2>');
  assert.ok(html.includes('<span data-i18n="city_bonuses">City Bonuses</span>'), html);
  assert.ok(html.includes('<input id="s" />'), "child control must survive");
});

test("identical text shares one slug", () => {
  const { strings } = tagHtml('<th>Notes</th><button>Notes</button>');
  assert.strictEqual(Object.keys(strings).filter((k) => strings[k] === "Notes").length, 1);
});

test("same slug base but different text is disambiguated", () => {
  const { strings } = tagHtml('<th title="Refining">a</th><th title="refining!">b</th>');
  assert.strictEqual(strings.refining, "Refining");
  assert.strictEqual(strings.refining_2, "refining!");
});

test("entities are decoded in the string table but left alone in the HTML", () => {
  const { html, strings } = tagHtml("<th>Buy &amp; Sell</th>");
  assert.strictEqual(strings.buy_sell, "Buy & Sell");
  assert.ok(html.includes("Buy &amp; Sell"), "HTML text stays encoded");
});

console.log("\n=== idempotency ===");

const FIXTURE = `
<h2 style="gap:12px">
  <span data-i18n="black_zone_bonuses_reference">Black Zone Crafting</span>
  <input id="search-bz" class="table-search" placeholder="Filter… e.g. q4" data-i18n-ph="filter_e_g_q4" />
</h2>
<table id="bz">
  <thead>
    <tr>
      <th title="Zone quality of the region (1-6)" data-i18n-title="bz_zone_quality_tip" data-i18n="zone_quality">Zone Quality</th>
      <th>Power Level</th>
    </tr>
  </thead>
</table>
<button id="scan" title="Fetch prices">Scan Market Now</button>
`;

test("a second run produces byte-identical HTML", () => {
  const once = tagHtml(FIXTURE).html;
  const twice = tagHtml(once).html;
  assert.strictEqual(twice, once, "generator must be idempotent");
});

test("already-tagged elements never get a duplicate attribute", () => {
  const once = tagHtml(FIXTURE).html;
  const twice = tagHtml(once).html;
  assert.strictEqual(countOf(twice, "data-i18n-title="), 2,
    "one per titled element (the pre-tagged th + the button)");
  assert.strictEqual(countOf(twice, "data-i18n-ph="), 1);
  assert.strictEqual(countOf(twice, 'data-i18n="zone_quality"'), 1);
});

test("hand-authored slugs are preserved, not re-slugged", () => {
  const { html, strings } = tagHtml(FIXTURE);
  assert.ok(html.includes('data-i18n-title="bz_zone_quality_tip"'), "hand slug kept in HTML");
  assert.strictEqual(strings.bz_zone_quality_tip, "Zone quality of the region (1-6)",
    "hand-authored key must be harvested into the EN table");
  assert.strictEqual(strings.black_zone_bonuses_reference, "Black Zone Crafting");
  assert.strictEqual(strings.filter_e_g_q4, "Filter… e.g. q4");
  assert.ok(!("zone_quality_of_the_region_1_6" in strings),
    "must not mint a second slug for text that already has one");
});

test("untagged siblings still get tagged on a re-run", () => {
  const { html, strings } = tagHtml(FIXTURE);
  assert.ok(html.includes('<th data-i18n="power_level">Power Level</th>'), html);
  assert.strictEqual(strings.power_level, "Power Level");
  assert.strictEqual(strings.scan_market_now, "Scan Market Now");
  assert.strictEqual(strings.fetch_prices, "Fetch prices");
});

console.log("\n=== HTML comments ===");

test("comments are never rewritten", () => {
  const src = `<!-- <div> (not <h2>) on purpose: the h2 wiring binds a heading
       to the next <table>, and this section has no table. -->
<h2>Real Heading</h2>`;
  const { html } = tagHtml(src);
  assert.ok(html.includes("<!-- <div> (not <h2>) on purpose: the h2 wiring binds a heading"),
    "comment text must be byte-identical");
  assert.ok(!/<!--[\s\S]*?data-i18n[\s\S]*?-->/.test(html), "no tagging inside comments");
  assert.ok(html.includes('<span data-i18n="real_heading">Real Heading</span>'),
    "real heading outside the comment still gets tagged");
});

test("text inside a comment does not enter the EN table", () => {
  const { strings } = tagHtml('<!-- <th>Ghost Column</th> --><th>Live Column</th>');
  assert.ok(!("ghost_column" in strings), "commented-out markup must be ignored");
  assert.strictEqual(strings.live_column, "Live Column");
});

console.log("\n=== emitted table ===");

// Slugs the generator always emits because JS builds those labels at runtime —
// no HTML fixture can produce them, so harvested-from-markup assertions have to
// subtract them out. Read from the generator rather than restated: the list
// grows (the window show is a second page this generator never walks), and
// a hand-copied duplicate goes stale the first time it does.
const RUNTIME_SLUGS = Object.keys(RUNTIME_STRINGS);
const harvested = (strings) =>
  Object.keys(strings).filter((k) => !RUNTIME_SLUGS.includes(k));

test("strings are returned sorted by slug", () => {
  const { strings } = tagHtml("<th>Zulu</th><th>Alpha</th><th>Mike</th>");
  assert.deepStrictEqual(harvested(strings), ["alpha", "mike", "zulu"]);
  // …and the runtime extras sort in with everything else, not appended.
  assert.deepStrictEqual(Object.keys(strings), [...Object.keys(strings)].sort());
});

test("runtime-only strings survive a run over markup that lacks them", () => {
  const { strings } = tagHtml("<th>Zulu</th>");
  RUNTIME_SLUGS.forEach((slug) =>
    assert.ok(strings[slug], `${slug} kept in the table`),
  );
});

test("numeric entities are decoded in the harvested English", () => {
  const { strings } = tagHtml('<button data-i18n="specs">&#9881; Specs</button>');
  assert.strictEqual(strings.specs, "⚙ Specs");
});

test("empty / whitespace-only text is skipped", () => {
  const { html, strings } = tagHtml('<th>   </th><button title=" "> </button>');
  assert.ok(!html.includes("data-i18n"), "nothing to translate");
  assert.deepStrictEqual(harvested(strings), []);
});

console.log(`\n${"=".repeat(50)}`);
test("symbol-only labels (the ✕ clear buttons) are not tagged", () => {
  const { html, strings } = tagHtml('<button type="button">✕</button><th>✓</th>');
  assert.ok(!html.includes("data-i18n"), html);
  assert.ok(!("x" in strings), "no fallback x slug");
});

console.log("\n=== committed tree is a fixed point ===");

const fs = require("fs");
const path = require("path");
const { renderEnModule, tagSources, sourceFiles } = require("../scripts/gen-i18n-index.cjs");
const lf = (t) => t.replace(/\r\n/g, "\n");
const root = path.resolve(__dirname, "..");

test("running the generator over the committed index.html changes nothing", () => {
  // index.html and its js/partials/group-*.js are tagged as one document.
  const files = sourceFiles(root);
  const srcs = files.map((f) => lf(fs.readFileSync(f, "utf8")));
  const out = tagSources(srcs);
  out.texts.forEach((t, i) => assert.strictEqual(t, srcs[i], path.relative(root, files[i]) + " would be rewritten"));
  const committed = lf(fs.readFileSync(path.join(root, "js", "i18n-strings-en.js"), "utf8"));
  assert.strictEqual(renderEnModule(out.strings), committed, "js/i18n-strings-en.js would be rewritten");
});

console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
