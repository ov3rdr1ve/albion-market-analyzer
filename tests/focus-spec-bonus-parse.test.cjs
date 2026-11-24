/**
 * Test: the achievements.xml bonus parser inside scripts/gen-focus-spec-nodes.cjs.
 *
 * Every Destiny Board focus figure the app shows is built by this parser, and it
 * used to demand a fixed attribute order:
 *
 *   <bonus type="craftingfocuscostreduction" bonus="B" mintier="4" maxtier="8">
 *
 * Four elements in the dump are written the other way round —
 * `mintier maxtier type bonus` — and were silently dropped. All four happened to
 * be the big GROUP bonus of a specialization node:
 *
 *   CRAFT_BAG_BAG 3.1 · CRAFT_BAG_INSIGHT 3.1 · CRAFT_CAPE_CAPE 3.4 ·
 *   CRAFT_TOOL_SIEGEHAMMER_SIEGEHAMMER 3.1
 *
 * so a maxed crafter's bag, satchel, cape and siege hammer read 9,000 / 6,000 FCE
 * instead of 40,000 — 8.6x too much focus. XML attribute order carries no
 * meaning, so the parser must not care about it.
 *
 * Black-box: synthetic XML in, [nodeId, bonusPerLevel] families out. No dump and
 * no generated file is read.
 *
 * Run: node tests/focus-spec-bonus-parse.test.cjs
 */

const assert = require("assert");
const { parseNodes, familyFor, compilePatterns } = require("../scripts/gen-focus-spec-nodes.cjs");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// Build the family of one item id against a synthetic achievements document.
function familiesFrom(xml, itemId) {
  const nodes = parseNodes(xml);
  return familyFor(itemId, nodes, compilePatterns(nodes));
}

// One <templateachievement> wrapper — parseNodes only keeps blocks that carry a
// rewards section, the same way it skips <parentachievements> back-references.
function node(id, bonusesXml) {
  return `<templateachievement id="${id}" category="crafting">
    <title tag="@DESTINYBOARD_TITLE_${id}" />
    <baserewards>${bonusesXml}</baserewards>
    <parentachievements allrequired="false"><achievement id="SOMEPARENT" /></parentachievements>
  </templateachievement>`;
}

const FOCUS = "craftingfocuscostreduction";

console.log("Focus Spec Bonus Parse Tests\n");

// ── Attribute order must not matter. ───────────────────────────────────────
[
  ["type-first (the common form)", `type="${FOCUS}" bonus="3.1" mintier="4" maxtier="8"`],
  ["tier-first (the four dropped elements)", `mintier="4" maxtier="8" type="${FOCUS}" bonus="3.1"`],
  ["bonus before type", `bonus="3.1" type="${FOCUS}" mintier="4" maxtier="8"`],
  ["tiers split around type", `mintier="4" type="${FOCUS}" maxtier="8" bonus="3.1"`],
].forEach(([why, attrs]) => {
  test(`T4_BAG picks up a 3.1 bonus written as ${why}`, () => {
    const xml = node("CRAFT_BAG_BAG", `<bonus ${attrs}><itempattern pattern="T?_BAG" /></bonus>`);
    assert.deepStrictEqual(familiesFrom(xml, "T4_BAG"), [["CRAFT_BAG_BAG", 3.1]]);
  });
});

// ── The real bag block: category + group bonuses add up per node. ──────────
const BAG_XML = [
  node("CRAFT_BAG", `
    <bonus type="${FOCUS}" bonus="0.3" mintier="4" maxtier="8"><itempattern pattern="T?_BAG*" /></bonus>
    <bonus type="itemcraftquality" bonus="0.75" mintier="4" maxtier="8"><itempattern pattern="T?_BAG*" /></bonus>`),
  node("CRAFT_BAG_BAG", `
    <bonus type="${FOCUS}" bonus="0.3" mintier="4" maxtier="8"><itempattern pattern="T?_BAG*" /></bonus>
    <bonus bonus="0.75" type="itemcraftquality" mintier="4" maxtier="8"><itempattern pattern="T?_BAG*" /></bonus>
    <bonus mintier="4" maxtier="8" type="${FOCUS}" bonus="3.1"><itempattern pattern="T?_BAG" /></bonus>
    <bonus type="itemcraftquality" bonus="7.5" mintier="4" maxtier="8"><itempattern pattern="T?_BAG" /></bonus>`),
  node("CRAFT_BAG_INSIGHT", `
    <bonus type="${FOCUS}" bonus="0.3" mintier="4" maxtier="8"><itempattern pattern="T?_BAG*" /></bonus>
    <bonus bonus="0.75" type="itemcraftquality" mintier="4" maxtier="8"><itempattern pattern="T?_BAG*" /></bonus>
    <bonus mintier="4" maxtier="8" type="${FOCUS}" bonus="3.1"><itempattern pattern="T?_BAG_INSIGHT" /></bonus>
    <bonus type="itemcraftquality" bonus="7.5" mintier="4" maxtier="8"><itempattern pattern="T?_BAG_INSIGHT" /></bonus>`),
].join("\n");

