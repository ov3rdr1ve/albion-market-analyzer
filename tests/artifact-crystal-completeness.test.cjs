/**
 * Test: ARTIFACT_MAPPING contains all crystal weapon artifacts.
 * Verifies every weapon line has a Crystal-tier artifact with correct metadata.
 *
 * Run: node tests/artifact-crystal-completeness.test.cjs
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

function loadFileContent(relPath) {
  return fs.readFileSync(path.join(__dirname, "..", relPath), "utf-8");
}

function extractValue(src, varName) {
  const fn = new Function(`${src}; return ${varName};`);
  return fn();
}

const artifactSrc = loadFileContent("js/data-artifacts.js");
const ARTIFACT_MAPPING = extractValue(artifactSrc, "ARTIFACT_MAPPING");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

console.log("Crystal Artifact Completeness Tests\n");

// All crystal weapon artifacts that should exist
const expectedCrystalArtifacts = [
  // Warrior weapons
  { key: "MAIN_SWORD_CRYSTAL",          category: "Warrior", subcat: "sword",             name: "Infinite Crystal" },
  { key: "2H_SCYTHE_CRYSTAL",           category: "Warrior", subcat: "axe",               name: "Edged Crystal" },
  { key: "MAIN_MACE_CRYSTAL",           category: "Warrior", subcat: "mace",              name: "Dreadstorm Crystal" },
  { key: "2H_HAMMER_CRYSTAL",           category: "Warrior", subcat: "hammer",            name: "Crackling Crystal" },
  { key: "2H_KNUCKLES_CRYSTAL",         category: "Warrior", subcat: "knuckles",          name: "Pulsating Crystal" },
  { key: "2H_DUALCROSSBOW_CRYSTAL",     category: "Warrior", subcat: "crossbow",          name: "Arclight Crystal" },
  { key: "OFF_SHIELD_CRYSTAL",          category: "Warrior", subcat: "shield",           name: "Unbreakable Crystal" },
  // Mage weapons
  { key: "2H_HOLYSTAFF_CRYSTAL",        category: "Mage",    subcat: "holystaff",         name: "Exalted Crystal" },
  { key: "2H_ARCANESTAFF_CRYSTAL",      category: "Mage",    subcat: "arcanestaff",       name: "Startouched Crystal" },
  { key: "2H_FROSTSTAFF_CRYSTAL",       category: "Mage",    subcat: "froststaff",        name: "Icy Crystal" },
  { key: "MAIN_FIRESTAFF_CRYSTAL",      category: "Mage",    subcat: "firestaff",         name: "Pyreheart Crystal" },
  { key: "MAIN_CURSEDSTAFF_CRYSTAL",    category: "Mage",    subcat: "cursestaff",        name: "Rotten Crystal" },
  { key: "OFF_TOME_CRYSTAL",            category: "Mage",    subcat: "book",              name: "Timelocked Crystal" },
  // Hunter weapons
  { key: "2H_GLAIVE_CRYSTAL",           category: "Hunter",  subcat: "spear",             name: "Rift Crystal" },
  { key: "2H_DOUBLEBLADEDSTAFF_CRYSTAL", category: "Hunter", subcat: "quarterstaff",      name: "Mirage Crystal" },
  { key: "2H_DAGGERPAIR_CRYSTAL",       category: "Hunter",  subcat: "dagger",            name: "Death-Touched Crystal" },
  { key: "2H_BOW_CRYSTAL",              category: "Hunter",  subcat: "bow",               name: "Windborne Crystal" },
  { key: "MAIN_NATURESTAFF_CRYSTAL",    category: "Hunter",  subcat: "naturestaff",       name: "Forged Crystal" },
  { key: "2H_SHAPESHIFTER_CRYSTAL",     category: "Hunter",  subcat: "shapeshifterstaff", name: "Serpent Crystal" },
  { key: "OFF_TORCH_CRYSTAL",           category: "Hunter",  subcat: "torch",             name: "Blueflame Crystal" },
];

// ── Each crystal artifact exists with correct fields ─────────────────

for (const expected of expectedCrystalArtifacts) {
  test(`${expected.key} exists in ARTIFACT_MAPPING`, () => {
    assert.ok(ARTIFACT_MAPPING[expected.key], `Missing ${expected.key}`);
  });

  test(`${expected.key}: tier=Crystal, category=${expected.category}, subcat=${expected.subcat}`, () => {
    const entry = ARTIFACT_MAPPING[expected.key];
    assert.strictEqual(entry.tier, "Crystal", `tier mismatch`);
    assert.strictEqual(entry.category, expected.category, `category mismatch`);
    assert.strictEqual(entry.subcat, expected.subcat, `subcat mismatch`);
    assert.strictEqual(entry.name, expected.name, `name mismatch`);
  });
}

// ── Every weapon subcat has a Crystal artifact ───────────────────────

const weaponSubcats = [
  "sword", "axe", "mace", "hammer", "knuckles", "crossbow", "shield",
  "holystaff", "arcanestaff", "froststaff", "firestaff", "cursestaff", "book",
  "spear", "quarterstaff", "dagger", "bow", "naturestaff", "shapeshifterstaff", "torch",
];

test("every weapon subcat has at least one Crystal-tier artifact", () => {
  const crystalEntries = Object.values(ARTIFACT_MAPPING).filter(e => e.tier === "Crystal");
  const coveredSubcats = new Set(crystalEntries.map(e => e.subcat));
  const missing = weaponSubcats.filter(s => !coveredSubcats.has(s));
  assert.strictEqual(missing.length, 0, `Missing crystal artifacts for: ${missing.join(", ")}`);
});

// ── Total count check ────────────────────────────────────────────────

test(`ARTIFACT_MAPPING has exactly ${expectedCrystalArtifacts.length} Crystal-tier entries`, () => {
  const crystalCount = Object.values(ARTIFACT_MAPPING).filter(e => e.tier === "Crystal").length;
  assert.strictEqual(crystalCount, expectedCrystalArtifacts.length);
});

// ── Standard tiers: every weapon subcat has Rune/Soul/Relic/Avalonian ─

const standardTiers = ["Rune", "Soul", "Relic", "Avalonian"];
const standardSubcats = [
  "sword", "axe", "mace", "hammer", "knuckles", "crossbow",
  "holystaff", "arcanestaff", "froststaff", "firestaff", "cursestaff",
  "spear", "quarterstaff", "dagger", "bow", "naturestaff", "shapeshifterstaff",
];

for (const tier of standardTiers) {
  test(`every weapon subcat has a ${tier}-tier artifact`, () => {
    const entries = Object.values(ARTIFACT_MAPPING).filter(e => e.tier === tier);
    const covered = new Set(entries.map(e => e.subcat));
    const missing = standardSubcats.filter(s => !covered.has(s));
    assert.strictEqual(missing.length, 0, `Missing ${tier} artifacts for: ${missing.join(", ")}`);
  });
}

// ── Misty / mists-boss armor artifacts (drop-only, NOT foundry-rollable) ─
// Fey Dragon→cloth, Griffin→leather, Spider→plate. Relic-material. These must
// be present for market/flip coverage but flagged dropOnly so the rolling
// table excludes them (you cannot meld them at the Artifact Foundry).

const expectedMistyArtifacts = [
  { key: "HEAD_CLOTH_FEY",    category: "Mage",    subcat: "cloth_helmet",   name: "Intact Fey Fibula" },
  { key: "ARMOR_CLOTH_FEY",   category: "Mage",    subcat: "cloth_armor",    name: "Fey Dorsal Wing" },
  { key: "SHOES_CLOTH_FEY",   category: "Mage",    subcat: "cloth_shoes",    name: "Fey Dragonscales" },
  { key: "HEAD_LEATHER_FEY",  category: "Hunter",  subcat: "leather_helmet", name: "Flawless Griffin Beak" },
  { key: "ARMOR_LEATHER_FEY", category: "Hunter",  subcat: "leather_armor",  name: "Untarnished Griffin Feathers" },
  { key: "SHOES_LEATHER_FEY", category: "Hunter",  subcat: "leather_shoes",  name: "Griffin Underfur" },
  { key: "HEAD_PLATE_FEY",    category: "Warrior", subcat: "plate_helmet",   name: "Veilweaver Mandibles" },
  { key: "ARMOR_PLATE_FEY",   category: "Warrior", subcat: "plate_armor",    name: "Veilweaver Carapace" },
  { key: "SHOES_PLATE_FEY",   category: "Warrior", subcat: "plate_shoes",    name: "Veilweaver Claws" },
];

for (const expected of expectedMistyArtifacts) {
  test(`${expected.key}: tier=Relic, dropOnly, category=${expected.category}, subcat=${expected.subcat}, name="${expected.name}"`, () => {
    const entry = ARTIFACT_MAPPING[expected.key];
    assert.ok(entry, `Missing ${expected.key}`);
    assert.strictEqual(entry.tier, "Relic", "misty armor is relic-material");
    assert.strictEqual(entry.dropOnly, true, "misty armor must be dropOnly (not rollable)");
    assert.strictEqual(entry.category, expected.category, "category mismatch");
    assert.strictEqual(entry.subcat, expected.subcat, "subcat mismatch");
    assert.strictEqual(entry.name, expected.name, "name mismatch");
  });
}

test(`ARTIFACT_MAPPING has exactly ${expectedMistyArtifacts.length} misty (_FEY) entries, all dropOnly`, () => {
  const fey = Object.entries(ARTIFACT_MAPPING).filter(([k]) => k.endsWith("_FEY"));
  assert.strictEqual(fey.length, expectedMistyArtifacts.length);
  assert.ok(fey.every(([, v]) => v.dropOnly === true), "all _FEY entries must be dropOnly");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
