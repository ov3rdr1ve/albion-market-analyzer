/**
 * Test: the generated focus-spec catalog (js/focus-spec-nodes.js +
 * js/focus-spec-items.js, built by scripts/gen-focus-spec-nodes.cjs from
 * achievements.xml) stays faithful to the game data.
 *
 * These are the numbers the whole feature rests on, so they're pinned here:
 * every node's bonus is per LEVEL (bonus × 100 × level = FCE) and the max-spec
 * totals must reproduce the values the app verified in-game / on the wiki.
 *
 * Run: node tests/focus-spec-catalog.test.cjs
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const { FOCUS_SPEC_NODES, FOCUS_SPEC_GROUPS } = require("../js/focus-spec-nodes.js");
const { FOCUS_SPEC_FAMILIES, FOCUS_SPEC_ITEM_FAMILY } = require("../js/focus-spec-items.js");
const FOCUS_COSTS = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "js", "focus-costs.json"), "utf-8")
);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const maxFCE = (itemId) => {
  const family = FOCUS_SPEC_FAMILIES[FOCUS_SPEC_ITEM_FAMILY[itemId]];
  return family ? Math.round(family.reduce((sum, [, bonus]) => sum + bonus * 100 * 100, 0)) : 0;
};

console.log("Focus Spec Catalog Tests\n");

// ── Max-spec totals (all nodes at 100). ─────────────────────────────────────
const ANCHORS = [
  ["T4_METALBAR", 40000, "refining — verified in-game (6.25%)"],
  ["T5_PLANKS", 40000, "refining"],
  ["T8_LEATHER", 40000, "refining"],
  ["T6_CLOTH", 40000, "refining"],
  ["T7_STONEBLOCK", 40000, "refining"],
  ["T5_MEAL_SOUP", 55000, "cooking — wiki 55,000 (2.21%)"],
  ["T4_POTION_HEAL", 55000, "alchemy — wiki 55,000"],
  ["T3_FLOUR", 55000, "cooking ingredient"],
  ["T5_MEAT", 55000, "butchering, whole cooking tree maxed"],
  ["T5_HEAD_PLATE_SET1", 44500, "gear — NOT the 55,000 the app used to assume"],
  ["T5_MAIN_ARCANESTAFF", 44290, "gear"],
  ["T5_2H_TOOL_PICK", 40000, "gathering tools DO have a focus spec"],
  ["T5_HEAD_GATHERER_ORE", 40000, "gathering gear"],
  ["T4_CAPE", 40000, "cape specialist — its 3.4 group bonus is written tier-first in the dump"],
  ["T4_BAG", 40000, "bag specialist — 3.1 group bonus, same tier-first spelling"],
  ["T8_BAG_INSIGHT", 40000, "satchel specialist"],
  ["T8_2H_TOOL_SIEGEHAMMER", 40000, "siege hammer specialist"],
  ["T8_FARM_HORSE_BABY", 30000, "breeding — 1 Animal Breeder + 2 Horse Breeder; the node's <overridemasterylevel> copy must not stack"],
  ["T3_FARM_COMFREY_SEED", 30000, "herb farming — 1 Herbalist + 2 Comfrey Cultivator (wiki: 1000 -> 125)"],
];
ANCHORS.forEach(([itemId, fce, why]) => {
  test(`${itemId} max FCE = ${fce.toLocaleString()} (${why})`, () => {
    assert.strictEqual(maxFCE(itemId), fce);
  });
});

// ── Items the game gives no focus specialization at all. ────────────────────
[
  ["T5_FURNITUREITEM_TABLE_A", "furniture — verified in-game at full base focus"],
  ["T5_MOUNT_HORSE", "saddler / mounts"],
  ["T5_JOURNAL_WARRIOR_EMPTY", "journals"],
  ["T5_CAPEITEM_FW_MARTLOCK", "faction cape combine (0 focus anyway)"],
].forEach(([itemId, why]) => {
  test(`${itemId} has no spec nodes (${why})`, () => {
    assert.strictEqual(FOCUS_SPEC_ITEM_FAMILY[itemId], undefined);
    assert.strictEqual(maxFCE(itemId), 0);
  });
});

// ── The butcher convention the app shipped before this feature. ─────────────
test("meat with only FARM_COOK_MEAT maxed = 28,000 FCE (the in-game 77 focus)", () => {
  const family = FOCUS_SPEC_FAMILIES[FOCUS_SPEC_ITEM_FAMILY["T5_MEAT"]];
  const butcher = family.find(([nodeId]) => nodeId === "FARM_COOK_MEAT");
  assert.ok(butcher, "T5_MEAT must be covered by the butcher node");
  assert.strictEqual(Math.round(butcher[1] * 100 * 100), 28000);
});

// ── Refining: the item's own tier node carries the 2.5 specialization bonus. ─
[4, 5, 6, 7, 8].forEach((tier) => {
  test(`T${tier}_METALBAR's own node is CRAFT_REFINE_ORE_T${tier} with the 2.8 bonus`, () => {
    const family = FOCUS_SPEC_FAMILIES[FOCUS_SPEC_ITEM_FAMILY[`T${tier}_METALBAR`]];
    const own = family.find(([nodeId]) => nodeId === `CRAFT_REFINE_ORE_T${tier}`);
    assert.ok(own, "own tier node missing");
    assert.strictEqual(own[1], 2.8);
    family
      .filter(([nodeId]) => nodeId !== `CRAFT_REFINE_ORE_T${tier}`)
      .forEach(([nodeId, bonus]) =>
        assert.strictEqual(bonus, 0.3, `${nodeId} should only carry the category bonus`)
      );
  });
});

// ── Bags vs satchels: two specialists under one mastery. ───────────────────
//
// The Destiny Board (screenshots 2026-08-16) grants, per level: Bag Tailor +30
// to Bags; Bag Tailoring Specialist +340 to Bags; Satchel of Insight Tailoring
// Specialist +30 to Bags AND +310 to Satchels. So each specialist gives 0.3 to
// everything matching T?_BAG* and 3.1 more to its own item only — the game
// merges the Bag specialist's two lines because they share a description tag,
// which reads as an asymmetry it does not have.
test("bags and satchels are different families, each owning its own specialist", () => {
  const bag = FOCUS_SPEC_FAMILIES[FOCUS_SPEC_ITEM_FAMILY["T6_BAG"]];
  const satchel = FOCUS_SPEC_FAMILIES[FOCUS_SPEC_ITEM_FAMILY["T6_BAG_INSIGHT"]];
  assert.notStrictEqual(
    FOCUS_SPEC_ITEM_FAMILY["T6_BAG"],
    FOCUS_SPEC_ITEM_FAMILY["T6_BAG_INSIGHT"],
    "a bag and a satchel must not share one family"
  );
  assert.deepStrictEqual(bag, [["CRAFT_BAG", 0.3], ["CRAFT_BAG_BAG", 3.4], ["CRAFT_BAG_INSIGHT", 0.3]]);
  assert.deepStrictEqual(satchel, [["CRAFT_BAG", 0.3], ["CRAFT_BAG_BAG", 0.3], ["CRAFT_BAG_INSIGHT", 3.4]]);
});

// ── Enchanted / _LEVELn variants inherit their base item's nodes. ───────────
[
  ["T5_PLANKS_LEVEL2@2", "T5_PLANKS"],
  ["T5_MEAL_SOUP@3", "T5_MEAL_SOUP"],
  ["T5_HEAD_PLATE_SET1@2", "T5_HEAD_PLATE_SET1"],
].forEach(([variant, base]) => {
  test(`${variant} maps to the same family as ${base}`, () => {
    assert.strictEqual(FOCUS_SPEC_ITEM_FAMILY[variant], FOCUS_SPEC_ITEM_FAMILY[base]);
  });
});

// ── Structural sanity of the generated files. ───────────────────────────────
test("every family references known nodes with a positive bonus", () => {
  FOCUS_SPEC_FAMILIES.forEach((family, i) => {
    assert.ok(family.length > 0, `family ${i} is empty`);
    family.forEach(([nodeId, bonus]) => {
      assert.ok(FOCUS_SPEC_NODES[nodeId], `unknown node ${nodeId} in family ${i}`);
      assert.ok(bonus > 0, `non-positive bonus for ${nodeId}`);
    });
  });
});

test("every item points at a real family index", () => {
  Object.entries(FOCUS_SPEC_ITEM_FAMILY).forEach(([itemId, idx]) => {
    assert.ok(FOCUS_SPEC_FAMILIES[idx], `${itemId} → missing family ${idx}`);
  });
});

test("every node has a display name and a known branch", () => {
  const branches = new Set(["refine", "gear", "tool", "cape", "cook", "alchemy", "breeding", "farming"]);
  Object.entries(FOCUS_SPEC_NODES).forEach(([nodeId, node]) => {
    assert.ok(node.name && node.name.length > 1, `${nodeId} has no name`);
    assert.ok(branches.has(node.branch), `${nodeId} has unknown branch ${node.branch}`);
  });
});

// ── Specialization grouping (what the ⚙ panel lists as one block). ─────────
test("every node has a group that exists, in the same branch", () => {
  Object.entries(FOCUS_SPEC_NODES).forEach(([nodeId, node]) => {
    assert.ok(node.group, `${nodeId} has no group`);
    const group = FOCUS_SPEC_GROUPS[node.group];
    assert.ok(group, `${nodeId} → unknown group ${node.group}`);
    assert.strictEqual(group.branch, node.branch, `${nodeId} crosses branches`);
    assert.ok(group.name && group.name.length > 1, `group ${node.group} has no name`);
    assert.strictEqual(typeof node.order, "number");
  });
});

test("each refining resource is one group of five tier nodes, ordered T4-T8", () => {
  ["ORE", "WOOD", "FIBER", "HIDE", "ROCK"].forEach((resource) => {
    const groupId = `CRAFT_REFINE_${resource}`;
    const nodes = Object.entries(FOCUS_SPEC_NODES)
      .filter(([, node]) => node.group === groupId)
      .sort((a, b) => a[1].order - b[1].order);
    assert.strictEqual(nodes.length, 5, `${groupId} should hold T4-T8`);
    assert.deepStrictEqual(nodes.map(([, n]) => n.order), [4, 5, 6, 7, 8]);
    assert.deepStrictEqual(
      nodes.map(([id]) => id),
      [4, 5, 6, 7, 8].map((t) => `${groupId}_T${t}`)
    );
    assert.ok(FOCUS_SPEC_GROUPS[groupId].name.endsWith("Refining"), "derived title missing");
  });
});

test("a mastery node and its specialists share one group, mastery first", () => {
  [
    ["CRAFT_ARCANESTAFFS", ["CRAFT_ARCANESTAFFS_ARCANE", "CRAFT_ARCANESTAFFS_HELL"]],
    ["FARM_COOK", ["FARM_COOK_SOUP", "FARM_COOK_MEAT"]],
    ["FARM_ALCHEMIST", ["FARM_ALCHEMIST_HEAL"]],
    ["CRAFT_TOOL_PICK", ["CRAFT_TOOL_PICK_HEAD"]],
    ["FARM_ANIMALS", ["FARM_ANIMALS_HORSE"]],
  ].forEach(([masteryId, specialists]) => {
    assert.strictEqual(FOCUS_SPEC_NODES[masteryId].group, masteryId, `${masteryId} is its own group`);
    assert.strictEqual(FOCUS_SPEC_NODES[masteryId].order, 0, "mastery node sorts first");
    specialists.forEach((nodeId) =>
      assert.strictEqual(FOCUS_SPEC_NODES[nodeId].group, masteryId, `${nodeId} is misgrouped`)
    );
  });
});

test("no group is a single node (grouping would be pointless)", () => {
  const counts = {};
  Object.values(FOCUS_SPEC_NODES).forEach((n) => { counts[n.group] = (counts[n.group] || 0) + 1; });
  const singles = Object.keys(counts).filter((g) => counts[g] < 2);
  assert.deepStrictEqual(singles, []);
});

test("refining, cooking and gear branches are all represented", () => {
  const counts = {};
  Object.values(FOCUS_SPEC_NODES).forEach((n) => { counts[n.branch] = (counts[n.branch] || 0) + 1; });
  assert.strictEqual(counts.refine, 25, "5 resources × T4-T8");
  assert.ok(counts.cook >= 10, "cooking nodes missing");
  assert.ok(counts.alchemy >= 15, "alchemy nodes missing");
  assert.ok(counts.gear >= 200, "gear nodes missing");
  assert.ok(counts.breeding >= 9, "breeding nodes missing");
});

// ── Coverage: the ids the app actually prices with focus. ──────────────────
//
// Every focus bonus in the dump is mintier="4", so T2/T3 crafts genuinely get
// no reduction and pay their (tiny) base cost. Above that, only a short list of
// no-spec kinds may be uncovered.
const NO_SPEC_KINDS =
  /_FURNITUREITEM_|_MOUNT_|JOURNAL|CAPEITEM|_ROYAL|SIEGE|_KILLTROPHY|TOOL_HIDEOUT|UNIQUE_|_CAPE_(CLOTH|LEATHER|PLATE)_|_CD_DUNGEONWEAPON|_PROTOTYPE|_2H_IRONGAUNTLETS_/;

test("T2/T3 crafts have no spec nodes (every dump bonus is mintier=4)", () => {
  ["T2_METALBAR", "T3_PLANKS", "T3_HEAD_PLATE_SET1"].forEach((id) => {
    assert.strictEqual(FOCUS_SPEC_ITEM_FAMILY[id], undefined, `${id} should be uncovered`);
  });
});

test("T4+ focus ids resolve to a family unless they're a known no-spec kind", () => {
  const ids = Object.keys(FOCUS_COSTS).filter((id) => Number(id[1]) >= 4);
  const covered = ids.filter((id) => FOCUS_SPEC_ITEM_FAMILY[id] !== undefined);
  assert.ok(covered.length / ids.length > 0.9,
    `only ${covered.length}/${ids.length} T4+ focus ids have spec nodes`);
  const unexpected = ids.filter(
    (id) => FOCUS_SPEC_ITEM_FAMILY[id] === undefined && !NO_SPEC_KINDS.test(id)
  );
  assert.deepStrictEqual(unexpected, [], `unmapped ids: ${unexpected.slice(0, 15).join(", ")}`);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
