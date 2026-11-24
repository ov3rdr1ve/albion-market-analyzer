/**
 * Test: the Route column's city names are click-to-override prices.
 *
 * "Buy: Thetford → Refine: Martlock → Sell: Caerleon" names the two cities every
 * other number on the row is built from, and it used to be dead text — the only
 * way to correct one of those prices was to find the matching cell in the
 * Materials or Sell column, which on a wide table is off-screen.
 *
 * The contract the whole app already uses for a price cell (js/app.js
 * matPriceSpan / priceTd, js/price-edit-dropdown.js buildCityOptions) is a
 * `price-editable` element carrying data-item-id / data-city / data-raw-price /
 * data-city-list. Emitting that is all a new cell has to do — the delegated
 * handler needs no wiring. So this pins the markup, not a click.
 *
 * Legs that name a PLACE rather than a price (the craft/refine station) stay
 * plain: there is nothing to override there.
 *
 * The same rule applies inside the Craft Planner's Materials cell, where a
 * self-refined material used to render "(refine rock ▲ @ 69 ea ↗)" as a single
 * jump-to-another-table link — the one material line in the cell with no way to
 * set a price on it. The tag body is a price now; only the ↗ still jumps.
 *
 * Run: node tests/route-cell-editable.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { routeLeg, routeCityCell } = require(path.join(__dirname, "..", "js", "route-cell.js"));
const { readIndexHtml, readStyles } = require("./helpers/page-source.cjs");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

/** Pull the attributes off the single price-editable span in `html`. */
function editableAttrs(html) {
  const spans = html.match(/<span class="price-editable[^>]*>/g) || [];
  return spans.map((tag) => {
    const attr = (n) => {
      const m = tag.match(new RegExp(`${n}="([^"]*)"`));
      return m ? m[1] : null;
    };
    return {
      itemId: attr("data-item-id"),
      city: attr("data-city"),
      rawPrice: attr("data-raw-price"),
      side: attr("data-city-list"),
    };
  });
}

console.log("\n=== routeLeg: one leg of a route ===");

// [name, part, expectations]
const LEG_CASES = [
  [
    "a priced leg becomes an editable span",
    { label: "Buy", city: "Thetford", itemId: "T4_ORE", side: "buy", price: 120 },
    (html) => {
      assert.ok(html.startsWith("Buy: "), "the label stays outside the click target");
      assert.deepStrictEqual(editableAttrs(html), [
        { itemId: "T4_ORE", city: "Thetford", rawPrice: "120", side: "buy" },
      ]);
      assert.ok(html.includes(">Thetford</span>"), "the city name is the click target");
    },
  ],
  [
    "a sell leg reads the sell order book",
    { label: "Sell", city: "Caerleon", itemId: "T4_METALBAR", side: "sell", price: 900 },
    (html) => assert.strictEqual(editableAttrs(html)[0].side, "sell"),
  ],
  [
    "an unknown side falls back to sell, never to an invalid value",
    { label: "Sell", city: "Caerleon", itemId: "T4_METALBAR", side: "elsewhere" },
    (html) => assert.strictEqual(editableAttrs(html)[0].side, "sell"),
  ],
  [
    "a leg with no itemId is a place, not a price",
    { label: "Refine", city: "Martlock" },
    (html) => {
      assert.strictEqual(html, "Refine: Martlock");
      assert.deepStrictEqual(editableAttrs(html), []);
    },
  ],
  [
    "a missing price renders 0, not NaN or undefined",
    { label: "Sell", city: "Caerleon", itemId: "T4_BAG", side: "sell" },
    (html) => assert.strictEqual(editableAttrs(html)[0].rawPrice, "0"),
  ],
  [
    "a suffix badge rides outside the click target",
    { label: "Craft", city: "Martlock", suffix: "<small>(no spec)</small>" },
    (html) => assert.strictEqual(html, "Craft: Martlock<small>(no spec)</small>"),
  ],
  [
    "a leg with no label is just the city",
    { city: "Bridgewatch", itemId: "T4_BAG", side: "sell", price: 5 },
    (html) => assert.ok(html.startsWith("<span"), `got ${html}`),
  ],
];

LEG_CASES.forEach(([name, part, check]) => test(name, () => check(routeLeg(part))));

test("a quote or a tag in a city or id cannot break out of the markup", () => {
  const html = routeLeg({ label: "Buy", city: 'Odd" <b>x', itemId: 'T4_A"B', side: "buy", price: 1 });
  // One tag, and it is ours: nothing the caller passed became an element or an
  // attribute of its own.
  assert.deepStrictEqual(html.match(/<[a-z/]/gi), ["<s", "</"], `injected markup: ${html}`);
  assert.deepStrictEqual(editableAttrs(html), [
    { itemId: "T4_A&quot;B", city: "Odd&quot; &lt;b&gt;x", rawPrice: "1", side: "buy" },
  ]);
});

test("a plain (unpriced) leg escapes its city too", () => {
  assert.strictEqual(routeLeg({ label: "Craft", city: "A<b>B" }), "Craft: A&lt;b&gt;B");
});

console.log("\n=== routeCityCell: the whole <td> ===");

test("the cell carries the width-cap class the CSS targets", () => {
  const html = routeCityCell([{ label: "Sell", city: "Caerleon", itemId: "T4_BAG", side: "sell", price: 1 }]);
  assert.ok(html.startsWith('<td class="cell-route"'), html);
  assert.ok(html.endsWith("</td>"));
});

test("legs are joined with the route arrow", () => {
  const html = routeCityCell([
    { label: "Buy", city: "Thetford", itemId: "T4_ORE", side: "buy", price: 120 },
    { label: "Refine", city: "Martlock" },
    { label: "Sell", city: "Caerleon", itemId: "T4_METALBAR", side: "sell", price: 900 },
  ]);
  assert.strictEqual((html.match(/ → /g) || []).length, 2);
  assert.deepStrictEqual(editableAttrs(html).map((a) => a.city), ["Thetford", "Caerleon"]);
  assert.ok(html.includes("Refine: Martlock"), "the station leg is still shown, just not clickable");
});

test("a leg with no city is dropped, not rendered as a dangling separator", () => {
  const html = routeCityCell([
    { label: "Buy", city: "Thetford", itemId: "T4_ORE", side: "buy", price: 1 },
    { label: "Sell", city: "", itemId: "T4_METALBAR", side: "sell", price: 0 },
  ]);
  assert.ok(!html.includes("→"), `got ${html}`);
  assert.ok(!html.includes("Sell:"));
});

test("trailing HTML (fee badges) lands after the last leg, outside every span", () => {
  const html = routeCityCell(
    [{ label: "Sell", city: "Brecilien", itemId: "T4_BAG", side: "sell", price: 1 }],
    { trailing: "<small>fee</small>" },
  );
  assert.ok(html.endsWith("<small>fee</small></td>"), html);
});

test("an inline style is applied to the cell, not to a leg", () => {
  const html = routeCityCell([{ label: "Craft", city: "Martlock" }], { style: "color:#6b7280" });
  assert.ok(html.startsWith('<td class="cell-route" style="color:#6b7280">'), html);
});

test("an empty parts list is still a valid cell", () => {
  assert.strictEqual(routeCityCell([]), '<td class="cell-route"></td>');
  assert.strictEqual(routeCityCell(null), '<td class="cell-route"></td>');
});

console.log("\n=== every route column goes through the helper ===");

// [file, how many priced legs its route cell must offer]
const ROUTE_TABLES = [
  ["js/render-flipping.js", ["buy", "sell"]],
  ["js/render-transport.js", ["buy", "sell"]],
  ["js/render-crafting.js", ["buy", "sell"]],
  ["js/render-consumables-row.js", ["buy", "sell"]],
  ["js/render-craft-planner.js", ["sell"]],
];

ROUTE_TABLES.forEach(([file, sides]) => {
  test(`${file} builds its route cell with routeCityCell`, () => {
    const src = read(file);
    assert.ok(/routeCityCell\(/.test(src), "no routeCityCell call");
    sides.forEach((side) => {
      assert.ok(
        new RegExp(`side:\\s*"${side}"`).test(src),
        `no ${side}-side leg — that half of the route stays unclickable`,
      );
    });
  });
});

test("the page loads the module before the tables that use it", () => {
  const html = readIndexHtml();
  const helper = html.indexOf('src="js/route-cell.js"');
  assert.ok(helper > 0, "js/route-cell.js is not loaded");
  ["render-flipping.js", "render-transport.js", "render-crafting.js",
    "render-consumables.js", "render-craft-planner.js"].forEach((f) => {
    const at = html.indexOf(`src="js/${f}"`);
    assert.ok(at > helper, `${f} is loaded before the helper it calls`);
  });
});

test("the city names carry the same affordance every other price span has", () => {
  // The cell-* rules moved to css/table-density.css when styles.css outgrew the
  // project's 800-line limit; the two ship as one sheet, in link order.
  const css = [readStyles(), ...["css/table-density.css"].map(read)].join("\n");
  const block = css.slice(css.indexOf(".data-table td.cell-route .price-editable"));
  assert.ok(block.startsWith(".data-table td.cell-route .price-editable"), "no rule for the route spans");
  assert.ok(/underline dotted/.test(block.slice(0, 200)), "no dotted underline");
  assert.ok(/cursor:\s*pointer/.test(block.slice(0, 200)), "no pointer cursor");
});

console.log("\n=== Craft Planner: the refine tag sets a price, the ↗ jumps ===");

const plannerSrc = read("js/render-craft-planner.js");
const matLine = plannerSrc.slice(
  plannerSrc.indexOf("function _cpMatLine"),
  plannerSrc.indexOf("// Best Focus cell"),
);

test("the refine tag is a price-editable span for the material", () => {
  assert.ok(/class="price-editable"/.test(matLine), "the refine tag is not editable");
  assert.ok(/data-item-id="\$\{s\.matId\}"/.test(matLine), "it must price the material itself");
  assert.ok(/data-city-list="buy"/.test(matLine), "buying the bar is the alternative it is beating");
});

test("the tag no longer wraps the whole line in the jump link", () => {
  assert.ok(!/_cpJumpToRefine\(s\.matId, tag\)/.test(matLine),
    "the whole tag is still a jump — there is no way to set a price on it");
});

test("the ↗ still jumps to the Refining / Transports row", () => {
  assert.ok(/_cpRefineJumpArrow\(s\.matId\)/.test(matLine), "the jump affordance was lost entirely");
  const arrow = plannerSrc.slice(plannerSrc.indexOf("function _cpRefineJumpArrow"));
  assert.ok(/_cpJumpToRefine\(/.test(arrow.slice(0, 400)), "the arrow must use the shared jump wrapper");
  assert.ok(arrow.slice(0, 400).includes("↗"), "the arrow glyph moved out of the jump target");
});

test("the Best Focus cell still links its refine play", () => {
  // _cpJumpToRefine is shared with focusPlayCell's linkRefine — splitting the
  // materials tag must not have taken that with it.
  assert.ok(/linkRefine:\s*_cpJumpToRefine/.test(plannerSrc));
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
