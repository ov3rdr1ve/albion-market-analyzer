/**
 * Test (TLD): the Crafting Planner "best path" line.
 *
 * Every material in the Materials cell is followed by one plain line naming, in
 * words, the route the row actually took to get it: "buy it (from city)" or
 * "refine it yourself wood ▲", with the raw-side substitution the refine used
 * tagged on the end. It quotes no price — the material line directly above it
 * already prints that number as the editable span that fixes it.
 *
 * It replaced an expandable panel that nested a whole sourcing tree and an
 * "other craft cities" comparison under the row. A row has exactly one path, so
 * the path is printed instead of hidden behind a click — and the nested tree is
 * not printed at all: the Materials column is width-capped.
 *
 * The line is read straight off the row's own `sourcing` entry (the winner
 * js/craft-planner-pricing.js booked), so it re-prices nothing and cannot
 * contradict the Cost cell. That is what these cases pin: a given sourcing shape
 * always produces the same words.
 *
 * Black-box over the real js/render-craft-planner-paths.js with synthetic
 * sourcing objects. No live API.
 *
 * Run: node tests/craft-planner-paths-render.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const sandbox = `
function tx(en) { return en; }
function getItemDisplayName(id) { return id; }
function formatSilver(n) { return n == null ? "N/A" : Math.round(n).toLocaleString(); }
function matPriceSpan(id, city, price) {
  return "<span class='mat' data-item-id='" + id + "' data-city='" + (city || "") + "'>@ " + (price > 0 ? formatSilver(price) : "no data") + " ea</span>";
}
`;

const load = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const mod = new Module("craft-planner-paths-render");
mod._compile(
  sandbox + load("js/render-craft-planner-paths.js")
    + "\nmodule.exports = { cpBestPathLine, cpEnchantPathLine };",
  "craft-planner-paths-render.js",
);
const { cpBestPathLine, cpEnchantPathLine } = mod.exports;

const CITY = "Martlock";
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

/** One entry of row.sourcing, shaped like computeCraftPlannerRow's output. */
function mat(matId, sourcing, count = 16) {
  return { matId, origMatId: matId, count, isArtifact: false, sourcing };
}
const market = (city, perUnit) => ({ source: "market", city, perUnit });
const chain = (inputs = [], perUnit = 4120) =>
  ({ source: "chain", perUnit, chain: { resourceType: "wood", inputs } });
const input = (matId, source) => ({ matId, sourcing: { source } });

console.log("\n=== Shape ===");

test("always one cp-best-path div, whatever the route", () => {
  const cases = [
    mat("T6_PLANKS", market(CITY, 1000)),
    mat("T6_PLANKS", chain()),
    mat("T6_PLANKS", {}),
  ];
  cases.forEach((s) => {
    const html = cpBestPathLine(s, CITY);
    assert.strictEqual((html.match(/class="cp-best-path"/g) || []).length, 1,
      `expected exactly one line for ${JSON.stringify(s.sourcing)}`);
    assert.ok(html.includes("best path:"), "expected the label");
  });
});

test("prints no chain tree — the panel's nested breakdown is gone", () => {
  const html = cpBestPathLine(mat("T6_PLANKS", chain([input("T6_WOOD", "market")])), CITY);
  assert.ok(!html.includes("chain-indent"), "expected no nested tree");
  assert.ok(!html.includes("cp-paths-"), "expected none of the old panel classes");
});

console.log("\n=== Bought materials ===");

test("a market material says buy it, and names the city it comes from", () => {
  const html = cpBestPathLine(mat("T6_PLANKS", market("Bridgewatch", 5571)), CITY);
  assert.ok(html.includes("buy it"), "expected the buy label");
  assert.ok(html.includes("(from Bridgewatch)"), "expected the from-city tag");
  assert.ok(!html.includes("refine it yourself"), "a bought material never refines");
});

// The material line directly above prints the same price, as the editable span
// that fixes it. Printing it twice put two identical spans in one cell.
test("quotes no price and adds no second price span", () => {
  const cases = [
    mat("T6_PLANKS", market("Bridgewatch", 5571)),
    mat("T6_PLANKS", chain([input("T6_WOOD", "market")], 4120)),
  ];
  cases.forEach((s) => {
    const html = cpBestPathLine(s, CITY);
    assert.ok(!html.includes("class='mat'"), `unexpected price span: ${html}`);
    assert.ok(!/[0-9],[0-9]{3}/.test(html), `unexpected figure: ${html}`);
  });
});

test("falls back to the craft city when the sourcing names none", () => {
  const html = cpBestPathLine(mat("T6_PLANKS", market(null, 1000)), CITY);
  assert.ok(html.includes(`(from ${CITY})`), "expected the from-city tag");
});

test("an unpriced material still names its route", () => {
  const html = cpBestPathLine(mat("T6_PLANKS", market(CITY, 0)), CITY);
  assert.ok(html.includes("buy it"), "expected the buy label");
  assert.ok(html.includes(`(from ${CITY})`), "expected the from-city tag");
});

