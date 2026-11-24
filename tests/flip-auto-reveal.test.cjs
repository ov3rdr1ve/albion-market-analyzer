/**
 * Test: the Flipping table reveals a profitable .1-.4 row by itself.
 *
 * Reported: "if the 8.4 flip is profitable I cannot see it until I specifically
 * expand the row to 8.4 — if it is profitable it should show as a separate
 * entry, and a row holding profitable .1-.4 items should already be expanded."
 *
 * Two things are under test and they are deliberately separate:
 *
 *   1. the ask-and-bid pre-gate, which is what keeps this affordable — a route
 *      search is only spent on a variant whose book already has both sides,
 *   2. the expansion state, which has to survive the user disagreeing with it:
 *      a base this file opened must close on a click and STAY closed, and a
 *      base the user opens must show the whole ladder, not only the profitable
 *      levels.
 *
 * Black-box over the REAL js/flip-auto-reveal.js and js/flip-enchant-variants.js
 * with an injected row builder — no route search, no DOM, no live API. The row
 * shapes are the ones buildFlipRowData returns (js/render-flipping.js).
 *
 * Run: node tests/flip-auto-reveal.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const stubs = [
  "const expandedCraftItems = new Set();",
  'let _ench = "";',
  "function activeEnchantFilter() { return _ench; }",
  "function __setEnch(v) { _ench = v; }",
  "function __expanded() { return expandedCraftItems; }",
  "",
].join("\n");

const exports_ = "\nmodule.exports = { flipVariantCouldRoute, flipAutoRevealLevels,"
  + " setFlipAutoRevealed, flipAutoRevealedLevels, isFlipExpanded, flipToggleExpand,"
  + " resetFlipAutoReveal, expandFlipItems, __setEnch, __expanded };";

const mod = new Module("flip-auto-reveal");
mod._compile(
  stubs + J("flip-enchant-variants.js") + J("flip-auto-reveal.js") + exports_,
  "flip-auto-reveal.js",
);
const A = mod.exports;

const BASE = "T8_SHOES_LEATHER_HELL";
const OTHER = "T8_2H_INFERNOSTAFF";
const FLAT = "T8_LEATHER";          // never enchants
const CAE = "Caerleon";
const BM = "Black Market";

const catalog = [
  { id: BASE, name: "Elder's Hellion Shoes [T8]", tier: 8 },
  { id: OTHER, name: "Elder's Wild Staff [T8]", tier: 8 },
  { id: FLAT, name: "Elder's Leather [T8]", tier: 8 },
];

/** A row as buildFlipRowData returns one. */
const priced = (profit) => ({ noData: false, marginInfo: { profit, margin: 10 } });
const blank = () => ({ noData: true, marginInfo: { margin: -1 } });

/** A row builder that pays out only for the variant ids named. */
function builderFor(profitable) {
  return (variant) => {
    const hit = profitable[variant.id];
    return [hit === undefined ? blank() : priced(hit)];
  };
}

/** A book with both sides, so the pre-gate lets the id through. */
const bothSides = (id) => ({ [id]: { [CAE]: { sell_price: 1 }, [BM]: { buy_price: 2 } } });

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    A.resetFlipAutoReveal();
    A.__expanded().clear();
    A.__setEnch("");
    fn();
    console.log("  PASS: " + name);
    passed++;
  } catch (e) {
    console.error("  FAIL: " + name + " - " + e.message);
    failed++;
  }
}

console.log("Flipping auto-reveal tests\n");

// -- 1. the pre-gate -------------------------------------------------------
test("a book with an ask and a bid is a candidate", () => {
  const flat = {
    X: { [CAE]: { sell_price: 100, buy_price: 0 }, [BM]: { buy_price: 200, sell_price: 0 } },
  };
  assert.strictEqual(A.flipVariantCouldRoute("X", flat, null), true);
});

test("a bid with no ask is NOT a candidate - it cannot route", () => {
  const flat = { X: { [BM]: { buy_price: 3850938, sell_price: 0 } } };
  assert.strictEqual(A.flipVariantCouldRoute("X", flat, null), false);
});

test("an ask with no bid is NOT a candidate either", () => {
  const flat = { X: { [CAE]: { sell_price: 16999999, buy_price: 0 } } };
  assert.strictEqual(A.flipVariantCouldRoute("X", flat, null), false);
});

test("an id with no book at all is not a candidate", () => {
  assert.strictEqual(A.flipVariantCouldRoute("X", {}, {}), false);
});

test("the two sides may come from different qualities of the same book", () => {
  // A captured gear book is routinely Good or Outstanding with nothing Normal
  // in it, so the gate reads the quality map too. Whether the two sides can
  // actually be PAIRED is the route search's call, not this one's.
  const quality = {
    X: {
      2: { [CAE]: { sell_price: 100, buy_price: 0 } },
      3: { [BM]: { buy_price: 200, sell_price: 0 } },
    },
  };
  assert.strictEqual(A.flipVariantCouldRoute("X", {}, quality), true);
});

test("volume without a price is not a side", () => {
  const flat = { X: { [CAE]: { sell_price: 0, buy_price: 0, volume_24h: 900 } } };
  assert.strictEqual(A.flipVariantCouldRoute("X", flat, null), false);
});