// The in-game Destiny Board (screenshots 2026-08-16) reads, per level:
//   Bag Tailor                       +30  Bags
//   Bag Tailoring Specialist        +340  Bags                 (0.3 + 3.1)
//   Satchel of Insight Specialist    +30  Bags  +310  Satchels (0.3 | 3.1)
// so BOTH specialists feed bags, and each feeds only its own item with the
// group bonus. bonus × 100 = the per-level FCE the game prints.
[
  ["T4_BAG", [["CRAFT_BAG", 0.3], ["CRAFT_BAG_BAG", 3.4], ["CRAFT_BAG_INSIGHT", 0.3]]],
  ["T8_BAG_INSIGHT", [["CRAFT_BAG", 0.3], ["CRAFT_BAG_BAG", 0.3], ["CRAFT_BAG_INSIGHT", 3.4]]],
].forEach(([itemId, expected]) => {
  test(`${itemId} sums category + group per node`, () => {
    assert.deepStrictEqual(familiesFrom(BAG_XML, itemId), expected);
  });
});

test("bags and satchels are NOT the same family", () => {
  assert.notDeepStrictEqual(familiesFrom(BAG_XML, "T4_BAG"), familiesFrom(BAG_XML, "T4_BAG_INSIGHT"));
});

test("every node at 100 gives a bag 40,000 FCE, like any other maxed craft", () => {
  const total = familiesFrom(BAG_XML, "T6_BAG").reduce((sum, [, b]) => sum + b * 100 * 100, 0);
  assert.strictEqual(Math.round(total), 40000);
});

// ── Bonus types the focus tables must ignore. ─────────────────────────────
test("itemcraftquality and other non-focus bonuses are skipped", () => {
  const xml = node("CRAFT_X", `
    <bonus type="itemcraftquality" bonus="7.5" mintier="4" maxtier="8"><itempattern pattern="T?_BAG" /></bonus>
    <bonus type="craftingtimereduction" bonus="9" mintier="4" maxtier="8"><itempattern pattern="T?_BAG" /></bonus>`);
  assert.deepStrictEqual(familiesFrom(xml, "T4_BAG"), []);
});

test("farmingfocuscostreduction counts too (breeding nodes)", () => {
  const xml = node("FARM_ANIMALS_HORSE",
    `<bonus mintier="4" maxtier="8" type="farmingfocuscostreduction" bonus="2"><itempattern pattern="T?_FARM_HORSE_BABY" /></bonus>`);
  assert.deepStrictEqual(familiesFrom(xml, "T8_FARM_HORSE_BABY"), [["FARM_ANIMALS_HORSE", 2]]);
});

// ── Tier gating. ──────────────────────────────────────────────────────────
[
  ["T3_BAG", [], "is below mintier=4"],
  ["T4_BAG", [["CRAFT_BAG_BAG", 3.1]], "is at mintier"],
  ["T8_BAG", [["CRAFT_BAG_BAG", 3.1]], "is at maxtier"],
].forEach(([itemId, expected, why]) => {
  test(`${itemId} ${why}`, () => {
    const xml = node("CRAFT_BAG_BAG",
      `<bonus mintier="4" maxtier="8" type="${FOCUS}" bonus="3.1"><itempattern pattern="T?_BAG" /></bonus>`);
    assert.deepStrictEqual(familiesFrom(xml, itemId), expected);
  });
});