test("an empty sourcing degrades to a buy line, never to a broken refine", () => {
  const html = cpBestPathLine(mat("T6_PLANKS", {}), CITY);
  assert.ok(html.includes("buy it"), "expected the buy label");
  assert.ok(!html.includes("undefined"), "expected no undefined in the output");
});

console.log("\n=== Self-refined materials ===");

test("a chain material says refine it yourself, with the resource type", () => {
  const html = cpBestPathLine(mat("T6_PLANKS", chain([input("T6_WOOD", "market")], 4120)), CITY);
  assert.ok(html.includes("refine it yourself"), "expected the refine label");
  assert.ok(html.includes("wood ▲"), "expected the resource type");
  assert.ok(!html.includes("buy it"), "a refined material is not bought");
});

test("a plain refine carries no mechanism tag", () => {
  const html = cpBestPathLine(mat("T6_PLANKS", chain([input("T6_WOOD", "market")])), CITY);
  assert.ok(!html.includes("via transmute"), "expected no transmute tag");
  assert.ok(!html.includes("(with "), "expected no heart tag");
});

test("a transmuted raw leg is tagged (via transmute)", () => {
  const html = cpBestPathLine(mat("T6_PLANKS", chain([input("T6_WOOD", "transmute")])), CITY);
  assert.ok(html.includes("refine it yourself"), "expected the refine label");
  assert.ok(html.includes("(via transmute)"), "expected the transmute tag");
});

test("a faction heart names the heart it stands in for", () => {
  const html = cpBestPathLine(
    mat("T6_PLANKS", chain([input("T1_FACTION_FOREST_TOKEN_1", "heart"), input("T6_WOOD", "market")])),
    CITY);
  assert.ok(html.includes("(with T1_FACTION_FOREST_TOKEN_1)"), "expected the heart tag");
});

test("heart wins over transmute when both fire on the same node", () => {
  const html = cpBestPathLine(
    mat("T6_PLANKS", chain([input("T1_FACTION_FOREST_TOKEN_1", "heart"), input("T6_WOOD", "transmute")])),
    CITY);
  assert.ok(html.includes("(with T1_FACTION_FOREST_TOKEN_1)"), "expected the heart tag");
  assert.ok(!html.includes("(via transmute)"), "the heart is the reported mechanism");
});

console.log("\n=== A material that is itself transmuted up ===");

test("names the node actually bought, not the material the recipe asks for", () => {
  const html = cpBestPathLine(mat("T6_PLANKS_LEVEL4@4", {
    source: "transmute",
    perUnit: 120000,
    transmute: { startId: "T6_PLANKS_LEVEL3@3", startCity: "Caerleon", startPrice: 80000, steps: [{}] },
  }), CITY);
  assert.ok(html.includes("buy T6_PLANKS_LEVEL3@3"), "expected the START node to be named");
  assert.ok(!html.includes("T6_PLANKS_LEVEL4@4"), "the recipe's material is not what is bought");
  assert.ok(html.includes("(from Caerleon)"), "expected the start node's city");
  assert.ok(html.includes("(via transmute)"), "expected the transmute tag");
});

console.log("\n=== A row obtained via enchant-up (enchantedVia) ===");

// The buy-and-enchant route the planner can book on .1-.3 rows
// (js/craft-planner-enchant-route.js): buy the @(n-1) item, enchant it up.
const via = {
  baseId: "T5_MAIN_SWORD", baseCity: "Fort Sterling", basePrice: 1000,
  matId: "T5_RUNE", matCount: 288, matCity: "Fort Sterling", matPrice: 100,
  cost: 30600,
};

test("names the enchant-up play and what to buy for it", () => {
  const html = cpEnchantPathLine(via);
  assert.ok(html.includes("cp-best-path"), "expected the shared line class");
  assert.ok(html.includes("enchant it yourself"), "expected the enchant label");
  assert.ok(html.includes("buy T5_MAIN_SWORD"), "expected the base item named");
  assert.ok(html.includes("288× T5_RUNE"), "expected the mat count and name");
  assert.ok(!/[0-9],[0-9]{3}/.test(html), "quotes no price (the lines above do)");
});

test("the color hint follows the enchanting table's transition colors", () => {
  const rune = cpEnchantPathLine(via);
  assert.ok(rune.includes("#7ab8c4"), "RUNE steps tint rune-blue");
  assert.ok(cpEnchantPathLine({ ...via, matId: "T6_SOUL" }).includes("#b07ac4"),
    "SOUL steps tint purple");
  assert.ok(cpEnchantPathLine({ ...via, matId: "T7_RELIC" }).includes("#c4a07a"),
    "RELIC steps tint amber");
});

test("a missing enchantedVia degrades to nothing, never to broken markup", () => {
  assert.strictEqual(cpEnchantPathLine(null), "");
  assert.strictEqual(cpEnchantPathLine({}), "");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
