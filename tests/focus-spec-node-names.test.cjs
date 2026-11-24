/**
 * Test: the ⚙ Specs panel names Destiny Board nodes the way the game does.
 *
 * js/focus-spec-nodes.js is generated from achievements.xml, whose nodes carry
 * `<title tag="@DESTINYBOARD_TITLE_…"/>`. Run without the ao-bin-dumps
 * localization dump the generator falls back to prettified ids — which is how
 * the cooking rows came to read "Cook / Cook Meat / Cook Stew" while the game
 * calls them "Chef / Butcher / Stew Chef". A player then cannot tell which row
 * to type their level into, and types it into none.
 *
 * Regenerate with:
 *   node scripts/gen-focus-spec-nodes.cjs achievements.xml <localization.json>
 *
 * Run: node tests/focus-spec-node-names.test.cjs
 */

const assert = require("assert");
const { FOCUS_SPEC_NODES, FOCUS_SPEC_GROUPS } = require("../js/focus-spec-nodes.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Focus Spec Node Names Tests\n");

// ── The nodes named in the bug report, plus one per other branch. ──────────
[
  ["FARM_COOK", "Chef", "Cocinero"],
  ["FARM_COOK_MEAT", "Butcher", "Carnicero"],
  ["FARM_COOK_STEW", "Stew Chef", "Chef de guisos"],
  ["CRAFT_REFINE_ORE_T5", "Expert Ore Smelter", "Fundidor de minerales experto"],
  ["FARM_ANIMALS_GOOSE", "Goose Breeder", "Criador de gansos"],
  ["FARM_ALCHEMIST_HEAL", "Heal Brewer", "Preparador de curación"],
].forEach(([nodeId, en, es]) => {
  test(`${nodeId} is "${en}" / "${es}"`, () => {
    assert.ok(FOCUS_SPEC_NODES[nodeId], `${nodeId} is missing from the catalogue`);
    assert.strictEqual(FOCUS_SPEC_NODES[nodeId].name, en);
    assert.strictEqual(FOCUS_SPEC_NODES[nodeId].nameEs, es);
  });
});

// ── No node may fall back to a prettified id. ─────────────────────────────
test("every node has a real EN and ES title", () => {
  const ids = Object.keys(FOCUS_SPEC_NODES);
  assert.strictEqual(ids.length, 371, "the node count moved — regenerate and re-read");
  const missing = ids.filter((id) => !FOCUS_SPEC_NODES[id].name || !FOCUS_SPEC_NODES[id].nameEs);
  assert.deepStrictEqual(missing, [], "these nodes have no localized title");
});

// A prettified fallback is the node id with underscores turned into spaces, so
// it always contains every word of the id — a real title rarely does. The one
// legitimate collision: the alchemy mastery really is called "Alchemist".
const NAME_EQUALS_ID = ["FARM_ALCHEMIST"];

test("no node name is the prettified id it would fall back to", () => {
  const prettified = Object.keys(FOCUS_SPEC_NODES).filter((id) => {
    if (NAME_EQUALS_ID.indexOf(id) !== -1) return false;
    const words = id.replace(/^(CRAFT|FARM)_/, "").split("_")
      .map((w) => (/^T\d$/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()));
    return FOCUS_SPEC_NODES[id].name === words.join(" ");
  });
  assert.deepStrictEqual(prettified, [], "these nodes are still prettified ids");
});

test("every group heading is named too", () => {
  Object.keys(FOCUS_SPEC_GROUPS).forEach((groupId) =>
    assert.ok(FOCUS_SPEC_GROUPS[groupId].name, `${groupId} has no group title`));
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
