/**
 * Black-box tests for the crafting-station classifier (js/data-craft-stations.js)
 * and the station dropdown it feeds in the Crafting table (js/table-search.js).
 *
 * Feature: every crafting row belongs to one in-game crafting building
 * (Warrior's Forge / Hunter's Lodge / Mage's Tower / Toolmaker / Alchemist /
 * Cook / Mill / Butcher / Saddler / Artifact Foundry). The Crafting table grows
 * a "Station" picker next to Tier / Ench. that hides rows crafted elsewhere.
 *
 * Station membership is ground truth from ao-bin-dumps buildings.xml
 * <craftbuilding> item lists (offhands split across the three weapon buildings:
 * shields → Forge, torch/horn → Hunter's Lodge, book/orb/totem → Mage's Tower).
 *
 * Run: node tests/craft-station.test.cjs
 */

const assert = require("assert");
const {
  CRAFT_STATIONS,
  getCraftStation,
  getCraftStationLabel,
} = require("../js/data-craft-stations.js");
const { applyTableSearchFilter } = require("../js/table-search.js");

let passed = 0,
  failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL: ${name}\n        ${e.message}`);
    failed++;
  }
}

// ── 1. craftType → station ────────────────────────────────────────────────────
const BY_CRAFT_TYPE = [
  // Warrior's Forge
  ["sword", "forge"], ["axe", "forge"], ["mace", "forge"], ["hammer", "forge"],
  ["crossbow", "forge"], ["knuckles", "forge"], ["shield", "forge"],
  ["plate_armor", "forge"], ["plate_helmet", "forge"], ["plate_shoes", "forge"],
  // Hunter's Lodge
  ["bow", "hunterslodge"], ["spear", "hunterslodge"], ["dagger", "hunterslodge"],
  ["quarterstaff", "hunterslodge"], ["naturestaff", "hunterslodge"],
  ["shapeshifterstaff", "hunterslodge"], ["torch", "hunterslodge"], ["horn", "hunterslodge"],
  ["leather_armor", "hunterslodge"], ["leather_helmet", "hunterslodge"], ["leather_shoes", "hunterslodge"],
  // Mage's Tower
  ["firestaff", "magetower"], ["holystaff", "magetower"], ["froststaff", "magetower"],
  ["arcanestaff", "magetower"], ["cursestaff", "magetower"],
  ["book", "magetower"], ["orb", "magetower"], ["totem", "magetower"],
  ["cloth_armor", "magetower"], ["cloth_helmet", "magetower"], ["cloth_shoes", "magetower"],
  // Toolmaker
  ["pickaxe", "toolmaker"], ["sickle", "toolmaker"], ["skinningknife", "toolmaker"],
  ["fishing", "toolmaker"], ["stonehammer", "toolmaker"], ["demolitionhammer", "toolmaker"],
  ["woodaxe", "toolmaker"], ["bag", "toolmaker"], ["cape", "toolmaker"],
  ["oregatherer_helmet", "toolmaker"], ["fishgatherer_backpack", "toolmaker"],
  ["woodgatherer_armor", "toolmaker"], ["rockgatherer_shoes", "toolmaker"],
  // Consumables / mounts / artifacts
  ["potion", "alchemist"], ["food", "cook"], ["battlemount", "saddler"],
  ["artifact", "foundry"],
];

test("craftType maps to the right station", () => {
  BY_CRAFT_TYPE.forEach(([craftType, station]) => {
    assert.strictEqual(
      getCraftStation({ id: "T4_DUMMY", craftType }),
      station,
      `${craftType} → expected ${station}, got ${getCraftStation({ id: "T4_DUMMY", craftType })}`,
    );
  });
});

test("every craftType in the gear catalogs is classified", () => {
  const fs = require("fs");
  const path = require("path");
  const dir = path.join(__dirname, "..", "js");
  const seen = new Set();
  fs.readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .forEach((f) => {
      const src = fs.readFileSync(path.join(dir, f), "utf-8");
      const re = /"?craftType"?:\s*"([a-zA-Z_0-9]+)"/g;
      let m;
      while ((m = re.exec(src))) seen.add(m[1]);
    });
  assert.ok(seen.size > 40, `expected the catalogs to expose craftTypes, saw ${seen.size}`);
  const unmapped = [...seen].filter((ct) => !getCraftStation({ id: "T4_DUMMY", craftType: ct }));
  assert.deepStrictEqual(unmapped, [], `unmapped craftTypes: ${unmapped.join(", ")}`);
});

// ── 2. id fallback for rows whose craftType is null ───────────────────────────
const BY_ID = [
  ["T5_MOUNT_HORSE", "saddler"],
  ["T8_MOUNT_SWAMPDRAGON_BATTLE", "saddler"],
  ["T4_2H_TOOL_TRACKING", "toolmaker"],
  ["T6_FURNITUREITEM_TABLE", "toolmaker"],
  ["T4_FURNITUREITEM_REPAIRKIT", "toolmaker"],
  ["UNIQUE_HIDEOUT", "toolmaker"],
  ["T6_MEAL_STEW", "cook"],
  ["T4_BREAD", "cook"],
  ["T1_FISHSAUCE_LEVEL1", "cook"],
  ["T3_FLOUR", "mill"],
  ["T8_BUTTER", "mill"],
  ["T7_MEAT", "butcher"],
  ["T1_FISHCHOPS", "butcher"],
  ["T4_POTION_HEAL", "alchemist"],
  ["T5_ALCHEMY_EXTRACT_LEVEL1", "alchemist"],
  ["T4_ARTEFACT_2H_BOW_HELL", "foundry"],
  ["T8_RANDOM_DUNGEON_SOLO_TOKEN_1", "foundry"],
];

test("id pattern classifies rows with no craftType", () => {
  BY_ID.forEach(([id, station]) => {
    assert.strictEqual(getCraftStation({ id }), station, `${id} → expected ${station}`);
  });
});

test("enchanted / variant ids classify like their base", () => {
  assert.strictEqual(getCraftStation({ id: "T6_MAIN_SWORD@3", craftType: "sword" }), "forge");
  assert.strictEqual(getCraftStation({ id: "T6_MEAL_STEW@1" }), "cook");
});

test("unknown items classify as null (never a wrong station)", () => {
  assert.strictEqual(getCraftStation({ id: "T4_SOMETHING_WEIRD" }), null);
  assert.strictEqual(getCraftStation(null), null);
  assert.strictEqual(getCraftStation({}), null);
});

test("station list is ordered, unique and fully labelled", () => {
  const keys = CRAFT_STATIONS.map((s) => s.key);
  assert.strictEqual(new Set(keys).size, keys.length, "duplicate station keys");
  CRAFT_STATIONS.forEach((s) => {
    assert.ok(s.label && typeof s.label === "string", `${s.key} has no label`);
    assert.strictEqual(getCraftStationLabel(s.key), s.label);
  });
  assert.ok(keys.includes("forge") && keys.includes("toolmaker"));
});

// ── 3. the Crafting table's Station dropdown ─────────────────────────────────
function makeRow({ text = "", rowKey = null, station = null } = {}) {
  return {
    textContent: text,
    style: { display: "" },
    classList: { contains: () => false },
    hasAttribute: () => false,
    getAttribute: (a) =>
      a === "data-row-key" ? rowKey : a === "data-station" ? station : null,
  };
}

function mountCrafting(rows) {
  const input = { value: "" };
  const tierSel = { value: "" };
  const enchSel = { value: "" };
  const stationSel = { value: "" };
  global.document = {
    getElementById(id) {
      if (id === "search-crafting-table") return input;
      if (id === "tierfilter-crafting-table") return tierSel;
      if (id === "enchfilter-crafting-table") return enchSel;
      if (id === "stationfilter-crafting-table") return stationSel;
      return null;
    },
    querySelector(sel) {
      return sel === "#crafting-table tbody" ? { rows } : null;
    },
  };
  return { input, tierSel, enchSel, stationSel };
}

test("station pick hides rows crafted elsewhere", () => {
  const rows = [
    makeRow({ text: "Adept's Broadsword", rowKey: "T4_MAIN_SWORD|Lymhurst", station: "forge" }),
    makeRow({ text: "Adept's Fire Staff", rowKey: "T4_MAIN_FIRESTAFF|Thetford", station: "magetower" }),
    makeRow({ text: "Adept's Pickaxe", rowKey: "T4_2H_TOOL_PICK|Caerleon", station: "toolmaker" }),
  ];
  const { stationSel } = mountCrafting(rows);
  stationSel.value = "forge";
  applyTableSearchFilter("crafting-table");
  assert.deepStrictEqual(rows.map((r) => r.style.display), ["", "none", "none"]);

  stationSel.value = "";
  applyTableSearchFilter("crafting-table");
  assert.deepStrictEqual(rows.map((r) => r.style.display), ["", "", ""]);
});

test("station ANDs with text and tier", () => {
  const rows = [
    makeRow({ text: "Adept's Broadsword T4", rowKey: "T4_MAIN_SWORD|Lymhurst", station: "forge" }),
    makeRow({ text: "Expert's Broadsword T5", rowKey: "T5_MAIN_SWORD|Lymhurst", station: "forge" }),
    makeRow({ text: "Expert's Fire Staff T5", rowKey: "T5_MAIN_FIRESTAFF|Thetford", station: "magetower" }),
  ];
  const { input, tierSel, stationSel } = mountCrafting(rows);
  stationSel.value = "forge";
  tierSel.value = "5";
  applyTableSearchFilter("crafting-table");
  assert.deepStrictEqual(rows.map((r) => r.style.display), ["none", "", "none"]);

  input.value = "fire";
  applyTableSearchFilter("crafting-table");
  assert.deepStrictEqual(rows.map((r) => r.style.display), ["none", "none", "none"]);
});

test("rows with no data-station fall back to their row-key id", () => {
  const rows = [
    makeRow({ text: "Adept's Broadsword", rowKey: "T4_MAIN_SWORD|Lymhurst" }),
    makeRow({ text: "Adept's Stew", rowKey: "T4_MEAL_STEW|Martlock" }),
  ];
  const { stationSel } = mountCrafting(rows);
  stationSel.value = "cook";
  applyTableSearchFilter("crafting-table");
  assert.deepStrictEqual(rows.map((r) => r.style.display), ["none", ""]);
});

// ── 4. the option list follows the rows actually on screen ───────────────────
function makeSelect() {
  const sel = {
    value: "",
    options: [{ value: "", textContent: "Station" }],
    remove(i) {
      sel.options.splice(i, 1);
    },
    appendChild(op) {
      sel.options.push(op);
    },
  };
  return sel;
}

function mountWithRealSelect(rows) {
  const input = { value: "" };
  const stationSel = makeSelect();
  global.document = {
    // Options carry a data-i18n slug so a language switch can re-label them.
    createElement: () => ({ value: "", textContent: "", attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }),
    getElementById(id) {
      if (id === "search-crafting-table") return input;
      if (id === "stationfilter-crafting-table") return stationSel;
      return null;
    },
    querySelector(sel) {
      return sel === "#crafting-table tbody" ? { rows } : null;
    },
  };
  return { input, stationSel };
}

test("station options list only the stations the table has rows for", () => {
  const rows = [
    makeRow({ text: "Sword", rowKey: "T4_MAIN_SWORD|Lymhurst", station: "forge" }),
    makeRow({ text: "Pickaxe", rowKey: "T4_2H_TOOL_PICK|Caerleon", station: "toolmaker" }),
  ];
  const { stationSel } = mountWithRealSelect(rows);
  applyTableSearchFilter("crafting-table");
  assert.deepStrictEqual(
    stationSel.options.map((o) => o.value),
    ["", "forge", "toolmaker"],
    "expected only the present stations, in CRAFT_STATIONS order",
  );
});

test("the active station pick survives a rebuild that no longer contains it", () => {
  const rows = [makeRow({ text: "Sword", rowKey: "T4_MAIN_SWORD|Lymhurst", station: "forge" })];
  const { stationSel } = mountWithRealSelect(rows);
  applyTableSearchFilter("crafting-table");
  stationSel.value = "cook"; // user picks a station, rows then re-render without it
  applyTableSearchFilter("crafting-table");
  assert.ok(stationSel.options.some((o) => o.value === "cook"), "kept the active pick");
  assert.strictEqual(stationSel.value, "cook");
  assert.strictEqual(rows[0].style.display, "none", "forge row hidden under a cook pick");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
