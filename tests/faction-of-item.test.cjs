/**
 * Test: getItemFaction maps every Faction-Spending row id to its source faction
 * city. Used by the Faction Spending filter to show only items spendable from a
 * single faction's FP balance.
 *
 * Run: node tests/faction-of-item.test.cjs
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const Module = require("module");

const utilsSrc = ["utils", "utils-item-ids", "utils-overrides", "utils-focus-fees"].map((n) => fs.readFileSync(path.join(__dirname, "..", "js", n + ".js"), "utf-8")).join("\n");

const utilsMod = new Module("utils-faction-of-item");
utilsMod._compile(
  utilsSrc + "\nmodule.exports = { getItemFaction };",
  "utils.js"
);
const { getItemFaction } = utilsMod.exports;

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

console.log("getItemFaction tests\n");

// ── hearts (T1_FACTION_<BIOME>_TOKEN_1) ──
const hearts = [
  ["T1_FACTION_SWAMP_TOKEN_1",     "Thetford"],
  ["T1_FACTION_FOREST_TOKEN_1",    "Lymhurst"],
  ["T1_FACTION_MOUNTAIN_TOKEN_1",  "Fort Sterling"],
  ["T1_FACTION_HIGHLAND_TOKEN_1",  "Martlock"],
  ["T1_FACTION_STEPPE_TOKEN_1",    "Bridgewatch"],
  ["T1_FACTION_CAERLEON_TOKEN_1",  "Caerleon"],
];
hearts.forEach(([id, city]) => {
  test(`heart ${id} → ${city}`, () => {
    assert.strictEqual(getItemFaction(id), city);
  });
});

// ── crests (TX_CAPEITEM_FW_<CITY>_BP) ──
const crests = [
  ["T4_CAPEITEM_FW_THETFORD_BP",     "Thetford"],
  ["T5_CAPEITEM_FW_LYMHURST_BP",     "Lymhurst"],
  ["T6_CAPEITEM_FW_FORTSTERLING_BP", "Fort Sterling"],
  ["T7_CAPEITEM_FW_BRIDGEWATCH_BP",  "Bridgewatch"],
  ["T8_CAPEITEM_FW_MARTLOCK_BP",     "Martlock"],
  ["T4_CAPEITEM_FW_BRECILIEN_BP",    "Brecilien"],
  ["T8_CAPEITEM_FW_BRECILIEN_BP",    "Brecilien"],
];
crests.forEach(([id, city]) => {
  test(`crest ${id} → ${city}`, () => {
    assert.strictEqual(getItemFaction(id), city);
  });
});

// ── babies (TX_FARM_<ANIMAL>_FW_<CITY>_BABY) ──
const babies = [
  ["T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY",       "Thetford"],
  ["T5_FARM_DIREBOAR_FW_LYMHURST_BABY",          "Lymhurst"],
  ["T5_FARM_DIREBEAR_FW_FORTSTERLING_BABY",      "Fort Sterling"],
  ["T5_FARM_MOABIRD_FW_BRIDGEWATCH_BABY",        "Bridgewatch"],
  ["T5_FARM_RAM_FW_MARTLOCK_BABY",               "Martlock"],
  ["T5_FARM_GREYWOLF_FW_CAERLEON_BABY",          "Caerleon"],
  ["T8_FARM_SWAMPDRAGON_FW_THETFORD_BABY",       "Thetford"],
  ["T8_FARM_GREYWOLF_FW_CAERLEON_BABY",          "Caerleon"],
  ["T5_FARM_OWL_FW_BRECILIEN_BABY",              "Brecilien"],
  ["T8_FARM_OWL_FW_BRECILIEN_BABY",              "Brecilien"],
];
babies.forEach(([id, city]) => {
  test(`baby ${id} → ${city}`, () => {
    assert.strictEqual(getItemFaction(id), city);
  });
});

// ── iron campaign chests (UNIQUE_LOOTCHEST_FACTIONCAMPAIGN_REWARD_<BIOME>_01) ──
const chests = [
  ["UNIQUE_LOOTCHEST_FACTIONCAMPAIGN_REWARD_SWAMP_01",     "Thetford"],
  ["UNIQUE_LOOTCHEST_FACTIONCAMPAIGN_REWARD_FOREST_01",    "Lymhurst"],
  ["UNIQUE_LOOTCHEST_FACTIONCAMPAIGN_REWARD_MOUNTAIN_01",  "Fort Sterling"],
  ["UNIQUE_LOOTCHEST_FACTIONCAMPAIGN_REWARD_HIGHLAND_01",  "Martlock"],
  ["UNIQUE_LOOTCHEST_FACTIONCAMPAIGN_REWARD_STEPPE_01",    "Bridgewatch"],
  ["UNIQUE_LOOTCHEST_FACTIONCAMPAIGN_REWARD_CAERLEON_01",  "Caerleon"],
];
chests.forEach(([id, city]) => {
  test(`chest ${id} → ${city}`, () => {
    assert.strictEqual(getItemFaction(id), city);
  });
});

// ── non-faction items return null ──
const nullCases = [
  "T7_MOUNT_SWAMPDRAGON",                // standard saddled swamp dragon
  "T5_LEATHER",
  "T4_MAIN_SWORD",
  "T5_CAPE",                             // standard cape, not FW
  "T1_FACTION_FOO_TOKEN_1",              // unknown biome
  "UNIQUE_LOOTCHEST_FACTIONCAMPAIGN_REWARD_ATLANTIS_01", // unknown biome
  "",
  null,
  undefined,
];
nullCases.forEach((id) => {
  test(`non-faction ${JSON.stringify(id)} → null`, () => {
    assert.strictEqual(getItemFaction(id), null);
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