// -- 2. which levels earn a row -------------------------------------------
test("a profitable variant is revealed, an unprofitable one is not", () => {
  const flat = Object.assign({}, bothSides(BASE + "@4"), bothSides(BASE + "@1"));
  const map = A.flipAutoRevealLevels(catalog, flat, null, builderFor({
    [BASE + "@4"]: 500000,
    [BASE + "@1"]: -20,
  }));
  assert.deepStrictEqual([...(map.get(BASE) || [])], [4]);
});

test("a variant that cannot price is never revealed", () => {
  const map = A.flipAutoRevealLevels(catalog, bothSides(BASE + "@2"), null, builderFor({}));
  assert.strictEqual(map.size, 0);
});

test("zero profit is not profit", () => {
  const map = A.flipAutoRevealLevels(catalog, bothSides(BASE + "@2"), null,
    builderFor({ [BASE + "@2"]: 0 }));
  assert.strictEqual(map.size, 0);
});

test("the row builder is spared every variant the pre-gate turned down", () => {
  const seen = [];
  A.flipAutoRevealLevels(catalog, bothSides(BASE + "@3"), null, (variant) => {
    seen.push(variant.id);
    return [priced(1)];
  });
  assert.deepStrictEqual(seen, [BASE + "@3"], "one route search, not eight");
});

test("a non-enchantable catalog entry contributes nothing", () => {
  const map = A.flipAutoRevealLevels(catalog, bothSides(FLAT + "@1"), null,
    builderFor({ [FLAT + "@1"]: 999 }));
  assert.strictEqual(map.size, 0);
});

test("several levels of one base are all reported, ascending", () => {
  const flat = Object.assign({}, bothSides(BASE + "@1"), bothSides(BASE + "@3"),
    bothSides(BASE + "@4"));
  A.setFlipAutoRevealed(A.flipAutoRevealLevels(catalog, flat, null, builderFor({
    [BASE + "@1"]: 5, [BASE + "@3"]: 5, [BASE + "@4"]: 5,
  })));
  assert.deepStrictEqual(A.flipAutoRevealedLevels(BASE), [1, 3, 4]);
});

// -- 3. expansion state ----------------------------------------------------
function revealBase4() {
  A.setFlipAutoRevealed(A.flipAutoRevealLevels(catalog, bothSides(BASE + "@4"), null,
    builderFor({ [BASE + "@4"]: 500000 })));
}

test("an auto-revealed base reads as expanded", () => {
  revealBase4();
  assert.strictEqual(A.isFlipExpanded(BASE), true);
  assert.strictEqual(A.isFlipExpanded(OTHER), false);
});

test("clicking an auto-expanded base closes it, and it stays closed", () => {
  revealBase4();
  assert.strictEqual(A.flipToggleExpand(BASE), false);
  assert.strictEqual(A.isFlipExpanded(BASE), false);
  revealBase4();                        // the next render recomputes the same map
  assert.strictEqual(A.isFlipExpanded(BASE), false, "the close must survive it");
  assert.deepStrictEqual(A.flipAutoRevealedLevels(BASE), []);
});

test("re-opening a closed base shows the whole ladder, not just the winners", () => {
  revealBase4();
  A.flipToggleExpand(BASE);
  assert.strictEqual(A.flipToggleExpand(BASE), true);
  assert.strictEqual(A.__expanded().has(BASE), true);
  const ids = A.expandFlipItems(catalog).map((i) => i.id);
  [1, 2, 3, 4].forEach((n) => assert.ok(ids.includes(BASE + "@" + n), "missing ." + n));
});

test("a base the user expanded is untouched by a later auto-reveal", () => {
  A.__expanded().add(OTHER);
  revealBase4();
  assert.strictEqual(A.isFlipExpanded(OTHER), true);
  assert.strictEqual(A.flipToggleExpand(OTHER), false);
  assert.strictEqual(A.__expanded().has(OTHER), false);
});

// -- 4. the row set expandFlipItems emits ----------------------------------
test("only the profitable level is materialised, and it sits under its base", () => {
  revealBase4();
  assert.deepStrictEqual(A.expandFlipItems(catalog).map((i) => i.id),
    [BASE, BASE + "@4", OTHER, FLAT]);
});

test("nothing is materialised when no variant is worth a row", () => {
  A.setFlipAutoRevealed(new Map());
  assert.deepStrictEqual(A.expandFlipItems(catalog).map((i) => i.id), [BASE, OTHER, FLAT]);
});

test("an explicit Ench. pick wins over the auto-reveal", () => {
  revealBase4();
  A.__setEnch("2");
  const ids = A.expandFlipItems(catalog).map((i) => i.id);
  assert.ok(ids.includes(BASE + "@2"), "the pick is honoured");
  assert.ok(!ids.includes(BASE + "@4"), "and it does not leak other levels");
});

test("the base-only pick suppresses the auto-reveal too", () => {
  // ".0" is a pick like any other - it selects the base rows, and a .1-.4 row
  // appearing under it would read as the picker leaking.
  revealBase4();
  A.__setEnch("0");
  assert.deepStrictEqual(A.expandFlipItems(catalog).map((i) => i.id), [BASE, OTHER, FLAT]);
});

test("an auto-revealed variant row carries its base id, for nesting", () => {
  revealBase4();
  const variant = A.expandFlipItems(catalog).find((i) => i.id === BASE + "@4");
  assert.strictEqual(variant.baseId, BASE);
  assert.strictEqual(variant.enchantVariant, 4);
  assert.strictEqual(variant.name, "Elder's Hellion Shoes [T8.4]");
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
