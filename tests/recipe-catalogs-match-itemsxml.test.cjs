/**
 * Test: EVERY hand-maintained recipe catalog matches items.xml.
 *
 * consumable-recipes-match-itemsxml.test.cjs already guards the consumable
 * slice of BUNDLED_RECIPES. Nothing guarded the rest, and three real defects
 * had accumulated behind that gap:
 *
 *   - 29 gatherer ARMOR recipes listed count 8 where items.xml says 16 (a 2x
 *     material-cost understatement in every crafting table). T8_ARMOR_GATHERER_WOOD
 *     was the one sibling ever noticed — see lumberjack-garb-material.test.cjs.
 *   - T6_MOUNT_SIEGE_BALLISTA listed 2500 GvG tokens; items.xml says 500.
 *   - 43 BUNDLED_RECIPES keys used invented wrong-tier ids that do not exist in
 *     the game at all (T5_MEAL_STEW, T4_POTION_POISON, ...).
 *
 * The last catalog row is the important one: it audits what the app actually
 * RENDERS (resolveItemRecipe over CRAFTING_ITEMS) rather than what a side
 * catalog happens to store. That is the check that catches "Elder's Bed shows
 * 10 planks and no cloth".
 *
 * Black-box: repo files only, no live API/DB.
 *
 * Run: node tests/recipe-catalogs-match-itemsxml.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const { parseItemsXmlRecipes, itemsXmlUniqueNames, recipeSignature } = require("./helpers/items-xml-recipes.cjs");

const root = path.join(__dirname, "..");
const J = (f) => fs.readFileSync(path.join(root, "js", f), "utf8");

// ── Load the app catalogs ────────────────────────────────────────────────
// Gear files are discovered, not listed, so a future js/gear-*.js is audited
// the moment it lands. gear-token-substitute.js is excluded: it is the
// crystallized-token SWAP table, not a recipe catalog.
const gearFiles = fs
  .readdirSync(path.join(root, "js"))
  .filter((f) => /^gear-.*\.js$/.test(f) && f !== "gear-token-substitute.js")
  .sort();

const stub = `function getTierFromId(id){const m=String(id).match(/^T(\\d)/);return m?parseInt(m[1],10):0;}\nlet recipeCache = {};\n`;

const mod = new Module("recipe-catalog-audit");
mod._compile(
  stub +
    gearFiles.map((f) => J(f)).join("\n") +
    J("gear.js") +
    J("data.js") +
    J("data-mounts.js") +
    J("recipes.js") +
    J("recipes-rare-potions.js") +
    J("recipes-dragon-potions.js") +
    J("recipe-resolver.js") +
    "\nmodule.exports = { BUNDLED_RECIPES, GEAR_RECIPES_ALL, MOUNT_RECIPES, CRAFTING_ITEMS, resolveItemRecipe };",
  "recipe-catalog-audit.js"
);
const { BUNDLED_RECIPES, GEAR_RECIPES_ALL, MOUNT_RECIPES, CRAFTING_ITEMS, resolveItemRecipe } = mod.exports;

const xmlRecipes = parseItemsXmlRecipes();
const xmlNames = itemsXmlUniqueNames();

// ── Documented exceptions ────────────────────────────────────────────────
// Deliberate app model, not drift: fish sauce has NO resource return rate —
// every chop and seaweed is fully consumed (js/recipes.js:747-755, verified
// against the wiki). The app flags both ingredients noReturn so the RRR
// multiplier in render-consumables is skipped; items.xml carries no
// maxreturnamount on them. Ingredients and counts are still compared.
const NO_RETURN_EXEMPT_RECIPES = new Set([
  "T1_FISHSAUCE_LEVEL1",
  "T1_FISHSAUCE_LEVEL2",
  "T1_FISHSAUCE_LEVEL3",
]);

// Ids a catalog may legitimately carry that items.xml has no recipe for.
// Add here ONLY with a reason — the stale-entry check below fails the moment
// items.xml starts covering one, so this list cannot rot into a blanket mute.
const ALLOW_ABSENT = {
  GEAR_RECIPES_ALL: [],
  MOUNT_RECIPES: [],
  BUNDLED_RECIPES: [],
  "CRAFTING_ITEMS (resolved)": [],
};

const CATALOGS = [
  {
    name: "BUNDLED_RECIPES",
    withNoReturn: true,
    floor: 110,
    entries: () => Object.entries(BUNDLED_RECIPES),
  },
  {
    name: "GEAR_RECIPES_ALL",
    floor: 1500,
    entries: () => GEAR_RECIPES_ALL.map((g) => [g.id, g.materials]),
  },
  {
    name: "MOUNT_RECIPES",
    floor: 45,
    entries: () => MOUNT_RECIPES.map((m) => [m.id, m.materials]),
  },
  {
    name: "CRAFTING_ITEMS (resolved)",
    floor: 25,
    entries: () => CRAFTING_ITEMS.map((i) => [i.id, resolveItemRecipe(i)]),
  },
];

// ── Runner ───────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.error(`  FAIL: ${name}\n    ${e.message}`); }
}

/** Strip noReturn flags the app sets deliberately, so they are not read as drift. */
function normalize(recipeId, mats, withNoReturn) {
  if (!withNoReturn || NO_RETURN_EXEMPT_RECIPES.has(recipeId)) {
    return (mats || []).map((m) => ({ matId: m.matId, count: m.count }));
  }
  return (mats || []).map((m) => ({ matId: m.matId, count: m.count, noReturn: m.noReturn }));
}

