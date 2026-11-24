/**
 * Test: every table that values focus carries the SAME pair of columns, wired to
 * the SAME standard (js/focus-play.js).
 *
 *   Silver/Focus  — the winning play's profitDelta ÷ its focusCost.
 *   Best Focus    — which play won, and what it adds to the row's end product.
 *
 * Part 1 — index.html wiring: every table that values focus reports Silver/Focus,
 *          and every table where a row has a CHOICE of placements also names the
 *          winner in a Best Focus column. Two tables deliberately have no such
 *          column: Crafting (it buys its materials, so the craft is the only
 *          focusable step and the column would say "Craft" forever) and the
 *          Crafting Planner (the model's origin — its rate lives inside the Best
 *          Focus cell). Also checks the sort keys and that no header still
 *          describes Silver/Focus as "profit ÷ focus".
 * Part 2 — renderer wiring: every focus renderer builds its figure through the
 *          shared helpers rather than calculateProfitPerFocus(wholeProfit, …),
 *          and emits a Best Focus cell where the table has one.
 * Part 3 — the shared cell renderer is the only Best Focus renderer left.
 *
 * Static/black-box over the shipped sources: the per-table arithmetic is proved
 * in each table's own test (crafting-silver-focus-marginal, farming-city-bonus,
 * refining-chain-focus-tier, consumables-chain-bonus-silver-focus,
 * craft-planner-pricing); this file guards the wiring that makes them one system.
 *
 * Run: node tests/focus-columns-standardized.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { readIndexHtml } = require("./helpers/page-source.cjs");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

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
    "js/render-consumable-chain-row.js",
    "js/render-consumable-no-data-row.js",
  ],
};
const readFamily = (rel) => (RENDERER_FAMILY[rel] || [rel]).map(read).join("\n");

const html = readIndexHtml();

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

function tableSection(id) {
  const i = html.indexOf(`<table id="${id}"`);
  assert.ok(i > 0, `no <table id="${id}"> in index.html`);
  const j = html.indexOf("</table>", i);
  return html.slice(i, j);
}

// Tables where a row has a CHOICE of focus placements, so naming the winner is
// worth a column. Two tables are deliberately absent:
//   • crafting-table — buys its materials, so the craft is its only focusable
//     step; a Best Focus column there would read "Craft" on every row forever.
//   • craft-planner-table — the origin of the model, and it shows Best Focus
//     alone (its Silver/Focus lives inside that cell).
const FOCUS_TABLES = [
  "transport-table",
  "consumable-table",
  "farming-table",
  "mounts-table",
];

// Every table that reports a Silver/Focus figure, whether or not it names the play.
const SILVER_PER_FOCUS_TABLES = ["crafting-table", ...FOCUS_TABLES];

console.log("\n=== Part 1: index.html column wiring ===");

FOCUS_TABLES.forEach((id) => {
  test(`${id} has both a Silver/Focus and a Best Focus column`, () => {
    const s = tableSection(id);
    assert.ok(/data-sort="profitPerFocus"/.test(s), "missing the Silver/Focus column");
    assert.ok(/data-sort="bestFocus"/.test(s), "missing the Best Focus column");
    assert.ok(/>Best Focus</.test(s), "Best Focus header has no label");
  });

  test(`${id} sorts Best Focus on its own key, next to Silver/Focus`, () => {
    const s = tableSection(id);
    const ppf = s.indexOf('data-sort="profitPerFocus"');
    const bf = s.indexOf('data-sort="bestFocus"');
    assert.ok(bf > ppf, "Best Focus should follow Silver/Focus so the pair reads together");
  });

  test(`${id}'s awaiting-scan colspan matches its header`, () => {
    const s = tableSection(id);
    const thCount = (s.match(/<th /g) || []).length;
    const colspan = Number((s.match(/colspan="(\d+)"/) || [])[1]);
    assert.strictEqual(colspan, thCount);
  });
});

test("Crafting has Silver/Focus but NO Best Focus column (only one play exists)", () => {
  const s = tableSection("crafting-table");
  assert.ok(/data-sort="profitPerFocus"/.test(s), "missing the Silver/Focus column");
  assert.ok(!/data-sort="bestFocus"/.test(s),
    "a Best Focus column here would name the craft on every row forever");
  assert.ok(!/>Best Focus</.test(s));
  const thCount = (s.match(/<th /g) || []).length;
  assert.strictEqual(Number((s.match(/colspan="(\d+)"/) || [])[1]), thCount);
});

test("Crafting's Silver/Focus header does not point at a column it lacks", () => {
  const th = (tableSection("crafting-table")
    .match(/<th[^>]*data-sort="profitPerFocus"[^>]*>/) || [""])[0];
  assert.ok(!/in the Best Focus column/.test(th),
    "the header must not reference a Best Focus column on this table");
  assert.ok(/Crafting Planner/.test(th),
    "it should point at the Planner, which does rank this play against refining");
});

test("the Crafting Planner keeps its Best Focus column on the shared sort key", () => {
  const s = tableSection("craft-planner-table");
  assert.ok(/data-sort="silverPerFocus"/.test(s), "planner sorts Best Focus on silverPerFocus");
  assert.ok(/>Best Focus</.test(s));
});

test("no Silver/Focus header still describes itself as the row's whole profit", () => {
  // "Pure Profit per craft ÷ focus cost" was the old, average definition. Any
  // table still advertising it has drifted off the standard.
  SILVER_PER_FOCUS_TABLES.forEach((id) => {
    const s = tableSection(id);
    const th = (s.match(/<th[^>]*data-sort="profitPerFocus"[^>]*>/) || [""])[0];
    assert.ok(!/Pure Profit per craft ÷ focus/i.test(th),
      `${id} still documents the average formula`);
  });
});

test("every Silver/Focus header points the reader at the Best Focus column", () => {
  FOCUS_TABLES.forEach((id) => {
    const s = tableSection(id);
    const th = (s.match(/<th[^>]*data-sort="profitPerFocus"[^>]*>/) || [""])[0];
    assert.ok(/Best Focus/.test(th), `${id}'s Silver/Focus header does not name Best Focus`);
  });
});

test("focus-play.js is loaded before the renderers that use it", () => {
  const fp = html.indexOf('src="js/focus-play.js"');
  assert.ok(fp > 0, "js/focus-play.js is not loaded in index.html");
  ["js/render-crafting.js", "js/render-transport.js", "js/render-consumables.js",
   "js/render-mounts.js", "js/render-farming.js", "js/craft-planner-pricing.js",
  ].forEach((f) => {
    const at = html.indexOf(`src="${f}"`);
    assert.ok(at > fp, `${f} loads before focus-play.js`);
  });
});

console.log("\n=== Part 2: renderer wiring ===");

// Renderer → does that file also RANK competing plays? A row with a single
// focusable step has nothing to rank (the Refining ladder's tiers are ranked
// inside pickCheapestFocusTier, one level down in refining-route.js).
const RENDERERS = {
  // cell: does this renderer emit a Best Focus cell? Crafting has one play, so it
  // reports the rate only.
  "js/render-crafting.js": { ranks: false, cell: false },
  "js/render-transport.js": { ranks: false, cell: true },
  "js/render-consumables.js": { ranks: true, cell: true },
  "js/render-mounts.js": { ranks: true, cell: true },
  "js/render-farming.js": { ranks: true, cell: true },
};

Object.keys(RENDERERS).forEach((f) => {
  const src = readFamily(f);
  test(`${f} scores its figure with the shared standard`, () => {
    assert.ok(/makeFocusPlay\(/.test(src), "does not build a focus play");
    if (RENDERERS[f].ranks) {
      assert.ok(/pickBestFocusPlay\(/.test(src), "does not rank its plays");
    }
    assert.ok(/focusPlayRate\(/.test(src),
      "Silver/Focus must be the winning play's rate");
  });

  test(`${f} ${RENDERERS[f].cell ? "renders" : "does not render"} a Best Focus cell`, () => {
    assert.strictEqual(/focusPlayCell\(/.test(src), RENDERERS[f].cell);
  });

  test(`${f} no longer divides a whole profit by a focus cost`, () => {
    // calculateProfitPerFocus(profit, focus) is the old average. It survives in
    // calculations.js for callers that legitimately want a ratio, but no focus
    // column may be built from it.
    assert.ok(!/calculateProfitPerFocus\(/.test(src),
      "still uses calculateProfitPerFocus for a focus column");
  });
});

test("the Refining row's play is built and rated by the shared standard", () => {
  const src = read("js/refining-route.js");
  assert.ok(/makeFocusPlay\(/.test(src), "no focus play built for a refine row");
  assert.ok(/focusPlayRate\(/.test(src), "Silver/Focus is not the play's rate");
  assert.ok(/pickCheapestFocusTier\(/.test(src),
    "the ladder tier must be chosen on the end product's profit");
});

test("the planner ranks candidates through the shared picker too", () => {
  const src = read("js/craft-planner-pricing.js");
  assert.ok(/pickBestFocusPlay\(/.test(src));
  assert.ok(/makeFocusPlay\(/.test(src));
});

test("the refining ladder picker has ONE objective (the end product's profit)", () => {
  const src = read("js/refining-chain-pricing.js");
  assert.ok(/function pickCheapestFocusTier\(/.test(src));
  assert.ok(!/function pickBestFocusTier\(/.test(src),
    "the rate-ranking picker must be gone — one objective, one picker");
});

console.log("\n=== Part 3: one Best Focus renderer ===");

test("focusPlayCell is defined once, in the shared module", () => {
  const defs = ["js/focus-play.js", "js/render-crafting.js", "js/render-transport.js",
    "js/render-consumables.js", "js/render-mounts.js", "js/render-farming.js",
    "js/render-craft-planner.js"]
    .filter((f) => /function focusPlayCell\(/.test(read(f)));
  assert.deepStrictEqual(defs, ["js/focus-play.js"]);
});

test("the planner's cell is a thin wrapper: its refine jump + the per-craft scale", () => {
  // The planner quotes a play PER CRAFT, and a refine play's own focusCost is
  // one single refine, so the cell hands focusPlayCell the row's per-craft focus
  // total and forces the /craft unit. It still computes no figure of its own.
  const src = read("js/render-craft-planner.js");
  const m = src.match(/function _cpFocusCell\(step, focusPerCraft\) \{([\s\S]*?)\n\}/);
  assert.ok(m, "_cpFocusCell not found");
  assert.ok(/focusPlayCell\(step, \{/.test(m[1]),
    "planner cell should delegate to focusPlayCell");
  assert.ok(/linkRefine: _cpJumpToRefine/.test(m[1]));
  assert.ok(/unit: "\/craft"/.test(m[1]),
    "a planner refine play's delta is per craft, not per refine");
  assert.ok(/focusPerExecution: focusPerCraft/.test(m[1]),
    "the rate must be scaled by the focus one craft burns");
  assert.ok(!/profitDelta|silverPerFocus/.test(m[1]),
    "planner cell should not re-implement the figures");
});

test("every play kind a renderer emits is one the shared module knows", () => {
  const { FOCUS_PLAY_UNITS } = require("../js/focus-play.js");
  const kinds = new Set();
  Object.keys(RENDERERS).concat("js/refining-route.js", "js/craft-planner-pricing.js")
    .forEach((f) => {
      for (const m of read(f).matchAll(/kind:\s*"(\w+)"/g)) kinds.add(m[1]);
    });
  assert.ok(kinds.size >= 4, `expected several play kinds, saw ${[...kinds]}`);
  [...kinds].forEach((k) => {
    assert.ok(FOCUS_PLAY_UNITS[k], `kind "${k}" has no unit in FOCUS_PLAY_UNITS`);
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
