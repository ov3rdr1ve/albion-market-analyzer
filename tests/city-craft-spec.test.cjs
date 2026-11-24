/**
 * Test: CITY_CRAFT_SPEC must map to actual craftType values from gear data files.
 * Offhands -> Martlock, staves -> correct cities, knuckles -> Thetford.
 *
 * Run: node tests/city-craft-spec.test.cjs
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

// ── helpers ────────────────────────────────────────────────────────────
function loadFileContent(relPath) {
  return fs.readFileSync(path.join(__dirname, "..", relPath), "utf-8");
}

function extractValue(src, varName) {
  const fn = new Function(`${src}; return ${varName};`);
  return fn();
}

// ── load sources ───────────────────────────────────────────────────────
// The city bonus tables were split into js/data-city-bonuses.js; the sandbox
// needs both sources, in load order.
const calcSrc = loadFileContent("js/data-city-bonuses.js") + (loadFileContent("js/calculations.js") + loadFileContent("js/calculations-margins.js"));
const CITY_CRAFT_SPEC = extractValue(calcSrc, "CITY_CRAFT_SPEC");

// Build getSpecCraftCity from source
loadFileContent("js/render-crafting.js");
function getSpecCraftCity(craftType) {
  if (!craftType) return null;
  for (const [city, types] of Object.entries(CITY_CRAFT_SPEC)) {
    if (types.includes(craftType)) return city;
  }
  return null;
}

// ── collect all craftTypes from gear files ──────────────────────────────
const gearFiles = [
  "js/gear-offhand.js",
  "js/gear-staves-a.js",
  "js/gear-staves-b.js",
  "js/gear-staves-c.js",
  "js/gear-melee-heavy.js",
  "js/gear-melee-light.js",
  "js/gear-ranged.js",
  "js/gear-armor.js",
  "js/gear-gatherer.js",
  "js/gear-crystal-weapons.js",
];

const allCraftTypes = new Set();
const gearArrayNames = {
  "js/gear-offhand.js": "GEAR_OFFHAND",
  "js/gear-staves-a.js": "GEAR_STAVES_A",
  "js/gear-staves-b.js": "GEAR_STAVES_B",
  "js/gear-staves-c.js": "GEAR_STAVES_C",
  "js/gear-melee-heavy.js": "GEAR_MELEE_HEAVY",
  "js/gear-melee-light.js": "GEAR_MELEE_LIGHT",
  "js/gear-ranged.js": "GEAR_RANGED",
  "js/gear-armor.js": "GEAR_ARMOR",
  "js/gear-gatherer.js": "GEAR_GATHERER",
  "js/gear-crystal-weapons.js": "GEAR_CRYSTAL_WEAPONS",
};

for (const file of gearFiles) {
  const filePath = path.join(__dirname, "..", file);
  if (!fs.existsSync(filePath)) continue;
  const src = loadFileContent(file);
  const varName = gearArrayNames[file];
  const items = extractValue(src, varName);
  items.forEach((item) => {
    if (item.craftType) allCraftTypes.add(item.craftType);
  });
}

// ── tests ──────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL: ${name} — ${e.message}`);
  }
}

console.log("City Craft Spec Tests\n");

// -- Off-hands at Martlock per Wiki (bag is at Brecilien, not here) --
const offhandTypes = ["shield", "torch", "book", "totem", "orb", "horn"];
offhandTypes.forEach((type) => {
  test(`offhand "${type}" -> Martlock`, () => {
    assert.strictEqual(getSpecCraftCity(type), "Martlock");
  });
});

// -- Staves must map to correct cities --
const staveMappings = [
  ["firestaff", "Thetford"],
  ["naturestaff", "Thetford"],
  ["holystaff", "Fort Sterling"],
  ["arcanestaff", "Lymhurst"],
  ["cursestaff", "Bridgewatch"],
  ["froststaff", "Martlock"],
  ["shapeshifterstaff", "Caerleon"],
];
staveMappings.forEach(([type, city]) => {
  test(`staff "${type}" -> ${city}`, () => {
    assert.strictEqual(getSpecCraftCity(type), city);
  });
});

// -- War Gloves (knuckles) at Caerleon per Wiki --
test(`"knuckles" -> Caerleon`, () => {
  assert.strictEqual(getSpecCraftCity("knuckles"), "Caerleon");
});

// -- Brecilien specialties (Cape, Bag) --
const brecilienTypes = ["cape", "bag"];
brecilienTypes.forEach((type) => {
  test(`"${type}" -> Brecilien`, () => {
    assert.strictEqual(getSpecCraftCity(type), "Brecilien");
  });
});

// -- Caerleon Tool category --
const caerleonTools = [
  "pickaxe", "sickle", "skinningknife", "fishing",
  "stonehammer", "demolitionhammer", "woodaxe",
];
caerleonTools.forEach((type) => {
  test(`tool "${type}" -> Caerleon`, () => {
    assert.strictEqual(getSpecCraftCity(type), "Caerleon");
  });
});

// -- Caerleon Gathering Gear (6 resources × 4 slots) --
const gatherResources = ["fiber", "hide", "ore", "rock", "wood", "fish"];
const gatherSlots = ["helmet", "armor", "shoes", "backpack"];
gatherResources.forEach((res) => {
  gatherSlots.forEach((slot) => {
    const type = `${res}gatherer_${slot}`;
    test(`gathering gear "${type}" -> Caerleon`, () => {
      assert.strictEqual(getSpecCraftCity(type), "Caerleon");
    });
  });
});

// -- Weapons/armor that already worked --
const existingMappings = [
  ["hammer", "Fort Sterling"],
  ["spear", "Fort Sterling"],
  ["plate_helmet", "Fort Sterling"],
  ["cloth_armor", "Fort Sterling"],
  ["sword", "Lymhurst"],
  ["bow", "Lymhurst"],
  ["leather_helmet", "Lymhurst"],
  ["leather_shoes", "Lymhurst"],
  ["crossbow", "Bridgewatch"],
  ["dagger", "Bridgewatch"],
  ["plate_armor", "Bridgewatch"],
  ["cloth_shoes", "Bridgewatch"],
  ["mace", "Thetford"],
  ["leather_armor", "Thetford"],
  ["cloth_helmet", "Thetford"],
  ["axe", "Martlock"],
  ["quarterstaff", "Martlock"],
  ["plate_shoes", "Martlock"],
];
existingMappings.forEach(([type, city]) => {
  test(`"${type}" -> ${city}`, () => {
    assert.strictEqual(getSpecCraftCity(type), city);
  });
});

// -- null / unknown craftType should return null --
test(`null craftType -> null`, () => {
  assert.strictEqual(getSpecCraftCity(null), null);
});
test(`unknown craftType -> null`, () => {
  assert.strictEqual(getSpecCraftCity("not_a_real_type"), null);
});

// -- Every craftType in gear files must map to a city (no unspecialized gear left after fix) --
const intentionallyUnspecialized = new Set([]);
test("all gear craftTypes are either mapped or intentionally unspecialized", () => {
  const unmapped = [];
  for (const ct of allCraftTypes) {
    if (!intentionallyUnspecialized.has(ct) && !getSpecCraftCity(ct)) {
      unmapped.push(ct);
    }
  }
  assert.deepStrictEqual(unmapped, [], `Unmapped craftTypes: ${unmapped.join(", ")}`);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