for (const cat of CATALOGS) {
  const allow = ALLOW_ABSENT[cat.name] || [];
  const allowIds = new Set(allow.map((a) => a.id));
  const entries = cat.entries();
  const compared = [];

  console.log(`\n=== ${cat.name}: recipes match items.xml ===`);
  for (const [id, mats] of entries) {
    const xml = xmlRecipes[id];
    if (!xml) continue;
    compared.push(id);
    test(`${cat.name} / ${id}`, () => {
      const ours = recipeSignature(normalize(id, mats, cat.withNoReturn), { withNoReturn: !!cat.withNoReturn });
      const theirs = recipeSignature(normalize(id, xml, cat.withNoReturn), { withNoReturn: !!cat.withNoReturn });
      assert.strictEqual(ours, theirs, `${id} drifted from items.xml\n      ours: ${ours}\n      xml : ${theirs}`);
    });
  }

  console.log(`\n=== ${cat.name}: no unexplained ids missing from items.xml ===`);
  const absent = entries.map(([id]) => id).filter((id) => !xmlRecipes[id] && !allowIds.has(id));
  test(`${cat.name} has no unlisted absent ids`, () => {
    const detail = absent
      .map((id) => `${id} (${xmlNames.has(id) ? "present in items.xml but not craftable" : "id does not exist in items.xml"})`)
      .join("\n        ");
    assert.strictEqual(
      absent.length,
      0,
      `${absent.length} id(s) in ${cat.name} have no items.xml recipe and no ALLOW_ABSENT reason:\n        ${detail}`
    );
  });

  console.log(`\n=== ${cat.name}: ALLOW_ABSENT list is not stale ===`);
  for (const a of allow) {
    test(`${cat.name} / ALLOW_ABSENT ${a.id} still absent`, () => {
      assert.ok(
        !xmlRecipes[a.id],
        `${a.id} now HAS an items.xml recipe — drop it from ALLOW_ABSENT so it gets audited (reason was: ${a.reason})`
      );
    });
  }

  console.log(`\n=== ${cat.name}: coverage ===`);
  test(`${cat.name} compared at least ${cat.floor} recipes`, () => {
    assert.ok(compared.length >= cat.floor, `only compared ${compared.length} of ${entries.length} (floor ${cat.floor})`);
  });
}

// ── Named regressions ────────────────────────────────────────────────────
console.log("\n=== Named regressions ===");
test("Elder's Bed resolves to 10 planks + 20 cloth", () => {
  const item = CRAFTING_ITEMS.find((i) => i.id === "T8_FURNITUREITEM_BED");
  assert.ok(item, "T8_FURNITUREITEM_BED missing from CRAFTING_ITEMS");
  assert.strictEqual(
    recipeSignature(resolveItemRecipe(item)),
    "T8_CLOTH:20 | T8_PLANKS:10"
  );
});
test("gatherer ARMOR takes 16 of its material, not 8", () => {
  for (const id of ["T4_ARMOR_GATHERER_FIBER", "T8_ARMOR_GATHERER_ORE", "T5_ARMOR_GATHERER_WOOD"]) {
    const g = GEAR_RECIPES_ALL.find((x) => x.id === id);
    assert.ok(g, `${id} missing from GEAR_RECIPES_ALL`);
    assert.strictEqual(g.materials[0].count, 16, `${id} still lists ${g.materials[0].count}`);
  }
});
test("Siege Ballista costs 500 GvG tokens", () => {
  const m = MOUNT_RECIPES.find((x) => x.id === "T6_MOUNT_SIEGE_BALLISTA");
  const tok = m.materials.find((x) => x.matId === "UNIQUE_GVGTOKEN_GENERIC");
  assert.strictEqual(tok.count, 500);
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
