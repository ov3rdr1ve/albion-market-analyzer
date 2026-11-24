/**
 * Test: Crystal Shard / Fire Dragon Scale artifacts are an Energy Manipulator
 * exchange, not an Artifact Foundry meld.
 *
 * 50 fragments buy the artifact you PICK — there is no random pool, no class
 * filter and no salvage-and-reroll campaign. So these artifacts are ordinary
 * deterministic crafting rows (like the Dragon Sanctuary Waystones), attributed
 * to the Energy Manipulator, and they must NOT appear in the Artifact Rolling
 * table's roll model.
 *
 * Black-box: drives the real js/data-energy-exchange.js catalog against the
 * real ARTIFACT_MAPPING, the real items.xml and the real station resolver.
 * No live API or DB.
 *
 * Run: node tests/energy-manipulator-exchange.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

function load(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

// data-artifacts.js is a browser catalog with no exports of its own; the
// exchange catalog reads ARTIFACT_MAPPING out of the shared script scope, so
// the two are compiled together exactly as the browser loads them.
const mod = new Module("energy-exchange-test");
mod._compile(
  load("js/data-artifacts.js") +
    load("js/data-energy-exchange.js") +
    "\nmodule.exports = { ARTIFACT_MAPPING, ENERGY_EXCHANGE_ITEMS, ENERGY_EXCHANGE_FRAGMENT_IDS, injectEnergyExchange };",
  "energy-exchange-test.js"
);
const {
  ARTIFACT_MAPPING,
  ENERGY_EXCHANGE_ITEMS,
  ENERGY_EXCHANGE_FRAGMENT_IDS,
  injectEnergyExchange,
} = mod.exports;

const stations = require("../js/data-craft-stations.js");
const { getCraftStation, getCraftStationForId, getCraftStationLabel, CRAFT_STATIONS } = stations;

const XML = load("data/dumps/items.xml");
const TIERS = [4, 5, 6, 7, 8];
const TIER_WORDS = {
  4: "Adept's",
  5: "Expert's",
  6: "Master's",
  7: "Grandmaster's",
  8: "Elder's",
};
const FRAGMENT_STEM = { Crystal: "SHARD_CRYSTAL", Dragon: "SHARD_FIRE_DRAGON" };

// The suffixes that should be in the catalog, derived the same way the app
// derives them — every non-drop-only Crystal or Dragon artifact.
const EXPECTED_SUFFIXES = Object.entries(ARTIFACT_MAPPING)
  .filter(([, d]) => FRAGMENT_STEM[d.tier] && !d.dropOnly)
  .map(([suffix]) => suffix);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name + " — " + e.message); failed++; }
}

console.log("\n=== The catalog covers exactly the exchangeable artifacts ===");
test("one row per non-drop-only Crystal/Dragon artifact per tier T4-T8", () => {
  assert.strictEqual(ENERGY_EXCHANGE_ITEMS.length, EXPECTED_SUFFIXES.length * TIERS.length);
  const want = new Set();
  for (const suffix of EXPECTED_SUFFIXES) {
    for (const t of TIERS) want.add(`T${t}_ARTEFACT_${suffix}`);
  }
  const got = new Set(ENERGY_EXCHANGE_ITEMS.map((i) => i.id));
  assert.strictEqual(got.size, want.size, "duplicate ids in the catalog");
  for (const id of want) assert.ok(got.has(id), id + " is missing from the catalog");
});
test("both fragment families are represented", () => {
  const stems = new Set(ENERGY_EXCHANGE_ITEMS.map((i) => i.materials[0].matId.replace(/^T\d+_/, "")));
  assert.deepStrictEqual([...stems].sort(), ["SHARD_CRYSTAL", "SHARD_FIRE_DRAGON"]);
});
test("no drop-only artifact leaked in", () => {
  for (const item of ENERGY_EXCHANGE_ITEMS) {
    const suffix = item.id.replace(/^T\d+_ARTEFACT_/, "");
    assert.ok(!ARTIFACT_MAPPING[suffix].dropOnly, suffix + " is drop-only");
  }
});
test("ENERGY_EXCHANGE_FRAGMENT_IDS lists both fragments at every tier", () => {
  const want = [];
  for (const stem of ["SHARD_CRYSTAL", "SHARD_FIRE_DRAGON"]) {
    for (const t of TIERS) want.push(`T${t}_${stem}`);
  }
  assert.deepStrictEqual([...ENERGY_EXCHANGE_FRAGMENT_IDS].sort(), want.sort());
});

console.log("\n=== Every row matches items.xml ===");
test("every id is a real items.xml id", () => {
  for (const item of ENERGY_EXCHANGE_ITEMS) {
    assert.ok(XML.includes(`uniquename="${item.id}"`), item.id + " is not a real id");
  }
});
test("every recipe is exactly 50 of the matching fragment", () => {
  for (const item of ENERGY_EXCHANGE_ITEMS) {
    const start = XML.indexOf(`uniquename="${item.id}"`);
    const chunk = XML.slice(start, start + 900);
    const end = chunk.indexOf("</simpleitem>");
    const body = chunk.slice(0, end < 0 ? chunk.length : end);
    const resources = [...body.matchAll(/<craftresource ([^>]*)\/>/g)].map((m) => m[1]);
    assert.strictEqual(resources.length, 1, item.id + " has " + resources.length + " craftresources");
    assert.ok(
      resources[0].includes(`uniquename="${item.materials[0].matId}"`),
      item.id + " does not consume " + item.materials[0].matId
    );
    assert.ok(resources[0].includes('count="50"'), item.id + " is not a 50-fragment exchange");
  }
});
test("the fragment tier always matches the artifact tier", () => {
  for (const item of ENERGY_EXCHANGE_ITEMS) {
    const tier = item.id.match(/^T(\d)_/)[1];
    assert.ok(item.materials[0].matId.startsWith("T" + tier + "_"), item.id + " buys a cross-tier fragment");
  }
});

console.log("\n=== Exchange economics: no return, no focus, no station fee ===");
test("every row is a single-material, 50-count, non-returnable exchange", () => {
  for (const item of ENERGY_EXCHANGE_ITEMS) {
    assert.strictEqual(item.materials.length, 1, item.id + " has more than one material");
    assert.strictEqual(item.materials[0].count, 50, item.id + " does not cost 50 fragments");
    assert.strictEqual(item.noReturn, true, item.id + " would refund fragments");
    assert.strictEqual(item.craftType, null, item.id + " carries a craftType");
  }
});
test("an NPC exchange bills no silver and no station usage fee", () => {
  for (const item of ENERGY_EXCHANGE_ITEMS) {
    assert.strictEqual(item.silverCost, 0, item.id + " charges silver");
    assert.strictEqual(item.nutritionPerCraft, 0, item.id + " would pay a station fee");
  }
});

console.log("\n=== Names ===");
test("names read '<tier word> <artifact name> [Tn]'", () => {
  for (const item of ENERGY_EXCHANGE_ITEMS) {
    const tier = Number(item.id.match(/^T(\d)_/)[1]);
    const suffix = item.id.replace(/^T\d+_ARTEFACT_/, "");
    const expected = `${TIER_WORDS[tier]} ${ARTIFACT_MAPPING[suffix].name} [T${tier}]`;
    assert.strictEqual(item.name, expected);
  }
});
test("a known row reads exactly as in game", () => {
  const row = ENERGY_EXCHANGE_ITEMS.find((i) => i.id === "T4_ARTEFACT_ARMOR_LEATHER_DRAGON");
  assert.strictEqual(row.name, "Adept's Dragonhide Padding [T4]");
  assert.strictEqual(row.materials[0].matId, "T4_SHARD_FIRE_DRAGON");
  const crystal = ENERGY_EXCHANGE_ITEMS.find((i) => i.id === "T8_ARTEFACT_2H_HOLYSTAFF_CRYSTAL");
  assert.strictEqual(crystal.name, "Elder's Exalted Crystal [T8]");
  assert.strictEqual(crystal.materials[0].matId, "T8_SHARD_CRYSTAL");
});

console.log("\n=== injectEnergyExchange ===");
test("appends every row to an empty catalog", () => {
  const catalog = [];
  injectEnergyExchange(catalog);
  assert.strictEqual(catalog.length, ENERGY_EXCHANGE_ITEMS.length);
});
test("is idempotent — a second call adds nothing", () => {
  const catalog = [];
  injectEnergyExchange(catalog);
  const after = catalog.length;
  injectEnergyExchange(catalog);
  assert.strictEqual(catalog.length, after);
});
test("skips ids the catalog already carries", () => {
  const catalog = [{ id: "T4_ARTEFACT_ARMOR_LEATHER_DRAGON", name: "mine" }];
  injectEnergyExchange(catalog);
  assert.strictEqual(catalog.length, ENERGY_EXCHANGE_ITEMS.length);
  assert.strictEqual(catalog.filter((i) => i.id === "T4_ARTEFACT_ARMOR_LEATHER_DRAGON").length, 1);
  assert.strictEqual(catalog[0].name, "mine", "an existing row was overwritten");
});
test("pushes copies, not the catalog's own objects", () => {
  const catalog = [];
  injectEnergyExchange(catalog);
  catalog[0].name = "mutated";
  assert.notStrictEqual(ENERGY_EXCHANGE_ITEMS[0].name, "mutated");
});
test("a non-array argument is returned untouched", () => {
  assert.strictEqual(injectEnergyExchange(null), null);
});

console.log("\n=== Station attribution ===");
test("the Energy Manipulator is a station the picker offers", () => {
  const entry = CRAFT_STATIONS.find((s) => s.key === "energy");
  assert.ok(entry, "no 'energy' station");
  assert.strictEqual(entry.label, "Energy Manipulator");
  assert.strictEqual(getCraftStationLabel("energy"), "Energy Manipulator");
});
test("every exchange row resolves to the Energy Manipulator", () => {
  for (const item of ENERGY_EXCHANGE_ITEMS) {
    assert.strictEqual(getCraftStation(item), "energy", item.id + " went to the wrong station");
  }
});
test("the bare id resolves too — the row-key fallback has no catalog entry", () => {
  assert.strictEqual(getCraftStationForId("T4_ARTEFACT_2H_GLAIVE_CRYSTAL"), "energy");
  assert.strictEqual(getCraftStationForId("T8_ARTEFACT_SHOES_LEATHER_DRAGON"), "energy");
});
test("the other Foundry crafts keep the Foundry", () => {
  assert.strictEqual(getCraftStationForId("T4_ARTEFACT_2H_BOW_HELL"), "foundry");
  assert.strictEqual(getCraftStationForId("T7_RANDOM_DUNGEON_ELITE_DRAGON_TOKEN_D2@2"), "foundry");
  assert.strictEqual(getCraftStationForId("T5_CORRUPTED_NONLETHAL_MAP"), "foundry");
});

console.log("\n" + "=".repeat(50));
console.log("Total: " + (passed + failed) + " | Passed: " + passed + " | Failed: " + failed);
if (failed > 0) process.exit(1);