test("a bonus with no mintier/maxtier covers every tier", () => {
  const xml = node("CRAFT_BAG_BAG",
    `<bonus type="${FOCUS}" bonus="3.1"><itempattern pattern="T?_BAG" /></bonus>`);
  assert.deepStrictEqual(familiesFrom(xml, "T2_BAG"), [["CRAFT_BAG_BAG", 3.1]]);
});

// ── Shapes the parser must survive. ───────────────────────────────────────
test("a self-closing <bonus/> does not steal the next bonus's patterns", () => {
  const xml = node("CRAFT_BAG_BAG", `
    <bonus type="${FOCUS}" bonus="9" mintier="4" maxtier="8" />
    <bonus type="${FOCUS}" bonus="3.1" mintier="4" maxtier="8"><itempattern pattern="T?_BAG" /></bonus>`);
  assert.deepStrictEqual(familiesFrom(xml, "T4_BAG"), [["CRAFT_BAG_BAG", 3.1]]);
});

// <overridemasterylevel> RESTATES a node's rewards at a mastery level; it does
// not add a second bonus. FARM_ANIMALS is the only node in the dump written that
// way, and counting both copies read 2/level instead of 1 — a maxed breeder came
// out at 40,000 FCE instead of 30,000, halving the nurture focus the app charges.
test("a bonus restated inside <overridemasterylevel> counts once", () => {
  const xml = `<templateachievement id="FARM_ANIMALS" category="farming">
    <title tag="@DESTINYBOARD_TITLE_FARM_ANIMALS" />
    <baserewards>
      <bonus type="farmingfocuscostreduction" bonus="1" mintier="1" maxtier="8"><itempattern pattern="T?_FARM_HORSE*" /></bonus>
    </baserewards>
    <overridemasterylevel level="9">
      <baserewards>
        <bonus type="farmingfocuscostreduction" bonus="1" mintier="1" maxtier="8"><itempattern pattern="T?_FARM_HORSE*" /></bonus>
      </baserewards>
    </overridemasterylevel>
  </templateachievement>`;
  assert.deepStrictEqual(familiesFrom(xml, "T8_FARM_HORSE_BABY"), [["FARM_ANIMALS", 1]]);
});

test("multiple itempatterns in one bonus all match", () => {
  const xml = node("CRAFT_TOOL_SIEGEHAMMER_SIEGEHAMMER", `
    <bonus mintier="4" maxtier="8" type="${FOCUS}" bonus="0.3">
      <itempattern pattern="T?_2H_TOOL_SIEGEHAMMER*" /><itempattern pattern="T?_SIEGE_BANNER" />
    </bonus>`);
  ["T4_2H_TOOL_SIEGEHAMMER", "T4_SIEGE_BANNER"].forEach((id) =>
    assert.deepStrictEqual(familiesFrom(xml, id), [["CRAFT_TOOL_SIEGEHAMMER_SIEGEHAMMER", 0.3]]));
});

test("an item matching no pattern gets no family", () => {
  const xml = node("CRAFT_BAG_BAG",
    `<bonus mintier="4" maxtier="8" type="${FOCUS}" bonus="3.1"><itempattern pattern="T?_BAG" /></bonus>`);
  assert.deepStrictEqual(familiesFrom(xml, "T4_CAPE"), []);
});

test("enchanted and _LEVELn ids inherit the base item's bonuses", () => {
  const xml = node("CRAFT_BAG_BAG",
    `<bonus mintier="4" maxtier="8" type="${FOCUS}" bonus="3.1"><itempattern pattern="T?_BAG" /></bonus>`);
  ["T4_BAG@2", "T4_BAG_LEVEL2@2"].forEach((id) =>
    assert.deepStrictEqual(familiesFrom(xml, id), [["CRAFT_BAG_BAG", 3.1]]));
});

test("<achievement id> back-references carry no rewards and are not nodes", () => {
  const xml = node("CRAFT_BAG_BAG",
    `<bonus mintier="4" maxtier="8" type="${FOCUS}" bonus="3.1"><itempattern pattern="T?_BAG" /></bonus>`);
  assert.deepStrictEqual(parseNodes(xml).map((n) => n.id), ["CRAFT_BAG_BAG"]);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
